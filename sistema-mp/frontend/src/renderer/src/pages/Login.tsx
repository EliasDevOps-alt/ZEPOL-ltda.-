import type { FormEvent } from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Settings2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'

export function Login() {
  const { iniciarSesion } = useAuth()
  const { apiBaseUrl, setApiBaseUrl, loaded } = useConfig()
  const usuarios = useQuery({
    queryKey: ['usuarios-login', apiBaseUrl],
    queryFn: () => api.listarUsuariosLogin(apiBaseUrl),
    enabled: loaded
  })
  const [inicial, setInicial] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [mostrarConfig, setMostrarConfig] = useState(false)
  const [urlTemp, setUrlTemp] = useState(apiBaseUrl)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!inicial) {
      setError('Selecciona tu usuario')
      return
    }
    setError(null)
    setCargando(true)
    try {
      await iniciarSesion(inicial, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm"
      >
        <Card className="overflow-hidden">
          <div
            className="h-1.5 w-full"
            style={{
              background:
                'linear-gradient(90deg, var(--color-accent-red), var(--color-accent-orange), var(--color-accent-gold), var(--color-primary), var(--color-accent-blue), var(--color-accent-magenta))'
            }}
          />
          <CardHeader>
            <CardTitle className="text-2xl text-primary">ZEPOL</CardTitle>
            <CardDescription>Control de Materia Prima — Envases Flexibles</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Usuario</Label>
                <Select value={inicial} onValueChange={setInicial}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona tu nombre" />
                  </SelectTrigger>
                  <SelectContent>
                    {usuarios.data?.map((u) => (
                      <SelectItem key={u.inicial} value={u.inicial}>
                        {u.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {usuarios.isError && (
                  <p className="flex items-center justify-between text-xs text-destructive">
                    No se pudo cargar la lista de usuarios.
                    <button type="button" onClick={() => usuarios.refetch()} className="underline">
                      Reintentar
                    </button>
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Clave</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={cargando || !loaded} className="mt-2">
                {cargando ? 'Ingresando...' : 'Ingresar'}
              </Button>

              <button
                type="button"
                onClick={() => setMostrarConfig((v) => !v)}
                className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Servidor: {apiBaseUrl}
              </button>

              {mostrarConfig && (
                <div className="flex gap-2">
                  <Input value={urlTemp} onChange={(e) => setUrlTemp(e.target.value)} placeholder="http://192.168.1.50:8000" />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setApiBaseUrl(urlTemp)}
                  >
                    Guardar
                  </Button>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
