from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class UsuarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    inicial: str
    nombre: str


class LoginRequest(BaseModel):
    inicial: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario: UsuarioOut


class ProcesoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    nombre: str


class MaquinaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    nombre: str
    proceso_id: int


class MaterialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    codigo_mp: str
    descripcion: Optional[str]
    unidad: str
    es_tinta: bool


class EstadoSidOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    nombre: str


class EstadoSidUpdateOut(BaseModel):
    ot_material_id: int
    estado_sid: str


class SidDevolucionUpdateOut(BaseModel):
    ot_material_id: int
    sid_devolucion_completado: bool


class MaquinaAdminOut(BaseModel):
    id: int
    nombre: str
    proceso_id: int
    proceso: str
    activo: bool


class MaquinaCreate(BaseModel):
    nombre: str
    proceso_id: int


class MaquinaUpdate(BaseModel):
    nombre: str
    proceso_id: int
    activo: bool = True


class MaterialAdminOut(BaseModel):
    id: int
    codigo_mp: str
    descripcion: Optional[str]
    unidad: str
    activo: bool
    es_tinta: bool


class MaterialCreate(BaseModel):
    codigo_mp: str
    descripcion: Optional[str] = None
    unidad: str
    es_tinta: bool = False


class MaterialUpdate(BaseModel):
    codigo_mp: str
    descripcion: Optional[str] = None
    unidad: str
    activo: bool = True
    es_tinta: bool = False


class OrdenTrabajoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    numero_ot: str
    cliente: Optional[str]
    diseno: Optional[str]
    fecha_creacion: datetime
    sincronizado_excel: bool


class CamposComercialesOt(BaseModel):
    """Columnas comerciales espejo 1:1 de la hoja 'oc mp' del Excel OC-MP
    (ver app/services/excel_oc_mp.py) — compartidas entre lo que se lee del
    Excel y lo que se guarda/edita en la base de datos vía 'Crear OT'."""

    fecha_seguimiento_mp: Optional[date] = None
    alm: Optional[str] = None
    so: Optional[str] = None
    tipo_trabajo: Optional[str] = None
    indicador: Optional[str] = None
    status_entrega_mp: Optional[str] = None
    vendedor: Optional[str] = None
    ciudad: Optional[str] = None
    fecha_pedido: Optional[date] = None
    fecha_entrega: Optional[date] = None
    descripcion_producto: Optional[str] = None
    codigo_producto: Optional[str] = None
    total_ot: Optional[float] = None
    entrega_mes: Optional[float] = None
    medida: Optional[str] = None
    equivalencia_kg: Optional[float] = None
    pu_usd: Optional[float] = None
    pt_usd: Optional[float] = None
    factura_clises: Optional[str] = None
    precio_clise_usd: Optional[float] = None
    precio_total_pedido_usd: Optional[float] = None


class MaterialPedidoIn(BaseModel):
    material_id: int
    cantidad_requerida: Optional[float] = None


class ProcesoDetalleIn(BaseModel):
    proceso_id: int
    maquina_id: int
    materiales: List[MaterialPedidoIn] = Field(min_length=1)


class OtMaterialPendienteOut(BaseModel):
    id: int
    codigo_mp: str
    material_id: Optional[int]
    cantidad_requerida: Optional[float]
    es_tinta: bool


class OtDetalleCreate(CamposComercialesOt):
    """Define (o amplía) una OT: cliente, diseño y datos comerciales (únicos
    para toda la OT) y los materiales que necesita con su cantidad. No se
    asigna proceso ni máquina aquí —eso se decide en Registrar Entrega, al
    momento de entregar cada material— así que los materiales quedan como
    'pendientes' hasta ese momento. No registra ninguna entrega todavía."""

    numero_ot: str
    cliente: Optional[str] = None
    diseno: Optional[str] = None
    materiales: List[MaterialPedidoIn] = []


