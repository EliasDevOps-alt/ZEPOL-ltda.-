from __future__ import annotations

from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..models import EstadoSid, Maquina, Material, OrdenTrabajo, OtMaterial, OtProceso


def listar_ordenes(db: Session, q: Optional[str], limite: int = 100) -> List[OrdenTrabajo]:
    stmt = select(OrdenTrabajo)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            OrdenTrabajo.numero_ot.ilike(like)
            | OrdenTrabajo.cliente.ilike(like)
            | OrdenTrabajo.diseno.ilike(like)
        )
    stmt = stmt.order_by(OrdenTrabajo.fecha_creacion.desc()).limit(limite)
    return db.scalars(stmt).all()


def _estado_pendiente(db: Session) -> EstadoSid:
    estado = db.scalar(select(EstadoSid).where(EstadoSid.nombre == "PENDIENTE"))
    if estado is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Falta sembrar estados_sid")
    return estado


def guardar_detalle(db: Session, data: schemas.OtDetalleCreate) -> OrdenTrabajo:
    """Crea o amplía la OT: fija cliente/diseño (únicos para toda la OT) y
    agrega procesos (con su máquina) y, dentro de cada uno, los materiales
    pedidos con su cantidad. Si el proceso o el material ya existían para
    esta OT, actualiza la cantidad en vez de duplicar — así esta misma
    acción sirve para crear la OT o para agregarle más procesos/materiales
    después."""

    ot = db.scalar(select(OrdenTrabajo).where(OrdenTrabajo.numero_ot == data.numero_ot))
    if ot is None:
        ot = OrdenTrabajo(numero_ot=data.numero_ot, cliente=data.cliente, diseno=data.diseno)
        db.add(ot)
        db.flush()
    else:
        if data.cliente:
            ot.cliente = data.cliente
        if data.diseno:
            ot.diseno = data.diseno

    for proceso_in in data.procesos:
        maquina = db.get(Maquina, proceso_in.maquina_id)
        if maquina is None or maquina.proceso_id != proceso_in.proceso_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esa máquina no pertenece al proceso seleccionado")

        ot_proceso = db.scalar(
            select(OtProceso).where(
                OtProceso.ot_id == ot.id,
                OtProceso.proceso_id == proceso_in.proceso_id,
                OtProceso.maquina_id == proceso_in.maquina_id,
            )
        )
        if ot_proceso is None:
            ot_proceso = OtProceso(ot_id=ot.id, proceso_id=proceso_in.proceso_id, maquina_id=proceso_in.maquina_id)
            db.add(ot_proceso)
            db.flush()

        for material_in in proceso_in.materiales:
            material = db.get(Material, material_in.material_id)
            if material is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Material no encontrado")

            ot_material = db.scalar(
                select(OtMaterial).where(
                    OtMaterial.ot_proceso_id == ot_proceso.id,
                    OtMaterial.material_id == material_in.material_id,
                )
            )
            if ot_material is None:
                db.add(
                    OtMaterial(
                        ot_proceso_id=ot_proceso.id,
                        proceso_id=proceso_in.proceso_id,
                        material_id=material_in.material_id,
                        cantidad_requerida=material_in.cantidad_requerida,
                        estado_sid_id=_estado_pendiente(db).id,
                    )
                )
            elif material_in.cantidad_requerida is not None:
                ot_material.cantidad_requerida = material_in.cantidad_requerida

    db.commit()
    db.refresh(ot)
    return ot


def obtener_detalle(db: Session, numero_ot: str) -> Optional[OrdenTrabajo]:
    return db.scalar(select(OrdenTrabajo).where(OrdenTrabajo.numero_ot == numero_ot))
