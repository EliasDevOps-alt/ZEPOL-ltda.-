import type { Devolucion, Entrega } from './types'
import { LOGO_ZEPOL_BASE64 } from './logoZepol'
import { anchoTextoPt, renglonesNecesarios, tamanoQueEntra } from './anchoTexto'
import {
  altoFila,
  envolverEnMhtml,
  escaparHtml,
  ESTILOS_TABLA_WORD,
  URL_LOGO_MHTML
} from './documentoWord'

// Réplica del formulario en papel "P-LOG-001-F-01/V.2.0" (FORMULARIO DE
// CONTROL DE ENTREGA DE MATERIAS PRIMAS), carta HORIZONTAL.
//
// Todas las medidas de acá están sacadas del PDF original leyendo sus
// coordenadas vectoriales, no midiendo una captura: son las posiciones reales
// de cada línea y cada rótulo, en puntos. Si hay que retocar el formato, mover
// estas constantes.
const PAGINA_ANCHO_PT = 792 // 11in
const PAGINA_ALTO_PT = 612 // 8.5in
const MARGEN_SUP_PT = 38.7
const MARGEN_DER_PT = 18.4
// El original deja 29.2pt abajo, que es EXACTAMENTE lo que sobra: la tabla
// mide 544.1pt y el alto útil da 544.1pt. Con los bordes de la tabla eso se
// pasa por décimas y la última fila se va sola a otra hoja. Se recorta el
// margen inferior (espacio que igual queda vacío) para dejar holgura; ni la
// posición ni el tamaño del formulario cambian, porque todo se apoya arriba.
// El recorte además le hace lugar al párrafo vacío que Word agrega siempre
// después de una tabla, que si no entra genera una última hoja en blanco.
const MARGEN_INF_PT = 14
const MARGEN_IZQ_PT = 17.6

// Las 9 columnas base del formulario. Ninguna fila las usa todas: cada banda
// combina algunas (ver COLS_* abajo), igual que el original.
// La 1a columna mide 80 y no los 78.5 del original, y la 2a 62.3 y no 63.8 (la
// suma no cambia). Es lo que necesita "N OT: " + 9 caracteres en negrita 9pt
// (74.3pt medidos + margenes): asi la celda del N OT ocupa SOLO la 1a columna y
// el cliente se queda con la 2a y la 3a. Antes el N OT ocupaba las dos primeras
// (142pt para un texto de 74pt) y el nombre del cliente se cortaba.
const COLUMNAS_PT = [80, 62.3, 251.9, 73.2, 83.4, 69.3, 69.4, 38.4, 28.1]
const ANCHO_CONTENIDO_PT = COLUMNAS_PT.reduce((a, b) => a + b, 0) // 756

const ALTO_ENCABEZADO_PT = 59.6
const ALTO_BANDA_ALMACENES_PT = 16.8
const ALTO_FILA_OT_PT = 27.0
const ALTO_FILA_ROTULOS_PT = 15.9
const ALTO_FILA_DATOS_PT = 22.6

const FILAS_POR_BLOQUE = 5
const BLOQUES_POR_PAGINA = 3
// Separación entre hojas, solo en la vista previa en pantalla.
const SEPARACION_HOJAS_PT = 9

// Desplazamiento de cada rótulo respecto del borde izquierdo de su celda,
// medido en el PDF. Varios NO están centrados en la celda que los contiene
// (el formulario se dibujó con celdas combinadas y después se movieron los
// bordes), así que se posicionan por offset en vez de centrarlos.
const OFFSET_TITULO_PT = 10.15
const OFFSET_CODIGO_PT = 11.75
const OFFSET_VALOR_CODIGO_PT = 16.85
const OFFSET_ALMACENES_PT = 311.68
const OFFSET_LOGO_PT = 19.6
const OFFSET_LOGO_SUP_PT = 0.3
const OFFSET_NRO_OT_PT = 2.0
const OFFSET_CLIENTE_PT = 2.35
const OFFSET_DISENO_PT = 2.1
const OFFSET_FECHA_PT = 24.8
const OFFSET_CANTIDAD_PT = 57.73
const OFFSET_DEVOL_PT = 20.7
const OFFSET_MAQ_PT = 31.13
const OFFSET_COD_MATERIAL_PT = 15.35
const OFFSET_TINTAS_PT = 9.68
const OFFSET_DIG_PT = 9.67

