from __future__ import annotations

from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import schemas
from ..models import Material


def listar_materiales(db: Session, q: Optional[str]) -> List[Material]:
    stmt = select(Material).order_by(Material.codigo_mp)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(Material.codigo_mp.ilike(like) | Material.descripcion.ilike(like))
    return db.scalars(stmt).all()


def crear_material(db: Session, data: schemas.MaterialCreate) -> Material:
    existente = db.scalar(select(Material).where(Material.codigo_mp.ilike(data.codigo_mp)))
    if existente is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ya existe un material con código {data.codigo_mp}")

    material = Material(
        codigo_mp=data.codigo_mp, descripcion=data.descripcion, unidad=data.unidad, es_tinta=data.es_tinta
    )
    db.add(material)
    db.commit()
    db.refresh(material)
    return material


def actualizar_material(db: Session, material_id: int, data: schemas.MaterialUpdate) -> Material:
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material no encontrado")

    if data.codigo_mp != material.codigo_mp:
        existente = db.scalar(select(Material).where(Material.codigo_mp.ilike(data.codigo_mp)))
        if existente is not None and existente.id != material.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ya existe un material con código {data.codigo_mp}")
        material.codigo_mp = data.codigo_mp

    material.descripcion = data.descripcion
    material.unidad = data.unidad
    material.activo = data.activo
    material.es_tinta = data.es_tinta
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
