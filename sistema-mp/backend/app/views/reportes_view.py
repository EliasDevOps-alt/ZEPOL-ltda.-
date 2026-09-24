from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import reportes_controller
from ..database import get_db

# Solo lectura, y sin requiere_modulo a propósito: igual que /consumo y los
# catálogos, este router no deja actuar sobre nada, únicamente mira datos que
# el resto de las pantallas ya muestra.
router = APIRouter(
    prefix="/reportes",
    tags=["reportes"],
    dependencies=[Depends(security.get_current_usuario)],
)


@router.get("/ots-terminadas", response_model=List[schemas.OtTerminadaOut])
def listar_ots_terminadas(
    desde: Optional[date] = None,
    hasta: Optional[date] = None,
    db: Session = Depends(get_db),
):
    return reportes_controller.listar_ots_terminadas(db, desde, hasta)
