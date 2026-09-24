import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ClipboardCheck, FileText, Loader2, Printer, Search } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import { cn } from '@renderer/lib/utils'
import * as api from '@renderer/lib/api'
import { hoyISO, mesActualISO, ultimoDiaDelMes } from '@renderer/lib/fechas'
import {
  construirBloques,
  generarDocumentoWordFormularioMp,
  generarHtmlFormularioMp,
  MEDIDAS_FORMULARIO_MP,
  NOMBRE_ARCHIVO_FORMULARIO_MP,
  type DatosOtFormularioMp
} from '@renderer/lib/formularioMp'
import type { OtTerminada } from '@renderer/lib/types'

// Carta horizontal a 96dpi, para dibujar las hojas en la vista previa.
const PAGINA_ANCHO_PX = Math.round((MEDIDAS_FORMULARIO_MP.anchoPt * 96) / 72)
const PAGINA_ALTO_PX = Math.round((MEDIDAS_FORMULARIO_MP.altoPt * 96) / 72)
const SEPARACION_PX = Math.round((MEDIDAS_FORMULARIO_MP.separacionHojasPt * 96) / 72)

type ModoFecha = 'dia' | 'mes' | 'todos'

type EstadoExport =
  | { tipo: 'inactivo' }
  | { tipo: 'exportando'; formato: 'pdf' | 'word' }
  | { tipo: 'listo'; ruta: string }
  | { tipo: 'cancelado' }
  | { tipo: 'error'; mensaje: string }

