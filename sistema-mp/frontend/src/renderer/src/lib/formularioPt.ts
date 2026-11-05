import { LOGO_ZEPOL_BASE64 } from './logoZepol'
import { formatearFecha } from './fechas'
import { redondearPeso } from './utils'
import { anchoTextoPt, renglonesNecesarios, tamanoQueEntra } from './anchoTexto'
import type { PesajesPt, ProductoTerminado, ProductoTerminadoItem, UnidadPt } from './types'
import { altoFila, envolverEnMhtml, escaparHtml, URL_LOGO_MHTML } from './documentoWord'

// Réplica del formulario en papel "P-LOG-001-F-04" (FORMULARIO DE INGRESO DE
// PRODUCTOS TERMINADOS A ALMACENES), carta HORIZONTAL.
//
// Diseño de "form PT (1).xlsx" (2026-10-27, pedido de Elias): encabezado con
// columnas N° / Código / Descripción / Cantidad / Med., y el registro de pesos
// en RECUADROS, uno por día (E. = quién pesó, F. = fecha, N° / Kg / Can. en una
// sola lista y debajo To, Pq, % y N° No). Hoja HORIZONTAL con 8 recuadros en
// una fila, como el Excel (Elias, 2026-10-27: primero se hizo vertical con 5 y
// después con 8 en 2 filas, y pidió "todo en horizontal").
// Se le agregaron el logo y el pie de firmas, que el Excel no tenía.
//
// Historia (no volver atrás sin que lo pidan): antes los pesajes iban en
// columnas de 10 con su subtotal y los días seguidos en horizontal, sin
// recuadros. Lo reemplazó este diseño.
//
// Toda celda lleva su estilo inline: Word solo aplica la primera clase de un
// `class="a b"` y no respeta reglas de descendencia, y así pantalla, PDF, Word
// y Excel salen iguales.
// 63 columnas: 8 recuadros de 7 más 7 de separación (ver Registro de pesos).
// 63 es el MÁXIMO de columnas de una tabla de Word: con 71 Word juntaba las
// sobrantes y desarmaba los recuadros de la derecha.
const COLUMNAS = 63
// Carta horizontal (11 × 8.5in) con márgenes de 0.5in arriba/abajo y 0.45in a
// los lados: 727.2pt útiles de ancho. Cada columna mide 11.45pt exactos (229
// twips), así los bordes de las celdas caen en el mismo lugar en todas las filas
// también en Word. 63 × 11.45 = 721.35pt, unos pt menos que el ancho útil: con
// border-collapse el trazo grueso se sale medio ancho por cada lado, y con la
// tabla justo al ancho útil el borde derecho salía cortado (Word y PDF).
const ANCHO_COLUMNA_PT = 11.45
const ANCHO_CONTENIDO_PT = ANCHO_COLUMNA_PT * COLUMNAS
const ANCHO_COLUMNA_PX = (ANCHO_COLUMNA_PT * 96) / 72
const ALTO_ENCABEZADO_PT = 44.2
const ALTO_CLIENTE_PT = 28
const ALTO_FILA_DATOS_PT = 15
const ALTO_SEPARACION_PT = 6
const ALTO_FILA_REGISTRO_PT = 11
// Word siempre agrega un párrafo vacío después de una tabla. Con la altura
// exacta ese párrafo no entra y genera una hoja en blanco, así que la versión
// .doc usa renglones apenas más bajos para dejarle lugar.
const ALTO_FILA_REGISTRO_WORD_PT = 10.85
// Espacio para la firma dentro del recuadro de firmas.
const ALTO_FILA_FIRMA_PT = 18

const GRUESA = '1pt solid #000'
const FINA = '0.75pt solid #444'
const LINEA_ESCRIBIR = '0.5pt solid #bbb'
const GRIS_TOTAL = '#D9D9D9'

const BASE_CELDA =
  'padding:0 2pt;vertical-align:middle;line-height:1.05;font-size:8.5pt;white-space:nowrap;overflow:hidden;mso-line-height-rule:exactly'

export interface ItemFormularioPt {
  codigo?: string
  producto?: string
  total?: string
}

/** Un pesaje escrito en el recuadro de su día: el peso NETO (la tara no va) y
 * la cantidad del paquete. */
export interface PesajeFormularioPt {
  /** N° BOB/PAQ de la etiqueta. */
  numero: number
  neto: number
  cantidad: number | null
  /** De qué ITEM es (OT de varios productos); null/ausente = sin separar. */
  item?: number | null
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
  /** true en Kg: el avance (To del pie y %) es el peso, no la suma de las cantidades. */
  porPeso: boolean
  /** Kg y Bob: una bobina por pesaje es lo normal y no se anota en el papel;
   * solo se escribe cuando son 2 o más (pedido de Elias, 2026-10-22). */
  sinUno?: boolean
  /** Solo en una OT de 2+ ítems: los productos (en orden) y su nombre corto.
   * Con esto cada recuadro es un día + un producto. */
  items?: { numero: number; nombre: string }[]
  dias: DiaFormularioPt[]
}

