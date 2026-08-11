import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import type { MaquinaAdmin } from '@renderer/lib/types'

interface FormState {
  id: number | null
  nombre: string
  proceso_id: string
  activo: boolean
}

const FORM_VACIO: FormState = {
  id: null,
  nombre: '',
  proceso_id: '',
  activo: true
}

export function Maquinas() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [q, setQ] = useState('')
  const [buscado, setBuscado] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (form) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [form])

  const procesos = useQuery({ queryKey: ['procesos'], queryFn: () => api.listarProcesos(apiBaseUrl, token) })

  const maquinas = useQuery({
    queryKey: ['maquinas-admin', buscado],
    queryFn: () => api.listarMaquinasAdmin(apiBaseUrl, token, { q: buscado })
  })

  const guardar = useMutation({
    mutationFn: async (data: FormState) => {
      if (data.id === null) {
        return api.crearMaquina(apiBaseUrl, token, {
          nombre: data.nombre,
          proceso_id: Number(data.proceso_id)
        })
      }
      return api.actualizarMaquina(apiBaseUrl, token, data.id, {
        nombre: data.nombre,
        proceso_id: Number(data.proceso_id),
        activo: data.activo
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maquinas-admin'] })
      queryClient.invalidateQueries({ queryKey: ['maquinas'] })
      setForm(null)
      setError(null)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al guardar la máquina')
  })

  const eliminar = useMutation({
    mutationFn: (id: number) => api.eliminarMaquina(apiBaseUrl, token, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maquinas-admin'] })
      queryClient.invalidateQueries({ queryKey: ['maquinas'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al eliminar la máquina')
  })

  function buscar(e: FormEvent) {
    e.preventDefault()
    setBuscado(q)
  }

  function editar(maquina: MaquinaAdmin) {
    setError(null)
    setForm({
      id: maquina.id,
      nombre: maquina.nombre,
      proceso_id: String(maquina.proceso_id),
      activo: maquina.activo
    })
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.nombre || !form.proceso_id) {
      setError('Nombre y proceso son obligatorios')
      return
    }
    setError(null)
    guardar.mutate(form)
  }

  function handleEliminar(maquina: MaquinaAdmin) {
    if (!confirm(`¿Eliminar ${maquina.nombre}? Esta acción no se puede deshacer.`)) return
    eliminar.mutate(maquina.id)
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Máquinas</h1>
        <Button onClick={() => { setError(null); setForm(FORM_VACIO) }}>
          <Plus className="h-4 w-4" />
          Nueva máquina
        </Button>
      </div>

      {form && (
        <Card ref={formRef} className="mb-6 border-primary/40">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{form.id === null ? 'Nueva máquina' : `Editar ${form.nombre}`}</CardTitle>
            <button onClick={() => setForm(null)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Nombre</Label>
                  <Input
                    value={form.nombre}
                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                    placeholder="F4"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Proceso</Label>
                  <Select
                    value={form.proceso_id}
                    onValueChange={(v) => setForm({ ...form, proceso_id: v })}
                  >
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
              <Label>Buscar por nombre o proceso</Label>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="F4, Laminación..." />
            </div>
            <Button type="submit" variant="outline">
              <Search className="h-4 w-4" />
              Buscar
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && !form && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="p-3">#</th>
                <th className="p-3">Nombre</th>
                <th className="p-3">Proceso</th>
                <th className="p-3">Estado</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {maquinas.data?.map((m, i) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="p-3 text-muted-foreground">{i + 1}</td>
                  <td className="p-3 font-medium">{m.nombre}</td>
                  <td className="p-3 text-muted-foreground">{m.proceso}</td>
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
          {maquinas.data && maquinas.data.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">Sin resultados.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
