import { createContext, useContext, useState, type ReactNode } from 'react'
import * as api from './api'
import type { Usuario } from './types'
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
}

const AuthContext = createContext<AuthContextValue | null>(null)

function cargarSesion(): Sesion | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Sesion
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

  return (
    <AuthContext.Provider value={{ sesion, iniciarSesion, cerrarSesion }}>{children}</AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
