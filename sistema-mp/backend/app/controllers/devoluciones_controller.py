from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from sqlalchemy import func, or_

from ..models import (
    Devolucion,
    DevolucionBobina,
    Entrega,
    Material,
    OrdenTrabajo,
    OtMaterial,
    OtMaterialPendiente,
    OtProceso,
    Usuario,
)
from . import ordenes_controller, sid_controller


def _validar_entrega_de_la_devolucion(db, entrega_id, ot_material, material, es_ingreso_produccion):
    """Indicar de cuál entrega es un sobrante es OPCIONAL. Si se indica, tiene
    que ser una entrega de ESTE pedido y del MISMO material que se devuelve (no
    se puede devolver BOPP20760 diciendo que es de una entrega de BOPP20720), y
    solo aplica a sobrantes: un ingreso a almacén es material fabricado, nunca
    salió en una entrega."""
    if entrega_id is None:
        return None
    if es_ingreso_produccion or ot_material is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Solo un sobrante puede indicar de cuál entrega es"
        )
    entrega = db.get(Entrega, entrega_id)
    if entrega is None or entrega.ot_material_id != ot_material.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esa entrega no es de este pedido")
    if entrega.material_id != material.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Esa entrega fue de {entrega.material.codigo_mp}, no de {material.codigo_mp}",
        )
    return entrega.id


def _entrega_unica_sin_duda(db, ot_material, material, es_ingreso_produccion) -> Optional[int]:
    """Si el sobrante no dice de cuál entrega es pero el pedido tiene UNA sola
    entrega, y es del mismo material que se devuelve, de ahí tiene que haber
    salido: no hay otra posible, así que se vincula sola. Sin esto, la pantalla
    de devolución (que con 0 o 1 entrega muestra una única opción, la del
    pedido) lo dejaba sin vínculo, y cuando después llegaba una segunda entrega
    Consultar OT lo mostraba como un tercero, "devuelto sin indicar entrega"
    (OT 220384: 162.4 kg devueltos entre dos entregas del BOPP20620).

    Con 2 o más entregas, o con otro material, sigue siendo opcional y no se
    adivina. Solo se usa al REGISTRAR: al corregir una devolución quitar el
    vínculo tiene que seguir siendo posible."""
    if es_ingreso_produccion or ot_material is None:
        return None
    entregas = db.scalars(select(Entrega).where(Entrega.ot_material_id == ot_material.id)).all()
    if len(entregas) == 1 and entregas[0].material_id == material.id:
        return entregas[0].id
    return None


def registrar_devolucion(db: Session, usuario: Usuario, data: schemas.DevolucionCreate) -> Devolucion:
    if (data.ot_material_id is None) == (data.pendiente_id is None):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Indica el pedido o el material pendiente, no los dos"
        )

    ot_material = None
    pendiente = None
    if data.pendiente_id is not None:
        # De un material sin pedido no salió nada de almacén, así que lo único
        # que puede volver es material fabricado entrando.
        if not data.es_ingreso_produccion:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Ese material todavía no se entregó a producción, así que no puede tener sobrantes",
            )
        pendiente = db.get(OtMaterialPendiente, data.pendiente_id)
        if pendiente is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Material pendiente no encontrado")
    else:
        ot_material = db.get(OtMaterial, data.ot_material_id)
        if ot_material is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido de material no encontrado")

    material = db.get(Material, data.material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material no encontrado")

    entrega_id = _validar_entrega_de_la_devolucion(db, data.entrega_id, ot_material, material, data.es_ingreso_produccion)
    if entrega_id is None:
        entrega_id = _entrega_unica_sin_duda(db, ot_material, material, data.es_ingreso_produccion)

    # No se bloquea si la cantidad supera lo entregado registrado en el
    # sistema: el registro de entregas puede estar incompleto o el conteo
    # físico real puede diferir, y el operador sabe qué volvió realmente a
    # bodega mejor que la cuenta del sistema. El frontend avisa cuando esto
    # pasa (ver PedidoDevolucionCard), pero no impide guardar.
    devolucion = Devolucion(
        ot_material_id=ot_material.id if ot_material is not None else None,
        ot_material_pendiente_id=pendiente.id if pendiente is not None else None,
        material_id=material.id,
        usuario_id=usuario.id,
        fecha=data.fecha,
        es_ingreso_produccion=data.es_ingreso_produccion,
        entrega_id=entrega_id,
    )
    devolucion.bobinas = [DevolucionBobina(numero=i + 1, cantidad=c) for i, c in enumerate(data.bobinas)]
    db.add(devolucion)
    db.flush()
    # Esta devolución recién creada nunca tiene su SID registrado todavía,
    # así que el pedido vuelve a quedar pendiente aunque las anteriores ya
    # estuvieran completas. No aplica al ingreso sin pedido (pendiente):
    # sid_devolucion_completado solo existe una vez que hay un OtMaterial.
    if ot_material is not None:
        sid_controller.recalcular_sid_devolucion(db, ot_material)
    db.commit()
    db.refresh(devolucion)
    return devolucion


def listar_devoluciones_por_pedido(db: Session, ot_material_id: int) -> List[Devolucion]:
    return db.scalars(
        select(Devolucion).where(Devolucion.ot_material_id == ot_material_id).order_by(Devolucion.id)
    ).all()


def listar_devoluciones_por_ot(db: Session, numero_ot: Optional[str] = None) -> List[Devolucion]:
    """Una devolución cuelga del pedido o —si el material fabricado entró a
    almacén antes de tener pedido— del pendiente. La OT sale de cualquiera de
    los dos caminos, por eso los JOIN son externos."""
    stmt = (
        select(Devolucion)
        .outerjoin(OtMaterial, OtMaterial.id == Devolucion.ot_material_id)
        .outerjoin(OtProceso, OtProceso.id == OtMaterial.ot_proceso_id)
        .outerjoin(OtMaterialPendiente, OtMaterialPendiente.id == Devolucion.ot_material_pendiente_id)
        .join(
            OrdenTrabajo,
            OrdenTrabajo.id == func.coalesce(OtProceso.ot_id, OtMaterialPendiente.ot_id),
        )
        .order_by(Devolucion.id)
    )
    if numero_ot is not None:
        stmt = stmt.where(OrdenTrabajo.numero_ot == numero_ot.strip().upper())
    return db.scalars(stmt).all()


def _bloquear_si_devolucion_tiene_sid(devolucion: Devolucion) -> None:
    # Ver la nota equivalente en entregas_controller._bloquear_si_entrega_tiene_sid.
    if devolucion.sid_completado:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Esta devolución ya tiene su SID registrado — desmarcalo en Registro SID antes de corregirla",
        )


