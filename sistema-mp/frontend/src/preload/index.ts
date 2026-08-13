import { contextBridge, ipcRenderer } from 'electron'

interface AppConfig {
  apiBaseUrl: string
}

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (config: AppConfig): Promise<AppConfig> => ipcRenderer.invoke('config:set', config),
  elegirArchivoExcel: (): Promise<string | null> => ipcRenderer.invoke('dialog:elegirArchivoExcel')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
