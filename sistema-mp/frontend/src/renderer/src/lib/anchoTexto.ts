// Ancho de un texto en Arial Bold, para decidir el tamaño de letra de un campo
// que tiene que caber en su celda (nombre del cliente, diseño, Nº OT).
//
// Se usa una tabla y no el navegador (canvas.measureText) a propósito: el
// formulario se arma igual en la app, en el PDF y en el Word, y tiene que dar
// el MISMO tamaño en los tres. La tabla son los anchos reales de Arial Bold
// para los caracteres ASCII 32..126, en milésimas de em, medidos con canvas.
const ANCHOS_ARIAL_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
]

const ANCHO_POR_DEFECTO = 611

/** Ancho en puntos de `texto` en Arial Bold al tamaño `pt`. */
export function anchoTextoPt(texto: string, pt: number): number {
  let total = 0
  // NFD separa "ñ" en "n" + tilde: la letra base es la que ocupa el lugar.
  for (const caracter of texto.normalize('NFD')) {
    const codigo = caracter.charCodeAt(0)
    if (codigo >= 0x300 && codigo <= 0x36f) continue
    total += codigo >= 32 && codigo <= 126 ? ANCHOS_ARIAL_BOLD[codigo - 32] : ANCHO_POR_DEFECTO
  }
  return (total / 1000) * pt
}

/**
 * Mayor tamaño de letra, de `tamanos` (de mayor a menor), con el que `texto`
 * entra en `disponiblePt`. Si no entra ni con el menor devuelve el menor: el
 * llamador decide si lo deja cortar o lo parte en renglones.
 */
export function tamanoQueEntra(texto: string, disponiblePt: number, tamanos: number[]): number {
  for (const pt of tamanos) {
    if (anchoTextoPt(texto, pt) <= disponiblePt) return pt
  }
  return tamanos[tamanos.length - 1]
}

/**
 * Cuántos renglones ocupa `texto` a `pt` dentro de `anchoPt`, cortando solo en
 * espacios (como hace el navegador y Word; cortar además en guiones daría a
 * veces un renglón menos, así que esto es conservador). Devuelve Infinity si
 * alguna palabra sola no entra en un renglón: ahí no hay tamaño que lo arregle
 * partiendo por renglones.
 */
export function renglonesNecesarios(texto: string, pt: number, anchoPt: number): number {
  const palabras = texto.split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return 1
  const espacio = anchoTextoPt(' ', pt)
  let renglones = 1
  let usado = 0
  for (const palabra of palabras) {
    const ancho = anchoTextoPt(palabra, pt)
    if (ancho > anchoPt) return Infinity
    if (usado === 0) {
      usado = ancho
    } else if (usado + espacio + ancho <= anchoPt) {
      usado += espacio + ancho
    } else {
      renglones++
      usado = ancho
    }
  }
  return renglones
}
