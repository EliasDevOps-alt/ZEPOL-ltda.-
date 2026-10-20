import { useCallback, useEffect, useState } from 'react'

type Suscripcion = Awaited<ReturnType<Window['api']['estadoBalanzas']>>[number]
export type EstadoBalanza = Suscripcion['estado']
export type LecturaBalanza = NonNullable<Suscripcion['lectura']>
export type NumeroBalanza = 1 | 2

export interface BalanzaVista {
  numero: NumeroBalanza
  estado: EstadoBalanza
  /** Solo es la lectura vigente mientras la balanza está 'conectada'; si no, null. */
  lectura: LecturaBalanza | null
}

const SIN_BALANZA: EstadoBalanza = { estado: 'detenida', puerto: null }
const CLAVE_ACTIVA = 'zepol.balanza.activa'

function leerActivaGuardada(): NumeroBalanza {
  try {
    return localStorage.getItem(CLAVE_ACTIVA) === '2' ? 2 : 1
  } catch {
    return 1
  }
}

/**
 * Las (hasta) dos balanzas seriales de ESTA PC; las lee el proceso principal
 * de Electron (main/balanza.ts), una por puerto COM. `activa` es la que
 * alimenta el Peso bruto al dar Enter.
 */
export function useBalanza() {
  const [estados, setEstados] = useState<EstadoBalanza[]>([SIN_BALANZA, SIN_BALANZA])
  const [lecturas, setLecturas] = useState<(LecturaBalanza | null)[]>([null, null])
  const [puertos, setPuertos] = useState<string[]>([])
  const [elegida, setElegida] = useState<NumeroBalanza>(leerActivaGuardada)

  useEffect(() => {
    let vivo = true
    window.api
      .estadoBalanzas()
      .then((s) => {
        if (!vivo) return
        setEstados(s.map((x) => x.estado))
        setLecturas(s.map((x) => x.lectura))
      })
      .catch(() => undefined)
    const cambiar = <T,>(anterior: T[], numero: NumeroBalanza, valor: T): T[] => {
      const copia = [...anterior]
      copia[numero - 1] = valor
      return copia
    }
    const quitarEstado = window.api.alCambiarEstadoBalanza((n, e) => setEstados((a) => cambiar(a, n, e)))
    const quitarLectura = window.api.alLeerBalanza((n, l) => setLecturas((a) => cambiar(a, n, l)))
    return () => {
      vivo = false
      quitarEstado()
      quitarLectura()
    }
  }, [])

  const actualizarPuertos = useCallback(async () => {
    try {
      setPuertos(await window.api.listarPuertosBalanza())
    } catch {
      setPuertos([])
    }
  }, [])

  /** '' = sin esa balanza en esta PC. Se guarda en el config.json de la PC. Lanza si el puerto ya lo usa la otra. */
  const configurar = useCallback(async (numero: NumeroBalanza, puerto: string) => {
    const s = await window.api.configurarBalanza(numero, puerto)
    setEstados(s.map((x) => x.estado))
    setLecturas(s.map((x) => x.lectura))
  }, [])

  const elegirActiva = useCallback((numero: NumeroBalanza) => {
    setElegida(numero)
    try {
      localStorage.setItem(CLAVE_ACTIVA, String(numero))
    } catch {
      // Recordar la elección es una comodidad, no un requisito.
    }
  }, [])

  const balanzas: BalanzaVista[] = ([1, 2] as const).map((numero) => ({
    numero,
    estado: estados[numero - 1],
    lectura: estados[numero - 1].estado === 'conectada' ? lecturas[numero - 1] : null
  }))

  // Si solo hay una configurada en esta PC, esa es la activa sin preguntar.
  const configuradas = balanzas.filter((b) => b.estado.estado !== 'detenida')
  const activa: NumeroBalanza = configuradas.length === 1 ? configuradas[0].numero : elegida

  return {
    balanzas,
    activa,
    lecturaActiva: balanzas[activa - 1].lectura,
    elegirActiva,
    puertos,
    actualizarPuertos,
    configurar
  }
}
