import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { CheckCircle2, Search, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { CampoCantidad, type BobinasPedido } from '@renderer/components/CampoCantidad'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import { cn, esUnidadDiscreta } from '@renderer/lib/utils'
import type { Consumo, Devolucion } from '@renderer/lib/types'

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function RegistrarDevolucion() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [numeroOt, setNumeroOt] = useState('')
  const [otBuscada, setOtBuscada] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<Record<number, BobinasPedido>>({})
  const [fecha, setFecha] = useState(hoyISO())
  const [error, setError] = useState<string | null>(null)
  const [confirmaciones, setConfirmaciones] = useState<Devolucion[]>([])

  const pedidos = useQuery({
    queryKey: ['consumo', otBuscada],
    queryFn: () => api.consultarConsumo(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  // Los cargos de tinta (Laminación, FLaminación, Superficie) no se devuelven
  // en planta — se registran en Crear OT, pero no aparecen aquí.
  const pedidosVisibles = useMemo(() => pedidos.data?.filter((p) => !p.es_tinta), [pedidos.data])

  const mutation = useMutation({
    mutationFn: async () => {
      const exitos: Devolucion[] = []
      const fallidos: { codigoMp: string; mensaje: string }[] = []
      for (const [otMaterialId, datos] of Object.entries(seleccion)) {
        try {
          const devolucion = await api.registrarDevolucion(apiBaseUrl, token, {
            ot_material_id: Number(otMaterialId),
            fecha,
            bobinas: datos.bobinas.map(Number)
          })
          exitos.push(devolucion)
        } catch (err) {
          const pedido = pedidos.data?.find((p) => p.ot_material_id === Number(otMaterialId))
          fallidos.push({
            codigoMp: pedido?.codigo_mp ?? `#${otMaterialId}`,
            mensaje: err instanceof ApiError ? err.message : 'error de conexión'
          })
        }
      }
      return { exitos, fallidos }
    },
    onSuccess: ({ exitos, fallidos }) => {
      setConfirmaciones(exitos)
      setError(
        fallidos.length > 0
          ? `No se pudieron registrar: ${fallidos.map((f) => `${f.codigoMp} (${f.mensaje})`).join(', ')}`
          : null
      )
      setSeleccion((prev) => {
        const restante = { ...prev }
        for (const d of exitos) delete restante[d.ot_material_id]
        return restante
      })
      queryClient.invalidateQueries({ queryKey: ['consumo', otBuscada] })
    },
    onError: () => setError('Error al registrar las devoluciones')
  })

  function buscar(e: FormEvent) {
    e.preventDefault()
    setConfirmaciones([])
    setSeleccion({})
    setOtBuscada(numeroOt)
  }

  function toggleSeleccion(pedido: Consumo) {
    setConfirmaciones([])
    setSeleccion((prev) => {
      const copia = { ...prev }
      if (copia[pedido.ot_material_id]) {
        delete copia[pedido.ot_material_id]
      } else {
        copia[pedido.ot_material_id] = esUnidadDiscreta(pedido.unidad)
          ? { cantidadBobinas: '1', bobinas: [''] }
          : { cantidadBobinas: '', bobinas: [] }
      }
      return copia
    })
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const pedidosSeleccionados = Object.entries(seleccion)
    if (pedidosSeleccionados.length === 0) {
      setError('Selecciona al menos un material')
      return
    }
    for (const [, datos] of pedidosSeleccionados) {
      if (datos.bobinas.length === 0 || datos.bobinas.some((b) => !b || Number(b) <= 0)) {
        setError('Cada material seleccionado necesita una cantidad válida mayor a 0')
        return
      }
    }
    setError(null)
    mutation.mutate()
  }

  const hayPedidosSeleccionados = Object.keys(seleccion).length > 0

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold">Registrar Devolución de Materia Prima</h1>

      {confirmaciones.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-6 flex flex-col gap-2 rounded-md border border-success/30 bg-success/10 p-4"
        >
          {confirmaciones.map((confirmacion) => {
            const pedido = pedidos.data?.find((p) => p.ot_material_id === confirmacion.ot_material_id)
            return (
              <div key={confirmacion.id} className="flex items-start gap-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                <p>
                  {confirmacion.total_devuelto} {pedido?.unidad ?? ''} de{' '}
                  {pedido?.codigo_mp ?? `#${confirmacion.ot_material_id}`} devueltos.
                </p>
              </div>
            )
          })}
        </motion.div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Buscar OT</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={buscar} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>Número de OT</Label>
              <Input value={numeroOt} onChange={(e) => setNumeroOt(e.target.value)} placeholder="2121" />
            </div>
            <Button type="submit" variant="outline">
              <Search className="h-4 w-4" />
              Buscar
            </Button>
          </form>

          {pedidos.isSuccess && pedidosVisibles?.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">No hay materiales entregados para esa OT.</p>
          )}

          {pedidosVisibles && pedidosVisibles.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Materiales entregados en esta OT — marca todos a los que corresponda la devolución:
              </p>
              {pedidosVisibles.map((pedido) => (
                <button
                  key={pedido.ot_material_id}
                  type="button"
                  onClick={() => toggleSeleccion(pedido)}
                  className={cn(
                    'flex flex-col rounded-md border p-3 text-left text-sm transition-colors',
                    seleccion[pedido.ot_material_id]
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted'
                  )}
                >
                  <span className="font-medium">
                    {pedido.proceso} — {pedido.maquina} — {pedido.codigo_mp}
                  </span>
                  <span className="text-muted-foreground">
                    Entregado: {pedido.total_entregado} {pedido.unidad}
                    {pedido.cantidad_requerida ? ` de ${pedido.cantidad_requerida} requeridos` : ''} · Ya devuelto:{' '}
                    {pedido.total_devuelto} {pedido.unidad} · {pedido.estado_entrega}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {hayPedidosSeleccionados && (
        <Card>
          <CardHeader>
            <CardTitle>Cantidades devueltas</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Fecha</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>

              {pedidosVisibles
                ?.filter((p) => seleccion[p.ot_material_id])
                .map((pedido) => {
                  const datos = seleccion[pedido.ot_material_id]
                  const disponible = pedido.total_entregado - pedido.total_devuelto
                  return (
                    <div key={pedido.ot_material_id} className="rounded-md border border-border p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-medium">{pedido.codigo_mp}</p>
                        <button
                          type="button"
                          onClick={() => toggleSeleccion(pedido)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="mb-3 text-xs text-muted-foreground">
                        Disponible para devolver: {disponible.toFixed(2)} {pedido.unidad}
                      </p>
                      <CampoCantidad
                        unidad={pedido.unidad}
                        datos={datos}
                        onChange={(d) => setSeleccion((prev) => ({ ...prev, [pedido.ot_material_id]: d }))}
                      />
                    </div>
                  )
                })}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending
                  ? 'Guardando...'
                  : `Guardar ${Object.keys(seleccion).length > 1 ? `${Object.keys(seleccion).length} devoluciones` : 'devolución'}`}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
