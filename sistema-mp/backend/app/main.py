from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
    sid_view,
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
app.include_router(consumo_view.router)
app.include_router(materiales_view.router)
app.include_router(maquinas_view.router)
app.include_router(ordenes_view.router)
app.include_router(ordenes_view.router_pendientes)
app.include_router(ordenes_view.router_pedidos)
app.include_router(configuracion_view.router)
app.include_router(sid_view.router)
app.include_router(usuarios_view.router)


@app.get("/health")
def health():
    return {"status": "ok"}
