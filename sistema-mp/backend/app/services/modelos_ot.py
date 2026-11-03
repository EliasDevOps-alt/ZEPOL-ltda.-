"""De qué OT es cada objeto del modelo (para los avisos de cambios, ver eventos.py)."""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ..models import (
    Devolucion,
    DevolucionBobina,
    Entrega,
    EntregaBobina,
    OrdenTrabajo,
    OtMaterial,
    OtMaterialPendiente,
    OtProceso,
)

RELEVANTES = (
    OrdenTrabajo,
    OtProceso,
    OtMaterial,
    OtMaterialPendiente,
    Entrega,
    EntregaBobina,
    Devolucion,
    DevolucionBobina,
)


def _ot_de_proceso(session: Session, proceso: Optional[OtProceso]) -> Optional[str]:
    if proceso is None:
        return None
    ot = proceso.ot or (session.get(OrdenTrabajo, proceso.ot_id) if proceso.ot_id else None)
    return ot.numero_ot if ot else None


def _ot_de_pedido(session: Session, pedido: Optional[OtMaterial]) -> Optional[str]:
    if pedido is None:
        return None
    proceso = pedido.ot_proceso or (
        session.get(OtProceso, pedido.ot_proceso_id) if pedido.ot_proceso_id else None
    )
    return _ot_de_proceso(session, proceso)


def _ot_de_pendiente(session: Session, pendiente: Optional[OtMaterialPendiente]) -> Optional[str]:
    if pendiente is None:
        return None
    ot = pendiente.ot or (session.get(OrdenTrabajo, pendiente.ot_id) if pendiente.ot_id else None)
    return ot.numero_ot if ot else None


def numero_ot_de(session: Session, obj) -> Optional[str]:
    if isinstance(obj, OrdenTrabajo):
        return obj.numero_ot
    if isinstance(obj, OtProceso):
        return _ot_de_proceso(session, obj)
    if isinstance(obj, OtMaterial):
        return _ot_de_pedido(session, obj)
    if isinstance(obj, OtMaterialPendiente):
        return _ot_de_pendiente(session, obj)
    if isinstance(obj, EntregaBobina):
        obj = obj.entrega
        if obj is None:
            return None
    if isinstance(obj, DevolucionBobina):
        obj = obj.devolucion
        if obj is None:
            return None
    if isinstance(obj, Entrega):
        pedido = obj.ot_material or (
            session.get(OtMaterial, obj.ot_material_id) if obj.ot_material_id else None
        )
        return _ot_de_pedido(session, pedido)
    if isinstance(obj, Devolucion):
        pedido = obj.ot_material or (
            session.get(OtMaterial, obj.ot_material_id) if obj.ot_material_id else None
        )
        if pedido is not None:
            return _ot_de_pedido(session, pedido)
        pendiente = obj.ot_material_pendiente or (
            session.get(OtMaterialPendiente, obj.ot_material_pendiente_id)
            if obj.ot_material_pendiente_id
            else None
        )
        return _ot_de_pendiente(session, pendiente)
    return None
