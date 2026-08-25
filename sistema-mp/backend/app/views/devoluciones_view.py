from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import devoluciones_controller
from ..controllers.pedidos_controller import total_devuelto_pedido
from ..database import get_db
from ..models import Devolucion, Usuario

router = APIRouter(prefix="/devoluciones", tags=["devoluciones"], dependencies=[Depends(security.get_current_usuario)])


def _serializar(devolucion: Devolucion) -> schemas.DevolucionOut:
    return schemas.DevolucionOut(
        id=devolucion.id,
        ot_material_id=devolucion.ot_material_id,
        material_id=devolucion.material_id,
        codigo_mp=devolucion.material.codigo_mp,
        usuario=devolucion.usuario.inicial,
        fecha=devolucion.fecha,
        bobinas=[float(b.cantidad) for b in sorted(devolucion.bobinas, key=lambda b: b.numero)],
        total_devuelto=sum(float(b.cantidad) for b in devolucion.bobinas),
        total_devuelto_pedido=total_devuelto_pedido(devolucion.ot_material),
        es_ingreso_produccion=devolucion.es_ingreso_produccion,
    )


@router.post(
    "",
    response_model=schemas.DevolucionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(security.requiere_modulo("registrar_devolucion"))],
)
def registrar_devolucion(
    data: schemas.DevolucionCreate,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(security.get_current_usuario),
):
    devolucion = devoluciones_controller.registrar_devolucion(db, usuario, data)
    return _serializar(devolucion)


@router.get("", response_model=List[schemas.DevolucionOut])
def listar_devoluciones(
    ot_material_id: Optional[int] = None,
    numero_ot: Optional[str] = None,
    db: Session = Depends(get_db),
):
    if ot_material_id is not None:
        devoluciones = devoluciones_controller.listar_devoluciones_por_pedido(db, ot_material_id)
    else:
        devoluciones = devoluciones_controller.listar_devoluciones_por_ot(db, numero_ot)
    return [_serializar(d) for d in devoluciones]
