import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FileText, Loader2, Printer, Scale, Search, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import {
  datosFormularioDesdePt,
  generarDocumentoWordFormularioPt,
  generarHtmlFormularioPt,
  hojasFormularioPt,
  NOMBRE_ARCHIVO_FORMULARIO_PT
} from '@renderer/lib/formularioPt'
import type { ProductoTerminado as ProductoTerminadoDatos } from '@renderer/lib/types'
import { ConfirmarUnidadPt } from '@renderer/components/ConfirmarUnidadPt'
import { RegistroPesoPt } from '@renderer/components/RegistroPesoPt'
import { VisorHojas } from '@renderer/components/VisorHojas'
import { cn } from '@renderer/lib/utils'

// El formulario tiene 5 renglones de ITEM; una OT con más no entra entera.
const MAX_ITEMS_FORMULARIO = 5
// Las dos de siempre; cualquier otra se escribe con "Otra".
const MONEDAS = ['Bs.', '$us']

// Hoja carta a 96dpi, y el área útil que queda descontando los márgenes que
// define el @page del formulario (0.72in arriba/abajo, 0.645in a los lados).
const PAGINA_ANCHO_PX = 816
const PAGINA_ALTO_PX = 1056
const MARGEN_VERTICAL_PX = 69
const MARGEN_HORIZONTAL_PX = 62

type Pestana = 'formulario' | 'peso'

// La OT abierta y la pestaña se recuerdan mientras dure la sesión de la app:
// al ir a otra pantalla y volver, se sigue en la misma OT (pedido de Elias).
// Es solo una comodidad de esta estación — sessionStorage puede fallar o
// venir vacío, y la pantalla tiene que andar igual.
const CLAVE_OT = 'zepol.pt.ot'
const CLAVE_PESTANA = 'zepol.pt.pestana'

function leerSesion(clave: string): string | null {
  try {
    return sessionStorage.getItem(clave)
  } catch {
    return null
  }
}

function guardarSesion(clave: string, valor: string | null): void {
  try {
    if (valor === null) sessionStorage.removeItem(clave)
    else sessionStorage.setItem(clave, valor)
  } catch {
    // Sin sessionStorage solo se pierde la comodidad de volver a la OT.
  }
}

type Estado =
  | { tipo: 'inactivo' }
  | { tipo: 'exportando'; formato: 'pdf' | 'word' }
  | { tipo: 'listo'; ruta: string }
  | { tipo: 'cancelado' }
  | { tipo: 'error'; mensaje: string }

