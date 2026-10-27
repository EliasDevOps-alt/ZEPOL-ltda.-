import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Search } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { EditorSidDiaPt } from '@renderer/components/EditorSidDiaPt'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { formatearFecha } from '@renderer/lib/fechas'
import { cn } from '@renderer/lib/utils'

type Filtro = 'pendientes' | 'registrados' | 'todos'

const FILTROS: [Filtro, string][] = [
  ['pendientes', 'Pendientes'],
  ['registrados', 'Registrados'],
  ['todos', 'Todos']
]

/**
 * Cada día pesado de cada OT y si ya tiene su N° del SID. El N° lo da el SID
 * cuando se registra ese día (uno por OT y por día) y lo anota una persona:
 * sin N° = falta registrar en el SID. "Pendientes" también muestra los días
 * que ya tenían N° pero cambiaron después.
 */
export function SidPendientesPt({ onAbrirOt }: { onAbrirOt: (numeroOt: string) => void }) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const [filtro, setFiltro] = useState<Filtro>('pendientes')
  const [busqueda, setBusqueda] = useState('')

  const dias = useQuery({
    queryKey: ['sid-dias-pt', filtro, busqueda],
    queryFn: () => api.listarSidDiasPt(apiBaseUrl, token, filtro, busqueda)
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">SID de los pesajes de Producto Terminado</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" className="flex rounded-md border border-border p-0.5">
            {FILTROS.map(([valor, etiqueta]) => (
              <button
                key={valor}
                type="button"
                role="tab"
                aria-selected={filtro === valor}
                onClick={() => setFiltro(valor)}
                className={cn(
                  'h-8 rounded px-3 text-sm font-medium',
                  filtro === valor
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {etiqueta}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por OT o cliente"
              className="h-8 w-64 pl-8"
            />
          </div>
        </div>

        {dias.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        {dias.isError && <p className="text-sm text-destructive">No se pudo cargar la lista: {dias.error.message}</p>}
        {dias.data && dias.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {filtro === 'pendientes' ? 'No hay días pendientes de SID.' : 'No hay días para mostrar.'}
          </p>
        )}

        <div className="space-y-2">
          {dias.data?.map((dia) => (
            <div
              key={`${dia.numero_ot}-${dia.fecha}`}
              className={cn(
                'space-y-2 rounded-md border p-3',
                dia.numero_sid === null ? 'border-border' : dia.revisar ? 'border-warning/50' : 'border-success/40'
              )}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <strong>{formatearFecha(dia.fecha)}</strong>
                <span>
                  OT <strong>{dia.numero_ot}</strong>
                </span>
                <span className="text-muted-foreground">{dia.cliente ?? '—'}</span>
                <span>
                  {dia.pesajes} pesaje{dia.pesajes === 1 ? '' : 's'} · {dia.kg.toLocaleString('en-US', { maximumFractionDigits: 2, useGrouping: false })} kg
                </span>
                <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => onAbrirOt(dia.numero_ot)}>
                  Abrir OT
                </Button>
              </div>
              <EditorSidDiaPt
                numeroOt={dia.numero_ot}
                fecha={dia.fecha}
                numeroSid={dia.numero_sid}
                revisar={dia.revisar}
                registradoPor={dia.registrado_por}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
