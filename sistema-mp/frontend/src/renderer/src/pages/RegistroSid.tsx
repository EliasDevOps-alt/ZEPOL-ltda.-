import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Beaker } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Card, CardContent } from '@renderer/components/ui/card'
import { CeldaCopiable } from '@renderer/components/ui/celda-copiable'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import type { Consumo, Devolucion, Entrega } from '@renderer/lib/types'

type Pestana = 'entregados' | 'devueltos'
type Filtro = 'pendientes' | 'completados' | 'todos'

const PESTANAS: { valor: Pestana; etiqueta: string }[] = [
  { valor: 'entregados', etiqueta: 'Entregados' },
  { valor: 'devueltos', etiqueta: 'Devueltos' }
]

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'pendientes', etiqueta: 'Pendientes' },
  { valor: 'completados', etiqueta: 'Completados' },
  { valor: 'todos', etiqueta: 'Todos' }
]

// Completo = TODOS los movimientos de ese tipo ya tienen su check marcado
// (lo mantiene al día el backend: ver sid_controller.recalcular_estado_entrega/
// recalcular_sid_devolucion). Un movimiento nuevo sin registrar reabre esto
// solo, sin que nadie tenga que "desmarcar" nada a mano.
function estaCompletado(pedido: Consumo, pestana: Pestana): boolean {
  return pestana === 'entregados' ? pedido.estado_sid === 'COMPLETADO' : pedido.sid_devolucion_completado
}

