import JsBarcode from 'jsbarcode'
import { escaparHtml as esc } from './documentoWord'
import { formatearFecha } from './fechas'
import { nombreEnvases } from './formularioPt'
import { LOGO_ZEPOL_BASE64 } from './logoZepol'
import { LOGO_ZPL } from './logoZpl'
import type { PesajePt, ProductoTerminado } from './types'

// Etiqueta de una bobina o un paquete de producto terminado (una por pesaje).
//
// Se imprime en la etiquetadora térmica SAT TT460 UE (203 dpi, lenguaje ZPL)
// sobre rollo de 100 × 48 mm. La etiqueta se describe UNA sola vez, como una
// lista de elementos con posiciones en PUNTOS de la impresora (8 por mm), y de
// esa lista salen las dos cosas: el ZPL que se manda a la impresora y el HTML
// de la vista previa / PDF. Así lo que se ve en pantalla no se desfasa de lo
// que sale en papel. (La vista previa es aproximada: la impresora usa su propia
// letra interna, que no se puede medir desde acá.)
export const ANCHO_ETIQUETA_MM = 100
export const ALTO_ETIQUETA_MM = 48

const PUNTOS_POR_MM = 8
const ANCHO = ANCHO_ETIQUETA_MM * PUNTOS_POR_MM // 800
const ALTO = ALTO_ETIQUETA_MM * PUNTOS_POR_MM // 384
// Ancho de un carácter respecto de su alto en la letra interna de la impresora
// (fuente 0, condensada). 0.6 es una estimación a propósito algo ancha: es
// mejor que un texto sobre y la letra salga un poco más chica a que se corte.
const ANCHO_CARACTER = 0.6

// Zona en blanco a cada lado del código, en anchos de barra: los lectores la
// necesitan para encontrar dónde empieza y termina.
const ZONA_SILENCIO = 10

export const LEYENDA_ETIQUETA_PT =
  'Para cualquier reclamo de esta mercadería, debe conservar la etiqueta. No se aceptarán reclamos después de 6 meses de haber recibido la mercadería.'

export interface DatosEtiquetaPt {
  numeroOt: string
  cliente: string
  producto: string
  descripcion: string
  // N° BOB / PAQ.
  numero: number
  cantidadEnvases: string
  fecha: string
  pesador: string
  pesoBruto: string
  tara: string
  pesoNeto: string
  codigoBarras: string
}

/**
 * Contenido del código de barras. PROVISORIO — Elias va a explicar para qué
 * se usa y de ahí saldrá el formato real (la etiqueta original tenía un EAN-13).
 * Mientras tanto, OT + N° de bobina/paquete: único por etiqueta y legible.
 */
export function codigoBarrasPt(numeroOt: string, numero: number): string {
  return `${numeroOt}-${String(numero).padStart(4, '0')}`
}

/** Peso con 3 decimales, como en la etiqueta original (35.000). */
function peso(valor: number): string {
  return valor.toFixed(3)
}

/** Datos de un pesaje → lo que va impreso en su etiqueta. */
export function datosEtiquetaDesdePesaje(pt: ProductoTerminado, pesaje: PesajePt): DatosEtiquetaPt {
  return {
    numeroOt: pt.numero_ot,
    cliente: pt.cliente ?? '',
    // Si el paquete dice de qué producto es (OT de varios ítems), va ese; si se
    // pesó "sin separar" o la OT tiene un solo ítem, van todos.
    producto: (pt.items.filter((item) => item.numero === pesaje.item_numero).length
      ? pt.items.filter((item) => item.numero === pesaje.item_numero)
      : pt.items
    )
      .map((item) => item.descripcion_producto)
      .filter(Boolean)
      .join(' / '),
    // Todavía no se sabe de dónde sale (en la etiqueta original decía "200 Gg").
    descripcion: '',
    numero: pesaje.numero,
    // Bolsas o láminas del paquete; en Kg y Bob, las bobinas pesadas juntas (1 si
    // es una sola). Antes en Kg/Bob salía el peso neto; Elias pidió cambiarlo
    // (2026-10-22): el peso ya tiene su propio renglón.
    cantidadEnvases:
      pesaje.cantidad !== null
        ? `${pesaje.cantidad.toLocaleString('en-US', { useGrouping: false })} ${
            pt.unidad ? nombreEnvases(pt.unidad, pesaje.cantidad) : 'bolsas'
          }`
        : `${peso(pesaje.peso_neto)} kg`,
    fecha: formatearFecha(pesaje.fecha),
    pesador: pesaje.pesador,
    pesoBruto: peso(pesaje.peso_bruto),
    tara: peso(pesaje.tara),
    pesoNeto: peso(pesaje.peso_neto),
    codigoBarras: codigoBarrasPt(pt.numero_ot, pesaje.numero)
  }
}

