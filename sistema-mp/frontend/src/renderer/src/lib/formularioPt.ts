import { LOGO_ZEPOL_BASE64 } from './logoZepol'
import { altoFila, envolverEnMhtml, escaparHtml, URL_LOGO_MHTML } from './documentoWord'

// Réplica del formulario en papel "P-LOG-001-F-04/V.4.0" (FORMULARIO DE INGRESO
// DE PRODUCTOS TERMINADOS A ALMACENES).
//
// Las medidas salen de medir el formulario original: es una cuadrícula de 34
// columnas, con 9 filas de datos arriba y 36 filas de cuadrícula abajo para
// escribir a mano. Por eso los números de acá parecen arbitrarios — no lo son,
// cada uno corresponde a una línea real del formulario. Si hay que retocar el
// formato, mover estas constantes, no los colspans.
const COLUMNAS = 34
const ANCHO_CONTENIDO_PT = 519.1 // 7.21in — carta menos los márgenes laterales
const ANCHO_COLUMNA_PT = ANCHO_CONTENIDO_PT / COLUMNAS
const ANCHO_COLUMNA_PX = Math.round((ANCHO_COLUMNA_PT * 96) / 72)
const ALTO_ENCABEZADO_PT = 44.2
// Entre el encabezado y la línea de CLIENTE el original deja una banda angosta
// de cuadrícula; sin ella el bloque de arriba queda pegado.
const ALTO_BANDA_CUADRICULA_PT = 12.3
const ALTO_CLIENTE_PT = 21.3
const ALTO_FILA_DATOS_PT = 17.67
const ALTO_REGISTRAR_PT = 14.75
const ALTO_FILA_CUADRICULA_PT = 12.0
// Word siempre agrega un párrafo vacío después de una tabla. Con la altura
// exacta del original ese párrafo no entra y genera una segunda hoja en blanco,
// así que la versión .doc usa filas apenas más bajas para dejarle lugar. El PDF
// mantiene la medida real del formulario.
const ALTO_FILA_CUADRICULA_WORD_PT = 11.6
// 9 casillas: un numero de OT comun tiene 6 digitos, pero una OT con fuelle es
// "F-" + el numero (8 caracteres) y alguna llega a 9. Cada casilla es una
// columna de la grilla, asi que el bloque del N OT ocupa 4 (rotulo) + 9.
const CAJAS_NUMERO_OT = 9
// Columnas de la fila CLIENTE / N OT (suman COLUMNAS = 34). El nombre del
// cliente se queda con lo que sobra: 16.
const COLS_CLIENTE_ROTULO = 5
const COLS_OT_ROTULO = 4
const COLS_CLIENTE_VALOR = COLUMNAS - COLS_CLIENTE_ROTULO - COLS_OT_ROTULO - CAJAS_NUMERO_OT


const FINA = '0.75pt solid #444'
const GRUESA = '1pt solid #000'

// Estilos base de toda celda. En Word van inline (ver `celda`), porque su
// importador de HTML no aplica reglas de descendencia de forma confiable.
const BASE_CELDA = 'padding:0;vertical-align:middle;line-height:1.05;font-size:8.5pt'

/**
 * Un estilo por celda, nunca dos clases juntas: **Word solo aplica la primera
 * clase** de un `class="a b"`, así que `class="b rot"` perdía la negrita. Cada
 * entrada de acá es autosuficiente y se usa como clase (navegador) o inline
 * (Word) desde `celda()`.
 */
