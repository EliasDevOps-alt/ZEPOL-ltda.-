from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Devolucion, Entrega, EstadoSid, OtMaterial

NOMBRE_PENDIENTE = "PENDIENTE"
NOMBRE_COMPLETADO = "COMPLETADO"


def _estado_por_nombre(db: Session, nombre: str) -> EstadoSid:
    estado = db.scalar(select(EstadoSid).where(EstadoSid.nombre == nombre))
    if estado is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Falta sembrar el estado_sid '{nombre}'")
    return estado


# --- SID de la entrega: se tramita día por día, así que el estado del
# pedido es un AGREGADO de sus entregas (nunca se marca directamente) —
# completo solo cuando cada entrega individual ya tiene su check. Una
# entrega nueva reabre el pedido automáticamente, porque todavía no tiene
# su propio check marcado. ---


def recalcular_estado_entrega(db: Session, ot_material: OtMaterial) -> None:
    entregas = db.scalars(select(Entrega).where(Entrega.ot_material_id == ot_material.id)).all()
    completo = bool(entregas) and all(e.sid_completado for e in entregas)
    ot_material.estado_sid_id = _estado_por_nombre(db, NOMBRE_COMPLETADO if completo else NOMBRE_PENDIENTE).id


def marcar_entrega_sid(db: Session, entrega_id: int, completado: bool) -> Entrega:
    entrega = db.get(Entrega, entrega_id)
    if entrega is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entrega no encontrada")
    entrega.sid_completado = completado
    db.flush()
    recalcular_estado_entrega(db, entrega.ot_material)
    db.commit()
    db.refresh(entrega)
    return entrega


# --- SID de la devolución (trámite independiente del de la entrega),
# mismo esquema día-por-día. ---


def recalcular_sid_devolucion(db: Session, ot_material: OtMaterial) -> None:
    devoluciones = db.scalars(select(Devolucion).where(Devolucion.ot_material_id == ot_material.id)).all()
    ot_material.sid_devolucion_completado = bool(devoluciones) and all(d.sid_completado for d in devoluciones)


def marcar_devolucion_sid(db: Session, devolucion_id: int, completado: bool) -> Devolucion:
    devolucion = db.get(Devolucion, devolucion_id)
    if devolucion is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Devolución no encontrada")
    if devolucion.ot_material_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ese material todavía no tiene pedido asignado")
    devolucion.sid_completado = completado
    db.flush()
    recalcular_sid_devolucion(db, devolucion.ot_material)
    db.commit()
    db.refresh(devolucion)
    return devolucion
