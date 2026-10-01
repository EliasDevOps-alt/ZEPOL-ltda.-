import { LOGO_ZEPOL_BASE64 } from './logoZepol'
import { formatearFecha } from './fechas'
import { redondearPeso } from './utils'
import type { PesajesPt, ProductoTerminado, UnidadPt } from './types'
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
// Carta menos los márgenes laterales son 519.1pt, pero la tabla usa 514: con
// border-collapse el trazo grueso de los bordes se sale medio ancho por cada
// lado, y con la tabla justo al ancho útil el borde derecho salía cortado (en
// Word y en el PDF). Esos ~5pt de holgura, con la tabla centrada, lo evitan.
const ANCHO_CONTENIDO_PT = 514
const ANCHO_COLUMNA_PT = ANCHO_CONTENIDO_PT / COLUMNAS
const ANCHO_COLUMNA_PX = Math.round((ANCHO_COLUMNA_PT * 96) / 72)
const ALTO_ENCABEZADO_PT = 44.2
const ALTO_CLIENTE_PT = 34
const ALTO_FILA_DATOS_PT = 17.67
const ALTO_REGISTRAR_PT = 14.75
const ALTO_FILA_CUADRICULA_PT = 12.05
// Word siempre agrega un párrafo vacío después de una tabla. Con la altura
// exacta del original ese párrafo no entra y genera una segunda hoja en blanco,
// así que la versión .doc usa filas apenas más bajas para dejarle lugar. El PDF
// mantiene la medida real del formulario.
const ALTO_FILA_CUADRICULA_WORD_PT = 11.85
// 9 casillas: un numero de OT comun tiene 6 digitos, pero una OT con fuelle es
// "F-" + el numero (8 caracteres) y alguna llega a 9. Cada casilla es una
// columna de la grilla, asi que el bloque del N OT ocupa 4 (rotulo) + 9.
const CAJAS_NUMERO_OT = 6
// Columnas de la fila CLIENTE / N OT (suman COLUMNAS = 34). El nombre del
// cliente se queda con lo que sobra: 16.
const COLS_CLIENTE_ROTULO = 6
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
  'cliente-rotulo': `border-left:${GRUESA};font-size:13pt;font-weight:bold;padding-left:4pt;padding-bottom:2pt;vertical-align:bottom;white-space:nowrap`,
  'cliente-valor': `border-bottom:2.25pt solid #000;vertical-align:bottom;font-size:11pt;padding:0 4pt 2pt 4pt`,
  // Nombres largos: se achica la letra y, en el ultimo caso, se deja partir en
  // dos renglones. Los nombres reales llegan a 62 caracteres.
  'cliente-valor-medio': `border-bottom:2.25pt solid #000;vertical-align:bottom;font-size:9pt;padding:0 4pt 2pt 4pt`,
  'cliente-valor-chico': `border-bottom:2.25pt solid #000;vertical-align:bottom;font-size:7.5pt;line-height:1.05;padding:0 4pt 2pt 4pt`,
  'ot-rotulo': 'font-size:13pt;font-weight:bold;text-align:right;padding-right:3pt;vertical-align:bottom;white-space:nowrap',
  ot: `border-left:${GRUESA};border-bottom:${GRUESA};text-align:center;font-size:12pt;font-weight:bold`,
  'ot-der': `border-left:${GRUESA};border-right:${GRUESA};border-bottom:${GRUESA};text-align:center;font-size:12pt;font-weight:bold`,
  'lat-izq': `border-left:${GRUESA}`,
  'cabecera-col': 'font-size:9.5pt;font-weight:bold;text-align:center',
  tem: `border-left:${GRUESA};font-size:9.5pt;font-weight:bold;padding-left:3pt`,
  // En las filas TEM el original separa CODIGO de PRODUCTO con una línea fina, no
  // con el trazo grueso del resto. Las dos juntas porque con border-collapse
  // gana el borde más grueso entre celdas vecinas.
  'tem-codigo': `border-bottom:${FINA};padding:0 3pt`,
  'tem-producto': `border-bottom:${FINA};border-left:${FINA};padding:0 3pt;white-space:nowrap`,
  // Descripciones de más de ~60 caracteres: letra más chica en una
  // línea, en vez de partir el renglón y agrandar la fila.
  'tem-producto-chico': `border-bottom:${FINA};border-left:${FINA};padding:0 3pt;white-space:nowrap;font-size:7pt`,
  // Total del ítem, bajo el rótulo de la unidad (como el "200000" escrito
  // bajo "BOLSAS" en el formulario en papel). Misma línea que el producto.
  'tem-total': `border-bottom:${FINA};padding:0 3pt 0 0;text-align:right;font-weight:bold;white-space:nowrap`,
  'unidad-rotulo': 'font-size:9.5pt;font-weight:bold;text-align:right;padding-right:3pt',
  // 8pt y nowrap: a 8.5pt "Fecha Pedido:" y "Entrega Total:" no entran en sus
  // 4 columnas y Word los parte en dos renglones.
  'rot-b': 'font-size:8pt;font-weight:bold;padding-left:3pt;white-space:nowrap',
  'rot-der': `border-left:${GRUESA};font-size:8.5pt;font-weight:bold;text-align:right;padding-right:3pt`,
  'dato-b': `border:${GRUESA};padding:0 3pt`,
  // valor de la columna derecha: solo subrayado + borde del marco
  'valor-linea': `border-bottom:${GRUESA};border-right:${GRUESA};padding:0 3pt`,
  'dato-linea': `border-bottom:${FINA};padding:0 3pt`,
  'pedido-total': 'font-size:9pt;font-weight:bold;text-align:right;padding-right:5pt',
  total: `border:${GRUESA};font-size:10pt;font-weight:bold;text-align:center`,
  registrar: `border:${GRUESA};font-size:8.5pt;padding-left:3pt`,
  // 7.5pt y no 8: "Verificado Por" no entra a 8pt (en el original también sale
  // cortado, pero no hay razón para copiar el recorte).
  'pie-b': `border:${GRUESA};font-size:7.5pt;font-weight:bold;padding-left:2pt`,
  'pie-franja': `border-top:${GRUESA};border-bottom:${GRUESA};font-size:7.5pt;font-weight:bold;text-align:center`,
  franja: `border-top:${GRUESA};border-bottom:${GRUESA}`,
  // Pesajes escritos en la cuadrícula (ver lineasRegistro).
  'reg-num': `border:${FINA};text-align:right;padding-right:2pt;font-size:8pt;white-space:nowrap`,
  'reg-guion': `border:${FINA};text-align:center;font-size:8pt`,
  'reg-sub': `border:${FINA};border-top:1pt solid #000;text-align:right;padding-right:2pt;font-size:8pt;font-weight:bold;white-space:nowrap`,
  // Fecha y resumen llevan fondo gris para que cada día se ubique de un
  // vistazo (pedido de Elias). Grises claros: se imprimen bien en blanco y
  // negro sin tapar el texto.
  'reg-fecha': `border:${FINA};text-align:center;font-size:8.5pt;font-weight:bold;white-space:nowrap;background:#E7E7E7`,
  'reg-resumen': `border:${FINA};font-size:7.5pt;font-weight:bold;padding-left:2pt;white-space:nowrap;background:#D9D9D9`,
  'reg-resumen-chico': `border:${FINA};font-size:6pt;font-weight:bold;padding-left:1pt;white-space:nowrap;background:#D9D9D9`,
  // Total de la hoja, abajo al centro ("To hoja = ..." del papel).
  'reg-total': `border:1.5pt solid #000;font-size:8.5pt;font-weight:bold;text-align:center;white-space:nowrap;background:#D9D9D9`
}