export function RegistroSid() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [pestana, setPestana] = useState<Pestana>('entregados')
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('pendientes')
  const [error, setError] = useState<string | null>(null)

  const pedidos = useQuery({
    queryKey: ['consumo-sid'],
    queryFn: () => api.consultarConsumo(apiBaseUrl, token)
  })

  // Detalle de entregas/devoluciones por pedido — una sola consulta para todo
  // el listado (no una por fila), igual que en Historial de OT. El SID se
  // tramita día por día, así que cada movimiento aparece con su propia fecha
  // y su propio check en vez de un único total agregado.
  const entregas = useQuery({
    queryKey: ['entregas-todas'],
    queryFn: () => api.listarEntregas(apiBaseUrl, token)
  })
  const devoluciones = useQuery({
    queryKey: ['devoluciones-todas'],
    queryFn: () => api.listarDevolucionesPorOt(apiBaseUrl, token)
  })

  const entregasPorPedido = useMemo(() => {
    const mapa = new Map<number, Entrega[]>()
    for (const e of entregas.data ?? []) mapa.set(e.ot_material_id, [...(mapa.get(e.ot_material_id) ?? []), e])
    return mapa
  }, [entregas.data])

  // Un ingreso a almacén puede no tener pedido todavía (el material se fabricó
  // pero aún no salió hacia ningún proceso); esos no tienen SID que tramitar
  // hasta que se les asigne uno.
  const devolucionesPorPedido = useMemo(() => {
    const mapa = new Map<number, Devolucion[]>()
    for (const d of devoluciones.data ?? []) {
      if (d.ot_material_id == null) continue
      mapa.set(d.ot_material_id, [...(mapa.get(d.ot_material_id) ?? []), d])
    }
    return mapa
  }, [devoluciones.data])

  const alFallar = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'No se pudo actualizar el estado SID')

  const marcarEntregaSid = useMutation({
    mutationFn: ({ id, completado }: { id: number; completado: boolean }) =>
      completado
        ? api.marcarSidEntregaCompletado(apiBaseUrl, token, id)
        : api.marcarSidEntregaPendiente(apiBaseUrl, token, id),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['consumo-sid'] })
      queryClient.invalidateQueries({ queryKey: ['entregas-todas'] })
    },
    onError: alFallar
  })

  const marcarDevolucionSid = useMutation({
    mutationFn: ({ id, completado }: { id: number; completado: boolean }) =>
      completado
        ? api.marcarSidDevolucionCompletado(apiBaseUrl, token, id)
        : api.marcarSidDevolucionPendiente(apiBaseUrl, token, id),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['consumo-sid'] })
      queryClient.invalidateQueries({ queryKey: ['devoluciones-todas'] })
    },
    onError: alFallar
  })

  // Los cargos de tinta nunca se entregan/devuelven en planta (ver Registrar
  // Entrega/Devolución), así que tampoco cuentan aquí.
  const pedidosNoTinta = useMemo(() => (pedidos.data ?? []).filter((p) => !p.es_tinta), [pedidos.data])

  // Solo listamos lo que realmente ya se movió — nada de "cantidad entregada
  // 0" mezclado con lo que sí se entregó. En la pestaña de devueltos cuentan
  // también los ingresos de material fabricado: son movimientos hacia almacén
  // con su propio trámite, igual que un sobrante.
  const visiblesEnPestana = useMemo(
    () =>
      pedidosNoTinta.filter((p) =>
        pestana === 'entregados' ? p.total_entregado > 0 : p.total_devuelto + p.total_ingresado > 0
      ),
    [pedidosNoTinta, pestana]
  )

  const totalPorOt = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const p of pedidosNoTinta) mapa.set(p.numero_ot, (mapa.get(p.numero_ot) ?? 0) + 1)
    return mapa
  }, [pedidosNoTinta])

  // Todos los pedidos visibles de cada OT en esta pestaña (sin aplicar
  // todavía el buscador/filtro de estado) — se usa para decidir si la OT
  // completa está "Completado" o "En proceso", independientemente de qué
  // filas se estén mostrando en pantalla en este momento.
  const visiblesPorOt = useMemo(() => {
    const mapa = new Map<string, Consumo[]>()
    for (const p of visiblesEnPestana) {
      if (!mapa.has(p.numero_ot)) mapa.set(p.numero_ot, [])
      mapa.get(p.numero_ot)!.push(p)
    }
    return mapa
  }, [visiblesEnPestana])

  const filtrados = useMemo(() => {
    let lista = visiblesEnPestana
    const needle = q.trim().toLowerCase()
    if (needle) lista = lista.filter((p) => p.numero_ot.toLowerCase().includes(needle))
    if (filtro === 'completados') lista = lista.filter((p) => estaCompletado(p, pestana))
    if (filtro === 'pendientes') lista = lista.filter((p) => !estaCompletado(p, pestana))
    return lista
  }, [visiblesEnPestana, q, filtro, pestana])

  // Una OT = una tarjeta, con todos sus materiales adentro (nunca se repite
  // el número de OT como si fueran OT distintas). "Completado" a nivel de OT
  // solo cuando TODOS sus materiales ya aparecieron aquí (nada por entregar/
  // devolver todavía) Y cada uno ya tiene su check marcado.
  const grupos = useMemo(() => {
    const orden: string[] = []
    const mapa = new Map<string, Consumo[]>()
    for (const p of filtrados) {
      if (!mapa.has(p.numero_ot)) {
        mapa.set(p.numero_ot, [])
        orden.push(p.numero_ot)
      }
      mapa.get(p.numero_ot)!.push(p)
    }
    return orden.map((numeroOt) => {
      const todosVisiblesDeLaOt = visiblesPorOt.get(numeroOt) ?? []
      const todosPresentes = todosVisiblesDeLaOt.length === (totalPorOt.get(numeroOt) ?? 0)
      const todosCompletados = todosVisiblesDeLaOt.every((p) => estaCompletado(p, pestana))
      return { numeroOt, pedidos: mapa.get(numeroOt)!, completo: todosPresentes && todosCompletados }
    })
  }, [filtrados, visiblesPorOt, totalPorOt, pestana])

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Registro SID</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Listado por OT para llevar el registro del SID: copia cada dato con el ícono junto a él, y marca el check
        de cada registro (fecha) cuando termines de tramitarlo. Un registro nuevo que todavía no tenga check vuelve
        a aparecer como pendiente, aunque los anteriores ya estén completos.
      </p>

      <div className="mb-4 flex gap-2">
        {PESTANAS.map((p) => (
          <Button
            key={p.valor}
            type="button"
            variant={pestana === p.valor ? 'default' : 'outline'}
            onClick={() => setPestana(p.valor)}
          >
            {p.etiqueta}
          </Button>
        ))}
      </div>

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-1 flex-col gap-1.5">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número de OT..." />
          </div>
          <div className="flex gap-2">
            {FILTROS.map((f) => (
              <Button
                key={f.valor}
                type="button"
                variant={filtro === f.valor ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFiltro(f.valor)}
              >
                {f.etiqueta}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {pedidos.isError && (
        <p className="mb-4 text-sm text-destructive">
          No se pudo cargar: {pedidos.error instanceof ApiError ? pedidos.error.message : 'error de conexión'}
        </p>
      )}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {pedidos.isSuccess && grupos.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay pedidos que coincidan con este filtro.</p>
      )}

      <div className="flex flex-col gap-4">
        {grupos.map((grupo) => (
          <GrupoOt
            key={grupo.numeroOt}
            numeroOt={grupo.numeroOt}
            pedidos={grupo.pedidos}
            completo={grupo.completo}
            pestana={pestana}
            entregasPorPedido={entregasPorPedido}
            devolucionesPorPedido={devolucionesPorPedido}
            marcarEntregaSid={marcarEntregaSid}
            marcarDevolucionSid={marcarDevolucionSid}
          />
        ))}
      </div>
    </div>
  )
}

