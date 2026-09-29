import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

// Niveles de zoom de los botones + y −, como en un visor de PDF.
const NIVELES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]
// Relleno del marco (p-3), que no cuenta como espacio para la hoja.
const RELLENO_PX = 24

/**
 * Vista previa de un documento de varias hojas (una por iframe) con zoom y
 * desplazamiento, como un visor de PDF. Pedido de Elias: los números del
 * formulario de Producto Terminado se leían chicos en la vista previa.
 *
 * - "Ajustar" (por defecto) muestra la hoja entera al ancho disponible.
 * - Botones + / −, o Ctrl + rueda del ratón, para acercar o alejar.
 * - Con zoom, la hoja se recorre con las barras o arrastrándola.
 *
 * Los iframes van sin eventos de ratón (pointer-events: none): son solo
 * vista previa, y así la rueda y el arrastre llegan al marco en vez de
 * quedarse dentro del iframe.
 *
 * `conMarco` (por defecto) dibuja cada hoja como un papel blanco con sus
 * márgenes. Sin marco, el HTML ya trae sus propias hojas dibujadas — el
 * formulario de Reportes pone todas en un solo documento, con su fondo gris
 * y la separación entre hojas.
 */
export function VisorHojas({
  hojas,
  anchoPx,
  altoPx,
  margenVerticalPx = 0,
  margenHorizontalPx = 0,
  conMarco = true,
  titulo
}: {
  hojas: string[]
  anchoPx: number
  altoPx: number
  margenVerticalPx?: number
  margenHorizontalPx?: number
  conMarco?: boolean
  titulo: string
}) {
  const marcoRef = useRef<HTMLDivElement>(null)
  const [ajuste, setAjuste] = useState(1)
  // null = "Ajustar": la escala sigue al ancho del marco.
  const [zoom, setZoom] = useState<number | null>(null)
  const escala = zoom ?? ajuste
  const escalaRef = useRef(escala)
  const [arrastrando, setArrastrando] = useState(false)
  const arrastre = useRef<{ x: number; y: number; izquierda: number; arriba: number } | null>(null)

  useLayoutEffect(() => {
    const marco = marcoRef.current
    if (!marco) return
    const medir = (): void => {
      const disponible = marco.clientWidth - RELLENO_PX
      // Un ancho 0 es el marco desmontándose, no una medida real.
      if (disponible > 0) setAjuste(Math.min(1, disponible / anchoPx))
    }
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(marco)
    return () => observador.disconnect()
  }, [anchoPx])

  // Al cambiar el zoom se mantiene centrado el mismo punto de la hoja, en
  // vez de saltar al borde de arriba a la izquierda.
  useLayoutEffect(() => {
    const marco = marcoRef.current
    const anterior = escalaRef.current
    escalaRef.current = escala
    if (!marco || anterior === escala) return
    const factor = escala / anterior
    const centroX = marco.scrollLeft + marco.clientWidth / 2
    const centroY = marco.scrollTop + marco.clientHeight / 2
    marco.scrollLeft = centroX * factor - marco.clientWidth / 2
    marco.scrollTop = centroY * factor - marco.clientHeight / 2
  }, [escala])

  function acercar(): void {
    const actual = escalaRef.current
    setZoom(NIVELES.find((n) => n > actual + 0.001) ?? NIVELES[NIVELES.length - 1])
  }

  function alejar(): void {
    const actual = escalaRef.current
    setZoom([...NIVELES].reverse().find((n) => n < actual - 0.001) ?? NIVELES[0])
  }

  // Ctrl + rueda: zoom. Tiene que ser un listener no pasivo para poder
  // cancelar el zoom de toda la ventana que haría Electron por su cuenta.
  useEffect(() => {
    const marco = marcoRef.current
    if (!marco) return
    const alGirar = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      if (e.deltaY < 0) acercar()
      else alejar()
    }
    marco.addEventListener('wheel', alGirar, { passive: false })
    return () => marco.removeEventListener('wheel', alGirar)
  }, [])

  function empezarArrastre(e: React.MouseEvent<HTMLDivElement>): void {
    const marco = marcoRef.current
    if (e.button !== 0 || !marco) return
    arrastre.current = { x: e.clientX, y: e.clientY, izquierda: marco.scrollLeft, arriba: marco.scrollTop }
    setArrastrando(true)
  }

  function arrastrar(e: React.MouseEvent<HTMLDivElement>): void {
    const marco = marcoRef.current
    const inicio = arrastre.current
    if (!marco || !inicio) return
    marco.scrollLeft = inicio.izquierda - (e.clientX - inicio.x)
    marco.scrollTop = inicio.arriba - (e.clientY - inicio.y)
  }

  function terminarArrastre(): void {
    arrastre.current = null
    setArrastrando(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={alejar}
          title="Alejar"
          disabled={escala <= NIVELES[0]}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="w-14 text-center text-sm font-medium tabular-nums">{Math.round(escala * 100)}%</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={acercar}
          title="Acercar"
          disabled={escala >= NIVELES[NIVELES.length - 1]}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={zoom === null ? 'default' : 'outline'}
          onClick={() => setZoom(null)}
          title="Ver la hoja entera"
        >
          <Maximize2 className="h-4 w-4" />
          Ajustar
        </Button>
        <span className="text-xs text-muted-foreground">
          Ctrl + rueda del ratón para acercar · arrastra la hoja para moverte
        </span>
      </div>

      <div
        ref={marcoRef}
        onMouseDown={empezarArrastre}
        onMouseMove={arrastrar}
        onMouseUp={terminarArrastre}
        onMouseLeave={terminarArrastre}
        className={cn(
          'max-h-[75vh] select-none overflow-auto rounded-md border border-border bg-muted/40 p-3',
          arrastrando ? 'cursor-grabbing' : 'cursor-grab'
        )}
      >
        <div className="flex w-max min-w-full flex-col items-center gap-6">
          {hojas.map((hoja, i) => (
            // El contenedor ocupa el tamaño ya escalado, así las barras de
            // desplazamiento saben cuánto mide la hoja con zoom.
            <div
              key={i}
              className={cn('relative shrink-0', conMarco && 'shadow-md')}
              style={{ width: anchoPx * escala, height: altoPx * escala }}
            >
              <div
                className={cn('absolute left-0 top-0 origin-top-left', conMarco && 'border border-border bg-white')}
                style={{
                  width: anchoPx,
                  height: altoPx,
                  padding: `${margenVerticalPx}px ${margenHorizontalPx}px`,
                  transform: `scale(${escala})`
                }}
              >
                <iframe
                  title={`${titulo}, hoja ${i + 1}`}
                  srcDoc={hoja}
                  scrolling="no"
                  className="pointer-events-none h-full w-full border-0"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
