import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileText, Loader2, Printer } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import {
  generarDocumentoWordFormularioPt,
  generarHtmlFormularioPt,
  NOMBRE_ARCHIVO_FORMULARIO_PT
} from '@renderer/lib/formularioPt'

// Hoja carta a 96dpi, y el área útil que queda descontando los márgenes que
// define el @page del formulario (0.72in arriba/abajo, 0.645in a los lados).
const PAGINA_ANCHO_PX = 816
const PAGINA_ALTO_PX = 1056
const MARGEN_VERTICAL_PX = 69
const MARGEN_HORIZONTAL_PX = 62

type Estado =
  | { tipo: 'inactivo' }
  | { tipo: 'exportando'; formato: 'pdf' | 'word' }
  | { tipo: 'listo'; ruta: string }
  | { tipo: 'cancelado' }
  | { tipo: 'error'; mensaje: string }

export function ProductoTerminado() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'inactivo' })
  const contenedorRef = useRef<HTMLDivElement>(null)
  const [escala, setEscala] = useState(1)

  // El formulario todavía no se llena con datos: por ahora es el formato en
  // blanco, listo para imprimir. generarHtmlFormularioPt ya acepta los datos
  // para cuando se enganche con una OT.
  const html = useMemo(() => generarHtmlFormularioPt(), [])

  // La vista previa muestra la hoja carta entera, escalada para que entre en el
  // ancho disponible sin scroll horizontal.
  useLayoutEffect(() => {
    const contenedor = contenedorRef.current
    if (!contenedor) return
    const medir = (): void => {
      const disponible = contenedor.clientWidth
      setEscala(Math.min(1, disponible / PAGINA_ANCHO_PX))
    }
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(contenedor)
    return () => observador.disconnect()
  }, [])

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
          ? await window.api.exportarFormularioPdf(html, NOMBRE_ARCHIVO_FORMULARIO_PT)
          : await window.api.exportarFormularioWord(
              generarDocumentoWordFormularioPt(),
              NOMBRE_ARCHIVO_FORMULARIO_PT
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
          <CardTitle>Formulario de ingreso de productos terminados</CardTitle>
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
            Formato P-LOG-001-F-04/V.4.0, tamaño carta. Así se va a ver impreso.
          </p>

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

          <div ref={contenedorRef} className="flex justify-center">
            <div
              className="shrink-0 origin-top border border-border bg-white shadow-md"
              style={{
                width: PAGINA_ANCHO_PX,
                height: PAGINA_ALTO_PX,
                padding: `${MARGEN_VERTICAL_PX}px ${MARGEN_HORIZONTAL_PX}px`,
                transform: `scale(${escala})`,
                marginBottom: PAGINA_ALTO_PX * (escala - 1)
              }}
            >
              <iframe
                title="Vista previa del formulario"
                srcDoc={html}
                scrolling="no"
                className="h-full w-full border-0"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
