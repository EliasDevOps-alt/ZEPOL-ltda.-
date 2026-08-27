import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightLeft, Beaker, PackageCheck, PackageX, Search } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import type { Consumo } from '@renderer/lib/types'

const ESTILO_ESTADO: Record<Consumo['estado_entrega'], string> = {
  COMPLETO: 'bg-success/10 text-success',
  PARCIAL: 'bg-warning/10 text-warning',
  PENDIENTE: 'bg-muted text-muted-foreground',
  'SIN REQUERIMIENTO': 'bg-muted text-muted-foreground'
}

export function Historial() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

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
                                <div key={e.id} className="rounded-md border border-border p-2 text-xs">
                                  <div className="flex justify-between">
                                    <span>
                                      {e.fecha} · {e.codigo_mp_entregado}
                                      {e.codigo_mp_entregado !== e.codigo_mp ? (
                                        <span className="text-warning"> (pedido: {e.codigo_mp})</span>
                                      ) : (
                                        ''
                                      )}
                                    </span>
                                    <span className="font-medium">
                                      {e.total_entregado} {e.unidad}
                                    </span>
                                  </div>
                                  <p className="text-muted-foreground">{e.usuario}</p>
                                  {e.observacion && <p className="text-muted-foreground">Nota: {e.observacion}</p>}
                                  {e.usa_bobinas && (
                                    <p className="mt-1 text-muted-foreground">
                                      {e.bobinas.length} {e.bobinas.length === 1 ? 'bobina' : 'bobinas'}:{' '}
                                      {e.bobinas.map((b) => `${b} ${e.unidad}`).join(', ')}
                                    </p>
                                  )}
                                </div>
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
                                <div key={d.id} className="rounded-md border border-border p-2 text-xs">
                                  <div className="flex justify-between">
                                    <span>
                                      {d.fecha} · {d.codigo_mp}
                                      {d.es_ingreso_produccion ? (
                                        <span className="text-warning"> (ingreso a almacén)</span>
                                      ) : d.codigo_mp !== pedido.codigo_mp ? (
                                        <span className="text-warning"> (pedido: {pedido.codigo_mp})</span>
                                      ) : (
                                        ''
                                      )}
                                    </span>
                                    <span className="font-medium">
                                      {d.total_devuelto} {pedido.unidad}
                                    </span>
                                  </div>
                                  <p className="text-muted-foreground">{d.usuario}</p>
                                  {d.usa_bobinas && (
                                    <p className="mt-1 text-muted-foreground">
                                      {d.bobinas.length} {d.bobinas.length === 1 ? 'bobina' : 'bobinas'}:{' '}
                                      {d.bobinas.map((b) => `${b} ${pedido.unidad}`).join(', ')}
                                    </p>
                                  )}
                                </div>
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
