import JsBarcode from 'jsbarcode'
import { escaparHtml as esc } from './documentoWord'
import { formatearFecha } from './fechas'
import { LOGO_ZEPOL_BASE64 } from './logoZepol'
import type { PesajePt, ProductoTerminado } from './types'

// Etiqueta de una bobina o un paquete de producto terminado (una por pesaje),
// réplica de la que se armaba en Excel. Igual que los formularios, sale de un
// único HTML: la vista previa lo muestra en un iframe y el PDF lo imprime
// Electron respetando el @page de acá (preferCSSPageSize).
//
// Todavía no hay impresora de etiquetas: 100 × 70 mm es un tamaño común de
// rollo térmico con la misma proporción que la etiqueta original. Cuando se
// compre la impresora, ajustar estas dos constantes al tamaño real.
export const ANCHO_ETIQUETA_MM = 100
export const ALTO_ETIQUETA_MM = 70

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
    // Se pesa contra toda la OT, sin distinguir de qué ítem es cada paquete:
    // con varios productos van todos.
    producto: pt.items
      .map((item) => item.descripcion_producto)
      .filter(Boolean)
      .join(' / '),
    // Todavía no se sabe de dónde sale (en la etiqueta original decía "200 Gg").
    descripcion: '',
    numero: pesaje.numero,
    // Bolsas: las del paquete. Bobinas: el peso neto (pedido de Elias).
    cantidadEnvases:
      pesaje.cantidad !== null
        ? `${pesaje.cantidad.toLocaleString('en-US', { useGrouping: false })} bolsas`
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

/** Letra más chica para textos largos, para que entren en su celda. */
function claseLargo(texto: string, normal: number, chico: number): string {
  if (texto.length > chico) return ' muy-largo'
  if (texto.length > normal) return ' largo'
  return ''
}

function htmlEtiqueta(d: DatosEtiquetaPt): string {
  return `<div class="etiqueta">
<table class="cabecera"><tr>
<td class="logo"><img src="${LOGO_ZEPOL_BASE64}" alt="Zepol"></td>
<td class="empresa"><div>ZEPOL LTDA.</div><div>Almacén Producto Terminado</div></td>
</tr></table>
<table class="datos">
<colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"></colgroup>
<tr><th>OT:</th><td class="ot">${esc(d.numeroOt)}</td><th>FECHA:</th><td>${esc(d.fecha)}</td></tr>
<tr><th>CLIENTE:</th><td class="texto${claseLargo(d.cliente, 24, 34)}">${esc(d.cliente)}</td><th>PESADOR:</th><td>${esc(d.pesador)}</td></tr>
<tr><th rowspan="2">PRODUCTO:</th><td rowspan="2" class="texto producto${claseLargo(d.producto, 50, 80)}">${esc(d.producto)}</td><th>DESCRIPCIÓN:</th><td>${esc(d.descripcion)}</td></tr>
<tr><th>PESO BRUTO:</th><td>${esc(d.pesoBruto)}</td></tr>
<tr><th>N° BOB / PAQ:</th><td>${d.numero}</td><th>TARA:</th><td>${esc(d.tara)}</td></tr>
<tr><th>CANT. ENVASES:</th><td>${esc(d.cantidadEnvases)}</td><th>PESO NETO:</th><td class="neto">${esc(d.pesoNeto)}</td></tr>
</table>
<div class="codigo">${svgCodigoBarras(d.codigoBarras)}<div class="codigo-texto">${esc(d.codigoBarras)}</div></div>
<div class="leyenda">${esc(LEYENDA_ETIQUETA_PT)}</div>
</div>`
}

const ESTILOS = `
  * { box-sizing: border-box; }
  @page { size: ${ANCHO_ETIQUETA_MM}mm ${ALTO_ETIQUETA_MM}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Calibri, Arial, Helvetica, sans-serif; color: #000; }
  .etiqueta {
    width: ${ANCHO_ETIQUETA_MM}mm; height: ${ALTO_ETIQUETA_MM}mm; overflow: hidden;
    padding: 2mm 2.5mm; border: 0.3mm solid #000;
    display: flex; flex-direction: column;
    page-break-after: always; break-after: page;
  }
  .etiqueta:last-child { page-break-after: auto; break-after: auto; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  .cabecera td { padding: 0; vertical-align: middle; }
  .cabecera .logo { width: 22mm; text-align: center; }
  .cabecera .logo img { height: 11mm; width: auto; display: inline-block; }
  .cabecera .empresa { font-weight: bold; font-size: 10.5pt; line-height: 1.25; padding-left: 2mm; }
  .datos { margin-top: 1mm; font-size: 8pt; line-height: 1.15; }
  .datos col.c1 { width: 22mm; }
  .datos col.c3 { width: 21mm; }
  .datos col.c4 { width: 17mm; }
  .datos th { text-align: left; font-weight: bold; white-space: nowrap; padding: 0.35mm 0; vertical-align: top; }
  .datos td { padding: 0.35mm 1mm 0.35mm 0; vertical-align: top; white-space: nowrap; overflow: hidden; }
  .datos td.texto { white-space: normal; overflow-wrap: anywhere; }
  .datos td.producto { max-height: 7.5mm; }
  .datos td.largo { font-size: 7pt; }
  .datos td.muy-largo { font-size: 6pt; line-height: 1.1; }
  .datos td.ot, .datos td.neto { font-weight: bold; }
  .codigo { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 0; }
  .codigo .barras { width: 62mm; height: 10mm; display: block; }
  .codigo-texto { font-size: 8.5pt; letter-spacing: 0.4mm; margin-top: 0.4mm; }
  .leyenda { font-size: 6.5pt; line-height: 1.2; text-align: center; }
`

/** HTML con una etiqueta por página (una o varias, para reimprimir en lote). */
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
