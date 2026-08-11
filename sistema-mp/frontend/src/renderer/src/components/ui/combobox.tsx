import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface ComboboxOption {
  value: string
  label: string
}

interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  emptyText?: string
  className?: string
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Buscar...',
  emptyText = 'Sin resultados',
  className
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const seleccionado = options.find((o) => o.value === value)

  useEffect(() => {
    function alHacerClickFuera(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', alHacerClickFuera)
    return () => document.removeEventListener('mousedown', alHacerClickFuera)
  }, [])

  // Sin texto escrito se listan todos los activos; recién se filtra al escribir.
  const filtradas = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  function seleccionar(o: ComboboxOption) {
    onChange(o.value)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <input
          className="flex h-10 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          value={open ? query : (seleccionado?.label ?? '')}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
              setQuery('')
            }
          }}
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-50" />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-card p-1 text-card-foreground shadow-md">
          {filtradas.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyText}</p>
          )}
          {filtradas.map((o) => (
            <button
              type="button"
              key={o.value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => seleccionar(o)}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-muted',
                o.value === value && 'bg-muted'
              )}
            >
              <Check className={cn('h-3.5 w-3.5 shrink-0', o.value === value ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