const ESTILOS_CELDA: Record<string, string> = {
  // cuadrícula fina de la hoja (el gris está medido del formulario original)
  g: `border:${FINA}`,
  'g-top': `border:${FINA};border-top:${GRUESA}`,
  // recuadro del formulario
  b: `border:${GRUESA}`,
  titulo: `border:${GRUESA};font-size:13pt;font-weight:bold;text-align:center;line-height:1.12`,
  'codigo-rotulo': `border:${GRUESA};font-size:10pt;text-align:center`,
  'codigo-valor': `border:${GRUESA};font-size:9.5pt;font-weight:bold;text-align:center`,
  'cliente-rotulo': 'font-size:13pt;font-weight:bold;padding-left:4pt;vertical-align:bottom;white-space:nowrap',
  'cliente-valor': `border-bottom:1.5pt solid #000;vertical-align:bottom;font-size:11pt;padding:0 4pt 2pt 4pt`,
  // Nombres largos: se achica la letra y, en el ultimo caso, se deja partir en
  // dos renglones. Los nombres reales llegan a 62 caracteres.
  'cliente-valor-medio': `border-bottom:1.5pt solid #000;vertical-align:bottom;font-size:9pt;padding:0 4pt 2pt 4pt`,
  'cliente-valor-chico': `border-bottom:1.5pt solid #000;vertical-align:bottom;font-size:7.5pt;line-height:1.05;padding:0 4pt 2pt 4pt`,
  'ot-rotulo': 'font-size:13pt;font-weight:bold;text-align:right;padding-right:3pt;vertical-align:bottom;white-space:nowrap',
  ot: `border:${GRUESA};text-align:center;font-size:12pt;font-weight:bold`,
  'cabecera-col': `border:${FINA};border-top:${GRUESA};font-size:9.5pt;font-weight:bold;text-align:center`,
  tem: 'font-size:9.5pt;font-weight:bold;padding-left:3pt',
  // En las filas TEM el original separa PRODUCTO de MB con una línea fina, no
  // con el trazo grueso del resto. Las dos juntas porque con border-collapse
  // gana el borde más grueso entre celdas vecinas.
  'celda-producto': `border:${GRUESA};border-right:${FINA};padding:0 3pt`,
  'celda-mb': `border:${GRUESA};border-left:${FINA};padding:0 3pt;text-align:center`,
  // 8pt y nowrap: a 8.5pt "Fecha Pedido:" y "Entrega Total:" no entran en sus
  // 4 columnas y Word los parte en dos renglones.
  'rot-b': `border:${GRUESA};font-size:8pt;font-weight:bold;padding-left:3pt;white-space:nowrap`,
  'rot-der': 'font-size:8.5pt;font-weight:bold;text-align:right;padding-right:3pt',
  'dato-b': `border:${GRUESA};padding:0 3pt`,
  'pedido-total': 'font-size:9pt;font-weight:bold;text-align:right;padding-right:5pt',
  total: `border:${GRUESA};font-size:10pt;font-weight:bold;text-align:center`,
  registrar: `border:${GRUESA};font-size:8.5pt;padding-left:3pt`,
  // 7.5pt y no 8: "Verificado Por" no entra a 8pt (en el original también sale
  // cortado, pero no hay razón para copiar el recorte).
  'pie-b': `border:${GRUESA};font-size:7.5pt;font-weight:bold;padding-left:2pt`,
  'pie-franja': `border-top:${GRUESA};border-bottom:${GRUESA};font-size:7.5pt;font-weight:bold;text-align:center`,
  franja: `border-top:${GRUESA};border-bottom:${GRUESA}`
}

export interface ItemFormularioPt {
  codigo?: string
  producto?: string
  mb?: string
}

export interface DatosFormularioPt {
  cliente?: string
  numeroOt?: string
  items?: ItemFormularioPt[]
  pedidoTotal?: string
  fechaPedido?: string
  fechaEntrega?: string
  comercial?: string
  ciudad?: string
  moneda?: string
  nuevo?: string
  rcArte?: string
  muestra?: string
  entregaTotal?: string
  condiciones?: string
  observaciones?: string
}

const esc = escaparHtml

interface Contexto {
  paraWord: boolean
}

/** Abre un `<td>`: clase en el navegador, estilo inline en Word. */
function celda(ctx: Contexto, estilo: string, colspan = 1, extra = ''): string {
  const span = colspan > 1 ? ` colspan="${colspan}"` : ''
  const ancho = ` width="${ANCHO_COLUMNA_PX * colspan}"`
  const atributo = ctx.paraWord
    ? ` style="${BASE_CELDA};${ESTILOS_CELDA[estilo]}"`
    : ` class="${estilo}"`
  return `<td${span}${ancho}${atributo}${extra ? ' ' + extra : ''}>`
}

