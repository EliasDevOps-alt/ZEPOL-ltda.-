from __future__ import annotations

from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..models import (
    Entrega,
    EntregaBobina,
    Material,
    OrdenTrabajo,
    OtMaterial,
    OtMaterialPendiente,
    OtProceso,
    Usuario,
)
from . import ordenes_controller, sid_controller


def _validar_materia_prima(data: schemas.EntregaCreate) -> None:
    if data.material_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Indica qué materia prima se está entregando")
    if data.proceso_id is None or data.maquina_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Indica el proceso y la máquina donde se consume esa materia prima"
        )


def _resolver_pedido(db: Session, data: schemas.EntregaCreate) -> Tuple[OtMaterial, bool]:
    """Contra qué pedido queda realmente la entrega. Ver EntregaCreate para los
    dos modos; devuelve además si ese pedido se acaba de crear."""
    if (data.ot_material_id is None) == (data.pendiente_id is None):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Indica el pedido o el material pendiente, no los dos"
        )

    # Materia prima para un material que todavía no tiene proceso asignado.
    if data.pendiente_id is not None:
        if not data.como_materia_prima:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Un material pendiente no se puede entregar hasta que se le asigne proceso y máquina",
            )
        pendiente = db.get(OtMaterialPendiente, data.pendiente_id)
        if pendiente is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Material pendiente no encontrado")
        _validar_materia_prima(data)
        return ordenes_controller.crear_pedido_materia_prima_de_pendiente(
            db, pendiente, data.material_id, data.proceso_id, data.maquina_id, sum(data.bobinas)
        )

    ot_material = db.get(OtMaterial, data.ot_material_id)
    if ot_material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido de material no encontrado")

    if not data.como_materia_prima:
        return ot_material, False

    _validar_materia_prima(data)
    return ordenes_controller.crear_pedido_materia_prima(
        db, ot_material, data.material_id, data.proceso_id, data.maquina_id, sum(data.bobinas)
    )


def registrar_entrega(db: Session, usuario: Usuario, data: schemas.EntregaCreate) -> Tuple[Entrega, bool]:
    pedido, pedido_creado = _resolver_pedido(db, data)

    # Sin material_id explícito, se entrega el material del pedido tal cual
    # (el caso normal, sin sustitución).
    material_id = data.material_id if data.material_id is not None else pedido.material_id
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material no encontrado")

    entrega = Entrega(
        ot_material_id=pedido.id,
        material_id=material.id,
        usuario_id=usuario.id,
        fecha=data.fecha,
        observacion=data.observacion,
    )
    entrega.bobinas = [EntregaBobina(numero=i + 1, cantidad=c) for i, c in enumerate(data.bobinas)]
    db.add(entrega)
    db.flush()
    # Esta entrega recién creada nunca tiene su SID registrado todavía, así
    # que el pedido vuelve a quedar pendiente aunque las anteriores ya
    # estuvieran completas.
    sid_controller.recalcular_estado_entrega(db, pedido)
    db.commit()
    db.refresh(entrega)
    return entrega, pedido_creado


def listar_entregas_por_ot(db: Session, numero_ot: Optional[str] = None) -> List[Entrega]:
    stmt = (
        select(Entrega)
        .join(OtMaterial, OtMaterial.id == Entrega.ot_material_id)
        .join(OtProceso, OtProceso.id == OtMaterial.ot_proceso_id)
        .join(OrdenTrabajo, OrdenTrabajo.id == OtProceso.ot_id)
        .order_by(Entrega.id)
    )
    if numero_ot is not None:
        stmt = stmt.where(OrdenTrabajo.numero_ot == numero_ot)
    return db.scalars(stmt).all()
