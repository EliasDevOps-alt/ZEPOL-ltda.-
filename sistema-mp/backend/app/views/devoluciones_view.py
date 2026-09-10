from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import devoluciones_controller, sid_controller
from ..controllers.pedidos_controller import total_devuelto_pedido, total_ingresado_pendiente
from ..database import get_db
from ..models import Devolucion, Usuario

router = APIRouter(prefix="/devoluciones", tags=["devoluciones"], dependencies=[Depends(security.get_current_usuario)])


def _serializar(devolucion: Devolucion) -> schemas.DevolucionOut:
    return schemas.DevolucionOut(
        id=devolucion.id,
        ot_material_id=devolucion.ot_material_id,
        pendiente_id=devolucion.ot_material_pendiente_id,
        material_id=devolucion.material_id,
        codigo_mp=devolucion.material.codigo_mp,
        usuario=devolucion.usuario.inicial,
        fecha=devolucion.fecha,
        hora=devolucion.hora,
        bobinas=[float(b.cantidad) for b in sorted(devolucion.bobinas, key=lambda b: b.numero)],
        total_devuelto=sum(float(b.cantidad) for b in devolucion.bobinas),
        total_devuelto_pedido=(
            total_devuelto_pedido(devolucion.ot_material)
            if devolucion.ot_material is not None
            else total_ingresado_pendiente(devolucion.ot_material_pendiente)
        ),
        usa_bobinas=devolucion.material.usa_bobinas,
        sid_completado=devolucion.sid_completado,
        es_ingreso_produccion=devolucion.es_ingreso_produccion,
        editado_por=devolucion.editado_por.inicial if devolucion.editado_por else None,
        editado_en=devolucion.editado_en,
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


@router.post(
    "/{devolucion_id}/sid/completado",
    response_model=schemas.DevolucionOut,
    dependencies=[Depends(security.requiere_modulo("registro_sid"))],
)
def marcar_sid_completado(devolucion_id: int, db: Session = Depends(get_db)):
    devolucion = sid_controller.marcar_devolucion_sid(db, devolucion_id, True)
    return _serializar(devolucion)


@router.post(
    "/{devolucion_id}/sid/pendiente",
    response_model=schemas.DevolucionOut,
    dependencies=[Depends(security.requiere_modulo("registro_sid"))],
)
def marcar_sid_pendiente(devolucion_id: int, db: Session = Depends(get_db)):
    devolucion = sid_controller.marcar_devolucion_sid(db, devolucion_id, False)
    return _serializar(devolucion)


@router.patch(
    "/{devolucion_id}",
    response_model=schemas.DevolucionOut,
    dependencies=[Depends(security.requiere_modulo("registrar_devolucion"))],
)
def editar_devolucion(
    devolucion_id: int,
    data: schemas.DevolucionUpdate,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(security.get_current_usuario),
):
    devolucion = devoluciones_controller.editar_devolucion(db, usuario, devolucion_id, data)
    return _serializar(devolucion)


@router.delete(
    "/{devolucion_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(security.requiere_modulo("registrar_devolucion"))],
)
def eliminar_devolucion(
    devolucion_id: int,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(security.get_current_usuario),
):
    devoluciones_controller.eliminar_devolucion(db, usuario, devolucion_id)


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
