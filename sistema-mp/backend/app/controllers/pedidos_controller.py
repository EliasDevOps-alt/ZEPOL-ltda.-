from __future__ import annotations

from ..models import OtMaterial


def total_entregado_pedido(ot_material: OtMaterial) -> float:
    return sum(float(b.cantidad) for entrega in ot_material.entregas for b in entrega.bobinas)


def total_devuelto_pedido(ot_material: OtMaterial) -> float:
    return sum(float(b.cantidad) for devolucion in ot_material.devoluciones for b in devolucion.bobinas)
