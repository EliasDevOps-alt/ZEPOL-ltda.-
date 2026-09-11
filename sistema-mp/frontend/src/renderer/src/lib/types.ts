export type Rol = 'admin' | 'personal'

// Debe coincidir con security.MODULOS_RESTRINGIBLES en el backend.
export type Modulo =
  | 'crear_ot'
  | 'registrar_entrega'
  | 'registrar_devolucion'
  | 'registro_sid'
  | 'materiales'
  | 'maquinas'
  | 'excel_oc_mp'

export interface Usuario {
  id: number
  inicial: string
  nombre: string
  rol: Rol
  modulos_restringidos: Modulo[]
}

export interface UsuarioLogin {
  inicial: string
  nombre: string
}

export interface UsuarioAdmin {
  id: number
  inicial: string
  nombre: string
  rol: Rol
  activo: boolean
  modulos_restringidos: Modulo[]
}

export interface UsuarioCreate {
  inicial: string
  nombre: string
  rol: Rol
  password: string
  modulos_restringidos: Modulo[]
}

export interface UsuarioUpdate {
  nombre: string
  rol: Rol
  activo: boolean
  modulos_restringidos: Modulo[]
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
  es_tinta: boolean
  // Si se entrega/devuelve como varias bobinas con su propio peso cada una,
  // o como un solo campo de cantidad total (ej. ZIPPER es "mts" pero no usa
  // bobinas) — no se deriva de la unidad, es una propiedad aparte.
  usa_bobinas: boolean
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
  sincronizado_excel: boolean
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

// Corrige el material y/o la cantidad de un pendiente o de un pedido ya
// asignado — se rechaza si ya tiene algún movimiento real (entregas,
// devoluciones, materia prima, ingresos).
export interface EditarMaterialPedidoIn {
  material_id?: number | null
  cantidad_requerida?: number | null
}

export interface OtDetalleOut extends CamposComercialesOt {
  numero_ot: string
  cliente: string | null
  diseno: string | null
  sincronizado_excel: boolean
  excel_sync_error: string | null
  procesos: ProcesoDetalleOut[]
  pendientes: OtMaterialPendiente[]
}

export interface OtMaterialPendiente {
  id: number
  codigo_mp: string
  material_id: number | null
  cantidad_requerida: number | null
  es_tinta: boolean
  // Materia prima ya entregada para fabricar este material, mientras el
  // pendiente sigue sin proceso asignado.
  materias_primas: string[]
  // Cuánto de este material ya entró a almacén fabricado, sin pedido todavía.
  total_ingresado: number
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
  tiene_password: boolean
}

// Una fila de "oc mp" cuyo número de OT todavía no está en la base de datos
// — ver "Buscar OT nuevas en el Excel" en Todas las OT. Solo lo mínimo para
// identificarla en pantalla; importarla trae el resto (importarOtDesdeExcel).
export interface OtExcelNueva {
  numero_ot: string
  cliente: string | null
  descripcion_producto: string | null
}

export interface OtBusqueda {
  origen: 'bd' | 'excel' | 'no_encontrada'
  bd: OtDetalleOut | null
  excel: OtExcel | null
}

export interface DiferenciaExcel {
  campo: string
  etiqueta: string
  valor_sistema: string | null
  valor_excel: string | null
}

// Resultado de comparar una OT que ya está en la base contra su fila en el
// Excel OC-MP — de solo lectura, para revisar antes de traer los cambios.
export interface ComparacionExcel {
  encontrado_en_excel: boolean
  diferencias_comerciales: DiferenciaExcel[]
  materiales_nuevos: MaterialExcel[]
}

// Una OT (de las que ya están en el sistema) con diferencias reales al
// compararla contra el Excel OC-MP, de la comparación masiva.
export interface ComparacionMasivaItem {
  numero_ot: string
  cliente: string | null
  diferencias_comerciales: DiferenciaExcel[]
  materiales_nuevos: MaterialExcel[]
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
  es_tinta: boolean
  usa_bobinas: boolean
}

export interface MaterialCreate {
  codigo_mp: string
  descripcion?: string | null
  unidad: string
  es_tinta?: boolean
  usa_bobinas?: boolean
}

export interface MaterialUpdate {
  codigo_mp: string
  descripcion?: string | null
  unidad: string
  activo: boolean
  es_tinta: boolean
  usa_bobinas: boolean
}

// La entrega no siempre queda contra el pedido que el operador tiene en
// pantalla. Dos modos, excluyentes entre sí:
//  1. Normal: contra ot_material_id, con material_id si almacén dio una
//     alternativa o un cambio de estructura (sustitución 1 a 1).
//  2. como_materia_prima: hizo falta OTRO material para poder completar el del
//     pedido (la OT pide LDPE-4 y se fabrica mezclando LDPE-1 y LDPE-2). No es
//     sustitución: esa materia prima obtiene su PROPIO pedido, en el proceso y
//     la máquina donde se consume —que no tienen por qué ser los del pedido que
//     completa— y la entrega va contra ese. Vale para cualquier proceso.
export interface EntregaCreate {
  // Exactamente uno de los tres. pendiente_id solo vale con
  // como_materia_prima: es materia prima para un material que todavía no
  // tiene proceso asignado. numero_ot: el material ni siquiera está cargado
  // en la OT — crea un pedido suelto (sin marcarlo como materia prima de
  // nada), con proceso/máquina/material obligatorios.
  ot_material_id?: number
  pendiente_id?: number
  numero_ot?: string
  fecha: string
  bobinas: number[]
  // Obligatorio con como_materia_prima (el material que sale de almacén).
  material_id?: number | null
  observacion?: string | null
  como_materia_prima?: boolean
  // Doble función según el modo: con como_materia_prima, obligatorios (dónde
  // se consume esa materia prima). Sin como_materia_prima, opcionales — un
  // proceso/máquina distinto del "hogar" del pedido para ESTA entrega puntual
  // (ej. una tanda salió en otra máquina), sin mover el pedido ni sus otras
  // entregas. Sin indicar nada, se consume donde vive el pedido.
  proceso_id?: number | null
  maquina_id?: number | null
}

export interface Entrega {
  id: number
  ot_material_id: number
  numero_ot: string
  // Proceso/máquina donde REALMENTE se consumió esta entrega puntual — el
  // del pedido, salvo que se haya indicado uno distinto (ver
  // EntregaCreate.proceso_id/maquina_id). Comparar contra el proceso/máquina
  // del pedido (Consumo.proceso/maquina) para saber si conviene resaltarlo.
  proceso: string
  proceso_id: number
  maquina: string
  maquina_id: number
  diseno: string | null
  codigo_mp: string
  unidad: string
  usuario: string
  fecha: string
  hora: string
  bobinas: number[]
  total_entregado: number
  cantidad_requerida: number | null
  total_entregado_pedido: number
  material_entregado_id: number
  codigo_mp_entregado: string
  descripcion_entregado: string | null
  usa_bobinas: boolean
  sid_completado: boolean
  observacion: string | null
  // ot_material_id/proceso/codigo_mp de arriba son los del pedido donde
  // REALMENTE quedó la entrega, que con como_materia_prima no es el que estaba
  // seleccionado. Esto avisa que ese pedido se acaba de crear.
  pedido_creado: boolean
  // Quién la corrigió por última vez y cuándo — null mientras nadie la
  // corrigió. Se muestra en la propia ficha en Historial.
  editado_por: string | null
  editado_en: string | null
}

// Corregir una entrega ya registrada — solo lo que venga se cambia, el
// resto queda igual. No se puede reasignar a qué pedido queda (ver
// MoverPedido para mover un pedido completo).
export interface EntregaUpdate {
  fecha?: string
  bobinas?: number[]
  material_id?: number | null
  observacion?: string | null
  // Corrige dónde se consumió esta entrega puntual (no mueve el pedido).
  // Mandar ambos, o ninguno.
  proceso_id?: number | null
  maquina_id?: number | null
}

export interface BalanceMaterial {
  material_id: number
  codigo_mp: string
  descripcion: string | null
  unidad: string
  usa_bobinas: boolean
  total_entregado: number
  total_devuelto: number
  disponible: number
}

export interface MoverPedidoIn {
  proceso_id: number
  maquina_id: number
}

export interface MoverPedidoOut {
  ot_material_id: number
  proceso: string
  maquina: string
}

export interface DevolucionCreate {
  // Uno de los dos, no ambos. pendiente_id es para el material fabricado que
  // entra a almacén antes de tener pedido: registrar eso no necesita proceso ni
  // máquina, porque almacén no tiene máquinas. Solo vale con es_ingreso_produccion.
  ot_material_id?: number
  pendiente_id?: number
  material_id: number
  fecha: string
  bobinas: number[]
  // TRUE = material FABRICADO en esta OT entrando a almacén, no un sobrante.
  es_ingreso_produccion?: boolean
}

export interface Devolucion {
  id: number
  // null mientras el material que entró a almacén no tenga pedido todavía.
  ot_material_id: number | null
  pendiente_id: number | null
  material_id: number
  codigo_mp: string
  usuario: string
  fecha: string
  hora: string
  bobinas: number[]
  total_devuelto: number
  total_devuelto_pedido: number
  usa_bobinas: boolean
  sid_completado: boolean
  es_ingreso_produccion: boolean
  // Quién la corrigió por última vez y cuándo — ver Entrega.editado_por.
  editado_por: string | null
  editado_en: string | null
}

// Corregir una devolución ya registrada — mismo criterio que EntregaUpdate.
export interface DevolucionUpdate {
  fecha?: string
  bobinas?: number[]
  material_id?: number | null
}

// Un material pedido dentro de una OT+proceso, con su avance de entrega/devolución.
export interface Consumo {
  ot_material_id: number
  numero_ot: string
  cliente: string | null
  proceso: string
  // IDs del proceso/máquina "hogar" del pedido — para preseleccionar el
  // picker al registrar una entrega y para detectar si una entrega puntual
  // quedó en un proceso/máquina distinto (ver Entrega.proceso/maquina).
  proceso_id: number
  maquina: string
  maquina_id: number
  diseno: string | null
  material_id: number
  codigo_mp: string
  descripcion: string | null
  unidad: string
  es_tinta: boolean
  usa_bobinas: boolean
  // TRUE si este pedido es una materia prima que hizo falta para completar
  // otro pedido de la OT.
  es_materia_prima: boolean
  // Código del material que se completa con esta materia prima (ej. LDPE-4).
  insumo_de_codigo_mp: string | null
  // TRUE si a este pedido se le agregó materia prima — su material se fabrica
  // en esta OT en vez de salir de almacén tal cual.
  tiene_materia_prima: boolean
  estado_sid: string
  sid_devolucion_completado: boolean
  cantidad_requerida: number | null
  total_entregado: number
  // Sobrantes que volvieron de planta. No incluye el material fabricado que
  // entró a almacén — eso es total_ingresado.
  total_devuelto: number
  // Material fabricado en esta OT que entró a almacén. 0 en un pedido normal.
  total_ingresado: number
  consumo_neto: number
  estado_entrega: 'PENDIENTE' | 'PARCIAL' | 'COMPLETO' | 'SIN REQUERIMIENTO'
  // TRUE si alguna entrega/devolución de este pedido fue de un material
  // distinto al pedido (alternativa o cambio de estructura).
  material_sustituido: boolean
}

