import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ClipboardList, PackageCheck, PackageX, Search } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
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

  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const otSeleccionada = params.get('ot')

  const ordenes = useQuery({
    queryKey: ['ordenes-trabajo', q],
    queryFn: () => api.listarOrdenes(apiBaseUrl, token, q || undefined)
  })

  const consumo = useQuery({
    queryKey: ['consumo', otSeleccionada],
    queryFn: () => api.consultarConsumo(apiBaseUrl, token, otSeleccionada!),
    enabled: !!otSeleccionada
  })
  const entregas = useQuery({
    queryKey: ['entregas', otSeleccionada],
    queryFn: () => api.listarEntregas(apiBaseUrl, token, otSeleccionada!),
    enabled: !!otSeleccionada
  })
  const devoluciones = useQuery({
    queryKey: ['devoluciones-ot', otSeleccionada],
    queryFn: () => api.listarDevolucionesPorOt(apiBaseUrl, token, otSeleccionada!),
    enabled: !!otSeleccionada
  })

  const entregasPorPedido = useMemo(() => {
    const mapa = new Map<number, typeof entregas.data>()
    for (const e of entregas.data ?? []) {
      mapa.set(e.ot_material_id, [...(mapa.get(e.ot_material_id) ?? []), e])
    }
    return mapa
  }, [entregas.data])

  const devolucionesPorPedido = useMemo(() => {
    const mapa = new Map<number, typeof devoluciones.data>()
    for (const d of devoluciones.data ?? []) {
      mapa.set(d.ot_material_id, [...(mapa.get(d.ot_material_id) ?? []), d])
    }
    return mapa
  }, [devoluciones.data])

  function buscar(e: FormEvent) {
    e.preventDefault()
    ordenes.refetch()
  }

  function seleccionarOt(numeroOt: string) {
    setParams({ ot: numeroOt })
  }

  const otActual = ordenes.data?.find((o) => o.numero_ot === otSeleccionada)

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Historial de OT</h1>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)] xl:items-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Órdenes de trabajo</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={buscar} className="mb-4 flex gap-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar OT, cliente, diseño..." />
              <Button type="submit" variant="outline" size="sm">
                <Search className="h-4 w-4" />
              </Button>
            </form>

            {ordenes.isError && (
              <p className="text-sm text-destructive">
                No se pudo cargar: {ordenes.error instanceof ApiError ? ordenes.error.message : 'error de conexión'}
              </p>
            )}

            {ordenes.data && ordenes.data.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin órdenes de trabajo todavía.</p>
            )}

            <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
              {ordenes.data?.map((ot) => (
                <button
                  key={ot.id}
                  onClick={() => seleccionarOt(ot.numero_ot)}
                  className={cn(
                    'rounded-lg border p-3 text-left text-sm transition-colors',
                    otSeleccionada === ot.numero_ot
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted'
                  )}
                >
                  <p className="font-medium">OT {ot.numero_ot}</p>
                  <p className="text-xs text-muted-foreground">
                    {ot.cliente ?? 'Sin cliente'} {ot.diseno ? `· ${ot.diseno}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(ot.fecha_creacion).toLocaleDateString('es-BO')}
                  </p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {!otSeleccionada && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                <ClipboardList className="h-8 w-8" />
                <p className="text-sm">Elige una orden de trabajo de la lista para ver su historial completo.</p>
              </CardContent>
            </Card>
          )}

          {otSeleccionada && (
            <>
              <Card>
                <CardContent className="flex flex-wrap items-baseline justify-between gap-2 pt-6">
                  <div>
                    <p className="text-lg font-semibold">OT {otSeleccionada}</p>
                    <p className="text-sm text-muted-foreground">
                      {otActual?.cliente ?? '—'} {otActual?.diseno ? `· ${otActual.diseno}` : ''}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {consumo.isError && (
                <p className="text-sm text-destructive">
                  No se pudo cargar el detalle:{' '}
                  {consumo.error instanceof ApiError ? consumo.error.message : 'error de conexión'}
                </p>
              )}

              {consumo.data && consumo.data.length === 0 && (
                <p className="text-sm text-muted-foreground">Esta OT todavía no tiene materiales entregados.</p>
              )}

              {consumo.data?.map((pedido) => {
                const susEntregas = entregasPorPedido.get(pedido.ot_material_id) ?? []
                const susDevoluciones = devolucionesPorPedido.get(pedido.ot_material_id) ?? []
                return (
                  <Card key={pedido.ot_material_id}>
                    <CardHeader className="flex-row items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{pedido.codigo_mp}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {pedido.proceso} · {pedido.maquina}
                        </p>
                      </div>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', ESTILO_ESTADO[pedido.estado_entrega])}>
                        {pedido.estado_entrega}
                      </span>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-md bg-muted p-3">
                          <p className="text-xs text-muted-foreground">Requerido</p>
                          <p className="font-medium">
                            {pedido.cantidad_requerida ?? '—'} {pedido.cantidad_requerida ? pedido.unidad : ''}
                          </p>
                        </div>
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
                                  <span>{e.fecha}</span>
                                  <span className="font-medium">
                                    {e.total_entregado} {e.unidad}
                                  </span>
                                </div>
                                <p className="text-muted-foreground">
                                  {e.usuario} · bobinas: {e.bobinas.join(', ')}
                                </p>
                              </div>
                            ))}
                            {susEntregas.length === 0 && (
                              <p className="text-xs text-muted-foreground">Sin entregas.</p>
                            )}
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <PackageX className="h-3.5 w-3.5" />
                            Devoluciones ({susDevoluciones.length})
                          </p>
                          <div className="flex flex-col gap-2">
                            {susDevoluciones.map((d) => (
                              <div key={d.id} className="rounded-md border border-border p-2 text-xs">
                                <div className="flex justify-between">
                                  <span>{d.fecha}</span>
                                  <span className="font-medium">
                                    {d.total_devuelto} {pedido.unidad}
                                  </span>
                                </div>
                                <p className="text-muted-foreground">
                                  {d.usuario} · bobinas: {d.bobinas.join(', ')}
                                </p>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