/**
 * Código de barras CODE128 como SVG. JsBarcode se usa en su modo "objeto"
 * (devuelve las barras como una tira de 0 y 1, sin tocar el DOM) y el SVG se
 * arma acá: así la etiqueta es un HTML autosuficiente, sin depender de que
 * el documento donde se genera tenga un <svg> vivo.
 */
function svgCodigoBarras(texto: string): string {
  const resultado: { encodings?: { data: string }[] } = {}
  JsBarcode(resultado, texto, { format: 'CODE128' })
  const bits = (resultado.encodings ?? []).map((e) => e.data).join('')
  const total = bits.length + ZONA_SILENCIO * 2
  const barras: string[] = []
  let i = 0
  while (i < bits.length) {
    if (bits[i] !== '1') {
      i++
      continue
    }
    let fin = i
    while (bits[fin] === '1') fin++
    barras.push(`<rect x="${i + ZONA_SILENCIO}" y="0" width="${fin - i}" height="1"/>`)
    i = fin
  }
  return `<svg class="barras" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 1" preserveAspectRatio="none" shape-rendering="crispEdges">${barras.join('')}</svg>`
}

// ---------------------------------------------------------------------------
// Diseño de la etiqueta: elementos con posición en puntos de la impresora.

type Elemento =
  | { tipo: 'caja'; x: number; y: number; ancho: number; alto: number; grosor: number }
  // Con `ancho`, el texto se centra dentro de ese ancho; sin él, queda a la izquierda de `x`.
  | { tipo: 'texto'; x: number; y: number; alto: number; texto: string; ancho?: number }
  | { tipo: 'barras'; x: number; y: number; alto: number; ancho: number; texto: string }
  | { tipo: 'logo'; x: number; y: number }

/** Solo ASCII y sin los caracteres que son comandos de ZPL: las etiquetadoras
 * "compatibles" no siempre traen tildes ni eñes, y un ^ o ~ en un nombre de
 * cliente rompería la etiqueta. Á → A, ñ → n; lo demás raro se descarta. */
export function limpiarTextoZpl(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\^~]/g, ' ')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function anchoTexto(texto: string, alto: number): number {
  return texto.length * alto * ANCHO_CARACTER
}

/** El texto más grande (entre `deseado` y `minimo`) que entra en `anchoMax`; si
 * ni con el mínimo entra, se corta con "...". */
function ajustar(texto: string, deseado: number, minimo: number, anchoMax: number): { texto: string; alto: number } {
  const limpio = limpiarTextoZpl(texto)
  for (let alto = deseado; alto >= minimo; alto -= 2) {
    if (anchoTexto(limpio, alto) <= anchoMax) return { texto: limpio, alto }
  }
  const maxCaracteres = Math.max(4, Math.floor(anchoMax / (minimo * ANCHO_CARACTER)))
  return { texto: `${limpio.slice(0, maxCaracteres - 3).trimEnd()}...`, alto: minimo }
}

/** Parte el texto en renglones de hasta `maxCaracteres` sin cortar palabras; si
 * no entra en `maxLineas`, el último renglón termina en "...". */
