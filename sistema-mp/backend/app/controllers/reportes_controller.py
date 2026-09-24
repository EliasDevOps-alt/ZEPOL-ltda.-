from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

# Una OT está terminada cuando TODO lo que se movió en ella ya está registrado
# en el SID:
#   - tiene al menos una entrega (una o varias, da igual cuántas), y
#   - cada entrega, cada devolución y cada ingreso a almacén que tenga está
#     marcado sid_completado.
#
# Devoluciones e ingresos son opcionales: una OT sin ninguno también cuenta
# (solo se exige que los que existan estén en el SID). Lo que NO se mira es
# cuánto se entregó frente a lo pedido — una entrega parcial ya registrada en
# el SID alcanza.
#
# Los ingresos colgados de un pendiente suelto (ot_material_id NULL) se
# resuelven a su OT por el pendiente; sin eso quedarían fuera y una OT con un
# ingreso sin registrar en el SID aparecería como terminada.
_SQL_OTS_TERMINADAS = """
WITH mov AS (
    SELECT op.ot_id, 'entrega' AS tipo, e.fecha, e.sid_completado
    FROM entregas e
    JOIN ot_materiales om ON om.id = e.ot_material_id
    JOIN ot_procesos op ON op.id = om.ot_proceso_id
    UNION ALL
    SELECT COALESCE(op.ot_id, p.ot_id) AS ot_id,
           CASE WHEN d.es_ingreso_produccion THEN 'ingreso' ELSE 'devolucion' END AS tipo,
           d.fecha,
           d.sid_completado
    FROM devoluciones d
    LEFT JOIN ot_materiales om ON om.id = d.ot_material_id
    LEFT JOIN ot_procesos op ON op.id = om.ot_proceso_id
    LEFT JOIN ot_materiales_pendientes p ON p.id = d.ot_material_pendiente_id
),
resumen AS (
    SELECT ot_id,
           COUNT(*) AS total_movimientos,
           COUNT(*) FILTER (WHERE tipo = 'entrega') AS entregas,
           BOOL_AND(sid_completado) AS todo_en_sid,
           MAX(fecha) AS ultima_fecha
    FROM mov
    GROUP BY ot_id
)
SELECT ot.numero_ot,
       ot.cliente,
       ot.diseno,
       ot.descripcion_producto,
       (SELECT COUNT(*)
          FROM ot_materiales om2
          JOIN ot_procesos op2 ON op2.id = om2.ot_proceso_id
         WHERE op2.ot_id = ot.id) AS pedidos,
       ot.fecha_creacion,
       r.ultima_fecha,
       r.total_movimientos
FROM resumen r
JOIN ordenes_trabajo ot ON ot.id = r.ot_id
WHERE r.entregas > 0
  AND r.todo_en_sid
  -- El CAST no es decorativo: sin él Postgres no puede deducir el tipo de un
  -- parámetro que solo aparece en "IS NULL" y falla con AmbiguousParameter.
  AND (CAST(:desde AS date) IS NULL OR r.ultima_fecha >= CAST(:desde AS date))
  AND (CAST(:hasta AS date) IS NULL OR r.ultima_fecha <= CAST(:hasta AS date))
ORDER BY r.ultima_fecha DESC NULLS LAST, ot.fecha_creacion DESC
LIMIT :limite
"""


def listar_ots_terminadas(
    db: Session,
    desde: Optional[date] = None,
    hasta: Optional[date] = None,
    limite: int = 2000,
) -> List[Dict[str, Any]]:
    """OT con entregas cuyos movimientos están todos en el SID, de la más
    recientemente movida a la más vieja. El filtro de fechas va contra la fecha
    del último movimiento (que es cuándo la OT terminó), no contra su fecha de
    creación."""
    filas = db.execute(
        text(_SQL_OTS_TERMINADAS),
        {"desde": desde, "hasta": hasta, "limite": limite},
    ).mappings().all()
    return [dict(f) for f in filas]
