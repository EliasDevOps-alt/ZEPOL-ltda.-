from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..models import Configuracion
from ..services import excel_oc_mp
from ..services.excel_oc_mp import CLAVE_RUTA_EXCEL


def obtener_ruta_excel(db: Session) -> Optional[str]:
    return excel_oc_mp.obtener_ruta_configurada(db)


def actualizar_ruta_excel(db: Session, ruta: str) -> str:
    try:
        excel_oc_mp.validar_archivo(ruta)
    except ValueError as err:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(err))

    fila = db.get(Configuracion, CLAVE_RUTA_EXCEL)
    if fila is None:
        fila = Configuracion(clave=CLAVE_RUTA_EXCEL, valor=ruta)
        db.add(fila)
    else:
        fila.valor = ruta
    db.commit()
    return ruta
