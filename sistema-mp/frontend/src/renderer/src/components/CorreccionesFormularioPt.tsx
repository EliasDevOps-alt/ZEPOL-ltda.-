import { useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import { PencilLine, Undo2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useConfirm } from '@renderer/components/ConfirmProvider'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import {
  CAMPOS_EDITABLES_FORMULARIO_PT,
  datosFormularioDesdePt,
  valorCampoFormularioPt
} from '@renderer/lib/formularioPt'
import type { ProductoTerminado } from '@renderer/lib/types'

const ETIQUETAS_ITEM: Record<string, string> = { codigo: 'Código', producto: 'Producto', total: 'Total' }

/** "cliente" → "Cliente"; "items.0.producto" → "Producto (ítem 1)". */
function etiquetaDeCampo(clave: string): string {
  const partes = clave.split('.')
  if (partes[0] === 'items') return `${ETIQUETAS_ITEM[partes[2]] ?? partes[2]} (ítem ${Number(partes[1]) + 1})`
  return CAMPOS_EDITABLES_FORMULARIO_PT.find((c) => c.clave === clave)?.etiqueta ?? clave
}

/**
 * Lista de los datos del formulario que se corrigieron a mano (se corrigen
 * haciendo clic directamente en la hoja), con su valor original y un botón para
 * volver a él. Lo corregido vale solo para el formulario: el Excel y la OT
 * quedan como están.
 */
export function CorreccionesFormularioPt({
  pt,
  onActualizado
}: {
  pt: ProductoTerminado
  onActualizado: (pt: ProductoTerminado) => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const confirmar = useConfirm()
  const claves = Object.keys(pt.ediciones)

  const original = useMemo(() => datosFormularioDesdePt({ ...pt, ediciones: {} }), [pt])
  const actual = useMemo(() => datosFormularioDesdePt(pt), [pt])

  const guardar = useMutation({
    mutationFn: (ediciones: Record<string, string>) =>
      api.guardarEdicionesFormularioPt(apiBaseUrl, sesion!.token, pt.numero_ot, ediciones),
    onSuccess: onActualizado
  })

  function restaurar(clave: string): void {
    const ediciones = { ...pt.ediciones }
    delete ediciones[clave]
    guardar.mutate(ediciones)
  }

  async function restaurarTodo(): Promise<void> {
    const ok = await confirmar(
      '¿Volver todos los datos del formulario a su valor original? Se pierden las correcciones hechas a mano.',
      { titulo: 'Volver al original', textoConfirmar: 'Volver al original', destructivo: true }
    )
    if (ok) guardar.mutate({})
  }

  if (claves.length === 0) return null

  return (
    <div className="space-y-2 rounded-md border border-warning/50 bg-warning/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <PencilLine className="h-4 w-4 text-warning" />
          Datos corregidos a mano
        </p>
        {claves.length > 1 && (
          <Button size="sm" variant="outline" disabled={guardar.isPending} onClick={() => void restaurarTodo()}>
            <Undo2 className="h-4 w-4" />
            Volver todo al original
          </Button>
        )}
      </div>

      <ul className="space-y-1.5">
        {claves.map((clave) => {
          const valorOriginal = valorCampoFormularioPt(original, clave)
          return (
            <li key={clave} className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-xs text-muted-foreground">{etiquetaDeCampo(clave)}</p>
                <p className="break-words">
                  {valorCampoFormularioPt(actual, clave) || <span className="text-muted-foreground">(en blanco)</span>}
                </p>
                <p className="break-words text-xs text-muted-foreground">
                  Original: {valorOriginal ? valorOriginal : '(en blanco)'}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 shrink-0 rounded-md border border-destructive/40 px-0 text-destructive hover:bg-destructive/10"
                aria-label={`Volver ${etiquetaDeCampo(clave)} al original`}
                title="Volver al original"
                disabled={guardar.isPending}
                onClick={() => restaurar(clave)}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
            </li>
          )
        })}
      </ul>

      {guardar.isError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          No se pudo guardar: {guardar.error.message}
        </p>
      )}
    </div>
  )
}