function celdasCuadricula(ctx: Contexto, cantidad: number, estilo = 'g'): string {
  return `${celda(ctx, estilo)}</td>`.repeat(cantidad)
}

/**
 * Las casillas del Nº OT, una por carácter, de izquierda a derecha como se
 * escribiría a mano. Si el número no entra (más de 9 caracteres) se muestra
 * completo en una sola celda: cortarlo en silencio dejaría en el papel un
 * número de OT equivocado.
 */
function casillasNumeroOt(ctx: Contexto, numeroOt: string | undefined): string {
  const texto = (numeroOt ?? '').trim()
  if (texto.length > CAJAS_NUMERO_OT) {
    return `${celda(ctx, 'ot', CAJAS_NUMERO_OT)}${esc(texto)}</td>`
  }
  return Array.from(
    { length: CAJAS_NUMERO_OT },
    (_, i) => `${celda(ctx, 'ot')}${esc(texto[i] ?? '')}</td>`
  ).join('')
}

/** Tamaño del nombre del cliente según cuánto ocupa en su celda. */
function estiloClienteValor(cliente: string | undefined): string {
  const largo = (cliente ?? '').length
  if (largo <= 34) return 'cliente-valor'
  if (largo <= 42) return 'cliente-valor-medio'
  return 'cliente-valor-chico'
}

/** Una fila TEM: etiqueta + las cajas CODIGO / PRODUCTO / MB. */
function filaTem(
  ctx: Contexto,
  indice: number,
  item: ItemFormularioPt,
  etiquetaDerecha: string,
  valorDerecha: string
): string {
  return `<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'tem', 3)}TEM ${indice}</td>
${celda(ctx, 'dato-b', 3)}${esc(item.codigo)}</td>
${celda(ctx, 'celda-producto', 15)}${esc(item.producto)}</td>
${celda(ctx, 'celda-mb', 3)}${esc(item.mb)}</td>
${celda(ctx, 'rot-b', 4)}${etiquetaDerecha}</td>
${celda(ctx, 'dato-b', 6)}${esc(valorDerecha)}</td>
</tr>`
}

function filasCuadricula(ctx: Contexto): string {
  const filas: string[] = []
  const alto = altoFila(
    ctx.paraWord ? ALTO_FILA_CUADRICULA_WORD_PT : ALTO_FILA_CUADRICULA_PT
  )

  // Filas 1-28: cuadrícula limpia para escribir a mano.
  for (let i = 0; i < 28; i++) {
    filas.push(`<tr ${alto}>${celdasCuadricula(ctx, COLUMNAS)}</tr>`)
  }

  filas.push(`<tr ${alto}>${celdasCuadricula(ctx, 24)}
${celda(ctx, 'pie-b', 4)}Verificado Por</td>
${celda(ctx, 'b', 6)}</td>
</tr>`)

  filas.push(`<tr ${alto}>${celdasCuadricula(ctx, 24)}
${celda(ctx, 'pie-b', 4)}OT Concluida:</td>
${celda(ctx, 'franja')}</td>
${celda(ctx, 'pie-franja')}Si</td>
${celda(ctx, 'b')}</td>
${celda(ctx, 'pie-franja')}No</td>
${celda(ctx, 'b', 2)}</td>
</tr>`)

  // Recuadro alto en blanco (firma / sello): 3 filas de cuadrícula.
  filas.push(
    `<tr ${alto}>${celdasCuadricula(ctx, 24)}${celda(ctx, 'b', 10, 'rowspan="3"')}</td></tr>`
  )
  filas.push(`<tr ${alto}>${celdasCuadricula(ctx, 24)}</tr>`)
  filas.push(`<tr ${alto}>${celdasCuadricula(ctx, 24)}</tr>`)

  filas.push(`<tr ${alto}>${celdasCuadricula(ctx, 24)}
${celda(ctx, 'pie-b', 2)}Fecha:</td>
${celda(ctx, 'b', 3)}</td>
${celda(ctx, 'pie-b', 2)}Hora:</td>
${celda(ctx, 'b', 3)}</td>
</tr>`)

  filas.push(`<tr ${alto}>${celdasCuadricula(ctx, 24)}
${celda(ctx, 'pie-b', 2)}Area:</td>
${celda(ctx, 'b', 8)}</td>
</tr>`)

  filas.push(`<tr ${alto}>${celdasCuadricula(ctx, COLUMNAS)}</tr>`)

  return filas.join('\n')
}

