from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class UsuarioOut(BaseModel):
    id: int
    inicial: str
    nombre: str
    rol: str
    modulos_restringidos: List[str] = []


class LoginRequest(BaseModel):
    inicial: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario: UsuarioOut


class UsuarioLoginOut(BaseModel):
    """Versión pública (sin rol ni permisos) para poblar el selector de
    Login — se pide sin estar autenticado todavía."""

    model_config = ConfigDict(from_attributes=True)
    inicial: str
    nombre: str


class UsuarioAdminOut(BaseModel):
    id: int
    inicial: str
    nombre: str
    rol: str
    activo: bool
    modulos_restringidos: List[str] = []


class UsuarioCreate(BaseModel):
    inicial: str
    nombre: str
    rol: str = "personal"
    password: str
    modulos_restringidos: List[str] = []


class UsuarioUpdate(BaseModel):
    nombre: str
    rol: str
    activo: bool
    modulos_restringidos: List[str] = []


class UsuarioPasswordIn(BaseModel):
    password: str


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
    usa_bobinas: bool


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
    usa_bobinas: bool


class MaterialCreate(BaseModel):
    codigo_mp: str
    descripcion: Optional[str] = None
    unidad: str
    es_tinta: bool = False
    usa_bobinas: bool = True


class MaterialUpdate(BaseModel):
    codigo_mp: str
    descripcion: Optional[str] = None
    unidad: str
    activo: bool = True
    es_tinta: bool = False
    usa_bobinas: bool = True


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
    # Materia prima ya entregada para fabricar este material, mientras el
    # pendiente sigue sin proceso asignado. Códigos, para poder mostrarlos sin
    # otra consulta.
    materias_primas: List[str] = []


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


class MoverPedidoIn(BaseModel):
    proceso_id: int
    maquina_id: int


class MoverPedidoOut(BaseModel):
    ot_material_id: int
    proceso: str
    maquina: str


class EntregaCreate(BaseModel):
    """La entrega no siempre se registra contra el pedido que el operador
    tiene en pantalla — hay dos modos, excluyentes entre sí:

    1. Normal (ningún campo extra): se entrega contra ot_material_id, con
       material_id opcional si almacén dio una alternativa o un cambio de
       estructura (sustitución 1 a 1).
    2. como_materia_prima: hace falta OTRO material para poder completar el
       del pedido (ej. el LDPE-4 que pide la OT se fabrica mezclando LDPE-1 y
       LDPE-2). No es una sustitución: esa materia prima obtiene su PROPIO
       pedido, en el proceso y la máquina donde realmente se consume — que no
       tienen por qué ser los del pedido que completa (ver
       ordenes_controller.crear_pedido_materia_prima) — y la entrega va contra
       ese pedido nuevo. Vale para cualquier proceso, no solo Extrusión.
    """

    # Uno de los dos, no ambos. pendiente_id solo vale con como_materia_prima:
    # es materia prima para un material que todavía no tiene proceso asignado
    # (ver OtMaterial.insumo_de_pendiente_id).
    ot_material_id: Optional[int] = None
    pendiente_id: Optional[int] = None
    fecha: date
    bobinas: List[float] = Field(min_length=1)
    # Material realmente entregado, si difiere del pedido (alternativa o
    # cambio de estructura). None = se entrega el material del pedido tal cual.
    # Obligatorio con como_materia_prima (es el material que sale de almacén).
    material_id: Optional[int] = None
    observacion: Optional[str] = None
    como_materia_prima: bool = False
    # Dónde se consume esa materia prima. Obligatorios con como_materia_prima.
    proceso_id: Optional[int] = None
    maquina_id: Optional[int] = None


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
    # Material que realmente salió de almacén — puede diferir de codigo_mp
    # (el del pedido) si hubo una sustitución.
    material_entregado_id: int
    codigo_mp_entregado: str
    descripcion_entregado: Optional[str]
    observacion: Optional[str] = None
    # ot_material_id/proceso/maquina/codigo_mp de arriba son los del pedido
    # donde REALMENTE quedó la entrega, que con como_materia_prima no es el
    # que el operador tenía seleccionado. Esto avisa que ese pedido se acaba
    # de crear, para poder confirmarlo en pantalla.
    pedido_creado: bool = False


class BalanceMaterialOut(BaseModel):
    """Saldo de un material puntual dentro de un pedido — un pedido puede
    tener más de uno si hubo sustituciones en sus entregas."""

    material_id: int
    codigo_mp: str
    descripcion: Optional[str]
    unidad: str
    usa_bobinas: bool
    total_entregado: float
    total_devuelto: float
    disponible: float


class DevolucionCreate(BaseModel):
    ot_material_id: int
    # Cuál material se está devolviendo — obligatorio porque el pedido puede
    # haber recibido entregas de más de un material (ver EntregaCreate.material_id).
    material_id: int
    fecha: date
    bobinas: List[float] = Field(min_length=1)
    # TRUE = material FABRICADO en esta OT entrando a almacén, no un sobrante.
    # Ver Devolucion.es_ingreso_produccion.
    es_ingreso_produccion: bool = False


class DevolucionOut(BaseModel):
    id: int
    ot_material_id: int
    material_id: int
    codigo_mp: str
    usuario: str
    fecha: date
    bobinas: List[float]
    total_devuelto: float
    total_devuelto_pedido: float
    es_ingreso_produccion: bool


class PedidoMaterialOut(BaseModel):
    """Un material pedido dentro de una OT+proceso, con su avance de entrega."""

    ot_material_id: int
    numero_ot: str
    cliente: Optional[str]
    proceso: str
    maquina: str
    diseno: Optional[str]
    material_id: int
    codigo_mp: str
    descripcion: Optional[str]
    unidad: str
    es_tinta: bool
    usa_bobinas: bool
    # TRUE si este pedido es una materia prima que hizo falta para completar
    # otro pedido de la OT (ver OtMaterial.insumo_de_id).
    es_materia_prima: bool
    # Código del material que se completa con esta materia prima (ej. LDPE-4),
    # si es_materia_prima. None en cualquier otro pedido.
    insumo_de_codigo_mp: Optional[str]
    # TRUE si a este pedido se le agregó materia prima — o sea, su material se
    # fabrica en esta OT en vez de salir de almacén tal cual. El frontend lo
    # usa para ofrecer el registro de ingreso a almacén y para el badge.
    tiene_materia_prima: bool
    cantidad_requerida: Optional[float]
    total_entregado: float
    # Sobrantes que volvieron de planta. NO incluye el material fabricado que
    # entró a almacén — eso es total_ingresado.
    total_devuelto: float
    # Material fabricado en esta OT que entró a almacén (ver
    # Devolucion.es_ingreso_produccion). 0 en un pedido normal.
    total_ingresado: float
    consumo_neto: float
    estado_entrega: str
    # TRUE si alguna entrega/devolución de este pedido fue de un material
    # distinto al pedido — el frontend usa esto para saber cuándo vale la
    # pena pedir el detalle real (GET /entregas/materiales-entregados/{id}).
    material_sustituido: bool


class ConsumoOut(PedidoMaterialOut):
    estado_sid: str
    sid_devolucion_completado: bool