export interface ItemFormularioPt {
  codigo?: string
  producto?: string
  total?: string
}

/** Un pesaje escrito en la cuadrícula: el peso NETO (la tara no va) y, en
 * Bolsas/Mill, las bolsas del paquete. */
export interface PesajeFormularioPt {
  neto: number
  cantidad: number | null
}

/** Una "tanda" del papel: todo lo pesado en un día, con su resumen. */
export interface DiaFormularioPt {
  /** DD/MM/YYYY */
  fecha: string
  pesajes: PesajeFormularioPt[]
  to: number
  kg: number
  paquetes: number
  pesadores: string[]
  /** % acumulado sin redondear; null si no hay pedido total. */
  porcentaje: number | null
}

export interface RegistrosFormularioPt {
  /** true en Bolsas/Mill (peso — cantidad); false en Kg (solo el peso). */
  conCantidad: boolean
  dias: DiaFormularioPt[]
}

export interface DatosFormularioPt {
  /** Pesajes para escribir en "Registrar Fecha, Cantidades y Pesos". Sin
   * esto, la cuadrícula sale vacía para llenar a mano. */
  registros?: RegistrosFormularioPt
  cliente?: string
  numeroOt?: string
  items?: ItemFormularioPt[]
  /** Rótulo sobre la columna de totales: "Kg", "BOLSAS", "Mill". Sin dato, "(unidad)". */
  unidad?: string
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
    return `${celda(ctx, 'ot-der', CAJAS_NUMERO_OT)}${esc(texto)}</td>`
  }
  return Array.from(
    { length: CAJAS_NUMERO_OT },
    (_, i) =>
      `${celda(ctx, i === CAJAS_NUMERO_OT - 1 ? 'ot-der' : 'ot')}${esc(texto[i] ?? '')}</td>`
  ).join('')
}

