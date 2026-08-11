from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import ordenes_controller
from ..database import get_db

router = APIRouter(prefix="/ordenes-trabajo", tags=["ordenes-trabajo"], dependencies=[Depends(security.get_current_usuario)])


@router.get("", response_model=List[schemas.OrdenTrabajoOut])
def listar_ordenes(q: Optional[str] = None, db: Session = Depends(get_db)):
    return ordenes_controller.listar_ordenes(db, q)
