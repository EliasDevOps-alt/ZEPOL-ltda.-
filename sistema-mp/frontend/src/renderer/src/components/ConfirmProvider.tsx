import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'

interface ConfirmOptions {
  titulo?: string
  textoConfirmar?: string
  textoCancelar?: string
  destructivo?: boolean
  // Sin botón de cancelar — un solo botón para cerrar. Para avisos donde no
  // hay nada que decidir (reemplaza a window.alert(), mismo motivo que
  // confirm() más abajo).
  soloInformar?: boolean
}

type ConfirmFn = (mensaje: string, opciones?: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/** Reemplazo de window.confirm() — en Electron/Windows, el diálogo nativo
 * de confirm()/alert() deja la ventana de la app sin recibir clics (los
 * checkboxes y campos dejan de responder) hasta que se le devuelve el foco
 * a mano, por ejemplo haciendo clic en el ícono de la barra de tareas. Pasó
 * de verdad después de confirmar un borrado en Historial de OT. Este modal
 * vive dentro del mismo renderer (Radix Dialog, ver components/ui/dialog),
 * así que no depende de una ventana nativa aparte y no dispara ese
 * problema. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm debe usarse dentro de ConfirmProvider')
  return ctx
}

/** Variante de solo lectura (un botón) — reemplazo de window.alert(). */
export function useAlert(): (mensaje: string, opciones?: Omit<ConfirmOptions, 'soloInformar'>) => Promise<void> {
  const confirmar = useConfirm()
  return useCallback(
    async (mensaje, opciones) => {
      await confirmar(mensaje, { textoConfirmar: 'Entendido', ...opciones, soloInformar: true })
    },
    [confirmar]
  )
}

interface Pendiente {
  mensaje: string
  opciones?: ConfirmOptions
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const resolverRef = useRef<((valor: boolean) => void) | null>(null)

  const confirmar = useCallback<ConfirmFn>((mensaje, opciones) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setPendiente({ mensaje, opciones })
    })
  }, [])

  function cerrar(valor: boolean) {
    resolverRef.current?.(valor)
    resolverRef.current = null
    setPendiente(null)
  }

  return (
    <ConfirmContext.Provider value={confirmar}>
      {children}
      <Dialog open={pendiente !== null} onOpenChange={(abierto) => !abierto && cerrar(false)}>
        <DialogContent>
          <DialogTitle>{pendiente?.opciones?.titulo ?? 'Confirmar'}</DialogTitle>
          <p className="text-sm text-muted-foreground">{pendiente?.mensaje}</p>
          <div className="mt-6 flex justify-end gap-2">
            {!pendiente?.opciones?.soloInformar && (
              <Button type="button" variant="outline" onClick={() => cerrar(false)}>
                {pendiente?.opciones?.textoCancelar ?? 'Cancelar'}
              </Button>
            )}
            <Button
              type="button"
              variant={pendiente?.opciones?.destructivo ? 'destructive' : 'default'}
              onClick={() => cerrar(true)}
            >
              {pendiente?.opciones?.textoConfirmar ?? 'Confirmar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}
