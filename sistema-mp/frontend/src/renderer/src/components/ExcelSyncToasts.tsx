import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import * as api from '@renderer/lib/api'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import type { RegistroExcelAutomatico } from '@renderer/lib/types'
import { cn } from '@renderer/lib/utils'

const DURACION_MS = 12000

interface Toast extends RegistroExcelAutomatico {
  toastId: number
}

/** Avisa en cualquier pantalla (no solo entrando a "Excel OC-MP") cuando el
 * vigilante automático importa una OT, le agrega materiales/datos o le
 * borra materiales que el cliente sacó del Excel — antes esto solo se veía
 * si alguien entraba a revisar esa pantalla a propósito. Vive en Layout
 * (montado una sola vez, para toda la sesión) y sondea el mismo endpoint
 * que ya usa ConfiguracionExcel.tsx, al mismo ritmo (20s, el del vigilante
 * en el backend) — no agrega carga nueva al servidor, solo la comparte.
 * Solo avisa de lo que aparece DESPUÉS de que la app ya está abierta: la
 * primera carga solo memoriza el último id visto, sin mostrar toda la
 * historia como si fuera nueva. */
export function ExcelSyncToasts() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const [toasts, setToasts] = useState<Toast[]>([])
  const ultimoIdVistoRef = useRef<number | null>(null)
  const contadorToastIdRef = useRef(0)

  const registro = useQuery({
    queryKey: ['registro-excel-automatico'],
    queryFn: () => api.obtenerRegistroExcel(apiBaseUrl, token),
    refetchInterval: 20000
  })

  useEffect(() => {
    const datos = registro.data
    if (!datos) return

    if (ultimoIdVistoRef.current === null) {
      ultimoIdVistoRef.current = datos[0]?.id ?? 0
      return
    }

    const nuevos = datos.filter((item) => item.id > ultimoIdVistoRef.current!)
    if (nuevos.length === 0) return
    ultimoIdVistoRef.current = Math.max(ultimoIdVistoRef.current, ...datos.map((d) => d.id))

    const conId = nuevos.map((item) => ({ ...item, toastId: ++contadorToastIdRef.current }))
    setToasts((actuales) => [...conId, ...actuales])
    conId.forEach((t) => {
      setTimeout(() => setToasts((actuales) => actuales.filter((x) => x.toastId !== t.toastId)), DURACION_MS)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registro.data])

  function cerrar(toastId: number) {
    setToasts((actuales) => actuales.filter((x) => x.toastId !== toastId))
  }

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.toastId}
          className={cn(
            'rounded-md border bg-card p-3 text-sm shadow-lg',
            t.tipo === 'eliminada' || t.detalle.includes('eliminado')
              ? 'border-destructive/30'
              : t.tipo === 'nueva'
                ? 'border-primary/30'
                : 'border-warning/30'
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">
              OT {t.numero_ot}
              {t.cliente ? ` — ${t.cliente}` : ''}
            </p>
            <button
              onClick={() => cerrar(t.toastId)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Cerrar aviso"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t.tipo === 'nueva'
              ? 'Importada del Excel'
              : t.tipo === 'eliminada'
                ? 'Ausente del Excel'
                : 'Actualizada desde el Excel'}{' '}
            · {t.detalle}
          </p>
        </div>
      ))}
    </div>
  )
}
