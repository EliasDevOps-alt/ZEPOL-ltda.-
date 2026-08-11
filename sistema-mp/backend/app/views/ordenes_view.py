from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import ordenes_controller
from ..controllers.pedidos_controller import total_devuelto_pedido, total_entregado_pedido
from ..database import get_db
from ..models import OrdenTrabajo

router = APIRouter(prefix="/ordenes-trabajo", tags=["ordenes-trabajo"], dependencies=[Depends(security.get_current_usuario)])


def _serializar_detalle(ot: OrdenTrabajo) -> schemas.OtDetalleOut:
    return schemas.OtDetalleOut(
        numero_ot=ot.numero_ot,
        cliente=ot.cliente,
        diseno=ot.diseno,
        procesos=[
            schemas.ProcesoDetalleOut(
                ot_proceso_id=otp.id,
                proceso_id=otp.proceso_id,
                proceso=otp.proceso.nombre,
                maquina_id=otp.maquina_id,
                maquina=otp.maquina.nombre,
                materiales=[
                    schemas.MaterialPedidoOut(
                        ot_material_id=om.id,
                        material_id=om.material_id,
                        codigo_mp=om.material.codigo_mp,
                        unidad=om.material.unidad,
                        cantidad_requerida=float(om.cantidad_requerida) if om.cantidad_requerida else None,
                        total_entregado=total_entregado_pedido(om),
                        total_devuelto=total_devuelto_pedido(om),
                    )
                    for om in otp.materiales
                ],
            )
            for otp in ot.procesos
        ],
    )


@router.get("", response_model=List[schemas.OrdenTrabajoOut])
def listar_ordenes(q: Optional[str] = None, db: Session = Depends(get_db)):
    return ordenes_controller.listar_ordenes(db, q)


@router.post("/detalle", response_model=schemas.OtDetalleOut, status_code=status.HTTP_201_CREATED)
def guardar_detalle(data: schemas.OtDetalleCreate, db: Session = Depends(get_db)):
    ot = ordenes_controller.guardar_detalle(db, data)
    return _serializar_detalle(ot)


@router.get("/{numero_ot}/detalle", response_model=schemas.OtDetalleOut)
def obtener_detalle(numero_ot: str, db: Session = Depends(get_db)):
    ot = ordenes_controller.obtener_detalle(db, numero_ot)
    if ot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OT no encontrada")
    return _serializar_detalle(ot)
