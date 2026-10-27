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
  // recuadro del formulario
  b: `border:${GRUESA}`,
  titulo: `border:${GRUESA};font-size:13pt;font-weight:bold;text-align:center;line-height:1.12`,
  'codigo-rotulo': `border:${GRUESA};font-size:10pt;text-align:center`,
  'codigo-valor': `border:${GRUESA};font-size:9.5pt;font-weight:bold;text-align:center`,
  'cliente-rotulo': `border-left:${GRUESA};font-size:13pt;font-weight:bold;padding-left:4pt;padding-bottom:2pt;vertical-align:bottom;white-space:nowrap`,
  // Todo valor que se trae de la OT (cliente, ítems, columna derecha) va centrado
  // en su casilla (pedido de Elias); los rótulos conservan su alineación.
  'cliente-valor': `border-bottom:2.25pt solid #000;vertical-align:bottom;font-size:11pt;padding:0 4pt 2pt 4pt;text-align:center`,
  // Nombres largos: se achica la letra y, en el ultimo caso, se deja partir en
  // dos renglones. Los nombres reales llegan a 62 caracteres.
  'cliente-valor-medio': `border-bottom:2.25pt solid #000;vertical-align:bottom;font-size:9pt;padding:0 4pt 2pt 4pt;text-align:center`,
  'cliente-valor-chico': `border-bottom:2.25pt solid #000;vertical-align:bottom;font-size:7.5pt;line-height:1.05;padding:0 4pt 2pt 4pt;text-align:center`,
  'ot-rotulo': 'font-size:13pt;font-weight:bold;text-align:right;padding-right:3pt;vertical-align:bottom;white-space:nowrap',
  ot: `border-left:${GRUESA};border-bottom:${GRUESA};text-align:center;font-size:12pt;font-weight:bold`,
  'ot-der': `border-left:${GRUESA};border-right:${GRUESA};border-bottom:${GRUESA};text-align:center;font-size:12pt;font-weight:bold`,
  'lat-izq': `border-left:${GRUESA}`,
  'cabecera-col': 'font-size:9.5pt;font-weight:bold;text-align:center',
  tem: `border-left:${GRUESA};font-size:9.5pt;font-weight:bold;padding-left:3pt`,
  // En las filas TEM el original separa CODIGO de PRODUCTO con una línea fina, no
  // con el trazo grueso del resto. Las dos juntas porque con border-collapse
  // gana el borde más grueso entre celdas vecinas.
  'tem-codigo': `border-bottom:${FINA};padding:0 3pt;text-align:center`,
  'tem-producto': `border-bottom:${FINA};border-left:${FINA};padding:0 3pt;white-space:nowrap;text-align:center`,
  // Descripciones de más de ~60 caracteres: letra más chica en una
  // línea, en vez de partir el renglón y agrandar la fila.
  'tem-producto-chico': `border-bottom:${FINA};border-left:${FINA};padding:0 3pt;white-space:nowrap;font-size:7pt;text-align:center`,
  // Total del ítem, bajo el rótulo de la unidad (como el "200000" escrito
  // bajo "BOLSAS" en el formulario en papel). Misma línea que el producto.
  'tem-total': `border-bottom:${FINA};padding:0 3pt;text-align:center;font-weight:bold;white-space:nowrap`,
  'unidad-rotulo': 'font-size:9.5pt;font-weight:bold;text-align:right;padding-right:3pt',
  // 8pt y nowrap: a 8.5pt "Fecha Pedido:" y "Entrega Total:" no entran en sus
  // 4 columnas y Word los parte en dos renglones.
  'rot-b': 'font-size:8pt;font-weight:bold;padding-left:3pt;white-space:nowrap',
  'rot-der': `border-left:${GRUESA};font-size:8.5pt;font-weight:bold;text-align:right;padding-right:3pt`,
  'dato-b': `border:${GRUESA};padding:0 3pt`,
  // valor de la columna derecha: solo subrayado + borde del marco
  'valor-linea': `border-bottom:${GRUESA};border-right:${GRUESA};padding:0 3pt;text-align:center`,
  'dato-linea': `border-bottom:${FINA};padding:0 3pt`,
  'cierre-der': `border-right:${GRUESA}`,
  'pedido-total': 'font-size:9pt;font-weight:bold;text-align:right;padding-right:5pt',
  total: `border:${GRUESA};font-size:10pt;font-weight:bold;text-align:center`,
  registrar: `border:${GRUESA};font-size:8.5pt;padding-left:3pt`
}

export interface ItemFormularioPt {
  codigo?: string
  producto?: string
  total?: string
}

/** Un pesaje escrito en la cuadrícula: el peso NETO (la tara no va) y, en
 * Bolsas/Mill, las bolsas del paquete. */
export interface PesajeFormularioPt {
  /** N° BOB/PAQ de la etiqueta. */
  numero: number
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
  /** Suma de las bobinas de los pesajes del día (Kg y Bob). */
  bobinas: number
  /** AAAA-MM-DD del día: identifica la casilla del N° del SID al corregirla en la hoja. */
  fechaIso?: string
  /** N° que el SID dio a este día (lo anota una persona); vacío = sin registrar. */
  numeroSid?: string
  /** Se tocaron pesajes del día después de anotar el N°. */
  sidRevisar?: boolean
  pesadores: string[]
  /** % acumulado sin redondear; null si no hay pedido total. */
  porcentaje: number | null
}

