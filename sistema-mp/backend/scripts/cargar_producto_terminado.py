"""Carga (o actualiza) los productos y el pedido total de Producto Terminado
para TODAS las OT que ya están en la base, leyendo el Excel OC-MP una sola
vez. Uso: python scripts/cargar_producto_terminado.py

Hace falta correrlo una vez al instalar el módulo: las OT nuevas ya entran
con sus productos (guardar_desde_excel / vigilante), pero las importadas antes
no los tienen. Se puede volver a correr sin problema: no toca pesajes ni una
unidad ya usada para pesar. Solo lee el Excel, nunca lo modifica."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.controllers import producto_terminado_controller
from app.database import SessionLocal
from app.models import OrdenTrabajo
from app.services import excel_oc_mp


def main() -> None:
    db = SessionLocal()
    try:
        todas_excel = excel_oc_mp.leer_todas_oc_mp(db)
        ots = db.scalars(select(OrdenTrabajo)).all()
        desde_excel = desde_ot = sin_unidad = 0
        for ot in ots:
            datos = todas_excel.get(ot.numero_ot)
            if datos is None:
                datos = producto_terminado_controller.datos_desde_ot(ot)
                desde_ot += 1
            else:
                desde_excel += 1
            producto_terminado = producto_terminado_controller.sincronizar_desde_excel(db, ot, datos)
            if producto_terminado.unidad is None:
                sin_unidad += 1
        db.commit()
        print(f"{len(ots)} OT: {desde_excel} desde el Excel, {desde_ot} con los datos de la propia OT (no están en el Excel).")
        print(f"{sin_unidad} quedaron sin unidad reconocida: se confirma a mano en Producto Terminado.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