export function ProductoTerminado() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [estado, setEstado] = useState<Estado>({ tipo: 'inactivo' })
  const [numeroOt, setNumeroOt] = useState(() => leerSesion(CLAVE_OT) ?? '')
  // null = formato en blanco (para imprimir y llenar a mano, como antes).
  const [pt, setPt] = useState<ProductoTerminadoDatos | null>(null)
  const [pestana, setPestana] = useState<Pestana>(() =>
    leerSesion(CLAVE_PESTANA) === 'peso' ? 'peso' : 'formulario'
  )

  const abrir = useMutation({
    mutationFn: (numero: string) => api.abrirProductoTerminado(apiBaseUrl, token, numero),
    onSuccess: (datos) => {
      setPt(datos)
      setNumeroOt(datos.numero_ot)
      guardarSesion(CLAVE_OT, datos.numero_ot)
    }
  })

  // Al volver a la pantalla, se reabre la última OT.
  useEffect(() => {
    const anterior = leerSesion(CLAVE_OT)
    if (anterior) abrir.mutate(anterior)
    // Solo al montar la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function cambiarPestana(nueva: Pestana): void {
    setPestana(nueva)
    guardarSesion(CLAVE_PESTANA, nueva)
  }
  const fijarMoneda = useMutation({
    mutationFn: (moneda: string | null) => api.fijarMonedaPt(apiBaseUrl, token, pt!.numero_ot, moneda),
    onSuccess: (datos) => setPt(datos)
  })
  const [otraMoneda, setOtraMoneda] = useState<string | null>(null)
  const monedaEsOtra = pt?.moneda != null && !MONEDAS.includes(pt.moneda)

  // Los pesajes van escritos en "Registrar Fecha, Cantidades y Pesos".
  const pesajes = useQuery({
    queryKey: ['pesajes-pt', pt?.numero_ot],
    queryFn: () => api.listarPesajesPt(apiBaseUrl, token, pt!.numero_ot),
    enabled: pt !== null
  })

  const datos = useMemo(() => (pt ? datosFormularioDesdePt(pt, pesajes.data) : {}), [pt, pesajes.data])
  const html = useMemo(() => generarHtmlFormularioPt(datos), [datos])
  // La vista previa va hoja por hoja: cada una en su propio iframe tamaño
  // carta, así los márgenes se ven igual que impresos.
  const hojas = useMemo(
    () => Array.from({ length: hojasFormularioPt(datos) }, (_, i) => generarHtmlFormularioPt(datos, { soloHoja: i })),
    [datos]
  )
  const nombreArchivo = pt ? `${NOMBRE_ARCHIVO_FORMULARIO_PT}-OT-${pt.numero_ot}` : NOMBRE_ARCHIVO_FORMULARIO_PT

  function buscar(e: React.FormEvent): void {
    e.preventDefault()
    const numero = numeroOt.trim()
    if (numero) abrir.mutate(numero)
  }

  function limpiar(): void {
    setPt(null)
    setNumeroOt('')
    guardarSesion(CLAVE_OT, null)
    abrir.reset()
    fijarMoneda.reset()
    setOtraMoneda(null)
  }

  useEffect(() => {
    if (estado.tipo !== 'listo' && estado.tipo !== 'cancelado') return
    const id = setTimeout(() => setEstado({ tipo: 'inactivo' }), 6000)
    return () => clearTimeout(id)
  }, [estado])

  const exportando = estado.tipo === 'exportando'

  async function exportar(formato: 'pdf' | 'word'): Promise<void> {
    setEstado({ tipo: 'exportando', formato })
    try {
      const ruta =
        formato === 'pdf'
          ? await window.api.exportarFormularioPdf(html, nombreArchivo)
          : await window.api.exportarFormularioWord(generarDocumentoWordFormularioPt(datos), nombreArchivo)
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
        <CardHeader>
          <CardTitle>Producto Terminado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Búsqueda y pestañas en la misma fila, para no ocupar espacio. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <form onSubmit={buscar} className="flex flex-wrap items-center gap-2">
              <Input
                value={numeroOt}
                onChange={(e) => setNumeroOt(e.target.value)}
                placeholder="Número de OT"
                className="w-48"
              />
              <Button type="submit" disabled={!numeroOt.trim() || abrir.isPending}>
                {abrir.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar OT
              </Button>
              {pt && (
                <Button type="button" variant="outline" onClick={limpiar}>
                  <X className="h-4 w-4" />
                  Formato en blanco
                </Button>
              )}
            </form>

            <div role="tablist" className="flex rounded-md border border-border p-0.5">
              {(
                [
                  ['formulario', 'Formulario de ingreso', FileText],
                  ['peso', 'Registro de peso', Scale]
                ] as const
              ).map(([valor, etiqueta, Icono]) => (
                <button
                  key={valor}
                  type="button"
                  role="tab"
                  aria-selected={pestana === valor}
                  onClick={() => cambiarPestana(valor)}
                  className={cn(
                    'flex h-9 items-center gap-2 rounded px-3 text-sm font-medium',
                    pestana === valor
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icono className="h-4 w-4" />
                  {etiqueta}
                </button>
              ))}
            </div>
          </div>

          {abrir.isError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {abrir.error.message}
            </p>
          )}

          {pt && (
            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">OT:</span> <strong>{pt.numero_ot}</strong>
              </p>
              <p>
                <span className="text-muted-foreground">Cliente:</span> {pt.cliente ?? '—'}
              </p>
              <p className="sm:col-span-2">
                <span className="text-muted-foreground">Producto:</span>{' '}
                {pt.items
                  .map((i) => i.descripcion_producto)
                  .filter(Boolean)
                  .join(' / ') || '—'}
              </p>
            </div>
          )}

          {pt && pt.unidad === null && <ConfirmarUnidadPt pt={pt} onConfirmada={setPt} />}
        </CardContent>
      </Card>

      {pestana === 'peso' &&
        (pt ? (
          <RegistroPesoPt key={pt.numero_ot} pt={pt} />
        ) : (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Busca una OT para registrar sus pesajes.
          </p>
        ))}

      {pestana === 'formulario' && (
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Formulario de ingreso de productos terminados</CardTitle>
          <div className="flex items-center gap-2">
            <Button onClick={() => exportar('pdf')} disabled={exportando}>
              {exportando && estado.formato === 'pdf' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              Exportar PDF
            </Button>
            <Button variant="outline" onClick={() => exportar('word')} disabled={exportando}>
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
            {pt
              ? 'Formato P-LOG-001-F-04/V.4.0, tamaño carta. Así se va a ver impreso.'
              : 'Formato P-LOG-001-F-04/V.4.0 en blanco, tamaño carta. Busca una OT para llenarlo con sus datos.'}
          </p>

          {pt && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Moneda:</span>
              {MONEDAS.map((moneda) => (
                <Button
                  key={moneda}
                  size="sm"
                  variant={pt.moneda === moneda ? 'default' : 'outline'}
                  disabled={fijarMoneda.isPending}
                  onClick={() => {
                    setOtraMoneda(null)
                    fijarMoneda.mutate(pt.moneda === moneda ? null : moneda)
                  }}
                >
                  {moneda}
                </Button>
              ))}
              <Button
                size="sm"
                variant={otraMoneda !== null || monedaEsOtra ? 'default' : 'outline'}
                disabled={fijarMoneda.isPending}
                onClick={() => setOtraMoneda(monedaEsOtra ? pt.moneda! : '')}
              >
                Otra
              </Button>
              {otraMoneda !== null && (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    fijarMoneda.mutate(otraMoneda.trim() || null, { onSuccess: () => setOtraMoneda(null) })
                  }}
                >
                  <Input
                    autoFocus
                    value={otraMoneda}
                    maxLength={20}
                    onChange={(e) => setOtraMoneda(e.target.value)}
                    placeholder="Ej. EUR"
                    className="h-8 w-28"
                  />
                  <Button type="submit" size="sm" disabled={fijarMoneda.isPending}>
                    Guardar
                  </Button>
                </form>
              )}
              {monedaEsOtra && otraMoneda === null && <span className="text-muted-foreground">({pt.moneda})</span>}
              {fijarMoneda.isError && <span className="text-destructive">{fijarMoneda.error.message}</span>}
            </div>
          )}

          {pt && pesajes.isError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              No se pudieron cargar los pesajes de la OT: {pesajes.error.message}. El formulario sale sin ellos.
            </p>
          )}
          {pt && pesajes.data && pesajes.data.pesajes.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Con {pesajes.data.pesajes.length} pesaje{pesajes.data.pesajes.length === 1 ? '' : 's'} registrado
              {pesajes.data.pesajes.length === 1 ? '' : 's'}
              {hojas.length > 1 ? ` — ocupa ${hojas.length} hojas` : ''}.
            </p>
          )}

          {pt && pt.items.length > MAX_ITEMS_FORMULARIO && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              Esta OT tiene {pt.items.length} productos y el formulario solo tiene {MAX_ITEMS_FORMULARIO} renglones:
              los últimos {pt.items.length - MAX_ITEMS_FORMULARIO} no salen impresos. El Pedido Total sí los incluye.
            </p>
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

          <VisorHojas
            hojas={hojas}
            anchoPx={PAGINA_ANCHO_PX}
            altoPx={PAGINA_ALTO_PX}
            margenVerticalPx={MARGEN_VERTICAL_PX}
            margenHorizontalPx={MARGEN_HORIZONTAL_PX}
            titulo="Vista previa del formulario"
          />
        </CardContent>
      </Card>
      )}
    </div>
  )
}
