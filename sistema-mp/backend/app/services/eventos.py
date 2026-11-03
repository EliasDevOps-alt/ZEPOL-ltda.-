"""Avisos en tiempo real: "cambió la OT 220200".

Cada vez que se guarda algo (entrega, devolución, SID, OT, pedido...) el
servidor avisa por una conexión abierta (Server-Sent Events, `GET /eventos`) a
todas las estaciones conectadas qué OT cambió. Cada estación vuelve a leer SOLO
esa OT, en vez de consultar todo cada tanto. El aviso no lleva datos (solo el
número de OT): lo que cada estación puede ver lo sigue decidiendo la API normal.

Cómo se detecta "algo cambió" sin tocar cada controlador: se escuchan los
eventos de la sesión de SQLAlchemy. Antes de cada flush se anota a qué OT
pertenece cada objeto que se agrega, modifica o borra; recién cuando el commit
sale bien se publica. Un rollback no avisa nada. Así también avisan los cambios
que no pasan por la API (el vigilante del Excel, los scripts).

El difusor vive en la memoria del proceso: sirve mientras haya un solo proceso
de uvicorn, que es como corre en la planta.
"""
from __future__ import annotations

import asyncio
import json
import threading
import time
from typing import Iterable, Optional

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session


# Más OT que esto en un solo guardado se avisa como "cambió mucho" (todo=true).
MAX_OTS_POR_AVISO = 40

# Columnas de OrdenTrabajo que el sistema reescribe por su cuenta (vigilante del
# Excel) y que a las estaciones no les interesan: cambiar solo eso no avisa.
_COLUMNAS_INTERNAS = {"codigos_excel_vistos", "sincronizado_excel", "excel_sync_error"}


class Difusor:
    def __init__(self) -> None:
        self._bloqueo = threading.Lock()
        self._suscriptores: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = []

    def suscribir(self) -> asyncio.Queue:
        """Llamar desde el bucle de eventos (la ruta async)."""
        cola: asyncio.Queue = asyncio.Queue(maxsize=1000)
        with self._bloqueo:
            self._suscriptores.append((asyncio.get_running_loop(), cola))
        return cola

    def desuscribir(self, cola: asyncio.Queue) -> None:
        with self._bloqueo:
            self._suscriptores = [(b, c) for (b, c) in self._suscriptores if c is not cola]

    @property
    def cantidad(self) -> int:
        with self._bloqueo:
            return len(self._suscriptores)

    def publicar(self, ots: Iterable[str]) -> None:
        """Se puede llamar desde cualquier hilo (los controladores corren en el pool)."""
        ots = sorted({o for o in ots if o})
        if not ots:
            return
        if len(ots) > MAX_OTS_POR_AVISO:
            # Un cambio masivo (importación del Excel, un script): en vez de una
            # lista enorme se avisa "cambió mucho" y cada estación sincroniza todo.
            mensaje = {"ots": [], "todo": True, "t": time.time()}
        else:
            mensaje = {"ots": ots, "t": time.time()}
        with self._bloqueo:
            suscriptores = list(self._suscriptores)
        for bucle, cola in suscriptores:
            try:
                bucle.call_soon_threadsafe(_poner, cola, mensaje)
            except RuntimeError:
                pass  # el bucle ya se cerró: esa conexión se limpia sola


def _poner(cola: asyncio.Queue, mensaje: dict) -> None:
    try:
        cola.put_nowait(mensaje)
    except asyncio.QueueFull:
        # Un cliente que no lee: se descarta lo más viejo. Al reconectar sincroniza todo.
        try:
            cola.get_nowait()
            cola.put_nowait(mensaje)
        except Exception:
            pass


difusor = Difusor()


def formatear(mensaje: dict) -> str:
    return f"data: {json.dumps(mensaje, separators=(',', ':'))}\n\n"


# ---------------------------------------------------------------------------
# Detección de cambios
# ---------------------------------------------------------------------------

_CLAVE = "ots_cambiadas"


def _numero_ot(session: Session, obj) -> Optional[str]:
    from . import modelos_ot as m  # se importa acá para no cargar models al importar este módulo

    try:
        return m.numero_ot_de(session, obj)
    except Exception:
        return None


def _cambio_real(obj) -> bool:
    """Un objeto "sucio" no siempre cambió: se cuentan solo los que tienen un
    valor distinto y no son columnas internas del sistema."""
    estado = inspect(obj)
    cambiadas = {a.key for a in estado.attrs if a.history.has_changes()}
    if not cambiadas:
        return False
    return bool(cambiadas - _COLUMNAS_INTERNAS)


def _antes_de_flush(session: Session, contexto, instancias) -> None:
    from . import modelos_ot as m

    with session.no_autoflush:
        acumulado = session.info.setdefault(_CLAVE, set())
        candidatos = list(session.new) + list(session.deleted) + [o for o in session.dirty if _cambio_real(o)]
        for obj in candidatos:
            if isinstance(obj, m.RELEVANTES):
                ot = _numero_ot(session, obj)
                if ot:
                    acumulado.add(ot)


def _despues_de_commit(session: Session) -> None:
    ots = session.info.pop(_CLAVE, None)
    if ots:
        difusor.publicar(ots)


def _descartar(session: Session, *args) -> None:
    session.info.pop(_CLAVE, None)


_instalado = False


def instalar() -> None:
    """Engancha la detección de cambios a todas las sesiones. Una sola vez."""
    global _instalado
    if _instalado:
        return
    event.listen(Session, "before_flush", _antes_de_flush)
    event.listen(Session, "after_commit", _despues_de_commit)
    event.listen(Session, "after_rollback", _descartar)
    _instalado = True
