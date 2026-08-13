import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FileSpreadsheet, FolderOpen, TriangleAlert } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'

export function ConfiguracionExcel() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState(false)

  const configuracion = useQuery({
    queryKey: ['configuracion-excel'],
    queryFn: () => api.obtenerConfigExcel(apiBaseUrl, token)
  })

  const guardar = useMutation({
    mutationFn: (ruta: string) => api.actualizarConfigExcel(apiBaseUrl, token, ruta),
    onSuccess: () => {
      setError(null)
      setExito(true)
      queryClient.invalidateQueries({ queryKey: ['configuracion-excel'] })
    },
    onError: (err) => {
      setExito(false)
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar la ruta')
    }
  })

  async function localizarArchivo() {
    setError(null)
    setExito(false)
    const ruta = await window.api.elegirArchivoExcel()
    if (!ruta) return
    guardar.mutate(ruta)
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-2 text-2xl font-semibold">Excel OC-MP</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Ubicación del libro de Excel ("oc mp") que el sistema consulta cuando busca una OT que todavía no está en
        la base de datos.
      </p>

      <div className="mb-6 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-4 text-sm">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p>
          Este archivo vive en la PC que actúa como servidor. Usa el botón de abajo solo desde esa PC — elegir un
          archivo desde otra estación apuntaría a una ruta que no existe ahí.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Ruta configurada
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {configuracion.isError && (
            <p className="text-sm text-destructive">No se pudo consultar la configuración actual.</p>
          )}

          <p className="break-all rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {configuracion.data?.ruta ?? 'Todavía no se configuró ninguna ruta.'}
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {exito && (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />
              Ruta guardada — se validó que el archivo abre y tiene la hoja "oc mp".
            </p>
          )}

          <Button type="button" onClick={localizarArchivo} disabled={guardar.isPending} className="self-start">
            <FolderOpen className="h-4 w-4" />
            {guardar.isPending ? 'Verificando...' : 'Localizar archivo Excel'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
