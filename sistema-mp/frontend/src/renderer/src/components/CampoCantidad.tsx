import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'

export interface BobinasPedido {
  cantidadBobinas: string
  bobinas: string[]
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
  const total = datos.bobinas.reduce((acc, b) => acc + (Number(b) || 0), 0)
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
          onChange={(e) => onChange({ ...datos, bobinas: [e.target.value] })}
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Cantidad de bobinas{sufijo}</Label>
          <Input
            type="number"
            min={1}
            value={datos.cantidadBobinas}
            onChange={(e) => onChange({ ...datos, cantidadBobinas: e.target.value })}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const n = Number(datos.cantidadBobinas)
            if (!n || n < 1) return
            onChange({ ...datos, bobinas: Array.from({ length: n }, (_, i) => datos.bobinas[i] ?? '') })
          }}
        >
          Generar
        </Button>
      </div>

      {datos.bobinas.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {datos.bobinas.map((valor, i) => (
            <div key={i} className="flex flex-col gap-1">
              <Label className="text-xs">N.º {i + 1}</Label>
              <Input
                type="number"
                step="0.01"
                value={valor}
                onChange={(e) => {
                  const copia = [...datos.bobinas]
                  copia[i] = e.target.value
                  onChange({ ...datos, bobinas: copia })
                }}
              />
            </div>
          ))}
        </div>
      )}

      {datos.bobinas.length > 0 && (
        <p className="mt-3 text-sm font-medium">
          Total: {total.toFixed(2)} {unidad}
        </p>
      )}
    </>
  )
}
