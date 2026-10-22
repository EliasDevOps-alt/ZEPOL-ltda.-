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
import { formatearFecha } from '@renderer/lib/fechas'
import { letrasDeEntregas } from '@renderer/lib/letrasEntrega'
import { CodigoConLetra, LetraEntrega } from '@renderer/components/LetraEntrega'
import { redondearPeso } from '@renderer/lib/utils'
import type { Consumo, Devolucion, Entrega } from '@renderer/lib/types'

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

/** Con una sola entrega/devolución se muestra el número de siempre; con dos o
 * más, cada una por su hora y el total al final como dato secundario. */
function DesgloseHoras({
  total,
  items,
  conHora = false
}: {
  total: string
  items: { clave: string; texto: React.ReactNode }[]
  // En una fila que ya es de UNA entrega se muestra su hora aunque sea una sola línea.
  conHora?: boolean
}) {
  if (conHora && items.length === 1) return <span className="whitespace-nowrap">{items[0].texto}</span>
  if (items.length < 2) return <span>{total}</span>
  return (
    <div className="flex flex-col items-end gap-0.5">
      {items.map((i) => (
        <span key={i.clave} className="whitespace-nowrap">
          {i.texto}
        </span>
      ))}
      <span className="mt-0.5 whitespace-nowrap border-t border-border pt-0.5 text-xs text-muted-foreground">
        Total: {total}
      </span>
    </div>
  )
}

/** Una fila de la tabla. Normalmente es el pedido; pero si el pedido ya tuvo 2 o
 * más entregas, cada ENTREGA es su propia fila (con su proceso, máquina, material
 * y hora) y las devoluciones que dicen ser de ella — antes todo se apretaba en
 * la fila del pedido, y luego por destino, y dos entregas al mismo proceso y
 * máquina a distinta hora seguían juntas. Lo que es del pedido entero
 * (requerido, avance, SID, ingreso a almacén) se muestra en la primera fila. Las
 * devoluciones que no dicen de cuál entrega son van en una fila aparte al final. */
interface FilaConsulta {
  clave: string
  row: Consumo
  primera: boolean
  destino?: { proceso: string; maquina: string; material: string; entregas: Entrega[]; devoluciones: Devolucion[] }
  sinEntrega?: Devolucion[]
}