export interface RegistrosFormularioPt {
  /** true si cada pesaje se escribe "peso — cantidad" (bolsas, láminas o, en Kg y
   * Bob, las bobinas pesadas juntas). */
  conCantidad: boolean
  /** true en Kg: el To es el peso (no la suma de las cantidades) y se suma
   * aparte la cantidad de bobinas ("Bo"). */
  porPeso: boolean
  /** Kg y Bob: una bobina por pesaje es lo normal y no se anota en el papel;
   * solo se escribe cuando son 2 o más (pedido de Elias, 2026-10-22). */
  sinUno?: boolean
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
  /** Solo la vista previa en pantalla: marca los datos que se pueden corregir
   * haciendo clic (`data-campo`). El PDF y el Word nunca lo llevan. */
  editable?: boolean
  /** Claves de los datos ya corregidos a mano (se dibujan con su marca naranja). */
  editados?: Set<string>
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

/** Un `<td>` con un dato que se puede corregir directamente en la hoja. Fuera
 * de la vista previa en pantalla es una celda común. */
function celdaCampo(ctx: Contexto, estilo: string, colspan: number, clave: string | undefined): string {
  if (!ctx.editable || !clave) return celda(ctx, estilo, colspan)
  const editado = ctx.editados?.has(clave) ? ' data-editado="1"' : ''
  return celda(ctx, estilo, colspan, `data-campo="${clave}"${editado}`)
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
  valorDerecha: string,
  claveDerecha?: string
): string {
  const n = indice - 1
  return `<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'tem', 3)}TEM ${indice}</td>
${celdaCampo(ctx, 'tem-codigo', 3, claveItemFormularioPt(n, 'codigo'))}${esc(item.codigo)}</td>
${celdaCampo(ctx, (item.producto ?? '').length > 60 ? 'tem-producto-chico' : 'tem-producto', 15, claveItemFormularioPt(n, 'producto'))}${esc(item.producto)}</td>
${celdaCampo(ctx, 'tem-total', 3, claveItemFormularioPt(n, 'total'))}${esc(item.total)}</td>
${celda(ctx, 'rot-b', 4)}${etiquetaDerecha}</td>
${celdaCampo(ctx, 'valor-linea', 6, claveDerecha)}${esc(valorDerecha)}</td>
</tr>`
}

// --- Registro de pesos --------------------------------------------------
//
// La hoja donde se anotan los pesos, con el reparto de siempre y sin cuadrícula
// (2026-10-20). El sistema ya registra los pesos, y de la hoja que se llenaba a
// mano lo que no gustaba eran los cuadros; lo que sí servía se conserva:
//
//  - Los pesajes van en columnas de 10 ("peso - cantidad"; en Kg solo el peso),
//    cada una con su subtotal en negrita debajo.
//  - La hoja se divide en 4 columnas de pesajes y los días van EN HORIZONTAL, uno
//    al lado del otro: cada día ocupa una columna por cada 10 pesajes, con su
//    fecha arriba (a lo ancho de sus columnas) y su resumen debajo de su última
//    columna (To/Kg, Pq o Bo y quién pesó, Nº de solicitud en blanco y %). El día
//    siguiente sigue en la próxima columna libre de la misma franja; cuando la
//    franja se llena se baja a la siguiente. Así no se desperdician columnas.
//
// Lo que cambió: ya no hay casillas ni líneas alrededor de cada número (solo una
// línea fina sobre cada subtotal y una separación fina entre días), cada pesaje
// lleva el N° de su etiqueta, y el recuadro de firmas pasó a una franja de 3
// renglones al pie (antes ocupaba la esquina derecha y la 4ª columna llegaba
// solo hasta el renglón 28), junto con el total de la hoja.
//
// Historia (no volver atrás): primero cada día ocupaba una franja entera (un día
// de 2 pesajes dejaba 3 columnas vacías); después se probó fluir en vertical,
// columna por columna, y Elias lo quería horizontal. Tras pasar a registrar en el
// sistema se probó una lista de a 4 por renglón sin subtotales (opción B de las
// propuestas) y el jefe de área pidió volver a los grupos de 10 con su suma, sin
// los cuadros. Nada puede quedar afuera: lo que no entra en una hoja sigue en
// otra, y los textos largos se achican.
const COLUMNAS_REGISTRO = 4
const ANCHO_COLUMNA_REGISTRO = 8
// 33 renglones de pesajes + 3 del pie = los 36 de la cuadrícula de antes.
// 32 y no 33: el renglón que sobra lo ocupa el número de hoja, debajo del marco.
const FILAS_REGISTRO = 32
// Desde la 2ª hoja el encabezado se reduce (sin ítems, fechas ni condiciones: 8
// renglones de 17.67pt menos) y ese lugar se usa para más renglones de pesajes.
// 11 × 12.05pt = 132pt de los 141pt que se liberan: queda holgura para Word.
const FILAS_EXTRA_CONTINUACION = 11
const PESAJES_POR_COLUMNA = 10
const RENGLONES_RESUMEN = 3
const LINEA_FINA = '0.5pt solid #bbb'
const LINEA_SUBTOTAL = '0.5pt solid #444'
const SEPARADOR_DIA = '0.75pt solid #444'
const MARCO = '1pt solid #000'
const GRIS_FECHA = '#E7E7E7'
const GRIS_TOTAL = '#D9D9D9'

// Lo que va en un renglón de UNA columna de pesajes (8 casillas).
type CeldaRegistro =
  // La fecha abarca las columnas del día en esa franja (`columnas`); las
  // otras quedan 'cubierta' y no generan casillas.
  | { tipo: 'fecha'; fecha: string; continua: boolean; columnas: number }
  | { tipo: 'cubierta' }
  | { tipo: 'pesaje'; numero: number; peso: number; cantidad: number | null; sinUno: boolean }
  | { tipo: 'subtotal'; peso: number; cantidad: number | null }
  | { tipo: 'resumen'; renglon: 1 | 2 | 3; dia: DiaFormularioPt; porPeso: boolean }

// Una hoja: por renglón, lo que tiene cada una de las 4 columnas de pesajes
// (null = vacío) y dónde va la separación fina del primer renglón de un día.
interface HojaRegistro {
  celdas: (CeldaRegistro | null)[][]
  separa: boolean[][]
  // Suma de lo escrito hasta esta hoja (la suya y las anteriores), para el total
  // del pie. Sale de los pesajes, no de los resúmenes: un día partido entre dos
  // hojas suma en cada una lo suyo.
  pesajes: number
  to: number
  kg: number
  bobinas: number
  /** Unidad Kg: el pie muestra "To Hoja = kg  Bo = bobinas". */
  porPeso: boolean
}

function nuevaHoja(porPeso = false, filas = FILAS_REGISTRO): HojaRegistro {
  return {
    celdas: Array.from({ length: filas }, () => Array<CeldaRegistro | null>(COLUMNAS_REGISTRO).fill(null)),
    separa: Array.from({ length: filas }, () => Array<boolean>(COLUMNAS_REGISTRO).fill(false)),
    pesajes: 0,
    to: 0,
    kg: 0,
    bobinas: 0,
    porPeso
  }
}

/** Hasta dónde puede bajar una columna: ahora las 4 llegan hasta el final de la
 * zona de pesajes (el pie es una franja aparte). */
function limiteColumna(hoja: HojaRegistro): number {
  return hoja.celdas.length
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

function bloquesDelDia(dia: DiaFormularioPt, conCantidad: boolean, porPeso: boolean, sinUno: boolean): BloqueDia[] {
  const bloques: BloqueDia[] = []
  for (let i = 0; i < dia.pesajes.length; i += PESAJES_POR_COLUMNA) {
    const grupo = dia.pesajes.slice(i, i + PESAJES_POR_COLUMNA)
    bloques.push({
      celdas: [
        ...grupo.map((p): CeldaRegistro => ({ tipo: 'pesaje', numero: p.numero, peso: p.neto, cantidad: p.cantidad, sinUno })),
        {
          tipo: 'subtotal',
          peso: redondearPeso(grupo.reduce((suma, p) => suma + p.neto, 0)),
          // Con "sinUno" el subtotal de bobinas solo se escribe si algún pesaje del grupo tiene más de una.
          cantidad:
            conCantidad && !(sinUno && grupo.every((p) => p.cantidad === 1))
              ? redondearPeso(grupo.reduce((suma, p) => suma + (p.cantidad ?? 0), 0))
              : null
        }
      ]
    })
  }
  if (bloques.length === 0) bloques.push({ celdas: [] })
  bloques[bloques.length - 1].celdas.push(
    { tipo: 'resumen', renglon: 1, dia, porPeso },
    { tipo: 'resumen', renglon: 2, dia, porPeso },
    { tipo: 'resumen', renglon: 3, dia, porPeso }
  )
  return bloques
}

/**
 * Reparte los días en franjas horizontales y las franjas en hojas. Una
 * franja es un renglón de fechas más los bloques de debajo; su alto lo marca
 * el bloque más largo. Un día se pone entero en la franja actual si le
 * alcanzan las columnas libres; si no, arranca en una franja nueva, y solo
 * se parte (repitiendo la fecha con "(cont.)") cuando no entra ni en una
 * franja vacía (más de 40 pesajes). Siempre hay al menos una hoja.
 */
function repartirRegistro(registros: RegistrosFormularioPt | undefined): HojaRegistro[] {
  const conCantidad = registros?.conCantidad ?? false // solo suma lo escrito: sin pesajes no hay nada que sumar
  const porPeso = registros?.porPeso ?? false
  const sinUno = registros?.sinUno ?? false
  const hojas: HojaRegistro[] = [nuevaHoja(porPeso)]
  let inicio = 0 // renglón donde empieza la franja actual (el de las fechas)
  let columna = 0 // próxima columna libre de la franja
  let alto = 0 // renglones que ocupa la franja actual, fecha incluida

  const hoja = (): HojaRegistro => hojas[hojas.length - 1]
  const entra = (col: number, bloque: BloqueDia): boolean =>
    col < COLUMNAS_REGISTRO && inicio + 1 + bloque.celdas.length <= limiteColumna(hoja())
  const nuevaFranja = (): void => {
    inicio += alto
    columna = 0
    alto = 0
  }
  const nuevaPagina = (): void => {
    hojas.push(nuevaHoja(porPeso, FILAS_REGISTRO + FILAS_EXTRA_CONTINUACION))
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
          h.kg = redondearPeso(h.kg + c.peso)
          h.to = redondearPeso(h.to + (conCantidad && !porPeso ? (c.cantidad ?? 0) : c.peso))
          h.bobinas = redondearPeso(h.bobinas + (c.cantidad ?? 0))
        }
      })
      altoDia = Math.max(altoDia, 1 + bloque.celdas.length)
    })
    // Una separación fina a la izquierda del día, a todo su alto, para ubicar de
    // un vistazo qué pesajes son de qué día.
    for (let f = inicio; f < inicio + altoDia; f++) h.separa[f][columna] = true
    alto = Math.max(alto, altoDia)
    columna += tramo.length
  }

  for (const dia of registros?.dias ?? []) {
    let pendientes = bloquesDelDia(dia, conCantidad, porPeso, sinUno)
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
        nuevaPagina()
      } else {
        // Un bloque que no entra en una hoja vacía no puede existir (el más alto
        // ocupa 1 + 10 + 1 + 3 = 15 renglones de 33), pero si pasara no hay que
        // colgarse en un bucle infinito.
        throw new Error('Un bloque de pesajes no entra en una hoja vacía')
      }
    }
  }
  // El total del pie es acumulado: cada hoja suma lo suyo más lo de las anteriores,
  // así la última muestra el total de la OT (pedido de Elias, 2026-10-22).
  let to = 0
  let kg = 0
  let bobinas = 0
  for (const h of hojas) {
    to = redondearPeso(to + h.to)
    kg = redondearPeso(kg + h.kg)
    bobinas = redondearPeso(bobinas + h.bobinas)
    h.to = to
    h.kg = kg
    h.bobinas = bobinas
  }
  return hojas
}

