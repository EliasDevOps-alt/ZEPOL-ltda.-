import { contextBridge, ipcRenderer } from 'electron'

interface AppConfig {
  apiBaseUrl: string
  puertoBalanza?: string
  puertoBalanza2?: string
}

export interface EstadoBalanza {
  estado: 'detenida' | 'conectando' | 'conectada' | 'sin-datos' | 'error'
  puerto: string | null
  mensaje?: string
}

export interface LecturaBalanza {
  /** En kg. */
  peso: number
  estable: boolean
}

interface SuscripcionBalanza {
  estado: EstadoBalanza
  lectura: LecturaBalanza | null
}

/** Balanza 1 o 2 de esta PC. */
export type NumeroBalanza = 1 | 2

type ResultadoBusquedaActualizacion =
  | { estado: 'sin-actualizacion' }
  | { estado: 'descargando'; version: string }
  | { estado: 'error'; mensaje: string }

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (config: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:set', config),
  // Balanza serial de esta PC. Cada función de suscripción devuelve cómo darse de baja.
  listarPuertosBalanza: (): Promise<string[]> => ipcRenderer.invoke('balanza:puertos'),
  // Índice 0 = balanza 1, índice 1 = balanza 2.
  estadoBalanzas: (): Promise<SuscripcionBalanza[]> => ipcRenderer.invoke('balanza:estado'),
  configurarBalanza: (numero: NumeroBalanza, puerto: string): Promise<SuscripcionBalanza[]> =>
    ipcRenderer.invoke('balanza:configurar', numero, puerto),
  alCambiarEstadoBalanza: (
    callback: (numero: NumeroBalanza, estado: EstadoBalanza) => void
  ): (() => void) => {
    const escucha = (_e: unknown, d: { numero: NumeroBalanza; estado: EstadoBalanza }): void =>
      callback(d.numero, d.estado)
    ipcRenderer.on('balanza:estado', escucha)
    return () => ipcRenderer.removeListener('balanza:estado', escucha)
  },
  alLeerBalanza: (callback: (numero: NumeroBalanza, lectura: LecturaBalanza) => void): (() => void) => {
    const escucha = (_e: unknown, d: { numero: NumeroBalanza; lectura: LecturaBalanza }): void =>
      callback(d.numero, d.lectura)
    ipcRenderer.on('balanza:lectura', escucha)
    return () => ipcRenderer.removeListener('balanza:lectura', escucha)
  },
  elegirArchivoExcel: (): Promise<string | null> => ipcRenderer.invoke('dialog:elegirArchivoExcel'),
  buscarActualizacion: (): Promise<ResultadoBusquedaActualizacion> => ipcRenderer.invoke('updates:buscar'),
  // Devuelven la ruta donde se guardó, o null si se canceló el diálogo.
  exportarFormularioPdf: (html: string, nombreSugerido: string): Promise<string | null> =>
    ipcRenderer.invoke('formulario:exportarPdf', html, nombreSugerido),
  // 'directo' = salió a la HP sin preguntar; 'dialogo' = se usó el cuadro de
  // impresión de Windows (la PC no tiene la HP o un lector de PDF); 'cancelado'.
  imprimirFormulario: (html: string): Promise<'directo' | 'dialogo' | 'cancelado'> =>
    ipcRenderer.invoke('formulario:imprimir', html),
  // Etiquetas ZPL a la etiquetadora térmica; devuelve el nombre de la impresora usada.
  imprimirEtiquetas: (zpl: string): Promise<string> => ipcRenderer.invoke('etiqueta:imprimir', zpl),
  exportarFormularioWord: (html: string, nombreSugerido: string): Promise<string | null> =>
    ipcRenderer.invoke('formulario:exportarWord', html, nombreSugerido),
  exportarFormularioExcel: (
    html: string,
    nombreSugerido: string,
    orientacion: 'portrait' | 'landscape'
  ): Promise<string | null> =>
    ipcRenderer.invoke('formulario:exportarExcel', html, nombreSugerido, orientacion)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