type MutacionSid = ReturnType<typeof useMutation<Entrega | Devolucion, unknown, { id: number; completado: boolean }>>

function GrupoOt({
  numeroOt,
  pedidos,
  completo,
  pestana,
  entregasPorPedido,
  devolucionesPorPedido,
  marcarEntregaSid,
  marcarDevolucionSid
}: {
  numeroOt: string
  pedidos: Consumo[]
  completo: boolean
  pestana: Pestana
  entregasPorPedido: Map<number, Entrega[]>
  devolucionesPorPedido: Map<number, Devolucion[]>
  marcarEntregaSid: MutacionSid
  marcarDevolucionSid: MutacionSid
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CeldaCopiable texto={numeroOt} className="text-base font-semibold" />
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              completo ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
            )}
          >
            {completo ? 'Completado' : 'En proceso'}
          </span>
        </div>

        <div className="flex flex-col divide-y divide-border">
          {pedidos.map((p) => (
            <FilaMaterial
              key={p.ot_material_id}
              pedido={p}
              pestana={pestana}
              susEntregas={entregasPorPedido.get(p.ot_material_id) ?? []}
              susDevoluciones={devolucionesPorPedido.get(p.ot_material_id) ?? []}
              marcarEntregaSid={marcarEntregaSid}
              marcarDevolucionSid={marcarDevolucionSid}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function FilaMaterial({
  pedido,
  pestana,
  susEntregas,
  susDevoluciones,
  marcarEntregaSid,
  marcarDevolucionSid
}: {
  pedido: Consumo
  pestana: Pestana
  susEntregas: Entrega[]
  susDevoluciones: Devolucion[]
  marcarEntregaSid: MutacionSid
  marcarDevolucionSid: MutacionSid
}) {
  const completado = estaCompletado(pedido, pestana)

  const entregasOrdenadas = useMemo(
    () => [...susEntregas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id),
    [susEntregas]
  )
  const devolucionesOrdenadas = useMemo(
    () => [...susDevoluciones].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id),
    [susDevoluciones]
  )

  return (
    <div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">SID {pestana === 'entregados' ? 'de entrega' : 'de devolución'}</span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            completado ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
          )}
        >
          {completado ? 'Completo' : 'Pendiente'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Cliente</p>
          <CeldaCopiable texto={pedido.cliente ?? ''} />
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Material
            {pedido.es_materia_prima && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                materia prima de {pedido.insumo_de_codigo_mp}
              </span>
            )}
            {pedido.tiene_materia_prima && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                <Beaker className="h-2.5 w-2.5" />
                se fabrica en esta OT
              </span>
            )}
          </p>
          <CeldaCopiable texto={pedido.codigo_mp} />
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs text-muted-foreground">Descripción</p>
          <CeldaCopiable texto={pedido.descripcion ?? ''} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Cantidad entregada</p>
          <CeldaCopiable texto={`${pedido.total_entregado} ${pedido.unidad}`} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Cantidad devuelta</p>
          <CeldaCopiable texto={`${pedido.total_devuelto} ${pedido.unidad}`} />
        </div>
        {pedido.total_ingresado > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Ingresó a almacén (fabricado)</p>
            <CeldaCopiable texto={`${pedido.total_ingresado} ${pedido.unidad}`} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">Registros por fecha</p>
        {pestana === 'entregados'
          ? entregasOrdenadas.map((e) => (
              <MovimientoRow
                key={e.id}
                fecha={e.fecha}
                etiqueta={
                  e.codigo_mp_entregado !== pedido.codigo_mp ? (
                    <span className="text-warning">
                      {e.codigo_mp_entregado} (pedido: {pedido.codigo_mp})
                    </span>
                  ) : null
                }
                cantidad={e.total_entregado}
                unidad={pedido.unidad}
                usaBobinas={e.usa_bobinas}
                bobinas={e.bobinas}
                usuario={e.usuario}
                completado={e.sid_completado}
                cambiando={marcarEntregaSid.isPending && marcarEntregaSid.variables?.id === e.id}
                onCambiar={(nuevo) => marcarEntregaSid.mutate({ id: e.id, completado: nuevo })}
              />
            ))
          : devolucionesOrdenadas.map((d) => (
              <MovimientoRow
                key={d.id}
                fecha={d.fecha}
                etiqueta={
                  d.es_ingreso_produccion ? (
                    <span className="text-warning">Ingreso a almacén</span>
                  ) : d.codigo_mp !== pedido.codigo_mp ? (
                    <span className="text-warning">
                      {d.codigo_mp} (pedido: {pedido.codigo_mp})
                    </span>
                  ) : null
                }
                cantidad={d.total_devuelto}
                unidad={pedido.unidad}
                usaBobinas={d.usa_bobinas}
                bobinas={d.bobinas}
                usuario={d.usuario}
                completado={d.sid_completado}
                cambiando={marcarDevolucionSid.isPending && marcarDevolucionSid.variables?.id === d.id}
                onCambiar={(nuevo) => marcarDevolucionSid.mutate({ id: d.id, completado: nuevo })}
              />
            ))}
        {(pestana === 'entregados' ? entregasOrdenadas : devolucionesOrdenadas).length === 0 && (
          <p className="text-xs text-muted-foreground">Sin registros.</p>
        )}
      </div>
    </div>
  )
}

