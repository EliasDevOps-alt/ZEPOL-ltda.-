from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import entregas_controller
from ..controllers.pedidos_controller import materiales_entregados_pedido, total_entregado_pedido
from ..database import get_db
from ..models import Entrega, OtMaterial, Usuario

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
        diseno=ot_proceso.ot.diseno,
        codigo_mp=ot_material.material.codigo_mp,
        unidad=ot_material.material.unidad,
        usuario=entrega.usuario.inicial,
        fecha=entrega.fecha,
        bobinas=[float(b.cantidad) for b in sorted(entrega.bobinas, key=lambda b: b.numero)],
        total_entregado=sum(float(b.cantidad) for b in entrega.bobinas),
        cantidad_requerida=float(ot_material.cantidad_requerida) if ot_material.cantidad_requerida else None,
        total_entregado_pedido=total_entregado_pedido(ot_material),
        material_entregado_id=entrega.material_id,
        codigo_mp_entregado=entrega.material.codigo_mp,
        descripcion_entregado=entrega.material.descripcion,
        observacion=entrega.observacion,
    )


@router.post(
    "",
    response_model=schemas.EntregaOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(security.requiere_modulo("registrar_entrega"))],
)
def registrar_entrega(
    data: schemas.EntregaCreate,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(security.get_current_usuario),
):
    entrega = entregas_controller.registrar_entrega(db, usuario, data)
    return _serializar(entrega)


@router.get("", response_model=List[schemas.EntregaOut])
def listar_entregas(numero_ot: Optional[str] = None, db: Session = Depends(get_db)):
    entregas = entregas_controller.listar_entregas_por_ot(db, numero_ot)
    return [_serializar(e) for e in entregas]


@router.get("/materiales-entregados/{ot_material_id}", response_model=List[schemas.BalanceMaterialOut])
def materiales_entregados(ot_material_id: int, db: Session = Depends(get_db)):
    """Materiales realmente entregados contra un pedido, con su saldo
    disponible para devolver — normalmente uno solo, pero puede haber más de
    uno si alguna entrega fue una sustitución. Lo usa Registrar Devolución
    para saber contra cuál material validar/registrar."""
    ot_material = db.get(OtMaterial, ot_material_id)
    if ot_material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido no encontrado")
    return materiales_entregados_pedido(ot_material)
