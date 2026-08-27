import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Beaker, PackageCheck, PackageX, Pencil, Search, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Combobox } from '@renderer/components/ui/combobox'
import { CampoCantidad, type BobinasPedido } from '@renderer/components/CampoCantidad'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import type { Consumo, Devolucion, Entrega, Material, Proceso } from '@renderer/lib/types'

const ESTILO_ESTADO: Record<Consumo['estado_entrega'], string> = {
  COMPLETO: 'bg-success/10 text-success',
  PARCIAL: 'bg-warning/10 text-warning',
  PENDIENTE: 'bg-muted text-muted-foreground',
  'SIN REQUERIMIENTO': 'bg-muted text-muted-foreground'
}

function bobinasDesde(valores: number[]): BobinasPedido {
  return {
    cantidadBobinas: valores.length ? String(valores.length) : '1',
    bobinas: valores.length ? valores.map(String) : ['']
  }
}

/** Corregir/borrar una entrega ya registrada — el personal de planta no
 * siempre tipea bien a la primera y hasta ahora no había forma de arreglar
 * una cantidad o fecha mal cargada. Igual que en Crear OT/Registrar Entrega,
 * queda como formulario inline detrás de un lápiz en vez de un modal aparte.
 * Quién corrigió y cuándo se muestra directo en la ficha (Entrega.editado_por),
 * no en un registro aparte. */
