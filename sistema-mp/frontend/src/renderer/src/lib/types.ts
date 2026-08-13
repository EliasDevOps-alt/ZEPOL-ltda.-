export interface Usuario {
  id: number
  inicial: string
  nombre: string
}

export interface Proceso {
  id: number
  nombre: string
}

export interface Maquina {
  id: number
  nombre: string
  proceso_id: number
}

export interface Material {
  id: number
  codigo_mp: string
  descripcion: string | null
  unidad: string
}

export interface EstadoSid {
  id: number
  nombre: string
}

export interface OrdenTrabajo {
  id: number
  numero_ot: string
  cliente: string | null
  diseno: string | null
  fecha_creacion: string
}

// Columnas comerciales espejo 1:1 de la hoja "oc mp" del Excel OC-MP,
// compartidas entre lo que se lee del Excel y lo que se guarda/edita en la
// base de datos vía "Crear OT".
export interface CamposComercialesOt {
  fecha_seguimiento_mp?: string | null
  alm?: string | null
  so?: string | null
  tipo_trabajo?: string | null
  indicador?: string | null
  status_entrega_mp?: string | null
  vendedor?: string | null
  ciudad?: string | null
  fecha_pedido?: string | null
  fecha_entrega?: string | null
  descripcion_producto?: string | null
  codigo_producto?: string | null
  total_ot?: number | null
  entrega_mes?: number | null
  medida?: string | null
  equivalencia_kg?: number | null
  pu_usd?: number | null
  pt_usd?: number | null
  factura_clises?: string | null
  precio_clise_usd?: number | null
  precio_total_pedido_usd?: number | null
}

export interface MaterialPedidoIn {
  material_id: number
  cantidad_requerida?: number | null
}

export interface OtDetalleCreate extends CamposComercialesOt {
  numero_ot: string
  cliente?: string | null
  diseno?: string | null
  materiales: MaterialPedidoIn[]
}

export interface MaterialPedidoOut {
  ot_material_id: number
  material_id: number
  codigo_mp: string
  unidad: string
  cantidad_requerida: number | null
  total_entregado: number
  total_devuelto: number
}

export interface ProcesoDetalleOut {
  ot_proceso_id: number
  proceso_id: number
  proceso: string
  maquina_id: number
  maquina: string
  materiales: MaterialPedidoOut[]
}

export interface OtDetalleOut extends CamposComercialesOt {
  numero_ot: string
  cliente: string | null
  diseno: string | null
  procesos: ProcesoDetalleOut[]
  pendientes: OtMaterialPendiente[]
}

export interface OtMaterialPendiente {
  id: number
  codigo_mp: string
  material_id: number | null
  cantidad_requerida: number | null
}

export interface OtImportada {
  ot: OtDetalleOut
  pendientes: OtMaterialPendiente[]
}

export interface PromoverPendienteIn {
  proceso_id: number
  maquina_id: number
  material_id?: number | null
}

export interface PromoverPendienteOut {
  ot_material_id: number
}

export interface MaterialExcel {
  codigo_mp: string
  cantidad_requerida: number | null
}

// Datos de una OT tal como están en la hoja "oc mp" del Excel, cuando
// todavía no existe en la base de datos.
export interface OtExcel extends CamposComercialesOt {
  numero_ot: string
  cliente: string | null
  materiales: MaterialExcel[]
  total: number | null
}

export interface ConfiguracionExcel {
  ruta: string | null
}

export interface OtBusqueda {
  origen: 'bd' | 'excel' | 'no_encontrada'
  bd: OtDetalleOut | null
  excel: OtExcel | null
}

export interface MaquinaAdmin {
  id: number
  nombre: string
  proceso_id: number
  proceso: string
  activo: boolean
}

export interface MaquinaCreate {
  nombre: string
  proceso_id: number
}

export interface MaquinaUpdate {
  nombre: string
  proceso_id: number
  activo: boolean
}

export interface MaterialAdmin {
  id: number
  codigo_mp: string
  descripcion: string | null
  unidad: string
  activo: boolean
}

export interface MaterialCreate {
  codigo_mp: string
  descripcion?: string | null
  unidad: string
}

export interface MaterialUpdate {
  codigo_mp: string
  descripcion?: string | null
  unidad: string
  activo: boolean
}

export interface EntregaCreate {
  ot_material_id: number
  fecha: string
  bobinas: number[]
}

export interface Entrega {
  id: number
  ot_material_id: number
  numero_ot: string
  proceso: string
  maquina: string
  diseno: string | null
  codigo_mp: string
  unidad: string
  usuario: string
  fecha: string
  bobinas: number[]
  total_entregado: number
  cantidad_requerida: number | null
  total_entregado_pedido: number
}

export interface DevolucionCreate {
  ot_material_id: number
  fecha: string
  bobinas: number[]
}

export interface Devolucion {
  id: number
  ot_material_id: number
  usuario: string
  fecha: string
  bobinas: number[]
  total_devuelto: number
  total_devuelto_pedido: number
}

// Un material pedido dentro de una OT+proceso, con su avance de entrega/devolución.
export interface Consumo {
  ot_material_id: number
  numero_ot: string
  cliente: string | null
  proceso: string
  maquina: string
  diseno: string | null
  codigo_mp: string
  unidad: string
  estado_sid: string
  cantidad_requerida: number | null
  total_entregado: number
  total_devuelto: number
  consumo_neto: number
  estado_entrega: 'PENDIENTE' | 'PARCIAL' | 'COMPLETO' | 'SIN REQUERIMIENTO'
}
