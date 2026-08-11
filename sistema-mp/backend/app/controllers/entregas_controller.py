from __future__ import annotations

from typing import List

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..models import (
    Entrega,
    EntregaBobina,
    EstadoSid,
    Maquina,
    Material,
    OrdenTrabajo,
    OtMaterial,
    OtProceso,
    Usuario,
)


def _estado_pendiente(db: Session) -> EstadoSid:
    estado = db.scalar(select(EstadoSid).where(EstadoSid.nombre == "PENDIENTE"))
    if estado is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Falta sembrar estados_sid")
    return estado


def _obtener_o_crear_pedido(
    db: Session, data: schemas.EntregaCreate, usuario: Usuario
) -> OtMaterial:
    """Encuentra el pedido de material (OT + proceso + material) o lo crea si es
    la primera vez que se entrega este material para esta OT en este proceso."""
    maquina = db.get(Maquina, data.maquina_id)
    if maquina is None or maquina.proceso_id != data.proceso_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esa máquina no pertenece al proceso seleccionado")

    material = db.get(Material, data.material_id)
    if material is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Material no encontrado")

    ot = db.scalar(select(OrdenTrabajo).where(OrdenTrabajo.numero_ot == data.numero_ot))
    if ot is None:
        ot = OrdenTrabajo(numero_ot=data.numero_ot, cliente=data.cliente, diseno=data.diseno)
        db.add(ot)
        db.flush()

    ot_proceso = db.scalar(
        select(OtProceso).where(
            OtProceso.ot_id == ot.id,
            OtProceso.proceso_id == data.proceso_id,
            OtProceso.maquina_id == data.maquina_id,
        )
    )
    if ot_proceso is None:
        ot_proceso = OtProceso(ot_id=ot.id, proceso_id=data.proceso_id, maquina_id=data.maquina_id)
        db.add(ot_proceso)
        db.flush()

    ot_material = db.scalar(
        select(OtMaterial).where(
            OtMaterial.ot_proceso_id == ot_proceso.id,
            OtMaterial.material_id == data.material_id,
        )
    )
    if ot_material is None:
        ot_material = OtMaterial(
            ot_proceso_id=ot_proceso.id,
            proceso_id=data.proceso_id,
            material_id=data.material_id,
            cantidad_requerida=data.cantidad_requerida,
            estado_sid_id=_estado_pendiente(db).id,
        )
        db.add(ot_material)
        db.flush()

    return ot_material


def registrar_entrega(db: Session, usuario: Usuario, data: schemas.EntregaCreate) -> Entrega:
    ot_material = _obtener_o_crear_pedido(db, data, usuario)

    entrega = Entrega(ot_material_id=ot_material.id, usuario_id=usuario.id, fecha=data.fecha)
    entrega.bobinas = [EntregaBobina(numero=i + 1, cantidad=c) for i, c in enumerate(data.bobinas)]
    db.add(entrega)
    db.commit()
    db.refresh(entrega)
    return entrega


def listar_entregas_por_ot(db: Session, numero_ot: str) -> List[Entrega]:
    return db.scalars(
        select(Entrega)
        .join(OtMaterial, OtMaterial.id == Entrega.ot_material_id)
        .join(OtProceso, OtProceso.id == OtMaterial.ot_proceso_id)
        .join(OrdenTrabajo, OrdenTrabajo.id == OtProceso.ot_id)
        .where(OrdenTrabajo.numero_ot == numero_ot)
        .order_by(Entrega.id)
    ).all()
