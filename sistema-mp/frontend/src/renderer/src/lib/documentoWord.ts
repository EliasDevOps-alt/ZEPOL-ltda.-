import { LOGO_ZEPOL_BASE64 } from './logoZepol'

// Envoltorio MHTML compartido por los formularios que se exportan a .doc.
//
// Va en MHTML y no en HTML suelto porque Word **no** muestra imágenes en
// `data:` URI (el logo sale como ícono de imagen rota). MHTML adjunta el PNG
// como una parte MIME aparte, que Word sí resuelve, y sigue siendo un único
// archivo. Word lo abre por contenido, no le importa la extensión .doc.
const BASE_MHTML = 'file:///C:/zepol/formulario'

// El tipo y la extension salen del propio data: URI para que esto no se rompa
// si el logo cambia de formato (ya paso una vez: PNG recortado -> zepol.jpg).
const TIPO_LOGO = LOGO_ZEPOL_BASE64.slice(5, LOGO_ZEPOL_BASE64.indexOf(';'))
const EXT_LOGO = TIPO_LOGO === 'image/jpeg' ? 'jpg' : TIPO_LOGO.split('/')[1]

/** URL que tiene que usar el `<img>` del logo en la variante para Word. */
export const URL_LOGO_MHTML = `${BASE_MHTML}/logo.${EXT_LOGO}`

/**
 * Propiedades que Word necesita en la tabla del formulario. Los navegadores
 * ignoran las `mso-*`, así que van en el CSS compartido:
 * Word no respeta `table-layout: fixed` ni el `padding: 0` de las celdas.
 */
export const ESTILOS_TABLA_WORD =
  'mso-table-layout-alt: fixed; mso-table-lspace: 0pt; mso-table-rspace: 0pt;' +
  ' mso-padding-alt: 0in 0in 0in 0in;'

/**
 * Alto de fila. `mso-height-rule:exactly` es para Word: sin eso trata el alto
 * como mínimo, le suma su propio interlineado y el formulario se desborda a
 * otra hoja. Los navegadores ignoran la propiedad.
 */
export function altoFila(pt: number): string {
  return `style="height:${pt}pt;mso-height-rule:exactly"`
}

export function escaparHtml(valor: string | null | undefined): string {
  if (!valor) return ''
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Empaqueta el HTML + el logo en un único archivo MHTML que abre Word. */
export function envolverEnMhtml(html: string): string {
  const base64 = LOGO_ZEPOL_BASE64.slice(LOGO_ZEPOL_BASE64.indexOf(',') + 1)
  const lineasBase64 = base64.match(/.{1,76}/g) ?? []
  const frontera = '----=_NextPart_ZEPOL_FORMULARIO'

  // MHTML exige CRLF.
  return [
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${frontera}"`,
    '',
    `--${frontera}`,
    `Content-Location: ${BASE_MHTML}/formulario.htm`,
    'Content-Type: text/html; charset="utf-8"',
    '',
    html,
    '',
    `--${frontera}`,
    `Content-Location: ${URL_LOGO_MHTML}`,
    'Content-Transfer-Encoding: base64',
    `Content-Type: ${TIPO_LOGO}`,
    '',
    ...lineasBase64,
    '',
    `--${frontera}--`,
    ''
  ].join('\r\n')
}