/** Una celda del registro, con su estilo inline (así sale igual en pantalla, PDF y
 * Word, que no aplica bien las clases). */
function tdRegistro(span: number, html: string, css = '', atributos = ''): string {
  return `<td colspan="${span}" width="${ANCHO_COLUMNA_PX * span}"${atributos} style="${BASE_CELDA};padding:0 2.5pt;font-size:8pt;white-space:nowrap;overflow:hidden;${css}">${html}</td>`
}

/** Letra más chica para un texto que no entra en `casillas` casillas: nada
 * puede quedar cortado en el papel. */
function ajustarTexto(texto: string, casillas: number, tamano: number, negrita: boolean): string {
  // ~0.58 y ~0.52 veces el tamaño por carácter, en Arial negrita y normal.
  const porCaracter = negrita ? 0.58 : 0.52
  const disponible = casillas * ANCHO_COLUMNA_PT - 5
  const cabe = disponible / (Math.max(1, texto.length) * porCaracter)
  return `font-size:${Math.max(5.5, Math.min(tamano, Math.floor(cabe * 2) / 2))}pt;`
}

// Una casilla (o varias unidas) de una columna de pesajes.
interface Parte {
  casillas: number
  html: string
  css: string
  /** Dato que se corrige con un clic en la vista previa (`data-campo`). */
  campo?: string
  /** Se dibuja con la marca naranja (hoy: N° del SID para revisar). */
  marcado?: boolean
}

