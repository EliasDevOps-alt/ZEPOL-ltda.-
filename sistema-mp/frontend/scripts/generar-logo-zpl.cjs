// Convierte zepol.jpg a la imagen en blanco y negro que lleva la etiqueta ZPL
// (src/renderer/src/lib/logoZpl.ts). Es un archivo generado, como logoZepol.ts:
// cambiar el logo NO actualiza nada solo, hay que volver a correr esto.
//   cd sistema-mp/frontend && env -u ELECTRON_RUN_AS_NODE npx electron scripts/generar-logo-zpl.cjs
const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const ALTO_PUNTOS = 64 // 8 mm a 203 dpi
const UMBRAL = 200 // por debajo de este brillo, punto negro

app.whenReady().then(() => {
  const origen = nativeImage.createFromPath(path.join(__dirname, '..', '..', '..', 'zepol.jpg'))
  const { width, height } = origen.getSize()
  const ancho = Math.round((width / height) * ALTO_PUNTOS)
  const bytesPorFila = Math.ceil(ancho / 8)
  const img = origen.resize({ width: ancho, height: ALTO_PUNTOS, quality: 'best' })
  const bgra = img.toBitmap()
  const bytes = Buffer.alloc(bytesPorFila * ALTO_PUNTOS)
  const filasTexto = []
  for (let y = 0; y < ALTO_PUNTOS; y++) {
    let fila = ''
    for (let x = 0; x < ancho; x++) {
      const i = (y * ancho + x) * 4
      const a = bgra[i + 3] / 255
      // Sobre fondo blanco.
      const mezcla = (c) => c * a + 255 * (1 - a)
      const brillo = 0.114 * mezcla(bgra[i]) + 0.587 * mezcla(bgra[i + 1]) + 0.299 * mezcla(bgra[i + 2])
      const negro = brillo < UMBRAL
      if (negro) bytes[y * bytesPorFila + (x >> 3)] |= 0x80 >> (x & 7)
      fila += negro ? '#' : '.'
    }
    filasTexto.push(fila)
  }
  const hex = bytes.toString('hex').toUpperCase()
  const ts = `// GENERADO por scripts/generar-logo-zpl.cjs — no editar a mano.
// Logo de ZEPOL en blanco y negro (${ancho} × ${ALTO_PUNTOS} puntos, 203 dpi) para la etiqueta ZPL.
export const LOGO_ZPL = {
  ancho: ${ancho},
  alto: ${ALTO_PUNTOS},
  bytesPorFila: ${bytesPorFila},
  hex: '${hex}'
}
`
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'lib', 'logoZpl.ts'), ts)
  fs.writeFileSync(process.env.TEMP + '/logo-zpl-preview.txt', filasTexto.join('\n'))
  console.log('logo', ancho, 'x', ALTO_PUNTOS, 'bytes', bytes.length)
  app.quit()
})
