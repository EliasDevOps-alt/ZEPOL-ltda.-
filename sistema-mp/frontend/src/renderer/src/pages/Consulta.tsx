import type { FormEvent } from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'

export function Consulta() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [numeroOt, setNumeroOt] = useState('')
  const [otBuscada, setOtBuscada] = useState<string | null>(null)

  const consumo = useQuery({
    queryKey: ['consumo', otBuscada],
    queryFn: () => api.consultarConsumo(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  function buscar(e: FormEvent) {
    e.preventDefault()
    setOtBuscada(numeroOt)
  }

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 text-2xl font-semibold">Consultar OT</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Buscar</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={buscar} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>Número de OT</Label>
              <Input value={numeroOt} onChange={(e) => setNumeroOt(e.target.value)} placeholder="123" />
            </div>
            <Button type="submit" variant="outline">
              <Search className="h-4 w-4" />
              Buscar
            </Button>
          </form>
        </CardContent>
      </Card>

      {consumo.isSuccess && consumo.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay movimientos para esa OT.</p>
      )}

      {consumo.data && consumo.data.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="p-3">Proceso</th>
                  <th className="p-3">Máquina</th>
                  <th className="p-3">Material</th>
                  <th className="p-3 text-right">Requerido</th>
                  <th className="p-3 text-right">Entregado</th>
                  <th className="p-3 text-right">Devuelto</th>
                  <th className="p-3 text-right">Consumo neto</th>
                  <th className="p-3">Avance</th>
                  <th className="p-3">Estado SID</th>
                </tr>
              </thead>
              <tbody>
                {consumo.data.map((row) => (
                  <tr key={row.ot_material_id} className="border-b border-border last:border-0">
                    <td className="p-3">{row.proceso}</td>
                    <td className="p-3">{row.maquina}</td>
                    <td className="p-3">{row.codigo_mp}</td>
                    <td className="p-3 text-right">
                      {row.cantidad_requerida ?? '—'} {row.cantidad_requerida ? row.unidad : ''}
                    </td>
                    <td className="p-3 text-right">
                      {row.total_entregado} {row.unidad}
                    </td>
                    <td className="p-3 text-right">
                      {row.total_devuelto} {row.unidad}
                    </td>
                    <td className="p-3 text-right font-medium">
                      {row.consumo_neto} {row.unidad}
                    </td>
                    <td className="p-3">{row.estado_entrega}</td>
                    <td className="p-3">{row.estado_sid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