function parteResumen(texto: string, casillas: number): Parte {
  return {
    casillas,
    html: esc(texto),
    css: `background:${GRIS_TOTAL};font-weight:bold;${ajustarTexto(texto, casillas, 7.5, true)}`
  }
}

/** Las casillas de una columna de pesajes en un renglón (8, o las de la fecha si
 * abarca varias columnas; ninguna si está cubierta por una fecha). `conLineas`
 * solo en el formato en blanco: deja las líneas para escribir a mano. */
function partesRegistro(c: CeldaRegistro | null, conCantidad: boolean, conLineas: boolean): Parte[] {
  // Casillas de N° y de peso/cantidad dentro de las 8 de la columna.
  const nW = conCantidad ? 2 : 3
  const pW = conCantidad ? 3 : 5
  const cW = ANCHO_COLUMNA_REGISTRO - nW - pW
  const derecha = 'text-align:right;'
  if (c === null) {
    const linea = conLineas ? `border-bottom:${LINEA_FINA};` : ''
    return conCantidad
      ? [{ casillas: nW, html: '', css: linea }, { casillas: pW, html: '', css: linea }, { casillas: cW, html: '', css: linea }]
      : [{ casillas: nW, html: '', css: linea }, { casillas: pW, html: '', css: linea }]
  }
  if (c.tipo === 'cubierta') return []
  if (c.tipo === 'fecha') {
    const texto = c.continua ? `${c.fecha} (cont.)` : c.fecha
    const casillas = ANCHO_COLUMNA_REGISTRO * c.columnas
    return [
      {
        casillas,
        html: esc(texto),
        css: `background:${GRIS_FECHA};font-weight:bold;text-align:center;${ajustarTexto(texto, casillas, 8.5, true)}`
      }
    ]
  }
  if (c.tipo === 'resumen') {
    const d = c.dia
    if (c.renglon === 1) {
      // En Kg el To es el peso, así que en vez de repetirlo como "Kg" va el total de bobinas.
      return [
        parteResumen(`To = ${numero(d.to, 2)}`, 4),
        parteResumen(c.porPeso ? `Bo = ${numero(d.bobinas, 0)}` : `Kg = ${numero(d.kg, 2, 2)}`, 4)
      ]
    }
    if (c.renglon === 2) {
      return [
        parteResumen(`Pq = ${d.paquetes}`, 3),
        parteResumen(`Per. = ${d.pesadores.join(', ')}`, 5)
      ]
    }
    const porcentaje = d.porcentaje !== null ? `${Math.round(d.porcentaje)}%` : ''
    // El N° del SID lo anota una persona (el sistema no lo calcula): se escribe
    // con un clic en esta casilla de la vista previa.
    const numeroSid = parteResumen(d.numeroSid ?? '', 3)
    if (d.fechaIso) {
      numeroSid.campo = `sid.${d.fechaIso}`
      numeroSid.marcado = d.sidRevisar
    }
    return [parteResumen('Nº =', 2), numeroSid, parteResumen(porcentaje, 3)]
  }
  if (c.tipo === 'subtotal') {
    // El subtotal del grupo: en negrita, con una línea fina arriba.
    const sub = `${derecha}border-top:${LINEA_SUBTOTAL};font-weight:bold;font-size:8.5pt;`
    return conCantidad
      ? [
          { casillas: nW, html: '', css: `border-top:${LINEA_SUBTOTAL};` },
          { casillas: pW, html: numero(c.peso, 2, 2), css: sub },
          { casillas: cW, html: c.cantidad !== null ? numero(c.cantidad, 0) : '', css: sub }
        ]
      : [
          { casillas: nW, html: '', css: `border-top:${LINEA_SUBTOTAL};` },
          { casillas: pW, html: numero(c.peso, 2, 2), css: sub }
        ]
  }
  const peso = `${derecha}font-size:8.5pt;`
  const n: Parte = { casillas: nW, html: String(c.numero), css: `${derecha}color:#666;font-size:7pt;` }
  return conCantidad
    ? [n, { casillas: pW, html: numero(c.peso, 3, 2), css: peso }, { casillas: cW, html: c.cantidad !== null && !(c.sinUno && c.cantidad === 1) ? numero(c.cantidad, 0) : '', css: peso }]
    : [n, { casillas: pW, html: numero(c.peso, 3, 2), css: peso }]
}

