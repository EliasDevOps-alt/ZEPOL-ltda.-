from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt

from .. import security
from ..services.eventos import difusor, formatear

router = APIRouter(prefix="/eventos", tags=["eventos"])

# Cada tanto se manda un comentario vacío: mantiene viva la conexión a través de
# routers/proxies y deja al servidor notar enseguida a un cliente que ya no está.
_LATIDO_SEGUNDOS = 15


def _usuario_valido(token: str = Depends(security.oauth2_scheme)) -> int:
    # Solo se valida el token (sin abrir una sesión de base de datos): esta
    # conexión queda abierta todo el día y no debe ocupar una conexión del pool.
    try:
        payload = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
        return int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciales inválidas")


@router.get("")
async def eventos(_: int = Depends(_usuario_valido)):
    """Flujo de avisos "cambió la OT X" (text/event-stream). Sin datos de la OT:
    quien lo recibe vuelve a leer lo que necesite por la API normal."""
    cola = difusor.suscribir()

    async def generar():
        try:
            yield ": conectado\n\n"
            while True:
                try:
                    mensaje = await asyncio.wait_for(cola.get(), timeout=_LATIDO_SEGUNDOS)
                    yield formatear(mensaje)
                except asyncio.TimeoutError:
                    yield ": latido\n\n"
        finally:
            difusor.desuscribir(cola)

    return StreamingResponse(
        generar(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
