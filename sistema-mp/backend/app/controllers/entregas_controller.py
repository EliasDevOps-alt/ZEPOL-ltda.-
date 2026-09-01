from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..models import (
    Entrega,
    EntregaBobina,
    Material,
    OrdenTrabajo,
    OtMaterial,
    OtMaterialPendiente,
    OtProceso,
    Usuario,
)
from . import ordenes_controller, sid_controller


def _validar_materia_prima(data: schemas.EntregaCreate) -> None:
    if data.material_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Indica qué materia prima se está entregando")
    if data.proceso_id is None or data.maquina_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Indica el proceso y la máquina donde se consume esa materia prima"
        )


def _resolver_pedido(db: Session, data: schemas.EntregaCreate) -> Tuple[OtMaterial, bool]:
    """Contra qué pedido queda realmente la entrega. Ver EntregaCreate para los
    dos modos; devuelve además si ese pedido se acaba de crear."""
    if (data.ot_material_id is None) == (data.pendiente_id is None):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Indica el pedido o el material pendiente, no los dos"
        )

    # Materia prima para un material que todavía no tiene proceso asignado.
    if data.pendiente_id is not None:
        if not data.como_materia_prima:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Un material pendiente no se puede entregar hasta que se le asigne proceso y máquina",
            )
        pendiente = db.get(OtMaterialPendiente, data.pendiente_id)
        if pendiente is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Material pendiente no encontrado")
        _validar_materia_prima(data)
        return ordenes_controller.crear_pedido_materia_prima_de_pendiente(
            db, pendiente, data.material_id, data.proceso_id, data.maquina_id, sum(data.bobinas)
        )

    ot_material = db.get(OtMaterial, data.ot_material_id)
    if ot_material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido de material no encontrado")

    if not data.como_materia_prima:
        return ot_material, False

    _validar_materia_prima(data)
    return ordenes_controller.crear_pedido_materia_prima(
        db, ot_material, data.material_id, data.proceso_id, data.maquina_id, sum(data.bobinas)
    )


def _resolver_ot_proceso_entrega(
    db: Session, pedido: OtMaterial, proceso_id: Optional[int], maquina_id: Optional[int]
) -> Optional[int]:
    """Si se pidió un proceso/máquina distinto del "hogar" del pedido,
    resuelve (o crea) el OtProceso correspondiente dentro de la misma OT —
    ver Entrega.ot_proceso_id. None si no se pidió nada, o si coincide con el
    del pedido: significa "se consumió donde vive el pedido", el caso normal.

    Con como_materia_prima esto siempre da None sin necesidad de un caso
    aparte: el pedido que llega acá ya es el que crear_pedido_materia_prima[_
    de_pendiente] armó exactamente con ese proceso_id/maquina_id como hogar,
    así que la comparación de abajo ya los encuentra iguales."""
    if proceso_id is None or maquina_id is None:
        return None
    ot_proceso_pedido = pedido.ot_proceso
    if proceso_id == ot_proceso_pedido.proceso_id and maquina_id == ot_proceso_pedido.maquina_id:
        return None
    ot_proceso = ordenes_controller.crear_o_reutilizar_ot_proceso(db, ot_proceso_pedido.ot_id, proceso_id, maquina_id)
    return ot_proceso.id


def registrar_entrega(db: Session, usuario: Usuario, data: schemas.EntregaCreate) -> Tuple[Entrega, bool]:
    pedido, pedido_creado = _resolver_pedido(db, data)

    # Sin material_id explícito, se entrega el material del pedido tal cual
    # (el caso normal, sin sustitución).
    material_id = data.material_id if data.material_id is not None else pedido.material_id
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material no encontrado")

    entrega = Entrega(
        ot_material_id=pedido.id,
        material_id=material.id,
        ot_proceso_id=_resolver_ot_proceso_entrega(db, pedido, data.proceso_id, data.maquina_id),
        usuario_id=usuario.id,
        fecha=data.fecha,
        observacion=data.observacion,
    )
    entrega.bobinas = [EntregaBobina(numero=i + 1, cantidad=c) for i, c in enumerate(data.bobinas)]
    db.add(entrega)
    db.flush()
    # Esta entrega recién creada nunca tiene su SID registrado todavía, así
    # que el pedido vuelve a quedar pendiente aunque las anteriores ya
    # estuvieran completas.
    sid_controller.recalcular_estado_entrega(db, pedido)
    db.commit()
    db.refresh(entrega)
    return entrega, pedido_creado