function htmlCeldaRegistro(
  ctx: Contexto,
  hoja: HojaRegistro,
  fila: number,
  columna: number,
  conCantidad: boolean,
  conLineas: boolean
): string {
  const partes = partesRegistro(hoja.celdas[fila][columna], conCantidad, conLineas)
  // La separación fina va a la izquierda de la primera casilla del día (menos en
  // la 1ª columna, donde ya está el marco de la hoja).
  const separa = hoja.separa[fila][columna] && columna > 0
  return partes
    .map((parte, i) => {
      const atributos =
        ctx.editable && parte.campo ? ` data-campo="${parte.campo}"${parte.marcado ? ' data-editado="1"' : ''}` : ''
      return tdRegistro(
        parte.casillas,
        parte.html,
        `${parte.css}${i === 0 && separa ? `border-left:${SEPARADOR_DIA};` : ''}`,
        atributos
      )
    })
    .join('')
}

/** El pie: total de la hoja y el recuadro de firmas en una franja de 3 renglones. */
function pieRegistro(hoja: HojaRegistro, conCantidad: boolean, alto: string, pagina: string): string {
  const fila = (celdas: string): string => `<tr ${alto}>${celdas}</tr>`
  const izquierda = `border-left:${MARCO};`
  const derecha = `border-right:${MARCO};`
  const rotulo = 'font-weight:bold;font-size:7.5pt;'
  const total =
    hoja.pesajes > 0
      ? hoja.porPeso
        ? `To Acum. = ${numero(hoja.to, 2, 2)} &nbsp;&nbsp;&nbsp; Bo = ${numero(hoja.bobinas, 0)}`
        : `To Acum. = ${numero(hoja.to, 2)} &nbsp;&nbsp;&nbsp; Kg = ${numero(hoja.kg, 2, 2)}`
      : hoja.porPeso
        ? 'To Acum. = &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Bo ='
        : 'To Acum. = &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Kg ='
  return [
    fila(
      tdRegistro(
        34,
        total,
        `${izquierda}${derecha}border-top:${MARCO};background:${GRIS_TOTAL};font-weight:bold;text-align:center;font-size:8.5pt;`
      )
    ),
    fila(
      tdRegistro(5, 'Verificado Por:', `${izquierda}border-top:${SEPARADOR_DIA};${rotulo}`) +
        tdRegistro(12, '', `border-top:${SEPARADOR_DIA};border-bottom:${LINEA_FINA};`) +
        tdRegistro(3, 'Fecha:', `border-top:${SEPARADOR_DIA};${rotulo}text-align:right;`) +
        tdRegistro(6, '', `border-top:${SEPARADOR_DIA};border-bottom:${LINEA_FINA};`) +
        tdRegistro(3, 'Hora:', `border-top:${SEPARADOR_DIA};${rotulo}text-align:right;`) +
        tdRegistro(5, '', `border-top:${SEPARADOR_DIA};border-bottom:${LINEA_FINA};${derecha}`)
    ),
    fila(
      tdRegistro(5, 'OT Concluida:', `${izquierda}border-bottom:${MARCO};${rotulo}`) +
        tdRegistro(2, 'Si', `border-bottom:${MARCO};text-align:right;${rotulo}`) +
        tdRegistro(2, '', `border:${MARCO};`) +
        tdRegistro(2, 'No', `border-bottom:${MARCO};text-align:right;${rotulo}`) +
        tdRegistro(2, '', `border:${MARCO};`) +
        tdRegistro(3, 'Area:', `border-bottom:${MARCO};text-align:right;${rotulo}`) +
        tdRegistro(8, '', `border-bottom:${MARCO};`) +
        tdRegistro(10, 'Firma y sello:', `border-bottom:${MARCO};${rotulo}${derecha}`)
    ),
    // El número de hoja ("1-2") va fuera del marco, centrado abajo, como el
    // pie de página de un documento.
    fila(tdRegistro(34, pagina, 'text-align:center;font-size:8.5pt;font-weight:bold;'))
  ].join('\n')
}

