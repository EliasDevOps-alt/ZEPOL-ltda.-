from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


def _estado_entrega(cantidad_requerida: float | None, total_entregado: float) -> str:
    if not cantidad_requerida:
        return "SIN REQUERIMIENTO"
    if total_entregado >= float(cantidad_requerida):
        return "COMPLETO"
    if total_entregado > 0:
        return "PARCIAL"
    return "PENDIENTE"


def consultar_consumo(db: Session, numero_ot: Optional[str] = None) -> List[Dict[str, Any]]:
    if numero_ot is not None:
        filas = db.execute(
            text("SELECT * FROM vista_consumo WHERE numero_ot = :numero_ot ORDER BY ot_material_id"),
            {"numero_ot": numero_ot},
        ).mappings().all()
    else:
        filas = db.execute(text("SELECT * FROM vista_consumo ORDER BY numero_ot, ot_material_id")).mappings().all()

    resultado = []
    for fila in filas:
        fila_dict = dict(fila)
        fila_dict["estado_entrega"] = _estado_entrega(
            fila_dict["cantidad_requerida"], float(fila_dict["total_entregado"])
        )
        resultado.append(fila_dict)
    return resultado
