import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Pencil, Plus, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import { cn } from '@renderer/lib/utils'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import type { Modulo, Rol, UsuarioAdmin } from '@renderer/lib/types'

const MODULOS: { value: Modulo; label: string }[] = [
  { value: 'crear_ot', label: 'Crear OT' },
  { value: 'registrar_entrega', label: 'Registrar Entrega' },
  { value: 'registrar_devolucion', label: 'Registrar Devolución' },
  { value: 'registro_sid', label: 'Registro SID' },
  { value: 'materiales', label: 'Materiales' },
  { value: 'maquinas', label: 'Máquinas' },
  { value: 'excel_oc_mp', label: 'Excel OC-MP' }
]

interface FormState {
  id: number | null
  inicial: string
  nombre: string
  rol: Rol
  activo: boolean
  password: string
  modulosRestringidos: Modulo[]
}

const FORM_VACIO: FormState = {
  id: null,
  inicial: '',
  nombre: '',
  rol: 'personal',
  activo: true,
  password: '',
  modulosRestringidos: []
}

export function Usuarios() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mostrarReset, setMostrarReset] = useState(false)
  const [passwordReset, setPasswordReset] = useState('')
  const [resetOk, setResetOk] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (form) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [form])

  const usuarios = useQuery({
    queryKey: ['usuarios-admin'],
    queryFn: () => api.listarUsuarios(apiBaseUrl, token)
  })

  const guardar = useMutation({
    mutationFn: async (data: FormState) => {
      if (data.id === null) {
        return api.crearUsuario(apiBaseUrl, token, {
          inicial: data.inicial,
          nombre: data.nombre,
          rol: data.rol,
          password: data.password,
          modulos_restringidos: data.modulosRestringidos
        })
      }
      return api.actualizarUsuario(apiBaseUrl, token, data.id, {
        nombre: data.nombre,
        rol: data.rol,
        activo: data.activo,
        modulos_restringidos: data.modulosRestringidos
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios-admin'] })
      queryClient.invalidateQueries({ queryKey: ['usuarios-login'] })
      setForm(null)
      setError(null)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al guardar el usuario')
  })

  const resetear = useMutation({
    mutationFn: (id: number) => api.resetearPasswordUsuario(apiBaseUrl, token, id, passwordReset),
    onSuccess: () => {
      setPasswordReset('')
      setMostrarReset(false)
      setResetOk(true)
      setError(null)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al restablecer la contraseña')
  })

  function editar(usuario: UsuarioAdmin) {
    setError(null)
    setResetOk(false)
    setMostrarReset(false)
    setForm({
      id: usuario.id,
      inicial: usuario.inicial,
      nombre: usuario.nombre,
      rol: usuario.rol,
      activo: usuario.activo,
      password: '',
      modulosRestringidos: usuario.modulos_restringidos
    })
  }

  function toggleModulo(modulo: Modulo) {
    setForm((f) =>
      f
        ? {
            ...f,
            modulosRestringidos: f.modulosRestringidos.includes(modulo)
              ? f.modulosRestringidos.filter((m) => m !== modulo)
              : [...f.modulosRestringidos, modulo]
          }
        : f
    )
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.nombre || (form.id === null && (!form.inicial || !form.password))) {
      setError('Completa inicial, nombre y contraseña')
      return
    }
    setError(null)
    guardar.mutate(form)
  }

  function handleReset(e: FormEvent) {
    e.preventDefault()
    if (!form?.id) return
    if (!passwordReset) {
      setError('Escribe la contraseña nueva')
      return
    }
    setError(null)
    resetear.mutate(form.id)
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <Button
          onClick={() => {
            setError(null)
            setResetOk(false)
            setMostrarReset(false)
            setForm(FORM_VACIO)
          }}
        >
          <Plus className="h-4 w-4" />
          Nuevo usuario
        </Button>
      </div>

      {form && (
        <Card ref={formRef} className="mb-6 border-primary/40">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{form.id === null ? 'Nuevo usuario' : `Editar ${form.nombre}`}</CardTitle>
            <button onClick={() => setForm(null)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Inicial</Label>
                  <Input
                    value={form.inicial}
                    onChange={(e) => setForm({ ...form, inicial: e.target.value.toUpperCase() })}
                    placeholder="ER"
                    maxLength={5}
                    disabled={form.id !== null}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Nombre</Label>
                  <Input
                    value={form.nombre}
                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                    placeholder="Erasmo"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Rol</Label>
                  <Select value={form.rol} onValueChange={(v) => setForm({ ...form, rol: v as Rol })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="personal">Personal</SelectItem>
                      <SelectItem value="admin">Administrador</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.id === null && (
                  <div className="flex flex-col gap-1.5">
                    <Label>Contraseña</Label>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                  </div>
                )}
              </div>

              {form.rol === 'personal' && (
                <div className="flex flex-col gap-2">
                  <Label className="text-xs">
                    Módulos sin acceso — marcados quedan bloqueados para este usuario
                  </Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {MODULOS.map((m) => (
                      <label key={m.value} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.modulosRestringidos.includes(m.value)}
                          onChange={() => toggleModulo(m.value)}
                        />
                        {m.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {form.id !== null && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.activo}
                    onChange={(e) => setForm({ ...form, activo: e.target.checked })}
                  />
                  Activo (puede iniciar sesión)
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

            {form.id !== null && (
              <div className="mt-6 border-t border-border pt-4">
                {!mostrarReset ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setMostrarReset(true)}>
                    <KeyRound className="h-3.5 w-3.5" />
                    Restablecer contraseña
                  </Button>
                ) : (
                  <form onSubmit={handleReset} className="flex items-end gap-2">
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label className="text-xs">Contraseña nueva</Label>
                      <Input
                        type="password"
                        value={passwordReset}
                        onChange={(e) => setPasswordReset(e.target.value)}
                        className="max-w-xs"
                      />
                    </div>
                    <Button type="submit" variant="outline" size="sm" disabled={resetear.isPending}>
                      {resetear.isPending ? 'Guardando...' : 'Confirmar'}
                    </Button>
                  </form>
                )}
                {resetOk && <p className="mt-2 text-sm text-success">Contraseña actualizada.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {error && !form && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {usuarios.isError && (
        <p className="mb-4 text-sm text-destructive">No se pudo cargar la lista de usuarios.</p>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="p-3">Inicial</th>
                <th className="p-3">Nombre</th>
                <th className="p-3">Rol</th>
                <th className="p-3">Acceso</th>
                <th className="p-3">Estado</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.data?.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-medium">{u.inicial}</td>
                  <td className="p-3">{u.nombre}</td>
                  <td className="p-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        u.rol === 'admin' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {u.rol === 'admin' ? 'Administrador' : 'Personal'}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {u.rol === 'admin'
                      ? 'Todo'
                      : u.modulos_restringidos.length === 0
                        ? 'Todo'
                        : `Todo excepto ${u.modulos_restringidos.length}`}
                  </td>
                  <td className="p-3">
                    {u.activo ? (
                      <span className="text-xs text-success">Activo</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Inactivo</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end">
                      <button onClick={() => editar(u)} className="p-1.5 text-muted-foreground hover:text-foreground">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {usuarios.data && usuarios.data.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">Sin usuarios todavía.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