/** Todos los renglones de una hoja del registro y su pie. Las 4 columnas de 8
 * casillas van con una casilla de margen a cada lado (1 + 32 + 1 = 34). */
function filasRegistro(ctx: Contexto, hoja: HojaRegistro, conCantidad: boolean, pagina: string): string {
  const alto = altoFila(ctx.paraWord ? ALTO_FILA_CUADRICULA_WORD_PT : ALTO_FILA_CUADRICULA_PT)
  // Sin pesajes (el formato en blanco) los renglones conservan sus líneas para
  // poder escribir a mano; con pesajes quedan limpios.
  const enBlanco = hoja.pesajes === 0
  const filas: string[] = []
  for (let fila = 0; fila < hoja.celdas.length; fila++) {
    const columnas = Array.from({ length: COLUMNAS_REGISTRO }, (_, c) => htmlCeldaRegistro(ctx, hoja, fila, c, conCantidad, enBlanco)).join('')
    filas.push(
      `<tr ${alto}>${tdRegistro(1, '', `border-left:${MARCO};`)}${columnas}${tdRegistro(1, '', `border-right:${MARCO};`)}</tr>`
    )
  }
  return `${filas.join('\n')}\n${pieRegistro(hoja, conCantidad, alto, pagina)}`
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
  return repartirRegistro(datos.registros).length
}

export function generarHtmlFormularioPt(
  datos: DatosFormularioPt = {},
  opciones: {
    paraWord?: boolean
    soloHoja?: number
    /** Vista previa en pantalla: los datos se pueden corregir con un clic. `editados`
     * son las claves ya corregidas, que se dibujan con su marca naranja. */
    editable?: { editados: string[] }
  } = {}
): string {
  const ctx: Contexto = {
    paraWord: opciones.paraWord ?? false,
    editable: !opciones.paraWord && opciones.editable !== undefined,
    editados: new Set(opciones.editable?.editados ?? [])
  }
  const hojas = repartirRegistro(datos.registros)
  // Sin pesajes cargados (el formato en blanco) se dibujan los dos lugares, peso y
  // cantidad (en Kg y Bob son las bobinas pesadas juntas).
  const conCantidad = datos.registros?.conCantidad ?? true
  const elegidas =
    opciones.soloHoja !== undefined
      ? [hojas[opciones.soloHoja] ?? nuevaHoja(datos.registros?.porPeso ?? false)]
      : hojas
  const primeraElegida = opciones.soloHoja ?? 0
  // El salto va en un div aparte con estilo inline (no en la tabla): Word no
  // respeta page-break-after sobre un <table> — mismo arreglo que formularioMp.
  const cuerpo = elegidas
    .map((hoja, i) => tablaFormulario(ctx, datos, hoja, conCantidad, primeraElegida + i, hojas.length))
    .join('\n<div style="page-break-after:always"></div>\n')

  return documentoFormulario(ctx, cuerpo)
}

