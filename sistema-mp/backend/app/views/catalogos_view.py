from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import catalogos_controller
from ..database import get_db

router = APIRouter(prefix="/catalogos", tags=["catalogos"], dependencies=[Depends(security.get_current_usuario)])


@router.get("/procesos", response_model=List[schemas.ProcesoOut])
def listar_procesos(db: Session = Depends(get_db)):
    return catalogos_controller.listar_procesos(db)


@router.get("/maquinas", response_model=List[schemas.MaquinaOut])
def listar_maquinas(proceso_id: int, db: Session = Depends(get_db)):
    return catalogos_controller.listar_maquinas(db, proceso_id)


@router.get("/materiales", response_model=List[schemas.MaterialOut])
def listar_materiales(proceso_id: int, db: Session = Depends(get_db)):
    return catalogos_controller.listar_materiales_por_proceso(db, proceso_id)


@router.get("/estados-sid", response_model=List[schemas.EstadoSidOut])
def listar_estados_sid(db: Session = Depends(get_db)):
    return catalogos_controller.listar_estados_sid(db)
