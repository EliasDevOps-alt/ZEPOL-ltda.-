import type { FormEvent } from 'react'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CheckCircle2, History } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import type { Entrega } from '@renderer/lib/types'

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function RegistrarEntrega() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [numeroOt, setNumeroOt] = useState('')
  const [cliente, setCliente] = useState('')
  const [diseno, setDiseno] = useState('')
  const [procesoId, setProcesoId] = useState<string>('')
  const [maquinaId, setMaquinaId] = useState<string>('')
  const [materialId, setMaterialId] = useState<string>('')
  const [cantidadRequerida, setCantidadRequerida] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  const [cantidadBobinas, setCantidadBobinas] = useState('')
  const [bobinas, setBobinas] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<Entrega | null>(null)

  const procesos = useQuery({
    queryKey: ['procesos'],
    queryFn: () => api.listarProcesos(apiBaseUrl, token)
  })
  const maquinas = useQuery({
    queryKey: ['maquinas', procesoId],
    queryFn: () => api.listarMaquinas(apiBaseUrl, token, Number(procesoId)),
    enabled: !!procesoId
  })
  const materiales = useQuery({
    queryKey: ['materiales'],
    queryFn: () => api.listarMateriales(apiBaseUrl, token)
  })

  const material = materiales.data?.find((m) => String(m.id) === materialId)

  const mutation = useMutation({
    mutationFn: () =>
      api.registrarEntrega(apiBaseUrl, token, {
        numero_ot: numeroOt,
        cliente: cliente || null,
        diseno: diseno || null,
        proceso_id: Number(procesoId),
        maquina_id: Number(maquinaId),
        material_id: Number(materialId),
        cantidad_requerida: cantidadRequerida ? Number(cantidadRequerida) : null,
        fecha,
        bobinas: bobinas.map(Number)
      }),
    onSuccess: (entrega) => {
      setConfirmacion(entrega)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['entregas', entrega.numero_ot] })
      queryClient.invalidateQueries({ queryKey: ['consumo', entrega.numero_ot] })
      queryClient.invalidateQueries({ queryKey: ['ordenes-trabajo'] })
      setNumeroOt('')
      setCliente('')
      setDiseno('')
      setMaterialId('')
      setCantidadRequerida('')
      setCantidadBobinas('')
      setBobinas([])
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al registrar la entrega')
  })

  function generarBobinas() {
    const n = Number(cantidadBobinas)
    if (!n || n < 1) return
    setBobinas(Array.from({ length: n }, (_, i) => bobinas[i] ?? ''))
  }

  const totalEntregado = bobinas.reduce((acc, b) => acc + (Number(b) || 0), 0)

  function handleProcesoChange(value: string) {
    setProcesoId(value)
    setMaquinaId('')
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setConfirmacion(null)
    if (!numeroOt || !procesoId || !maquinaId || !materialId || bobinas.length === 0) {
      setError('Completa OT, proceso, máquina, material y al menos una bobina')
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

      {(procesos.isError || materiales.isError) && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <span>
            No se pudo cargar {procesos.isError ? 'los procesos' : 'los materiales'}:{' '}
            {(procesos.error ?? materiales.error) instanceof ApiError
              ? (procesos.error ?? materiales.error)?.message
              : 'no se pudo conectar con el servidor'}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              procesos.refetch()
              materiales.refetch()
            }}
          >
            Reintentar
          </Button>
        </div>
      )}

      {confirmacion && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-6 flex items-center gap-3 rounded-md border border-success/30 bg-success/10 p-4"
        >
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="text-sm">
            <p>
              Entrega registrada — OT {confirmacion.numero_ot}, {confirmacion.total_entregado} {confirmacion.unidad}{' '}
              entregados de {confirmacion.codigo_mp}.
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
            <Link to={`/entrega/historial?ot=${encodeURIComponent(confirmacion.numero_ot)}`} className="text-primary hover:underline">
              Ver historial de esta OT →
            </Link>
          </div>
        </motion.div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Datos de la entrega</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Fecha</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>OT</Label>
                <Input value={numeroOt} onChange={(e) => setNumeroOt(e.target.value)} placeholder="123" />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Proceso</Label>
              <Select value={procesoId} onValueChange={handleProcesoChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  {procesos.data?.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Cliente</Label>
                <Input value={cliente} onChange={(e) => setCliente(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Diseño</Label>
                <Input value={diseno} onChange={(e) => setDiseno(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Máquina</Label>
              <Select value={maquinaId} onValueChange={setMaquinaId} disabled={!procesoId}>
                <SelectTrigger>
                  <SelectValue placeholder={procesoId ? 'Selecciona' : 'Elige un proceso primero'} />
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

            <div className="flex flex-col gap-1.5">
              <Label>Código MP</Label>
              <Select value={materialId} onValueChange={setMaterialId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  {materiales.data?.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.codigo_mp} {m.descripcion ? `— ${m.descripcion}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {material && <p className="text-xs text-muted-foreground">Unidad: {material.unidad}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Cantidad requerida ({material?.unidad ?? 'kg'})</Label>
              <Input
                type="number"
                step="0.01"
                value={cantidadRequerida}
                onChange={(e) => setCantidadRequerida(e.target.value)}
              />
            </div>

            <div className="rounded-md border border-border p-4">
              <p className="mb-3 text-sm font-medium">Bobinas o cantidades entregadas</p>
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
                  Total entregado: {totalEntregado.toFixed(2)} {material?.unidad ?? ''}
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
    </div>
  )
}
