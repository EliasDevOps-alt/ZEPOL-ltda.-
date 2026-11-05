import { open, read, close } from 'fs'
import { execFile } from 'child_process'

// Lectura de la balanza CAS por puerto serial (USB-serial CH340).
//
// El puerto se lee con `fs` y NO con una librería serial a propósito: este
// adaptador solo acepta que le configuren baudios/paridad (SetCommState) la
// primera vez tras conectarlo; las aperturas siguientes fallan con "error 31",
// y `serialport` (y .NET) siempre configuran. Abrirlo como un archivo lo lee
// con los parámetros que ya tiene el driver — 9600 8N1, que se fijan una vez en
// Administrador de dispositivos → Puertos → Propiedades. Probado: reabrir muchas
// veces seguidas funciona.
//
// La balanza manda sola unas 8 lecturas por segundo, sin parar:
//   "    1.45kg\r\n"   (4 espacios, número con punto, unidad pegada, CR LF)
// y no manda ningún indicador de "estable": se deduce de que varias lecturas
// seguidas den el mismo valor.

export type EstadoConexionBalanza = 'detenida' | 'conectando' | 'conectada' | 'sin-datos' | 'error'

export interface EstadoBalanza {
  estado: EstadoConexionBalanza
  puerto: string | null
  mensaje?: string
}

export interface LecturaBalanza {
  /** Siempre en kg. */
  peso: number
  estable: boolean
}

export interface Emisor {
  estado: (e: EstadoBalanza) => void
  lectura: (l: LecturaBalanza) => void
}

/** Lecturas iguales seguidas para dar el peso por estable (~0,5 s). */
const LECTURAS_ESTABLE = 4
const REINTENTO_MS = 3000
const SIN_DATOS_MS = 3000
// ReadFile en este puerto no vuelve hasta llenar el búfer pedido: con 256 bytes
// la primera lectura tardaba ~3 s. Una línea mide 12 bytes (~125 ms).
const TAMANO_LECTURA = 12
const PATRON_PUERTO = /^COM\d{1,3}$/i
const PATRON_LECTURA = /(-?\d+(?:[.,]\d+)?)\s*(kg|g|lb)?/i

/** Convierte una línea de la balanza ("    1.45kg") a kg; null si no es un peso. */
export function interpretarLinea(linea: string): number | null {
  const m = PATRON_LECTURA.exec(linea)
  if (!m) return null
  const valor = Number(m[1].replace(',', '.'))
  if (!Number.isFinite(valor)) return null
  const unidad = (m[2] ?? 'kg').toLowerCase()
  if (unidad === 'kg') return valor
  if (unidad === 'g') return valor / 1000
  return null // lb u otra: no se adivina la conversión
}

export interface ControlBalanza {
  iniciar: (puerto: string, emisor: Emisor) => void
  detener: () => void
  estado: () => { estado: EstadoBalanza; lectura: LecturaBalanza | null }
}

