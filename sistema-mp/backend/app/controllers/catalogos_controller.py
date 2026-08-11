from __future__ import annotations

from typing import List

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import EstadoSid, Maquina, Material, Proceso


def listar_procesos(db: Session) -> List[Proceso]:
    return db.scalars(select(Proceso).where(Proceso.activo.is_(True)).order_by(Proceso.nombre)).all()


def listar_maquinas(db: Session, proceso_id: int) -> List[Maquina]:
    return db.scalars(
        select(Maquina)
        .where(Maquina.proceso_id == proceso_id, Maquina.activo.is_(True))
        .order_by(Maquina.nombre)
    ).all()


def listar_materiales(db: Session) -> List[Material]:
    """Cualquier material activo puede pedirse en cualquier proceso (confirmado
    por planta: no hay restricción real proceso-material)."""
    return db.scalars(select(Material).where(Material.activo.is_(True)).order_by(Material.codigo_mp)).all()


def listar_estados_sid(db: Session) -> List[EstadoSid]:
    return db.scalars(select(EstadoSid).order_by(EstadoSid.id)).all()