function armarFilas(
  pedidos: Consumo[],
  entregasPorPedido: Map<number, Entrega[]>,
  devolucionesPorPedido: Map<number, Devolucion[]>
): FilaConsulta[] {
  const filas: FilaConsulta[] = []
  for (const row of pedidos) {
    const susEntregas = entregasPorPedido.get(row.ot_material_id) ?? []
    const susDevoluciones = devolucionesPorPedido.get(row.ot_material_id) ?? []
    if (susEntregas.length < 2) {
      filas.push({ clave: `p${row.ot_material_id}`, row, primera: true })
      continue
    }
    susEntregas.forEach((e, indice) => {
      filas.push({
        clave: `e${e.id}`,
        row,
        primera: indice === 0,
        destino: {
          proceso: e.proceso,
          maquina: e.maquina,
          material: e.codigo_mp_entregado,
          entregas: [e],
          devoluciones: susDevoluciones.filter((d) => d.entrega_id === e.id)
        }
      })
    })
    const ids = new Set(susEntregas.map((e) => e.id))
    const sueltas = susDevoluciones.filter((d) => d.entrega_id === null || !ids.has(d.entrega_id))
    if (sueltas.length > 0) {
      filas.push({ clave: `s${row.ot_material_id}`, row, primera: false, sinEntrega: sueltas })
    }
  }
  return filas
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

  // Dos o más entregas del mismo material en la OT se rotulan (A), (B)… (ver letrasEntrega.ts).
  const letras = useMemo(() => letrasDeEntregas(entregas.data ?? []), [entregas.data])

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

  // Cada entrega y cada devolución por separado, con su hora: el mismo material
  // puede salir a las 11:00 y otra vez a las 16:00 y no tiene que verse sumado.
  const entregasPorPedido = useMemo(() => {
    const mapa = new Map<number, NonNullable<typeof entregas.data>>()
    for (const e of entregas.data ?? []) mapa.set(e.ot_material_id, [...(mapa.get(e.ot_material_id) ?? []), e])
    return mapa
  }, [entregas.data])

  const devolucionesPorPedido = useMemo(() => {
    const mapa = new Map<number, NonNullable<typeof devoluciones.data>>()
    for (const d of devoluciones.data ?? []) {
      if (d.ot_material_id == null || d.es_ingreso_produccion) continue
      mapa.set(d.ot_material_id, [...(mapa.get(d.ot_material_id) ?? []), d])
    }
    return mapa
  }, [devoluciones.data])

  const filasConsumo = consumo.data ?? []
  const filas = useMemo(
    () => armarFilas(filasConsumo, entregasPorPedido, devolucionesPorPedido),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consumo.data, entregasPorPedido, devolucionesPorPedido]
  )
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
                {filas.map((fila) => {
                  const { row, destino, sinEntrega, primera } = fila
                  const delPedido = (valor: React.ReactNode) =>
                    primera ? valor : <span className="text-muted-foreground">—</span>
                  const itemsEntrega = (lista: Entrega[]) =>
                    lista.map((e) => ({
                      clave: `e${e.id}`,
                      texto: `${formatearFecha(e.fecha)} ${e.hora.slice(0, 5)} · ${e.total_entregado} ${row.unidad}`
                    }))
                  const itemsDevolucion = (lista: Devolucion[]) =>
                    lista.map((d) => {
                      const deEntrega = d.entrega_id
                        ? (entregasPorPedido.get(row.ot_material_id) ?? []).find((e) => e.id === d.entrega_id)
                        : undefined
                      return {
                        clave: `d${d.id}`,
                        // Dentro de una fila de destino ya se sabe de cuál entrega es.
                        texto: (
                          <>
                            {`${formatearFecha(d.fecha)} ${d.hora.slice(0, 5)} · ${d.total_devuelto} ${row.unidad}`}
                            {deEntrega && !destino && letras.has(deEntrega.id) && (
                              <>
                                {' '}
                                (de la entrega <LetraEntrega letra={letras.get(deEntrega.id) as string} conParentesis={false} />,{' '}
                                {deEntrega.hora.slice(0, 5)})
                              </>
                            )}
                            {deEntrega && !destino && !letras.has(deEntrega.id) && ` (de la entrega de las ${deEntrega.hora.slice(0, 5)})`}
                          </>
                        )
                      }
                    })
                  const suma = (lista: { total_entregado?: number; total_devuelto?: number }[], campo: 'total_entregado' | 'total_devuelto') =>
                    redondearPeso(lista.reduce((acc, x) => acc + (x[campo] ?? 0), 0))

                  const ultima = (entregasPorPedido.get(row.ot_material_id) ?? []).at(-1)
                  const proceso = sinEntrega ? '—' : (destino?.proceso ?? ultima?.proceso ?? row.proceso)
                  const maquina = sinEntrega ? '—' : (destino?.maquina ?? ultima?.maquina ?? row.maquina)

                  // Material: el que REALMENTE salió (con ⇄ si no es el del pedido).
                  const entregasDelPedido = entregasPorPedido.get(row.ot_material_id) ?? []
                  const materiales = destino
                    ? [{ codigo: destino.material, letra: letras.get(destino.entregas[0].id) }]
                    : entregasDelPedido.length > 0
                      ? entregasDelPedido.map((e) => ({ codigo: e.codigo_mp_entregado, letra: letras.get(e.id) }))
                      : [{ codigo: row.codigo_mp, letra: undefined as string | undefined }]
                  const sustituido = !sinEntrega && materiales.some((m) => m.codigo !== row.codigo_mp)

                  return (
                    <tr key={fila.clave} className="border-b border-border last:border-0">
                      <td className={cn('px-2 py-3 align-top', sinEntrega && 'text-muted-foreground')}>{proceso}</td>
                      <td className={cn('px-2 py-3 align-top', sinEntrega && 'text-muted-foreground')}>{maquina}</td>
                      <td className="px-2 py-3 align-top">
                        {sinEntrega ? (
                          <>
                            <div className="whitespace-nowrap">{row.codigo_mp}</div>
                            <span className="mt-0.5 inline-block whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              devuelto sin indicar entrega
                            </span>
                          </>
                        ) : (
                          <>
                            {materiales.map((m) => (
                              <div
                                key={`${m.codigo}|${m.letra ?? ''}`}
                                className={cn('whitespace-nowrap', m.codigo !== row.codigo_mp && 'text-warning')}
                              >
                                <CodigoConLetra codigo={m.codigo} letra={m.letra} />
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
                        )}
                      </td>
                      <td className="px-2 py-3 text-right align-top">
                        {sinEntrega ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          delPedido(`${row.cantidad_requerida ?? '—'} ${row.cantidad_requerida ? row.unidad : ''}`)
                        )}
                      </td>
                      <td className="px-2 py-3 text-right align-top">
                        {sinEntrega ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <DesgloseHoras
                            total={`${destino ? suma(destino.entregas, 'total_entregado') : row.total_entregado} ${row.unidad}`}
                            items={itemsEntrega(destino ? destino.entregas : (entregasPorPedido.get(row.ot_material_id) ?? []))}
                            conHora={!!destino}
                          />
                        )}
                      </td>
                      <td className="px-2 py-3 text-right align-top">
                        <DesgloseHoras
                          total={`${
                            destino
                              ? suma(destino.devoluciones, 'total_devuelto')
                              : sinEntrega
                                ? suma(sinEntrega, 'total_devuelto')
                                : row.total_devuelto
                          } ${row.unidad}`}
                          items={itemsDevolucion(
                            destino
                              ? destino.devoluciones
                              : (sinEntrega ?? devolucionesPorPedido.get(row.ot_material_id) ?? [])
                          )}
                          conHora={!!destino}
                        />
                      </td>
                      <td className="px-2 py-3 text-right align-top">
                        {sinEntrega
                          ? '—'
                          : delPedido(row.total_ingresado > 0 ? `${row.total_ingresado} ${row.unidad}` : '—')}
                      </td>
                      <td className="px-2 py-3 text-right align-top font-medium">
                        {sinEntrega ? (
                          <span className="text-muted-foreground">—</span>
                        ) : destino ? (
                          <>
                            {redondearPeso(
                              suma(destino.entregas, 'total_entregado') - suma(destino.devoluciones, 'total_devuelto')
                            )}{' '}
                            {row.unidad}
                            {primera && (
                              <div className="text-xs font-normal text-muted-foreground">
                                Pedido: {row.consumo_neto} {row.unidad}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {row.consumo_neto} {row.unidad}
                          </>
                        )}
                      </td>
                      <td className="px-2 py-3 align-top">
                        {sinEntrega ? '' : delPedido(<BadgeEstado estado={row.estado_entrega} />)}
                      </td>
                      <td className="px-2 py-3 align-top text-muted-foreground">
                        {sinEntrega ? '' : delPedido(row.estado_sid)}
                      </td>
                    </tr>
                  )
                })}
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