/** Tamaño del nombre del cliente según cuánto ocupa en su celda. */
function estiloClienteValor(cliente: string | undefined): string {
  const largo = (cliente ?? '').length
  if (largo <= 34) return 'cliente-valor'
  if (largo <= 42) return 'cliente-valor-medio'
  return 'cliente-valor-chico'
}

/** Una fila TEM: etiqueta + CODIGO / PRODUCTO (con su unidad). */
function filaTem(
  ctx: Contexto,
  indice: number,
  item: ItemFormularioPt,
  etiquetaDerecha: string,
  valorDerecha: string
): string {
  return `<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'tem', 3)}TEM ${indice}</td>
${celda(ctx, 'tem-codigo', 3)}${esc(item.codigo)}</td>
${celda(ctx, (item.producto ?? '').length > 60 ? 'tem-producto-chico' : 'tem-producto', 15)}${esc(item.producto)}</td>
${celda(ctx, 'tem-total', 3)}${esc(item.total)}</td>
${celda(ctx, 'rot-b', 4)}${etiquetaDerecha}</td>
${celda(ctx, 'valor-linea', 6)}${esc(valorDerecha)}</td>
</tr>`
}

// --- Pesajes en la cuadrícula ------------------------------------------
//
// Como a mano en el papel (OT 219988): la hoja se divide en 4 columnas de 8
// casillas y los días van EN HORIZONTAL, uno al lado del otro. Cada día
// ocupa una columna por cada 10 pesajes ("peso neto - cantidad"; en Kg solo
// el peso) con su subtotal debajo; arriba lleva la fecha (a lo ancho de sus
// columnas) y debajo de su última columna el resumen en 3 renglones (To/Kg,
// Pq o Bo/Per., N°/%). El día siguiente sigue en la próxima columna libre de
// la misma franja; cuando la franja se llena, se baja a la siguiente.
//
// Historia: primero cada día ocupaba una franja entera (un día de 2 pesajes
// dejaba 3 columnas vacías); después se probó fluir en vertical, columna por
// columna, y Elias lo quería horizontal. Esto es lo que pidió: horizontal y
// sin columnas desperdiciadas. Nada puede quedar afuera: lo que no entra en
// una hoja sigue en otra, y los textos largos se achican (estiloResumen).
// N° va siempre en blanco (número de solicitud que el sistema no tiene).
const COLUMNAS_REGISTRO = 4
const ANCHO_COLUMNA_REGISTRO = 8
// Renglones de la cuadrícula debajo de "Registrar Fecha...": 28 limpios, 7
// con el recuadro de firmas a la derecha y uno final limpio. El recuadro
// ocupa las casillas 25-34 y tapa solo la 4ª columna de pesajes: las 3
// primeras usan los 36 renglones, la 4ª solo los primeros 28.
const FILAS_CUADRICULA = 36
const FILAS_SIN_PIE = 28
const FILAS_PIE = 7
const PESAJES_POR_COLUMNA = 10
const RENGLONES_RESUMEN = 3

// Lo que va en un renglón de UNA columna de pesajes (8 casillas).
type CeldaRegistro =
  // La fecha abarca las columnas del día en esa franja (`columnas`); las
  // otras quedan 'cubierta' y no generan casillas.
  | { tipo: 'fecha'; fecha: string; continua: boolean; columnas: number }
  | { tipo: 'cubierta' }
  | { tipo: 'pesaje'; peso: number; cantidad: number | null }
  | { tipo: 'subtotal'; peso: number; cantidad: number | null }
  | { tipo: 'resumen'; renglon: 1 | 2 | 3; dia: DiaFormularioPt }

// Bordes gruesos de una columna de pesajes en un renglón: el recuadro de
// cada día (fecha + pesajes + resumen) y, más fino, el del resumen. Así se
// ve de un vistazo qué pesajes son de qué día (pedido de Elias).
interface Marco {
  arriba?: string
  abajo?: string
  izquierda?: string
  derecha?: string
}
const MARCO_DIA = '1.5pt solid #000'
const MARCO_RESUMEN = '1pt solid #000'

// Una hoja: por renglón de la cuadrícula, lo que tiene cada una de las 4
// columnas de pesajes (null = cuadrícula vacía) y sus bordes gruesos.
interface Hoja {
  celdas: (CeldaRegistro | null)[][]
  marcos: Marco[][]
  // Suma de lo escrito en esta hoja, para "To hoja = ... / Kg = ..." del pie
  // (pedido de Elias). Sale de los pesajes de la hoja, no de los resúmenes:
  // un día partido entre dos hojas suma en cada una lo que tiene.
  pesajes: number
  toHoja: number
  kgHoja: number
}

