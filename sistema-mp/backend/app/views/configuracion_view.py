from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import configuracion_controller
from ..database import get_db

router = APIRouter(
    prefix="/configuracion", tags=["configuracion"], dependencies=[Depends(security.get_current_usuario)]
)


def _config_out(db: Session) -> schemas.ConfiguracionExcelOut:
    return schemas.ConfiguracionExcelOut(
        ruta=configuracion_controller.obtener_ruta_excel(db),
        tiene_password=configuracion_controller.tiene_password_excel(db),
    )


@router.get("/excel-oc-mp", response_model=schemas.ConfiguracionExcelOut)
def obtener_config_excel(db: Session = Depends(get_db)):
    return _config_out(db)


@router.put("/excel-oc-mp", response_model=schemas.ConfiguracionExcelOut)
def actualizar_ruta_excel(data: schemas.ConfiguracionExcelIn, db: Session = Depends(get_db)):
    configuracion_controller.actualizar_ruta_excel(db, data.ruta)
    return _config_out(db)


@router.put("/excel-oc-mp/password", response_model=schemas.ConfiguracionExcelOut)
def actualizar_password_excel(data: schemas.ConfiguracionExcelPasswordIn, db: Session = Depends(get_db)):
    configuracion_controller.actualizar_password_excel(db, data.password)
    return _config_out(db)
