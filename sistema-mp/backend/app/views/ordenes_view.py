from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import ordenes_controller
from ..controllers.pedidos_controller import total_ingresado_pendiente
from ..controllers.ordenes_controller import CAMPOS_COMERCIALES
from ..controllers.pedidos_controller import total_devuelto_pedido, total_entregado_pedido
from ..database import get_db
from ..models import OrdenTrabajo, OtMaterialPendiente
from ..services.excel_oc_mp import ExcelLecturaError

router = APIRouter(prefix="/ordenes-trabajo", tags=["ordenes-trabajo"], dependencies=[Depends(security.get_current_usuario)])
router_pendientes = APIRouter(
    prefix="/ot-materiales-pendientes",
    tags=["ordenes-trabajo"],
    dependencies=[Depends(security.requiere_modulo("registrar_entrega"))],
)
# Editar/eliminar un pendiente es corregir un error de tipeo del Excel (o de
# Crear OT) antes de que se le asigne proceso — va con el módulo de Crear OT,
# no con el de Registrar Entrega, por eso es un router aparte con el mismo
# prefijo en vez de sumar rutas al de arriba.
router_pendientes_crear_ot = APIRouter(
    prefix="/ot-materiales-pendientes",
    tags=["ordenes-trabajo"],
    dependencies=[Depends(security.requiere_modulo("crear_ot"))],
)
# Corregir el proceso/máquina de un pedido ya creado. Va con el módulo de
# entregas porque es ahí donde se asigna el proceso y donde se descubre el
# error, no en Crear OT.
router_pedidos = APIRouter(
    prefix="/ot-materiales",
    tags=["ordenes-trabajo"],
    dependencies=[Depends(security.requiere_modulo("registrar_entrega"))],
)


def _serializar_pendiente(p: OtMaterialPendiente) -> schemas.OtMaterialPendienteOut:
    return schemas.OtMaterialPendienteOut(
        id=p.id,
        codigo_mp=p.codigo_mp,
        material_id=p.material_id,
        cantidad_requerida=p.cantidad_requerida,
        es_tinta=p.material.es_tinta if p.material is not None else False,
        materias_primas=[mp.material.codigo_mp for mp in p.materias_primas],
        total_ingresado=total_ingresado_pendiente(p),
    )


def _serializar_detalle(ot: OrdenTrabajo) -> schemas.OtDetalleOut:
    return schemas.OtDetalleOut(
        numero_ot=ot.numero_ot,
        cliente=ot.cliente,
        diseno=ot.diseno,
        sincronizado_excel=ot.sincronizado_excel,
        excel_sync_error=ot.excel_sync_error,
        **{campo: getattr(ot, campo) for campo in CAMPOS_COMERCIALES},
        pendientes=[_serializar_pendiente(p) for p in ot.pendientes],
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
def listar_ordenes(
    q: Optional[str] = None,
    desde: Optional[date] = None,
    hasta: Optional[date] = None,
    db: Session = Depends(get_db),
):
    return ordenes_controller.listar_ordenes(db, q, desde, hasta)


@router.get("/nuevas-en-excel", response_model=List[schemas.OtExcelNuevaOut])
def listar_ots_nuevas_en_excel(db: Session = Depends(get_db)):
    try:
        return ordenes_controller.listar_ots_nuevas_en_excel(db)
    except ExcelLecturaError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.get("/comparar-excel-todas", response_model=List[schemas.ComparacionMasivaItemOut])
def comparar_todas_con_excel(db: Session = Depends(get_db)):
    """Compara todas las OT ya cargadas contra el Excel OC-MP de una sola
    pasada — botón manual, no corre solo, mismo criterio que
    'nuevas-en-excel' (abrir el Excel de más no vale la pena)."""
    try:
        return ordenes_controller.comparar_todas_con_excel(db)
    except ExcelLecturaError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post(
    "/detalle",
    response_model=schemas.OtDetalleOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(security.requiere_modulo("crear_ot"))],
)
def guardar_detalle(data: schemas.OtDetalleCreate, db: Session = Depends(get_db)):
    ot = ordenes_controller.guardar_detalle(db, data)
    return _serializar_detalle(ot)


@router.get("/{numero_ot}/detalle", response_model=schemas.OtDetalleOut)
def obtener_detalle(numero_ot: str, db: Session = Depends(get_db)):
    ot = ordenes_controller.obtener_detalle(db, numero_ot)
    if ot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OT no encontrada")
    return _serializar_detalle(ot)


@router.delete(
    "/{numero_ot}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(security.requiere_modulo("crear_ot"))],
)
def eliminar_ot(numero_ot: str, db: Session = Depends(get_db)):
    ordenes_controller.eliminar_ot(db, numero_ot)


@router.get("/{numero_ot}/buscar", response_model=schemas.OtBusquedaOut)
def buscar_con_fallback(numero_ot: str, db: Session = Depends(get_db)):
    resultado = ordenes_controller.buscar_con_fallback(db, numero_ot)
    return schemas.OtBusquedaOut(
        origen=resultado["origen"],
        bd=_serializar_detalle(resultado["bd"]) if resultado["bd"] is not None else None,
        excel=schemas.OtExcelOut(**resultado["excel"]) if resultado["excel"] is not None else None,
    )


