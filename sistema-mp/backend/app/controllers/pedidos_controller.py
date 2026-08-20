from __future__ import annotations

from typing import Any, Dict, List

from ..models import OtMaterial


def total_entregado_pedido(ot_material: OtMaterial) -> float:
    return sum(float(b.cantidad) for entrega in ot_material.entregas for b in entrega.bobinas)


def total_devuelto_pedido(ot_material: OtMaterial) -> float:
    return sum(float(b.cantidad) for devolucion in ot_material.devoluciones for b in devolucion.bobinas)


def total_entregado_material(ot_material: OtMaterial, material_id: int) -> float:
    return sum(
        float(b.cantidad)
        for entrega in ot_material.entregas
        if entrega.material_id == material_id
        for b in entrega.bobinas
    )


def total_devuelto_material(ot_material: OtMaterial, material_id: int) -> float:
    return sum(
        float(b.cantidad)
        for devolucion in ot_material.devoluciones
        if devolucion.material_id == material_id
        for b in devolucion.bobinas
    )


def materiales_entregados_pedido(ot_material: OtMaterial) -> List[Dict[str, Any]]:
    """Materiales realmente entregados contra este pedido, con su propio
    saldo disponible para devolver. Normalmente hay uno solo (el del
    pedido), pero puede haber más de uno si alguna entrega fue una
    sustitución (ver Entrega.material_id)."""
    materiales_por_id = {}
    for entrega in ot_material.entregas:
        materiales_por_id.setdefault(entrega.material_id, entrega.material)

    resultado = []
    for material_id, material in materiales_por_id.items():
        entregado = total_entregado_material(ot_material, material_id)
        devuelto = total_devuelto_material(ot_material, material_id)
        resultado.append(
            {
                "material_id": material_id,
                "codigo_mp": material.codigo_mp,
                "descripcion": material.descripcion,
                "unidad": material.unidad,
                "total_entregado": entregado,
                "total_devuelto": devuelto,
                "disponible": entregado - devuelto,
            }
        )
    return resultado
