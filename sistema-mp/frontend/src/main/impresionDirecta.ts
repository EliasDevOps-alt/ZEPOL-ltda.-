import { execFile } from 'child_process'

// Impresión directa del formulario, sin cuadro de diálogo: mismo camino que
// se probó a mano en papel con la HP LaserJet Pro M201dw (2026-10-29).
//
// Por qué no webContents.print({ silent: true, duplexMode }): con el driver de
// la HP, Windows ignoró la doble cara y salieron dos hojas sueltas. Mandando el
// PDF con el verbo "PrintTo" del lector de PDF (Adobe Acrobat Reader) el driver
// sí respeta la configuración de la impresora, así que se le pone la
// configuración buena SOLO mientras dura el trabajo y después se devuelve.
//
// Configuración que se probó en papel y quedó bien: Carta, horizontal y doble
// cara por borde corto (con borde largo la segunda cara salía de cabeza).

export type ResultadoImpresionDirecta = 'ok' | 'sin-lector-pdf' | 'sin-trabajo'

// PowerShell por -EncodedCommand: no lo frena la política de ejecución de
// scripts, que en varias PCs de la planta está bloqueada.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$pdf = '__PDF__'
$n = '__IMPRESORA__'
$prog = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice' -ErrorAction SilentlyContinue).ProgId
if (-not $prog -or -not (Test-Path ('Registry::HKEY_CLASSES_ROOT\' + $prog + '\shell\Printto'))) {
  'SINLECTOR'
  return
}
$cfg = Get-PrintConfiguration -PrinterName $n
$ticketOriginal = $cfg.PrintTicketXML
$papelOriginal = [string]$cfg.PaperSize
$duplexOriginal = [string]$cfg.DuplexingMode
$resultado = 'SINTRABAJO'
$inicio = Get-Date
try {
  $d = [xml]$ticketOriginal
  $ns = New-Object Xml.XmlNamespaceManager($d.NameTable)
  $ns.AddNamespace('psf', 'http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework')
  $f = $d.SelectSingleNode("//psf:Feature[@name='psk:PageOrientation']", $ns)
  if ($f) { $f.SelectSingleNode('psf:Option', $ns).SetAttribute('name', 'psk:Landscape') }
  Set-PrintConfiguration -PrinterName $n -PrintTicketXml $d.OuterXml
  Set-PrintConfiguration -PrinterName $n -PaperSize Letter
  Set-PrintConfiguration -PrinterName $n -DuplexingMode TwoSidedShortEdge

  Start-Process -FilePath $pdf -Verb PrintTo -ArgumentList ('"' + $n + '"')

  $visto = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if (Get-PrintJob -PrinterName $n -ErrorAction SilentlyContinue) { $visto = $true; break }
  }
  if ($visto) {
    # Hasta que el trabajo sale de la cola: devolver la configuración antes
    # haría que el driver imprima con la de siempre.
    for ($i = 0; $i -lt 240; $i++) {
      Start-Sleep -Milliseconds 500
      if (-not (Get-PrintJob -PrinterName $n -ErrorAction SilentlyContinue)) { break }
    }
    $resultado = 'OK'
  }
}
finally {
  try {
    Set-PrintConfiguration -PrinterName $n -PrintTicketXml $ticketOriginal
    Set-PrintConfiguration -PrinterName $n -PaperSize $papelOriginal
    Set-PrintConfiguration -PrinterName $n -DuplexingMode $duplexOriginal
  } catch { }
  # Solo el lector que abrió este trabajo, no uno que el usuario ya tuviera.
  Get-Process -Name AcroRd32, Acrobat -ErrorAction SilentlyContinue |
    Where-Object { $_.StartTime -ge $inicio } | Stop-Process -Force -ErrorAction SilentlyContinue
}
$resultado
`

function comillaSimple(valor: string): string {
  return valor.replace(/'/g, "''")
}

/** Manda el PDF a la impresora con la configuración del formulario (Carta,
 * horizontal, doble cara por borde corto). Rechaza con el error de PowerShell
 * si algo falla; 'sin-lector-pdf' significa que la PC no tiene un lector de PDF
 * que sepa imprimir por línea de comandos y hay que usar otro camino. */
export function imprimirPdfDirecto(rutaPdf: string, impresora: string): Promise<ResultadoImpresionDirecta> {
  const script = SCRIPT.replace('__PDF__', comillaSimple(rutaPdf)).replace('__IMPRESORA__', comillaSimple(impresora))
  const codificado = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificado],
      { windowsHide: true, timeout: 5 * 60 * 1000 },
      (error, stdout, stderr) => {
        const salida = stdout.trim()
        if (salida.endsWith('SINLECTOR')) return resolve('sin-lector-pdf')
        if (error) return reject(new Error((stderr || error.message).trim()))
        resolve(salida.endsWith('OK') ? 'ok' : 'sin-trabajo')
      }
    )
  })
}
