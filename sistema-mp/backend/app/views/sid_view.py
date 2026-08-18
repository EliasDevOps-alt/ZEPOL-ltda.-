from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import sid_controller
from ..database import get_db
from ..models import EstadoSid

router = APIRouter(prefix="/ot-materiales", tags=["sid"], dependencies=[Depends(security.requiere_modulo("registro_sid"))])


def _resultado(db: Session, ot_material_id: int, estado_sid_id: int) -> schemas.EstadoSidUpdateOut:
    estado = db.get(EstadoSid, estado_sid_id)
    return schemas.EstadoSidUpdateOut(ot_material_id=ot_material_id, estado_sid=estado.nombre if estado else "")


@router.post("/{ot_material_id}/sid/completado", response_model=schemas.EstadoSidUpdateOut)
def marcar_completado(ot_material_id: int, db: Session = Depends(get_db)):
    ot_material = sid_controller.marcar_completado(db, ot_material_id)
    return _resultado(db, ot_material.id, ot_material.estado_sid_id)


@router.post("/{ot_material_id}/sid/pendiente", response_model=schemas.EstadoSidUpdateOut)
def marcar_pendiente(ot_material_id: int, db: Session = Depends(get_db)):
    ot_material = sid_controller.marcar_pendiente(db, ot_material_id)
    return _resultado(db, ot_material.id, ot_material.estado_sid_id)


@router.post("/{ot_material_id}/sid-devolucion/completado", response_model=schemas.SidDevolucionUpdateOut)
def marcar_devolucion_completada(ot_material_id: int, db: Session = Depends(get_db)):
    ot_material = sid_controller.marcar_devolucion_completada(db, ot_material_id)
    return schemas.SidDevolucionUpdateOut(
        ot_material_id=ot_material.id, sid_devolucion_completado=ot_material.sid_devolucion_completado
    )


@router.post("/{ot_material_id}/sid-devolucion/pendiente", response_model=schemas.SidDevolucionUpdateOut)
def marcar_devolucion_pendiente(ot_material_id: int, db: Session = Depends(get_db)):
    ot_material = sid_controller.marcar_devolucion_pendiente(db, ot_material_id)
    return schemas.SidDevolucionUpdateOut(
        ot_material_id=ot_material.id, sid_devolucion_completado=ot_material.sid_devolucion_completado
    )
