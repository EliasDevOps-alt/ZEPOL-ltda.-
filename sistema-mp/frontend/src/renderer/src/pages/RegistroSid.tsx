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
import { formatearFechaHora, formatearFechaHoraCompleta, hoyISO, mesActualISO, ultimoDiaDelMes } from '@renderer/lib/fechas'
import type { Consumo, Devolucion, Entrega } from '@renderer/lib/types'

type ModoFecha = 'dia' | 'mes' | 'todos'
type Pestana = 'entregados' | 'devueltos' | 'ingresados' | 'todos'
type Filtro = 'pendientes' | 'completados' | 'todos'

const PESTANAS: { valor: Pestana; etiqueta: string }[] = [
  { valor: 'entregados', etiqueta: 'Entregados' },
  { valor: 'devueltos', etiqueta: 'Devueltos' },
  { valor: 'ingresados', etiqueta: 'Ingresados' },
  { valor: 'todos', etiqueta: 'Todos' }
]

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'pendientes', etiqueta: 'Pendientes' },
  { valor: 'completados', etiqueta: 'Completados' },
  { valor: 'todos', etiqueta: 'Todos' }
]

function entregaCompleta(pedido: Consumo): boolean {
  return pedido.estado_sid === 'COMPLETADO'
}

function devolucionCompleta(pedido: Consumo): boolean {
  return pedido.sid_devolucion_completado
}

// Completo = TODOS los movimientos de ese tipo ya tienen su check marcado
// (lo mantiene al día el backend: ver sid_controller.recalcular_estado_entrega/
// recalcular_sid_devolucion). Un movimiento nuevo sin registrar reabre esto
// solo, sin que nadie tenga que "desmarcar" nada a mano. En "Todos" cuentan
// los dos trámites a la vez, pero solo el que de verdad aplica: un pedido sin
// devoluciones/ingresos no tiene por qué tener su SID de devolución tramitado
// para considerarse completo.
function estaCompletado(pedido: Consumo, pestana: Pestana): boolean {
  if (pestana === 'entregados') return entregaCompleta(pedido)
  if (pestana === 'devueltos') return devolucionCompleta(pedido)
  const aplicaEntrega = pedido.total_entregado > 0
  const aplicaDevolucion = pedido.total_devuelto + pedido.total_ingresado > 0
  return (!aplicaEntrega || entregaCompleta(pedido)) && (!aplicaDevolucion || devolucionCompleta(pedido))
}