# Ver la nota equivalente en entregas_controller.editar_entrega: esto se
# permite mientras no tenga su SID registrado — corregir un movimiento real
# mal cargado. editado_por_id/editado_en dejan rastro de que pasó, mostrado
# en la propia ficha (ver DevolucionOut).
def editar_devolucion(db: Session, usuario: Usuario, devolucion_id: int, data: schemas.DevolucionUpdate) -> Devolucion:
    devolucion = db.get(Devolucion, devolucion_id)
    if devolucion is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Devolución no encontrada")
    _bloquear_si_devolucion_tiene_sid(devolucion)

    ot_material = devolucion.ot_material

    if data.fecha is not None:
        devolucion.fecha = data.fecha
    if data.material_id is not None:
        material = db.get(Material, data.material_id)
        if material is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Material no encontrado")
        devolucion.material_id = material.id
    if "entrega_id" in data.model_fields_set:
        # null = quitar el vínculo; un número = vincularla a esa entrega. Se
        # valida contra el material FINAL (el que quedó tras este mismo cambio).
        devolucion.entrega_id = _validar_entrega_de_la_devolucion(
            db, data.entrega_id, ot_material, db.get(Material, devolucion.material_id), devolucion.es_ingreso_produccion
        )
    elif devolucion.entrega_id is not None and data.material_id is not None:
        # Cambió el material pero no el vínculo: si ya no coincide con el de la
        # entrega, el vínculo deja de tener sentido y se quita.
        if devolucion.entrega is not None and devolucion.entrega.material_id != devolucion.material_id:
            devolucion.entrega_id = None
    if data.bobinas is not None:
        for bobina in list(devolucion.bobinas):
            db.delete(bobina)
        db.flush()
        devolucion.bobinas = [DevolucionBobina(numero=i + 1, cantidad=c) for i, c in enumerate(data.bobinas)]

    devolucion.editado_por_id = usuario.id
    # Hora local, no UTC — ver la nota en entregas_controller.editar_entrega.
    devolucion.editado_en = datetime.now()

    db.flush()
    if ot_material is not None:
        sid_controller.recalcular_sid_devolucion(db, ot_material)
    db.commit()
    db.refresh(devolucion)
    return devolucion


def eliminar_devolucion(db: Session, usuario: Usuario, devolucion_id: int) -> None:
    devolucion = db.get(Devolucion, devolucion_id)
    if devolucion is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Devolución no encontrada")
    _bloquear_si_devolucion_tiene_sid(devolucion)

    ot_material = devolucion.ot_material

    db.delete(devolucion)
    db.flush()
    # Ver la nota equivalente en entregas_controller.eliminar_entrega: si esta
    # era la última entrega/devolución del pedido, vuelve a ser pendiente.
    if ot_material is not None and not ordenes_controller.revertir_a_pendiente_si_vacio(db, ot_material):
        sid_controller.recalcular_sid_devolucion(db, ot_material)
    db.commit()
