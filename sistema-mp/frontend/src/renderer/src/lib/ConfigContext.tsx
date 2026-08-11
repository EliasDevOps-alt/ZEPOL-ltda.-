import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface ConfigContextValue {
  apiBaseUrl: string
  loaded: boolean
  setApiBaseUrl: (url: string) => Promise<void>
}

const ConfigContext = createContext<ConfigContextValue | null>(null)

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [apiBaseUrl, setApiBaseUrlState] = useState('http://localhost:8000')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.api.getConfig().then((config) => {
      setApiBaseUrlState(config.apiBaseUrl)
      setLoaded(true)
    })
  }, [])

  async function setApiBaseUrl(url: string) {
    const config = await window.api.setConfig({ apiBaseUrl: url })
    setApiBaseUrlState(config.apiBaseUrl)
  }

  return (
    <ConfigContext.Provider value={{ apiBaseUrl, loaded, setApiBaseUrl }}>{children}</ConfigContext.Provider>
  )
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error('useConfig debe usarse dentro de ConfigProvider')
  return ctx
}
