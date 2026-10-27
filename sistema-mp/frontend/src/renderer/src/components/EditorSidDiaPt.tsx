import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'

/**
 * El N° que el SID dio a un día pesado de una OT: lo escribe una persona
 * (el sistema no lo calcula). Sin N° = ese día todavía no está registrado en
 * el SID. Si después de anotarlo se agregó, corrigió o borró un pesaje de ese
 * día, aparece "Cambió después del SID" hasta que alguien lo revise.
 *
 * Es el mismo dato que la casilla "Nº =" del formulario: se guarda en la base
 * y sale en el PDF, el Word y el Excel.
 */
export function EditorSidDiaPt({
  numeroOt,
  fecha,
  numeroSid,
  revisar,
  registradoPor
}: {
  numeroOt: string
  /** AAAA-MM-DD */
  fecha: string
  numeroSid: string | null
  revisar: boolean
  registradoPor: string | null
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()
  const [texto, setTexto] = useState(numeroSid ?? '')
  useEffect(() => setTexto(numeroSid ?? ''), [numeroSid])

  const refrescar = (): Promise<unknown> =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pesajes-pt', numeroOt] }),
      queryClient.invalidateQueries({ queryKey: ['sid-dias-pt'] })
    ])

  const guardar = useMutation({
    mutationFn: () => api.fijarSidDiaPt(apiBaseUrl, token, numeroOt, fecha, texto.trim()),
    onSuccess: refrescar
  })
  const confirmar = useMutation({
    mutationFn: () => api.confirmarRevisionSidDiaPt(apiBaseUrl, token, numeroOt, fecha),
    onSuccess: refrescar
  })

  const cambio = texto.trim() !== (numeroSid ?? '')
  const valido = /^[0-9]*$/.test(texto.trim())

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (cambio && valido && !guardar.isPending) guardar.mutate()
        }}
      >
        <label className="text-sm font-medium" htmlFor={`sid-${numeroOt}-${fecha}`}>
          N° SID
        </label>
        <Input
          id={`sid-${numeroOt}-${fecha}`}
          inputMode="numeric"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Sin registrar"
          className="h-8 w-32"
        />
        {cambio && (
          <Button type="submit" size="sm" disabled={!valido || guardar.isPending}>
            {guardar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Guardar
          </Button>
        )}
      </form>
      {!cambio && numeroSid && registradoPor && (
        <span className="text-xs text-muted-foreground">Lo anotó {registradoPor}</span>
      )}
      {revisar && !cambio && (
        <span className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs">
          Cambió después del SID: revisa si el SID quedó al día.
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            disabled={confirmar.isPending}
            onClick={() => confirmar.mutate()}
          >
            Ya revisé
          </Button>
        </span>
      )}
      {!valido && <span className="text-xs text-destructive">Solo números.</span>}
      {(guardar.isError || confirmar.isError) && (
        <span className="text-xs text-destructive">{(guardar.error ?? confirmar.error)?.message}</span>
      )}
    </div>
  )
}
