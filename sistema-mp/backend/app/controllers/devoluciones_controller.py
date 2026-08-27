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
    Material,
    OrdenTrabajo,
    OtMaterial,
    OtMaterialPendiente,
    OtProceso,
    Usuario,
)
from . import sid_controller


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
        stmt = stmt.where(OrdenTrabajo.numero_ot == numero_ot)
    return db.scalars(stmt).all()


# Ver la nota equivalente en entregas_controller.editar_entrega: esto se
# permite siempre (no se bloquea por tener movimiento real) porque de eso se
# trata — corregir un movimiento real mal cargado. editado_por_id/editado_en
# dejan rastro de que pasó, mostrado en la propia ficha (ver DevolucionOut).
def editar_devolucion(db: Session, usuario: Usuario, devolucion_id: int, data: schemas.DevolucionUpdate) -> Devolucion:
    devolucion = db.get(Devolucion, devolucion_id)
    if devolucion is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Devolución no encontrada")

    ot_material = devolucion.ot_material

    if data.fecha is not None:
        devolucion.fecha = data.fecha
    if data.material_id is not None:
        material = db.get(Material, data.material_id)
        if material is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Material no encontrado")
        devolucion.material_id = material.id
    if data.bobinas is not None:
        for bobina in list(devolucion.bobinas):
            db.delete(bobina)
        db.flush()
        devolucion.bobinas = [DevolucionBobina(numero=i + 1, cantidad=c) for i, c in enumerate(data.bobinas)]

    devolucion.editado_por_id = usuario.id
    devolucion.editado_en = datetime.utcnow()

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

    ot_material = devolucion.ot_material

    db.delete(devolucion)
    db.flush()
    if ot_material is not None:
        sid_controller.recalcular_sid_devolucion(db, ot_material)
    db.commit()
