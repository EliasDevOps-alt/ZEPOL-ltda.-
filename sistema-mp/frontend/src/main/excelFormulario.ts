import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { unlinkSync, writeFileSync } from 'fs'
import ExcelJS from 'exceljs'

// Exportación de un formulario (el mismo HTML que se ve en pantalla y sale en PDF
// y Word) a un libro de Excel editable: una hoja por cada tabla del HTML.
//
// No se rearma el formulario a mano en celdas: se carga el HTML en una ventana
// oculta y se lee cómo quedó dibujado (merges, anchos, altos, bordes, fuentes,
// alineación) con getComputedStyle. Así Excel siempre muestra lo mismo que el
// papel, también cuando cambia el formulario (más hojas de pesajes, datos
// corregidos a mano), sin mantener un segundo diseño.

export type OrientacionHoja = 'portrait' | 'landscape'

interface BordeModelo {
  /** Grosor en puntos. */
  w: number
  color: string
}

interface CeldaModelo {
  col: number
  colspan: number
  rowspan: number
  texto: string
  fuente: string
  tam: number
  negrita: boolean
  cursiva: boolean
  color: string
  fondo: string | null
  alineH: string
  alineV: string
  envolver: boolean
  bordes: { top: BordeModelo | null; left: BordeModelo | null; bottom: BordeModelo | null; right: BordeModelo | null }
  imagen: { src: string; ancho: number; alto: number } | null
}

interface FilaModelo {
  /** Alto en puntos. */
  alto: number
  celdas: CeldaModelo[]
}

interface TablaModelo {
  /** Ancho de cada columna en píxeles de pantalla. */
  anchos: number[]
  filas: FilaModelo[]
}

// Se ejecuta DENTRO de la ventana oculta, ya con el HTML cargado.
const LEER_TABLAS = `(() => {
  const PT = 0.75
  const borde = (cs, lado) => {
    const w = parseFloat(cs['border' + lado + 'Width'])
    const estilo = cs['border' + lado + 'Style']
    if (!(w > 0) || estilo === 'none' || estilo === 'hidden') return null
    return { w: w * PT, color: cs['border' + lado + 'Color'] }
  }
  return Array.from(document.querySelectorAll('table')).map((tabla) => {
    const ocupado = []
    const anchos = []
    const filas = Array.from(tabla.rows).map((tr, r) => {
      ocupado[r] = ocupado[r] || []
      let col = 0
      const celdas = []
      for (const td of Array.from(tr.cells)) {
        while (ocupado[r][col]) col++
        const colspan = td.colSpan || 1
        const rowspan = td.rowSpan || 1
        for (let i = 0; i < rowspan; i++) {
          ocupado[r + i] = ocupado[r + i] || []
          for (let j = 0; j < colspan; j++) ocupado[r + i][col + j] = true
        }
        const cs = getComputedStyle(td)
        const rect = td.getBoundingClientRect()
        if (colspan === 1 && anchos[col] === undefined) anchos[col] = rect.width
        const img = td.querySelector('img')
        const imgRect = img ? img.getBoundingClientRect() : null
        const fondo = cs.backgroundColor
        celdas.push({
          col, colspan, rowspan,
          texto: (td.innerText || '').replace(/\\u00a0/g, ' ').replace(/\\s+$/, ''),
          fuente: (cs.fontFamily.split(',')[0] || 'Arial').replace(/["']/g, '').trim(),
          tam: parseFloat(cs.fontSize) * PT,
          negrita: cs.fontWeight === 'bold' || parseInt(cs.fontWeight, 10) >= 600,
          cursiva: cs.fontStyle === 'italic',
          color: cs.color,
          fondo: fondo && fondo !== 'rgba(0, 0, 0, 0)' && fondo !== 'transparent' ? fondo : null,
          alineH: cs.textAlign,
          alineV: cs.verticalAlign,
          envolver: cs.whiteSpace !== 'nowrap',
          bordes: { top: borde(cs, 'Top'), left: borde(cs, 'Left'), bottom: borde(cs, 'Bottom'), right: borde(cs, 'Right') },
          imagen: img ? { src: img.src, ancho: imgRect.width, alto: imgRect.height } : null
        })
        col += colspan
      }
      return { alto: tr.getBoundingClientRect().height * PT, celdas }
    })
    // Los anchos de columna salen de las definiciones <col> de la tabla (el formulario las
    // trae todas): medir las celdas no alcanza cuando todos los renglones usan celdas combinadas.
    const definidos = Array.from(tabla.querySelectorAll('col')).map((c) => parseFloat(getComputedStyle(c).width))
    const total = Math.max(0, ...filas.flatMap((f) => f.celdas.map((c) => c.col + c.colspan)))
    if (definidos.length >= total && definidos.slice(0, total).every((w) => w > 0)) {
      for (let c = 0; c < total; c++) anchos[c] = definidos[c]
    }
    // Una columna sin <col> ni celda de un solo casillero que la mida: ancho por defecto.
    for (let c = 0; c < total; c++) {
      if (anchos[c] === undefined) anchos[c] = 40
    }
    return { anchos: anchos.slice(0, total), filas }
  })
})()`

