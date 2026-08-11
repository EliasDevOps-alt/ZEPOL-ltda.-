from __future__ import annotations

from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import OrdenTrabajo


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
