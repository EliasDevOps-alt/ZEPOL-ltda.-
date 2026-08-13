from __future__ import annotations

import io
import logging
import os
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import msoffcrypto
import openpyxl
from sqlalchemy.orm import Session

from ..models import Configuracion

logger = logging.getLogger(__name__)

HOJA = "oc mp"
FILA_DATOS_INICIO = 10
CLAVE_RUTA_EXCEL = "ruta_excel_oc_mp"

# Columnas 1-indexadas de la hoja "oc mp" (fila de encabezado real = fila 8).
COL_FECHA_SEGUIMIENTO = 1
COL_ALM = 2
COL_SO = 3
COL_OT = 4
COLS_MATERIALES = [(5, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16)]  # (codigo, cantidad)
COL_TOTAL = 17
COL_STATUS_ENTREGA_MP = 18
COL_TIPO_TRABAJO = 19
COL_INDICADOR = 20
COL_CLIENTE = 21
COL_VENDEDOR = 22
COL_CIUDAD = 23
COL_FECHA_PEDIDO = 24
COL_FECHA_ENTREGA = 25
COL_DESCRIPCION = 26
COL_CODIGO_PRODUCTO = 27
COL_TOTAL_OT = 28
COL_ENTREGA_MES = 29
COL_MEDIDA = 30
COL_EQUIVALENCIA_KG = 31
COL_PU_USD = 32
COL_PT_USD = 33
COL_FACTURA_CLISES = 34
COL_PRECIO_CLISE_USD = 35
COL_PRECIO_TOTAL_PEDIDO_USD = 36


def obtener_ruta_configurada(db: Session) -> Optional[str]:
    fila = db.get(Configuracion, CLAVE_RUTA_EXCEL)
    return fila.valor if fila and fila.valor else None


def _valor(row: tuple, col_1indexado: int) -> Any:
    return row[col_1indexado - 1]


def _texto(v: Any) -> Optional[str]:
    if v is None:
        return None
    texto = str(v).strip()
    return texto or None


def _fecha(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


def _numero(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _coincide_ot(valor_celda: Any, objetivo: str) -> bool:
    if valor_celda is None:
        return False
    if isinstance(valor_celda, (int, float)):
        try:
            return str(int(valor_celda)) == objetivo
        except (TypeError, ValueError):
            return False
    return str(valor_celda).strip() == objetivo


def _abrir_hoja(ruta: str) -> Optional[Any]:
    """Desencripta (si aplica) y abre la hoja 'oc mp' en modo solo-lectura.
    Nunca escribe nada a disco."""
    password = os.environ.get("EXCEL_OC_MP_PASSWORD")

    try:
        with open(ruta, "rb") as f:
            office_file = msoffcrypto.OfficeFile(f)
            buffer = io.BytesIO()
            if office_file.is_encrypted():
                office_file.load_key(password=password)
                office_file.decrypt(buffer)
            else:
                buffer.write(f.read())
    except Exception:
        logger.exception("No se pudo abrir/desencriptar el Excel OC-MP en %s", ruta)
        return None

    try:
        wb = openpyxl.load_workbook(buffer, data_only=True, read_only=True)
        return wb[HOJA]
    except Exception:
        logger.exception("No se pudo leer la hoja '%s' del Excel OC-MP", HOJA)
        return None


def leer_oc_mp(db: Session, numero_ot: str) -> Optional[Dict[str, Any]]:
    """Busca numero_ot en la hoja 'oc mp' y devuelve sus datos, o None si no
    se encuentra la OT o el archivo no está accesible."""
    ruta = obtener_ruta_configurada(db)
    if not ruta:
        logger.warning("No hay ruta configurada para el Excel OC-MP")
        return None

    ws = _abrir_hoja(ruta)
    if ws is None:
        return None

    objetivo = numero_ot.strip()
    for row in ws.iter_rows(min_row=FILA_DATOS_INICIO, values_only=True):
        if not _coincide_ot(_valor(row, COL_OT), objetivo):
            continue

        materiales: List[Dict[str, Any]] = []
        for col_codigo, col_cantidad in COLS_MATERIALES:
            codigo = _texto(_valor(row, col_codigo))
            if codigo:
                materiales.append(
                    {"codigo_mp": codigo, "cantidad_requerida": _numero(_valor(row, col_cantidad))}
                )

        return {
            "numero_ot": objetivo,
            "fecha_seguimiento_mp": _fecha(_valor(row, COL_FECHA_SEGUIMIENTO)),
            "alm": _texto(_valor(row, COL_ALM)),
            "so": _texto(_valor(row, COL_SO)),
            "materiales": materiales,
            "total": _numero(_valor(row, COL_TOTAL)),
            "status_entrega_mp": _texto(_valor(row, COL_STATUS_ENTREGA_MP)),
            "tipo_trabajo": _texto(_valor(row, COL_TIPO_TRABAJO)),
            "indicador": _texto(_valor(row, COL_INDICADOR)),
            "cliente": _texto(_valor(row, COL_CLIENTE)),
            "vendedor": _texto(_valor(row, COL_VENDEDOR)),
            "ciudad": _texto(_valor(row, COL_CIUDAD)),
            "fecha_pedido": _fecha(_valor(row, COL_FECHA_PEDIDO)),
            "fecha_entrega": _fecha(_valor(row, COL_FECHA_ENTREGA)),
            "descripcion_producto": _texto(_valor(row, COL_DESCRIPCION)),
            "codigo_producto": _texto(_valor(row, COL_CODIGO_PRODUCTO)),
            "total_ot": _numero(_valor(row, COL_TOTAL_OT)),
            "entrega_mes": _numero(_valor(row, COL_ENTREGA_MES)),
            "medida": _texto(_valor(row, COL_MEDIDA)),
            "equivalencia_kg": _numero(_valor(row, COL_EQUIVALENCIA_KG)),
            "pu_usd": _numero(_valor(row, COL_PU_USD)),
            "pt_usd": _numero(_valor(row, COL_PT_USD)),
            "factura_clises": _texto(_valor(row, COL_FACTURA_CLISES)),
            "precio_clise_usd": _numero(_valor(row, COL_PRECIO_CLISE_USD)),
            "precio_total_pedido_usd": _numero(_valor(row, COL_PRECIO_TOTAL_PEDIDO_USD)),
        }

    return None


def validar_archivo(ruta: str) -> None:
    """Levanta una excepción con un mensaje claro si la ruta no sirve para
    leer 'oc mp' (usado al guardar una nueva ruta configurada)."""
    if not os.path.isfile(ruta):
        raise ValueError(f"No existe un archivo en: {ruta}")
    ws = _abrir_hoja(ruta)
    if ws is None:
        raise ValueError("No se pudo abrir el archivo (revisa la contraseña o el formato)")
