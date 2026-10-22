// Cuando una OT tiene dos o más entregas del MISMO material (ej. dos veces PA15520),
// en las pantallas se ven como filas casi iguales y es fácil dudar de cuál es cuál
// (OT 220384: la devolución "de en medio" parecía una tercera entrega). Pedido de la
// planta (2026-10-22): rotularlas PA15520 (A), PA15520 (B), PA15520 (C)…
//
// La regla es una sola y la usan todas las pantallas, para que "(B)" signifique lo
// mismo en Consultar OT, Registrar Entrega, Registrar Devolución, Historial y
// Registro SID:
//  - se agrupa por OT y por material REALMENTE entregado (`codigo_mp_entregado`,
//    no el del pedido: una alternativa es otro material);
//  - solo los materiales con 2 o más entregas llevan letra; con una sola no se
//    agrega nada;
//  - la letra sigue el orden en que se hicieron (fecha, hora, id), así la primera
//    siempre es la (A) y una entrega nueva nunca cambia las letras de las anteriores.
//    Si se borra una entrega del medio, las siguientes corren una letra: es una
//    etiqueta de pantalla, no un dato guardado.

interface EntregaConLetra {
  id: number
  numero_ot: string
  codigo_mp_entregado: string
  fecha: string
  hora: string
}

/** A, B, … Z, AA, AB … (como las columnas de una planilla). */
function letraDeIndice(indice: number): string {
  let n = indice
  let letra = ''
  do {
    letra = String.fromCharCode(65 + (n % 26)) + letra
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return letra
}

/** id de entrega → su letra. Solo trae las entregas que la necesitan. */
export function letrasDeEntregas(entregas: readonly EntregaConLetra[]): Map<number, string> {
  const grupos = new Map<string, EntregaConLetra[]>()
  for (const e of entregas) {
    const clave = `${e.numero_ot}|${e.codigo_mp_entregado.trim().toLowerCase()}`
    grupos.set(clave, [...(grupos.get(clave) ?? []), e])
  }
  const letras = new Map<number, string>()
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue
    const ordenadas = [...grupo].sort(
      (a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora) || a.id - b.id
    )
    ordenadas.forEach((e, i) => letras.set(e.id, letraDeIndice(i)))
  }
  return letras
}
