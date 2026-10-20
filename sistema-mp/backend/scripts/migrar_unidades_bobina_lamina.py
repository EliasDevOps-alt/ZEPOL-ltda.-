"""Agrega las unidades BOBINA y LAMINA a Producto Terminado y corrige las OT
que ya estaban guardadas con la unidad vieja.
Uso: python scripts/migrar_unidades_bobina_lamina.py

Qué hace (todo en una transacción, y se puede correr cuantas veces haga falta):
  1. Cambia el CHECK de productos_terminados.unidad para aceptar 'BOBINA' y
     'LAMINA' (Postgres no deja ampliar un CHECK: se borra y se vuelve a crear).
  2. Las OT cuya "Med." del Excel es "Bob" estaban guardadas como BOLSAS (se
     las tomaba por un error de tipeo de "bol"): pasan a BOBINA. Se hace aun
     si ya tienen pesajes, porque BOLSAS y BOBINA se calculan igual (cantidad
     en unidades, factor 1): lo único que cambia es cómo se rotula.
  3. Las OT cuya "Med." es "lamina" no se reconocían (unidad NULL, esperaban
     confirmación a mano): pasan a LAMINA. Una unidad ya confirmada a mano no
     se toca.

Usa la misma conexión que el backend (app.database), así funciona también en
el servidor sin necesitar la contraseña de Postgres."""

from __future__ import annotations

import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from sqlalchemy import text

from app.database import engine

NUEVO_CHECK = "CHECK (unidad IN ('KG', 'BOLSAS', 'MILLAR', 'BOBINA', 'LAMINA'))"


def main() -> None:
    with engine.begin() as conexion:
        checks = conexion.execute(
            text(
                """
                SELECT conname, pg_get_constraintdef(oid) AS definicion
                FROM pg_constraint
                WHERE conrelid = 'productos_terminados'::regclass
                  AND contype = 'c'
                  AND pg_get_constraintdef(oid) ILIKE '%unidad%'
                """
            )
        ).all()
        if any("BOBINA" in c.definicion for c in checks):
            print("El CHECK de unidad ya acepta BOBINA y LAMINA.")
        else:
            for c in checks:
                conexion.execute(text(f'ALTER TABLE productos_terminados DROP CONSTRAINT "{c.conname}"'))
                print(f"CHECK viejo eliminado: {c.conname}")
            conexion.execute(
                text(f"ALTER TABLE productos_terminados ADD CONSTRAINT productos_terminados_unidad_check {NUEVO_CHECK}")
            )
            print("CHECK nuevo creado: productos_terminados_unidad_check")

        bob = conexion.execute(
            text(
                """
                UPDATE productos_terminados
                SET unidad = 'BOBINA'
                WHERE unidad = 'BOLSAS'
                  AND lower(trim(trailing '.' from trim(medida_excel))) IN ('bob', 'bobina', 'bobinas')
                """
            )
        ).rowcount
        print(f"OT 'Bob' pasadas de BOLSAS a BOBINA: {bob}")

        lam = conexion.execute(
            text(
                """
                UPDATE productos_terminados
                SET unidad = 'LAMINA'
                WHERE unidad IS NULL
                  AND lower(trim(trailing '.' from trim(medida_excel))) IN ('lamina', 'laminas', 'lámina', 'láminas')
                """
            )
        ).rowcount
        print(f"OT 'lamina' reconocidas como LAMINA: {lam}")
    print("Listo.")


if __name__ == "__main__":
    main()
