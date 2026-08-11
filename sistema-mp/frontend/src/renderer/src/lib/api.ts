import type {
  Consumo,
  Devolucion,
  DevolucionCreate,
  Entrega,
  EntregaCreate,
  EstadoSid,
  Maquina,
  Material,
  MaterialAdmin,
  MaterialCreate,
  MaterialUpdate,
  OrdenTrabajo,
  OtDetalleCreate,
  OtDetalleOut,
  Proceso,
  Usuario
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

export function listarOrdenes(baseUrl: string, token: string, q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : ''
  return request<OrdenTrabajo[]>(baseUrl, `/ordenes-trabajo${qs}`, { token })
}

export function guardarDetalleOt(baseUrl: string, token: string, data: OtDetalleCreate) {
  return request<OtDetalleOut>(baseUrl, '/ordenes-trabajo/detalle', { method: 'POST', token, body: data })
}

export function obtenerDetalleOt(baseUrl: string, token: string, numeroOt: string) {
  return request<OtDetalleOut>(baseUrl, `/ordenes-trabajo/${encodeURIComponent(numeroOt)}/detalle`, { token })
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
