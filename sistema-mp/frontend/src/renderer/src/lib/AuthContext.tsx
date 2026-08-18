import { createContext, useContext, useState, type ReactNode } from 'react'
import * as api from './api'
import type { Modulo, Usuario } from './types'
import { useConfig } from './ConfigContext'

const STORAGE_KEY = 'zepol.sesion'

interface Sesion {
  token: string
  usuario: Usuario
}

interface AuthContextValue {
  sesion: Sesion | null
  iniciarSesion: (inicial: string, password: string) => Promise<void>
  cerrarSesion: () => void
  tieneAcceso: (modulo: Modulo) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

function cargarSesion(): Sesion | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const sesion = JSON.parse(raw) as Sesion
    // Sesiones guardadas antes de que existiera rol/modulos_restringidos no
    // tienen esos campos — sin esto, tieneAcceso() revienta en el primer
    // render y la pantalla queda en blanco. Se descarta y pide login de
    // nuevo en vez de dejar corriendo una sesión con forma vieja.
    if (typeof sesion.usuario?.rol !== 'string' || !Array.isArray(sesion.usuario?.modulos_restringidos)) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return sesion
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { apiBaseUrl } = useConfig()
  const [sesion, setSesion] = useState<Sesion | null>(cargarSesion)

  async function iniciarSesion(inicial: string, password: string) {
    const { access_token, usuario } = await api.login(apiBaseUrl, inicial, password)
    const nuevaSesion = { token: access_token, usuario }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nuevaSesion))
    setSesion(nuevaSesion)
  }

  function cerrarSesion() {
    localStorage.removeItem(STORAGE_KEY)
    setSesion(null)
  }

  function tieneAcceso(modulo: Modulo): boolean {
    if (!sesion) return false
    return sesion.usuario.rol === 'admin' || !(sesion.usuario.modulos_restringidos ?? []).includes(modulo)
  }

  return (
    <AuthContext.Provider value={{ sesion, iniciarSesion, cerrarSesion, tieneAcceso }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