function MovimientoRow({
  fecha,
  etiqueta,
  cantidad,
  unidad,
  usaBobinas,
  bobinas,
  usuario,
  completado,
  cambiando,
  onCambiar
}: {
  fecha: string
  etiqueta: React.ReactNode
  cantidad: number
  unidad: string
  usaBobinas: boolean
  bobinas: number[]
  usuario: string
  completado: boolean
  cambiando: boolean
  onCambiar: (completado: boolean) => void
}) {
  return (
    <div className="rounded-md border border-border p-2 text-xs">
      <label className="flex items-start justify-between gap-2">
        <span className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={completado}
            disabled={cambiando}
            onChange={(e) => onCambiar(e.target.checked)}
          />
          <span>
            <span className="font-medium">{fecha}</span>
            {etiqueta && <span> · {etiqueta}</span>}
            <br />
            <span className="text-muted-foreground">{usuario}</span>
          </span>
        </span>
        <span className="font-medium">
          {cantidad} {unidad}
        </span>
      </label>
      {usaBobinas && (
        <p className="mt-1 pl-6 text-muted-foreground">
          {bobinas.length} {bobinas.length === 1 ? 'bobina' : 'bobinas'}: {bobinas.map((b) => `${b} ${unidad}`).join(', ')}
        </p>
      )}
    </div>
  )
}
