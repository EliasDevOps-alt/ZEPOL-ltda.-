from __future__ import annotations

from typing import List

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..models import Entrega, EntregaBobina, OrdenTrabajo, OtMaterial, OtProceso, Usuario


def registrar_entrega(db: Session, usuario: Usuario, data: schemas.EntregaCreate) -> Entrega:
    ot_material = db.get(OtMaterial, data.ot_material_id)
    if ot_material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido de material no encontrado")

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
