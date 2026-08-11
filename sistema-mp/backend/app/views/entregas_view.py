from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import entregas_controller
from ..controllers.pedidos_controller import total_entregado_pedido
from ..database import get_db
from ..models import Entrega, Usuario

router = APIRouter(prefix="/entregas", tags=["entregas"], dependencies=[Depends(security.get_current_usuario)])


def _serializar(entrega: Entrega) -> schemas.EntregaOut:
    ot_material = entrega.ot_material
    ot_proceso = ot_material.ot_proceso
    return schemas.EntregaOut(
        id=entrega.id,
        ot_material_id=ot_material.id,
        numero_ot=ot_proceso.ot.numero_ot,
        proceso=ot_proceso.proceso.nombre,
        maquina=ot_proceso.maquina.nombre,
        codigo_mp=ot_material.material.codigo_mp,
        unidad=ot_material.material.unidad,
        usuario=entrega.usuario.inicial,
        fecha=entrega.fecha,
        bobinas=[float(b.cantidad) for b in sorted(entrega.bobinas, key=lambda b: b.numero)],
        total_entregado=sum(float(b.cantidad) for b in entrega.bobinas),
        cantidad_requerida=float(ot_material.cantidad_requerida) if ot_material.cantidad_requerida else None,
        total_entregado_pedido=total_entregado_pedido(ot_material),
    )


@router.post("", response_model=schemas.EntregaOut, status_code=status.HTTP_201_CREATED)
def registrar_entrega(
    data: schemas.EntregaCreate,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(security.get_current_usuario),
):
    entrega = entregas_controller.registrar_entrega(db, usuario, data)
    return _serializar(entrega)


@router.get("", response_model=List[schemas.EntregaOut])
def listar_entregas(numero_ot: str, db: Session = Depends(get_db)):
    entregas = entregas_controller.listar_entregas_por_ot(db, numero_ot)
    return [_serializar(e) for e in entregas]
