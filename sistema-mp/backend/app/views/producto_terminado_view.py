from __future__ import annotations

from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import producto_terminado_controller
from ..database import get_db
from ..models import PesajePt, ProductoTerminado, Usuario

router = APIRouter(
    prefix="/producto-terminado",
    tags=["producto-terminado"],
    dependencies=[Depends(security.get_current_usuario)],
)


def _serializar(producto_terminado: ProductoTerminado) -> schemas.ProductoTerminadoOut:
    ot = producto_terminado.ot
    return schemas.ProductoTerminadoOut(
        numero_ot=ot.numero_ot,
        cliente=ot.cliente,
        vendedor=ot.vendedor,
        ciudad=ot.ciudad,
        fecha_pedido=ot.fecha_pedido,
        fecha_entrega=ot.fecha_entrega,
        tipo_trabajo=ot.tipo_trabajo,
        unidad=producto_terminado.unidad,
        medida_excel=producto_terminado.medida_excel,
        pedido_total=float(producto_terminado.pedido_total) if producto_terminado.pedido_total is not None else None,
        pedido_total_real=producto_terminado_controller.pedido_total_real(producto_terminado),
        moneda=producto_terminado.moneda,
        ediciones=producto_terminado_controller.ediciones_del_formulario(producto_terminado),
        items=[schemas.ProductoTerminadoItemOut.model_validate(item) for item in producto_terminado.items],
    )


def _serializar_pesaje(pesaje: PesajePt) -> schemas.PesajePtOut:
    cantidad = float(pesaje.cantidad) if pesaje.cantidad is not None else None
    if cantidad is None and pesaje.producto_terminado.unidad in producto_terminado_controller.UNIDADES_CON_BOBINAS:
        cantidad = 1.0  # pesajes de KG anteriores al campo: una bobina
    return schemas.PesajePtOut(
        id=pesaje.id,
        numero=pesaje.numero,
        fecha=pesaje.fecha,
        hora=pesaje.hora,
        peso_bruto=float(pesaje.peso_bruto),
        tara=float(pesaje.tara),
        peso_neto=float(pesaje.peso_bruto) - float(pesaje.tara),
        cantidad=cantidad,
        pesador=pesaje.usuario.inicial,
        pesador_nombre=pesaje.usuario.nombre,
        editado_por=pesaje.editado_por.inicial if pesaje.editado_por else None,
        editado_en=pesaje.editado_en,
    )


@router.get("/sid-dias", response_model=List[schemas.SidDiaPtOut])
def listar_sid_dias(estado: str = "pendientes", q: str = "", db: Session = Depends(get_db)):
    """Días pesados de todas las OT con su N° del SID. Antes de "/{numero_ot}"
    para que "sid-dias" no se tome por un número de OT."""
    if estado not in ("pendientes", "registrados", "todos"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "estado debe ser pendientes, registrados o todos")
    return producto_terminado_controller.listar_sid_dias(db, estado, q)


@router.put(
    "/{numero_ot}/sid/{fecha}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(security.requiere_modulo("producto_terminado"))],
)
def fijar_sid_dia(
    numero_ot: str,
    fecha: date,
    data: schemas.SidDiaPtIn,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(security.get_current_usuario),
):
    producto_terminado_controller.fijar_sid_dia(db, numero_ot, fecha, data.numero_sid, usuario)


@router.post(
    "/{numero_ot}/sid/{fecha}/revisado",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(security.requiere_modulo("producto_terminado"))],
)
def confirmar_revision_sid_dia(numero_ot: str, fecha: date, db: Session = Depends(get_db)):
    producto_terminado_controller.confirmar_revision_sid_dia(db, numero_ot, fecha)


# Va antes de "/{numero_ot}" a propósito: si no, "pesajes" se tomaría como un
# número de OT.
@router.delete(
    "/pesajes/{pesaje_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(security.requiere_modulo("producto_terminado"))],
)
def eliminar_pesaje(pesaje_id: int, db: Session = Depends(get_db)):
    producto_terminado_controller.eliminar_pesaje(db, pesaje_id)


@router.patch(
    "/pesajes/{pesaje_id}",
    response_model=schemas.PesajePtOut,
    dependencies=[Depends(security.requiere_modulo("producto_terminado"))],
)
def editar_pesaje(
    pesaje_id: int,
    data: schemas.PesajePtCreate,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(security.get_current_usuario),
):
    pesaje = producto_terminado_controller.editar_pesaje(
        db, pesaje_id, data.fecha, data.peso_bruto, data.tara, data.cantidad, usuario
    )
    return _serializar_pesaje(pesaje)


@router.get("/{numero_ot}", response_model=schemas.ProductoTerminadoOut)
def obtener(numero_ot: str, db: Session = Depends(get_db)):
    producto_terminado = producto_terminado_controller.obtener(db, numero_ot)
    if producto_terminado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa OT todavía no se abrió en Producto Terminado")
    return _serializar(producto_terminado)


@router.post(
    "/{numero_ot}",
    response_model=schemas.ProductoTerminadoOut,
    dependencies=[Depends(security.requiere_modulo("producto_terminado"))],
)
def abrir(numero_ot: str, db: Session = Depends(get_db)):
    """Idempotente: la primera vez crea el producto terminado leyendo el
    Excel; las siguientes devuelve el que ya existe."""
    return _serializar(producto_terminado_controller.abrir(db, numero_ot))


@router.put(
    "/{numero_ot}/unidad",
    response_model=schemas.ProductoTerminadoOut,
    dependencies=[Depends(security.requiere_modulo("producto_terminado"))],
)
def confirmar_unidad(numero_ot: str, data: schemas.ConfirmarUnidadPtIn, db: Session = Depends(get_db)):
    return _serializar(producto_terminado_controller.confirmar_unidad(db, numero_ot, data.unidad))


@router.put(
    "/{numero_ot}/moneda",
    response_model=schemas.ProductoTerminadoOut,
    dependencies=[Depends(security.requiere_modulo("producto_terminado"))],
)
def fijar_moneda(numero_ot: str, data: schemas.MonedaPtIn, db: Session = Depends(get_db)):
    return _serializar(producto_terminado_controller.fijar_moneda(db, numero_ot, data.moneda))


@router.put(
    "/{numero_ot}/ediciones",
    response_model=schemas.ProductoTerminadoOut,
    dependencies=[Depends(security.requiere_modulo("producto_terminado"))],
)
def fijar_ediciones(numero_ot: str, data: schemas.EdicionesFormularioPtIn, db: Session = Depends(get_db)):
    return _serializar(producto_terminado_controller.fijar_ediciones(db, numero_ot, data.ediciones))


@router.get("/{numero_ot}/pesajes", response_model=schemas.PesajesPtOut)
def listar_pesajes(numero_ot: str, db: Session = Depends(get_db)):
    producto_terminado = producto_terminado_controller.obtener_abierto(db, numero_ot)
    resumen = producto_terminado_controller.resumen_pesajes(producto_terminado)
    return schemas.PesajesPtOut(
        pesajes=[_serializar_pesaje(p) for p in producto_terminado.pesajes],
        **resumen,
    )


@router.post(
    "/{numero_ot}/pesajes",
    response_model=schemas.PesajePtOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(security.requiere_modulo("producto_terminado"))],
)
def registrar_pesaje(
    numero_ot: str,
    data: schemas.PesajePtCreate,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(security.get_current_usuario),
):
    pesaje = producto_terminado_controller.registrar_pesaje(
        db, numero_ot, data.fecha, data.peso_bruto, data.tara, data.cantidad, usuario
    )
    return _serializar_pesaje(pesaje)
