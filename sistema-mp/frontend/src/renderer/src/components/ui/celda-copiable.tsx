import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

interface CeldaCopiableProps {
  texto: string
  className?: string
}

export function CeldaCopiable({ texto, className }: CeldaCopiableProps) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      // Sin acceso al portapapeles — no hay nada más que hacer.
    }
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <span className="truncate">{texto || '—'}</span>
      {texto && (
        <button
          type="button"
          onClick={copiar}
          title="Copiar"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {copiado ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  )
}
