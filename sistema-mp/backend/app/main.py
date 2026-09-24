from __future__ import annotations

import asyncio
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .services.excel_watcher import bucle_vigilancia_excel
from .views import (
    auth_view,
    catalogos_view,
    configuracion_view,
    consumo_view,
    devoluciones_view,
    entregas_view,
    maquinas_view,
    materiales_view,
    ordenes_view,
    reportes_view,
    usuarios_view,
)

app = FastAPI(title="ZEPOL - Control de Materia Prima")

# Las estaciones (apps Electron) corren en otras PCs de la misma red local,
# no en el mismo origen que el servidor, por eso se abre CORS a cualquier
# origen dentro de la LAN en vez de restringir a localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_view.router)
app.include_router(catalogos_view.router)
app.include_router(entregas_view.router)
app.include_router(devoluciones_view.router)
app.include_router(reportes_view.router)
app.include_router(consumo_view.router)
app.include_router(materiales_view.router)
app.include_router(maquinas_view.router)
app.include_router(ordenes_view.router)
app.include_router(ordenes_view.router_pendientes)
app.include_router(ordenes_view.router_pendientes_crear_ot)
app.include_router(ordenes_view.router_pedidos)
app.include_router(configuracion_view.router)
app.include_router(usuarios_view.router)

# Sirve los instaladores publicados para el auto-actualizador de la app de
# escritorio (electron-updater) - las 5 estaciones apuntan aquí para
# detectar y descargar nuevas versiones, sin depender de internet/GitHub ya
# que esto es un despliegue solo de LAN. La carpeta vive fuera del repo
# (se llena a mano con `npm run dist` + copiar el resultado); se crea sola
# si no existe para que el arranque no falle en una instalación nueva.
UPDATES_DIR = Path(os.environ.get("UPDATES_DIR", Path(__file__).resolve().parent.parent / "updates"))
UPDATES_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/updates", StaticFiles(directory=str(UPDATES_DIR)), name="updates")


@app.get("/health")
def health():
    return {"status": "ok"}


# Vigilante del Excel OC-MP: revisa en segundo plano si el archivo cambió
# (el personal sigue registrando OT y agregando materiales ahí, en paralelo
# al sistema) y trae los cambios solo, sin que nadie tenga que acordarse de
# apretar "Comparar con Excel" -- ver excel_watcher.py para el detalle de
# por qué es seguro hacerlo sin supervisión.
@app.on_event("startup")
async def iniciar_vigilante_excel() -> None:
    app.state.tarea_vigilante_excel = asyncio.create_task(bucle_vigilancia_excel())


@app.on_event("shutdown")
async def detener_vigilante_excel() -> None:
    tarea = getattr(app.state, "tarea_vigilante_excel", None)
    if tarea is not None:
        tarea.cancel()
