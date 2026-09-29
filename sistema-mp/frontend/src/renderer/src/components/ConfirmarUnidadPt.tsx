import { useMutation } from '@tanstack/react-query'
import { Button } from '@renderer/components/ui/button'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ROTULO_UNIDAD_PT } from '@renderer/lib/formularioPt'
import type { ProductoTerminado, UnidadPt } from '@renderer/lib/types'

const UNIDADES: UnidadPt[] = ['KG', 'BOLSAS', 'MILLAR']

/**
 * Aviso para una OT cuya columna "Med." del Excel no se reconoció (ej.
 * "lamina", o vacía). Sin la unidad no se puede calcular el avance ni pesar,
 * así que se pregunta en vez de adivinar. Compartido por el formulario de
 * Producto Terminado y el registro de pesaje.
 */
export function ConfirmarUnidadPt({
  pt,
  onConfirmada
}: {
  pt: ProductoTerminado
  onConfirmada: (pt: ProductoTerminado) => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const confirmar = useMutation({
    mutationFn: (unidad: UnidadPt) => api.confirmarUnidadPt(apiBaseUrl, sesion!.token, pt.numero_ot, unidad),
    onSuccess: onConfirmada
  })

  return (
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <p>
        No se reconoce la unidad de esta OT en el Excel
        {pt.medida_excel ? ` ("${pt.medida_excel}")` : ' (está vacía)'}. Por favor confirme si es Kg, Bolsas o Mill:
      </p>
      <div className="flex flex-wrap gap-2">
        {UNIDADES.map((unidad) => (
          <Button
            key={unidad}
            size="sm"
            variant="outline"
            disabled={confirmar.isPending}
            onClick={() => confirmar.mutate(unidad)}
          >
            {ROTULO_UNIDAD_PT[unidad]}
          </Button>
        ))}
      </div>
      {confirmar.isError && <p className="text-destructive">{confirmar.error.message}</p>}
    </div>
  )
}