const BORDE = '0.6pt solid #000'
const LOGO_ANCHO_PT = 44.8
const LOGO_ALTO_PT = 37.0

export interface FilaFormularioMp {
  fecha: string
  cantidadEntregada: string
  devolucion: string
  // "Proceso/Máquina" (ej. Laminación/NORD), o solo la máquina si no hay proceso.
  procesoMaquina: string
  codigoMaterial: string
}

export interface BloqueFormularioMp {
  numeroOt: string
  cliente: string
  diseno: string
  filas: FilaFormularioMp[]
}

function suma(desde: number, cantidad: number): number {
  return COLUMNAS_PT.slice(desde, desde + cantidad).reduce((a, b) => a + b, 0)
}

/** Ancho en pt de una celda que abarca `cantidad` columnas desde `desde` (0-based). */
const ANCHO = {
  logo: suma(0, 2),
  titulo: suma(2, 3),
  codigo: suma(5, 1),
  valorCodigo: suma(6, 3),
  nroOt: suma(0, 1),
  cliente: suma(1, 2),
  diseno: suma(3, 6),
  fecha: suma(0, 1),
  cantidad: suma(1, 2),
  devol: suma(3, 1),
  maq: suma(4, 1),
  codMaterial: suma(5, 2),
  tintas: suma(7, 1),
  dig: suma(8, 1)
}

interface Contexto {
  paraWord: boolean
}

/**
 * Abre un `<td>`. En Word los estilos van inline porque su importador solo
 * aplica la PRIMERA clase de un `class="a b"` y no respeta reglas de
 * descendencia — el mismo problema ya resuelto en formularioPt.ts.
 */
function celda(ctx: Contexto, anchoPt: number, estilo: string, colspan: number): string {
  const span = colspan > 1 ? ` colspan="${colspan}"` : ''
  const px = Math.round((anchoPt * 96) / 72)
  const base = `width:${anchoPt}pt;border:${BORDE};padding:0;vertical-align:middle;overflow:hidden`
  return `<td${span} width="${px}" style="${base};${estilo}">`
}

// Tamaños de letra que se prueban, de mayor a menor, para un campo de la
// cabecera del bloque (Nº OT / CLIENTE / DISEÑO). 9pt es el del original.
const TAMANOS_CABECERA_PT = [9, 8.5, 8, 7.5, 7]
const MARGEN_DERECHO_CABECERA_PT = 3
// Para el campo que puede ir en varios renglones (DISEÑO): tamaños de 9pt hasta
// 5.5pt, y el alto de la fila de la cabecera del bloque menos los bordes.
const TAMANOS_MULTIRENGLON_PT = [9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5]
const INTERLINEADO = 1.05
const ALTO_UTIL_CABECERA_PT = 23.5
const MAX_RENGLONES_DISENO = 4

/**
 * Estilo de un campo "ROTULO: valor" que tiene que caber en su celda. Se usa
 * el mayor tamaño con el que entra; si ni el menor alcanza se deja partir en
 * renglones (la fila mide 27pt, entran 2 a 7pt) en vez de cortar el texto.
 */
