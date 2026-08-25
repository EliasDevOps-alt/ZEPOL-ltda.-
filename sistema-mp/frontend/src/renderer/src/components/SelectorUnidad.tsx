import { useState } from 'react'
import { Input } from '@renderer/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'

const OTRA = '__otra__'

/** Unidad de un material: deja elegir entre las que ya se usan en el
 * catálogo (Kg, Mts, Unid...) o escribir una nueva — no tiene sentido
 * mantener un catálogo aparte de unidades solo para esto. */
export function SelectorUnidad({
  value,
  onChange,
  opciones
}: {
  value: string
  onChange: (v: string) => void
  opciones: string[]
}) {
  const [modoNueva, setModoNueva] = useState(value !== '' && !opciones.includes(value))

  if (modoNueva || opciones.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="kg" />
        {opciones.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setModoNueva(false)
              onChange('')
            }}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Elegir existente
          </button>
        )}
      </div>
    )
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === OTRA) {
          setModoNueva(true)
          onChange('')
        } else {
          onChange(v)
        }
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder="Selecciona" />
      </SelectTrigger>
      <SelectContent>
        {opciones.map((u) => (
          <SelectItem key={u} value={u}>
            {u}
          </SelectItem>
        ))}
        <SelectItem value={OTRA}>+ Otra unidad...</SelectItem>
      </SelectContent>
    </Select>
  )
}
