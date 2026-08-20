from __future__ import annotations

from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..models import Entrega, EntregaBobina, Material, OrdenTrabajo, OtMaterial, OtProceso, Usuario


def registrar_entrega(db: Session, usuario: Usuario, data: schemas.EntregaCreate) -> Entrega:
    ot_material = db.get(OtMaterial, data.ot_material_id)
    if ot_material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido de material no encontrado")

    # Sin material_id explícito, se entrega el material del pedido tal cual
    # (el caso normal, sin sustitución).
    material_id = data.material_id if data.material_id is not None else ot_material.material_id
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material no encontrado")

    entrega = Entrega(
        ot_material_id=ot_material.id,
        material_id=material.id,
        usuario_id=usuario.id,
        fecha=data.fecha,
        observacion=data.observacion,
    )
    entrega.bobinas = [EntregaBobina(numero=i + 1, cantidad=c) for i, c in enumerate(data.bobinas)]
    db.add(entrega)
    db.commit()
    db.refresh(entrega)
    return entrega


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