class MaterialPedidoOut(BaseModel):
    ot_material_id: int
    material_id: int
    codigo_mp: str
    unidad: str
    cantidad_requerida: Optional[float]
    total_entregado: float
    total_devuelto: float


class ProcesoDetalleOut(BaseModel):
    ot_proceso_id: int
    proceso_id: int
    proceso: str
    maquina_id: int
    maquina: str
    materiales: List[MaterialPedidoOut]


class OtDetalleOut(CamposComercialesOt):
    numero_ot: str
    cliente: Optional[str]
    diseno: Optional[str]
    sincronizado_excel: bool
    excel_sync_error: Optional[str] = None
    procesos: List[ProcesoDetalleOut]
    pendientes: List[OtMaterialPendienteOut] = []


class MaterialExcelOut(BaseModel):
    codigo_mp: str
    cantidad_requerida: Optional[float] = None


class OtExcelOut(CamposComercialesOt):
    """Datos de una OT tal como están en la hoja 'oc mp' del Excel, cuando
    todavía no existe en la base de datos."""

    numero_ot: str
    cliente: Optional[str] = None
    materiales: List[MaterialExcelOut] = []
    total: Optional[float] = None


class ConfiguracionExcelOut(BaseModel):
    ruta: Optional[str] = None
    tiene_password: bool = False


class ConfiguracionExcelIn(BaseModel):
    ruta: str


class ConfiguracionExcelPasswordIn(BaseModel):
    password: str


class OtBusquedaOut(BaseModel):
    """Resultado de buscar una OT en base de datos y, si no está ahí, en el
    Excel OC-MP — el frontend usa 'origen' para mostrar de dónde salió."""

    origen: str  # "bd" | "excel" | "no_encontrada"
    bd: Optional[OtDetalleOut] = None
    excel: Optional[OtExcelOut] = None


class OtImportadaOut(BaseModel):
    """Resultado de importar una OT desde el Excel OC-MP: la OT ya creada
    (con sus campos comerciales) y los materiales que quedaron pendientes de
    que se les asigne proceso y máquina en Registrar Entrega."""

    ot: OtDetalleOut
    pendientes: List[OtMaterialPendienteOut]


class PromoverPendienteIn(BaseModel):
    proceso_id: int
    maquina_id: int
    material_id: Optional[int] = None  # solo si el código de Excel no calzó con ningún material del catálogo


class PromoverPendienteOut(BaseModel):
    ot_material_id: int


class EntregaCreate(BaseModel):
    ot_material_id: int
    fecha: date
    bobinas: List[float] = Field(min_length=1)


class EntregaOut(BaseModel):
    id: int
    ot_material_id: int
    numero_ot: str
    proceso: str
    maquina: str
    diseno: Optional[str]
    codigo_mp: str
    unidad: str
    usuario: str
    fecha: date
    bobinas: List[float]
    total_entregado: float
    cantidad_requerida: Optional[float]
    total_entregado_pedido: float


class DevolucionCreate(BaseModel):
    ot_material_id: int
    fecha: date
    bobinas: List[float] = Field(min_length=1)


class DevolucionOut(BaseModel):
    id: int
    ot_material_id: int
    usuario: str
    fecha: date
    bobinas: List[float]
    total_devuelto: float
    total_devuelto_pedido: float


class PedidoMaterialOut(BaseModel):
    """Un material pedido dentro de una OT+proceso, con su avance de entrega."""

    ot_material_id: int
    numero_ot: str
    cliente: Optional[str]
    proceso: str
    maquina: str
    diseno: Optional[str]
    codigo_mp: str
    descripcion: Optional[str]
    unidad: str
    es_tinta: bool
    cantidad_requerida: Optional[float]
    total_entregado: float
    total_devuelto: float
    consumo_neto: float
    estado_entrega: str


class ConsumoOut(PedidoMaterialOut):
    estado_sid: str
    sid_devolucion_completado: bool