function partir(texto: string, maxCaracteres: number, maxLineas: number): { lineas: string[]; recortado: boolean } {
  const palabras = limpiarTextoZpl(texto).split(' ').filter(Boolean)
  const lineas: string[] = []
  let actual = ''
  for (let palabra of palabras) {
    while (palabra.length > maxCaracteres) {
      if (actual) {
        lineas.push(actual)
        actual = ''
      }
      lineas.push(palabra.slice(0, maxCaracteres))
      palabra = palabra.slice(maxCaracteres)
    }
    if (!actual) actual = palabra
    else if (actual.length + 1 + palabra.length <= maxCaracteres) actual += ` ${palabra}`
    else {
      lineas.push(actual)
      actual = palabra
    }
  }
  if (actual) lineas.push(actual)
  if (lineas.length <= maxLineas) return { lineas, recortado: false }
  const visibles = lineas.slice(0, maxLineas)
  const ultima = visibles[maxLineas - 1]
  visibles[maxLineas - 1] = `${ultima.slice(0, Math.max(1, maxCaracteres - 3)).trimEnd()}...`
  return { lineas: visibles, recortado: true }
}

/** Puntos que ocupa el código de barras a 2 puntos por módulo. CODE128 con
 * todo en subconjunto B es lo más ancho que puede salir: (n + 2) × 11 + 13. */
function anchoCodigoBarras(texto: string): number {
  return ((limpiarTextoZpl(texto).length + 2) * 11 + 13) * 2
}

/** Renglones de un texto largo con la letra más grande que deje todo visible. */
function renglones(
  texto: string,
  ancho: number,
  deseado: number,
  minimo: number,
  maxLineas: number
): { lineas: string[]; alto: number } {
  let alto = deseado
  let partido = partir(texto, Math.floor(ancho / (alto * ANCHO_CARACTER)), maxLineas)
  while (partido.recortado && alto > minimo) {
    alto -= 2
    partido = partir(texto, Math.floor(ancho / (alto * ANCHO_CARACTER)), maxLineas)
  }
  return { lineas: partido.lineas, alto }
}

/** La leyenda en dos mitades (una por oración): van una a cada lado del código de barras. */
function mitadesLeyenda(): [string, string] {
  const [primera, ...resto] = LEYENDA_ETIQUETA_PT.split('. ')
  return [`${primera}.`, resto.join('. ')]
}

/**
 * Diseño elegido por Elias (2026-11-03, "Opción C"): una cuadrícula como el
 * formulario en papel. Cada dato va en su celda con el rótulo chico arriba y el
 * valor centrado, las celdas se reparten a todo el ancho (así no queda peso de
 * un solo lado), el código de barras va al centro y la leyenda de reclamos se
 * parte en dos mitades, una a cada lado. Se descartaron una versión centrada con
 * cajas solo para los pesos y otra en dos columnas con el peso neto gigante.
 */
