from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import maquinas_controller
from ..database import get_db
from ..models import Maquina

router = APIRouter(prefix="/maquinas", tags=["maquinas"], dependencies=[Depends(security.get_current_usuario)])


def _serializar(maquina: Maquina) -> schemas.MaquinaAdminOut:
    return schemas.MaquinaAdminOut(
        id=maquina.id,
        nombre=maquina.nombre,
        proceso_id=maquina.proceso_id,
        proceso=maquina.proceso.nombre,
        activo=maquina.activo,
    )


@router.get("", response_model=List[schemas.MaquinaAdminOut])
def listar_maquinas(q: Optional[str] = None, db: Session = Depends(get_db)):
    maquinas = maquinas_controller.listar_maquinas(db, q)
    return [_serializar(m) for m in maquinas]


@router.post("", response_model=schemas.MaquinaAdminOut, status_code=status.HTTP_201_CREATED)
def crear_maquina(data: schemas.MaquinaCreate, db: Session = Depends(get_db)):
    maquina = maquinas_controller.crear_maquina(db, data)
    return _serializar(maquina)


@router.put("/{maquina_id}", response_model=schemas.MaquinaAdminOut)
def actualizar_maquina(maquina_id: int, data: schemas.MaquinaUpdate, db: Session = Depends(get_db)):
    maquina = maquinas_controller.actualizar_maquina(db, maquina_id, data)
    return _serializar(maquina)


@router.delete("/{maquina_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_maquina(maquina_id: int, db: Session = Depends(get_db)):
    maquinas_controller.eliminar_maquina(db, maquina_id)
