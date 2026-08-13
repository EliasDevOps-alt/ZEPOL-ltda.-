from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import EstadoSid, OtMaterial

NOMBRE_PENDIENTE = "PENDIENTE"
NOMBRE_COMPLETADO = "COMPLETADO"


def _obtener_ot_material(db: Session, ot_material_id: int) -> OtMaterial:
    ot_material = db.get(OtMaterial, ot_material_id)
    if ot_material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido de material no encontrado")
    return ot_material


def _estado_por_nombre(db: Session, nombre: str) -> EstadoSid:
    estado = db.scalar(select(EstadoSid).where(EstadoSid.nombre == nombre))
    if estado is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Falta sembrar el estado_sid '{nombre}'")
    return estado


# --- SID de la entrega ---


def _cambiar_estado(db: Session, ot_material_id: int, nombre_estado: str) -> OtMaterial:
    ot_material = _obtener_ot_material(db, ot_material_id)
    ot_material.estado_sid_id = _estado_por_nombre(db, nombre_estado).id
    db.commit()
    db.refresh(ot_material)
    return ot_material


def marcar_completado(db: Session, ot_material_id: int) -> OtMaterial:
    return _cambiar_estado(db, ot_material_id, NOMBRE_COMPLETADO)


def marcar_pendiente(db: Session, ot_material_id: int) -> OtMaterial:
    return _cambiar_estado(db, ot_material_id, NOMBRE_PENDIENTE)


# --- SID de la devolución (trámite independiente del de la entrega) ---


def _cambiar_sid_devolucion(db: Session, ot_material_id: int, completado: bool) -> OtMaterial:
    ot_material = _obtener_ot_material(db, ot_material_id)
    ot_material.sid_devolucion_completado = completado
    db.commit()
    db.refresh(ot_material)
    return ot_material


def marcar_devolucion_completada(db: Session, ot_material_id: int) -> OtMaterial:
    return _cambiar_sid_devolucion(db, ot_material_id, True)


def marcar_devolucion_pendiente(db: Session, ot_material_id: int) -> OtMaterial:
    return _cambiar_sid_devolucion(db, ot_material_id, False)
