import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Card, CardContent } from '@renderer/components/ui/card'
import { CeldaCopiable } from '@renderer/components/ui/celda-copiable'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import type { Consumo } from '@renderer/lib/types'

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

  const invalidar = () => {
    setError(null)
    queryClient.invalidateQueries({ queryKey: ['consumo-sid'] })
  }
  const alFallar = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'No se pudo actualizar el estado SID')

  const cambiarEstadoEntrega = useMutation({
    mutationFn: ({ id, completado }: { id: number; completado: boolean }) =>
      completado ? api.marcarSidCompletado(apiBaseUrl, token, id) : api.marcarSidPendiente(apiBaseUrl, token, id),
    onSuccess: invalidar,
    onError: alFallar
  })

  const cambiarEstadoDevolucion = useMutation({
    mutationFn: ({ id, completado }: { id: number; completado: boolean }) =>
      completado
        ? api.marcarSidDevolucionCompletado(apiBaseUrl, token, id)
        : api.marcarSidDevolucionPendiente(apiBaseUrl, token, id),
    onSuccess: invalidar,
    onError: alFallar
  })

  const cambiando = cambiarEstadoEntrega.isPending || cambiarEstadoDevolucion.isPending

  function onCambiarEstado(id: number, completado: boolean) {
    if (pestana === 'entregados') cambiarEstadoEntrega.mutate({ id, completado })
    else cambiarEstadoDevolucion.mutate({ id, completado })
  }

  // Los cargos de tinta nunca se entregan/devuelven en planta (ver Registrar
  // Entrega/Devolución), así que tampoco cuentan aquí.
  const pedidosNoTinta = useMemo(() => (pedidos.data ?? []).filter((p) => !p.es_tinta), [pedidos.data])

  // Solo listamos lo que realmente ya se movió — nada de "cantidad entregada
  // 0" mezclado con lo que sí se entregó.
  const visiblesEnPestana = useMemo(
    () => pedidosNoTinta.filter((p) => (pestana === 'entregados' ? p.total_entregado > 0 : p.total_devuelto > 0)),
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
        de cada material cuando termines de registrarlo. La OT pasa a "Completado" recién cuando todos sus
        materiales tienen el check marcado.
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
            onCambiarEstado={onCambiarEstado}
            cambiando={cambiando}
          />
        ))}
      </div>
    </div>
  )
}

function GrupoOt({
  numeroOt,
  pedidos,
  completo,
  pestana,
  onCambiarEstado,
  cambiando
}: {
  numeroOt: string
  pedidos: Consumo[]
  completo: boolean
  pestana: Pestana
  onCambiarEstado: (id: number, completado: boolean) => void
  cambiando: boolean
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
              onCambiarEstado={(completado) => onCambiarEstado(p.ot_material_id, completado)}
              cambiando={cambiando}
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
  onCambiarEstado,
  cambiando
}: {
  pedido: Consumo
  pestana: Pestana
  onCambiarEstado: (completado: boolean) => void
  cambiando: boolean
}) {
  const completado = estaCompletado(pedido, pestana)

  return (
    <div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={completado}
          disabled={cambiando}
          onChange={(e) => onCambiarEstado(e.target.checked)}
        />
        SID {pestana === 'entregados' ? 'de entrega' : 'de devolución'} registrado
      </label>

      <div className="grid grid-cols-1 gap-3 pl-6 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Cliente</p>
          <CeldaCopiable texto={pedido.cliente ?? ''} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Material</p>
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
      </div>
    </div>
  )
}
