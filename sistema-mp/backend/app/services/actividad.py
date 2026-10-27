"""Quién está usando el sistema ahora mismo.

No hay "sesiones" en el servidor (el login solo entrega un token), así que cada
petición autenticada anota en memoria la hora y la PC desde donde llegó. Sirve
para saber quién está conectado antes de reiniciar el backend. Se pierde al
reiniciar a propósito: es solo una foto del momento, no un registro histórico.
"""

from __future__ import annotations

import socket
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as TiempoAgotado
from datetime import datetime
from typing import Dict, List, Optional

_candado = threading.Lock()
# usuario_id -> última actividad
_actividad: Dict[int, Dict] = {}
# ip -> nombre de la PC (o None si no se pudo resolver); evita repetir la consulta
_nombres_pc: Dict[str, Optional[str]] = {}
_resolutor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="dns-pc")

IPS_LOCALES = {"127.0.0.1", "::1", "localhost"}


def registrar(usuario_id: int, inicial: str, nombre: str, ip: Optional[str]) -> None:
    """Anota que este usuario hizo una petición ahora, desde `ip`."""
    with _candado:
        _actividad[usuario_id] = {
            "usuario_id": usuario_id,
            "inicial": inicial,
            "nombre": nombre,
            "ip": ip or "",
            "ultima": datetime.now(),
        }


def _nombre_de_pc(ip: str) -> Optional[str]:
    """Nombre de la PC por DNS inverso, con tope de 1 s (en una red sin DNS
    puede tardar varios segundos). Guarda el resultado, incluso el fallido."""
    if ip in IPS_LOCALES:
        return "Servidor"
    if ip in _nombres_pc:
        return _nombres_pc[ip]
    futuro = _resolutor.submit(socket.gethostbyaddr, ip)
    try:
        nombre: Optional[str] = futuro.result(timeout=1.0)[0].split(".")[0]
    except (TiempoAgotado, OSError):
        nombre = None
    _nombres_pc[ip] = nombre
    return nombre


def conectados(minutos: int) -> List[Dict]:
    """Usuarios con actividad en los últimos `minutos`, el más reciente primero."""
    ahora = datetime.now()
    with _candado:
        recientes = [dict(a) for a in _actividad.values() if (ahora - a["ultima"]).total_seconds() <= minutos * 60]
    for a in recientes:
        a["pc"] = _nombre_de_pc(a["ip"]) if a["ip"] else None
        a["segundos"] = int((ahora - a["ultima"]).total_seconds())
    return sorted(recientes, key=lambda a: a["segundos"])
