import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Pencil, Printer, Scale, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useConfirm } from '@renderer/components/ConfirmProvider'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { formatearFecha, formatearFechaHoraCompleta, hoyISO } from '@renderer/lib/fechas'
import { ROTULO_UNIDAD_PT } from '@renderer/lib/formularioPt'
import {
  ALTO_ETIQUETA_MM,
  ANCHO_ETIQUETA_MM,
  datosEtiquetaDesdePesaje,
  generarHtmlEtiquetasPt,
  nombreArchivoEtiquetaPt
} from '@renderer/lib/etiquetaPt'
import type { PesajePt as Pesaje, ProductoTerminado, UnidadPt } from '@renderer/lib/types'

/** Sin ceros de más y con punto decimal, como se escribe en el formulario. */
function num(valor: number, decimales = 3): string {
  return valor.toLocaleString('en-US', {
    maximumFractionDigits: decimales,
    useGrouping: false
  })
}

/** En qué se cuenta el To (y la cantidad de cada paquete). En una OT en
 * millares el pedido se escribe en millares, pero cada paquete se cuenta en
 * bolsas (Elias), así que el To también va en bolsas. */
const ROTULO_TO: Record<UnidadPt, string> = {
  KG: 'kg',
  BOLSAS: 'bolsas',
  MILLAR: 'bolsas'
}

/** Pedido total como se escribe en el Excel, y en millares su equivalente en
 * bolsas para compararlo con lo pesado. */
function textoPedido(pt: ProductoTerminado): string {
  if (pt.pedido_total === null) return 'sin dato en el Excel'
  if (!pt.unidad) return num(pt.pedido_total)
  const base = `${num(pt.pedido_total)} ${ROTULO_UNIDAD_PT[pt.unidad]}`
  return pt.unidad === 'MILLAR' && pt.pedido_total_real !== null
    ? `${base} (${num(pt.pedido_total_real)} bolsas)`
    : base
}

type EstadoExportacion =
  { tipo: 'inactivo' } | { tipo: 'exportando' } | { tipo: 'listo'; ruta: string } | { tipo: 'error'; mensaje: string }

/**
 * Guarda en un PDF las etiquetas de uno o varios pesajes (una por página).
 * Todavía no hay impresora de etiquetas: por ahora sale en PDF para
 * mostrarlo; cuando la haya, esto pasa a imprimir directo.
 */