function estiloCampoCabecera(
  textoCompleto: string,
  anchoCeldaPt: number,
  offsetPt: number,
  maxRenglones = 1
): string {
  const disponible = anchoCeldaPt - offsetPt - MARGEN_DERECHO_CABECERA_PT

  if (maxRenglones > 1) {
    // Varios renglones: se busca el MAYOR tamaño con el que el texto entra en
    // a lo sumo `maxRenglones` renglones Y esos renglones caben en el alto de
    // la fila. El texto largo (una descripción de 200 caracteres) baja de
    // tamaño y pasa a 2, 3 o 4 renglones sin agrandar la fila.
    for (const pt of TAMANOS_MULTIRENGLON_PT) {
      const renglones = renglonesNecesarios(textoCompleto, pt, disponible)
      if (renglones <= maxRenglones && renglones * pt * INTERLINEADO <= ALTO_UTIL_CABECERA_PT) {
        // El interlineado va en pt exactos (y mso-line-height-rule:exactly para
        // Word): Word usa ~1.15 veces el tamaño si no, y 3 renglones ya no
        // caben en la fila.
        return renglones === 1
          ? rotulo(offsetPt, pt)
          : `${rotulo(offsetPt, pt).replace('white-space:nowrap', 'white-space:normal')};line-height:${(pt * INTERLINEADO).toFixed(2)}pt;mso-line-height-rule:exactly`
      }
    }
    const pt = TAMANOS_MULTIRENGLON_PT[TAMANOS_MULTIRENGLON_PT.length - 1]
    return `${rotulo(offsetPt, pt).replace('white-space:nowrap', 'white-space:normal')};line-height:${(pt * INTERLINEADO).toFixed(2)}pt;mso-line-height-rule:exactly`
  }

  const pt = tamanoQueEntra(textoCompleto, disponible, TAMANOS_CABECERA_PT)
  const entra = anchoTextoPt(textoCompleto, pt) <= disponible
  const base = rotulo(offsetPt, pt)
  return entra ? base : base.replace('white-space:nowrap', 'white-space:normal;line-height:1.05')
}

function rotulo(offsetPt: number, tamanoPt: number): string {
  return `padding-left:${offsetPt}pt;font-size:${tamanoPt}pt;font-weight:bold;text-align:left;white-space:nowrap`
}

// Tamaños que se prueban para un dato centrado en su celda, de mayor a menor.
const TAMANOS_DATO_PT = [8, 7.5, 7, 6.5]
const PADDING_LATERAL_DATO_PT = 3

/**
 * Estilo de un dato centrado que tiene que caber en su celda (Proceso/Máquina:
 * "Confección/POUCH 2" no entra a 8pt en la columna MAQ.). Se usa el mayor
 * tamaño con el que entra; si ni el menor alcanza se deja partir en renglones,
 * la fila mide 22.6pt y entran dos a 6.5pt, en vez de cortar el texto.
 */
function estiloDatoQueEntra(texto: string, anchoCeldaPt: number, centrado = true): string {
  const disponible = anchoCeldaPt - 2 * PADDING_LATERAL_DATO_PT
  const pt = tamanoQueEntra(texto, disponible, TAMANOS_DATO_PT)
  const base = dato(pt, centrado)
  return anchoTextoPt(texto, pt) <= disponible ? base : `${base};line-height:1.05`
}

function dato(tamanoPt: number, centrado = false): string {
  return `padding:0 3pt;font-size:${tamanoPt}pt;text-align:${centrado ? 'center' : 'left'};overflow:hidden`
}

const FILA_VACIA: FilaFormularioMp = {
  fecha: '',
  cantidadEntregada: '',
  devolucion: '',
  procesoMaquina: '',
  codigoMaterial: ''
}

const BLOQUE_VACIO: BloqueFormularioMp = { numeroOt: '', cliente: '', diseno: '', filas: [] }

