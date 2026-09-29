"""Crea en la base las tablas del módulo de Producto Terminado (versión
1.0.12) si todavía no existen, y las columnas que se agregaron después.
Uso: python scripts/migrar_producto_terminado.py

No hay herramienta de migraciones en el proyecto (ver CLAUDE.md): esto toma
las sentencias tal cual de db/schema.sql y usa la misma conexión que el
backend (app.database), así funciona también en el servidor, donde no se
puede entrar con psql usando la contraseña por defecto. Se puede correr
cuantas veces haga falta: lo que ya existe no se toca."""

from __future__ import annotations

import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from sqlalchemy import text

from app.database import engine

# Columnas agregadas a tablas del módulo después de crearlas por primera vez.
COLUMNAS_POSTERIORES = [
    "ALTER TABLE productos_terminados ADD COLUMN IF NOT EXISTS moneda VARCHAR(20)",
    "ALTER TABLE pesajes_pt ADD COLUMN IF NOT EXISTS editado_por_id INTEGER REFERENCES usuarios(id)",
    "ALTER TABLE pesajes_pt ADD COLUMN IF NOT EXISTS editado_en TIMESTAMP",
]


def main() -> None:
    esquema = (RAIZ / "db" / "schema.sql").read_text(encoding="utf-8")
    inicio = esquema.index("-- Producto terminado (formulario P-LOG-001-F-04")
    fin = esquema.index("-- Vista de consumo neto por pedido")
    tablas = re.findall(r"CREATE TABLE .*?\n\);", esquema[inicio:fin], re.S)

    with engine.begin() as conexion:
        for sentencia in tablas:
            nombre = sentencia.split()[2]
            if conexion.execute(text("SELECT to_regclass(:n)"), {"n": nombre}).scalar():
                print(f"ya existía: {nombre}")
                continue
            conexion.execute(text(sentencia))
            print(f"creada: {nombre}")
        for sentencia in COLUMNAS_POSTERIORES:
            conexion.execute(text(sentencia))
    print("Listo.")


if __name__ == "__main__":
    main()