function hojaVacia(): Hoja {
  return {
    celdas: Array.from({ length: FILAS_CUADRICULA }, () =>
      Array<CeldaRegistro | null>(COLUMNAS_REGISTRO).fill(null)
    ),
    marcos: Array.from({ length: FILAS_CUADRICULA }, () =>
      Array.from({ length: COLUMNAS_REGISTRO }, (): Marco => ({}))
    ),
    pesajes: 0,
    toHoja: 0,
    kgHoja: 0
  }
}

/** Marca el borde de un rectángulo de la hoja (renglones y columnas de
 * pesajes, inclusive). */
function marcarRecuadro(
  hoja: Hoja,
  filas: [number, number],
  columnas: [number, number],
  borde: string
): void {
  for (let f = filas[0]; f <= filas[1]; f++) {
    for (let c = columnas[0]; c <= columnas[1]; c++) {
      const m = hoja.marcos[f][c]
      if (f === filas[0]) m.arriba = borde
      if (f === filas[1]) m.abajo = borde
      if (c === columnas[0]) m.izquierda = borde
      if (c === columnas[1]) m.derecha = borde
    }
  }
}

/** Hasta qué renglón puede bajar una columna: la 4ª choca con el recuadro
 * de firmas; las otras llegan hasta el anteúltimo renglón, porque el último
 * es el del total de la hoja. */
function limiteColumna(columna: number): number {
  return columna === COLUMNAS_REGISTRO - 1 ? FILAS_SIN_PIE : FILAS_CUADRICULA - 1
}

/** Número con punto decimal como se escribe en el papel: entre `minimo` y
 * `maximo` decimales (23.70, 23.655, 1500). */
function numero(valor: number, maximo: number, minimo = 0): string {
  return valor.toLocaleString('en-US', {
    minimumFractionDigits: minimo,
    maximumFractionDigits: maximo,
    useGrouping: false
  })
}

// Una columna de un día: hasta 10 pesajes con su subtotal y, si es la
// última del día, el resumen debajo.
interface BloqueDia {
  celdas: CeldaRegistro[]
}

function bloquesDelDia(dia: DiaFormularioPt, conCantidad: boolean): BloqueDia[] {
  const bloques: BloqueDia[] = []
  for (let i = 0; i < dia.pesajes.length; i += PESAJES_POR_COLUMNA) {
    const grupo = dia.pesajes.slice(i, i + PESAJES_POR_COLUMNA)
    bloques.push({
      celdas: [
        ...grupo.map((p): CeldaRegistro => ({ tipo: 'pesaje', peso: p.neto, cantidad: p.cantidad })),
        {
          tipo: 'subtotal',
          peso: redondearPeso(grupo.reduce((suma, p) => suma + p.neto, 0)),
          cantidad: conCantidad ? redondearPeso(grupo.reduce((suma, p) => suma + (p.cantidad ?? 0), 0)) : null
        }
      ]
    })
  }
  if (bloques.length === 0) bloques.push({ celdas: [] })
  bloques[bloques.length - 1].celdas.push(
    { tipo: 'resumen', renglon: 1, dia },
    { tipo: 'resumen', renglon: 2, dia },
    { tipo: 'resumen', renglon: 3, dia }
  )
  return bloques
}

/**
 * Reparte los días en franjas horizontales y las franjas en hojas. Una
 * franja es un renglón de fechas más los bloques de debajo; su alto lo marca
 * el bloque más largo. Un día se pone entero en la franja actual si le
 * alcanzan las columnas libres; si no, arranca en una franja nueva, y solo
 * se parte (repitiendo la fecha con "(cont.)") cuando no entra ni en una
 * franja vacía — más de 40 pesajes, o una franja al pie donde la 4ª columna
 * ya no está. Siempre hay al menos una hoja.
 */
