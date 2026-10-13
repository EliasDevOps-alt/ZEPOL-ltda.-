import { X } from 'lucide-react'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { redondearPeso } from '@renderer/lib/utils'

export interface BobinasPedido {
  bobinas: string[]
}

/** Bobinas realmente cargadas (ignora la fila vacía del final, que es solo
 * el lugar para escribir la próxima) — para armar lo que se manda a la API. */
export function pesosCargados(datos: BobinasPedido): number[] {
  return datos.bobinas.filter((b) => b.trim() !== '').map(Number)
}

/** true si alguna fila tiene texto pero no es un número válido mayor a 0 —
 * una fila vacía no cuenta como inválida, es el placeholder para la próxima. */
export function hayPesoInvalido(datos: BobinasPedido): boolean {
  return datos.bobinas.some((b) => b.trim() !== '' && !(Number(b) > 0))
}

export function CampoCantidad({
  unidad,
  usaBobinas = true,
  requerido,
  datos,
  onChange
}: {
  unidad: string
  // Propiedad del material (Material.usa_bobinas), no se adivina por el
  // texto de la unidad — ej. ZIPPER es "mts" pero NO usa bobinas.
  usaBobinas?: boolean
  // Si se indica, se muestra junto a la etiqueta — algunos llamadores tienen
  // una cantidad que puede quedar vacía (ej. el pedido cuya materia prima ya
  // cubre la entrega), y sin esta aclaración no queda claro si hace falta.
  requerido?: boolean
  datos: BobinasPedido
  onChange: (datos: BobinasPedido) => void
}) {
  const total = redondearPeso(datos.bobinas.reduce((acc, b) => acc + (Number(b) || 0), 0))
  const sufijo = requerido === undefined ? '' : requerido ? ' (obligatorio)' : ' (opcional)'

  if (!usaBobinas) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>
          Cantidad {unidad ? `(${unidad})` : ''}
          {sufijo}
        </Label>
        <Input
          type="number"
          step="0.01"
          min={0}
          value={datos.bobinas[0] ?? ''}
          onChange={(e) => onChange({ bobinas: [e.target.value] })}
        />
      </div>
    )
  }

  // Siempre hay al menos una fila (vacía si todavía no se cargó nada) — no
  // hace falta decir antes cuántas bobinas van a ser. Al completar la última
  // fila se agrega sola una nueva vacía al final, así que cargar 4 bobinas es
  // escribir 4 pesos seguidos, sin tocar ningún botón entre uno y otro (a
  // diferencia del "Cantidad de bobinas" + "Generar" de antes).
  const lista = datos.bobinas.length > 0 ? datos.bobinas : ['']

  function actualizarBobina(i: number, valor: string) {
    const copia = [...lista]
    copia[i] = valor
    if (i === copia.length - 1 && valor.trim() !== '') {
      copia.push('')
    }
    onChange({ bobinas: copia })
  }

  // Enter pasa a la casilla siguiente (y la deja seleccionada para escribir
  // encima), en vez de enviar el formulario: pesar 40 bobinas es escribir el
  // peso y apretar Enter, sin tocar el mouse. Al escribir en la última casilla
  // ya se agregó sola otra vacía, así que casi siempre hay una "siguiente".
  // Enter NUNCA envía el formulario desde acá: un Enter de más sobre la última
  // casilla vacía registraba la entrega entera sin querer.
  function alApretarTecla(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const casillas = Array.from(
      e.currentTarget.closest('[data-campo-bobinas]')?.querySelectorAll<HTMLInputElement>('input[data-bobina]') ?? []
    )
    const siguiente = casillas[casillas.indexOf(e.currentTarget) + 1]
    if (siguiente) {
      siguiente.focus()
      siguiente.select()
    }
  }

  function quitarBobina(i: number) {
    const copia = lista.filter((_, idx) => idx !== i)
    onChange({ bobinas: copia.length > 0 ? copia : [''] })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        Peso de cada bobina {unidad ? `(${unidad})` : ''}
        {sufijo}
      </Label>
      <div className="grid grid-cols-3 gap-3" data-campo-bobinas>
        {lista.map((valor, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              type="number"
              step="0.01"
              min={0}
              placeholder={`N.º ${i + 1}`}
              value={valor}
              data-bobina
              onChange={(e) => actualizarBobina(i, e.target.value)}
              onKeyDown={alApretarTecla}
            />
            {lista.length > 1 && (
              <button
                type="button"
                // Fuera del orden del Tab: sin esto, para pasar de una casilla
                // a la siguiente hacían falta dos Tab (casilla → X → casilla).
                // Sigue funcionando con el mouse.
                tabIndex={-1}
                onClick={() => quitarBobina(i)}
                className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10"
                aria-label={`Quitar bobina N.º ${i + 1}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {total > 0 && (
        <p className="mt-2 text-sm font-medium">
          Total: {total.toFixed(2)} {unidad}
        </p>
      )}
    </div>
  )
}