function FilaEntrega({
  entrega,
  pedido,
  materiales,
  materialOptions,
  procesos,
  onCambiado
}: {
  entrega: Entrega
  // Proceso/máquina del pedido, para saber si esta entrega puntual quedó en
  // uno distinto y para preseleccionar el picker al corregirla.
  pedido: { proceso: string; proceso_id: number; maquina: string; maquina_id: number }
  materiales: Material[]
  materialOptions: { value: string; label: string }[]
  procesos: Proceso[]
  onCambiado: () => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [editando, setEditando] = useState(false)
  const [fecha, setFecha] = useState(entrega.fecha)
  const [materialId, setMaterialId] = useState(String(entrega.material_entregado_id))
  const [observacion, setObservacion] = useState(entrega.observacion ?? '')
  const [seleccion, setSeleccion] = useState<BobinasPedido>(() => bobinasDesde(entrega.bobinas))
  const [procesoId, setProcesoId] = useState(String(entrega.proceso_id))
  const [maquinaId, setMaquinaId] = useState(String(entrega.maquina_id))
  const [error, setError] = useState<string | null>(null)

  const material = materiales.find((m) => String(m.id) === materialId)
  const unidad = material?.unidad ?? entrega.unidad
  const usaBobinas = material?.usa_bobinas ?? entrega.usa_bobinas
  const maquinaDistinta = entrega.proceso_id !== pedido.proceso_id || entrega.maquina_id !== pedido.maquina_id

  const maquinas = useQuery({
    queryKey: ['maquinas', procesoId],
    queryFn: () => api.listarMaquinas(apiBaseUrl, token, Number(procesoId)),
    enabled: editando && !!procesoId
  })

  const editar = useMutation({
    mutationFn: () =>
      api.editarEntrega(apiBaseUrl, token, entrega.id, {
        fecha,
        material_id: Number(materialId),
        observacion: observacion || null,
        bobinas: seleccion.bobinas.map(Number).filter((n) => n > 0),
        proceso_id: Number(procesoId),
        maquina_id: Number(maquinaId)
      }),
    onSuccess: () => {
      setEditando(false)
      setError(null)
      onCambiado()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo guardar')
  })

  const eliminar = useMutation({
    mutationFn: () => api.eliminarEntrega(apiBaseUrl, token, entrega.id),
    onSuccess: onCambiado,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo eliminar')
  })

  function handleEliminar() {
    if (!confirm(`¿Eliminar esta entrega de ${entrega.codigo_mp_entregado}? Esta acción no se puede deshacer.`))
      return
    eliminar.mutate()
  }

  if (!editando) {
    return (
      <div className="rounded-md border border-border p-2 text-xs">
        <div className="flex justify-between">
          <span>
            {entrega.fecha} · {entrega.codigo_mp_entregado}
            {entrega.codigo_mp_entregado !== entrega.codigo_mp ? (
              <span className="text-warning"> (pedido: {entrega.codigo_mp})</span>
            ) : (
              ''
            )}
            {maquinaDistinta && (
              <span className="text-warning">
                {' '}
                ({entrega.proceso} · {entrega.maquina}; pedido: {pedido.proceso} · {pedido.maquina})
              </span>
            )}
          </span>
          <span className="font-medium">
            {entrega.total_entregado} {entrega.unidad}
          </span>
        </div>
        <p className="text-muted-foreground">{entrega.usuario}</p>
        {entrega.observacion && <p className="text-muted-foreground">Nota: {entrega.observacion}</p>}
        {entrega.usa_bobinas && (
          <p className="mt-1 text-muted-foreground">
            {entrega.bobinas.length} {entrega.bobinas.length === 1 ? 'bobina' : 'bobinas'}:{' '}
            {entrega.bobinas.map((b) => `${b} ${entrega.unidad}`).join(', ')}
          </p>
        )}
        {entrega.editado_por && (
          <p className="mt-1 text-primary">
            Editado por {entrega.editado_por} el {new Date(entrega.editado_en!).toLocaleDateString('es-BO')}
          </p>
        )}
        {error && <p className="mt-1 text-destructive">{error}</p>}
        <div className="mt-2 flex gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditando(true)}>
            <Pencil className="h-3 w-3" />
            Corregir
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={eliminar.isPending}
            onClick={handleEliminar}
          >
            <Trash2 className="h-3 w-3" />
            {eliminar.isPending ? 'Eliminando...' : 'Eliminar'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
      <div className="mb-2 flex flex-col gap-1.5">
        <Label className="text-xs">Fecha</Label>
        <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </div>
      <div className="mb-2 flex flex-col gap-1.5">
        <Label className="text-xs">Material entregado</Label>
        <Combobox
          value={materialId}
          onChange={setMaterialId}
          options={materialOptions}
          placeholder="Buscar código MP..."
          emptyText="Sin materiales activos que coincidan"
        />
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Proceso</Label>
          <Select
            value={procesoId}
            onValueChange={(v) => {
              setProcesoId(v)
              setMaquinaId('')
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Proceso" />
            </SelectTrigger>
            <SelectContent>
              {procesos.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Máquina</Label>
          <Select value={maquinaId} onValueChange={setMaquinaId} disabled={!procesoId}>
            <SelectTrigger>
              <SelectValue placeholder="Máquina" />
            </SelectTrigger>
            <SelectContent>
              {maquinas.data?.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <CampoCantidad unidad={unidad} usaBobinas={usaBobinas} datos={seleccion} onChange={setSeleccion} />
      <div className="mt-2 flex flex-col gap-1.5">
        <Label className="text-xs">Nota (opcional)</Label>
        <Input value={observacion} onChange={(e) => setObservacion(e.target.value)} />
      </div>
      {error && <p className="mt-2 text-destructive">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" disabled={editar.isPending} onClick={() => editar.mutate()}>
          {editar.isPending ? 'Guardando...' : 'Guardar'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditando(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

/** Igual que FilaEntrega pero para devoluciones/ingresos — ver esa nota. No
 * se restringe el material a "lo que se entregó" como en el formulario de
 * registrar (RegistrarDevolucion.tsx): acá se corrige un dato ya cargado, no
 * se valida contra el saldo disponible. */
function FilaDevolucion({
  devolucion,
  pedidoUnidad,
  materiales,
  materialOptions,
  onCambiado
}: {
  devolucion: Devolucion
  pedidoUnidad: string
  materiales: Material[]
  materialOptions: { value: string; label: string }[]
  onCambiado: () => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [editando, setEditando] = useState(false)
  const [fecha, setFecha] = useState(devolucion.fecha)
  const [materialId, setMaterialId] = useState(String(devolucion.material_id))
  const [seleccion, setSeleccion] = useState<BobinasPedido>(() => bobinasDesde(devolucion.bobinas))
  const [error, setError] = useState<string | null>(null)

  const material = materiales.find((m) => String(m.id) === materialId)
  const unidad = material?.unidad ?? pedidoUnidad
  const usaBobinas = material?.usa_bobinas ?? devolucion.usa_bobinas

  const editar = useMutation({
    mutationFn: () =>
      api.editarDevolucion(apiBaseUrl, token, devolucion.id, {
        fecha,
        material_id: Number(materialId),
        bobinas: seleccion.bobinas.map(Number).filter((n) => n > 0)
      }),
    onSuccess: () => {
      setEditando(false)
      setError(null)
      onCambiado()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo guardar')
  })

  const eliminar = useMutation({
    mutationFn: () => api.eliminarDevolucion(apiBaseUrl, token, devolucion.id),
    onSuccess: onCambiado,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo eliminar')
  })

  function handleEliminar() {
    if (!confirm(`¿Eliminar esta devolución de ${devolucion.codigo_mp}? Esta acción no se puede deshacer.`)) return
    eliminar.mutate()
  }

  if (!editando) {
    return (
      <div className="rounded-md border border-border p-2 text-xs">
        <div className="flex justify-between">
          <span>
            {devolucion.fecha} · {devolucion.codigo_mp}
            {devolucion.es_ingreso_produccion && <span className="text-warning"> (ingreso a almacén)</span>}
          </span>
          <span className="font-medium">
            {devolucion.total_devuelto} {pedidoUnidad}
          </span>
        </div>
        <p className="text-muted-foreground">{devolucion.usuario}</p>
        {devolucion.usa_bobinas && (
          <p className="mt-1 text-muted-foreground">
            {devolucion.bobinas.length} {devolucion.bobinas.length === 1 ? 'bobina' : 'bobinas'}:{' '}
            {devolucion.bobinas.map((b) => `${b} ${pedidoUnidad}`).join(', ')}
          </p>
        )}
        {devolucion.editado_por && (
          <p className="mt-1 text-primary">
            Editado por {devolucion.editado_por} el {new Date(devolucion.editado_en!).toLocaleDateString('es-BO')}
          </p>
        )}
        {error && <p className="mt-1 text-destructive">{error}</p>}
        <div className="mt-2 flex gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditando(true)}>
            <Pencil className="h-3 w-3" />
            Corregir
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={eliminar.isPending}
            onClick={handleEliminar}
          >
            <Trash2 className="h-3 w-3" />
            {eliminar.isPending ? 'Eliminando...' : 'Eliminar'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
      <div className="mb-2 flex flex-col gap-1.5">
        <Label className="text-xs">Fecha</Label>
        <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </div>
      <div className="mb-2 flex flex-col gap-1.5">
        <Label className="text-xs">Material</Label>
        <Combobox
          value={materialId}
          onChange={setMaterialId}
          options={materialOptions}
          placeholder="Buscar código MP..."
          emptyText="Sin materiales activos que coincidan"
        />
      </div>
      <CampoCantidad unidad={unidad} usaBobinas={usaBobinas} datos={seleccion} onChange={setSeleccion} />
      {error && <p className="mt-2 text-destructive">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" disabled={editar.isPending} onClick={() => editar.mutate()}>
          {editar.isPending ? 'Guardando...' : 'Guardar'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditando(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

export function Historial() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [q, setQ] = useState('')

  const ordenes = useQuery({
    queryKey: ['ordenes-trabajo', q],
    queryFn: () => api.listarOrdenes(apiBaseUrl, token, { q: q || undefined })
  })

  const consumo = useQuery({
    queryKey: ['consumo-todos'],
    queryFn: () => api.consultarConsumo(apiBaseUrl, token)
  })
  const entregas = useQuery({
    queryKey: ['entregas-todas'],
    queryFn: () => api.listarEntregas(apiBaseUrl, token)
  })
  const devoluciones = useQuery({
    queryKey: ['devoluciones-todas'],
    queryFn: () => api.listarDevolucionesPorOt(apiBaseUrl, token)
  })
  const materiales = useQuery({ queryKey: ['materiales'], queryFn: () => api.listarMateriales(apiBaseUrl, token) })
  const procesos = useQuery({ queryKey: ['procesos'], queryFn: () => api.listarProcesos(apiBaseUrl, token) })
  const materialOptions = useMemo(
    () =>
      (materiales.data ?? []).map((m) => ({
        value: String(m.id),
        label: m.codigo_mp + (m.descripcion ? ` — ${m.descripcion}` : '')
      })),
    [materiales.data]
  )

  // Corregir o borrar una entrega/devolución cambia lo que ya se mostró acá
  // (totales, estado del pedido, quién la editó) — refrescar las consultas es
  // más simple y confiable que actualizar el cache a mano.
  function alCorregirMovimiento() {
    queryClient.invalidateQueries({ queryKey: ['entregas-todas'] })
    queryClient.invalidateQueries({ queryKey: ['devoluciones-todas'] })
    queryClient.invalidateQueries({ queryKey: ['consumo-todos'] })
  }

  const consumoPorOt = useMemo(() => {
    const mapa = new Map<string, Consumo[]>()
    for (const p of consumo.data ?? []) {
      mapa.set(p.numero_ot, [...(mapa.get(p.numero_ot) ?? []), p])
    }
    return mapa
  }, [consumo.data])

  const entregasPorPedido = useMemo(() => {
    const mapa = new Map<number, typeof entregas.data>()
    for (const e of entregas.data ?? []) {
      mapa.set(e.ot_material_id, [...(mapa.get(e.ot_material_id) ?? []), e])
    }
    return mapa
  }, [entregas.data])

  // Un ingreso a almacén puede no tener pedido todavía (el material se fabricó
  // pero aún no salió hacia ningún proceso). Esos no se agrupan acá: aparecen
  // en la tarjeta del pedido recién cuando se le asigna uno.
  const devolucionesPorPedido = useMemo(() => {
    const mapa = new Map<number, typeof devoluciones.data>()
    for (const d of devoluciones.data ?? []) {
      if (d.ot_material_id == null) continue
      mapa.set(d.ot_material_id, [...(mapa.get(d.ot_material_id) ?? []), d])
    }
    return mapa
  }, [devoluciones.data])

  function buscar(e: FormEvent) {
    e.preventDefault()
    ordenes.refetch()
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Historial de OT</h1>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form onSubmit={buscar} className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar OT, cliente, diseño..." />
            <Button type="submit" variant="outline" size="sm">
              <Search className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>

      {ordenes.isError && (
        <p className="text-sm text-destructive">
          No se pudo cargar: {ordenes.error instanceof ApiError ? ordenes.error.message : 'error de conexión'}
        </p>
      )}
      {consumo.isError && (
        <p className="text-sm text-destructive">
          No se pudo cargar el detalle:{' '}
          {consumo.error instanceof ApiError ? consumo.error.message : 'error de conexión'}
        </p>
      )}

      {ordenes.data && ordenes.data.length === 0 && (
        <p className="text-sm text-muted-foreground">Sin órdenes de trabajo todavía.</p>
      )}

      <div className="flex flex-col gap-8">
        {ordenes.data?.map((ot) => {
          const pedidos = consumoPorOt.get(ot.numero_ot) ?? []
          return (
            <div key={ot.id}>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
                <div>
                  <p className="text-lg font-semibold">OT {ot.numero_ot}</p>
                  <p className="text-sm text-muted-foreground">
                    {ot.cliente ?? 'Sin cliente'}
                    {ot.diseno ? ` · ${ot.diseno}` : ''}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(ot.fecha_creacion).toLocaleDateString('es-BO')}
                </p>
              </div>

              {pedidos.length === 0 && (
                <p className="text-sm text-muted-foreground">Esta OT todavía no tiene materiales entregados.</p>
              )}

              <div className="flex flex-col gap-4">
                {pedidos.map((pedido) => {
                  const susEntregas = entregasPorPedido.get(pedido.ot_material_id) ?? []
                  const susDevoluciones = devolucionesPorPedido.get(pedido.ot_material_id) ?? []
                  const materialesSustituidos = [
                    ...new Set(
                      susEntregas
                        .map((e) => e.codigo_mp_entregado)
                        .filter((codigo) => codigo !== pedido.codigo_mp)
                    )
                  ]
                  return (
                    <Card key={pedido.ot_material_id}>
                      <CardHeader className="flex-row items-start justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="text-base">{pedido.codigo_mp}</CardTitle>
                            {pedido.tiene_materia_prima && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                <Beaker className="h-3 w-3" />
                                se fabrica en esta OT
                              </span>
                            )}
                            {pedido.es_materia_prima && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                materia prima de {pedido.insumo_de_codigo_mp}
                              </span>
                            )}
                            {materialesSustituidos.length > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                                <ArrowRightLeft className="h-3 w-3" />
                                {materialesSustituidos.join(', ')}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {pedido.proceso} · {pedido.maquina}
                          </p>
                        </div>
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', ESTILO_ESTADO[pedido.estado_entrega])}>
                          {pedido.estado_entrega}
                        </span>
                      </CardHeader>
                      <CardContent>
                        {/* "Ingresó a almacén" solo aparece si el material de
                            este pedido se fabricó en la OT — es material que
                            entra por primera vez, no un sobrante, así que no
                            descuenta del consumo neto. */}
                        <div
                          className={cn(
                            'mb-4 grid grid-cols-2 gap-3',
                            pedido.total_ingresado > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
                          )}
                        >
                          <div className="rounded-md bg-muted p-3">
                            <p className="text-xs text-muted-foreground">Requerido</p>
                            <p className="font-medium">
                              {pedido.cantidad_requerida ?? '—'} {pedido.cantidad_requerida ? pedido.unidad : ''}
                            </p>
                          </div>
                          {pedido.total_ingresado > 0 && (
                            <div className="rounded-md bg-muted p-3">
                              <p className="text-xs text-muted-foreground">Ingresó a almacén</p>
                              <p className="font-medium">
                                {pedido.total_ingresado} {pedido.unidad}
                              </p>
                            </div>
                          )}
                          <div className="rounded-md bg-muted p-3">
                            <p className="text-xs text-muted-foreground">Entregado</p>
                            <p className="font-medium">
                              {pedido.total_entregado} {pedido.unidad}
                            </p>
                          </div>
                          <div className="rounded-md bg-muted p-3">
                            <p className="text-xs text-muted-foreground">Devuelto</p>
                            <p className="font-medium">
                              {pedido.total_devuelto} {pedido.unidad}
                            </p>
                          </div>
                          <div className="rounded-md bg-muted p-3">
                            <p className="text-xs text-muted-foreground">Consumo neto</p>
                            <p className="font-medium">
                              {pedido.consumo_neto} {pedido.unidad}
                            </p>
                          </div>
                        </div>

                        {pedido.cantidad_requerida != null &&
                          pedido.cantidad_requerida - pedido.total_entregado > 0 && (
                            <p className="mb-4 text-xs text-muted-foreground">
                              Aún falta entregar:{' '}
                              {(pedido.cantidad_requerida - pedido.total_entregado).toFixed(2)} {pedido.unidad}
                            </p>
                          )}

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div>
                            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                              <PackageCheck className="h-3.5 w-3.5" />
                              Entregas ({susEntregas.length})
                            </p>
                            <div className="flex flex-col gap-2">
                              {susEntregas.map((e) => (
                                <FilaEntrega
                                  key={e.id}
                                  entrega={e}
                                  pedido={pedido}
                                  materiales={materiales.data ?? []}
                                  materialOptions={materialOptions}
                                  procesos={procesos.data ?? []}
                                  onCambiado={alCorregirMovimiento}
                                />
                              ))}
                              {susEntregas.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                  {pedido.tiene_materia_prima
                                    ? 'Sin entregas todavía — primero se fabrica con su materia prima.'
                                    : 'Sin entregas.'}
                                </p>
                              )}
                            </div>
                          </div>

                          <div>
                            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                              <PackageX className="h-3.5 w-3.5" />
                              {/* La misma lista mezcla sobrantes que vuelven e
                                  ingresos de material fabricado; cada fila dice
                                  cuál es. */}
                              Devoluciones e ingresos ({susDevoluciones.length})
                            </p>
                            <div className="flex flex-col gap-2">
                              {susDevoluciones.map((d) => (
                                <FilaDevolucion
                                  key={d.id}
                                  devolucion={d}
                                  pedidoUnidad={pedido.unidad}
                                  materiales={materiales.data ?? []}
                                  materialOptions={materialOptions}
                                  onCambiado={alCorregirMovimiento}
                                />
                              ))}
                              {susDevoluciones.length === 0 && (
                                <p className="text-xs text-muted-foreground">Sin devoluciones.</p>
                              )}
                            </div>
                          </div>

                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