function bloqueHtml(ctx: Contexto, bloque: BloqueFormularioMp): string {
  const filas = [...bloque.filas]
  while (filas.length < FILAS_POR_BLOQUE) filas.push(FILA_VACIA)

  const cabecera = `<tr ${altoFila(ALTO_FILA_OT_PT)}>
${celda(ctx, ANCHO.nroOt, estiloCampoCabecera(`Nº OT: ${bloque.numeroOt}`, ANCHO.nroOt, OFFSET_NRO_OT_PT), 1)}N&ordm; OT: ${escaparHtml(bloque.numeroOt)}</td>
${celda(ctx, ANCHO.cliente, estiloCampoCabecera(`CLIENTE: ${bloque.cliente}`, ANCHO.cliente, OFFSET_CLIENTE_PT), 2)}CLIENTE: ${escaparHtml(bloque.cliente)}</td>
${celda(ctx, ANCHO.diseno, estiloCampoCabecera(`DISEÑO: ${bloque.diseno}`, ANCHO.diseno, OFFSET_DISENO_PT, MAX_RENGLONES_DISENO), 6)}DISE&Ntilde;O: ${escaparHtml(bloque.diseno)}</td>
</tr>`

  const rotulos = `<tr ${altoFila(ALTO_FILA_ROTULOS_PT)}>
${celda(ctx, ANCHO.fecha, rotulo(OFFSET_FECHA_PT, 9), 1)}FECHA</td>
${celda(ctx, ANCHO.cantidad, rotulo(OFFSET_CANTIDAD_PT, 9), 2)}CANTIDAD ENTREGADA</td>
${celda(ctx, ANCHO.devol, rotulo(OFFSET_DEVOL_PT, 9), 1)}DEVOL.</td>
${celda(ctx, ANCHO.maq, rotulo(OFFSET_MAQ_PT, 9), 1)}MAQ.</td>
${celda(ctx, ANCHO.codMaterial, rotulo(OFFSET_COD_MATERIAL_PT, 9), 2)}COD.MATERIAL</td>
${celda(ctx, ANCHO.tintas, rotulo(OFFSET_TINTAS_PT, 5.6), 1)}TINTAS</td>
${celda(ctx, ANCHO.dig, rotulo(OFFSET_DIG_PT, 5.6), 1)}DIG.</td>
</tr>`

  // TINTAS y DIG. van siempre vacías: el sistema no guarda esos datos y en el
  // formulario en papel se llenan a mano.
  const cuerpo = filas
    .map(
      (f) => `<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, ANCHO.fecha, dato(8, true), 1)}${escaparHtml(f.fecha)}</td>
${celda(ctx, ANCHO.cantidad, dato(8), 2)}${escaparHtml(f.cantidadEntregada)}</td>
${celda(ctx, ANCHO.devol, dato(8, true), 1)}${escaparHtml(f.devolucion)}</td>
${celda(ctx, ANCHO.maq, estiloDatoQueEntra(f.procesoMaquina, ANCHO.maq), 1)}${escaparHtml(f.procesoMaquina)}</td>
${celda(ctx, ANCHO.codMaterial, estiloDatoQueEntra(f.codigoMaterial, ANCHO.codMaterial, false), 2)}${escaparHtml(f.codigoMaterial)}</td>
${celda(ctx, ANCHO.tintas, dato(8, true), 1)}</td>
${celda(ctx, ANCHO.dig, dato(8, true), 1)}</td>
</tr>`
    )
    .join('\n')

  return `${cabecera}\n${rotulos}\n${cuerpo}`
}

