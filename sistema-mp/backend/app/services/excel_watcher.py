from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional, Tuple

from ..controllers import ordenes_controller
from ..database import SessionLocal
from . import excel_oc_mp

logger = logging.getLogger(__name__)

# Cada cuánto se revisa si 'oc mp' cambió de tamaño o fecha de modificación
# (no se abre el archivo si no cambió nada). No hace falta que sea instantáneo
# -- medio minuto de demora es imperceptible frente a que alguien se acuerde
# de apretar "Comparar con Excel", que era el problema real que esto
# reemplaza (ver conversación 2026-09-15).
INTERVALO_SEGUNDOS = int(os.environ.get("EXCEL_WATCHER_INTERVALO_SEGUNDOS", "20"))

EstadoArchivo = Tuple[float, int]  # (mtime, tamaño)


def _revisar_una_vez(ultimo_estado: Optional[EstadoArchivo]) -> Optional[EstadoArchivo]:
    """Un chequeo: si el archivo cambió desde ultimo_estado, sincroniza y
    devuelve el nuevo estado; si no cambió (o falla), devuelve ultimo_estado
    sin tocar para que el próximo chequeo lo vuelva a intentar. Deliberadamente
    no distingue "sin ruta configurada" de "sin cambios" -- ambos casos no
    tienen nada que hacer todavía."""
    db = SessionLocal()
    try:
        ruta = excel_oc_mp.obtener_ruta_configurada(db)
        if not ruta:
            return ultimo_estado

        try:
            info = os.stat(ruta)
        except OSError as exc:
            logger.warning("Vigilante Excel OC-MP: no se pudo acceder a %s (%s)", ruta, exc)
            return ultimo_estado

        estado_actual: EstadoArchivo = (info.st_mtime, info.st_size)
        if estado_actual == ultimo_estado:
            return ultimo_estado

        try:
            resultado = ordenes_controller.sincronizar_automaticamente_excel(db)
        except Exception:
            # No actualizar ultimo_estado: el próximo chequeo ve el mismo
            # cambio pendiente y reintenta, en vez de darlo por sincronizado.
            logger.exception("Vigilante Excel OC-MP: fallo al sincronizar, se reintenta en el próximo chequeo")
            return ultimo_estado

        if resultado["nuevas"] or resultado["actualizadas"]:
            logger.info(
                "Vigilante Excel OC-MP: %d OT nueva(s) importada(s) (%s), %d OT actualizada(s) (%s)",
                len(resultado["nuevas"]),
                ", ".join(resultado["nuevas"]) or "-",
                len(resultado["actualizadas"]),
                ", ".join(resultado["actualizadas"]) or "-",
            )
        return estado_actual
    finally:
        db.close()


async def bucle_vigilancia_excel() -> None:
    """Tarea de fondo iniciada al arrancar el backend (ver main.py):
    mientras el proceso viva, revisa cada INTERVALO_SEGUNDOS si 'oc mp'
    cambió y, si cambió, trae automáticamente al sistema las OT nuevas y los
    materiales/datos comerciales agregados a OT ya importadas -- sin que
    nadie tenga que apretar 'Comparar con Excel' ni acordarse de nada.

    Es seguro dejarlo corriendo sin supervisión porque reutiliza
    guardar_desde_excel/aplicar_cambios_excel tal cual (ver
    ordenes_controller.sincronizar_automaticamente_excel): ninguna de las dos
    borra ni pisa datos existentes, solo agregan lo que falta.

    Arranca con ultimo_estado=None a propósito: el primer chequeo siempre se
    ve como "cambió" y sincroniza una vez al arrancar, para ponerse al día
    con lo que se haya editado en el Excel mientras el backend estaba
    apagado."""
    ultimo_estado: Optional[EstadoArchivo] = None
    while True:
        try:
            ultimo_estado = await asyncio.to_thread(_revisar_una_vez, ultimo_estado)
        except Exception:
            logger.exception("Vigilante Excel OC-MP: error inesperado en el ciclo de chequeo")
        await asyncio.sleep(INTERVALO_SEGUNDOS)