/** Carga el HTML en una ventana oculta y devuelve cómo quedaron dibujadas sus tablas. */
async function leerTablas(html: string): Promise<TablaModelo[]> {
  // Por archivo temporal, igual que el PDF: el logo va embebido en base64.
  const ruta = join(app.getPath('temp'), `zepol-excel-${Date.now()}.html`)
  writeFileSync(ruta, html, 'utf-8')
  const ventana = new BrowserWindow({ show: false, width: 1400, height: 1800, webPreferences: { sandbox: false } })
  try {
    await ventana.loadFile(ruta)
    return (await ventana.webContents.executeJavaScript(LEER_TABLAS)) as TablaModelo[]
  } finally {
    ventana.destroy()
    try {
      unlinkSync(ruta)
    } catch {
      // Un temporal que no se pudo borrar no justifica romper la exportación.
    }
  }
}

/** "rgb(12, 34, 56)" / "rgba(...)" → "FF0C2238" (ARGB, como pide Excel). */
function argb(css: string): string {
  const m = css.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return 'FF000000'
  return 'FF' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** Grosor del borde en puntos → estilo de borde de Excel (thin ≈ 0.75 pt, medium ≈ 1.5 pt, thick ≈ 2.25 pt). */
function estiloBorde(w: number): ExcelJS.BorderStyle {
  if (w < 1.25) return 'thin'
  if (w < 2) return 'medium'
  return 'thick'
}

function bordeExcel(b: BordeModelo | null): Partial<ExcelJS.Border> | undefined {
  return b ? { style: estiloBorde(b.w), color: { argb: argb(b.color) } } : undefined
}

function horizontal(alineH: string): 'left' | 'center' | 'right' {
  if (alineH === 'center') return 'center'
  if (alineH === 'right' || alineH === 'end') return 'right'
  return 'left'
}

function vertical(alineV: string): 'top' | 'middle' | 'bottom' {
  if (alineV === 'top') return 'top'
  if (alineV === 'middle') return 'middle'
  return 'bottom'
}

/** Excel dibuja un ancho de columna en "caracteres"; ~7 px de pantalla cada uno. */
const PX_POR_CARACTER = 7

/**
 * HTML del formulario → archivo .xlsx. Cada tabla del HTML es una hoja, con la
 * hoja carta (y sus márgenes) lista para imprimir en una página.
 */
export async function construirExcelDesdeHtml(html: string, orientacion: OrientacionHoja): Promise<Buffer> {
  const tablas = await leerTablas(html)
  if (tablas.length === 0) throw new Error('El formulario no tiene ninguna tabla para exportar.')

  const libro = new ExcelJS.Workbook()
  libro.creator = 'ZEPOL Control MP'
  libro.created = new Date()

  tablas.forEach((tabla, indice) => {
    const hoja = libro.addWorksheet(tablas.length === 1 ? 'Formulario' : `Hoja ${indice + 1}`, {
      views: [{ showGridLines: false }],
      pageSetup: {
        paperSize: 1 as ExcelJS.PaperSize, // Carta (el tipo de exceljs no trae este valor)
        orientation: orientacion,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        horizontalCentered: true,
        margins: { left: 0.645, right: 0.645, top: 0.72, bottom: 0.72, header: 0.3, footer: 0.3 }
      }
    })
    tabla.anchos.forEach((px, i) => {
      hoja.getColumn(i + 1).width = Math.max(1, px / PX_POR_CARACTER)
    })

    tabla.filas.forEach((fila, r) => {
      const filaExcel = hoja.getRow(r + 1)
      filaExcel.height = Math.min(409, Math.max(4, fila.alto))
      for (const c of fila.celdas) {
        const fila0 = r + 1
        const col0 = c.col + 1
        if (c.colspan > 1 || c.rowspan > 1) hoja.mergeCells(fila0, col0, fila0 + c.rowspan - 1, col0 + c.colspan - 1)
        const celda = hoja.getCell(fila0, col0)
        celda.value = c.texto === '' ? null : c.texto
        celda.font = {
          name: c.fuente,
          size: Math.round(c.tam * 2) / 2,
          bold: c.negrita,
          italic: c.cursiva,
          color: { argb: argb(c.color) }
        }
        // Las celdas de una sola línea achican la letra solo si el texto no entra
        // ("reducir hasta ajustar"), así nada queda cortado; las de varias líneas se ajustan al alto.
        celda.alignment = {
          horizontal: horizontal(c.alineH),
          vertical: vertical(c.alineV),
          wrapText: c.envolver,
          shrinkToFit: !c.envolver
        }
        if (c.fondo) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(c.fondo) } }
        const bordes = {
          top: bordeExcel(c.bordes.top),
          left: bordeExcel(c.bordes.left),
          bottom: bordeExcel(c.bordes.bottom),
          right: bordeExcel(c.bordes.right)
        }
        celda.border = bordes
        // El borde de una celda combinada se dibuja con las celdas del perímetro:
        // se lo da a cada una de las que quedan debajo / a la derecha también.
        if (c.colspan > 1 || c.rowspan > 1) {
          for (let rr = 0; rr < c.rowspan; rr++) {
            for (let cc = 0; cc < c.colspan; cc++) {
              hoja.getCell(fila0 + rr, col0 + cc).border = {
                top: rr === 0 ? bordes.top : undefined,
                bottom: rr === c.rowspan - 1 ? bordes.bottom : undefined,
                left: cc === 0 ? bordes.left : undefined,
                right: cc === c.colspan - 1 ? bordes.right : undefined
              }
            }
          }
        }
        if (c.imagen) {
          const coincidencia = c.imagen.src.match(/^data:image\/(png|jpe?g|gif);base64,(.+)$/)
          if (coincidencia) {
            const extension = coincidencia[1] === 'png' ? 'png' : coincidencia[1] === 'gif' ? 'gif' : 'jpeg'
            const id = libro.addImage({ base64: coincidencia[2], extension })
            // Centrada en la celda (o celdas combinadas) donde está.
            const anchoCelda = tabla.anchos.slice(c.col, c.col + c.colspan).reduce((a, b) => a + b, 0)
            const altoCelda = tabla.filas.slice(r, r + c.rowspan).reduce((a, f) => a + (f.alto / 0.75), 0)
            hoja.addImage(id, {
              tl: {
                col: c.col + Math.max(0, (anchoCelda - c.imagen.ancho) / 2) / (anchoCelda / c.colspan),
                row: r + Math.max(0, (altoCelda - c.imagen.alto) / 2) / (altoCelda / c.rowspan)
              },
              ext: { width: c.imagen.ancho, height: c.imagen.alto }
            })
          }
        }
      }
    })
  })

  return Buffer.from(await libro.xlsx.writeBuffer())
}
