from __future__ import annotations

import io
import logging
import os
import time
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
CLAVE_PASSWORD_EXCEL = "excel_oc_mp_password"

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

# Mapeo campo comercial -> columna, usado solo al escribir (ver
# escribir_oc_mp). COL_TOTAL y COL_PRECIO_TOTAL_PEDIDO_USD quedan afuera a
# propósito: en la plantilla real esas dos columnas son fórmulas
# (`=F+H+J+L+N+P` y `=AI+AG`) precargadas fila por fila hasta bien más allá
# de la última fila usada — escribirles un valor destruiría la fórmula.
CAMPOS_A_COLUMNAS = {
    "fecha_seguimiento_mp": COL_FECHA_SEGUIMIENTO,
    "alm": COL_ALM,
    "so": COL_SO,
    "status_entrega_mp": COL_STATUS_ENTREGA_MP,
    "tipo_trabajo": COL_TIPO_TRABAJO,
    "indicador": COL_INDICADOR,
    "vendedor": COL_VENDEDOR,
    "ciudad": COL_CIUDAD,
    "fecha_pedido": COL_FECHA_PEDIDO,
    "fecha_entrega": COL_FECHA_ENTREGA,
    "descripcion_producto": COL_DESCRIPCION,
    "codigo_producto": COL_CODIGO_PRODUCTO,
    "total_ot": COL_TOTAL_OT,
    "entrega_mes": COL_ENTREGA_MES,
    "medida": COL_MEDIDA,
    "equivalencia_kg": COL_EQUIVALENCIA_KG,
    "pu_usd": COL_PU_USD,
    "pt_usd": COL_PT_USD,
    "factura_clises": COL_FACTURA_CLISES,
    "precio_clise_usd": COL_PRECIO_CLISE_USD,
}


class ExcelBloqueadoError(Exception):
    """El archivo está abierto/en uso en otra sesión — reintentable."""


class ExcelEscrituraError(Exception):
    """Fallo no reintentable al escribir (demasiados materiales, ruta no
    configurada, etc.)."""


def obtener_ruta_configurada(db: Session) -> Optional[str]:
    fila = db.get(Configuracion, CLAVE_RUTA_EXCEL)
    return fila.valor if fila and fila.valor else None


def obtener_password_configurada(db: Session) -> Optional[str]:
    """La contraseña guardada en Configuración (editable desde la UI, para
    cuando el cliente la cambia) tiene prioridad; si no hay ninguna guardada
    todavía, cae al valor de EXCEL_OC_MP_PASSWORD en .env — así una
    instalación existente sigue funcionando sin tener que migrar nada."""
    fila = db.get(Configuracion, CLAVE_PASSWORD_EXCEL)
    if fila and fila.valor:
        return fila.valor
    return os.environ.get("EXCEL_OC_MP_PASSWORD")


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


def _abrir_hoja(ruta: str, password: Optional[str]) -> Optional[Any]:
    """Desencripta (si aplica) y abre la hoja 'oc mp' en modo solo-lectura.
    Nunca escribe nada a disco."""
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

    ws = _abrir_hoja(ruta, obtener_password_configurada(db))
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


def validar_archivo(ruta: str, password: Optional[str]) -> None:
    """Levanta una excepción con un mensaje claro si la ruta no sirve para
    leer 'oc mp' (usado al guardar una nueva ruta o una nueva contraseña
    configurada)."""
    if not os.path.isfile(ruta):
        raise ValueError(f"No existe un archivo en: {ruta}")
    ws = _abrir_hoja(ruta, password)
    if ws is None:
        raise ValueError("No se pudo abrir el archivo (revisa la contraseña o el formato)")


def _valor_com(v: Any) -> Any:
    """datetime.date (no datetime.datetime) no siempre se marshalla bien
    hacia COM — se normaliza a datetime para que Excel lo reciba como fecha."""
    if isinstance(v, date) and not isinstance(v, datetime):
        return datetime.combine(v, datetime.min.time())
    return v


FILA_BUSQUEDA_MAX = FILA_DATOS_INICIO + 4000
_RPC_E_SERVERCALL_RETRYLATER = -2147418111


