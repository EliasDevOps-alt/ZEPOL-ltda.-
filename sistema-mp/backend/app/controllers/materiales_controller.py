from __future__ import annotations

from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import schemas
from ..models import Material, MaterialProceso


def _set_procesos(db: Session, material_id: int, proceso_ids: List[int]) -> None:
    db.query(MaterialProceso).filter(MaterialProceso.material_id == material_id).delete()
    for proceso_id in proceso_ids:
        db.add(MaterialProceso(material_id=material_id, proceso_id=proceso_id))


def listar_materiales(db: Session, q: Optional[str], sin_proceso: bool) -> List[Material]:
    stmt = select(Material).order_by(Material.codigo_mp)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(Material.codigo_mp.ilike(like) | Material.descripcion.ilike(like))
    materiales = db.scalars(stmt).all()

    if sin_proceso:
        materiales = [m for m in materiales if not m.procesos]
    return materiales


def crear_material(db: Session, data: schemas.MaterialCreate) -> Material:
    existente = db.scalar(select(Material).where(Material.codigo_mp == data.codigo_mp))
    if existente is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ya existe un material con código {data.codigo_mp}")

    material = Material(codigo_mp=data.codigo_mp, descripcion=data.descripcion, unidad=data.unidad)
    db.add(material)
    db.flush()
    _set_procesos(db, material.id, data.procesos)
    db.commit()
    db.refresh(material)
    return material


def actualizar_material(db: Session, material_id: int, data: schemas.MaterialUpdate) -> Material:
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material no encontrado")

    material.descripcion = data.descripcion
    material.unidad = data.unidad
    material.activo = data.activo
    _set_procesos(db, material.id, data.procesos)
    db.commit()
    db.refresh(material)
    return material


def eliminar_material(db: Session, material_id: int) -> None:
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material no encontrado")

    db.delete(material)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No se puede eliminar: este material ya tiene entregas registradas. Desactívalo en su lugar.",
        )
