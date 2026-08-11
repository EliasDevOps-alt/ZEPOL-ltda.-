from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import consumo_controller
from ..database import get_db

router = APIRouter(prefix="/consumo", tags=["consumo"], dependencies=[Depends(security.get_current_usuario)])


@router.get("", response_model=List[schemas.ConsumoOut])
def consultar_consumo(numero_ot: Optional[str] = None, db: Session = Depends(get_db)):
    filas = consumo_controller.consultar_consumo(db, numero_ot)
    return [schemas.ConsumoOut(**fila) for fila in filas]