def _con_reintentos(fn: Any, intentos: int = 12, espera: float = 2.0) -> Any:
    """Reintenta una llamada COM que falla con RPC_E_SERVERCALL_RETRYLATER
    ('la llamada fue rechazada por el destinatario') — pasa cuando Excel
    está ocupado, típicamente recalculando un libro grande justo después de
    abrirlo; no significa que el archivo esté bloqueado por otra sesión."""
    for intento in range(intentos):
        try:
            return fn()
        except Exception as exc:
            args = getattr(exc, "args", ())
            if not args or args[0] != _RPC_E_SERVERCALL_RETRYLATER or intento == intentos - 1:
                raise
            time.sleep(espera)


def _primera_fila_vacia(ws: Any) -> int:
    """Primera fila desde FILA_DATOS_INICIO cuya columna OT está vacía. Lee
    el rango completo en una sola llamada COM (batch) en vez de celda por
    celda — con ~2000+ filas ya usadas, iterar con Cells() una por una es
    lento de verdad (cada llamada es un round-trip COM aparte)."""
    rango = ws.Range(ws.Cells(FILA_DATOS_INICIO, COL_OT), ws.Cells(FILA_BUSQUEDA_MAX, COL_OT))
    valores = rango.Value  # tupla de tuplas de 1 elemento, una por fila
    for i, (v,) in enumerate(valores):
        if v in (None, ""):
            return FILA_DATOS_INICIO + i
    raise ExcelEscrituraError(
        f"No se encontró una fila vacía en '{HOJA}' entre las filas {FILA_DATOS_INICIO} y {FILA_BUSQUEDA_MAX}"
    )


def _buscar_fila_por_ot(ws: Any, numero_ot: str) -> Optional[int]:
    """Fila donde ya está esta OT en 'oc mp', si existe — para actualizarla
    en vez de agregar una fila duplicada. Mismo batch-read de
    _primera_fila_vacia, por la misma razón de performance (una sola llamada
    COM para todo el rango en vez de una por celda)."""
    rango = ws.Range(ws.Cells(FILA_DATOS_INICIO, COL_OT), ws.Cells(FILA_BUSQUEDA_MAX, COL_OT))
    valores = rango.Value
    objetivo = numero_ot.strip()
    for i, (v,) in enumerate(valores):
        if _coincide_ot(v, objetivo):
            return FILA_DATOS_INICIO + i
    return None


