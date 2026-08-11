from __future__ import annotations

from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import schemas
from ..models import Maquina, Proceso


def listar_maquinas(db: Session, q: Optional[str] = None) -> List[Maquina]:
    stmt = select(Maquina).join(Proceso).order_by(Proceso.nombre, Maquina.nombre)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(Maquina.nombre.ilike(like) | Proceso.nombre.ilike(like))
    return db.scalars(stmt).all()


def _validar_proceso(db: Session, proceso_id: int) -> None:
    if db.get(Proceso, proceso_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Proceso no encontrado")


def _validar_duplicado(db: Session, nombre: str, proceso_id: int, excluir_id: Optional[int] = None) -> None:
    stmt = select(Maquina).where(Maquina.nombre == nombre, Maquina.proceso_id == proceso_id)
    if excluir_id is not None:
        stmt = stmt.where(Maquina.id != excluir_id)
    if db.scalar(stmt) is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ya existe la máquina {nombre} en ese proceso")


def crear_maquina(db: Session, data: schemas.MaquinaCreate) -> Maquina:
    _validar_proceso(db, data.proceso_id)
    _validar_duplicado(db, data.nombre, data.proceso_id)

    maquina = Maquina(nombre=data.nombre, proceso_id=data.proceso_id)
    db.add(maquina)
    db.commit()
    db.refresh(maquina)
    return maquina


def actualizar_maquina(db: Session, maquina_id: int, data: schemas.MaquinaUpdate) -> Maquina:
    maquina = db.get(Maquina, maquina_id)
    if maquina is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Máquina no encontrada")

    _validar_proceso(db, data.proceso_id)
    _validar_duplicado(db, data.nombre, data.proceso_id, excluir_id=maquina_id)

    maquina.nombre = data.nombre
    maquina.proceso_id = data.proceso_id
    maquina.activo = data.activo
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No se puede cambiar el proceso: esta máquina ya tiene OT registradas en su proceso actual.",
        )
    db.refresh(maquina)
    return maquina


def eliminar_maquina(db: Session, maquina_id: int) -> None:
    maquina = db.get(Maquina, maquina_id)
    if maquina is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Máquina no encontrada")

    db.delete(maquina)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No se puede eliminar: esta máquina ya tiene OT registradas. Desactívala en su lugar.",
        )
