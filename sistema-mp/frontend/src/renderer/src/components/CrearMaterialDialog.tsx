import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import type { MaterialAdmin } from '@renderer/lib/types'

interface CrearMaterialDialogProps {
  open: boolean
  codigoInicial: string
  onOpenChange: (open: boolean) => void
  onCreado: (material: MaterialAdmin) => void
}

export function CrearMaterialDialog({ open, codigoInicial, onOpenChange, onCreado }: CrearMaterialDialogProps) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [codigoMp, setCodigoMp] = useState(codigoInicial)
  const [descripcion, setDescripcion] = useState('')
  const [unidad, setUnidad] = useState('kg')
  const [esTinta, setEsTinta] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setCodigoMp(codigoInicial)
      setDescripcion('')
      setUnidad('kg')
      setEsTinta(false)
      setError(null)
    }
  }, [open, codigoInicial])

  const crear = useMutation({
    mutationFn: () =>
      api.crearMaterial(apiBaseUrl, token, {
        codigo_mp: codigoMp,
        descripcion: descripcion || null,
        unidad,
        es_tinta: esTinta
      }),
    onSuccess: (material) => {
      queryClient.setQueryData<MaterialAdmin[] | undefined>(['materiales'], (prev) =>
        prev ? [...prev, material] : prev
      )
      queryClient.invalidateQueries({ queryKey: ['materiales'] })
      queryClient.invalidateQueries({ queryKey: ['materiales-admin'] })
      onCreado(material)
      onOpenChange(false)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al guardar el material')
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!codigoMp || !unidad) {
      setError('Código y unidad son obligatorios')
      return
    }
    setError(null)
    crear.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Nuevo material</DialogTitle>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Código MP</Label>
              <Input value={codigoMp} onChange={(e) => setCodigoMp(e.target.value)} placeholder="LDPE-1" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Unidad</Label>
              <Input value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="kg" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Descripción</Label>
            <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={esTinta} onChange={(e) => setEsTinta(e.target.checked)} />
            Es tinta (cargo de tinta, no es materia prima física)
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={crear.isPending}>
              {crear.isPending ? 'Guardando...' : 'Crear y usar'}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