@router.post(
    "/{numero_ot}/importar-excel",
    response_model=schemas.OtImportadaOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(security.requiere_modulo("crear_ot"))],
)
def importar_desde_excel(numero_ot: str, db: Session = Depends(get_db)):
    ot = ordenes_controller.guardar_desde_excel(db, numero_ot)
    pendientes = ordenes_controller.listar_pendientes(db, numero_ot)
    return schemas.OtImportadaOut(
        ot=_serializar_detalle(ot), pendientes=[_serializar_pendiente(p) for p in pendientes]
    )


@router.get("/{numero_ot}/comparar-excel", response_model=schemas.ComparacionExcelOut)
def comparar_excel(numero_ot: str, db: Session = Depends(get_db)):
    return ordenes_controller.comparar_con_excel(db, numero_ot)


@router.post(
    "/{numero_ot}/aplicar-excel",
    response_model=schemas.OtDetalleOut,
    dependencies=[Depends(security.requiere_modulo("crear_ot"))],
)
def aplicar_excel(numero_ot: str, db: Session = Depends(get_db)):
    ot = ordenes_controller.aplicar_cambios_excel(db, numero_ot)
    return _serializar_detalle(ot)


@router.get("/{numero_ot}/pendientes", response_model=List[schemas.OtMaterialPendienteOut])
def listar_pendientes(numero_ot: str, db: Session = Depends(get_db)):
    pendientes = ordenes_controller.listar_pendientes(db, numero_ot)
    return [_serializar_pendiente(p) for p in pendientes]


@router.post(
    "/{numero_ot}/reintentar-excel",
    response_model=schemas.OtDetalleOut,
    dependencies=[Depends(security.requiere_modulo("crear_ot"))],
)
def reintentar_excel(numero_ot: str, db: Session = Depends(get_db)):
    ot = ordenes_controller.reintentar_sincronizacion_excel(db, numero_ot)
    return _serializar_detalle(ot)


@router_pendientes.post("/{pendiente_id}/promover", response_model=schemas.PromoverPendienteOut)
def promover_pendiente(pendiente_id: int, data: schemas.PromoverPendienteIn, db: Session = Depends(get_db)):
    ot_material = ordenes_controller.promover_pendiente(db, pendiente_id, data)
    return schemas.PromoverPendienteOut(ot_material_id=ot_material.id)


@router_pendientes_crear_ot.patch("/{pendiente_id}", response_model=schemas.OtMaterialPendienteOut)
def editar_pendiente(pendiente_id: int, data: schemas.EditarMaterialPedidoIn, db: Session = Depends(get_db)):
    pendiente = ordenes_controller.actualizar_pendiente(db, pendiente_id, data.material_id, data.cantidad_requerida)
    return _serializar_pendiente(pendiente)


@router_pendientes_crear_ot.delete("/{pendiente_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_pendiente(pendiente_id: int, db: Session = Depends(get_db)):
    ordenes_controller.eliminar_pendiente(db, pendiente_id)


@router_pedidos.patch("/{ot_material_id}/proceso", response_model=schemas.MoverPedidoOut)
def mover_pedido(ot_material_id: int, data: schemas.MoverPedidoIn, db: Session = Depends(get_db)):
    """Mueve un pedido a otro proceso/máquina de la misma OT, con todo lo que
    ya tenga registrado. Ver ordenes_controller.mover_pedido."""
    ot_material = ordenes_controller.mover_pedido(db, ot_material_id, data.proceso_id, data.maquina_id)
    return schemas.MoverPedidoOut(
        ot_material_id=ot_material.id,
        proceso=ot_material.ot_proceso.proceso.nombre,
        maquina=ot_material.ot_proceso.maquina.nombre,
    )


def _serializar_material_pedido(om) -> schemas.MaterialPedidoOut:
    return schemas.MaterialPedidoOut(
        ot_material_id=om.id,
        material_id=om.material_id,
        codigo_mp=om.material.codigo_mp,
        unidad=om.material.unidad,
        cantidad_requerida=float(om.cantidad_requerida) if om.cantidad_requerida else None,
        total_entregado=total_entregado_pedido(om),
        total_devuelto=total_devuelto_pedido(om),
    )


@router_pedidos.patch("/{ot_material_id}", response_model=schemas.MaterialPedidoOut)
def editar_pedido(ot_material_id: int, data: schemas.EditarMaterialPedidoIn, db: Session = Depends(get_db)):
    """Corrige el material o la cantidad de un pedido ya asignado a un
    proceso — rechazado si ya tiene entregas/devoluciones/materia prima
    registrada (ver ordenes_controller.actualizar_pedido)."""
    ot_material = ordenes_controller.actualizar_pedido(db, ot_material_id, data.material_id, data.cantidad_requerida)
    return _serializar_material_pedido(ot_material)


@router_pedidos.delete("/{ot_material_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_pedido(ot_material_id: int, db: Session = Depends(get_db)):
    ordenes_controller.eliminar_pedido(db, ot_material_id)
