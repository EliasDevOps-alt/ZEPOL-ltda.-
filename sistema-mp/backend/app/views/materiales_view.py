from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import materiales_controller
from ..database import get_db
from ..models import Material

router = APIRouter(prefix="/materiales", tags=["materiales"], dependencies=[Depends(security.requiere_modulo("materiales"))])


def _serializar(material: Material) -> schemas.MaterialAdminOut:
    return schemas.MaterialAdminOut(
        id=material.id,
        codigo_mp=material.codigo_mp,
        descripcion=material.descripcion,
        unidad=material.unidad,
        activo=material.activo,
        es_tinta=material.es_tinta,
    )


@router.get("", response_model=List[schemas.MaterialAdminOut])
def listar_materiales(q: Optional[str] = None, db: Session = Depends(get_db)):
    materiales = materiales_controller.listar_materiales(db, q)
    return [_serializar(m) for m in materiales]


@router.post("", response_model=schemas.MaterialAdminOut, status_code=status.HTTP_201_CREATED)
def crear_material(data: schemas.MaterialCreate, db: Session = Depends(get_db)):
    material = materiales_controller.crear_material(db, data)
    return _serializar(material)


@router.put("/{material_id}", response_model=schemas.MaterialAdminOut)
def actualizar_material(material_id: int, data: schemas.MaterialUpdate, db: Session = Depends(get_db)):
    material = materiales_controller.actualizar_material(db, material_id, data)
    return _serializar(material)


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_material(material_id: int, db: Session = Depends(get_db)):
    materiales_controller.eliminar_material(db, material_id)