function elementosEtiqueta(d: DatosEtiquetaPt): Elemento[] {
  const e: Elemento[] = []
  const centro = (x: number, ancho: number, y: number, a: { texto: string; alto: number }) =>
    e.push({ tipo: 'texto', x, y, alto: a.alto, texto: a.texto, ancho })
  const caja = (x: number, y: number, ancho: number, alto: number, grosor: number) =>
    e.push({ tipo: 'caja', x, y, ancho, alto, grosor })
  // Una celda con rótulo chico arriba y el valor centrado abajo (sin pisar el borde).
  const celda = (
    x: number,
    y: number,
    ancho: number,
    alto: number,
    rotulo: string,
    valor: string,
    altoValor: number,
    grosor = 2
  ) => {
    caja(x, y, ancho, alto, grosor)
    centro(x, ancho, y + 4, ajustar(rotulo, 14, 14, ancho - 8))
    const altoMaximo = alto - 4 - 14 - 3 - 5
    centro(x, ancho, y + 4 + 14 + 3, ajustar(valor, Math.min(altoValor, altoMaximo), 16, ancho - 12))
  }

  // Marco y encabezado: logo, título centrado y el N° de bobina/paquete en su caja.
  caja(6, 6, ANCHO - 12, ALTO - 12, 3)
  e.push({ tipo: 'logo', x: 14, y: 11 })
  centro(100, 520, 8, ajustar('ZEPOL LTDA.', 36, 36, 520))
  centro(100, 520, 46, ajustar('Almacen Producto Terminado', 22, 22, 520))
  caja(636, 8, 150, 64, 3)
  centro(636, 150, 12, ajustar('NRO BOB/PAQ', 16, 16, 142))
  centro(636, 150, 30, ajustar(String(d.numero), 36, 22, 142))

  // Cuadrícula de datos.
  celda(14, 78, 250, 46, 'OT', d.numeroOt, 26)
  celda(263, 78, 262, 46, 'FECHA', d.fecha, 26)
  celda(524, 78, 262, 46, 'PESADOR', d.pesador, 26)
  celda(14, 123, 521, 46, 'CLIENTE', d.cliente, 26)
  celda(534, 123, 252, 46, 'ENVASES', d.cantidadEnvases, 26)
  // Producto: celda alta con hasta dos renglones centrados.
  caja(14, 168, 772, 68, 2)
  centro(14, 772, 172, ajustar('PRODUCTO', 16, 16, 764))
  const producto = renglones(d.producto, 756, 22, 16, 2)
  producto.lineas.forEach((linea, i) =>
    centro(14, 772, 191 + i * (producto.alto + 2), { texto: linea, alto: producto.alto })
  )
  celda(14, 235, 250, 58, 'BRUTO', d.pesoBruto, 30)
  celda(263, 235, 250, 58, 'TARA', d.tara, 30)
  celda(512, 235, 274, 58, 'PESO NETO (kg)', d.pesoNeto, 34, 4)

  // Código de barras al centro; la leyenda, una mitad a cada lado.
  const anchoBarras = anchoCodigoBarras(d.codigoBarras)
  const xBarras = Math.round((ANCHO - anchoBarras) / 2)
  e.push({ tipo: 'barras', x: xBarras, y: 300, alto: 40, ancho: anchoBarras, texto: limpiarTextoZpl(d.codigoBarras) })
  const anchoLado = xBarras - 12 - 14
  const [izquierda, derecha] = mitadesLeyenda()
  const ley1 = renglones(izquierda, anchoLado, 13, 12, 4)
  ley1.lineas.forEach((linea, i) =>
    centro(14, anchoLado, 304 + i * (ley1.alto + 2), { texto: linea, alto: ley1.alto })
  )
  const ley2 = renglones(derecha, anchoLado, 13, 12, 4)
  ley2.lineas.forEach((linea, i) =>
    centro(xBarras + anchoBarras + 12, anchoLado, 304 + i * (ley2.alto + 2), { texto: linea, alto: ley2.alto })
  )
  return e
}

// ---------------------------------------------------------------------------
// ZPL para la etiquetadora.

function zplElemento(el: Elemento): string {
  switch (el.tipo) {
    case 'caja':
      return `^FO${el.x},${el.y}^GB${el.ancho},${el.alto},${el.grosor}^FS`
    case 'texto':
      return el.ancho
        ? `^FO${el.x},${el.y}^A0N,${el.alto}^FB${el.ancho},1,0,C,0^FD${el.texto}^FS`
        : `^FO${el.x},${el.y}^A0N,${el.alto}^FD${el.texto}^FS`
    case 'barras':
      return `^FO${el.x},${el.y}^BY2,3,${el.alto}^BCN,${el.alto},Y,N,N,N^FD${el.texto}^FS`
    case 'logo': {
      const total = LOGO_ZPL.bytesPorFila * LOGO_ZPL.alto
      return `^FO${el.x},${el.y}^GFA,${total},${total},${LOGO_ZPL.bytesPorFila},${LOGO_ZPL.hex}^FS`
    }
  }
}