function useExportarEtiquetas(pt: ProductoTerminado | null) {
  const [estado, setEstado] = useState<EstadoExportacion>({ tipo: 'inactivo' })

  useEffect(() => {
    if (estado.tipo !== 'listo') return
    const id = setTimeout(() => setEstado({ tipo: 'inactivo' }), 6000)
    return () => clearTimeout(id)
  }, [estado])

  async function exportar(pesajes: Pesaje[]): Promise<void> {
    if (!pt || pesajes.length === 0) return
    setEstado({ tipo: 'exportando' })
    try {
      const ordenados = [...pesajes].sort((a, b) => a.numero - b.numero)
      const html = generarHtmlEtiquetasPt(ordenados.map((p) => datosEtiquetaDesdePesaje(pt, p)))
      const ruta = await window.api.exportarFormularioPdf(
        html,
        nombreArchivoEtiquetaPt(
          pt.numero_ot,
          ordenados.map((p) => p.numero)
        )
      )
      setEstado(ruta ? { tipo: 'listo', ruta } : { tipo: 'inactivo' })
    } catch (error) {
      setEstado({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { estado, exportar }
}

function AvisoExportacion({ estado }: { estado: EstadoExportacion }) {
  if (estado.tipo === 'listo') {
    return (
      <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
        Etiqueta guardada en {estado.ruta}
      </p>
    )
  }
  if (estado.tipo === 'error') {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        No se pudo guardar la etiqueta: {estado.mensaje}
      </p>
    )
  }
  return null
}

/** La etiqueta a tamaño real (mm → px a 96 dpi), tal como sale en el PDF. */
function VistaEtiqueta({ pt, pesaje }: { pt: ProductoTerminado; pesaje: Pesaje }) {
  const html = useMemo(() => generarHtmlEtiquetasPt([datosEtiquetaDesdePesaje(pt, pesaje)]), [pt, pesaje])
  const ancho = Math.round((ANCHO_ETIQUETA_MM / 25.4) * 96)
  const alto = Math.round((ALTO_ETIQUETA_MM / 25.4) * 96)
  return (
    <iframe
      title={`Etiqueta N° ${pesaje.numero}`}
      srcDoc={html}
      scrolling="no"
      className="max-w-full shrink-0 border-0 bg-white shadow-md"
      style={{ width: ancho, height: alto }}
    />
  )
}

/**
 * Pestaña "Registro de peso" de Producto Terminado: el avance de la OT, el
 * formulario para registrar un pesaje (con su etiqueta) y la lista de lo
 * pesado por día. Recibe la OT ya buscada por la pantalla de Producto
 * Terminado — así, al pasar entre el formulario de ingreso y esta pestaña,
 * se sigue en la misma OT (pedido de Elias; antes era un submódulo aparte con
 * su propia búsqueda).
 */
export function RegistroPesoPt({ pt }: { pt: ProductoTerminado }) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()
  const confirmar = useConfirm()

  const pesajes = useQuery({
    queryKey: ['pesajes-pt', pt.numero_ot],
    queryFn: () => api.listarPesajesPt(apiBaseUrl, token, pt.numero_ot)
  })

  const unidad = pt.unidad
  const rotuloPaquetes = unidad === 'KG' ? 'Bo' : 'Pq'
  const rotuloTo = unidad ? ROTULO_TO[unidad] : ''

  const etiquetas = useExportarEtiquetas(pt)
  const [editando, setEditando] = useState<number | null>(null)
  // Tras corregir un pesaje su etiqueta impresa queda vieja: se avisa.
  const [corregido, setCorregido] = useState<Pesaje | null>(null)

  const eliminar = useMutation({
    mutationFn: (pesaje: Pesaje) => api.eliminarPesajePt(apiBaseUrl, token, pesaje.id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['pesajes-pt', pt.numero_ot]
      })
  })

  async function pedirEliminar(pesaje: Pesaje): Promise<void> {
    const ok = await confirmar(
      `¿Eliminar el pesaje N° ${pesaje.numero} (${num(pesaje.peso_neto)} kg netos)? Si su etiqueta ya está impresa, retírala de la bobina o paquete.`,
      {
        titulo: 'Eliminar pesaje',
        textoConfirmar: 'Eliminar',
        destructivo: true
      }
    )
    if (ok) eliminar.mutate(pesaje)
  }

  // Días más recientes primero: el que se está pesando hoy queda arriba.
  const dias = useMemo(() => {
    const datos = pesajes.data
    if (!datos) return []
    return [...datos.dias].reverse().map((dia) => ({
      ...dia,
      pesajes: datos.pesajes.filter((p) => p.fecha === dia.fecha).reverse()
    }))
  }, [pesajes.data])

  // Sin unidad no se puede pesar: el aviso para confirmarla lo muestra la
  // pantalla de Producto Terminado, arriba de las pestañas.
  if (!unidad) {
    return (
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
        Confirma primero la unidad de la OT (arriba) para poder registrar pesajes.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Avance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            <span className="text-muted-foreground">Pedido total:</span> {textoPedido(pt)}
          </p>
          {pesajes.data && <Avance unidad={unidad} pt={pt} datos={pesajes.data} />}
        </CardContent>
      </Card>

      {
        <FormularioPesaje
          key={pt.numero_ot}
          pt={pt}
          unidad={unidad}
          ultimo={pesajes.data?.pesajes.at(-1) ?? null}
          onRegistrado={() =>
            queryClient.invalidateQueries({
              queryKey: ['pesajes-pt', pt.numero_ot]
            })
          }
        />
      }

      {
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pesajes registrados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {pesajes.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            {pesajes.isError && (
              <p className="text-sm text-destructive">No se pudieron cargar los pesajes: {pesajes.error.message}</p>
            )}
            {pesajes.data && dias.length === 0 && (
              <p className="text-sm text-muted-foreground">Esta OT todavía no tiene pesajes.</p>
            )}
            {eliminar.isError && <p className="text-sm text-destructive">{eliminar.error.message}</p>}
            {corregido && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
                <span>
                  Pesaje N° {corregido.numero} corregido. Si su etiqueta ya estaba impresa, vuelve a imprimirla y
                  cámbiala.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={etiquetas.estado.tipo === 'exportando'}
                  onClick={() => etiquetas.exportar([corregido])}
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimir etiqueta corregida
                </Button>
              </div>
            )}
            <AvisoExportacion estado={etiquetas.estado} />
            {dias.map((dia) => (
              <div key={dia.fecha} className="rounded-md border border-border">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted px-3 py-2 text-sm">
                  <strong>{formatearFecha(dia.fecha)}</strong>
                  <span>
                    To = {num(dia.to, 2)} {rotuloTo}
                  </span>
                  <span>Kg = {num(dia.kg, 2)}</span>
                  <span>
                    {rotuloPaquetes} = {dia.paquetes}
                  </span>
                  <span>Per. = {dia.pesadores.join(', ')}</span>
                  {dia.porcentaje_acumulado !== null && (
                    <span className="font-semibold">{Math.round(dia.porcentaje_acumulado)}% acumulado</span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    disabled={etiquetas.estado.tipo === 'exportando'}
                    onClick={() => etiquetas.exportar(dia.pesajes)}
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Etiquetas del día
                  </Button>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1">N°</th>
                      <th className="px-3 py-1">Hora</th>
                      <th className="px-3 py-1 text-right">Bruto</th>
                      <th className="px-3 py-1 text-right">Tara</th>
                      <th className="px-3 py-1 text-right">Neto</th>
                      {unidad !== 'KG' && <th className="px-3 py-1 text-right">Cantidad</th>}
                      <th className="px-3 py-1">Pesador</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {dia.pesajes.map((p) =>
                      editando === p.id ? (
                        <FilaEdicion
                          key={p.id}
                          pesaje={p}
                          unidad={unidad}
                          columnas={unidad !== 'KG' ? 8 : 7}
                          onCancelar={() => setEditando(null)}
                          onGuardado={(nuevo) => {
                            setEditando(null)
                            setCorregido(nuevo)
                            queryClient.invalidateQueries({
                              queryKey: ['pesajes-pt', pt.numero_ot]
                            })
                          }}
                        />
                      ) : (
                        <tr key={p.id} className="border-t border-border">
                          <td className="px-3 py-1 font-medium">{p.numero}</td>
                          <td className="px-3 py-1">{p.hora.slice(0, 5)}</td>
                          <td className="px-3 py-1 text-right">{num(p.peso_bruto)}</td>
                          <td className="px-3 py-1 text-right">{num(p.tara)}</td>
                          <td className="px-3 py-1 text-right font-medium">{num(p.peso_neto)}</td>
                          {unidad !== 'KG' && (
                            <td className="px-3 py-1 text-right">{p.cantidad !== null ? num(p.cantidad) : ''}</td>
                          )}
                          <td className="px-3 py-1" title={p.pesador_nombre}>
                            {p.pesador}
                            {p.editado_por && p.editado_en && (
                              <span className="block text-xs text-primary">
                                Editado por {p.editado_por} el {formatearFechaHoraCompleta(p.editado_en)}
                              </span>
                            )}
                          </td>
                          <td className="flex justify-end gap-1 px-3 py-1">
                            <button
                              type="button"
                              title="Corregir pesaje"
                              onClick={() => {
                                setCorregido(null)
                                setEditando(p.id)
                              }}
                              className="rounded-md border border-border p-1 hover:bg-muted"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Guardar la etiqueta en PDF"
                              disabled={etiquetas.estado.tipo === 'exportando'}
                              onClick={() => etiquetas.exportar([p])}
                              className="rounded-md border border-border p-1 hover:bg-muted"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Eliminar pesaje"
                              disabled={eliminar.isPending}
                              onClick={() => pedirEliminar(p)}
                              className="rounded-md border border-destructive/40 p-1 text-destructive hover:bg-destructive/10"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </CardContent>
        </Card>
      }
    </div>
  )
}

/**
 * Corrección de un pesaje en su misma fila. Se puede cambiar todo menos el
 * N° (su etiqueta ya puede estar pegada) y el pesador original; quién
 * corrigió queda registrado aparte.
 */
function FilaEdicion({
  pesaje,
  unidad,
  columnas,
  onCancelar,
  onGuardado
}: {
  pesaje: Pesaje
  unidad: UnidadPt
  columnas: number
  onCancelar: () => void
  onGuardado: (pesaje: Pesaje) => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const conCantidad = unidad !== 'KG'
  const [fecha, setFecha] = useState(pesaje.fecha)
  const [pesoBruto, setPesoBruto] = useState(num(pesaje.peso_bruto))
  const [tara, setTara] = useState(num(pesaje.tara))
  const [cantidad, setCantidad] = useState(pesaje.cantidad !== null ? num(pesaje.cantidad) : '')

  const bruto = Number(pesoBruto)
  const taraNum = tara === '' ? 0 : Number(tara)
  const neto = pesoBruto !== '' && !Number.isNaN(bruto) && !Number.isNaN(taraNum) ? bruto - taraNum : null
  const valido = fecha !== '' && bruto > 0 && neto !== null && neto > 0 && (!conCantidad || Number(cantidad) > 0)

  const guardar = useMutation({
    mutationFn: () =>
      api.editarPesajePt(apiBaseUrl, sesion!.token, pesaje.id, {
        fecha,
        peso_bruto: bruto,
        tara: taraNum,
        cantidad: conCantidad ? Number(cantidad) : null
      }),
    onSuccess: onGuardado
  })

  return (
    <tr className="border-t border-border bg-muted/50">
      <td colSpan={columnas} className="px-3 py-2">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valido && !guardar.isPending) guardar.mutate()
          }}
        >
          <span className="self-center font-medium">N° {pesaje.numero}</span>
          <div className="space-y-1">
            <Label htmlFor={`ed-fecha-${pesaje.id}`}>Fecha</Label>
            <Input
              id={`ed-fecha-${pesaje.id}`}
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="h-8 w-36"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`ed-bruto-${pesaje.id}`}>Peso bruto (kg)</Label>
            <Input
              id={`ed-bruto-${pesaje.id}`}
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0"
              autoFocus
              value={pesoBruto}
              onChange={(e) => setPesoBruto(e.target.value)}
              className="h-8 w-28"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`ed-tara-${pesaje.id}`}>Tara (kg)</Label>
            <Input
              id={`ed-tara-${pesaje.id}`}
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0"
              value={tara}
              onChange={(e) => setTara(e.target.value)}
              className="h-8 w-24"
            />
          </div>
          {conCantidad && (
            <div className="space-y-1">
              <Label htmlFor={`ed-cantidad-${pesaje.id}`}>Cantidad (bolsas)</Label>
              <Input
                id={`ed-cantidad-${pesaje.id}`}
                type="number"
                inputMode="decimal"
                step="1"
                min="0"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                className="h-8 w-28"
              />
            </div>
          )}
          <span className="self-center text-sm">
            Neto:{' '}
            <strong className={neto !== null && neto <= 0 ? 'text-destructive' : undefined}>
              {neto !== null ? `${num(neto)} kg` : '—'}
            </strong>
          </span>
          <Button type="submit" size="sm" disabled={!valido || guardar.isPending}>
            {guardar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Guardar
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancelar} disabled={guardar.isPending}>
            Cancelar
          </Button>
        </form>
        {neto !== null && neto <= 0 && (
          <p className="mt-1 text-sm text-destructive">La tara tiene que ser menor que el peso bruto.</p>
        )}
        {guardar.isError && <p className="mt-1 text-sm text-destructive">{guardar.error.message}</p>}
      </td>
    </tr>
  )
}

function Avance({
  unidad,
  pt,
  datos
}: {
  unidad: UnidadPt
  pt: ProductoTerminado
  datos: {
    total_to: number
    total_kg: number
    total_paquetes: number
    porcentaje: number | null
  }
}) {
  const porcentaje = datos.porcentaje
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="text-muted-foreground">To acumulado:</span>{' '}
          <strong>
            {num(datos.total_to, 2)} {ROTULO_TO[unidad]}
          </strong>
          {pt.pedido_total_real !== null && (
            <span className="text-muted-foreground">
              {' '}
              de {num(pt.pedido_total_real)} {ROTULO_TO[unidad]}
            </span>
          )}
        </span>
        <span>
          <span className="text-muted-foreground">Kg:</span> <strong>{num(datos.total_kg, 2)}</strong>
        </span>
        <span>
          <span className="text-muted-foreground">{unidad === 'KG' ? 'Bobinas' : 'Paquetes'}:</span>{' '}
          <strong>{datos.total_paquetes}</strong>
        </span>
        {porcentaje !== null && (
          <span>
            <span className="text-muted-foreground">Avance:</span> <strong>{Math.round(porcentaje)}%</strong>
          </span>
        )}
      </div>
      {porcentaje !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={porcentaje >= 100 ? 'h-full bg-success' : 'h-full bg-primary'}
            style={{ width: `${Math.min(100, porcentaje)}%` }}
          />
        </div>
      )}
    </div>
  )
}

function FormularioPesaje({
  pt,
  unidad,
  ultimo,
  onRegistrado
}: {
  pt: ProductoTerminado
  unidad: UnidadPt
  ultimo: Pesaje | null
  onRegistrado: () => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const conCantidad = unidad !== 'KG'

  const [fecha, setFecha] = useState(hoyISO())
  const [pesoBruto, setPesoBruto] = useState('')
  const [tara, setTara] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [registrado, setRegistrado] = useState<Pesaje | null>(null)
  const pesoRef = useRef<HTMLInputElement>(null)
  const etiquetas = useExportarEtiquetas(pt)

  // La tara (el cono) y la cantidad por paquete casi siempre se repiten de
  // una pesada a la siguiente: se proponen las del último pesaje de la OT,
  // editables. Solo se completan si el campo está vacío, para no pisar lo
  // que la persona ya escribió.
  useEffect(() => {
    if (!ultimo) return
    setTara((actual) => (actual === '' ? num(ultimo.tara) : actual))
    if (ultimo.cantidad !== null) {
      setCantidad((actual) => (actual === '' ? num(ultimo.cantidad!) : actual))
    }
  }, [ultimo])

  const bruto = Number(pesoBruto)
  const taraNum = tara === '' ? 0 : Number(tara)
  const neto = pesoBruto !== '' && !Number.isNaN(bruto) && !Number.isNaN(taraNum) ? bruto - taraNum : null

  const registrar = useMutation({
    mutationFn: () =>
      api.registrarPesajePt(apiBaseUrl, sesion!.token, pt.numero_ot, {
        fecha,
        peso_bruto: bruto,
        tara: taraNum,
        cantidad: conCantidad ? Number(cantidad) : null
      }),
    onSuccess: (pesaje) => {
      setRegistrado(pesaje)
      setPesoBruto('')
      onRegistrado()
      pesoRef.current?.focus()
    }
  })

  const valido =
    fecha !== '' && bruto > 0 && taraNum >= 0 && neto !== null && neto > 0 && (!conCantidad || Number(cantidad) > 0)

  function enviar(e: React.FormEvent): void {
    e.preventDefault()
    if (valido && !registrar.isPending) registrar.mutate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nuevo pesaje</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={enviar} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="pesaje-fecha">Fecha</Label>
              <Input id="pesaje-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pesaje-bruto">Peso bruto (kg)</Label>
              <Input
                id="pesaje-bruto"
                ref={pesoRef}
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                autoFocus
                value={pesoBruto}
                onChange={(e) => setPesoBruto(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pesaje-tara">Tara (kg)</Label>
              <Input
                id="pesaje-tara"
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                value={tara}
                onChange={(e) => setTara(e.target.value)}
                placeholder="0"
              />
            </div>
            {conCantidad && (
              <div className="space-y-1">
                <Label htmlFor="pesaje-cantidad">Cantidad (bolsas)</Label>
                <Input
                  id="pesaje-cantidad"
                  type="number"
                  inputMode="decimal"
                  step="1"
                  min="0"
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <p className="text-sm">
              <span className="text-muted-foreground">Peso neto:</span>{' '}
              <strong className={neto !== null && neto <= 0 ? 'text-destructive' : undefined}>
                {neto !== null ? `${num(neto)} kg` : '—'}
              </strong>
            </p>
            <Button type="submit" disabled={!valido || registrar.isPending}>
              {registrar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
              Registrar pesaje
            </Button>
          </div>

          {neto !== null && neto <= 0 && (
            <p className="text-sm text-destructive">La tara tiene que ser menor que el peso bruto.</p>
          )}
          {registrar.isError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {registrar.error.message}
            </p>
          )}
          {registrado && !registrar.isError && (
            <div className="space-y-3 rounded-md border border-success/40 bg-success/10 p-3">
              <p className="text-sm text-success">
                Pesaje N° {registrado.numero} registrado: {num(registrado.peso_neto)} kg netos
                {registrado.cantidad !== null ? `, ${num(registrado.cantidad)} bolsas` : ''}.
              </p>
              <div className="flex flex-wrap items-end gap-4">
                <VistaEtiqueta pt={pt} pesaje={registrado} />
                <Button
                  type="button"
                  disabled={etiquetas.estado.tipo === 'exportando'}
                  onClick={() => etiquetas.exportar([registrado])}
                >
                  {etiquetas.estado.tipo === 'exportando' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="h-4 w-4" />
                  )}
                  Guardar etiqueta en PDF
                </Button>
              </div>
              <AvisoExportacion estado={etiquetas.estado} />
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
