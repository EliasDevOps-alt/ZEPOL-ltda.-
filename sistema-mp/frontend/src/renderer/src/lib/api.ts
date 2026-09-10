import type {
  BalanceMaterial,
  ComparacionExcel,
  ConfiguracionExcel,
  Consumo,
  Devolucion,
  DevolucionCreate,
  DevolucionUpdate,
  EditarMaterialPedidoIn,
  Entrega,
  EntregaCreate,
  EntregaUpdate,
  EstadoSid,
  Maquina,
  MaquinaAdmin,
  MaquinaCreate,
  MaquinaUpdate,
  MoverPedidoIn,
  MoverPedidoOut,
  Material,
  MaterialAdmin,
  MaterialCreate,
  MaterialPedidoOut,
  MaterialUpdate,
  OrdenTrabajo,
  OtBusqueda,
  OtDetalleCreate,
  OtDetalleOut,
  OtExcelNueva,
  OtImportada,
  OtMaterialPendiente,
  Proceso,
  PromoverPendienteIn,
  PromoverPendienteOut,
  Usuario,
  UsuarioAdmin,
  UsuarioCreate,
  UsuarioLogin,
  UsuarioUpdate
} from './types'

export class ApiError extends Error {}

async function request<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.token) headers.Authorization = `Bearer ${options.token}`

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  })

  if (!res.ok) {
    const payload = await res.json().catch(() => null)
    const detail = payload?.detail
    throw new ApiError(typeof detail === 'string' ? detail : `Error ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function login(baseUrl: string, inicial: string, password: string) {
  return request<{ access_token: string; usuario: Usuario }>(baseUrl, '/auth/login', {
    method: 'POST',
    body: { inicial, password }
  })
}

// Público a propósito — se pide antes de iniciar sesión, para el selector
// de usuario en Login.
export function listarUsuariosLogin(baseUrl: string) {
  return request<UsuarioLogin[]>(baseUrl, '/auth/usuarios')
}

export function listarUsuarios(baseUrl: string, token: string) {
  return request<UsuarioAdmin[]>(baseUrl, '/usuarios', { token })
}

export function crearUsuario(baseUrl: string, token: string, data: UsuarioCreate) {
  return request<UsuarioAdmin>(baseUrl, '/usuarios', { method: 'POST', token, body: data })
}

export function actualizarUsuario(baseUrl: string, token: string, id: number, data: UsuarioUpdate) {
  return request<UsuarioAdmin>(baseUrl, `/usuarios/${id}`, { method: 'PUT', token, body: data })
}

export function resetearPasswordUsuario(baseUrl: string, token: string, id: number, password: string) {
  return request<UsuarioAdmin>(baseUrl, `/usuarios/${id}/password`, {
    method: 'PUT',
    token,
    body: { password }
  })
}

export function listarProcesos(baseUrl: string, token: string) {
  return request<Proceso[]>(baseUrl, '/catalogos/procesos', { token })
}

export function listarMaquinas(baseUrl: string, token: string, procesoId: number) {
  return request<Maquina[]>(baseUrl, `/catalogos/maquinas?proceso_id=${procesoId}`, { token })
}

export function listarMateriales(baseUrl: string, token: string) {
  return request<Material[]>(baseUrl, '/catalogos/materiales', { token })
}

export function listarEstadosSid(baseUrl: string, token: string) {
  return request<EstadoSid[]>(baseUrl, '/catalogos/estados-sid', { token })
}

export function registrarEntrega(baseUrl: string, token: string, data: EntregaCreate) {
  return request<Entrega>(baseUrl, '/entregas', { method: 'POST', token, body: data })
}

export function listarEntregas(baseUrl: string, token: string, numeroOt?: string) {
  const qs = numeroOt ? `?numero_ot=${encodeURIComponent(numeroOt)}` : ''
  return request<Entrega[]>(baseUrl, `/entregas${qs}`, { token })
}

// Corregir/borrar una entrega ya registrada — típicamente un error de
// tipeo. Queda registrado en /auditoria (ver Historial.tsx).
export function editarEntrega(baseUrl: string, token: string, entregaId: number, data: EntregaUpdate) {
  return request<Entrega>(baseUrl, `/entregas/${entregaId}`, { method: 'PATCH', token, body: data })
}

export function eliminarEntrega(baseUrl: string, token: string, entregaId: number) {
  return request<void>(baseUrl, `/entregas/${entregaId}`, { method: 'DELETE', token })
}

// Materiales realmente entregados contra un pedido (normalmente uno solo,
// más de uno si hubo sustituciones) — lo usa Registrar Devolución para
// saber contra cuál material validar/registrar.
export function listarMaterialesEntregados(baseUrl: string, token: string, otMaterialId: number) {
  return request<BalanceMaterial[]>(baseUrl, `/entregas/materiales-entregados/${otMaterialId}`, { token })
}

// Corrige el proceso/máquina de un pedido ya creado, con todo lo que ya tenga
// registrado. El proceso se elige antes de saberlo con certeza, así que tiene
// que poder cambiarse sin rehacer la OT.
export function moverPedido(baseUrl: string, token: string, otMaterialId: number, data: MoverPedidoIn) {
  return request<MoverPedidoOut>(baseUrl, `/ot-materiales/${otMaterialId}/proceso`, {
    method: 'PATCH',
    token,
    body: data
  })
}

export function registrarDevolucion(baseUrl: string, token: string, data: DevolucionCreate) {
  return request<Devolucion>(baseUrl, '/devoluciones', { method: 'POST', token, body: data })
}

export function listarDevoluciones(baseUrl: string, token: string, otMaterialId: number) {
  return request<Devolucion[]>(baseUrl, `/devoluciones?ot_material_id=${otMaterialId}`, { token })
}

export function listarDevolucionesPorOt(baseUrl: string, token: string, numeroOt?: string) {
  const qs = numeroOt ? `?numero_ot=${encodeURIComponent(numeroOt)}` : ''
  return request<Devolucion[]>(baseUrl, `/devoluciones${qs}`, { token })
}

// Corregir/borrar una devolución ya registrada — mismo criterio que
// editarEntrega/eliminarEntrega.
export function editarDevolucion(baseUrl: string, token: string, devolucionId: number, data: DevolucionUpdate) {
  return request<Devolucion>(baseUrl, `/devoluciones/${devolucionId}`, { method: 'PATCH', token, body: data })
}

export function eliminarDevolucion(baseUrl: string, token: string, devolucionId: number) {
  return request<void>(baseUrl, `/devoluciones/${devolucionId}`, { method: 'DELETE', token })
}

export function listarOrdenes(
  baseUrl: string,
  token: string,
  opts: { q?: string; desde?: string; hasta?: string } = {}
) {
  const params = new URLSearchParams()
  if (opts.q) params.set('q', opts.q)
  if (opts.desde) params.set('desde', opts.desde)
  if (opts.hasta) params.set('hasta', opts.hasta)
  const qs = params.toString()
  return request<OrdenTrabajo[]>(baseUrl, `/ordenes-trabajo${qs ? `?${qs}` : ''}`, { token })
}

// OT que tienen fila en "oc mp" pero todavía no están en la base de datos —
// para el botón "Buscar OT nuevas en el Excel" de Todas las OT. Cada una se
// trae después una por una con importarOtDesdeExcel, no de una vez.
export function listarOtsNuevasEnExcel(baseUrl: string, token: string) {
  return request<OtExcelNueva[]>(baseUrl, '/ordenes-trabajo/nuevas-en-excel', { token })
}

export function guardarDetalleOt(baseUrl: string, token: string, data: OtDetalleCreate) {
  return request<OtDetalleOut>(baseUrl, '/ordenes-trabajo/detalle', { method: 'POST', token, body: data })
}

export function obtenerDetalleOt(baseUrl: string, token: string, numeroOt: string) {
  return request<OtDetalleOut>(baseUrl, `/ordenes-trabajo/${encodeURIComponent(numeroOt)}/detalle`, { token })
}

export function buscarOtConFallback(baseUrl: string, token: string, numeroOt: string) {
  return request<OtBusqueda>(baseUrl, `/ordenes-trabajo/${encodeURIComponent(numeroOt)}/buscar`, { token })
}

// Borra la OT completa (procesos, pedidos, pendientes, entregas y
// devoluciones) — se rechaza si algún movimiento ya tiene el SID registrado.
export function eliminarOt(baseUrl: string, token: string, numeroOt: string) {
  return request<void>(baseUrl, `/ordenes-trabajo/${encodeURIComponent(numeroOt)}`, { method: 'DELETE', token })
}

export function importarOtDesdeExcel(baseUrl: string, token: string, numeroOt: string) {
  return request<OtImportada>(baseUrl, `/ordenes-trabajo/${encodeURIComponent(numeroOt)}/importar-excel`, {
    method: 'POST',
    token
  })
}

export function reintentarSincronizacionExcel(baseUrl: string, token: string, numeroOt: string) {
  return request<OtDetalleOut>(baseUrl, `/ordenes-trabajo/${encodeURIComponent(numeroOt)}/reintentar-excel`, {
    method: 'POST',
    token
  })
}

// Compara la OT (ya en la base) contra su fila del Excel OC-MP, de solo
// lectura — para revisar qué cambió antes de traerlo.
export function compararConExcel(baseUrl: string, token: string, numeroOt: string) {
  return request<ComparacionExcel>(baseUrl, `/ordenes-trabajo/${encodeURIComponent(numeroOt)}/comparar-excel`, {
    token
  })
}

export function aplicarCambiosExcel(baseUrl: string, token: string, numeroOt: string) {
  return request<OtDetalleOut>(baseUrl, `/ordenes-trabajo/${encodeURIComponent(numeroOt)}/aplicar-excel`, {
    method: 'POST',
    token
  })
}

export function listarPendientes(baseUrl: string, token: string, numeroOt: string) {
  return request<OtMaterialPendiente[]>(baseUrl, `/ordenes-trabajo/${encodeURIComponent(numeroOt)}/pendientes`, {
    token
  })
}

export function promoverPendiente(baseUrl: string, token: string, pendienteId: number, data: PromoverPendienteIn) {
  return request<PromoverPendienteOut>(baseUrl, `/ot-materiales-pendientes/${pendienteId}/promover`, {
    method: 'POST',
    token,
    body: data
  })
}

// Corregir un pendiente (todavía sin proceso/máquina) — típico error de
// tipeo del Excel. Se rechaza si ya se le cargó materia prima o un ingreso.
export function editarPendiente(baseUrl: string, token: string, pendienteId: number, data: EditarMaterialPedidoIn) {
  return request<OtMaterialPendiente>(baseUrl, `/ot-materiales-pendientes/${pendienteId}`, {
    method: 'PATCH',
    token,
    body: data
  })
}

export function eliminarPendiente(baseUrl: string, token: string, pendienteId: number) {
  return request<void>(baseUrl, `/ot-materiales-pendientes/${pendienteId}`, { method: 'DELETE', token })
}

// Igual que editarPendiente/eliminarPendiente pero para un pedido que ya
// tiene proceso/máquina asignado — se rechaza si ya tiene entregas,
// devoluciones o materia prima registrada.
export function editarPedido(baseUrl: string, token: string, otMaterialId: number, data: EditarMaterialPedidoIn) {
  return request<MaterialPedidoOut>(baseUrl, `/ot-materiales/${otMaterialId}`, {
    method: 'PATCH',
    token,
    body: data
  })
}

export function eliminarPedido(baseUrl: string, token: string, otMaterialId: number) {
  return request<void>(baseUrl, `/ot-materiales/${otMaterialId}`, { method: 'DELETE', token })
}

export function consultarConsumo(baseUrl: string, token: string, numeroOt?: string) {
  const qs = numeroOt ? `?numero_ot=${encodeURIComponent(numeroOt)}` : ''
  return request<Consumo[]>(baseUrl, `/consumo${qs}`, { token })
}

export function listarMaterialesAdmin(baseUrl: string, token: string, opts: { q?: string } = {}) {
  const params = new URLSearchParams()
  if (opts.q) params.set('q', opts.q)
  const qs = params.toString()
  return request<MaterialAdmin[]>(baseUrl, `/materiales${qs ? `?${qs}` : ''}`, { token })
}

export function crearMaterial(baseUrl: string, token: string, data: MaterialCreate) {
  return request<MaterialAdmin>(baseUrl, '/materiales', { method: 'POST', token, body: data })
}

export function actualizarMaterial(baseUrl: string, token: string, id: number, data: MaterialUpdate) {
  return request<MaterialAdmin>(baseUrl, `/materiales/${id}`, { method: 'PUT', token, body: data })
}

export function eliminarMaterial(baseUrl: string, token: string, id: number) {
  return request<void>(baseUrl, `/materiales/${id}`, { method: 'DELETE', token })
}

export function listarMaquinasAdmin(baseUrl: string, token: string, opts: { q?: string } = {}) {
  const params = new URLSearchParams()
  if (opts.q) params.set('q', opts.q)
  const qs = params.toString()
  return request<MaquinaAdmin[]>(baseUrl, `/maquinas${qs ? `?${qs}` : ''}`, { token })
}

export function crearMaquina(baseUrl: string, token: string, data: MaquinaCreate) {
  return request<MaquinaAdmin>(baseUrl, '/maquinas', { method: 'POST', token, body: data })
}

export function actualizarMaquina(baseUrl: string, token: string, id: number, data: MaquinaUpdate) {
  return request<MaquinaAdmin>(baseUrl, `/maquinas/${id}`, { method: 'PUT', token, body: data })
}

export function eliminarMaquina(baseUrl: string, token: string, id: number) {
  return request<void>(baseUrl, `/maquinas/${id}`, { method: 'DELETE', token })
}

export function obtenerConfigExcel(baseUrl: string, token: string) {
  return request<ConfiguracionExcel>(baseUrl, '/configuracion/excel-oc-mp', { token })
}

export function actualizarConfigExcel(baseUrl: string, token: string, ruta: string) {
  return request<ConfiguracionExcel>(baseUrl, '/configuracion/excel-oc-mp', { method: 'PUT', token, body: { ruta } })
}

export function actualizarPasswordExcel(baseUrl: string, token: string, password: string) {
  return request<ConfiguracionExcel>(baseUrl, '/configuracion/excel-oc-mp/password', {
    method: 'PUT',
    token,
    body: { password }
  })
}

// El SID se tramita día por día, así que el check vive en cada movimiento
// (entrega/devolución puntual), no en el pedido — ver RegistroSid.tsx.
export function marcarSidEntregaCompletado(baseUrl: string, token: string, entregaId: number) {
  return request<Entrega>(baseUrl, `/entregas/${entregaId}/sid/completado`, { method: 'POST', token })
}

export function marcarSidEntregaPendiente(baseUrl: string, token: string, entregaId: number) {
  return request<Entrega>(baseUrl, `/entregas/${entregaId}/sid/pendiente`, { method: 'POST', token })
}

export function marcarSidDevolucionCompletado(baseUrl: string, token: string, devolucionId: number) {
  return request<Devolucion>(baseUrl, `/devoluciones/${devolucionId}/sid/completado`, { method: 'POST', token })
}

export function marcarSidDevolucionPendiente(baseUrl: string, token: string, devolucionId: number) {
  return request<Devolucion>(baseUrl, `/devoluciones/${devolucionId}/sid/pendiente`, { method: 'POST', token })
}