def escribir_oc_mp(
    db: Session,
    numero_ot: str,
    cliente: Optional[str],
    campos: Dict[str, Any],
    materiales: List[Dict[str, Any]],
) -> None:
    """Escribe esta OT en 'oc mp': si ya tiene una fila (la OT vino de Excel
    originalmente, o ya se sincronizó antes) la ACTUALIZA; si no, agrega una
    fila nueva. Se llama tanto al crear la OT en sistema-mp como cada vez que
    se le agregan materiales o se editan sus datos comerciales después — así
    el Excel no queda congelado en el estado del momento de la creación.
    Maneja el Excel real vía COM (win32com) en vez de reescribir el .xlsx con
    openpyxl, para no arriesgar las fórmulas de 'oc resumen'/'oc i-pt'/
    'oc s-pt' que leen esta hoja.

    Lanza ExcelBloqueadoError si el archivo está en uso en otro lado
    (reintentable) o ExcelEscrituraError para cualquier otro fallo (no
    reintentable sin intervención, ej. demasiados materiales)."""
    if len(materiales) > len(COLS_MATERIALES):
        raise ExcelEscrituraError(
            f"La OT tiene {len(materiales)} materiales, más de los {len(COLS_MATERIALES)} que caben en 'oc mp'"
        )

    ruta = obtener_ruta_configurada(db)
    if not ruta:
        raise ExcelEscrituraError("No hay ruta configurada para el Excel OC-MP")

    password = obtener_password_configurada(db)

    import pythoncom
    import win32com.client

    # COM se inicializa por hilo, no por proceso. Esta función corre dentro
    # de FastAPI, que atiende cada request en un hilo del pool — sin esto,
    # el hilo que le toque a una request puede no tener COM inicializado
    # todavía y DispatchEx falla con "CoInitialize no llamado", aunque el
    # mismo código corrido como script suelto (un solo hilo) nunca lo sufre.
    pythoncom.CoInitialize()
    try:
        try:
            excel = win32com.client.DispatchEx("Excel.Application")
        except Exception as exc:
            raise ExcelEscrituraError(f"No se pudo iniciar Excel: {exc}") from exc

        excel.Visible = False
        excel.DisplayAlerts = False
        # El libro tiene vínculos a fuentes externas — sin esto, Excel muestra
        # un diálogo pidiendo actualizarlos o no que DisplayAlerts=False NO
        # suprime (es un caso aparte) y que, al necesitar respuesta sí o sí,
        # puede forzar la ventana a hacerse visible aunque Visible=False.
        # UpdateLinks=0 en Open() además evita tocar esos vínculos (no traer
        # datos "frescos" de otro archivo solo por escribir una fila nueva).
        excel.AskToUpdateLinks = False
        try:
            try:
                wb = _con_reintentos(
                    lambda: excel.Workbooks.Open(ruta, UpdateLinks=0, Password=password, ReadOnly=False)
                )
            except Exception as exc:
                raise ExcelBloqueadoError(
                    f"No se pudo abrir el archivo (¿está en uso en otro lado?): {exc}"
                ) from exc

            try:
                # Un libro de este tamaño (6 MB, fórmulas cruzadas entre
                # hojas) queda "ocupado" (recalculando, indexando) un buen
                # rato justo después de abrirse, y durante ese rato Excel
                # rechaza CUALQUIER llamada COM entrante con
                # RPC_E_SERVERCALL_RETRYLATER — no es que el archivo esté
                # bloqueado por otra sesión. Por eso todo lo que sigue va
                # envuelto en _con_reintentos, no solo Open/Save.
                try:
                    _con_reintentos(lambda: setattr(excel, "Calculation", -4135))  # xlCalculationManual
                except Exception:
                    pass  # optimización best-effort, no es fatal si falla

                if _con_reintentos(lambda: wb.ReadOnly):
                    raise ExcelBloqueadoError("El archivo está abierto en otra sesión (se abrió de solo lectura)")

                try:
                    ws = _con_reintentos(lambda: wb.Worksheets(HOJA))
                except Exception as exc:
                    raise ExcelEscrituraError(f"No se encontró la hoja '{HOJA}': {exc}") from exc

                fila_existente = _con_reintentos(lambda: _buscar_fila_por_ot(ws, numero_ot))
                fila = fila_existente if fila_existente is not None else _con_reintentos(lambda: _primera_fila_vacia(ws))

                def _escribir_celdas() -> None:
                    ws.Cells(fila, COL_OT).Value = numero_ot
                    if cliente:
                        ws.Cells(fila, COL_CLIENTE).Value = cliente
                    for campo, col in CAMPOS_A_COLUMNAS.items():
                        valor = campos.get(campo)
                        if valor is not None:
                            ws.Cells(fila, col).Value = _valor_com(valor)
                    for i, (col_codigo, col_cantidad) in enumerate(COLS_MATERIALES):
                        if i < len(materiales):
                            material = materiales[i]
                            ws.Cells(fila, col_codigo).Value = material["codigo_mp"]
                            if material.get("cantidad_requerida") is not None:
                                ws.Cells(fila, col_cantidad).Value = material["cantidad_requerida"]
                        elif fila_existente is not None:
                            # Solo limpiamos slots sobrantes al ACTUALIZAR una
                            # fila que ya existía — en una fila nueva ya están
                            # vacíos, no hace falta la escritura de más.
                            ws.Cells(fila, col_codigo).Value = None
                            ws.Cells(fila, col_cantidad).Value = None

                # Reintentable sin riesgo: la fila ya quedó fija arriba, así
                # que repetir esta escritura solo vuelve a poner los mismos
                # valores.
                _con_reintentos(_escribir_celdas)

                try:
                    _con_reintentos(wb.Save)
                except Exception as exc:
                    raise ExcelBloqueadoError(f"No se pudo guardar (¿está en uso en otro lado?): {exc}") from exc
            finally:
                # Best-effort: si Excel sigue "ocupado" acá, no vale la pena
                # relanzar sobre el error original — pero sí reintentar un
                # poco, para no dejar el proceso EXCEL.EXE huérfano.
                try:
                    _con_reintentos(lambda: wb.Close(SaveChanges=False), intentos=5, espera=2.0)
                except Exception:
                    logger.exception("No se pudo cerrar el libro de Excel limpiamente tras escribir_oc_mp")
        finally:
            try:
                _con_reintentos(excel.Quit, intentos=5, espera=2.0)
            except Exception:
                logger.exception(
                    "No se pudo cerrar Excel limpiamente tras escribir_oc_mp — puede quedar EXCEL.EXE huérfano"
                )
    finally:
        pythoncom.CoUninitialize()
