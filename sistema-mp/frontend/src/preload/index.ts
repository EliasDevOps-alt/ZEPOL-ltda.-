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
  buscarActualizacion: (): Promise<ResultadoBusquedaActualizacion> => ipcRenderer.invoke('updates:buscar'),
  // Devuelven la ruta donde se guardó, o null si se canceló el diálogo.
  exportarFormularioPdf: (html: string, nombreSugerido: string): Promise<string | null> =>
    ipcRenderer.invoke('formulario:exportarPdf', html, nombreSugerido),
  exportarFormularioWord: (html: string, nombreSugerido: string): Promise<string | null> =>
    ipcRenderer.invoke('formulario:exportarWord', html, nombreSugerido)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