function lineasRegistro(registros: RegistrosFormularioPt | undefined): Hoja[] {
  const conCantidad = registros?.conCantidad ?? false
  const hojas: Hoja[] = [hojaVacia()]
  let inicio = 0 // renglón donde empieza la franja actual (el de las fechas)
  let columna = 0 // próxima columna libre de la franja
  let alto = 0 // renglones que ocupa la franja actual, fecha incluida

  const hoja = (): Hoja => hojas[hojas.length - 1]
  const entra = (col: number, bloque: BloqueDia): boolean =>
    col < COLUMNAS_REGISTRO && inicio + 1 + bloque.celdas.length <= limiteColumna(col)
  const nuevaFranja = (): void => {
    inicio += alto
    columna = 0
    alto = 0
  }
  const nuevaHoja = (): void => {
    hojas.push(hojaVacia())
    inicio = 0
    columna = 0
    alto = 0
  }

  // Pone un tramo de bloques de un día en la franja actual, desde `columna`.
  const colocar = (dia: DiaFormularioPt, tramo: BloqueDia[], continua: boolean): void => {
    const h = hoja()
    h.celdas[inicio][columna] = { tipo: 'fecha', fecha: dia.fecha, continua, columnas: tramo.length }
    for (let i = 1; i < tramo.length; i++) h.celdas[inicio][columna + i] = { tipo: 'cubierta' }
    let altoDia = 1
    tramo.forEach((bloque, i) => {
      bloque.celdas.forEach((c, fila) => {
        h.celdas[inicio + 1 + fila][columna + i] = c
        if (c.tipo === 'pesaje') {
          h.pesajes++
          h.kgHoja = redondearPeso(h.kgHoja + c.peso)
          h.toHoja = redondearPeso(h.toHoja + (conCantidad ? (c.cantidad ?? 0) : c.peso))
        }
      })
      const resumen = bloque.celdas.findIndex((c) => c.tipo === 'resumen')
      if (resumen >= 0) {
        const primera = inicio + 1 + resumen
        marcarRecuadro(h, [primera, primera + RENGLONES_RESUMEN - 1], [columna + i, columna + i], MARCO_RESUMEN)
      }
      altoDia = Math.max(altoDia, 1 + bloque.celdas.length)
    })
    // El recuadro del día va después del del resumen: donde coinciden, gana
    // el más grueso.
    marcarRecuadro(h, [inicio, inicio + altoDia - 1], [columna, columna + tramo.length - 1], MARCO_DIA)
    alto = Math.max(alto, altoDia)
    columna += tramo.length
  }

  for (const dia of registros?.dias ?? []) {
    let pendientes = bloquesDelDia(dia, conCantidad)
    let continua = false
    while (pendientes.length > 0) {
      // ¿Cuántos bloques seguidos entran desde la columna libre?
      let caben = 0
      while (caben < pendientes.length && entra(columna + caben, pendientes[caben])) caben++

      if (caben === pendientes.length) {
        colocar(dia, pendientes, continua)
        pendientes = []
      } else if (columna > 0) {
        // No entra entero al lado de otro día: se prueba en una franja nueva.
        nuevaFranja()
      } else if (caben > 0) {
        // Ni en una franja vacía entra entero: se parte y sigue abajo.
        colocar(dia, pendientes.slice(0, caben), continua)
        pendientes = pendientes.slice(caben)
        continua = true
        nuevaFranja()
      } else if (inicio > 0) {
        // No queda lugar ni para una columna en esta hoja.
        nuevaHoja()
      } else {
        // Un bloque que no entra en una hoja vacía no puede existir (el
        // más alto ocupa 1 + 10 + 1 + 3 = 15 renglones de 28), pero si
        // pasara no hay que colgarse en un bucle infinito.
        throw new Error('Un bloque de pesajes no entra en una hoja vacía')
      }
    }
  }
  return hojas
}

/** Letra más chica para un resumen que no entra a tamaño normal: nada puede
 * quedar cortado en el papel. `casillas` es el ancho disponible. */
function estiloResumen(texto: string, casillas: number): string {
  // ~4.3 pt por carácter en Arial Bold 7.5pt; cada casilla mide ~15 pt.
  return texto.length * 4.3 > casillas * ANCHO_COLUMNA_PT - 3 ? 'reg-resumen-chico' : 'reg-resumen'
}

// Una casilla (o varias unidas) de una columna de pesajes, antes de
// aplicarle los bordes gruesos del recuadro.
interface Parte {
  estilo: string
  casillas: number
  html: string
}

function resumen(texto: string, casillas: number): Parte {
  return { estilo: estiloResumen(texto, casillas), casillas, html: esc(texto) }
}

/** Las casillas de una columna de pesajes en un renglón (8, o las de la
 * fecha si abarca varias columnas; ninguna si está cubierta por una fecha). */
