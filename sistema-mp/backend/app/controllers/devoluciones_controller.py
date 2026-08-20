from __future__ import annotations

from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..models import Devolucion, DevolucionBobina, Material, OrdenTrabajo, OtMaterial, OtProceso, Usuario


def registrar_devolucion(db: Session, usuario: Usuario, data: schemas.DevolucionCreate) -> Devolucion:
    ot_material = db.get(OtMaterial, data.ot_material_id)
    if ot_material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido de material no encontrado")

    material = db.get(Material, data.material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material no encontrado")

    # No se bloquea si la cantidad supera lo entregado registrado en el
    # sistema: el registro de entregas puede estar incompleto o el conteo
    # físico real puede diferir, y el operador sabe qué volvió realmente a
    # bodega mejor que la cuenta del sistema. El frontend avisa cuando esto
    # pasa (ver PedidoDevolucionCard), pero no impide guardar.
    devolucion = Devolucion(
        ot_material_id=ot_material.id, material_id=material.id, usuario_id=usuario.id, fecha=data.fecha
    )
    devolucion.bobinas = [DevolucionBobina(numero=i + 1, cantidad=c) for i, c in enumerate(data.bobinas)]
    db.add(devolucion)
    db.commit()
    db.refresh(devolucion)
    return devolucion


def listar_devoluciones_por_pedido(db: Session, ot_material_id: int) -> List[Devolucion]:
    return db.scalars(
        select(Devolucion).where(Devolucion.ot_material_id == ot_material_id).order_by(Devolucion.id)
    ).all()


def listar_devoluciones_por_ot(db: Session, numero_ot: Optional[str] = None) -> List[Devolucion]:
    stmt = (
        select(Devolucion)
        .join(OtMaterial, OtMaterial.id == Devolucion.ot_material_id)
        .join(OtProceso, OtProceso.id == OtMaterial.ot_proceso_id)
        .join(OrdenTrabajo, OrdenTrabajo.id == OtProceso.ot_id)
        .order_by(Devolucion.id)
    )
    if numero_ot is not None:
        stmt = stmt.where(OrdenTrabajo.numero_ot == numero_ot)
    return db.scalars(stmt).all()
