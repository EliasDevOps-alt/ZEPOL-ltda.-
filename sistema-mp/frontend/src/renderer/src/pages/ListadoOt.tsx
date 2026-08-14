import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Search } from 'lucide-react'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent } from '@renderer/components/ui/card'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import { cn } from '@renderer/lib/utils'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'

function useDebounced(valor: string, ms: number): string {
  const [debounced, setDebounced] = useState(valor)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(valor), ms)
    return () => clearTimeout(id)
  }, [valor, ms])
  return debounced
}

function ultimoDiaDelMes(mesISO: string): string {
  const [anio, mes] = mesISO.split('-').map(Number)
  return new Date(anio, mes, 0).toISOString().slice(0, 10)
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function mesActualISO(): string {
  return hoyISO().slice(0, 7)
}

type ModoFecha = 'dia' | 'mes'

export function ListadoOt() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [q, setQ] = useState('')
  const [modoFecha, setModoFecha] = useState<ModoFecha>('dia')
  // Arranca en "hoy" a propósito — evita mostrar toda la lista histórica
  // apenas se entra a la pantalla.
  const [fecha, setFecha] = useState(hoyISO())
  const qDebounced = useDebounced(q, 300)

  const { desde, hasta } = useMemo(() => {
    if (!fecha) return { desde: '', hasta: '' }
    if (modoFecha === 'dia') return { desde: fecha, hasta: fecha }
    return { desde: `${fecha}-01`, hasta: ultimoDiaDelMes(fecha) }
  }, [modoFecha, fecha])

  const ordenes = useQuery({
    queryKey: ['ordenes-trabajo', qDebounced, desde, hasta],
    queryFn: () =>
      api.listarOrdenes(apiBaseUrl, token, {
        q: qDebounced || undefined,
        desde: desde || undefined,
        hasta: hasta || undefined
      })
  })

  const hayFiltros = q || fecha

  function limpiarFiltros() {
    setQ('')
    setFecha('')
  }

  function cambiarModo(modo: ModoFecha) {
    setModoFecha(modo)
    setFecha(modo === 'dia' ? hoyISO() : mesActualISO())
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Todas las OT</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Buscá por número de OT, cliente o diseño — filtra a medida que escribís. Tocá una para abrirla en Crear OT.
      </p>

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="OT, cliente o diseño..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full bg-muted p-1">
              <button
                type="button"
                onClick={() => cambiarModo('dia')}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  modoFecha === 'dia'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Día
              </button>
              <button
                type="button"
                onClick={() => cambiarModo('mes')}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  modoFecha === 'mes'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Mes
              </button>
            </div>

            <Input
              type={modoFecha === 'dia' ? 'date' : 'month'}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-auto"
            />

            {hayFiltros && (
              <button
                type="button"
                onClick={limpiarFiltros}
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {ordenes.isError && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          No se pudo cargar el listado —{' '}
          {ordenes.error instanceof ApiError ? ordenes.error.message : 'error de conexión'}. Revisa el servidor e
          intenta de nuevo.
        </div>
      )}

      {ordenes.data && ordenes.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {hayFiltros ? 'Ninguna OT coincide con este filtro.' : 'Todavía no hay órdenes de trabajo registradas.'}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {ordenes.data?.map((ot) => (
          <Link
            key={ot.id}
            to={`/crear-ot?ot=${encodeURIComponent(ot.numero_ot)}`}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-4 text-sm transition-colors hover:bg-muted"
          >
            <div className="min-w-0">
              <p className="font-medium">OT {ot.numero_ot}</p>
              <p className="truncate text-muted-foreground">
                {ot.cliente ?? 'Sin cliente'}
                {ot.diseno ? ` · ${ot.diseno}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {!ot.sincronizado_excel && (
                <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                  <FileSpreadsheet className="h-3 w-3" />
                  Excel pendiente
                </span>
              )}
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {new Date(ot.fecha_creacion).toLocaleDateString('es-BO')}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