function partesRegistro(c: CeldaRegistro | null, conCantidad: boolean): Parte[] {
  const vacias = (n: number): Parte[] => Array.from({ length: n }, () => ({ estilo: 'g', casillas: 1, html: '' }))
  if (c === null) return vacias(ANCHO_COLUMNA_REGISTRO)
  if (c.tipo === 'cubierta') return []
  if (c.tipo === 'fecha') {
    const texto = c.continua ? `${c.fecha} (cont.)` : c.fecha
    return [{ estilo: 'reg-fecha', casillas: ANCHO_COLUMNA_REGISTRO * c.columnas, html: esc(texto) }]
  }
  if (c.tipo === 'resumen') {
    const d = c.dia
    if (c.renglon === 1) return [resumen(`To = ${numero(d.to, 2)}`, 4), resumen(`Kg = ${numero(d.kg, 2, 2)}`, 4)]
    if (c.renglon === 2) {
      return [
        resumen(`${conCantidad ? 'Pq' : 'Bo'} = ${d.paquetes}`, 3),
        resumen(`Per. = ${d.pesadores.join(', ')}`, 5)
      ]
    }
    const porcentaje = d.porcentaje !== null ? `${Math.round(d.porcentaje)}%` : ''
    return [resumen('Nº =', 4), resumen(porcentaje, 4)]
  }
  const esSubtotal = c.tipo === 'subtotal'
  const estilo = esSubtotal ? 'reg-sub' : 'reg-num'
  const peso: Parte = { estilo, casillas: 3, html: numero(c.peso, esSubtotal ? 2 : 3, 2) }
  if (!conCantidad || c.cantidad === null) return [peso, ...vacias(5)]
  const guion = esSubtotal ? vacias(1) : [{ estilo: 'reg-guion', casillas: 1, html: '-' }]
  return [peso, ...guion, { estilo, casillas: 3, html: numero(c.cantidad, 0) }, ...vacias(1)]
}

/** Una casilla con, además de su estilo, los bordes gruesos del recuadro. En
 * Word van dentro del mismo style inline (no entiende dos declaraciones). */
function tdMarcado(ctx: Contexto, parte: Parte, extra: string): string {
  const span = parte.casillas > 1 ? ` colspan="${parte.casillas}"` : ''
  const ancho = ` width="${ANCHO_COLUMNA_PX * parte.casillas}"`
  const atributo = ctx.paraWord
    ? ` style="${BASE_CELDA};${ESTILOS_CELDA[parte.estilo]}${extra ? `;${extra}` : ''}"`
    : ` class="${parte.estilo}"${extra ? ` style="${extra}"` : ''}`
  return `<td${span}${ancho}${atributo}>${parte.html}</td>`
}

function htmlCeldaRegistro(ctx: Contexto, hoja: Hoja, fila: number, columna: number, conCantidad: boolean): string {
  const c = hoja.celdas[fila][columna]
  const partes = partesRegistro(c, conCantidad)
  const marco = hoja.marcos[fila][columna]
  // Una fecha que abarca varias columnas toma el borde derecho de la última.
  const ultima = c?.tipo === 'fecha' ? columna + c.columnas - 1 : columna
  const derecha = hoja.marcos[fila][ultima].derecha
  return partes
    .map((parte, i) => {
      const bordes = [
        marco.arriba && `border-top:${marco.arriba}`,
        marco.abajo && `border-bottom:${marco.abajo}`,
        i === 0 && marco.izquierda && `border-left:${marco.izquierda}`,
        i === partes.length - 1 && derecha && `border-right:${derecha}`
      ]
        .filter(Boolean)
        .join(';')
      return tdMarcado(ctx, parte, bordes)
    })
    .join('')
}

function filasCuadricula(ctx: Contexto, hoja: Hoja, conCantidad: boolean): string {
  const alto = altoFila(ctx.paraWord ? ALTO_FILA_CUADRICULA_WORD_PT : ALTO_FILA_CUADRICULA_PT)
  const columnas = (fila: number, cuantas: number): string =>
    Array.from({ length: cuantas }, (_, c) => htmlCeldaRegistro(ctx, hoja, fila, c, conCantidad)).join('')
  const sobrante = COLUMNAS - COLUMNAS_REGISTRO * ANCHO_COLUMNA_REGISTRO
  const completa = (fila: number): string =>
    `<tr ${alto}>${columnas(fila, COLUMNAS_REGISTRO)}${celdasCuadricula(ctx, sobrante)}</tr>`

  // El recuadro de firmas: lo que va a la derecha de las 3 primeras columnas
  // de pesajes en cada uno de sus 7 renglones (casillas 25-34).
  const pie = [
    `${celda(ctx, 'pie-b', 4)}Verificado Por</td>${celda(ctx, 'b', 6)}</td>`,
    `${celda(ctx, 'pie-b', 4)}OT Concluida:</td>${celda(ctx, 'franja')}</td>${celda(ctx, 'pie-franja')}Si</td>${celda(ctx, 'b')}</td>${celda(ctx, 'pie-franja')}No</td>${celda(ctx, 'b', 2)}</td>`,
    // Recuadro alto en blanco (firma / sello): 3 renglones.
    `${celda(ctx, 'b', 10, 'rowspan="3"')}</td>`,
    '',
    '',
    `${celda(ctx, 'pie-b', 2)}Fecha:</td>${celda(ctx, 'b', 3)}</td>${celda(ctx, 'pie-b', 2)}Hora:</td>${celda(ctx, 'b', 3)}</td>`,
    `${celda(ctx, 'pie-b', 2)}Area:</td>${celda(ctx, 'b', 8)}</td>`
  ]

  const filas: string[] = []
  for (let fila = 0; fila < FILAS_SIN_PIE; fila++) filas.push(completa(fila))
  for (let i = 0; i < FILAS_PIE; i++) {
    const fila = FILAS_SIN_PIE + i
    filas.push(`<tr ${alto}>${columnas(fila, COLUMNAS_REGISTRO - 1)}${pie[i]}</tr>`)
  }
  filas.push(hoja.pesajes > 0 ? filaTotalHoja(ctx, hoja, alto) : completa(FILAS_SIN_PIE + FILAS_PIE))
  return filas.join('\n')
}