export interface DatosFormularioPt {
  /** Pesajes para escribir en los recuadros. Sin esto, los recuadros salen
   * vacíos para llenar a mano. */
  registros?: RegistrosFormularioPt
  cliente?: string
  numeroOt?: string
  items?: ItemFormularioPt[]
  /** Unidad que va en "Med.": "Kg", "BOLSAS", "Mill"... */
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
  /** Ya no se imprime (el formulario nuevo no tiene Observaciones); se conserva
   * porque puede haber correcciones guardadas con esta clave. */
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

/** Dato que se corrige con un clic en la vista previa. */
interface Campo {
  clave: string
  /** Se dibuja con la marca naranja (corregido, o N° del SID para revisar). */
  marcado?: boolean
}

function campo(ctx: Contexto, clave: string): Campo {
  return { clave, marcado: ctx.editados?.has(clave) }
}

/** Un `<td>` de `casillas` columnas de la grilla, con su estilo inline. */
function td(ctx: Contexto, casillas: number, html: string, css = '', dato?: Campo): string {
  const span = casillas > 1 ? ` colspan="${casillas}"` : ''
  const atributos =
    ctx.editable && dato ? ` data-campo="${dato.clave}"${dato.marcado ? ' data-editado="1"' : ''}` : ''
  // En Word el ancho va en pt (exacto); el atributo en px se redondearía.
  const ancho = ctx.paraWord
    ? ''
    : ` width="${Math.round(ANCHO_COLUMNA_PX * casillas)}"`
  const anchoWord = ctx.paraWord ? `;width:${Math.round(ANCHO_COLUMNA_PT * casillas * 100) / 100}pt` : ''
  return `<td${span}${ancho}${atributos} style="${BASE_CELDA};${css}${anchoWord}">${html}</td>`
}

/** Tamaño de letra con el que `texto` entra en una línea de `casillas` columnas. */
function letraQueEntra(texto: string, casillas: number, tamanos: number[], relleno = 4): string {
  return `font-size:${tamanoQueEntra(texto, casillas * ANCHO_COLUMNA_PT - relleno, tamanos)}pt;`
}

/** Un texto largo (descripción del producto, cliente) que tiene que caber en su
 * celda sin agrandar la fila: primero se achica en una línea (hasta `minimoUnaLinea`)
 * y, si no alcanza, se parte en renglones con interlineado exacto (si no, Word
 * usa ~1.15× y lo recorta). */
function letraEnVariosRenglones(
  texto: string,
  casillas: number,
  alto: number,
  tamanos: number[],
  minimoUnaLinea = 7
): string {
  const ancho = casillas * ANCHO_COLUMNA_PT - 4
  for (const pt of tamanos) {
    if (pt >= minimoUnaLinea && anchoTextoPt(texto, pt) <= ancho) return `font-size:${pt}pt;`
  }
  for (const pt of tamanos) {
    const interlineado = Math.round(pt * 1.1 * 10) / 10
    if (renglonesNecesarios(texto, pt, ancho) * interlineado <= alto - 0.5) {
      return `font-size:${pt}pt;white-space:normal;line-height:${interlineado}pt;`
    }
  }
  const menor = tamanos[tamanos.length - 1]
  return `font-size:${menor}pt;white-space:normal;line-height:${menor}pt;`
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

// --- Encabezado ---------------------------------------------------------
//
// Columnas (suman 34): ITEM 3 | Código 3 | Descripción 8 | Cantidad 3 | Med. 3 |
// rótulo 3 + valor 3 (Comercial, Ciudad, Moneda) | rótulo 5 + valor 3 (fechas,
// Nuevo, Rc-Arte, Muestra, Ent. Total).

// 7pt: a 7.5pt "Comercial:" y "Condición:" no entran en sus 5 columnas y Word los parte.
const ROTULO_DERECHA = 'font-weight:bold;font-size:7pt;text-align:right;padding-right:2pt;'
const CABECERA_ITEMS = `border:${GRUESA};font-weight:bold;font-size:8pt;text-align:center;`
const VALOR_LINEA = `border-bottom:${FINA};text-align:center;`
const TAMANOS_DATO = [8.5, 8, 7.5, 7, 6.5, 6]

function filaTitulo(ctx: Contexto): string {
  const logo = ctx.paraWord ? URL_LOGO_MHTML : LOGO_ZEPOL_BASE64
  return `<tr ${altoFila(ALTO_ENCABEZADO_PT)}>
${td(ctx, 9, `<img class="logo" src="${logo}" alt="Zepol" width="58" height="48">`, `border:${GRUESA};text-align:center;padding:0;`)}
${td(ctx, 35, 'FORMULARIO DE INGRESO DE<br>PRODUCTOS TERMINADOS A ALMACENES', `border:${GRUESA};font-size:13pt;font-weight:bold;text-align:center;line-height:1.12;white-space:normal;`)}
${td(ctx, 5, 'C&oacute;digo', `border:${GRUESA};font-size:10pt;text-align:center;`)}
${td(ctx, 14, 'P-LOG-001-F-04/V.4.0', `border:${GRUESA};font-size:9.5pt;font-weight:bold;text-align:center;`)}
</tr>`
}

function filaCliente(ctx: Contexto, datos: DatosFormularioPt): string {
  const cliente = datos.cliente ?? ''
  const numeroOt = (datos.numeroOt ?? '').trim()
  const abajo = 'vertical-align:bottom;padding-bottom:3pt;'
  return `<tr ${altoFila(ALTO_CLIENTE_PT)}>
${td(ctx, 7, 'Cliente:', `${abajo}font-size:11pt;font-weight:bold;`)}
${td(ctx, 37, esc(cliente), `${abajo}font-weight:bold;text-align:center;${letraEnVariosRenglones(cliente, 37, ALTO_CLIENTE_PT, [14, 13, 12, 11, 10, 9, 8])}`, campo(ctx, 'cliente'))}
${td(ctx, 7, 'N&ordm; OT:', `${abajo}font-size:11pt;font-weight:bold;text-align:right;`)}
${td(ctx, 12, esc(numeroOt), `${abajo}font-weight:bold;text-align:center;${letraQueEntra(numeroOt, 12, [15, 14, 13, 12, 11, 10, 9])}`)}
</tr>`
}

/** Rótulo + valor de las dos columnas de la derecha. `clave` undefined = no se
 * corrige en la hoja (la moneda, que se elige con sus botones). */
interface DatoDerecha {
  rotulo: string
  valor: string
  clave?: string
}

function celdasDerecha(ctx: Contexto, casillasRotulo: number, casillasValor: number, dato: DatoDerecha | null): string {
  if (!dato) return td(ctx, casillasRotulo + casillasValor, '')
  return (
    td(ctx, casillasRotulo, dato.rotulo, ROTULO_DERECHA) +
    td(ctx, casillasValor, esc(dato.valor), `${VALOR_LINEA}${letraQueEntra(dato.valor, casillasValor, TAMANOS_DATO)}`, dato.clave ? campo(ctx, dato.clave) : undefined)
  )
}

function filasItems(ctx: Contexto, datos: DatosFormularioPt): string {
  const items = datos.items ?? []
  const unidad = datos.unidad ?? ''
  // Filas 0 (la de los títulos) a 5 (ITEM 5).
  const comercial: (DatoDerecha | null)[] = [
    { rotulo: 'Comercial:', valor: datos.comercial ?? '', clave: 'comercial' },
    { rotulo: 'Ciudad:', valor: datos.ciudad ?? '', clave: 'ciudad' },
    { rotulo: 'Moneda:', valor: datos.moneda ?? '' },
    null,
    null,
    null
  ]
  const fechas: DatoDerecha[] = [
    { rotulo: 'Fecha Pedido:', valor: datos.fechaPedido ?? '', clave: 'fechaPedido' },
    { rotulo: 'Fecha Entrega:', valor: datos.fechaEntrega ?? '', clave: 'fechaEntrega' },
    { rotulo: 'Nuevo:', valor: datos.nuevo ?? '', clave: 'nuevo' },
    { rotulo: 'Rc-Arte:', valor: datos.rcArte ?? '', clave: 'rcArte' },
    { rotulo: 'Muestra:', valor: datos.muestra ?? '', clave: 'muestra' },
    { rotulo: 'Ent. Total:', valor: datos.entregaTotal ?? '', clave: 'entregaTotal' }
  ]
  const derecha = (fila: number): string => celdasDerecha(ctx, 5, 6, comercial[fila]) + celdasDerecha(ctx, 9, 7, fechas[fila])

  const filas = [
    `<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${td(ctx, 5, 'N&ordm;', CABECERA_ITEMS)}${td(ctx, 5, 'C&oacute;digo', CABECERA_ITEMS)}${td(ctx, 15, 'Descripci&oacute;n', CABECERA_ITEMS)}${td(ctx, 5, 'Cantidad', CABECERA_ITEMS)}${td(ctx, 6, 'Med.', CABECERA_ITEMS)}
${derecha(0)}
</tr>`
  ]
  for (let n = 0; n < 5; n++) {
    const item = items[n] ?? {}
    const codigo = item.codigo ?? ''
    const producto = item.producto ?? ''
    const total = item.total ?? ''
    // La unidad se repite en cada ítem cargado, como en el Excel.
    const conItem = Boolean(codigo || producto || total)
    filas.push(`<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${td(ctx, 5, `ITEM ${n + 1}:`, 'font-weight:bold;font-size:8pt;')}
${td(ctx, 5, esc(codigo), `${VALOR_LINEA}${letraQueEntra(codigo, 5, TAMANOS_DATO)}`, campo(ctx, claveItemFormularioPt(n, 'codigo')))}
${td(ctx, 15, esc(producto), `${VALOR_LINEA}${letraEnVariosRenglones(producto, 15, ALTO_FILA_DATOS_PT, [8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5])}`, campo(ctx, claveItemFormularioPt(n, 'producto')))}
${td(ctx, 5, esc(total), `${VALOR_LINEA}${letraQueEntra(total, 5, TAMANOS_DATO)}`, campo(ctx, claveItemFormularioPt(n, 'total')))}
${td(ctx, 6, conItem ? esc(unidad) : '', `${VALOR_LINEA}${letraQueEntra(unidad, 6, TAMANOS_DATO)}`, conItem ? campo(ctx, 'unidad') : undefined)}
${derecha(n + 1)}
</tr>`)
  }
  return filas.join('\n')
}

/** Pedido Total (con su unidad) y, en la 1ª hoja, la condición. */
function filaPedidoTotal(ctx: Contexto, datos: DatosFormularioPt, conCondicion: boolean): string {
  const pedido = datos.pedidoTotal || '0.00'
  const unidad = datos.unidad ?? ''
  const recuadro = `border:${GRUESA};font-weight:bold;text-align:center;`
  return `<tr ${altoFila(ALTO_FILA_DATOS_PT)}>
${td(ctx, 25, 'Pedido Total:', 'font-weight:bold;font-size:9pt;text-align:right;padding-right:4pt;')}
${td(ctx, 5, esc(pedido), `${recuadro}${letraQueEntra(pedido, 5, [9.5, 9, 8.5, 8, 7.5, 7])}`, campo(ctx, 'pedidoTotal'))}
${td(ctx, 6, esc(unidad), `${recuadro}${letraQueEntra(unidad, 6, [9, 8.5, 8, 7.5, 7, 6.5, 6])}`, campo(ctx, 'unidad'))}
${
  conCondicion
    ? td(ctx, 5, 'Condici&oacute;n:', ROTULO_DERECHA) +
      td(ctx, 22, esc(datos.condiciones), `${VALOR_LINEA}${letraQueEntra(datos.condiciones ?? '', 22, TAMANOS_DATO)}`, campo(ctx, 'condiciones'))
    : td(ctx, 27, '')
}
</tr>`
}

// --- Registro de pesos --------------------------------------------------
//
// Cada día va en su recuadro (7 columnas: N° 2, Kg 3, Can. 2), con una columna
// de separación entre recuadros: 8 × 7 + 7 = 63. Un día que no entra en un
// recuadro sigue en el siguiente con la misma fecha "(cont.)". Cada recuadro
// suma su columna (peso y cantidad, renglón en negrita bajo los pesajes), y
// To, Pq, % y N° No son del DÍA: van una sola vez, en el último recuadro del
// día, con el total del día (Elias, OT 219988: un día partido en 3 recuadros
// salía con 3 To y 3 N° No, y el N° del SID se anota uno por día).
//
// OT de varios productos (ej. OT 58091: manzana, uva y limón; pedido de Elias
// 2026-10-27): en planta pesan un producto tras otro y en el papel separan el
// To de cada uno. Los productos van SEGUIDOS dentro del recuadro del día, en
// el orden en que se registraron: un renglón "P." con el nombre corto, sus
// pesajes y, en el último tramo de ese producto en el día, su To. Al final del
// día, "TOTAL DÍA" con To, Pq, % y N° No de todo. Historia (no volver atrás):
// primero cada producto abría su propio recuadro y, con productos de pocos
// pesajes, la hoja quedaba llena de huecos; después se probaron 2 filas de 8
// recuadros con 7 pesajes cada uno y a Elias no lo convenció ("antes estaba
// bien"). El % por producto solo se ve en la pantalla.

const RECUADROS_POR_FRANJA = 8
const FRANJAS_POR_HOJA = 1
const RECUADROS_POR_HOJA = RECUADROS_POR_FRANJA * FRANJAS_POR_HOJA
const CASILLAS_N = 2
const CASILLAS_KG = 3
const CASILLAS_CAN = 2
// Renglones de pesajes por recuadro (como el Excel original). Desde la 2ª hoja
// el encabezado se reduce (sin ítems ni fechas) y ese lugar se usa para más
// renglones. Con productos separados uno de ellos es el rótulo TOTAL DÍA.
const PESAJES_POR_RECUADRO = 17
const PESAJES_POR_RECUADRO_CONTINUACION = 25
// Nombre del grupo de pesajes "sin separar" de una OT de varios productos.
const SIN_SEPARAR = 'SIN SEPARAR'

/** Un renglón de la zona de pesajes de un recuadro. */
type Linea =
  | { tipo: 'pesaje'; pesaje: PesajeFormularioPt }
  /** Comienzo de un tramo de un producto ("P. LIMÓN"). */
  | { tipo: 'producto'; nombre: string; continua: boolean }
  /** To del producto en el día, al final de su último tramo. */
  | { tipo: 'toProducto'; pesajes: PesajeFormularioPt[] }

interface Recuadro {
  dia: DiaFormularioPt
  lineas: Linea[]
  /** Sigue un día que empezó en el recuadro anterior. */
  continua: boolean
  /** Último recuadro del día: solo ese lleva To, Pq, % y N° No. */
  ultimo: boolean
}

const pesajesDe = (lineas: Linea[]): PesajeFormularioPt[] =>
  lineas.flatMap((l) => (l.tipo === 'pesaje' ? [l.pesaje] : []))

interface HojaRegistro {
  recuadros: Recuadro[]
  /** Renglones de la zona de pesajes de cada recuadro en esta hoja. */
  renglones: number
  /** Con productos separados (OT de varios productos): rótulo TOTAL DÍA. */
  porProducto: boolean
  // Suma de lo escrito hasta esta hoja (la suya y las anteriores), para el total
  // del pie.
  pesajes: number
  to: number
  kg: number
  bobinas: number
  /** Avance acumulado de cada producto hasta esta hoja (OT de varios productos). */
  porItem: [string, number][]
  /** Unidad Kg: el pie muestra "To Acum. = kg  Bo = bobinas". */
  porPeso: boolean
}

function nuevaHoja(porPeso = false, renglones = PESAJES_POR_RECUADRO, porProducto = false): HojaRegistro {
  return {
    recuadros: [],
    renglones: porProducto ? renglones - 1 : renglones,
    porProducto,
    pesajes: 0,
    to: 0,
    kg: 0,
    bobinas: 0,
    porItem: [],
    porPeso
  }
}

/**
 * Los renglones de un día, EN EL ORDEN EN QUE SE REGISTRARON (por N°). Con
 * productos separados, cada cambio de producto abre un tramo con su renglón
 * "P."; si se vuelve a un producto más tarde, es otro tramo más abajo (Elias:
 * un pesaje tardío no puede quedar "donde quiere"). El To de cada producto va
 * al final de su último tramo del día y suma todos sus tramos.
 */
function lineasDelDia(dia: DiaFormularioPt, items: RegistrosFormularioPt['items']): Linea[] {
  const ordenados = [...dia.pesajes].sort((a, b) => a.numero - b.numero)
  if (!items?.length) return ordenados.map((pesaje) => ({ tipo: 'pesaje', pesaje }))
  const clave = (p: PesajeFormularioPt): number | null => (items.some((i) => i.numero === p.item) ? (p.item ?? null) : null)
  const nombre = (k: number | null): string => items.find((i) => i.numero === k)?.nombre ?? SIN_SEPARAR
  const tramos: { clave: number | null; pesajes: PesajeFormularioPt[] }[] = []
  for (const p of ordenados) {
    const k = clave(p)
    const ultimo = tramos[tramos.length - 1]
    if (ultimo && ultimo.clave === k) ultimo.pesajes.push(p)
    else tramos.push({ clave: k, pesajes: [p] })
  }
  return tramos.flatMap((t, n): Linea[] => [
    { tipo: 'producto', nombre: nombre(t.clave), continua: false },
    ...t.pesajes.map((pesaje): Linea => ({ tipo: 'pesaje', pesaje })),
    ...(tramos.slice(n + 1).some((o) => o.clave === t.clave)
      ? []
      : [{ tipo: 'toProducto', pesajes: ordenados.filter((p) => clave(p) === t.clave) } as Linea])
  ])
}

/** Reparte los días en recuadros y los recuadros en hojas (8 por hoja). Nada
 * queda afuera: lo que no entra sigue en otro recuadro u otra hoja. Siempre hay
 * al menos una hoja. */
function repartirRegistro(registros: RegistrosFormularioPt | undefined): HojaRegistro[] {
  const porPeso = registros?.porPeso ?? false
  const porProducto = Boolean(registros?.items?.length)
  const hojas: HojaRegistro[] = [nuevaHoja(porPeso, PESAJES_POR_RECUADRO, porProducto)]
  // Lo que cuenta para el avance: el peso en Kg, la cantidad en lo demás.
  const avance = (p: PesajeFormularioPt): number => (porPeso ? p.neto : (p.cantidad ?? 0))
  const acumItems = new Map<string, number>()

  for (const dia of registros?.dias ?? []) {
    let pendientes = lineasDelDia(dia, registros?.items)
    let continua = false
    let ultimo: Recuadro | null = null
    let productoActual = ''
    do {
      let hoja = hojas[hojas.length - 1]
      if (hoja.recuadros.length === RECUADROS_POR_HOJA) {
        hoja = nuevaHoja(porPeso, PESAJES_POR_RECUADRO_CONTINUACION, porProducto)
        hojas.push(hoja)
      }
      // Un tramo cortado entre dos recuadros repite su "P." arriba, "(cont.)".
      if (porProducto && continua && pendientes[0]?.tipo !== 'producto') {
        pendientes = [{ tipo: 'producto', nombre: productoActual, continua: true }, ...pendientes]
      }
      let cuantos = Math.min(hoja.renglones, pendientes.length)
      // Un "P." no queda solo al pie del recuadro: pasa al siguiente con su tramo.
      while (cuantos > 1 && cuantos < pendientes.length && pendientes[cuantos - 1].tipo === 'producto') cuantos--
      const lineas = pendientes.slice(0, cuantos)
      pendientes = pendientes.slice(cuantos)
      for (const l of lineas) if (l.tipo === 'producto') productoActual = l.nombre
      ultimo = { dia, lineas, continua, ultimo: false }
      hoja.recuadros.push(ultimo)
      let producto = ''
      for (const l of lineas) {
        if (l.tipo === 'producto') producto = l.nombre
        if (l.tipo !== 'pesaje') continue
        const p = l.pesaje
        hoja.pesajes++
        hoja.kg = redondearPeso(hoja.kg + p.neto)
        hoja.to = redondearPeso(hoja.to + avance(p))
        hoja.bobinas = redondearPeso(hoja.bobinas + (p.cantidad ?? 0))
        if (porProducto) acumItems.set(producto, redondearPeso((acumItems.get(producto) ?? 0) + avance(p)))
      }
      hoja.porItem = [...acumItems]
      continua = true
    } while (pendientes.length > 0)
    if (ultimo) ultimo.ultimo = true
  }
  // El total del pie es acumulado: cada hoja suma lo suyo más lo de las anteriores,
  // así la última muestra el total de la OT (pedido de Elias, 2026-10-22).
  let to = 0
  let kg = 0
  let bobinas = 0
  let porItem: [string, number][] = []
  for (const h of hojas) {
    to = redondearPeso(to + h.to)
    kg = redondearPeso(kg + h.kg)
    bobinas = redondearPeso(bobinas + h.bobinas)
    h.to = to
    h.kg = kg
    h.bobinas = bobinas
    // Una hoja sin pesajes de un producto conserva el acumulado anterior.
    if (h.porItem.length) porItem = h.porItem
    else h.porItem = porItem
  }
  return hojas
}

// Recuadros de ~80pt de ancho: letra de 7-8pt y relleno de 1pt.
const RELLENO_RECUADRO = 'padding:0 1pt;'
const ROTULO_RECUADRO = `border:${FINA};font-weight:bold;font-size:7pt;${RELLENO_RECUADRO}`
const DATO_RECUADRO = `border:${FINA};font-weight:bold;text-align:center;${RELLENO_RECUADRO}`
const TOTAL_RECUADRO = `border:${FINA};font-weight:bold;text-align:right;${RELLENO_RECUADRO}`
const TAMANOS_RECUADRO = [8, 7.5, 7, 6.5, 6, 5.5]

/** Letra que entra en `casillas` columnas de un recuadro. */
function letraRecuadro(texto: string, casillas: number, tamanos = TAMANOS_RECUADRO): string {
  return letraQueEntra(texto, casillas, tamanos, 1)
}

/** DD/MM/YYYY → DD/MM/YY, como el Excel: la fecha completa no entra en el recuadro. */
function fechaCorta(fecha: string): string {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(fecha) ? fecha.slice(0, 6) + fecha.slice(8) : fecha
}

const sumaPesos = (pesajes: PesajeFormularioPt[]): string =>
  numero(redondearPeso(pesajes.reduce((s, p) => s + p.neto, 0)), 2, 2)
const sumaCantidades = (pesajes: PesajeFormularioPt[]): string =>
  numero(redondearPeso(pesajes.reduce((s, p) => s + (p.cantidad ?? 0), 0)), 0)

/** Qué va en cada renglón de un recuadro, de arriba abajo. */
type Renglon =
  | 'E'
  | 'F'
  | 'titulos'
  | { linea: number }
  | 'subtotal'
  | 'totalDia'
  | 'to'
  | 'pq'
  | 'porcentaje'
  | 'sid'

function renglonesDelRecuadro(hoja: HojaRegistro): Renglon[] {
  const lineas = Array.from({ length: hoja.renglones }, (_, i): Renglon => ({ linea: i }))
  return hoja.porProducto
    ? ['E', 'F', 'titulos', ...lineas, 'subtotal', 'totalDia', 'to', 'pq', 'porcentaje', 'sid']
    : ['E', 'F', 'titulos', ...lineas, 'subtotal', 'to', 'pq', 'porcentaje', 'sid']
}

/** "To | kg | cantidad" en casillas con borde (To del producto y del día). */
function renglonTo(ctx: Contexto, pesajes: PesajeFormularioPt[] | null): string {
  const kg = pesajes ? sumaPesos(pesajes) : ''
  const can = pesajes ? sumaCantidades(pesajes) : ''
  return (
    td(ctx, CASILLAS_N, 'To', ROTULO_RECUADRO) +
    td(ctx, CASILLAS_KG, kg, `${TOTAL_RECUADRO}${letraRecuadro(kg, CASILLAS_KG)}`) +
    td(ctx, CASILLAS_CAN, can, `${TOTAL_RECUADRO}${letraRecuadro(can, CASILLAS_CAN)}`)
  )
}

/** Las casillas de un recuadro en uno de sus renglones. `null` = recuadro
 * vacío, que se dibuja igual (con líneas para escribir si `aMano`). */
function renglonRecuadro(ctx: Contexto, rec: Recuadro | null, renglon: Renglon, sinUno: boolean, aMano: boolean): string {
  const ancho = CASILLAS_N + CASILLAS_KG + CASILLAS_CAN
  if (renglon === 'E' || renglon === 'F') {
    const texto = !rec
      ? ''
      : renglon === 'E'
        ? rec.dia.pesadores.join('/')
        : rec.continua
          ? `${fechaCorta(rec.dia.fecha)} (cont.)`
          : fechaCorta(rec.dia.fecha)
    return (
      td(ctx, CASILLAS_N, `${renglon}.`, ROTULO_RECUADRO) +
      td(ctx, CASILLAS_KG + CASILLAS_CAN, esc(texto), `${DATO_RECUADRO}${letraRecuadro(texto, CASILLAS_KG + CASILLAS_CAN)}`)
    )
  }
  if (renglon === 'titulos') {
    return (
      td(ctx, CASILLAS_N, 'N&ordm;', `${DATO_RECUADRO}font-size:7.5pt;`) +
      td(ctx, CASILLAS_KG, 'Kg', `${DATO_RECUADRO}font-size:7.5pt;`) +
      td(ctx, CASILLAS_CAN, 'Can.', `${DATO_RECUADRO}font-size:7.5pt;`)
    )
  }
  if (typeof renglon === 'object') {
    const l = rec?.lineas[renglon.linea]
    if (!l) {
      const linea = aMano ? `border-bottom:${LINEA_ESCRIBIR};` : ''
      return td(ctx, CASILLAS_N, '', linea) + td(ctx, CASILLAS_KG, '', linea) + td(ctx, CASILLAS_CAN, '', linea)
    }
    if (l.tipo === 'producto') {
      const texto = l.continua ? `${l.nombre} (cont.)` : l.nombre
      return (
        td(ctx, CASILLAS_N, 'P.', `${ROTULO_RECUADRO}background:${GRIS_TOTAL};`) +
        td(ctx, CASILLAS_KG + CASILLAS_CAN, esc(texto), `${DATO_RECUADRO}background:${GRIS_TOTAL};${letraRecuadro(texto, CASILLAS_KG + CASILLAS_CAN)}`)
      )
    }
    if (l.tipo === 'toProducto') return renglonTo(ctx, l.pesajes)
    const p = l.pesaje
    const cantidad = p.cantidad !== null && !(sinUno && p.cantidad === 1) ? numero(p.cantidad, 0) : ''
    const peso = numero(p.neto, 3, 2)
    return (
      td(ctx, CASILLAS_N, String(p.numero), `${RELLENO_RECUADRO}text-align:center;color:#555;${letraRecuadro(String(p.numero), CASILLAS_N, [7, 6.5, 6])}`) +
      td(ctx, CASILLAS_KG, peso, `${RELLENO_RECUADRO}text-align:right;${letraRecuadro(peso, CASILLAS_KG, [8, 7.5, 7, 6.5])}`) +
      td(ctx, CASILLAS_CAN, cantidad, `${RELLENO_RECUADRO}text-align:right;${letraRecuadro(cantidad, CASILLAS_CAN, [8, 7.5, 7, 6.5])}`)
    )
  }
  if (renglon === 'subtotal') {
    // Subtotal de la columna: lo escrito en este recuadro.
    const linea = `border-top:${FINA};font-weight:bold;text-align:right;${RELLENO_RECUADRO}`
    const pesajes = rec ? pesajesDe(rec.lineas) : []
    const kg = rec ? sumaPesos(pesajes) : ''
    const can = rec ? sumaCantidades(pesajes) : ''
    return (
      td(ctx, CASILLAS_N, '', `border-top:${FINA};`) +
      td(ctx, CASILLAS_KG, kg, `${linea}${letraRecuadro(kg, CASILLAS_KG)}`) +
      td(ctx, CASILLAS_CAN, can, `${linea}${letraRecuadro(can, CASILLAS_CAN)}`)
    )
  }
  // To, Pq, % y N° No son del día: solo en su último recuadro. Un recuadro que
  // sigue en el siguiente los deja en blanco (sin casillas), y uno vacío los
  // dibuja para escribir a mano.
  if (rec && !rec.ultimo) return td(ctx, ancho, '')
  const dia = rec?.dia
  if (renglon === 'totalDia') {
    return td(ctx, ancho, 'TOTAL D&Iacute;A', `${DATO_RECUADRO}background:${GRIS_TOTAL};font-size:7pt;`)
  }
  if (renglon === 'to') return renglonTo(ctx, dia ? dia.pesajes : null)
  let rotulo = 'Pq'
  let valor = dia ? String(dia.pesajes.length) : ''
  let dato: Campo | undefined
  if (renglon === 'porcentaje') {
    rotulo = '%'
    valor = dia && dia.porcentaje !== null ? `${Math.round(dia.porcentaje)}%` : ''
  } else if (renglon === 'sid') {
    rotulo = 'N&ordm; No'
    valor = dia?.numeroSid ?? ''
    // El N° del SID lo anota una persona (el sistema no lo calcula), uno por
    // día: se escribe con un clic en esta casilla de la vista previa.
    if (dia?.fechaIso) dato = { clave: `sid.${dia.fechaIso}`, marcado: dia.sidRevisar }
  }
  return (
    td(ctx, CASILLAS_N, '') +
    td(ctx, CASILLAS_KG, rotulo, ROTULO_RECUADRO) +
    td(ctx, CASILLAS_CAN, esc(valor), `${TOTAL_RECUADRO}${letraRecuadro(valor, CASILLAS_CAN)}`, dato)
  )
}

// Recuadro de firmas: compacto, abajo a la derecha, como el del formulario en
// papel (pedido de Elias, 2026-10-27; antes ocupaba dos renglones a lo ancho).
const COLS_FIRMAS = 16
const COLS_IZQUIERDA_PIE = COLUMNAS - COLS_FIRMAS - 1

/** El pie: a la izquierda el total acumulado y a la derecha el recuadro de
 * firmas (Verificado Por, OT Concluida Si/No, lugar para firmar, Fecha/Hora y
 * Área); debajo, el número de hoja ("1-2"). */
function pieRegistro(ctx: Contexto, hoja: HojaRegistro, alto: string, pagina: string): string {
  const rotulo = 'font-weight:bold;font-size:7pt;'
  const total =
    hoja.pesajes > 0
      ? hoja.porPeso
        ? `To Acum. = ${numero(hoja.to, 2, 2)} &nbsp;&nbsp;&nbsp; Bo = ${numero(hoja.bobinas, 0)}`
        : `To Acum. = ${numero(hoja.to, 2)} &nbsp;&nbsp;&nbsp; Kg = ${numero(hoja.kg, 2, 2)}`
      : hoja.porPeso
        ? 'To Acum. = &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Bo ='
        : 'To Acum. = &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Kg ='
  // OT de varios productos: el acumulado de cada uno delante del total.
  const porProducto = hoja.porItem.length
    ? hoja.porItem.map(([nombre, valor]) => `${esc(nombre)} = ${numero(valor, 2, hoja.porPeso ? 2 : 0)}`).join(' &nbsp;|&nbsp; ') + ' &nbsp;|&nbsp; '
    : ''
  const textoTotal = porProducto + total
  // Renglones del recuadro: [casillas, texto, estilo] de izquierda a derecha.
  type Celda = [number, string, string]
  const linea = `border-bottom:${LINEA_ESCRIBIR};`
  const renglones: { alto: string; celdas: Celda[] }[] = [
    { alto, celdas: [[6, 'Verificado Por:', rotulo], [10, '', '']] },
    {
      alto,
      celdas: [
        [6, 'OT Concluida:', rotulo],
        [2, 'Si', `${rotulo}text-align:right;`],
        [3, '', `border:${FINA};`],
        [2, 'No', `${rotulo}text-align:right;`],
        [3, '', `border:${FINA};`]
      ]
    },
    { alto: altoFila(ALTO_FILA_FIRMA_PT), celdas: [[16, '', '']] },
    {
      alto,
      celdas: [
        [3, 'Fecha:', rotulo],
        [5, '', linea],
        [3, 'Hora:', `${rotulo}text-align:right;`],
        [5, '', linea]
      ]
    },
    { alto, celdas: [[3, '&Aacute;rea:', rotulo], [13, '', linea]] }
  ]
  const ultimo = renglones.length - 1
  const filas = renglones.map(({ alto: altoRenglon, celdas }, r) => {
    // Marco grueso alrededor del recuadro y una línea fina entre renglones.
    const abajo = r === ultimo ? `border-bottom:${GRUESA};` : `border-bottom:${FINA};`
    const arriba = r === 0 ? `border-top:${GRUESA};` : ''
    const recuadro = celdas
      .map(([casillas, texto, css], i) =>
        td(
          ctx,
          casillas,
          texto,
          // El marco va después del estilo de la celda para que un subrayado no lo tape.
          `${css}${arriba}${abajo}${i === 0 ? `border-left:${GRUESA};` : ''}${i === celdas.length - 1 ? `border-right:${GRUESA};` : ''}`
        )
      )
      .join('')
    const izquierda =
      r === 0
        ? td(
            ctx,
            COLS_IZQUIERDA_PIE,
            textoTotal,
            `border:${GRUESA};background:${GRIS_TOTAL};font-weight:bold;text-align:center;${letraQueEntra(textoTotal.replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, 'X'), COLS_IZQUIERDA_PIE, [8.5, 8, 7.5, 7, 6.5, 6])}`
          )
        : td(ctx, COLS_IZQUIERDA_PIE, '')
    return `<tr ${altoRenglon}>${izquierda}${td(ctx, 1, '')}${recuadro}</tr>`
  })
  filas.push(`<tr ${alto}>${td(ctx, COLUMNAS, pagina, 'text-align:center;font-size:8.5pt;font-weight:bold;')}</tr>`)
  return filas.join('\n')
}

/** Las dos franjas de recuadros de una hoja y su pie. */
function filasRegistro(ctx: Contexto, hoja: HojaRegistro, sinUno: boolean, pagina: string): string {
  const alto = altoFila(ctx.paraWord ? ALTO_FILA_REGISTRO_WORD_PT : ALTO_FILA_REGISTRO_PT)
  // Sin pesajes (el formato en blanco) los renglones llevan líneas para
  // escribir a mano; con pesajes quedan limpios.
  const aMano = hoja.pesajes === 0
  const renglones = renglonesDelRecuadro(hoja)
  const filas: string[] = []
  for (let franja = 0; franja < FRANJAS_POR_HOJA; franja++) {
    if (franja > 0) filas.push(`<tr ${alto}>${td(ctx, COLUMNAS, '')}</tr>`)
    const recuadros = Array.from(
      { length: RECUADROS_POR_FRANJA },
      (_, i) => hoja.recuadros[franja * RECUADROS_POR_FRANJA + i] ?? null
    )
    for (const renglon of renglones) {
      const celdas = recuadros
        .map((rec, i) => (i > 0 ? td(ctx, 1, '') : '') + renglonRecuadro(ctx, rec, renglon, sinUno, aMano))
        .join('')
      filas.push(`<tr ${alto}>${celdas}</tr>`)
    }
  }
  return `${filas.join('\n')}\n${pieRegistro(ctx, hoja, alto, pagina)}`
}

const ESTILOS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; }
  @page { size: 11in 8.5in; margin: 0.5in 0.45in; }
  @page WordSection1 { size: 11in 8.5in; margin: 0.5in 0.45in; mso-page-orientation: landscape; }
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
  /* El logo ocupa ~36pt de alto de la banda del encabezado (44.2pt). Ancho y
     alto van los dos fijos, en la relacion real del logo (125x103); si solo se
     fija el alto, Word lo estira al ancho de la celda. */
  .logo { display: block; margin: 0 auto; width: 43.7pt; height: 36pt; }
`

/** Cuántas hojas ocupa el formulario con sus pesajes (al menos 1). */
export function hojasFormularioPt(datos: DatosFormularioPt = {}): number {
  return repartirRegistro(datos.registros).length
}

/**
 * Genera el formulario completo como HTML independiente (tamaño carta).
 *
 * Es la única fuente del formato: la vista previa lo muestra en un iframe, la
 * exportación a PDF lo imprime con Electron, la de Word sale del mismo armado y
 * la de Excel lo lee de la tabla. Así lo que se ve en pantalla es literalmente lo
 * que se exporta.
 */
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
  const elegidas =
    opciones.soloHoja !== undefined
      ? [hojas[opciones.soloHoja] ?? nuevaHoja(datos.registros?.porPeso ?? false)]
      : hojas
  const primeraElegida = opciones.soloHoja ?? 0
  // El salto va en un div aparte con estilo inline (no en la tabla): Word no
  // respeta page-break-after sobre un <table> — mismo arreglo que formularioMp.
  const cuerpo = elegidas
    .map((hoja, i) => tablaFormulario(ctx, datos, hoja, primeraElegida + i, hojas.length))
    .join('\n<div style="page-break-after:always"></div>\n')

  return documentoFormulario(ctx, cuerpo)
}

function tablaFormulario(
  ctx: Contexto,
  datos: DatosFormularioPt,
  hoja: HojaRegistro,
  indiceHoja: number,
  totalHojas: number
): string {
  // Desde la 2ª hoja el encabezado lleva solo cliente, OT y pedido total.
  const continuacion = indiceHoja > 0
  return `<table class="formulario" align="center" cellpadding="0" cellspacing="0" border="0" width="${Math.round(
    (ANCHO_CONTENIDO_PT * 96) / 72
  )}">
