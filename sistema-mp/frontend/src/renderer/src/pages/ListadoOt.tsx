import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, Search, Upload } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import { cn } from '@renderer/lib/utils'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import type { OtExcelNueva } from '@renderer/lib/types'

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

/** Vista previa de una OT antes de importarla del Excel — traerla sin ver
 * nada primero obligaba a confiar a ciegas en el resumen de la tarjeta
 * (solo cliente y descripción). Reutiliza buscarOtConFallback, que ya trae
 * todos los datos comerciales y los materiales tal como los muestra
 * "Cargar OT existente" en Crear OT. */
function DetalleExcelDialog({
  numeroOt,
  onOpenChange,
  onImportado
}: {
  numeroOt: string | null
  onOpenChange: (open: boolean) => void
  onImportado: (numeroOt: string) => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const detalle = useQuery({
    queryKey: ['ot-excel-detalle', numeroOt],
    queryFn: () => api.buscarOtConFallback(apiBaseUrl, token, numeroOt!),
    enabled: !!numeroOt
  })
  const datos = detalle.data?.excel

  const importar = useMutation({
    mutationFn: () => api.importarOtDesdeExcel(apiBaseUrl, token, numeroOt!),
    onSuccess: () => {
      onImportado(numeroOt!)
      onOpenChange(false)
    }
  })

  return (
    <Dialog open={!!numeroOt} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogTitle>OT {numeroOt} — vista previa del Excel</DialogTitle>

        {detalle.isLoading && <p className="text-sm text-muted-foreground">Cargando...</p>}
        {detalle.isError && (
          <p className="text-sm text-destructive">
            No se pudo leer el Excel —{' '}
            {detalle.error instanceof ApiError ? detalle.error.message : 'error de conexión'}
          </p>
        )}
        {detalle.isSuccess && !datos && (
          <p className="text-sm text-muted-foreground">Ya no se encuentra esta OT en el Excel.</p>
        )}

        {datos && (
          <div className="flex flex-col gap-4 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-3">
              <p>Cliente: <span className="text-foreground">{datos.cliente ?? '—'}</span></p>
              <p>Vendedor: <span className="text-foreground">{datos.vendedor ?? '—'}</span></p>
              <p>Ciudad: <span className="text-foreground">{datos.ciudad ?? '—'}</span></p>
              <p>SO: <span className="text-foreground">{datos.so ?? '—'}</span></p>
              <p>Almacén: <span className="text-foreground">{datos.alm ?? '—'}</span></p>
              <p>Tipo de trabajo: <span className="text-foreground">{datos.tipo_trabajo ?? '—'}</span></p>
              <p>Indicador: <span className="text-foreground">{datos.indicador ?? '—'}</span></p>
              <p>Status de entrega MP: <span className="text-foreground">{datos.status_entrega_mp ?? '—'}</span></p>
              <p>Fecha de seguimiento MP: <span className="text-foreground">{datos.fecha_seguimiento_mp ?? '—'}</span></p>
              <p>Fecha de pedido: <span className="text-foreground">{datos.fecha_pedido ?? '—'}</span></p>
              <p>Fecha de entrega: <span className="text-foreground">{datos.fecha_entrega ?? '—'}</span></p>
              <p>Código producto: <span className="text-foreground">{datos.codigo_producto ?? '—'}</span></p>
              <p className="col-span-2 sm:col-span-3">
                Descripción: <span className="text-foreground">{datos.descripcion_producto ?? '—'}</span>
              </p>
              <p>
                Total OT: <span className="text-foreground">{datos.total_ot ?? '—'}</span>
                {datos.medida ? ` ${datos.medida}` : ''}
              </p>
              <p>Entrega mes: <span className="text-foreground">{datos.entrega_mes ?? '—'}</span></p>
              <p>Equivalencia en Kg: <span className="text-foreground">{datos.equivalencia_kg ?? '—'}</span></p>
              <p>PU US$: <span className="text-foreground">{datos.pu_usd ?? '—'}</span></p>
              <p>PT US$: <span className="text-foreground">{datos.pt_usd ?? '—'}</span></p>
              <p>Precio total pedido US$: <span className="text-foreground">{datos.precio_total_pedido_usd ?? '—'}</span></p>
            </div>

            {datos.materiales.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Materiales pedidos (sin proceso/máquina asignados en Excel)
                </p>
                <ul className="flex flex-col gap-0.5 text-muted-foreground">
                  {datos.materiales.map((m, i) => (
                    <li key={i}>
                      {m.codigo_mp}
                      {m.cantidad_requerida != null ? ` — ${m.cantidad_requerida}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {importar.isError && (
              <p className="text-sm text-destructive">
                No se pudo importar —{' '}
                {importar.error instanceof ApiError ? importar.error.message : 'error de conexión'}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={importar.isPending} onClick={() => importar.mutate()}>
                {importar.isPending ? 'Importando...' : 'Aceptar — importar esta OT'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Detecta OT que ya tienen fila en "oc mp" pero todavía no se trajeron a la
 * base de datos — hasta ahora la única forma de traer una OT del Excel era
 * saber su número de antemano (Cargar OT existente en Crear OT). Consulta
 * manual (botón), no automática: abrir el Excel de más no vale la pena. Se
 * revisa antes de traer, igual que Comparar con Excel — cada una se importa
 * con su propio botón, no todas de una. */
function NuevasEnExcelCard() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  // Ver el detalle es el paso obligatorio antes de importar (ver
  // DetalleExcelDialog) — clickear una fila abre la vista previa en vez de
  // traerla directo, así que acá no hace falta un botón de importar aparte.
  const [numeroOtPreview, setNumeroOtPreview] = useState<string | null>(null)

  const nuevas = useQuery({
    queryKey: ['ots-nuevas-en-excel'],
    queryFn: () => api.listarOtsNuevasEnExcel(apiBaseUrl, token),
    enabled: false
  })

  function alImportar(numeroOt: string) {
    queryClient.setQueryData<OtExcelNueva[]>(['ots-nuevas-en-excel'], (previas) =>
      previas?.filter((ot) => ot.numero_ot !== numeroOt)
    )
    queryClient.invalidateQueries({ queryKey: ['ordenes-trabajo'] })
  }

  return (
    <Card className="mb-6">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">OT nuevas en el Excel</CardTitle>
        <Button type="button" variant="outline" size="sm" disabled={nuevas.isFetching} onClick={() => nuevas.refetch()}>
          {nuevas.isFetching ? 'Buscando...' : 'Buscar OT nuevas en el Excel'}
        </Button>
      </CardHeader>

      {nuevas.isError && (
        <CardContent className="pt-0 text-sm text-destructive">
          No se pudo leer el Excel — {nuevas.error instanceof ApiError ? nuevas.error.message : 'error de conexión'}
        </CardContent>
      )}

      {nuevas.isSuccess && (
        <CardContent className="pt-0">
          {nuevas.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay OT nuevas — el sistema ya tiene todo lo que hay en el Excel.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {nuevas.data.length} {nuevas.data.length === 1 ? 'OT nueva encontrada' : 'OT nuevas encontradas'} en
                el Excel, todavía no {nuevas.data.length === 1 ? 'está' : 'están'} en el sistema. Tocá una para ver
                el detalle antes de importarla.
              </p>
              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                {nuevas.data.map((ot) => (
                  <button
                    key={ot.numero_ot}
                    type="button"
                    onClick={() => setNumeroOtPreview(ot.numero_ot)}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">OT {ot.numero_ot}</p>
                      <p className="truncate text-muted-foreground">
                        {ot.cliente ?? 'Sin cliente'}
                        {ot.descripcion_producto ? ` · ${ot.descripcion_producto}` : ''}
                      </p>
                    </div>
                    <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}

      <DetalleExcelDialog
        numeroOt={numeroOtPreview}
        onOpenChange={(open) => !open && setNumeroOtPreview(null)}
        onImportado={alImportar}
      />
    </Card>
  )
}

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

      <NuevasEnExcelCard />

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