/** ZPL de una o varias etiquetas (cada una es un ^XA…^XZ, así que un solo
 * trabajo de impresión puede llevar el lote entero). */
export function generarZplEtiquetasPt(etiquetas: DatosEtiquetaPt[]): string {
  return etiquetas
    .map((d) =>
      ['^XA', `^PW${ANCHO}`, `^LL${ALTO}`, '^LH0,0', ...elementosEtiqueta(d).map(zplElemento), '^XZ'].join('\n')
    )
    .join('\n')
}

// ---------------------------------------------------------------------------
// HTML para la vista previa y el PDF (mismas posiciones que el ZPL).

const mm = (puntos: number) => `${+(puntos / PUNTOS_POR_MM).toFixed(3)}mm`

function htmlElemento(el: Elemento, d: DatosEtiquetaPt): string {
  const pos = `left:${mm(el.x)};top:${mm(el.y)}`
  switch (el.tipo) {
    case 'caja': {
      const relleno = el.grosor * 2 >= Math.min(el.ancho, el.alto)
      return `<div class="el" style="${pos};width:${mm(el.ancho)};height:${mm(el.alto)};${
        relleno ? 'background:#000' : `border:${mm(el.grosor)} solid #000`
      }"></div>`
    }
    case 'texto':
      return `<div class="el t" style="${pos};font-size:${mm(el.alto * 0.9)}${
        el.ancho ? `;width:${mm(el.ancho)};text-align:center` : ''
      }">${esc(el.texto)}</div>`
    case 'barras':
      return `<div class="el" style="${pos};width:${mm(el.ancho)};height:${mm(el.alto)}">${svgCodigoBarras(d.codigoBarras)}</div><div class="el t centro" style="left:${mm(el.x)};top:${mm(el.y + el.alto + 3)};width:${mm(el.ancho)};font-size:${mm(18)}">${esc(el.texto)}</div>`
    case 'logo':
      return `<img class="el" src="${LOGO_ZEPOL_BASE64}" alt="Zepol" style="${pos};height:${mm(LOGO_ZPL.alto)}">`
  }
}

function htmlEtiqueta(d: DatosEtiquetaPt): string {
  return `<div class="etiqueta">${elementosEtiqueta(d)
    .map((el) => htmlElemento(el, d))
    .join('')}</div>`
}

const ESTILOS = `
  * { box-sizing: border-box; }
  @page { size: ${ANCHO_ETIQUETA_MM}mm ${ALTO_ETIQUETA_MM}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: "Arial Narrow", Arial, Helvetica, sans-serif; color: #000; }
  .etiqueta {
    position: relative; width: ${ANCHO_ETIQUETA_MM}mm; height: ${ALTO_ETIQUETA_MM}mm; overflow: hidden;
    page-break-after: always; break-after: page;
  }
  .etiqueta:last-child { page-break-after: auto; break-after: auto; }
  .el { position: absolute; display: block; }
  .t { white-space: nowrap; font-weight: bold; line-height: 1; }
  .centro { text-align: center; font-weight: normal; }
  .barras { width: 100%; height: 100%; display: block; }
`

/** HTML con una etiqueta por página (una o varias, para la vista previa y el PDF). */
export function generarHtmlEtiquetasPt(etiquetas: DatosEtiquetaPt[]): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Etiqueta de producto terminado</title>
<style>${ESTILOS}</style>
</head>
<body>
${etiquetas.map(htmlEtiqueta).join('\n')}
</body>
</html>`
}

export function nombreArchivoEtiquetaPt(numeroOt: string, numeros: number[]): string {
  const rango = numeros.length === 1 ? `${numeros[0]}` : `${Math.min(...numeros)}-${Math.max(...numeros)}`
  return `Etiqueta-PT-OT-${numeroOt}-N${rango}`
}