def listar_entregas_por_ot(db: Session, numero_ot: Optional[str] = None) -> List[Entrega]:
    stmt = (
        select(Entrega)
        .join(OtMaterial, OtMaterial.id == Entrega.ot_material_id)
        .join(OtProceso, OtProceso.id == OtMaterial.ot_proceso_id)
        .join(OrdenTrabajo, OrdenTrabajo.id == OtProceso.ot_id)
        .order_by(Entrega.id)
    )
    if numero_ot is not None:
        stmt = stmt.where(OrdenTrabajo.numero_ot == numero_ot)
    return db.scalars(stmt).all()


def _bloquear_si_entrega_tiene_sid(entrega: Entrega) -> None:
    # El SID de esta entrega puntual (Registro SID) es un trámite externo —
    # una vez que alguien lo marcó como registrado, corregir o borrar la
    # entrega dejaría ese trámite desalineado con lo que quedó en el sistema.
    # Para volver a corregirla hace falta primero desmarcar el SID desde
    # Registro SID (sid_controller.marcar_entrega_sid).
    if entrega.sid_completado:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Esta entrega ya tiene su SID registrado — desmarcalo en Registro SID antes de corregirla",
        )


# Corregir/borrar una entrega ya registrada — a diferencia del resto del
# sistema (donde un pedido con movimiento real queda bloqueado, ver
# ordenes_controller.actualizar_pedido), esto SÍ se permite mientras no tenga
# su SID registrado: el personal de planta no siempre tipea bien a la primera
# y no hay otra forma de arreglar una cantidad o fecha mal cargada una vez
# guardada. Lo que deja rastro de que pasó es editado_por_id/editado_en, que
# se muestran en la propia ficha de la entrega (ver EntregaOut).
def editar_entrega(db: Session, usuario: Usuario, entrega_id: int, data: schemas.EntregaUpdate) -> Entrega:
    entrega = db.get(Entrega, entrega_id)
    if entrega is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entrega no encontrada")
    _bloquear_si_entrega_tiene_sid(entrega)

    pedido = entrega.ot_material

    if data.fecha is not None:
        entrega.fecha = data.fecha
    if data.material_id is not None:
        material = db.get(Material, data.material_id)
        if material is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Material no encontrado")
        entrega.material_id = material.id
    if data.observacion is not None:
        entrega.observacion = data.observacion
    if (data.proceso_id is None) != (data.maquina_id is None):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Indica el proceso y la máquina, o ninguno de los dos")
    if data.proceso_id is not None and data.maquina_id is not None:
        entrega.ot_proceso_id = _resolver_ot_proceso_entrega(db, pedido, data.proceso_id, data.maquina_id)
    if data.bobinas is not None:
        for bobina in list(entrega.bobinas):
            db.delete(bobina)
        db.flush()
        entrega.bobinas = [EntregaBobina(numero=i + 1, cantidad=c) for i, c in enumerate(data.bobinas)]

    entrega.editado_por_id = usuario.id
    entrega.editado_en = datetime.utcnow()

    db.flush()
    sid_controller.recalcular_estado_entrega(db, pedido)
    db.commit()
    db.refresh(entrega)
    return entrega


def eliminar_entrega(db: Session, usuario: Usuario, entrega_id: int) -> None:
    entrega = db.get(Entrega, entrega_id)
    if entrega is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entrega no encontrada")
    _bloquear_si_entrega_tiene_sid(entrega)

    pedido = entrega.ot_material

    db.delete(entrega)
    db.flush()
    sid_controller.recalcular_estado_entrega(db, pedido)
    db.commit()