function paginaHtml(ctx: Contexto, bloques: BloqueFormularioMp[], ultima: boolean): string {
  const logo = ctx.paraWord ? URL_LOGO_MHTML : LOGO_ZEPOL_BASE64
  const conRelleno = [...bloques]
  // Siempre 3 bloques por hoja, como el formulario en papel: los que sobran
  // quedan en blanco para escribirlos a mano.
  while (conRelleno.length < BLOQUES_POR_PAGINA) conRelleno.push(BLOQUE_VACIO)

  const encabezado = `<tr ${altoFila(ALTO_ENCABEZADO_PT)}>
${celda(
    ctx,
    ANCHO.logo,
    // Arriba y no centrado: en el original la imagen arranca en y=39.0 y la
    // banda del encabezado en y=38.7.
    `padding-left:${OFFSET_LOGO_PT}pt;vertical-align:top;padding-top:${OFFSET_LOGO_SUP_PT}pt`,
    2
  )}<img src="${logo}" alt="Zepol" width="${Math.round(
    (LOGO_ANCHO_PT * 96) / 72
  )}" height="${Math.round((LOGO_ALTO_PT * 96) / 72)}" style="width:${LOGO_ANCHO_PT}pt;height:${LOGO_ALTO_PT}pt;display:block"></td>
${celda(ctx, ANCHO.titulo, rotulo(OFFSET_TITULO_PT, 8.6), 3)}FORMULARIO DE CONTROL DE ENTREGA DE MATERIAS PRIMAS</td>
${celda(ctx, ANCHO.codigo, rotulo(OFFSET_CODIGO_PT, 7.6), 1)}C&oacute;digo</td>
${celda(ctx, ANCHO.valorCodigo, rotulo(OFFSET_VALOR_CODIGO_PT, 6), 3)}P-LOG-001-F-01/V.2.0</td>
</tr>`

  // La banda de "ALMACENES-AMP" no tiene recuadro en el original: es texto
  // suelto entre el encabezado y el primer bloque.
  const banda = `<tr ${altoFila(ALTO_BANDA_ALMACENES_PT)}>
<td colspan="9" style="border:0;padding-left:${OFFSET_ALMACENES_PT}pt;font-size:7pt;font-weight:bold;vertical-align:middle">ALMACENES-AMP</td>
</tr>`

  const tabla = `<table cellpadding="0" cellspacing="0" border="0" width="${Math.round(
    (ANCHO_CONTENIDO_PT * 96) / 72
  )}" style="width:${ANCHO_CONTENIDO_PT}pt;border-collapse:collapse;table-layout:fixed;page-break-inside:avoid;font-family:Arial,Helvetica,sans-serif;color:#000;${ESTILOS_TABLA_WORD}">
<colgroup>${COLUMNAS_PT.map(
    (c) => `<col style="width:${c}pt" width="${Math.round((c * 96) / 72)}">`
  ).join('')}</colgroup>
<tbody>
${encabezado}
${banda}
${conRelleno.map((b) => bloqueHtml(ctx, b)).join('\n')}
</tbody>
</table>`

  // El salto va en un div aparte con estilo inline (no en la tabla ni en una
  // clase): Word no respeta page-break-after sobre un <table>, y de las clases
  // solo aplica la primera.
  const hoja = `<div class="hoja">\n${tabla}\n</div>`
  return ultima ? hoja : `${hoja}\n<div style="page-break-after:always"></div>`
}

/** Parte los bloques en hojas de 3, como el formulario en papel. */
function enPaginas(bloques: BloqueFormularioMp[]): BloqueFormularioMp[][] {
  if (bloques.length === 0) return [[]]
  const paginas: BloqueFormularioMp[][] = []
  for (let i = 0; i < bloques.length; i += BLOQUES_POR_PAGINA) {
    paginas.push(bloques.slice(i, i + BLOQUES_POR_PAGINA))
  }
  return paginas
}

/**
 * Genera el formulario completo como HTML independiente (carta horizontal).
 *
 * Es la única fuente del formato: la vista previa lo muestra en un iframe, la
 * exportación a PDF lo imprime con Electron y la de Word sale del mismo
 * armado. Lo que se ve en pantalla es literalmente lo que se exporta.
 */
export function generarHtmlFormularioMp(
  bloques: BloqueFormularioMp[] = [],
  opciones: { paraWord?: boolean; paraPantalla?: boolean } = {}
): string {
  const ctx: Contexto = { paraWord: opciones.paraWord ?? false }
  const paginas = enPaginas(bloques)
  const cuerpo = paginas
    .map((p, i) => paginaHtml(ctx, p, i === paginas.length - 1))
    .join('\n')

  const margenes = `${MARGEN_SUP_PT}pt ${MARGEN_DER_PT}pt ${MARGEN_INF_PT}pt ${MARGEN_IZQ_PT}pt`

  // Solo para la vista previa en pantalla: dibuja cada hoja como una carta
  // real (con sus márgenes) en vez de dejar las tablas pegadas una tras otra.
  // No se incluye en lo que se exporta — ahí los márgenes los pone el @page —
  // así que el contenido es idéntico, cambia nada más el marco en pantalla.
  const estilosPantalla = opciones.paraPantalla
    ? `
  body { background: #e5e5e5; }
  .hoja {
    width: ${PAGINA_ANCHO_PT}pt;
    height: ${PAGINA_ALTO_PT}pt;
    padding: ${margenes};
    margin: 0 auto ${SEPARACION_HOJAS_PT}pt;
    background: #fff;
    overflow: hidden;
  }
  .hoja:last-child { margin-bottom: 0; }
`
    : ''

  const estilos = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; }
  @page { size: ${PAGINA_ANCHO_PT}pt ${PAGINA_ALTO_PT}pt; margin: ${margenes}; }
  @page WordSection1 { size: ${PAGINA_ANCHO_PT}pt ${PAGINA_ALTO_PT}pt; margin: ${margenes}; mso-page-orientation: landscape; }
  div.WordSection1 { page: WordSection1; }