function tablaFormulario(
  ctx: Contexto,
  datos: DatosFormularioPt,
  hoja: HojaRegistro,
  conCantidad: boolean,
  indiceHoja: number,
  totalHojas: number
): string {
  // Desde la 2ª hoja el encabezado lleva solo cliente, OT y pedido total.
  const continuacion = indiceHoja > 0
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
${celdaCampo(ctx, estiloClienteValor(datos.cliente), COLS_CLIENTE_VALOR, 'cliente')}${esc(datos.cliente)}</td>
${celda(ctx, 'ot-rotulo', COLS_OT_ROTULO)}N&ordm; OT.:</td>
${casillasNumeroOt(ctx, datos.numeroOt)}
</tr>
${continuacion ? `<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'lat-izq', 16)}</td>
${celda(ctx, 'pedido-total', 5)}Pedido Total</td>
${celdaCampo(ctx, 'total', 3, 'pedidoTotal')}${esc(datos.pedidoTotal) || '0.00'}</td>
${celda(ctx, 'cierre-der', 10)}</td>
</tr>
` : `<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'lat-izq', 3)}</td>
${celda(ctx, 'cabecera-col', 3)}CODIGO</td>
${celda(ctx, 'cabecera-col', 15)}PRODUCTO</td>
${celdaCampo(ctx, 'unidad-rotulo', 3, 'unidad')}${esc(datos.unidad) || '(unidad)'}</td>
${celda(ctx, 'rot-b', 4)}Fecha Pedido:</td>
${celdaCampo(ctx, 'valor-linea', 6, 'fechaPedido')}${esc(datos.fechaPedido)}</td>
</tr>
${filaTem(ctx, 1, item(0), 'Fecha Entrega', datos.fechaEntrega ?? '', 'fechaEntrega')}
${filaTem(ctx, 2, item(1), 'Comercial:', datos.comercial ?? '', 'comercial')}
${filaTem(ctx, 3, item(2), 'Ciudad:', datos.ciudad ?? '', 'ciudad')}
${filaTem(ctx, 4, item(3), 'Moneda:', datos.moneda ?? '')}
${filaTem(ctx, 5, item(4), 'Nuevo:', datos.nuevo ?? '', 'nuevo')}
<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'lat-izq', 16)}</td>
${celda(ctx, 'pedido-total', 5)}Pedido Total</td>
${celdaCampo(ctx, 'total', 3, 'pedidoTotal')}${esc(datos.pedidoTotal) || '0.00'}</td>
${celda(ctx, 'rot-b', 4)}Rc-Arte:</td>
${celdaCampo(ctx, 'valor-linea', 6, 'rcArte')}${esc(datos.rcArte)}</td>
</tr>
<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'rot-der', 5)}Condiciones:</td>
${celdaCampo(ctx, 'dato-linea', 19, 'condiciones')}${esc(datos.condiciones)}</td>
${celda(ctx, 'rot-b', 4)}Muestra:</td>
${celdaCampo(ctx, 'valor-linea', 6, 'muestra')}${esc(datos.muestra)}</td>
</tr>
<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${celda(ctx, 'rot-der', 5)}Observaciones:</td>
${celdaCampo(ctx, 'dato-linea', 19, 'observaciones')}${esc(datos.observaciones)}</td>
${celda(ctx, 'rot-b', 4)}Entrega Total:</td>
${celdaCampo(ctx, 'valor-linea', 6, 'entregaTotal')}${esc(datos.entregaTotal)}</td>
</tr>
`}
<tr ${altoFila(ALTO_REGISTRAR_PT)}>
${celda(ctx, 'registrar', COLUMNAS)}Registro de pesos (N&ordm; = N&ordm; de la etiqueta del paquete)</td>
</tr>
${filasRegistro(ctx, hoja, conCantidad, `${indiceHoja + 1}-${totalHojas}`)}
</tbody>
</table>`
}

// Solo en la vista previa (nunca en el PDF ni el Word): resalta los datos que se
// pueden corregir con un clic, y marca con un lápiz naranja los ya corregidos.
const LAPIZ_NARANJA =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23d97706' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'/></svg>\")"
const ESTILOS_EDICION = `
  [data-campo] { cursor: text; }
  [data-campo]:hover { outline: 1.5px dashed #0e7490; outline-offset: -1px; background-color: #ecfeff; }
  [data-campo][data-editado] { box-shadow: inset 0 0 0 1.5px #d97706; background-image: ${LAPIZ_NARANJA}; background-repeat: no-repeat; background-position: right 2px top 2px; background-size: 9px 9px; }
  [data-campo][contenteditable] { outline: 2px solid #0e7490; outline-offset: -1px; background-color: #ffffff; background-image: none; cursor: text; }
`

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
<style>${ESTILOS}${ctx.editable ? ESTILOS_EDICION : ''}</style>
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
// dice "BOLSAS" sobre la columna de totales). La bobina va como "Bob" y la
// lámina como "lamina": tal cual las escribe el Excel, que es como las
// reconoce la planta (no abreviarlas ni cambiarles la forma).
export const ROTULO_UNIDAD_PT: Record<UnidadPt, string> = {
  KG: 'Kg',
  BOLSAS: 'BOLSAS',
  MILLAR: 'Mill',
  BOBINA: 'Bob',
  LAMINA: 'lamina'
}

/** ¿Cada pesaje lleva cantidad además del peso? Siempre: en Bolsas/Mill/lamina
 * son las unidades del paquete y en Kg/Bob las bobinas que se pesaron juntas
 * (las chicas se empacan de a 5 o 7 y se pesan como una; 1 por defecto, pedido
 * de Elias 2026-10-22). Se deja como función por si alguna unidad futura no la lleva. */
export function llevaCantidad(_unidad: UnidadPt): boolean {
  return true
}

/** ¿La cantidad del pesaje cuenta bobinas (y no bolsas/láminas)? */
export function cantidadEsBobinas(unidad: UnidadPt): boolean {
  return unidad === 'KG' || unidad === 'BOBINA'
}

/** ¿El To / avance se mide con esa cantidad? No en Kg: ahí avanza por peso. */
export function avanzaPorCantidad(unidad: UnidadPt): boolean {
  return unidad !== 'KG'
}

/** Rótulo de la cantidad de un pesaje: "bobinas", "bolsas" o "láminas". */
export function nombreEnvases(unidad: UnidadPt, cantidad?: number): string {
  if (cantidadEsBobinas(unidad)) return cantidad === 1 ? 'bobina' : 'bobinas'
  return NOMBRE_CANTIDAD_PT[unidad]
}

/** En qué se cuenta lo pesado (el To y la cantidad de cada paquete). En una OT
 * en millares el pedido se escribe en millares, pero cada paquete se cuenta en
 * bolsas (Elias), así que el To también va en bolsas. */
export const NOMBRE_CANTIDAD_PT: Record<UnidadPt, string> = {
  KG: 'kg',
  BOLSAS: 'bolsas',
  MILLAR: 'bolsas',
  BOBINA: 'bobinas',
  LAMINA: 'láminas'
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
  return aplicarEdiciones(datosOriginalesDesdePt(pt, pesajes), pt.ediciones)
}

// Campos de texto del formulario que se pueden corregir a mano. Las claves son
// las de DatosFormularioPt y las mismas que acepta el backend
// (producto_terminado_controller._CAMPOS_EDITABLES): si se agrega una, va en los dos.
export const CAMPOS_EDITABLES_FORMULARIO_PT = [
  { clave: 'cliente', etiqueta: 'Cliente' },
  { clave: 'unidad', etiqueta: 'Unidad' },
  { clave: 'pedidoTotal', etiqueta: 'Pedido Total' },
  { clave: 'fechaPedido', etiqueta: 'Fecha Pedido' },
  { clave: 'fechaEntrega', etiqueta: 'Fecha Entrega' },
  { clave: 'comercial', etiqueta: 'Comercial' },
  { clave: 'ciudad', etiqueta: 'Ciudad' },
  { clave: 'nuevo', etiqueta: 'Nuevo' },
  { clave: 'rcArte', etiqueta: 'Rc-Arte' },
  { clave: 'muestra', etiqueta: 'Muestra' },
  { clave: 'entregaTotal', etiqueta: 'Entrega Total' },
  { clave: 'condiciones', etiqueta: 'Condiciones' },
  { clave: 'observaciones', etiqueta: 'Observaciones' }
] as const

export type CampoItemFormularioPt = keyof ItemFormularioPt

/** Clave de una corrección de un renglón de ITEM (n desde 0): "items.0.codigo". */
export function claveItemFormularioPt(n: number, campo: CampoItemFormularioPt): string {
  return `items.${n}.${campo}`
}

/** Lo que el formulario trae hoy en un campo (clave general o "items.N.campo"). */
export function valorCampoFormularioPt(datos: DatosFormularioPt, clave: string): string {
  const partes = clave.split('.')
  if (partes[0] === 'items') {
    const item = datos.items?.[Number(partes[1])]
    return item?.[partes[2] as CampoItemFormularioPt] ?? ''
  }
  return (datos as Record<string, unknown>)[clave] === undefined ? '' : String((datos as Record<string, unknown>)[clave])
}

/** Las correcciones de la OT después de escribir `texto` en `clave`. Escribir lo
 * mismo que el original no cuenta como corregido (se quita la corrección). */
export function edicionesTrasEditar(pt: ProductoTerminado, clave: string, texto: string): Record<string, string> {
  const original = datosFormularioDesdePt({ ...pt, ediciones: {} })
  const ediciones = { ...pt.ediciones }
  const limpio = texto.trim()
  if (limpio === valorCampoFormularioPt(original, clave)) delete ediciones[clave]
  else ediciones[clave] = limpio
  return ediciones
}

/** Pone encima de los datos de la OT las correcciones hechas a mano. Una
 * corrección vacía es válida: deja el campo en blanco. */
function aplicarEdiciones(datos: DatosFormularioPt, ediciones: Record<string, string> | undefined): DatosFormularioPt {
  if (!ediciones) return datos
  const resultado: DatosFormularioPt = { ...datos, items: (datos.items ?? []).map((item) => ({ ...item })) }
  for (const [clave, texto] of Object.entries(ediciones)) {
    const partes = clave.split('.')
    if (partes[0] === 'items') {
      const n = Number(partes[1])
      while (resultado.items!.length <= n) resultado.items!.push({})
      resultado.items![n][partes[2] as CampoItemFormularioPt] = texto
    } else {
      ;(resultado as Record<string, unknown>)[clave] = texto
    }
  }
  return resultado
}

function datosOriginalesDesdePt(pt: ProductoTerminado, pesajes?: PesajesPt): DatosFormularioPt {
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
    conCantidad: llevaCantidad(unidad),
    porPeso: !avanzaPorCantidad(unidad),
    sinUno: cantidadEsBobinas(unidad),
    dias: datos.dias.map((dia) => ({
      fecha: formatearFecha(dia.fecha),
      pesajes: datos.pesajes
        .filter((p) => p.fecha === dia.fecha)
        .sort((a, b) => a.numero - b.numero)
        .map((p) => ({ numero: p.numero, neto: p.peso_neto, cantidad: p.cantidad })),
      to: dia.to,
      kg: dia.kg,
      paquetes: dia.paquetes,
      bobinas: dia.bobinas,
      fechaIso: dia.fecha,
      numeroSid: dia.numero_sid ?? undefined,
      sidRevisar: dia.sid_revisar,
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
