"""Agrega a entregas y devoluciones la columna sid_completado_por_id (quién
marcó el SID de ese movimiento). Uso: python scripts/migrar_sid_completado_por.py

Mismo criterio que migrar_producto_terminado.py: usa la conexión del propio
backend (app.database), así funciona también en el servidor, y se puede correr
cuantas veces haga falta. Los movimientos que ya estaban marcados quedan con
NULL (no se sabe quién fue): la pantalla solo muestra la hora en esos casos."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text

from app.database import engine

SENTENCIAS = [
    "ALTER TABLE entregas ADD COLUMN IF NOT EXISTS sid_completado_por_id INTEGER REFERENCES usuarios(id)",
    "ALTER TABLE devoluciones ADD COLUMN IF NOT EXISTS sid_completado_por_id INTEGER REFERENCES usuarios(id)",
]

with engine.begin() as conexion:
    for sentencia in SENTENCIAS:
        conexion.execute(text(sentencia))
print("Listo.")