/** Una balanza = un puerto. Cada una lleva su propio estado, así se pueden leer dos a la vez. */
export function crearBalanza(): ControlBalanza {
  let generacion = 0
  /** Handle abierto, para cerrarlo al detener aunque haya una lectura en curso. */
  let descriptorAbierto: number | null = null
  let estadoActual: EstadoBalanza = { estado: 'detenida', puerto: null }
  let ultimaLectura: LecturaBalanza | null = null

  function estadoDeBalanza(): { estado: EstadoBalanza; lectura: LecturaBalanza | null } {
    return { estado: estadoActual, lectura: ultimaLectura }
  }

  function detenerBalanza(): void {
    generacion++
    if (descriptorAbierto !== null) {
      close(descriptorAbierto, () => undefined)
      descriptorAbierto = null
    }
    ultimaLectura = null
    estadoActual = { estado: 'detenida', puerto: null }
  }

  /** Cierra el handle una sola vez (detenerBalanza puede haberlo cerrado ya). */
  function liberar(fd: number): void {
    if (descriptorAbierto !== fd) return
    descriptorAbierto = null
    close(fd, () => undefined)
  }

  function iniciarBalanza(puerto: string, emisor: Emisor): void {
    detenerBalanza()
    if (!PATRON_PUERTO.test(puerto)) {
      estadoActual = { estado: 'error', puerto, mensaje: `Puerto no válido: ${puerto}` }
      emisor.estado(estadoActual)
      return
    }
    const gen = generacion
    const nombre = puerto.toUpperCase()

    const cambiarEstado = (estado: EstadoConexionBalanza, mensaje?: string): void => {
      if (gen !== generacion) return
      if (estadoActual.estado === estado && estadoActual.mensaje === mensaje) return
      estadoActual = { estado, puerto: nombre, mensaje }
      emisor.estado(estadoActual)
    }

    const reintentar = (): void => {
      if (gen !== generacion) return
      setTimeout(() => abrir(), REINTENTO_MS)
    }

    const abrir = (): void => {
      if (gen !== generacion) return
      cambiarEstado('conectando')
      void fijarParametros(nombre).then(() => {
        if (gen !== generacion) return
        // "//./COM10" (la forma \\.\COM10): hace falta para COM10 en adelante.
        open(`//./${nombre}`, 'r', (err, fd) => {
          if (gen !== generacion) {
            if (!err) close(fd, () => undefined)
            return
          }
          if (err) {
            cambiarEstado('error', 'No se pudo abrir el puerto. ¿Está conectada la balanza?')
            reintentar()
            return
          }
          descriptorAbierto = fd
          leer(fd)
        })
      })
    }

    const leer = (fd: number): void => {
      const buffer = Buffer.alloc(TAMANO_LECTURA)
      let resto = ''
      let ultimoValor: number | null = null
      let repetidas = 0
      let ultimoEnviado: LecturaBalanza | null = null
      let ultimaRecepcion = Date.now()

      const vigilante = setInterval(() => {
        if (gen !== generacion) return clearInterval(vigilante)
        if (Date.now() - ultimaRecepcion > SIN_DATOS_MS) {
          cambiarEstado('sin-datos', 'La balanza no está enviando datos.')
        }
      }, 1000)

      const terminar = (mensaje: string): void => {
        clearInterval(vigilante)
        liberar(fd)
        cambiarEstado('error', mensaje)
        reintentar()
      }

      const siguiente = (): void => {
        if (gen !== generacion) {
          clearInterval(vigilante)
          liberar(fd)
          return
        }
        read(fd, buffer, 0, TAMANO_LECTURA, null, (err, n) => {
          if (gen !== generacion) {
            clearInterval(vigilante)
            liberar(fd)
            return
          }
          if (err) return terminar('Se perdió la conexión con la balanza.')
          if (n === 0) return void setTimeout(siguiente, 50)

          ultimaRecepcion = Date.now()
          resto += buffer.toString('latin1', 0, n)
          const lineas = resto.split(/\r\n|\r|\n/)
          resto = lineas.pop() ?? '' // la última puede venir a medias
          if (resto.length > 64) resto = '' // basura sin fin de línea

          // Solo cuenta la lectura más reciente de este bloque: si la pantalla
          // se atrasó, no tiene sentido mostrar las viejas.
          for (const linea of lineas) {
            const peso = interpretarLinea(linea)
            if (peso === null) continue
            repetidas = peso === ultimoValor ? repetidas + 1 : 1
            ultimoValor = peso
          }
          if (ultimoValor !== null && lineas.length > 0) {
            const lectura: LecturaBalanza = {
              peso: ultimoValor,
              estable: repetidas >= LECTURAS_ESTABLE
            }
            cambiarEstado('conectada')
            if (!ultimoEnviado || ultimoEnviado.peso !== lectura.peso || ultimoEnviado.estable !== lectura.estable) {
              ultimoEnviado = lectura
              ultimaLectura = lectura
              emisor.lectura(lectura)
            }
          }
          setImmediate(siguiente)
        })
      }
      siguiente()
    }

    abrir()
  }

  return { iniciar: iniciarBalanza, detener: detenerBalanza, estado: estadoDeBalanza }
}

/**
 * Fija 9600 8N1 antes de abrir. Windows recuerda los últimos ajustes de cada
 * puerto (otro programa, como el IDE de Arduino, los deja en 19200 y entonces
 * solo llega basura). El CH340 rechaza esto salvo la primera vez tras
 * conectarlo; en ese caso se ignora el fallo y se lee con lo que ya tenga.
 */
function fijarParametros(puerto: string): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      'mode',
      [puerto, 'BAUD=9600', 'PARITY=n', 'DATA=8', 'STOP=1'],
      { windowsHide: true, timeout: 5000 },
      () => resolve()
    )
  })
}

/** Puertos COM presentes en el equipo (sin depender de librerías nativas). */
export function listarPuertosCom(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM'],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve([])
        const puertos = [...stdout.matchAll(/REG_SZ\s+(COM\d+)/gi)].map((m) => m[1].toUpperCase())
        resolve([...new Set(puertos)].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))))
      }
    )
  })
}