const ESTILOS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; }
  @page { size: 8.5in 11in; margin: 0.72in 0.645in; }
  @page WordSection1 { size: 8.5in 11in; margin: 0.72in 0.645in; }
  div.WordSection1 { page: WordSection1; }
  .formulario {
    width: ${ANCHO_CONTENIDO_PT}pt;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 8.5pt;
    /* Word ignora table-layout y mete su propio espaciado entre celdas: estas
       son el equivalente que sí entiende. Los navegadores las ignoran. */
    mso-table-layout-alt: fixed;
    mso-table-lspace: 0pt;
    mso-table-rspace: 0pt;
    mso-padding-alt: 0in 0in 0in 0in;
  }
  .formulario td { ${BASE_CELDA}; overflow: hidden; mso-line-height-rule: exactly; }
${Object.entries(ESTILOS_CELDA)
  .map(([nombre, decl]) => `  .formulario td.${nombre} { ${decl}; }`)
  .join('\n')}
  /* Medido del formulario original: el logo ocupa ~36pt de alto de la banda
     del encabezado (44.2pt). Ancho y alto van los dos fijos, en la relacion
     real del logo (125x103); si solo se fija el alto, Word lo estira al ancho
     de la celda. */
  .logo { display: block; margin: 0 auto; width: 43.7pt; height: 36pt; }
`

/**
 * Genera el formulario completo como HTML independiente (tamaño carta).
 *
 * Es la única fuente del formato: la vista previa lo muestra en un iframe, la
 * exportación a PDF lo imprime con Electron y la de Word sale del mismo armado.
 * Así lo que se ve en pantalla es literalmente lo que se exporta.
 */
export function generarHtmlFormularioPt(
  datos: DatosFormularioPt = {},
  opciones: { paraWord?: boolean } = {}
): string {
  const ctx: Contexto = { paraWord: opciones.paraWord ?? false }
  const items = datos.items ?? []
  const item = (i: number): ItemFormularioPt => items[i] ?? {}
  const logo = ctx.paraWord ? URL_LOGO_MHTML : LOGO_ZEPOL_BASE64

  const cuerpo = `<table class="formulario" cellpadding="0" cellspacing="0" border="0" width="${Math.round(
    (ANCHO_CONTENIDO_PT * 96) / 72
  )}">
<colgroup>${`<col style="width:${ANCHO_COLUMNA_PT}pt" width="${ANCHO_COLUMNA_PX}">`.repeat(
    COLUMNAS
  )}</colgroup>
<tbody>
<tr ${altoFila(ALTO_ENCABEZADO_PT)}>
${celda(
    ctx,
    'b',
    5
  )}<img class="logo" src="${logo}" alt="Zepol" width="58" height="48"></td>