<colgroup>${`<col style="width:${ANCHO_COLUMNA_PT}pt"${ctx.paraWord ? '' : ` width="${ANCHO_COLUMNA_PX}"`}>`.repeat(COLUMNAS)}</colgroup>
<tbody>
${filaTitulo(ctx)}
${filaCliente(ctx, datos)}
${continuacion ? '' : filasItems(ctx, datos)}
${filaPedidoTotal(ctx, datos, !continuacion)}
<tr ${altoFila(ALTO_SEPARACION_PT)}>${td(ctx, COLUMNAS, '')}</tr>
${filasRegistro(ctx, hoja, datos.registros?.sinUno ?? false, `${indiceHoja + 1}-${totalHojas}`)}
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
    registros: pesajes && pt.unidad ? registrosDesdePesajes(pt.unidad, pesajes, pt.items) : undefined,
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
function registrosDesdePesajes(unidad: UnidadPt, datos: PesajesPt, items: ProductoTerminadoItem[]): RegistrosFormularioPt {
  const nombres = nombresCortosItems(items)
  return {
    conCantidad: llevaCantidad(unidad),
    porPeso: !avanzaPorCantidad(unidad),
    sinUno: cantidadEsBobinas(unidad),
    items: separaPorProducto(items) ? items.map((i) => ({ numero: i.numero, nombre: nombres.get(i.numero) ?? `ITEM ${i.numero}` })) : undefined,
    dias: datos.dias.map((dia) => ({
      fecha: formatearFecha(dia.fecha),
      pesajes: datos.pesajes
        .filter((p) => p.fecha === dia.fecha)
        .sort((a, b) => a.numero - b.numero)
        .map((p) => ({ numero: p.numero, neto: p.peso_neto, cantidad: p.cantidad, item: p.item_numero })),
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

/** ¿La OT pesa por producto? Solo con 2 o más ítems (ej. OT 58091: manzana,
 * uva y limón). Con uno solo todo es de ese ítem y nada cambia. */
export function separaPorProducto(items: ProductoTerminadoItem[]): boolean {
  return items.length >= 2
}

const sinAcentos = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Nombre corto de cada ítem (MANZANA, UVA, LIMÓN), para el recuadro "P." y los
 * botones de Registro de peso. El puesto a mano manda; si no hay, se sugiere con
 * las palabras de su descripción que NO están en las de los demás ítems
 * ("Parafinado Banda Manzana 4.2 cm NUEVO" frente a "...Uva..." → MANZANA).
 * Si no queda ninguna, el código del producto o "ITEM n".
 */
export function nombresCortosItems(items: ProductoTerminadoItem[]): Map<number, string> {
  const palabras = items.map((i) => (i.descripcion_producto ?? '').split(/\s+/).filter(Boolean))
  const resultado = new Map<number, string>()
  items.forEach((item, n) => {
    if (item.nombre_corto) {
      resultado.set(item.numero, item.nombre_corto)
      return
    }
    const otras = new Set(palabras.filter((_, m) => m !== n).flat().map(sinAcentos))
    const propias = palabras[n].filter((p) => !otras.has(sinAcentos(p)))
    const sugerido = propias.length && items.length > 1 ? propias.slice(0, 2).join(' ') : item.codigo_producto || `ITEM ${item.numero}`
    resultado.set(item.numero, sugerido.toUpperCase().slice(0, 30))
  })
  return resultado
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
