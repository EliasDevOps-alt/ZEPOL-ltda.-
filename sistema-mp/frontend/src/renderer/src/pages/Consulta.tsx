import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightLeft, Search } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import type { Consumo } from '@renderer/lib/types'

const ESTILO_ESTADO_ENTREGA: Record<Consumo['estado_entrega'], string> = {
  COMPLETO: 'bg-success/10 text-success',
  PARCIAL: 'bg-warning/10 text-warning',
  PENDIENTE: 'bg-muted text-muted-foreground',
  'SIN REQUERIMIENTO': 'bg-muted text-muted-foreground'
}

function BadgeEstado({ estado }: { estado: Consumo['estado_entrega'] }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', ESTILO_ESTADO_ENTREGA[estado])}>
      {estado}
    </span>
  )
}

export function Consulta() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [numeroOt, setNumeroOt] = useState('')
  const [otBuscada, setOtBuscada] = useState<string | null>(null)

  const consumo = useQuery({
    queryKey: ['consumo', otBuscada],
    queryFn: () => api.consultarConsumo(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  // Qué material salió DE VERDAD en cada pedido: si almacén entregó una
  // alternativa (pide BOPP20720, sale BOPP20760), la consulta tiene que decir
  // BOPP20760 — mostrar solo el código pedido hacía pensar que se había
  // registrado el que no se entregó.
  const entregas = useQuery({
    queryKey: ['entregas-consulta', otBuscada],
    queryFn: () => api.listarEntregas(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  const entregadosPorPedido = useMemo(() => {
    const mapa = new Map<number, string[]>()
    for (const e of entregas.data ?? []) {
      const actuales = mapa.get(e.ot_material_id) ?? []
      if (!actuales.includes(e.codigo_mp_entregado)) mapa.set(e.ot_material_id, [...actuales, e.codigo_mp_entregado])
    }
    return mapa
  }, [entregas.data])

  // Los ingresos a almacén de un material fabricado que todavía no tiene
  // pedido (ver "Registrar ingreso" en Registrar Devolución) no existen en
  // /consumo, así que se piden aparte y se suman como filas propias.
  const devoluciones = useQuery({
    queryKey: ['devoluciones-consulta', otBuscada],
    queryFn: () => api.listarDevolucionesPorOt(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  const ingresosSueltos = useMemo(() => {
    const porMaterial = new Map<
      number,
      { material_id: number; codigo_mp: string; unidad: string; total: number; todoEnSid: boolean }
    >()
    for (const d of devoluciones.data ?? []) {
      if (!d.es_ingreso_produccion || d.ot_material_id != null) continue
      const actual = porMaterial.get(d.material_id)
      porMaterial.set(d.material_id, {
        material_id: d.material_id,
        codigo_mp: d.codigo_mp,
        unidad: d.unidad,
        total: (actual?.total ?? 0) + d.total_devuelto,
        todoEnSid: (actual?.todoEnSid ?? true) && d.sid_completado
      })
    }
    return [...porMaterial.values()]
  }, [devoluciones.data])

  const filasConsumo = consumo.data ?? []
  const hayFilas = filasConsumo.length > 0 || ingresosSueltos.length > 0
  const cabecera = filasConsumo[0] ?? (devoluciones.data ?? []).find((d) => d.es_ingreso_produccion)

  function buscar(e: FormEvent) {
    e.preventDefault()
    setOtBuscada(numeroOt)
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Consultar OT</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Buscar</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={buscar} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>Número de OT</Label>
              <Input value={numeroOt} onChange={(e) => setNumeroOt(e.target.value)} placeholder="123" />
            </div>
            <Button type="submit" variant="outline">
              <Search className="h-4 w-4" />
              Buscar
            </Button>
          </form>
        </CardContent>
      </Card>

      {consumo.isSuccess && devoluciones.isSuccess && !hayFilas && (
        <p className="text-sm text-muted-foreground">No hay movimientos para esa OT.</p>
      )}

      {hayFilas && cabecera && (
        <Card>
          <CardContent className="p-6 pb-0 text-sm text-muted-foreground">
            {cabecera.cliente ?? 'Sin cliente'}
            {'diseno' in cabecera && cabecera.diseno ? ` · Descripción: ${cabecera.diseno}` : ''}
          </CardContent>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground [&>th]:whitespace-nowrap">
                  <th className="px-2 py-3">Proceso</th>
                  <th className="px-2 py-3">Máquina</th>
                  <th className="px-2 py-3">Material</th>
                  <th className="px-2 py-3 text-right">Requerido</th>
                  <th className="px-2 py-3 text-right">Entregado</th>
                  <th className="px-2 py-3 text-right">Devuelto</th>
                  <th className="px-2 py-3 text-right">Ingresó a almacén</th>
                  <th className="px-2 py-3 text-right">Consumo neto</th>
                  <th className="px-2 py-3">Avance</th>
                  <th className="px-2 py-3">Estado SID</th>
                </tr>
              </thead>
              <tbody>
                {filasConsumo.map((row) => (
                  <tr key={row.ot_material_id} className="border-b border-border last:border-0">
                    <td className="px-2 py-3">{row.proceso}</td>
                    <td className="px-2 py-3">{row.maquina}</td>
                    <td className="px-2 py-3">
                      {(() => {
                        const entregados = entregadosPorPedido.get(row.ot_material_id) ?? []
                        const reales = entregados.length > 0 ? entregados : [row.codigo_mp]
                        const sustituido = reales.some((c) => c !== row.codigo_mp)
                        return (
                          <>
                            {reales.map((c) => (
                              <div key={c} className={cn('whitespace-nowrap', c !== row.codigo_mp && 'text-warning')}>
                                {c}
                              </div>
                            ))}
                            {sustituido && (
                              <span
                                className="mt-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                                title="El material entregado es distinto al que pedía la OT"
                              >
                                <ArrowRightLeft className="h-2.5 w-2.5" />
                                pedido: {row.codigo_mp}
                              </span>
                            )}
                          </>
                        )
                      })()}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {row.cantidad_requerida ?? '—'} {row.cantidad_requerida ? row.unidad : ''}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {row.total_entregado} {row.unidad}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {row.total_devuelto} {row.unidad}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {row.total_ingresado > 0 ? `${row.total_ingresado} ${row.unidad}` : '—'}
                    </td>
                    <td className="px-2 py-3 text-right font-medium">
                      {row.consumo_neto} {row.unidad}
                    </td>
                    <td className="px-2 py-3">
                      <BadgeEstado estado={row.estado_entrega} />
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">{row.estado_sid}</td>
                  </tr>
                ))}
                {ingresosSueltos.map((ing) => (
                  <tr key={`ingreso-${ing.material_id}`} className="border-b border-border last:border-0">
                    <td className="px-2 py-3 text-muted-foreground">—</td>
                    <td className="px-2 py-3 text-muted-foreground">—</td>
                    <td className="px-2 py-3">
                      <div className="whitespace-nowrap">{ing.codigo_mp}</div>
                      <span className="mt-0.5 inline-block whitespace-nowrap rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                        material fabricado
                      </span>
                    </td>
                    <td className="px-2 py-3 text-right text-muted-foreground">—</td>
                    <td className="px-2 py-3 text-right text-muted-foreground">—</td>
                    <td className="px-2 py-3 text-right text-muted-foreground">—</td>
                    <td className="px-2 py-3 text-right">
                      {ing.total} {ing.unidad}
                    </td>
                    <td className="px-2 py-3 text-right text-muted-foreground">—</td>
                    <td className="px-2 py-3 text-muted-foreground">—</td>
                    <td className="px-2 py-3 text-muted-foreground">{ing.todoEnSid ? 'COMPLETADO' : 'PENDIENTE'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
