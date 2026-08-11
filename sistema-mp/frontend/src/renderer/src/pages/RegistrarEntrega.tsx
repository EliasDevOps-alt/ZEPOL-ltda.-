import type { FormEvent } from 'react'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CheckCircle2, History, PackagePlus, Search } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import type { Consumo, Entrega } from '@renderer/lib/types'

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function RegistrarEntrega() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [numeroOt, setNumeroOt] = useState('')
  const [otBuscada, setOtBuscada] = useState<string | null>(null)
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState<Consumo | null>(null)
  const [fecha, setFecha] = useState(hoyISO())
  const [cantidadBobinas, setCantidadBobinas] = useState('')
  const [bobinas, setBobinas] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<Entrega | null>(null)

  const pedidos = useQuery({
    queryKey: ['consumo', otBuscada],
    queryFn: () => api.consultarConsumo(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  const mutation = useMutation({
    mutationFn: () =>
      api.registrarEntrega(apiBaseUrl, token, {
        ot_material_id: pedidoSeleccionado!.ot_material_id,
        fecha,
        bobinas: bobinas.map(Number)
      }),
    onSuccess: (entrega) => {
      setConfirmacion(entrega)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['consumo', otBuscada] })
      queryClient.invalidateQueries({ queryKey: ['entregas', otBuscada] })
      setCantidadBobinas('')
      setBobinas([])
      setPedidoSeleccionado(null)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al registrar la entrega')
  })

  function buscar(e: FormEvent) {
    e.preventDefault()
    setConfirmacion(null)
    setPedidoSeleccionado(null)
    setOtBuscada(numeroOt)
  }

  function generarBobinas() {
    const n = Number(cantidadBobinas)
    if (!n || n < 1) return
    setBobinas(Array.from({ length: n }, (_, i) => bobinas[i] ?? ''))
  }

  const totalEntregado = bobinas.reduce((acc, b) => acc + (Number(b) || 0), 0)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!pedidoSeleccionado || bobinas.length === 0) {
      setError('Selecciona el material y al menos una bobina')
      return
    }
    if (bobinas.some((b) => !b || Number(b) <= 0)) {
      setError('Todas las bobinas necesitan un peso mayor a 0')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Registrar Entrega de Materia Prima</h1>
        <Link
          to={numeroOt ? `/entrega/historial?ot=${encodeURIComponent(numeroOt)}` : '/entrega/historial'}
          className="flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <History className="h-4 w-4" />
          Ver historial
        </Link>
      </div>

      {confirmacion && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-6 flex items-center gap-3 rounded-md border border-success/30 bg-success/10 p-4"
        >
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="text-sm">
            <p>
              Entrega registrada — {confirmacion.total_entregado} {confirmacion.unidad} de {confirmacion.codigo_mp}.
            </p>
            {confirmacion.cantidad_requerida ? (
              <p className="text-muted-foreground">
                Van {confirmacion.total_entregado_pedido} de {confirmacion.cantidad_requerida}{' '}
                {confirmacion.unidad} requeridos para este pedido
                {confirmacion.total_entregado_pedido >= confirmacion.cantidad_requerida
                  ? ' — pedido completo.'
                  : ` — faltan ${(confirmacion.cantidad_requerida - confirmacion.total_entregado_pedido).toFixed(2)} ${confirmacion.unidad}.`}
              </p>
            ) : (
              <p className="text-muted-foreground">
                Acumulado del pedido: {confirmacion.total_entregado_pedido} {confirmacion.unidad}
              </p>
            )}
          </div>
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

          {pedidos.isSuccess && pedidos.data.length === 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
              <PackagePlus className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p>
                Esta OT no tiene materiales pedidos todavía.{' '}
                <Link to="/entrega/detalle" className="text-primary hover:underline">
                  Ve a Detalle de OT
                </Link>{' '}
                para definir sus procesos y materiales antes de registrar una entrega.
              </p>
            </div>
          )}

          {pedidos.data && pedidos.data.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Materiales pedidos en esta OT — elige a cuál corresponde la entrega:
              </p>
              {pedidos.data.map((pedido) => (
                <button
                  key={pedido.ot_material_id}
                  type="button"
                  onClick={() => {
                    setPedidoSeleccionado(pedido)
                    setConfirmacion(null)
                  }}
                  className={cn(
                    'flex flex-col rounded-md border p-3 text-left text-sm transition-colors',
                    pedidoSeleccionado?.ot_material_id === pedido.ot_material_id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted'
                  )}
                >
                  <span className="font-medium">
                    {pedido.proceso} — {pedido.maquina} — {pedido.codigo_mp}
                  </span>
                  <span className="text-muted-foreground">
                    {pedido.diseno ? `Diseño: ${pedido.diseno} · ` : ''}Entregado: {pedido.total_entregado}{' '}
                    {pedido.unidad}
                    {pedido.cantidad_requerida ? ` de ${pedido.cantidad_requerida} requeridos` : ''} ·{' '}
                    {pedido.estado_entrega}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {pedidoSeleccionado && (
        <Card>
          <CardHeader>
            <CardTitle>Bobinas entregadas de {pedidoSeleccionado.codigo_mp}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Fecha</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>

              <div className="rounded-md border border-border p-4">
                <div className="flex items-end gap-2">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label>Cantidad de bobinas</Label>
                    <Input
                      type="number"
                      min={1}
                      value={cantidadBobinas}
                      onChange={(e) => setCantidadBobinas(e.target.value)}
                    />
                  </div>
                  <Button type="button" variant="outline" onClick={generarBobinas}>
                    Generar
                  </Button>
                </div>

                {bobinas.length > 0 && (
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {bobinas.map((valor, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        <Label className="text-xs">N.º {i + 1}</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={valor}
                          onChange={(e) => {
                            const copia = [...bobinas]
                            copia[i] = e.target.value
                            setBobinas(copia)
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {bobinas.length > 0 && (
                  <p className="mt-3 text-sm font-medium">
                    Total entregado: {totalEntregado.toFixed(2)} {pedidoSeleccionado.unidad}
                  </p>
                )}
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Guardando...' : 'Guardar entrega'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