${estilosPantalla}`

  const espaciosWord = ctx.paraWord
    ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"'
    : ''
  const configWord = ctx.paraWord
    ? '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->'
    : ''

  return `<!DOCTYPE html>
<html lang="es"${espaciosWord}>
<head>
<meta charset="utf-8">
<title>Formulario de control de entrega de materias primas</title>
${configWord}
<style>${estilos}</style>
</head>
<body>
<div class="WordSection1">
${cuerpo}${
    ctx.paraWord ? '\n<p style="font-size:1pt;line-height:1pt;margin:0">&nbsp;</p>' : ''
  }
</div>
</body>
</html>`
}

export function generarDocumentoWordFormularioMp(bloques: BloqueFormularioMp[] = []): string {
  return envolverEnMhtml(generarHtmlFormularioMp(bloques, { paraWord: true }))
}

export const NOMBRE_ARCHIVO_FORMULARIO_MP = 'Formulario-control-entrega-MP'

// ---------------------------------------------------------------------------
// Armado de las filas a partir de los movimientos reales de una OT
// ---------------------------------------------------------------------------

export interface DatosOtFormularioMp {
  numeroOt: string
  cliente: string | null
  diseno: string | null
  entregas: Entrega[]
  devoluciones: Devolucion[]
}

/** Sin ceros de relleno: 100.000 -> "100", 49.990 -> "49.99". */
function numero(n: number): string {
  return String(Number(n.toFixed(3)))
}

// Marca en COD.MATERIAL de una fila que es un ingreso a almacén.
const PREFIJO_INGRESO_ALMACEN = 'INGRESO ALMACEN'

/** "Laminación/NORD"; si el movimiento no tiene proceso, solo la máquina. */
function procesoMaquinaDe(proceso: string | null | undefined, maquina: string): string {
  return proceso ? `${proceso}/${maquina}` : maquina
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/**
 * "la cantidad de bobinas y sus pesos, o puede ser el metraje": se muestra el
 * total con su unidad y, cuando son varias bobinas, el detalle de cada una.
 */
function textoCantidad(
  bobinas: number[],
  total: number,
  unidad: string,
  usaBobinas: boolean
): string {
  const totalTexto = `${numero(total)} ${unidad}`
  if (!usaBobinas || bobinas.length <= 1) return totalTexto
  return `${totalTexto}  (${bobinas.length} bob: ${bobinas.map(numero).join(' / ')})`
}

/**
 * Convierte los movimientos de cada OT en bloques del formulario.
 *
 * Una fila = una entrega, o una devolución. Cuando en la misma fecha se entregó
 * y se devolvió el MISMO material en la MISMA máquina, van en una sola fila (la
 * entrega en CANTIDAD ENTREGADA y lo devuelto en DEVOL.): se lee como "ese día
 * se entregaron 80 Kg y nos devolvieron 5" y no se gastan dos filas.
 *
 * Solo se juntan si coinciden fecha, material y máquina, porque la fila tiene
 * un único COD.MATERIAL y un único MAQ.: una devolución de otro material o de
 * otra máquina va en su propia fila. Con varias entregas iguales el mismo día,
 * la devolución se pega a la primera; y así sucesivamente si hay varias
 * devoluciones. (El sistema no guarda de qué entrega sale cada devolución, así
 * que esto es solo una regla de presentación.)
 *
 * Los ingresos a almacén (Devolucion.es_ingreso_produccion) también van, cada
 * uno en su propia fila: COD.MATERIAL lleva "INGRESO ALMACEN/<código>" y la
 * cantidad va en DEVOL. No son material que "nos devolvieron" sino material
 * fabricado que entra a stock, por eso se marcan y nunca se juntan con una
 * entrega, aunque coincidan fecha, material y máquina.
 *
 * Una OT con más de 5 filas ocupa varios bloques, repitiendo su encabezado —
 * igual que se haría en el formulario de papel.
 */
export function construirBloques(ots: DatosOtFormularioMp[]): BloqueFormularioMp[] {
  const bloques: BloqueFormularioMp[] = []

  for (const ot of ots) {
    type FilaConOrden = FilaFormularioMp & { orden: string }
    const claveDe = (fecha: string, material: string, maquina: string): string =>
      `${fecha}|${material}|${maquina}`

    const entregas = new Map<string, FilaConOrden[]>()
    for (const e of ot.entregas) {
      const clave = claveDe(e.fecha, e.codigo_mp_entregado, e.maquina)
      const fila: FilaConOrden = {
        orden: `${e.fecha} ${e.hora}`,
        fecha: fechaCorta(e.fecha),
        cantidadEntregada: textoCantidad(e.bobinas, e.total_entregado, e.unidad, e.usa_bobinas),
        devolucion: '',
        procesoMaquina: procesoMaquinaDe(e.proceso, e.maquina),
        codigoMaterial: e.codigo_mp_entregado
      }
      entregas.set(clave, [...(entregas.get(clave) ?? []), fila])
    }

    const sueltas: FilaConOrden[] = []
    for (const d of ot.devoluciones) {
      const maquina = d.maquina ?? ''
      if (d.es_ingreso_produccion) {
        // Un ingreso a almacén no es una devolución: es material fabricado que
        // entra a stock. Va en su propia fila (nunca se junta con una entrega)
        // y se distingue en COD.MATERIAL con el prefijo; la cantidad va en
        // DEVOL., que es la columna de "material que vuelve a almacén".
        sueltas.push({
          orden: `${d.fecha} ${d.hora}`,
          fecha: fechaCorta(d.fecha),
          cantidadEntregada: '',
          devolucion: textoCantidad(d.bobinas, d.total_devuelto, d.unidad, d.usa_bobinas),
          procesoMaquina: procesoMaquinaDe(d.proceso, maquina),
          codigoMaterial: `${PREFIJO_INGRESO_ALMACEN}/${d.codigo_mp}`
        })
        continue
      }
      const clave = claveDe(d.fecha, d.codigo_mp, maquina)
      const textoDevuelto = textoCantidad(d.bobinas, d.total_devuelto, d.unidad, d.usa_bobinas)
      // Se pega a la primera entrega de ese día/material/máquina que todavía no
      // tenga devolución; si no hay ninguna, queda en una fila propia.
      const destino = (entregas.get(clave) ?? []).find((f) => f.devolucion === '')
      if (destino) {
        destino.devolucion = textoDevuelto
      } else {
        sueltas.push({
          orden: `${d.fecha} ${d.hora}`,
          fecha: fechaCorta(d.fecha),
          cantidadEntregada: '',
          devolucion: textoDevuelto,
          procesoMaquina: procesoMaquinaDe(d.proceso, maquina),
          codigoMaterial: d.codigo_mp
        })
      }
    }

    const filas = [...[...entregas.values()].flat(), ...sueltas].sort((a, b) =>
      a.orden.localeCompare(b.orden)
    )

    const cabecera = {
      numeroOt: ot.numeroOt,
      cliente: ot.cliente ?? '',
      diseno: ot.diseno ?? ''
    }
    if (filas.length === 0) {
      bloques.push({ ...cabecera, filas: [] })
      continue
    }
    for (let i = 0; i < filas.length; i += FILAS_POR_BLOQUE) {
      bloques.push({ ...cabecera, filas: filas.slice(i, i + FILAS_POR_BLOQUE) })
    }
  }

  return bloques
}

export const MEDIDAS_FORMULARIO_MP = {
  anchoPt: PAGINA_ANCHO_PT,
  altoPt: PAGINA_ALTO_PT,
  margenSupPt: MARGEN_SUP_PT,
  margenIzqPt: MARGEN_IZQ_PT,
  margenDerPt: MARGEN_DER_PT,
  margenInfPt: MARGEN_INF_PT,
  filasPorBloque: FILAS_POR_BLOQUE,
  bloquesPorPagina: BLOQUES_POR_PAGINA,
  separacionHojasPt: SEPARACION_HOJAS_PT
}
