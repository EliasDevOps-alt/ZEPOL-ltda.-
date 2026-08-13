import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CheckCircle2, PackagePlus, Search, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Combobox } from '@renderer/components/ui/combobox'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import { cn, esUnidadDiscreta } from '@renderer/lib/utils'
import type { Consumo, Entrega, Material, OtMaterialPendiente, Proceso } from '@renderer/lib/types'

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}

interface BobinasPedido {
  cantidadBobinas: string
  bobinas: string[]
}

function CampoCantidad({
  unidad,
  datos,
  onChange
}: {
  unidad: string
  datos: BobinasPedido
  onChange: (datos: BobinasPedido) => void
}) {
  const total = datos.bobinas.reduce((acc, b) => acc + (Number(b) || 0), 0)

  if (esUnidadDiscreta(unidad)) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>Cantidad {unidad ? `(${unidad})` : ''}</Label>
        <Input
          type="number"
          step="0.01"
          min={0}
          value={datos.bobinas[0] ?? ''}
          onChange={(e) => onChange({ ...datos, bobinas: [e.target.value] })}
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Cantidad de bobinas</Label>
          <Input
            type="number"
            min={1}
            value={datos.cantidadBobinas}
            onChange={(e) => onChange({ ...datos, cantidadBobinas: e.target.value })}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const n = Number(datos.cantidadBobinas)
            if (!n || n < 1) return
            onChange({ ...datos, bobinas: Array.from({ length: n }, (_, i) => datos.bobinas[i] ?? '') })
          }}
        >
          Generar
        </Button>
      </div>

      {datos.bobinas.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {datos.bobinas.map((valor, i) => (
            <div key={i} className="flex flex-col gap-1">
              <Label className="text-xs">N.º {i + 1}</Label>
              <Input
                type="number"
                step="0.01"
                value={valor}
                onChange={(e) => {
                  const copia = [...datos.bobinas]
                  copia[i] = e.target.value
                  onChange({ ...datos, bobinas: copia })
                }}
              />
            </div>
          ))}
        </div>
      )}

      {datos.bobinas.length > 0 && (
        <p className="mt-3 text-sm font-medium">
          Total: {total.toFixed(2)} {unidad}
        </p>
      )}
    </>
  )
}

interface PendienteForm extends BobinasPedido {
  materialId: string
  procesoId: string
  maquinaId: string
}