export function Reportes() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [q, setQ] = useState('')
  const [modoFecha, setModoFecha] = useState<ModoFecha>('mes')
  const [fecha, setFecha] = useState(mesActualISO())
  const [seleccionadas, setSeleccionadas] = useState<string[]>([])
  const [verFormulario, setVerFormulario] = useState(false)

  const rango = useMemo(() => {
    if (modoFecha === 'todos') return { desde: undefined, hasta: undefined }
    if (modoFecha === 'dia') return { desde: fecha, hasta: fecha }
    return { desde: `${fecha}-01`, hasta: ultimoDiaDelMes(fecha) }
  }, [modoFecha, fecha])

  const ots = useQuery({
    queryKey: ['ots-terminadas', rango.desde, rango.hasta],
    queryFn: () => api.listarOtsTerminadas(apiBaseUrl, token, rango.desde, rango.hasta)
  })

  // Por defecto van todas: el caso normal es imprimir el lote entero, no ir
  // eligiendo. Solo se reinicia cuando cambia el filtro (o sea, cuando cambia
  // el resultado de la consulta), así una deselección manual no se pierde.
  useEffect(() => {
    setSeleccionadas((ots.data ?? []).map((o) => o.numero_ot))
  }, [ots.data])

  const visibles = useMemo(() => {
    const texto = q.trim().toLowerCase()
    if (!texto) return ots.data ?? []
    return (ots.data ?? []).filter(
      (o) =>
        o.numero_ot.toLowerCase().includes(texto) ||
        (o.cliente ?? '').toLowerCase().includes(texto)
    )
  }, [ots.data, q])

  function alternar(numeroOt: string): void {
    setSeleccionadas((prev) =>
      prev.includes(numeroOt) ? prev.filter((n) => n !== numeroOt) : [...prev, numeroOt]
    )
  }

  function cambiarModo(modo: ModoFecha): void {
    setModoFecha(modo)
    if (modo === 'dia') setFecha(hoyISO())
    if (modo === 'mes') setFecha(mesActualISO())
  }

  if (verFormulario) {
    return (
      <FormularioMp
        numerosOt={seleccionadas}
        ots={ots.data ?? []}
        onVolver={() => setVerFormulario(false)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Reportes — OT terminadas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            OT con entregas cuyos movimientos (entregas, devoluciones e ingresos) ya están
            registrados en el SID. Seleccioná las que quieras y
            generá el formulario de control de entrega de materias primas
            (P-LOG-001-F-01/V.2.0).
          </p>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por OT o cliente..."
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full bg-muted p-1">
              {(['dia', 'mes', 'todos'] as ModoFecha[]).map((modo) => (
                <button
                  key={modo}
                  type="button"
                  onClick={() => cambiarModo(modo)}
                  className={cn(
                    'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                    modoFecha === modo
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {modo === 'dia' ? 'Día' : modo === 'mes' ? 'Mes' : 'Todas'}
                </button>
              ))}
            </div>
            {modoFecha !== 'todos' && (
              <Input
                type={modoFecha === 'dia' ? 'date' : 'month'}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-auto"
              />
            )}
            <span className="text-sm text-muted-foreground">
              Se filtra por la fecha del último movimiento.
            </span>
          </div>
        </CardContent>
      </Card>

      {ots.isError && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm text-destructive">No se pudieron cargar las OT terminadas.</p>
            <Button variant="outline" onClick={() => ots.refetch()}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      )}

      {ots.isLoading && (
        <p className="px-1 text-sm text-muted-foreground">Cargando OT terminadas...</p>
      )}

      {!ots.isLoading && !ots.isError && visibles.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No hay OT terminadas en este rango.
          </CardContent>
        </Card>
      )}

      {visibles.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() =>
                setSeleccionadas(
                  seleccionadas.length === visibles.length ? [] : visibles.map((o) => o.numero_ot)
                )
              }
            >
              {seleccionadas.length === visibles.length ? 'Quitar todas' : 'Seleccionar todas'}
            </Button>
            <span className="text-sm text-muted-foreground">
              {seleccionadas.length} de {visibles.length} seleccionada
              {seleccionadas.length === 1 ? '' : 's'}
            </span>
            <Button disabled={seleccionadas.length === 0} onClick={() => setVerFormulario(true)}>
              <ClipboardCheck className="h-4 w-4" />
              Ver formulario
            </Button>
          </div>

          <div className="grid gap-2">
            {visibles.map((ot) => (
              <TarjetaOt
                key={ot.numero_ot}
                ot={ot}
                seleccionada={seleccionadas.includes(ot.numero_ot)}
                onToggle={() => alternar(ot.numero_ot)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TarjetaOt({
  ot,
  seleccionada,
  onToggle
}: {
  ot: OtTerminada
  seleccionada: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
        seleccionada ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
      )}
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
          seleccionada ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
        )}
      >
        {seleccionada && <ClipboardCheck className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">
          OT {ot.numero_ot}
          {ot.cliente ? <span className="text-muted-foreground"> · {ot.cliente}</span> : null}
        </span>
        <span className="block text-xs text-muted-foreground">
          {ot.pedidos} pedido{ot.pedidos === 1 ? '' : 's'} · {ot.total_movimientos} movimiento
          {ot.total_movimientos === 1 ? '' : 's'}
          {ot.ultima_fecha ? ` · último ${ot.ultima_fecha.split('-').reverse().join('/')}` : ''}
        </span>
      </span>
    </button>
  )
}

function FormularioMp({
  numerosOt,
  ots,
  onVolver
}: {
  numerosOt: string[]
  ots: OtTerminada[]
  onVolver: () => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const [estado, setEstado] = useState<EstadoExport>({ tipo: 'inactivo' })
  const contenedorRef = useRef<HTMLDivElement>(null)
  const [escala, setEscala] = useState(1)

  const movimientos = useQuery({
    queryKey: ['reporte-movimientos', numerosOt],
    queryFn: async (): Promise<DatosOtFormularioMp[]> => {
      const porNumero = new Map(ots.map((o) => [o.numero_ot, o]))
      return Promise.all(
        numerosOt.map(async (numeroOt) => {
          const [entregas, devoluciones] = await Promise.all([
            api.listarEntregas(apiBaseUrl, token, numeroOt),
            api.listarDevolucionesPorOt(apiBaseUrl, token, numeroOt)
          ])
          const ot = porNumero.get(numeroOt)
          return {
            numeroOt,
            cliente: ot?.cliente ?? null,
            // El campo DISEÑO del formulario lleva la descripción del producto;
            // el diseño propiamente dicho solo si no hay descripción.
            diseno: ot?.descripcion_producto || ot?.diseno || null,
            entregas,
            devoluciones
          }
        })
      )
    }
  })

  const bloques = useMemo(
    () => (movimientos.data ? construirBloques(movimientos.data) : []),
    [movimientos.data]
  )
  const html = useMemo(() => generarHtmlFormularioMp(bloques), [bloques])
  // La vista previa usa la misma armada, con el marco de hoja agregado.
  const htmlPantalla = useMemo(
    () => generarHtmlFormularioMp(bloques, { paraPantalla: true }),
    [bloques]
  )
  const hojas = Math.max(1, Math.ceil(bloques.length / MEDIDAS_FORMULARIO_MP.bloquesPorPagina))
  const altoPreviaPx = hojas * PAGINA_ALTO_PX + (hojas - 1) * SEPARACION_PX

  useLayoutEffect(() => {
    const contenedor = contenedorRef.current
    if (!contenedor) return
    // El padding del contenedor no cuenta para el ancho útil de la hoja.
    const medir = (): void =>
      setEscala(Math.min(1, (contenedor.clientWidth - 16) / PAGINA_ANCHO_PX))
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(contenedor)
    return () => observador.disconnect()
  }, [movimientos.data])

  const exportando = estado.tipo === 'exportando'

  async function exportar(formato: 'pdf' | 'word'): Promise<void> {
    setEstado({ tipo: 'exportando', formato })
    try {
      const ruta =
        formato === 'pdf'
          ? await window.api.exportarFormularioPdf(html, NOMBRE_ARCHIVO_FORMULARIO_MP)
          : await window.api.exportarFormularioWord(
              generarDocumentoWordFormularioMp(bloques),
              NOMBRE_ARCHIVO_FORMULARIO_MP
            )
      setEstado(ruta ? { tipo: 'listo', ruta } : { tipo: 'cancelado' })
    } catch (error) {
      setEstado({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Control de entrega de materias primas</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onVolver}>
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Button>
            <Button onClick={() => exportar('pdf')} disabled={exportando || bloques.length === 0}>
              {exportando && estado.formato === 'pdf' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              Exportar PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => exportar('word')}
              disabled={exportando || bloques.length === 0}
            >
              {exportando && estado.formato === 'word' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Exportar Word
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {numerosOt.length} OT · {bloques.length} bloque{bloques.length === 1 ? '' : 's'} ·{' '}
            {hojas} hoja{hojas === 1 ? '' : 's'} tamaño carta horizontal. Una OT con más de{' '}
            {MEDIDAS_FORMULARIO_MP.filasPorBloque} movimientos sigue en el bloque siguiente.
            TINTAS y DIG. van en blanco: el sistema no guarda esos datos.
          </p>

          {movimientos.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando movimientos...</p>
          )}
          {movimientos.isError && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
              <p className="text-sm text-destructive">No se pudieron cargar los movimientos.</p>
              <Button variant="outline" onClick={() => movimientos.refetch()}>
                Reintentar
              </Button>
            </div>
          )}
          {estado.tipo === 'listo' && (
            <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
              Guardado en {estado.ruta}
            </p>
          )}
          {estado.tipo === 'cancelado' && (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              Exportación cancelada.
            </p>
          )}
          {estado.tipo === 'error' && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              No se pudo exportar: {estado.mensaje}
            </p>
          )}

          <div ref={contenedorRef} className="overflow-hidden rounded-md bg-muted p-2">
            <div style={{ height: altoPreviaPx * escala }}>
              <iframe
                title="Vista previa del formulario"
                srcDoc={htmlPantalla}
                scrolling="no"
                style={{
                  width: PAGINA_ANCHO_PX,
                  height: altoPreviaPx,
                  border: 0,
                  transform: `scale(${escala})`,
                  transformOrigin: 'top left'
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
