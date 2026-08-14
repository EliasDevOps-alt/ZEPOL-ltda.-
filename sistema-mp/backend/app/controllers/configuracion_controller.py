from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..models import Configuracion
from ..services import excel_oc_mp
from ..services.excel_oc_mp import CLAVE_PASSWORD_EXCEL, CLAVE_RUTA_EXCEL


def obtener_ruta_excel(db: Session) -> Optional[str]:
    return excel_oc_mp.obtener_ruta_configurada(db)


def tiene_password_excel(db: Session) -> bool:
    return excel_oc_mp.obtener_password_configurada(db) is not None


def actualizar_ruta_excel(db: Session, ruta: str) -> str:
    try:
        excel_oc_mp.validar_archivo(ruta, excel_oc_mp.obtener_password_configurada(db))
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


def actualizar_password_excel(db: Session, password: str) -> None:
    """Guarda la contraseña del Excel OC-MP en Configuración — tiene
    prioridad sobre EXCEL_OC_MP_PASSWORD del .env (ver
    excel_oc_mp.obtener_password_configurada), para que el cliente pueda
    cambiarla sin depender de editar un archivo en el servidor. Si ya hay
    una ruta configurada, valida que la contraseña nueva realmente la abra
    antes de guardarla, para no guardar un error de tipeo sin darse cuenta."""
    ruta = excel_oc_mp.obtener_ruta_configurada(db)
    if ruta:
        try:
            excel_oc_mp.validar_archivo(ruta, password)
        except ValueError as err:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Esa contraseña no abre el archivo configurado: {err}")

    fila = db.get(Configuracion, CLAVE_PASSWORD_EXCEL)
    if fila is None:
        fila = Configuracion(clave=CLAVE_PASSWORD_EXCEL, valor=password)
        db.add(fila)
    else:
        fila.valor = password
    db.commit()
