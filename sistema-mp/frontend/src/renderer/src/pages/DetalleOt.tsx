import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CheckCircle2, History, Plus, Trash2, Upload } from 'lucide-react'
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
import type { Material, OtDetalleOut, Proceso } from '@renderer/lib/types'

interface FilaMaterial {
  materialId: string
  cantidad: string
}

interface BloqueProceso {
  procesoId: string
  maquinaId: string
  materiales: FilaMaterial[]
}

function bloqueVacio(): BloqueProceso {
  return { procesoId: '', maquinaId: '', materiales: [{ materialId: '', cantidad: '' }] }
}

function BloqueProcesoEditor({
  bloque,
  procesos,
  materiales,
  onChange,
  onRemove,
  removible
}: {
  bloque: BloqueProceso
  procesos: Proceso[]
  materiales: Material[]
  onChange: (b: BloqueProceso) => void
  onRemove: () => void
  removible: boolean
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const maquinas = useQuery({
    queryKey: ['maquinas', bloque.procesoId],
    queryFn: () => api.listarMaquinas(apiBaseUrl, token, Number(bloque.procesoId)),
    enabled: !!bloque.procesoId
  })

  const materialOptions = useMemo(
    () =>
      materiales.map((m) => ({
        value: String(m.id),
        label: m.codigo_mp + (m.descripcion ? ` — ${m.descripcion}` : '')
      })),
    [materiales]
  )

  function actualizarMaterial(i: number, cambios: Partial<FilaMaterial>) {
    const materiales = bloque.materiales.map((m, idx) => (idx === i ? { ...m, ...cambios } : m))
    onChange({ ...bloque, materiales })
  }

  function agregarMaterial() {
    onChange({ ...bloque, materiales: [...bloque.materiales, { materialId: '', cantidad: '' }] })
  }

  function quitarMaterial(i: number) {
    onChange({ ...bloque, materiales: bloque.materiales.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Proceso</Label>
            <Select
              value={bloque.procesoId}
              onValueChange={(v) => onChange({ ...bloque, procesoId: v, maquinaId: '' })}
            >
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
              value={bloque.maquinaId}
              onValueChange={(v) => onChange({ ...bloque, maquinaId: v })}
              disabled={!bloque.procesoId}
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
        {removible && (
          <button
            type="button"
            onClick={onRemove}
            className="mt-6 p-1.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <p className="mb-2 text-xs font-medium text-muted-foreground">Materiales pedidos en este proceso</p>
      <div className="flex flex-col gap-2">
        {bloque.materiales.map((fila, i) => {
          const material = materiales.find((m) => String(m.id) === fila.materialId)
          return (
            <div key={i} className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                {i === 0 && <Label className="text-xs">Código MP</Label>}
                <Combobox
                  value={fila.materialId}
                  onChange={(v) => actualizarMaterial(i, { materialId: v })}
                  options={materialOptions}
                  placeholder="Buscar código MP..."
                  emptyText="Sin materiales activos que coincidan"
                />
              </div>
              <div className="flex w-36 flex-col gap-1.5">
                {i === 0 && <Label className="text-xs">Cantidad requerida ({material?.unidad ?? ''})</Label>}
                <Input
                  type="number"
                  step="0.01"
                  value={fila.cantidad}
                  onChange={(e) => actualizarMaterial(i, { cantidad: e.target.value })}
                />
              </div>
              {bloque.materiales.length > 1 && (
                <button
                  type="button"
                  onClick={() => quitarMaterial(i)}
                  className="p-2 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={agregarMaterial}>
        <Plus className="h-3.5 w-3.5" />
        Agregar material
      </Button>
    </div>
  )
}

export function DetalleOt() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [numeroOt, setNumeroOt] = useState('')
  const [cliente, setCliente] = useState('')
  const [diseno, setDiseno] = useState('')
  const [bloques, setBloques] = useState<BloqueProceso[]>([bloqueVacio()])
  const [error, setError] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<OtDetalleOut | null>(null)

  const procesos = useQuery({ queryKey: ['procesos'], queryFn: () => api.listarProcesos(apiBaseUrl, token) })
  const materiales = useQuery({ queryKey: ['materiales'], queryFn: () => api.listarMateriales(apiBaseUrl, token) })

  const cargar = useMutation({
    mutationFn: () => api.obtenerDetalleOt(apiBaseUrl, token, numeroOt),
    onSuccess: (detalle) => {
      setCliente(detalle.cliente ?? '')
      setDiseno(detalle.diseno ?? '')
      setBloques(
        detalle.procesos.map((p) => ({
          procesoId: String(p.proceso_id),
          maquinaId: String(p.maquina_id),
          materiales: p.materiales.map((m) => ({
            materialId: String(m.material_id),
            cantidad: m.cantidad_requerida != null ? String(m.cantidad_requerida) : ''
          }))
        }))
      )
      setError(null)
      setConfirmacion(null)
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la OT')
    }
  })

  const guardar = useMutation({
    mutationFn: () =>
      api.guardarDetalleOt(apiBaseUrl, token, {
        numero_ot: numeroOt,
        cliente: cliente || null,
        diseno: diseno || null,
        procesos: bloques
          .filter((b) => b.procesoId && b.maquinaId)
          .map((b) => ({
            proceso_id: Number(b.procesoId),
            maquina_id: Number(b.maquinaId),
            materiales: b.materiales
              .filter((m) => m.materialId)
              .map((m) => ({
                material_id: Number(m.materialId),
                cantidad_requerida: m.cantidad ? Number(m.cantidad) : null
              }))
          }))
      }),
    onSuccess: (detalle) => {
      setConfirmacion(detalle)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['ordenes-trabajo'] })
      queryClient.invalidateQueries({ queryKey: ['consumo', numeroOt] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al guardar la OT')
  })

  function actualizarBloque(i: number, bloque: BloqueProceso) {
    setBloques(bloques.map((b, idx) => (idx === i ? bloque : b)))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!numeroOt) {
      setError('Ingresa el número de OT')
      return
    }
    const procesosValidos = bloques.filter((b) => b.procesoId && b.maquinaId)
    if (procesosValidos.length === 0) {
      setError('Agrega al menos un proceso con su máquina')
      return
    }
    if (procesosValidos.some((b) => b.materiales.every((m) => !m.materialId))) {
      setError('Cada proceso necesita al menos un material')
      return
    }
    setError(null)
    guardar.mutate()
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Crear OT</h1>
        <Link
          to={numeroOt ? `/entrega/historial?ot=${encodeURIComponent(numeroOt)}` : '/entrega/historial'}
          className="flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <History className="h-4 w-4" />
          Ver historial
        </Link>
      </div>

      <p className="mb-6 text-sm text-muted-foreground">
        Define la estructura completa de la OT: cliente y diseño (únicos para toda la OT), sus procesos con su
        máquina, y los materiales que cada uno necesita con su cantidad. Después, en "Registrar Entrega" solo
        eliges el pedido y cargas las bobinas entregadas.
      </p>

      {(procesos.isError || materiales.isError) && (
        <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          No se pudieron cargar los catálogos. Revisa la conexión con el servidor.
        </div>
      )}

      {confirmacion && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-6 flex items-center gap-3 rounded-md border border-success/30 bg-success/10 p-4"
        >
          <CheckCircle2 className="h-5 w-5 text-success" />
          <p className="text-sm">
            OT {confirmacion.numero_ot} guardada — {confirmacion.procesos.length}{' '}
            {confirmacion.procesos.length === 1 ? 'proceso' : 'procesos'}.
          </p>
        </motion.div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Datos de la OT</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>OT</Label>
                <Input value={numeroOt} onChange={(e) => setNumeroOt(e.target.value)} placeholder="2121" />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!numeroOt || cargar.isPending}
                  onClick={() => cargar.mutate()}
                >
                  <Upload className="h-4 w-4" />
                  Cargar OT existente
                </Button>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Cliente</Label>
                <Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="La Estrella" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Diseño</Label>
                <Input value={diseno} onChange={(e) => setDiseno(e.target.value)} placeholder="pipocas" />
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {bloques.map((bloque, i) => (
                <BloqueProcesoEditor
                  key={i}
                  bloque={bloque}
                  procesos={procesos.data ?? []}
                  materiales={materiales.data ?? []}
                  onChange={(b) => actualizarBloque(i, b)}
                  onRemove={() => setBloques(bloques.filter((_, idx) => idx !== i))}
                  removible={bloques.length > 1}
                />
              ))}
            </div>

            <Button type="button" variant="outline" onClick={() => setBloques([...bloques, bloqueVacio()])}>
              <Plus className="h-4 w-4" />
              Agregar proceso
            </Button>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={guardar.isPending}>
              {guardar.isPending ? 'Guardando...' : 'Guardar OT'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
