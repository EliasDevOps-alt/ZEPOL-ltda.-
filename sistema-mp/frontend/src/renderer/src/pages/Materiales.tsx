import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import type { MaterialAdmin } from '@renderer/lib/types'

interface FormState {
  id: number | null
  codigo_mp: string
  descripcion: string
  unidad: string
  activo: boolean
  procesos: number[]
}

const FORM_VACIO: FormState = {
  id: null,
  codigo_mp: '',
  descripcion: '',
  unidad: 'kg',
  activo: true,
  procesos: []
}

export function Materiales() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [q, setQ] = useState('')
  const [buscado, setBuscado] = useState('')
  const [sinProceso, setSinProceso] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const procesos = useQuery({
    queryKey: ['procesos'],
    queryFn: () => api.listarProcesos(apiBaseUrl, token)
  })

  const materiales = useQuery({
    queryKey: ['materiales-admin', buscado, sinProceso],
    queryFn: () => api.listarMaterialesAdmin(apiBaseUrl, token, { q: buscado, sinProceso })
  })

  const guardar = useMutation({
    mutationFn: async (data: FormState) => {
      if (data.id === null) {
        return api.crearMaterial(apiBaseUrl, token, {
          codigo_mp: data.codigo_mp,
          descripcion: data.descripcion || null,
          unidad: data.unidad,
          procesos: data.procesos
        })
      }
      return api.actualizarMaterial(apiBaseUrl, token, data.id, {
        descripcion: data.descripcion || null,
        unidad: data.unidad,
        activo: data.activo,
        procesos: data.procesos
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materiales-admin'] })
      queryClient.invalidateQueries({ queryKey: ['materiales'] })
      setForm(null)
      setError(null)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al guardar el material')
  })

  const eliminar = useMutation({
    mutationFn: (id: number) => api.eliminarMaterial(apiBaseUrl, token, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materiales-admin'] })
      queryClient.invalidateQueries({ queryKey: ['materiales'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al eliminar el material')
  })

  function buscar(e: FormEvent) {
    e.preventDefault()
    setBuscado(q)
  }

  function editar(material: MaterialAdmin) {
    setError(null)
    setForm({
      id: material.id,
      codigo_mp: material.codigo_mp,
      descripcion: material.descripcion ?? '',
      unidad: material.unidad,
      activo: material.activo,
      procesos: material.procesos.map((p) => p.id)
    })
  }

  function toggleProceso(procesoId: number) {
    if (!form) return
    setForm({
      ...form,
      procesos: form.procesos.includes(procesoId)
        ? form.procesos.filter((id) => id !== procesoId)
        : [...form.procesos, procesoId]
    })
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.codigo_mp || !form.unidad) {
      setError('Código y unidad son obligatorios')
      return
    }
    setError(null)
    guardar.mutate(form)
  }

  function handleEliminar(material: MaterialAdmin) {
    if (!confirm(`¿Eliminar ${material.codigo_mp}? Esta acción no se puede deshacer.`)) return
    eliminar.mutate(material.id)
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Materiales</h1>
        <Button onClick={() => { setError(null); setForm(FORM_VACIO) }}>
          <Plus className="h-4 w-4" />
          Nuevo material
        </Button>
      </div>

      {procesos.isError && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <span>
            No se pudieron cargar los procesos:{' '}
            {procesos.error instanceof ApiError ? procesos.error.message : 'no se pudo conectar con el servidor'}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => procesos.refetch()}>
            Reintentar
          </Button>
        </div>
      )}

      {form && (
        <Card className="mb-6 border-primary/40">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{form.id === null ? 'Nuevo material' : `Editar ${form.codigo_mp}`}</CardTitle>
            <button onClick={() => setForm(null)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Código MP</Label>
                  <Input
                    value={form.codigo_mp}
                    disabled={form.id !== null}
                    onChange={(e) => setForm({ ...form, codigo_mp: e.target.value })}
                    placeholder="LDPE-1"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Unidad</Label>
                  <Input
                    value={form.unidad}
                    onChange={(e) => setForm({ ...form, unidad: e.target.value })}
                    placeholder="kg"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Descripción</Label>
                <Input
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Procesos habilitados</Label>
                <div className="flex flex-wrap gap-2">
                  {procesos.data?.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleProceso(p.id)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-sm transition-colors',
                        form.procesos.includes(p.id)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:bg-muted'
                      )}
                    >
                      {p.nombre}
                    </button>
                  ))}
                </div>
              </div>

              {form.id !== null && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.activo}
                    onChange={(e) => setForm({ ...form, activo: e.target.checked })}
                  />
                  Activo
                </label>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2">
                <Button type="submit" disabled={guardar.isPending}>
                  {guardar.isPending ? 'Guardando...' : 'Guardar'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form onSubmit={buscar} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>Buscar por código o descripción</Label>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="LDPE, BOPP..." />
            </div>
            <Button type="submit" variant="outline">
              <Search className="h-4 w-4" />
              Buscar
            </Button>
            <label className="flex items-center gap-2 whitespace-nowrap pb-2 text-sm">
              <input
                type="checkbox"
                checked={sinProceso}
                onChange={(e) => setSinProceso(e.target.checked)}
              />
              Sin proceso asignado
            </label>
          </form>
        </CardContent>
      </Card>

      {error && !form && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="p-3">Código</th>
                <th className="p-3">Descripción</th>
                <th className="p-3">Unidad</th>
                <th className="p-3">Procesos</th>
                <th className="p-3">Estado</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {materiales.data?.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-medium">{m.codigo_mp}</td>
                  <td className="p-3 text-muted-foreground">{m.descripcion}</td>
                  <td className="p-3">{m.unidad}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {m.procesos.length === 0 && (
                        <span className="text-xs text-destructive">Sin asignar</span>
                      )}
                      {m.procesos.map((p) => (
                        <span
                          key={p.id}
                          className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {p.nombre}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-3">
                    {m.activo ? (
                      <span className="text-xs text-success">Activo</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Inactivo</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => editar(m)} className="p-1.5 text-muted-foreground hover:text-foreground">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleEliminar(m)}
                        className="p-1.5 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {materiales.data && materiales.data.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">Sin resultados.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