export function RegistroSid() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [pestana, setPestana] = useState<Pestana>('todos')
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('pendientes')
  const [modoFecha, setModoFecha] = useState<ModoFecha>('dia')
  // Arranca en "hoy", igual que Todas las OT — evita mostrar todo el
  // historial apenas se entra a la pantalla.
  const [fecha, setFecha] = useState(hoyISO())
  const [error, setError] = useState<string | null>(null)

  const { desde, hasta } = useMemo(() => {
    if (!fecha) return { desde: '', hasta: '' }
    if (modoFecha === 'dia') return { desde: fecha, hasta: fecha }
    return { desde: `${fecha}-01`, hasta: ultimoDiaDelMes(fecha) }
  }, [modoFecha, fecha])

  function cambiarModoFecha(modo: ModoFecha) {
    setModoFecha(modo)
    if (modo === 'dia') setFecha(hoyISO())
    else if (modo === 'mes') setFecha(mesActualISO())
    else setFecha('')
  }

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

  // El filtro de día/mes acota los MOVIMIENTOS (por su propia fecha), no la
  // fecha de creación de la OT — acá lo que importa es cuándo pasó cada
  // entrega/devolución, para poder revisar "lo de hoy" o "lo de este mes"
  // sin que el resto del historial estorbe.
  const entregasEnRango = useMemo(
    () => (entregas.data ?? []).filter((e) => !desde || (e.fecha >= desde && e.fecha <= hasta)),
    [entregas.data, desde, hasta]
  )
  const devolucionesEnRango = useMemo(
    () => (devoluciones.data ?? []).filter((d) => !desde || (d.fecha >= desde && d.fecha <= hasta)),
    [devoluciones.data, desde, hasta]
  )

  const entregasPorPedido = useMemo(() => {
    const mapa = new Map<number, Entrega[]>()
    for (const e of entregasEnRango) mapa.set(e.ot_material_id, [...(mapa.get(e.ot_material_id) ?? []), e])
    return mapa
  }, [entregasEnRango])

  // Un ingreso a almacén puede no tener pedido todavía (el material se fabricó
  // pero aún no salió hacia ningún proceso); esos no tienen SID que tramitar
  // hasta que se les asigne uno.
  const devolucionesPorPedido = useMemo(() => {
    const mapa = new Map<number, Devolucion[]>()
    for (const d of devolucionesEnRango) {
      if (d.ot_material_id == null) continue
      mapa.set(d.ot_material_id, [...(mapa.get(d.ot_material_id) ?? []), d])
    }
    return mapa
  }, [devolucionesEnRango])

  // Material fabricado en la OT entrando a almacén — con pedido ya asignado o
  // todavía como pendiente suelto (ver crear_pendiente_libre). Un pendiente
  // suelto nunca aparece en /consumo, así que se agrupa directo por numero_ot
  // en vez de por pedido — es la única forma de que su SID sea visible acá.
  const ingresos = useMemo(() => (devoluciones.data ?? []).filter((d) => d.es_ingreso_produccion), [devoluciones.data])
  const ingresosEnRango = useMemo(
    () => ingresos.filter((d) => !desde || (d.fecha >= desde && d.fecha <= hasta)),
    [ingresos, desde, hasta]
  )
  const ingresosPorOt = useMemo(() => {
    const mapa = new Map<string, Devolucion[]>()
    for (const d of ingresosEnRango) mapa.set(d.numero_ot, [...(mapa.get(d.numero_ot) ?? []), d])
    return mapa
  }, [ingresosEnRango])

  // Los ingresos sin pedido (pendiente suelto) tampoco salen en /consumo, así
  // que en "Todos" se cuelgan de la tarjeta de su OT aparte de los pedidos. Los
  // que sí tienen pedido ya se muestran dentro de la fila de ese material.
  const ingresosSueltos = useMemo(() => ingresos.filter((d) => d.ot_material_id == null), [ingresos])
  const ingresosSueltosPorOt = useMemo(() => {
    const mapa = new Map<string, Devolucion[]>()
    for (const d of ingresosSueltos) {
      if (desde && !(d.fecha >= desde && d.fecha <= hasta)) continue
      mapa.set(d.numero_ot, [...(mapa.get(d.numero_ot) ?? []), d])
    }
    return mapa
  }, [ingresosSueltos, desde, hasta])
  // Completo se mide sobre toda la historia, no sobre el rango elegido — igual
  // que en el resto de las pestañas.
  const ingresosSueltosCompletoPorOt = useMemo(() => {
    const mapa = new Map<string, boolean>()
    for (const d of ingresosSueltos) mapa.set(d.numero_ot, (mapa.get(d.numero_ot) ?? true) && d.sid_completado)
    return mapa
  }, [ingresosSueltos])

  // Todas las devoluciones de cada pedido sin el filtro de fecha — para que el
  // "Completo/Pendiente" de cada sección no dependa del día que se está viendo.
  const devolucionesTodasPorPedido = useMemo(() => {
    const mapa = new Map<number, Devolucion[]>()
    for (const d of devoluciones.data ?? []) {
      if (d.ot_material_id == null) continue
      mapa.set(d.ot_material_id, [...(mapa.get(d.ot_material_id) ?? []), d])
    }
    return mapa
  }, [devoluciones.data])
  // Completo = TODOS los ingresos de esa OT (de toda la historia, no solo los
  // del rango de fecha elegido) ya tienen su check — mismo criterio que
  // entregados/devueltos.
  const ingresosCompletoPorOt = useMemo(() => {
    const mapa = new Map<string, boolean>()
    for (const d of ingresos) mapa.set(d.numero_ot, (mapa.get(d.numero_ot) ?? true) && d.sid_completado)
    return mapa
  }, [ingresos])
  const gruposIngresos = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let numerosOt = [...ingresosPorOt.keys()]
    if (needle) numerosOt = numerosOt.filter((n) => n.toLowerCase().includes(needle))
    if (filtro === 'completados') numerosOt = numerosOt.filter((n) => ingresosCompletoPorOt.get(n))
    if (filtro === 'pendientes') numerosOt = numerosOt.filter((n) => !ingresosCompletoPorOt.get(n))
    return numerosOt.map((numeroOt) => ({
      numeroOt,
      movimientos: ingresosPorOt.get(numeroOt) ?? [],
      completo: ingresosCompletoPorOt.get(numeroOt) ?? false
    }))
  }, [ingresosPorOt, q, filtro, ingresosCompletoPorOt])

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
  // con su propio trámite, igual que un sobrante. "Todos" es la unión de las
  // dos: un pedido aparece si tiene cualquiera de los dos movimientos.
  const tieneEntrega = (p: Consumo) => p.total_entregado > 0
  const tieneDevolucion = (p: Consumo) => p.total_devuelto + p.total_ingresado > 0
  const visiblesEnPestana = useMemo(
    () =>
      pedidosNoTinta.filter((p) => {
        if (pestana === 'entregados') return tieneEntrega(p)
        if (pestana === 'devueltos') return tieneDevolucion(p)
        return tieneEntrega(p) || tieneDevolucion(p)
      }),
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
    // El filtro de fecha decide qué se MUESTRA (hay al menos un movimiento
    // en el rango) — a propósito no toca visiblesEnPestana/totalPorOt, que
    // siguen viendo todo el historial: si tocaran el badge "Completado"
    // pasaría a depender de qué día estás mirando, y no tiene que ser así.
    if (desde) {
      lista = lista.filter((p) => {
        const enEntregas = (entregasPorPedido.get(p.ot_material_id)?.length ?? 0) > 0
        const enDevoluciones = (devolucionesPorPedido.get(p.ot_material_id)?.length ?? 0) > 0
        if (pestana === 'entregados') return enEntregas
        if (pestana === 'devueltos') return enDevoluciones
        return enEntregas || enDevoluciones
      })
    }
    return lista
  }, [visiblesEnPestana, q, filtro, pestana, desde, entregasPorPedido, devolucionesPorPedido])

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
    // En "Todos", una OT que solo tiene ingresos sin pedido (nada en /consumo)
    // también tiene que aparecer — si no, esos ingresos quedaban visibles solo
    // en la pestaña "Ingresados".
    if (pestana === 'todos') {
      const needle = q.trim().toLowerCase()
      for (const numeroOt of ingresosSueltosPorOt.keys()) {
        if (mapa.has(numeroOt)) continue
        if (needle && !numeroOt.toLowerCase().includes(needle)) continue
        const completoSueltos = ingresosSueltosCompletoPorOt.get(numeroOt) ?? false
        if (filtro === 'completados' && !completoSueltos) continue
        if (filtro === 'pendientes' && completoSueltos) continue
        mapa.set(numeroOt, [])
        orden.push(numeroOt)
      }
    }
    return orden.map((numeroOt) => {
      const todosVisiblesDeLaOt = visiblesPorOt.get(numeroOt) ?? []
      const todosPresentes = todosVisiblesDeLaOt.length === (totalPorOt.get(numeroOt) ?? 0)
      const todosCompletados = todosVisiblesDeLaOt.every((p) => estaCompletado(p, pestana))
      const sueltosCompletos = pestana === 'todos' ? (ingresosSueltosCompletoPorOt.get(numeroOt) ?? true) : true
      return {
        numeroOt,
        pedidos: mapa.get(numeroOt)!,
        completo: todosPresentes && todosCompletados && sueltosCompletos,
        ingresosSueltos: pestana === 'todos' ? (ingresosSueltosPorOt.get(numeroOt) ?? []) : []
      }
    })
  }, [
    filtrados,
    visiblesPorOt,
    totalPorOt,
    pestana,
    q,
    filtro,
    ingresosSueltosPorOt,
    ingresosSueltosCompletoPorOt
  ])

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
            className="flex-1"
          >
            {p.etiqueta}
          </Button>
        ))}
      </div>

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
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
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <div className="inline-flex rounded-full bg-muted p-1">
              <button
                type="button"
                onClick={() => cambiarModoFecha('dia')}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  modoFecha === 'dia'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Día
              </button>
              <button
                type="button"
                onClick={() => cambiarModoFecha('mes')}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  modoFecha === 'mes'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Mes
              </button>
              <button
                type="button"
                onClick={() => cambiarModoFecha('todos')}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  modoFecha === 'todos'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Todos
              </button>
            </div>

            {modoFecha !== 'todos' && (
              <Input
                type={modoFecha === 'dia' ? 'date' : 'month'}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-auto"
              />
            )}

            {(q || fecha) && (
              <button
                type="button"
                onClick={() => {
                  setQ('')
                  setFecha('')
                }}
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {pedidos.isError && (
        <p className="mb-4 text-sm text-destructive">
          No se pudo cargar: {pedidos.error instanceof ApiError ? pedidos.error.message : 'error de conexión'}
        </p>
      )}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {pestana === 'ingresados'
        ? devoluciones.isSuccess &&
          gruposIngresos.length === 0 && (
            <p className="text-sm text-muted-foreground">No hay ingresos a almacén que coincidan con este filtro.</p>
          )
        : pedidos.isSuccess &&
          grupos.length === 0 && <p className="text-sm text-muted-foreground">No hay pedidos que coincidan con este filtro.</p>}

      <div className="flex flex-col gap-4">
        {pestana === 'ingresados'
          ? gruposIngresos.map((grupo) => (
              <GrupoOtIngresos
                key={grupo.numeroOt}
                numeroOt={grupo.numeroOt}
                movimientos={grupo.movimientos}
                completo={grupo.completo}
                marcarDevolucionSid={marcarDevolucionSid}
              />
            ))
          : grupos.map((grupo) => (
              <GrupoOt
                key={grupo.numeroOt}
                numeroOt={grupo.numeroOt}
                pedidos={grupo.pedidos}
                ingresosSueltos={grupo.ingresosSueltos}
                completo={grupo.completo}
                pestana={pestana}
                entregasPorPedido={entregasPorPedido}
                devolucionesPorPedido={devolucionesPorPedido}
                devolucionesTodasPorPedido={devolucionesTodasPorPedido}
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
  ingresosSueltos,
  completo,
  pestana,
  entregasPorPedido,
  devolucionesPorPedido,
  devolucionesTodasPorPedido,
  marcarEntregaSid,
  marcarDevolucionSid
}: {
  numeroOt: string
  pedidos: Consumo[]
  // Ingresos de esta OT que no pasaron por ningún pedido (solo en "Todos").
  ingresosSueltos: Devolucion[]
  completo: boolean
  pestana: Pestana
  entregasPorPedido: Map<number, Entrega[]>
  devolucionesPorPedido: Map<number, Devolucion[]>
  devolucionesTodasPorPedido: Map<number, Devolucion[]>
  marcarEntregaSid: MutacionSid
  marcarDevolucionSid: MutacionSid
}) {
  const ingresosSueltosPorMaterial = useMemo(() => {
    const mapa = new Map<number, Devolucion[]>()
    for (const d of ingresosSueltos) mapa.set(d.material_id, [...(mapa.get(d.material_id) ?? []), d])
    return [...mapa.values()].map((movs) => [...movs].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id))
  }, [ingresosSueltos])
  // Una OT que solo tiene ingresos sin pedido no tiene fila de pedido de donde
  // sacar el cliente.
  const clienteSueltos = pedidos.length === 0 ? (ingresosSueltos[0]?.cliente ?? null) : null

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

        {clienteSueltos && (
          <div>
            <p className="text-xs text-muted-foreground">Cliente</p>
            <CeldaCopiable texto={clienteSueltos} />
          </div>
        )}

        <div className="flex flex-col divide-y divide-border">
          {pedidos.map((p) => (
            <FilaMaterial
              key={p.ot_material_id}
              pedido={p}
              pestana={pestana}
              susEntregas={entregasPorPedido.get(p.ot_material_id) ?? []}
              susDevoluciones={devolucionesPorPedido.get(p.ot_material_id) ?? []}
              todasSusDevoluciones={devolucionesTodasPorPedido.get(p.ot_material_id) ?? []}
              marcarEntregaSid={marcarEntregaSid}
              marcarDevolucionSid={marcarDevolucionSid}
            />
          ))}
          {ingresosSueltosPorMaterial.map((ordenados) => (
            <BloqueIngresoMaterial
              key={`suelto-${ordenados[0].material_id}`}
              ordenados={ordenados}
              marcarDevolucionSid={marcarDevolucionSid}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// Un ingreso a almacén es una Devolucion, no un pedido — con pedido ya
// asignado o todavía como pendiente suelto (ver crear_pendiente_libre, que
// nunca aparece en /consumo). Por eso esta tarjeta no reutiliza GrupoOt/
// FilaMaterial (pensadas para Consumo): agrupa directo por numero_ot y,
// dentro, por material, y reutiliza SeccionSid/MovimientoRow para el check.
function GrupoOtIngresos({
  numeroOt,
  movimientos,
  completo,
  marcarDevolucionSid
}: {
  numeroOt: string
  movimientos: Devolucion[]
  completo: boolean
  marcarDevolucionSid: MutacionSid
}) {
  const cliente = movimientos[0]?.cliente ?? null

  const porMaterial = useMemo(() => {
    const mapa = new Map<number, Devolucion[]>()
    for (const d of movimientos) mapa.set(d.material_id, [...(mapa.get(d.material_id) ?? []), d])
    return [...mapa.values()].map((movs) => [...movs].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id))
  }, [movimientos])

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

        {cliente && (
          <div>
            <p className="text-xs text-muted-foreground">Cliente</p>
            <CeldaCopiable texto={cliente} />
          </div>
        )}

        <div className="flex flex-col divide-y divide-border">
          {porMaterial.map((ordenados) => (
            <BloqueIngresoMaterial
              key={ordenados[0].material_id}
              ordenados={ordenados}
              marcarDevolucionSid={marcarDevolucionSid}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// Un material con sus ingresos que no pasaron por ningún pedido: el código
// arriba y, debajo, su "SID de ingreso" con un check por cada registro.
function BloqueIngresoMaterial({
  ordenados,
  marcarDevolucionSid
}: {
  ordenados: Devolucion[]
  marcarDevolucionSid: MutacionSid
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        <CeldaCopiable texto={ordenados[0].codigo_mp} />
        {ordenados[0].ot_material_id == null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
            SID ingreso
          </span>
        )}
      </p>
      <SeccionSid titulo="SID de ingreso" completado={ordenados.every((d) => d.sid_completado)}>
        {ordenados.map((d) => (
          <MovimientoRow
            key={d.id}
            fecha={formatearFechaHora(d.fecha, d.hora)}
            etiqueta={null}
            cantidad={d.total_devuelto}
            unidad={d.unidad}
            usaBobinas={d.usa_bobinas}
            bobinas={d.bobinas}
            usuario={d.usuario}
            completado={d.sid_completado}
            sidCompletadoEn={d.sid_completado_en}
            cambiando={marcarDevolucionSid.isPending && marcarDevolucionSid.variables?.id === d.id}
            onCambiar={(nuevo) => marcarDevolucionSid.mutate({ id: d.id, completado: nuevo })}
          />
        ))}
      </SeccionSid>
    </div>
  )
}

function FilaMaterial({
  pedido,
  pestana,
  susEntregas,
  susDevoluciones,
  todasSusDevoluciones,
  marcarEntregaSid,
  marcarDevolucionSid
}: {
  pedido: Consumo
  pestana: Pestana
  susEntregas: Entrega[]
  // Las del rango de fecha elegido (lo que se lista) y todas las del pedido
  // (para que el Completo/Pendiente de cada sección no dependa del día visto).
  susDevoluciones: Devolucion[]
  todasSusDevoluciones: Devolucion[]
  marcarEntregaSid: MutacionSid
  marcarDevolucionSid: MutacionSid
}) {
  const entregasOrdenadas = useMemo(
    () => [...susEntregas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id),
    [susEntregas]
  )
  const devolucionesOrdenadas = useMemo(
    () => [...susDevoluciones].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id),
    [susDevoluciones]
  )
  // Un ingreso (material fabricado que entra a almacén) tiene su propio
  // trámite, distinto del de un sobrante que se devuelve: van en secciones
  // aparte. La de ingreso solo existe si hay alguno que mostrar, para no
  // agregar una caja vacía a los materiales que nunca tuvieron ingresos.
  const ingresosOrdenados = devolucionesOrdenadas.filter((d) => d.es_ingreso_produccion)
  const sobrantesOrdenados = devolucionesOrdenadas.filter((d) => !d.es_ingreso_produccion)
  const todosIngresos = todasSusDevoluciones.filter((d) => d.es_ingreso_produccion)
  const todosSobrantes = todasSusDevoluciones.filter((d) => !d.es_ingreso_produccion)

  const seccionEntrega = (
    <SeccionSid titulo="SID de entrega" completado={entregasOrdenadas.length > 0 ? entregaCompleta(pedido) : null}>
      {entregasOrdenadas.map((e) => (
        <MovimientoRow
          key={e.id}
          fecha={formatearFechaHora(e.fecha, e.hora)}
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
          sidCompletadoEn={e.sid_completado_en}
          cambiando={marcarEntregaSid.isPending && marcarEntregaSid.variables?.id === e.id}
          onCambiar={(nuevo) => marcarEntregaSid.mutate({ id: e.id, completado: nuevo })}
        />
      ))}
      {entregasOrdenadas.length === 0 && <p className="text-xs text-muted-foreground">Sin registros.</p>}
    </SeccionSid>
  )

  const seccionIngreso =
    ingresosOrdenados.length > 0 ? (
      <SeccionSid titulo="SID de ingreso" completado={todosIngresos.every((d) => d.sid_completado)}>
        {ingresosOrdenados.map((d) => (
          <MovimientoRow
            key={d.id}
            fecha={formatearFechaHora(d.fecha, d.hora)}
            etiqueta={null}
            cantidad={d.total_devuelto}
            unidad={pedido.unidad}
            usaBobinas={d.usa_bobinas}
            bobinas={d.bobinas}
            usuario={d.usuario}
            completado={d.sid_completado}
            sidCompletadoEn={d.sid_completado_en}
            cambiando={marcarDevolucionSid.isPending && marcarDevolucionSid.variables?.id === d.id}
            onCambiar={(nuevo) => marcarDevolucionSid.mutate({ id: d.id, completado: nuevo })}
          />
        ))}
      </SeccionSid>
    ) : null

  const seccionDevolucion = (
    <SeccionSid
      titulo="SID de devolución"
      completado={sobrantesOrdenados.length > 0 ? todosSobrantes.every((d) => d.sid_completado) : null}
    >
      {sobrantesOrdenados.map((d) => (
        <MovimientoRow
          key={d.id}
          fecha={formatearFechaHora(d.fecha, d.hora)}
          etiqueta={
            d.codigo_mp !== pedido.codigo_mp ? (
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
          sidCompletadoEn={d.sid_completado_en}
          cambiando={marcarDevolucionSid.isPending && marcarDevolucionSid.variables?.id === d.id}
          onCambiar={(nuevo) => marcarDevolucionSid.mutate({ id: d.id, completado: nuevo })}
        />
      ))}
      {sobrantesOrdenados.length === 0 && <p className="text-xs text-muted-foreground">Sin registros.</p>}
    </SeccionSid>
  )

  return (
    <div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
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
            <p className="text-xs text-muted-foreground">Cantidad ingresada (fabricado)</p>
            <CeldaCopiable texto={`${pedido.total_ingresado} ${pedido.unidad}`} />
          </div>
        )}
      </div>

      {/* En "Todos" van lado a lado (entrega a la izquierda, devolución a la
          derecha, cada una hasta la mitad) para no tener que ir cambiando de
          pestaña para ver los dos trámites del mismo material. En Entregados/
          Devueltos se muestra solo la columna correspondiente, a todo el ancho. */}
      {pestana === 'todos' ? (
        // Sin ingreso queda exactamente como antes (dos columnas). Con
        // ingreso son tres (entrega | ingreso | devolución) solo en pantallas
        // anchas; en las angostas van apiladas como filas para que ninguna
        // quede apretada.
        <div className={cn('grid grid-cols-1 gap-4', seccionIngreso ? 'xl:grid-cols-3' : 'sm:grid-cols-2')}>
          <div>{seccionEntrega}</div>
          {seccionIngreso && <div>{seccionIngreso}</div>}
          <div>{seccionDevolucion}</div>
        </div>
      ) : pestana === 'entregados' ? (
        seccionEntrega
      ) : (
        <div className="flex flex-col gap-3">
          {seccionIngreso}
          {seccionDevolucion}
        </div>
      )}
    </div>
  )
}

function SeccionSid({
  titulo,
  completado,
  children
}: {
  titulo: string
  // null = este material nunca tuvo movimientos de este tipo (ej. se entregó
  // todo y no quedó nada para devolver) — no hay ningún trámite pendiente,
  // así que no tiene sentido mostrarlo como "Pendiente".
  completado: boolean | null
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{titulo}</span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            completado === null
              ? 'bg-muted text-muted-foreground'
              : completado
                ? 'bg-success/10 text-success'
                : 'bg-warning/10 text-warning'
          )}
        >
          {completado === null ? 'Sin movimientos' : completado ? 'Completo' : 'Pendiente'}
        </span>
      </div>
      <p className="text-xs font-medium text-muted-foreground">Registros por fecha</p>
      <div className="flex flex-col gap-2">{children}</div>
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
  sidCompletadoEn,
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
  sidCompletadoEn: string | null
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
      {completado && sidCompletadoEn && (
        <p className="mt-1 pl-6 text-primary">Registro SID {formatearFechaHoraCompleta(sidCompletadoEn)}</p>
      )}
    </div>
  )
}