/** Último renglón: "To hoja = ... / Kg = ..." remarcado y centrado, como lo
 * anotaban a mano al pie del papel. */
function filaTotalHoja(ctx: Contexto, hoja: Hoja, alto: string): string {
  const casillas = 6
  const costado = (COLUMNAS - casillas * 2) / 2
  return `<tr ${alto}>${celdasCuadricula(ctx, costado)}${celda(ctx, 'reg-total', casillas)}To Hoja = ${numero(
    hoja.toHoja,
    2
  )}</td>${celda(ctx, 'reg-total', casillas)}Kg = ${numero(hoja.kgHoja, 2, 2)}</td>${celdasCuadricula(ctx, costado)}</tr>`
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
    margin: 0 auto;
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
/** Cuántas hojas ocupa el formulario con sus pesajes (al menos 1). */
export function hojasFormularioPt(datos: DatosFormularioPt = {}): number {
  return lineasRegistro(datos.registros).length
}

export function generarHtmlFormularioPt(
  datos: DatosFormularioPt = {},
  opciones: { paraWord?: boolean; soloHoja?: number } = {}
): string {
  const ctx: Contexto = { paraWord: opciones.paraWord ?? false }
  const hojas = lineasRegistro(datos.registros)
  const conCantidad = datos.registros?.conCantidad ?? false
  const elegidas = opciones.soloHoja !== undefined ? [hojas[opciones.soloHoja] ?? hojaVacia()] : hojas
  // El salto va en un div aparte con estilo inline (no en la tabla): Word no
  // respeta page-break-after sobre un <table> — mismo arreglo que formularioMp.
  const cuerpo = elegidas
    .map((hoja) => tablaFormulario(ctx, datos, hoja, conCantidad))
    .join('\n<div style="page-break-after:always"></div>\n')

  return documentoFormulario(ctx, cuerpo)
}

function tablaFormulario(
  ctx: Contexto,
  datos: DatosFormularioPt,
  hoja: Hoja,
  conCantidad: boolean
): string {
  const items = datos.items ?? []
  const item = (i: number): ItemFormularioPt => items[i] ?? {}
  const logo = ctx.paraWord ? URL_LOGO_MHTML : LOGO_ZEPOL_BASE64

  return `<table class="formulario" align="center" cellpadding="0" cellspacing="0" border="0" width="${Math.round(
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
<tr ${altoFila(ALTO_CLIENTE_PT)}>
${celda(ctx, 'cliente-rotulo', COLS_CLIENTE_ROTULO)}CLIENTE:</td>
${celda(ctx, estiloClienteValor(datos.cliente), COLS_CLIENTE_VALOR)}${esc(datos.cliente)}</td>
${celda(ctx, 'ot-rotulo', COLS_OT_ROTULO)}N&ordm; OT.:</td>
${casillasNumeroOt(ctx, datos.numeroOt)}
</tr>
<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'lat-izq', 3)}</td>
${celda(ctx, 'cabecera-col', 3)}CODIGO</td>
${celda(ctx, 'cabecera-col', 15)}PRODUCTO</td>
${celda(ctx, 'unidad-rotulo', 3)}${esc(datos.unidad) || '(unidad)'}</td>
${celda(ctx, 'rot-b', 4)}Fecha Pedido:</td>
${celda(ctx, 'valor-linea', 6)}${esc(datos.fechaPedido)}</td>
</tr>
${filaTem(ctx, 1, item(0), 'Fecha Entrega', datos.fechaEntrega ?? '')}
${filaTem(ctx, 2, item(1), 'Comercial:', datos.comercial ?? '')}
${filaTem(ctx, 3, item(2), 'Ciudad:', datos.ciudad ?? '')}
${filaTem(ctx, 4, item(3), 'Moneda:', datos.moneda ?? '')}
${filaTem(ctx, 5, item(4), 'Nuevo:', datos.nuevo ?? '')}
<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'lat-izq', 16)}</td>
${celda(ctx, 'pedido-total', 5)}Pedido Total</td>
${celda(ctx, 'total', 3)}${esc(datos.pedidoTotal) || '0.00'}</td>
${celda(ctx, 'rot-b', 4)}Rc-Arte:</td>
${celda(ctx, 'valor-linea', 6)}${esc(datos.rcArte)}</td>
</tr>
<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'rot-der', 5)}Condiciones:</td>
${celda(ctx, 'dato-linea', 19)}${esc(datos.condiciones)}</td>
${celda(ctx, 'rot-b', 4)}Muestra:</td>
${celda(ctx, 'valor-linea', 6)}${esc(datos.muestra)}</td>
</tr>
<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'rot-der', 5)}Observaciones:</td>
${celda(ctx, 'dato-linea', 19)}${esc(datos.observaciones)}</td>
${celda(ctx, 'rot-b', 4)}Entrega Total:</td>
${celda(ctx, 'valor-linea', 6)}${esc(datos.entregaTotal)}</td>
</tr>
<tr ${altoFila(ALTO_REGISTRAR_PT)}>
${celda(ctx, 'registrar', COLUMNAS)}Registrar Fecha, Cantidades y Pesos en letra legible:</td>
</tr>
${filasCuadricula(ctx, hoja, conCantidad)}
</tbody>
</table>`
}

function documentoFormulario(ctx: Contexto, cuerpo: string): string {
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

// Como se escribe la unidad en el formulario en papel (el de la OT 219988
// dice "BOLSAS" sobre la columna de totales).
export const ROTULO_UNIDAD_PT: Record<UnidadPt, string> = {
  KG: 'Kg',
  BOLSAS: 'BOLSAS',
  MILLAR: 'Mill'
}

/** Sin ceros de más: 200000 y no 200000.00; 22.5 y no 22.50. */
function formatearCantidad(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return ''
  return Number.isInteger(valor) ? String(valor) : valor.toLocaleString('en-US', { maximumFractionDigits: 3, useGrouping: false })
}

/** Iniciales del comercial como se escriben en el formulario en papel: las
 * dos primeras letras del usuario en mayúsculas (dsalazar → DS, vjahuira →
 * VJ, hvaldivia → HV). */
export function inicialesComercial(vendedor: string | null): string | undefined {
  const letras = (vendedor ?? '').replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '')
  return letras ? letras.slice(0, 2).toUpperCase() : undefined
}

/**
 * Datos de una OT en Producto Terminado → lo que va impreso en el formulario.
 * La moneda se elige en pantalla. Nuevo, Rc-Arte, Muestra, Entrega Total,
 * Condiciones y Observaciones quedan en blanco para llenarlos a mano (Nuevo /
 * Rc-Arte: por ahora así, decidido por Elias).
 */
export function datosFormularioDesdePt(pt: ProductoTerminado, pesajes?: PesajesPt): DatosFormularioPt {
  return {
    registros: pesajes && pt.unidad ? registrosDesdePesajes(pt.unidad, pesajes) : undefined,
    cliente: pt.cliente ?? undefined,
    numeroOt: pt.numero_ot,
    unidad: pt.unidad ? ROTULO_UNIDAD_PT[pt.unidad] : undefined,
    items: pt.items.map((item) => ({
      codigo: item.codigo_producto ?? undefined,
      producto: item.descripcion_producto ?? undefined,
      total: formatearCantidad(item.total)
    })),
    pedidoTotal: formatearCantidad(pt.pedido_total) || undefined,
    fechaPedido: pt.fecha_pedido ? formatearFecha(pt.fecha_pedido) : undefined,
    fechaEntrega: pt.fecha_entrega ? formatearFecha(pt.fecha_entrega) : undefined,
    comercial: inicialesComercial(pt.vendedor),
    ciudad: pt.ciudad?.toUpperCase(),
    moneda: pt.moneda ?? undefined
  }
}

/** Pesajes de la OT agrupados por día, como se escriben en la cuadrícula. */
function registrosDesdePesajes(unidad: UnidadPt, datos: PesajesPt): RegistrosFormularioPt {
  return {
    conCantidad: unidad !== 'KG',
    dias: datos.dias.map((dia) => ({
      fecha: formatearFecha(dia.fecha),
      pesajes: datos.pesajes
        .filter((p) => p.fecha === dia.fecha)
        .sort((a, b) => a.numero - b.numero)
        .map((p) => ({ neto: p.peso_neto, cantidad: p.cantidad })),
      to: dia.to,
      kg: dia.kg,
      paquetes: dia.paquetes,
      pesadores: dia.pesadores,
      porcentaje: dia.porcentaje_acumulado
    }))
  }
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
