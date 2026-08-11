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

export interface MaterialPedidoIn {
  material_id: number
  cantidad_requerida?: number | null
}

export interface ProcesoDetalleIn {
  proceso_id: number
  maquina_id: number
  materiales: MaterialPedidoIn[]
}

export interface OtDetalleCreate {
  numero_ot: string
  cliente?: string | null
  diseno?: string | null
  procesos: ProcesoDetalleIn[]
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

export interface OtDetalleOut {
  numero_ot: string
  cliente: string | null
  diseno: string | null
  procesos: ProcesoDetalleOut[]
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
