from __future__ import annotations

from typing import List

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..models import Devolucion, DevolucionBobina, OtMaterial, Usuario
from .pedidos_controller import total_devuelto_pedido, total_entregado_pedido


def registrar_devolucion(db: Session, usuario: Usuario, data: schemas.DevolucionCreate) -> Devolucion:
    ot_material = db.get(OtMaterial, data.ot_material_id)
    if ot_material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido de material no encontrado")

    total_entregado = total_entregado_pedido(ot_material)
    total_devuelto_previo = total_devuelto_pedido(ot_material)
    total_nuevo = sum(data.bobinas)
    if total_devuelto_previo + total_nuevo > total_entregado:
        disponible = total_entregado - total_devuelto_previo
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"No se puede devolver más de lo entregado. Disponible para devolver: {disponible} {ot_material.material.unidad}",
        )

    devolucion = Devolucion(ot_material_id=ot_material.id, usuario_id=usuario.id, fecha=data.fecha)
    devolucion.bobinas = [DevolucionBobina(numero=i + 1, cantidad=c) for i, c in enumerate(data.bobinas)]
    db.add(devolucion)
    db.commit()
    db.refresh(devolucion)
    return devolucion


def listar_devoluciones_por_pedido(db: Session, ot_material_id: int) -> List[Devolucion]:
    return db.scalars(
        select(Devolucion).where(Devolucion.ot_material_id == ot_material_id).order_by(Devolucion.id)
    ).all()