${celda(ctx, 'titulo', 19)}FORMULARIO DE INGRESO DE<br>PRODUCTOS TERMINADOS A ALMACENES</td>
${celda(ctx, 'codigo-rotulo', 3)}C&oacute;digo</td>
${celda(ctx, 'codigo-valor', 7)}P-LOG-001-F-04/V.4.0</td>
</tr>
<tr ${altoFila(ALTO_BANDA_CUADRICULA_PT)}>${celdasCuadricula(ctx, COLUMNAS)}</tr>
<tr ${altoFila(ALTO_CLIENTE_PT)}>
${celda(ctx, 'cliente-rotulo', COLS_CLIENTE_ROTULO)}CLIENTE:</td>
${celda(ctx, estiloClienteValor(datos.cliente), COLS_CLIENTE_VALOR)}${esc(datos.cliente)}</td>
${celda(ctx, 'ot-rotulo', COLS_OT_ROTULO)}N&ordm; OT.:</td>
${casillasNumeroOt(ctx, datos.numeroOt)}
</tr>
<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celdasCuadricula(ctx, 3, 'g-top')}
${celda(ctx, 'cabecera-col', 3)}CODIGO</td>
${celda(ctx, 'cabecera-col', 15)}PRODUCTO</td>
${celda(ctx, 'cabecera-col', 3)}MB</td>
${celda(ctx, 'rot-b', 4)}Fecha Pedido:</td>
${celda(ctx, 'dato-b', 6)}${esc(datos.fechaPedido)}</td>
</tr>
${filaTem(ctx, 1, item(0), 'Fecha Entrega', datos.fechaEntrega ?? '')}
${filaTem(ctx, 2, item(1), 'Comercial:', datos.comercial ?? '')}
${filaTem(ctx, 3, item(2), 'Ciudad:', datos.ciudad ?? '')}
${filaTem(ctx, 4, item(3), 'Moneda:', datos.moneda ?? '')}
${filaTem(ctx, 5, item(4), 'Nuevo:', datos.nuevo ?? '')}
<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celdasCuadricula(ctx, 16)}
${celda(ctx, 'pedido-total', 5)}Pedido Total</td>
${celda(ctx, 'total', 3)}${esc(datos.pedidoTotal) || '0.00'}</td>
${celda(ctx, 'rot-b', 4)}Rc-Arte:</td>
${celda(ctx, 'dato-b', 6)}${esc(datos.rcArte)}</td>
</tr>
<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'rot-der', 5)}Condiciones:</td>
${celda(ctx, 'dato-b', 19)}${esc(datos.condiciones)}</td>
${celda(ctx, 'rot-b', 4)}Muestra:</td>
${celda(ctx, 'dato-b', 6)}${esc(datos.muestra)}</td>
</tr>
<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'rot-der', 5)}Observaciones:</td>
${celda(ctx, 'dato-b', 19)}${esc(datos.observaciones)}</td>
${celda(ctx, 'rot-b', 4)}Entrega Total:</td>
${celda(ctx, 'dato-b', 6)}${esc(datos.entregaTotal)}</td>
</tr>
<tr ${altoFila(ALTO_REGISTRAR_PT)}>
${celda(ctx, 'registrar', COLUMNAS)}Registrar Fecha, Cantidades y Pesos en letra legible:</td>
</tr>
${filasCuadricula(ctx)}
</tbody>
</table>`

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
<title>Formulario de ingreso de productos terminados a almacenes</title>
${configWord}
<style>${ESTILOS}</style>
</head>
<body>
<div class="WordSection1">
${cuerpo}${
    ctx.paraWord
      ? '\n<p style="font-size:1pt;line-height:1pt;margin:0">&nbsp;</p>'
      : ''
  }
</div>
</body>
</html>`
}

export const NOMBRE_ARCHIVO_FORMULARIO_PT = 'Formulario-ingreso-PT-almacenes'

/**
 * Genera el archivo que se guarda como .doc.
 *
 * Va en MHTML y no en HTML suelto porque Word **no** muestra imágenes en
 * `data:` URI (el logo sale como ícono de imagen rota). MHTML adjunta el PNG
 * como una parte MIME aparte, que Word sí resuelve, y sigue siendo un único
 * archivo. Word lo abre por contenido, no le importa la extensión .doc.
 */
export function generarDocumentoWordFormularioPt(datos: DatosFormularioPt = {}): string {
  return envolverEnMhtml(generarHtmlFormularioPt(datos, { paraWord: true }))
}
