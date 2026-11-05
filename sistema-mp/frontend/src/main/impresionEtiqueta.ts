import { execFile } from 'child_process'
import { unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Impresión de etiquetas en la etiquetadora térmica SAT TT460 UE (ZPL, 203 dpi).
//
// A diferencia del formulario (que va como PDF por el driver gráfico de la HP),
// acá el texto ZPL se manda CRUDO ("RAW") a la cola de impresión de Windows: el
// driver lo deja pasar tal cual y la impresora lo interpreta. Es lo que hace el
// resto del mundo con las etiquetadoras Zebra y compatibles, y es lo que se
// probó en papel el 2026-10-31 (etiquetas de 100 × 80 mm y de 100 × 48 mm).
//
// Windows solo expone el envío RAW por la API del spooler (winspool.drv), que
// Node no trae: se llama desde PowerShell con un Add-Type chico. Va por
// -EncodedCommand para que no lo frene la política de ejecución de scripts, y
// el ZPL viaja por un archivo temporal para no depender del largo de la línea
// de comandos (una sola etiqueta lleva ~3 KB con el logo; un lote, mucho más).

/** Impresora de etiquetas de la planta: el nombre del driver instalado
 * ("SAT TT460 UE (203 dpi) (ZPL)", o el recurso compartido en las otras PC). */
export const IMPRESORA_ETIQUETAS = /TT460/i

// Los errores se capturan y se devuelven como texto ("ERROR: ..."): el stderr de
// powershell.exe con -EncodedCommand sale serializado en CLIXML, ilegible.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$nombre = '__IMPRESORA__'
$ruta = '__ARCHIVO__'
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ZepolRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr h, int l, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA d);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
  public static void Enviar(string impresora, byte[] datos) {
    IntPtr h;
    if (!OpenPrinter(impresora, out h, IntPtr.Zero)) throw new Exception("No se pudo abrir la impresora (error " + Marshal.GetLastWin32Error() + ")");
    try {
      var di = new DOCINFOA { pDocName = "ZEPOL etiqueta", pDataType = "RAW" };
      if (!StartDocPrinter(h, 1, di)) throw new Exception("No se pudo iniciar el trabajo de impresion (error " + Marshal.GetLastWin32Error() + ")");
      try {
        StartPagePrinter(h);
        IntPtr p = Marshal.AllocCoTaskMem(datos.Length);
        try {
          Marshal.Copy(datos, 0, p, datos.Length);
          int escritos;
          if (!WritePrinter(h, p, datos.Length, out escritos) || escritos != datos.Length)
            throw new Exception("No se pudo enviar la etiqueta a la impresora (error " + Marshal.GetLastWin32Error() + ")");
        } finally { Marshal.FreeCoTaskMem(p); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
$p = Get-Printer -Name $nombre
if ($p.WorkOffline) { throw 'La impresora de etiquetas está desconectada (apagada o sin cable USB).' }
# Windows sigue diciendo "Normal" aunque una impresora USB este apagada o sin cable,
# y encolaria las etiquetas en silencio. El dispositivo USB si dice si esta presente.
# (Una impresora compartida de otra PC no tiene dispositivo local: ahi no se revisa.)
$dispositivos = @(Get-PnpDevice -Class Printer -FriendlyName $nombre -ErrorAction SilentlyContinue)
if ($dispositivos.Count -gt 0 -and -not ($dispositivos | Where-Object { $_.Present })) {
  throw 'La impresora de etiquetas no está conectada: revisa que esté encendida y con el cable USB puesto.'
}
[ZepolRawPrinter]::Enviar($nombre, [System.IO.File]::ReadAllBytes($ruta))
'OK'
} catch {
'ERROR: ' + $_.Exception.Message
}
`

function comillaSimple(valor: string): string {
  return valor.replace(/'/g, "''")
}

/** Manda el ZPL a la impresora (por su nombre en Windows) y devuelve cuando la
 * cola de impresión lo recibió. Rechaza con un mensaje entendible si no. */
export function enviarZpl(impresora: string, zpl: string): Promise<void> {
  const archivo = join(tmpdir(), `zepol-etiqueta-${Date.now()}-${Math.random().toString(36).slice(2)}.zpl`)
  // ASCII: las etiquetas ya vienen sin tildes (ver limpiarTextoZpl).
  writeFileSync(archivo, zpl, 'latin1')
  const script = SCRIPT.replace('__IMPRESORA__', comillaSimple(impresora)).replace('__ARCHIVO__', comillaSimple(archivo))
  const codificado = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificado],
      { windowsHide: true, timeout: 60 * 1000 },
      (error, stdout) => {
        try {
          unlinkSync(archivo)
        } catch {
          // Un temporal que no se pudo borrar no justifica romper la impresión.
        }
        const salida = stdout.trim()
        if (error || !salida.endsWith('OK')) {
          const detalle = salida
            .split(/\r?\n/)
            .find((linea) => linea.startsWith('ERROR:'))
            ?.slice('ERROR:'.length)
            .trim()
          if (detalle?.includes('MSFT_Printer')) {
            return reject(new Error(`La impresora "${impresora}" no está instalada en esta PC.`))
          }
          return reject(new Error(detalle || error?.message || 'No se pudo enviar la etiqueta a la impresora.'))
        }
        resolve()
      }
    )
  })
}