function PendienteCard({
  pendiente,
  procesos,
  materiales,
  materialOptions,
  fecha,
  onRegistrado
}: {
  pendiente: OtMaterialPendiente
  procesos: Proceso[]
  materiales: Material[]
  materialOptions: { value: string; label: string }[]
  fecha: string
  onRegistrado: () => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [form, setForm] = useState<PendienteForm>({
    materialId: pendiente.material_id != null ? String(pendiente.material_id) : '',
    procesoId: '',
    maquinaId: '',
    cantidadBobinas: '',
    bobinas: []
  })
  const [error, setError] = useState<string | null>(null)

  const maquinas = useQuery({
    queryKey: ['maquinas', form.procesoId],
    queryFn: () => api.listarMaquinas(apiBaseUrl, token, Number(form.procesoId)),
    enabled: !!form.procesoId
  })

  const material = materiales.find((m) => String(m.id) === form.materialId)

  const mutation = useMutation({
    mutationFn: async () => {
      const { ot_material_id } = await api.promoverPendiente(apiBaseUrl, token, pendiente.id, {
        proceso_id: Number(form.procesoId),
        maquina_id: Number(form.maquinaId),
        material_id: form.materialId ? Number(form.materialId) : null
      })
      return api.registrarEntrega(apiBaseUrl, token, {
        ot_material_id,
        fecha,
        bobinas: form.bobinas.map(Number)
      })
    },
    onSuccess: () => {
      setError(null)
      onRegistrado()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo registrar')
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.materialId) {
      setError('Indica a qué material del catálogo corresponde')
      return
    }
    if (!form.procesoId || !form.maquinaId) {
      setError('Elige proceso y máquina')
      return
    }
    if (form.bobinas.length === 0 || form.bobinas.some((b) => !b || Number(b) <= 0)) {
      setError('Ingresa una cantidad válida mayor a 0')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-warning/30 bg-warning/5 p-4">
      <p className="mb-3 text-sm font-medium">
        {pendiente.codigo_mp}
        {pendiente.cantidad_requerida != null ? ` — ${pendiente.cantidad_requerida} (del Excel)` : ''}
      </p>

      {pendiente.material_id == null && (
        <div className="mb-3 flex flex-col gap-1.5">
          <Label className="text-xs">¿A qué material del catálogo corresponde?</Label>
          <Combobox
            value={form.materialId}
            onChange={(v) => setForm({ ...form, materialId: v })}
            options={materialOptions}
            placeholder="Buscar código MP..."
            emptyText="Sin materiales activos que coincidan"
          />
        </div>
      )}

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Proceso</Label>
          <Select value={form.procesoId} onValueChange={(v) => setForm({ ...form, procesoId: v, maquinaId: '' })}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona" />
            </SelectTrigger>
            <SelectContent>
              {procesos.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Máquina</Label>
          <Select
            value={form.maquinaId}
            onValueChange={(v) => setForm({ ...form, maquinaId: v })}
            disabled={!form.procesoId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecciona" />
            </SelectTrigger>
            <SelectContent>
              {maquinas.data?.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <CampoCantidad
        unidad={material?.unidad ?? ''}
        datos={{ cantidadBobinas: form.cantidadBobinas, bobinas: form.bobinas }}
        onChange={(d) => setForm({ ...form, ...d })}
      />

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <Button type="submit" className="mt-3" disabled={mutation.isPending}>
        {mutation.isPending ? 'Guardando...' : 'Asignar y registrar entrega'}
      </Button>
    </form>
  )
}

export function RegistrarEntrega() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [numeroOt, setNumeroOt] = useState('')
  const [otBuscada, setOtBuscada] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<Record<number, BobinasPedido>>({})
  const [fecha, setFecha] = useState(hoyISO())
  const [error, setError] = useState<string | null>(null)
  const [confirmaciones, setConfirmaciones] = useState<Entrega[]>([])

  const pedidos = useQuery({
    queryKey: ['consumo', otBuscada],
    queryFn: () => api.consultarConsumo(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  const pendientes = useQuery({
    queryKey: ['pendientes', otBuscada],
    queryFn: () => api.listarPendientes(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  // Los cargos de tinta (Laminación, FLaminación, Superficie) no se entregan
  // en planta — se registran en Crear OT, pero no aparecen aquí.
  const pedidosVisibles = useMemo(() => pedidos.data?.filter((p) => !p.es_tinta), [pedidos.data])
  const pendientesVisibles = useMemo(() => pendientes.data?.filter((p) => !p.es_tinta), [pendientes.data])

  const procesos = useQuery({ queryKey: ['procesos'], queryFn: () => api.listarProcesos(apiBaseUrl, token) })
  const materiales = useQuery({ queryKey: ['materiales'], queryFn: () => api.listarMateriales(apiBaseUrl, token) })

  const materialOptions = useMemo(
    () =>
      (materiales.data ?? []).map((m) => ({
        value: String(m.id),
        label: m.codigo_mp + (m.descripcion ? ` — ${m.descripcion}` : '')
      })),
    [materiales.data]
  )

  function alPromoverPendiente() {
    queryClient.invalidateQueries({ queryKey: ['pendientes', otBuscada] })
    queryClient.invalidateQueries({ queryKey: ['consumo', otBuscada] })
    queryClient.invalidateQueries({ queryKey: ['entregas', otBuscada] })
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const exitos: Entrega[] = []
      const fallidos: { codigoMp: string; mensaje: string }[] = []
      for (const [otMaterialId, datos] of Object.entries(seleccion)) {
        try {
          const entrega = await api.registrarEntrega(apiBaseUrl, token, {
            ot_material_id: Number(otMaterialId),
            fecha,
            bobinas: datos.bobinas.map(Number)
          })
          exitos.push(entrega)
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
        for (const e of exitos) delete restante[e.ot_material_id]
        return restante
      })
      queryClient.invalidateQueries({ queryKey: ['consumo', otBuscada] })
      queryClient.invalidateQueries({ queryKey: ['entregas', otBuscada] })
    },
    onError: () => setError('Error al registrar las entregas')
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
      <h1 className="mb-6 text-2xl font-semibold">Registrar Entrega de Materia Prima</h1>

      {confirmaciones.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-6 flex flex-col gap-2 rounded-md border border-success/30 bg-success/10 p-4"
        >
          {confirmaciones.map((confirmacion) => (
            <div key={confirmacion.id} className="flex items-start gap-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <div>
                <p>
                  {confirmacion.total_entregado} {confirmacion.unidad} de {confirmacion.codigo_mp}.
                </p>
                {confirmacion.cantidad_requerida ? (
                  <p className="text-muted-foreground">
                    Van {confirmacion.total_entregado_pedido} de {confirmacion.cantidad_requerida}{' '}
                    {confirmacion.unidad} requeridos
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
            </div>
          ))}
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

          {pedidos.isSuccess &&
            pedidosVisibles?.length === 0 &&
            pendientes.isSuccess &&
            pendientesVisibles?.length === 0 && (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                <PackagePlus className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>
                  Esta OT no tiene materiales pedidos todavía.{' '}
                  <Link to="/crear-ot" className="text-primary hover:underline">
                    Ve a Crear OT
                  </Link>{' '}
                  para definir sus procesos y materiales antes de registrar una entrega.
                </p>
              </div>
            )}

          {pedidosVisibles && pedidosVisibles.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Materiales pedidos en esta OT — marca todos a los que corresponda la entrega:
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

      {pendientesVisibles && pendientesVisibles.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Materiales pendientes de asignar (vienen del Excel)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Estos materiales vinieron de la hoja Excel sin proceso ni máquina. Asígnalos y registra la entrega
              en un solo paso.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label>Fecha</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="max-w-40" />
            </div>
            {pendientesVisibles.map((pendiente) => (
              <PendienteCard
                key={pendiente.id}
                pendiente={pendiente}
                procesos={procesos.data ?? []}
                materiales={materiales.data ?? []}
                materialOptions={materialOptions}
                fecha={fecha}
                onRegistrado={alPromoverPendiente}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {hayPedidosSeleccionados && (
        <Card>
          <CardHeader>
            <CardTitle>Cantidades entregadas</CardTitle>
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
                      <CampoCantidad
                        unidad={pedido.unidad}
                        datos={datos}
                        onChange={(d) =>
                          setSeleccion((prev) => ({ ...prev, [pedido.ot_material_id]: d }))
                        }
                      />
                    </div>
                  )
                })}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending
                  ? 'Guardando...'
                  : `Guardar ${Object.keys(seleccion).length > 1 ? `${Object.keys(seleccion).length} entregas` : 'entrega'}`}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
