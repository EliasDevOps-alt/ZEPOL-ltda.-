import { contextBridge, ipcRenderer } from 'electron'

interface AppConfig {
  apiBaseUrl: string
}

type ResultadoBusquedaActualizacion =
  | { estado: 'sin-actualizacion' }
  | { estado: 'descargando'; version: string }
  | { estado: 'error'; mensaje: string }

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (config: AppConfig): Promise<AppConfig> => ipcRenderer.invoke('config:set', config),
  elegirArchivoExcel: (): Promise<string | null> => ipcRenderer.invoke('dialog:elegirArchivoExcel'),
  buscarActualizacion: (): Promise<ResultadoBusquedaActualizacion> => ipcRenderer.invoke('updates:buscar')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
