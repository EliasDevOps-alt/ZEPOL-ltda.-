from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import configuracion_controller
from ..database import get_db

router = APIRouter(
    prefix="/configuracion", tags=["configuracion"], dependencies=[Depends(security.get_current_usuario)]
)


@router.get("/excel-oc-mp", response_model=schemas.ConfiguracionExcelOut)
def obtener_ruta_excel(db: Session = Depends(get_db)):
    return schemas.ConfiguracionExcelOut(ruta=configuracion_controller.obtener_ruta_excel(db))


@router.put("/excel-oc-mp", response_model=schemas.ConfiguracionExcelOut)
def actualizar_ruta_excel(data: schemas.ConfiguracionExcelIn, db: Session = Depends(get_db)):
    ruta = configuracion_controller.actualizar_ruta_excel(db, data.ruta)
    return schemas.ConfiguracionExcelOut(ruta=ruta)
