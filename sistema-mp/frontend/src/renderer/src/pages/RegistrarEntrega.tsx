import type { FormEvent } from 'react'
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRightLeft, Beaker, CheckCircle2, PackagePlus, Plus, Search, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Combobox } from '@renderer/components/ui/combobox'
import { CrearMaterialDialog } from '@renderer/components/CrearMaterialDialog'
import { CampoCantidad, type BobinasPedido } from '@renderer/components/CampoCantidad'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import { formatearFechaHoraCompleta, hoyISO } from '@renderer/lib/fechas'
import type { Consumo, Entrega, Material, OtMaterialPendiente, Proceso } from '@renderer/lib/types'

interface EntradaMaterial extends BobinasPedido {
  // '' = se entrega el material del pedido tal cual (el caso normal).
  materialId: string
  // Dónde se consume ESTA entrega puntual — arrancan en el proceso/máquina
  // del pedido (el caso normal) pero se pueden cambiar sin mover el pedido
  // ni sus otras entregas (ver EntregaCreate.proceso_id/maquina_id).
  procesoId: string
  maquinaId: string
  observacion: string
}

function entregaVacia(usaBobinas: boolean, procesoId = '', maquinaId = ''): EntradaMaterial {
  return {
    materialId: '',
    procesoId,
    maquinaId,
    observacion: '',
    ...(usaBobinas ? { cantidadBobinas: '', bobinas: [] } : { cantidadBobinas: '1', bobinas: [''] })
  }
}

/** Un material que hizo falta para poder completar el del pedido. La OT pide
 * LDPE-4 pero almacén no lo tiene: se fabrica mezclando LDPE-1 y LDPE-2, y
 * cada uno de esos pasa a ser un pedido propio de la OT. Lleva proceso y
 * máquina propios porque se consume donde se fabrica (Extrusión/CHINA), no
 * donde se usa el resultado (Impresión/F4). */
interface MateriaPrima extends BobinasPedido {
  materialId: string
  procesoId: string
  maquinaId: string
  observacion: string
}

function materiaPrimaVacia(): MateriaPrima {
  return { materialId: '', procesoId: '', maquinaId: '', cantidadBobinas: '', bobinas: [], observacion: '' }
}

/** Lo que se registra para un pedido en un solo envío: la entrega del material
 * pedido y/o la materia prima que hizo falta para completarlo. Son
 * independientes — se puede mandar una, la otra, o las dos. */
interface SeleccionPedido {
  entrega: EntradaMaterial
  materiasPrimas: MateriaPrima[]
}

function seleccionVacia(pedido: { usa_bobinas: boolean; proceso_id?: number; maquina_id?: number }): SeleccionPedido {
  return {
    entrega: entregaVacia(
      pedido.usa_bobinas,
      pedido.proceso_id != null ? String(pedido.proceso_id) : '',
      pedido.maquina_id != null ? String(pedido.maquina_id) : ''
    ),
    materiasPrimas: []
  }
}

/** Igual que seleccionVacia, pero si el pedido ya tiene entregas previas
 * arranca con el material/proceso/máquina de la ÚLTIMA — ya se entregó
 * BOPLH20760 en Impresión/FS-1500 en vez de BOPLH20620 del pedido, así que
 * la próxima entrega de ese mismo pedido probablemente sigue siendo así, no
 * hace falta repetir "¿Se entregó un material distinto?"/"¿otro
 * proceso/máquina?" cada vez. Sigue siendo editable: si esta tanda vuelve a
 * ser distinta, se corrige igual que cualquier otra. */
function seleccionVaciaContinuando(
  pedido: { usa_bobinas: boolean; material_id: number; proceso_id: number; maquina_id: number },
  entregasDelPedido: Entrega[] | undefined
): SeleccionPedido {
  const ultima = entregasDelPedido?.at(-1)
  if (!ultima) return seleccionVacia(pedido)
  return {
    entrega: {
      ...entregaVacia(pedido.usa_bobinas, String(ultima.proceso_id), String(ultima.maquina_id)),
      materialId: ultima.material_entregado_id !== pedido.material_id ? String(ultima.material_entregado_id) : ''
    },
    materiasPrimas: []
  }
}

function tieneCantidad(datos: BobinasPedido): boolean {
  return datos.bobinas.length > 0 && datos.bobinas.some((b) => Number(b) > 0)
}

/** La entrega del material del pedido. Normalmente sale de almacén tal cual,
 * pero puede que almacén no tenga el micronaje/ancho exacto y dé una
 * alternativa, o directamente otra estructura — eso es una sustitución 1 a 1 y
 * queda detrás de un enlace, porque casi nunca hay nada que cambiar. No
 * confundir con la materia prima de abajo: ahí no se reemplaza nada, se
 * agregan materiales que el pedido necesita además. */
function EntregaDelPedido({
  datos,
  onChange,
  materiales,
  materialOptions,
  unidadPedido,
  usaBobinasPedido,
  requerido,
  procesos,
  procesoIdPedido,
  maquinaIdPedido
}: {
  datos: EntradaMaterial
  onChange: (datos: EntradaMaterial) => void
  materiales: Material[]
  materialOptions: { value: string; label: string }[]
  unidadPedido: string
  usaBobinasPedido: boolean
  // Solo hace falta esta cantidad si no se va a cargar materia prima en su
  // lugar — ver requiereAsignacion/validarSeleccion.
  requerido?: boolean
  // Con estos tres se puede corregir dónde se consume ESTA entrega puntual
  // (ver EntradaMaterial.procesoId/maquinaId). Sin ellos (pendiente recién
  // promovido, todavía sin pedido "hogar") esa opción no tiene sentido y no
  // se ofrece.
  procesos?: Proceso[]
  procesoIdPedido?: string
  maquinaIdPedido?: string
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [cambiarMaterial, setCambiarMaterial] = useState(false)
  const [cambiarMaquina, setCambiarMaquina] = useState(false)
  const material = materiales.find((m) => String(m.id) === datos.materialId)
  const unidad = material?.unidad ?? unidadPedido
  const usaBobinas = material?.usa_bobinas ?? usaBobinasPedido

  const maquinas = useQuery({
    queryKey: ['maquinas', datos.procesoId],
    queryFn: () => api.listarMaquinas(apiBaseUrl, token, Number(datos.procesoId)),
    enabled: !!datos.procesoId
  })

  function cancelarCambioMaterial() {
    setCambiarMaterial(false)
    onChange({ ...datos, materialId: '' })
  }

  function cancelarCambioMaquina() {
    setCambiarMaquina(false)
    onChange({ ...datos, procesoId: procesoIdPedido ?? '', maquinaId: maquinaIdPedido ?? '' })
  }

  const puedeElegirMaquina = procesos !== undefined && procesoIdPedido !== undefined && maquinaIdPedido !== undefined

  return (
    <div>
      {(cambiarMaterial || datos.materialId) && (
        <div className="mb-2 flex flex-col gap-1.5">
          <Label className="text-xs">Material realmente entregado</Label>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Combobox
                value={datos.materialId}
                onChange={(v) => onChange({ ...datos, materialId: v })}
                options={materialOptions}
                placeholder="Buscar código MP..."
                emptyText="Sin materiales activos que coincidan"
              />
            </div>
            <button
              type="button"
              onClick={cancelarCambioMaterial}
              className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10"
              aria-label="Cancelar — entregar el material del pedido"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {puedeElegirMaquina &&
        (cambiarMaquina || datos.procesoId !== procesoIdPedido || datos.maquinaId !== maquinaIdPedido) && (
          <div className="mb-2 flex flex-col gap-1.5">
            <Label className="text-xs">Proceso y máquina de esta entrega</Label>
            <div className="flex items-end gap-2">
              <div className="grid flex-1 grid-cols-2 gap-2">
                <Select
                  value={datos.procesoId}
                  onValueChange={(v) => onChange({ ...datos, procesoId: v, maquinaId: '' })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Proceso" />
                  </SelectTrigger>
                  <SelectContent>
                    {procesos.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={datos.maquinaId}
                  onValueChange={(v) => onChange({ ...datos, maquinaId: v })}
                  disabled={!datos.procesoId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Máquina" />
                  </SelectTrigger>
                  <SelectContent>
                    {maquinas.data?.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <button
                type="button"
                onClick={cancelarCambioMaquina}
                className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10"
                aria-label="Cancelar — entregar en el proceso y máquina del pedido"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      <CampoCantidad
        unidad={unidad}
        usaBobinas={usaBobinas}
        requerido={requerido}
        datos={datos}
        onChange={(d) => onChange({ ...datos, ...d })}
      />
      <Input
        className="mt-2"
        placeholder={
          cambiarMaterial || datos.materialId ? 'Nota (opcional) — ej. sin stock del pedido' : 'Nota (opcional)'
        }
        value={datos.observacion}
        onChange={(e) => onChange({ ...datos, observacion: e.target.value })}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {!cambiarMaterial && !datos.materialId && (
          <Button type="button" variant="outline" size="sm" onClick={() => setCambiarMaterial(true)}>
            ¿Se entregó un material distinto? (alternativa o cambio de estructura)
          </Button>
        )}
        {puedeElegirMaquina &&
          !cambiarMaquina &&
          datos.procesoId === procesoIdPedido &&
          datos.maquinaId === maquinaIdPedido && (
            <Button type="button" variant="outline" size="sm" onClick={() => setCambiarMaquina(true)}>
              ¿Se entregó en otro proceso/máquina?
            </Button>
          )}
      </div>
    </div>
  )
}

function FilaMateriaPrima({
  entrada,
  indice,
  onChange,
  onQuitar,
  materiales,
  materialOptions,
  procesos
}: {
  entrada: MateriaPrima
  indice: number
  onChange: (cambios: Partial<MateriaPrima>) => void
  onQuitar: () => void
  materiales: Material[]
  materialOptions: { value: string; label: string }[]
  procesos: Proceso[]
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const maquinas = useQuery({
    queryKey: ['maquinas', entrada.procesoId],
    queryFn: () => api.listarMaquinas(apiBaseUrl, token, Number(entrada.procesoId)),
    enabled: !!entrada.procesoId
  })

  const material = materiales.find((m) => String(m.id) === entrada.materialId)

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label className="text-xs">Materia prima #{indice + 1}</Label>
          <Combobox
            value={entrada.materialId}
            onChange={(v) => onChange({ materialId: v })}
            options={materialOptions}
            placeholder="Buscar código MP..."
            emptyText="Sin materiales activos que coincidan"
          />
        </div>
        <button
          type="button"
          onClick={onQuitar}
          className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10"
          aria-label="Quitar esta materia prima"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Proceso donde se consume</Label>
          <Select value={entrada.procesoId} onValueChange={(v) => onChange({ procesoId: v, maquinaId: '' })}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona" />
            </SelectTrigger>
            <SelectContent>
              {procesos.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Máquina</Label>
          <Select
            value={entrada.maquinaId}
            onValueChange={(v) => onChange({ maquinaId: v })}
            disabled={!entrada.procesoId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecciona" />
            </SelectTrigger>
            <SelectContent>
              {maquinas.data?.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <CampoCantidad
        unidad={material?.unidad ?? ''}
        usaBobinas={material?.usa_bobinas ?? true}
        datos={entrada}
        onChange={(d) => onChange(d)}
      />
      <Input
        className="mt-2"
        placeholder="Nota (opcional)"
        value={entrada.observacion}
        onChange={(e) => onChange({ observacion: e.target.value })}
      />
    </div>
  )
}

/** Materiales extra que hicieron falta para completar el pedido. Disponible en
 * CUALQUIER pedido de cualquier proceso: que la OT pida un código y haga falta
 * otro material para poder armarlo no es exclusivo de Extrusión. Cada uno se
 * manda con como_materia_prima y el backend le crea su propio pedido — no es
 * una sustitución del material pedido, es un pedido nuevo de la OT. */
function MateriasPrimas({
  entradas,
  onChange,
  materiales,
  materialOptions,
  procesos
}: {
  entradas: MateriaPrima[]
  onChange: (entradas: MateriaPrima[]) => void
  materiales: Material[]
  materialOptions: { value: string; label: string }[]
  procesos: Proceso[]
}) {
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      {entradas.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Materiales que hicieron falta para completar este pedido. Cada uno queda como pedido propio de la OT, en
          el proceso y la máquina donde se consume.
        </p>
      )}
      {entradas.map((entrada, indice) => (
        <FilaMateriaPrima
          key={indice}
          entrada={entrada}
          indice={indice}
          onChange={(cambios) => onChange(entradas.map((e, i) => (i === indice ? { ...e, ...cambios } : e)))}
          onQuitar={() => onChange(entradas.filter((_, i) => i !== indice))}
          materiales={materiales}
          materialOptions={materialOptions}
          procesos={procesos}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...entradas, materiaPrimaVacia()])}
      >
        <Plus className="h-3.5 w-3.5" />
        Agregar materia prima
      </Button>
    </div>
  )
}

/** Manda una entrega por cada cosa cargada en un pedido: la del material
 * pedido y una por materia prima. No hay endpoint por lote — se reporta el
 * fallo por separado para no perder lo que sí entró. */
async function enviarSeleccion(
  apiBaseUrl: string,
  token: string,
  // El material al que se le carga esto: un pedido ya creado, o un pendiente
  // que todavía no tiene proceso (ahí solo se puede mandar materia prima).
  destino: { ot_material_id: number } | { pendiente_id: number },
  fecha: string,
  sel: SeleccionPedido,
  codigoPedido: string,
  materiales: Material[]
): Promise<{ exitos: Entrega[]; fallos: string[]; restante: SeleccionPedido | null }> {
  const exitos: Entrega[] = []
  const fallos: string[] = []
  let entregaFallida: EntradaMaterial | null = null
  const materiasPrimasFallidas: MateriaPrima[] = []

  const codigoDe = (materialId: string, porDefecto: string) =>
    materiales.find((m) => String(m.id) === materialId)?.codigo_mp ?? porDefecto

  if (tieneCantidad(sel.entrega)) {
    try {
      exitos.push(
        await api.registrarEntrega(apiBaseUrl, token, {
          ...destino,
          fecha,
          bobinas: sel.entrega.bobinas.map(Number),
          material_id: sel.entrega.materialId ? Number(sel.entrega.materialId) : undefined,
          proceso_id: sel.entrega.procesoId ? Number(sel.entrega.procesoId) : undefined,
          maquina_id: sel.entrega.maquinaId ? Number(sel.entrega.maquinaId) : undefined,
          observacion: sel.entrega.observacion.trim() || undefined
        })
      )
    } catch (err) {
      fallos.push(`${codigoDe(sel.entrega.materialId, codigoPedido)} (${err instanceof ApiError ? err.message : 'error de conexión'})`)
      entregaFallida = sel.entrega
    }
  }

  for (const mp of sel.materiasPrimas) {
    if (!tieneCantidad(mp)) continue
    try {
      exitos.push(
        await api.registrarEntrega(apiBaseUrl, token, {
          ...destino,
          fecha,
          bobinas: mp.bobinas.map(Number),
          material_id: Number(mp.materialId),
          proceso_id: Number(mp.procesoId),
          maquina_id: Number(mp.maquinaId),
          como_materia_prima: true,
          observacion: mp.observacion.trim() || undefined
        })
      )
    } catch (err) {
      fallos.push(`${codigoDe(mp.materialId, 'materia prima')} (${err instanceof ApiError ? err.message : 'error de conexión'})`)
      materiasPrimasFallidas.push(mp)
    }
  }

  const hayRestante = entregaFallida !== null || materiasPrimasFallidas.length > 0
  return {
    exitos,
    fallos,
    restante: hayRestante
      ? {
          entrega: entregaFallida ?? { ...sel.entrega, cantidadBobinas: '', bobinas: [] },
          materiasPrimas: materiasPrimasFallidas
        }
      : null
  }
}

/** Qué falta completar antes de poder mandar un pedido. Devuelve null si está
 * todo bien. Se comparte entre la tarjeta de pendientes y la de pedidos. */
function validarSeleccion(sel: SeleccionPedido): string | null {
  if (sel.entrega.bobinas.length > 0 && sel.entrega.bobinas.some((b) => !b || Number(b) <= 0)) {
    return 'La cantidad entregada debe ser válida y mayor a 0'
  }
  for (const mp of sel.materiasPrimas) {
    const cargada = mp.bobinas.length > 0 || mp.materialId || mp.procesoId || mp.maquinaId
    if (!cargada) continue
    if (!mp.materialId) return 'Elige qué materia prima se está entregando'
    if (!mp.procesoId || !mp.maquinaId) return 'Elige el proceso y la máquina donde se consume cada materia prima'
    if (mp.bobinas.length === 0 || mp.bobinas.some((b) => !b || Number(b) <= 0)) {
      return 'Cada materia prima necesita una cantidad válida mayor a 0'
    }
  }
  if (!tieneCantidad(sel.entrega) && !sel.materiasPrimas.some(tieneCantidad)) {
    return 'Completa la cantidad entregada o agrega al menos una materia prima'
  }
  return null
}

/** Un pendiente se puede trabajar de dos formas, y solo una exige decidir a
 * qué proceso va: si se entrega el material tal cual, hay que asignarlo; si lo
 * único que sale de almacén hoy es su materia prima —porque el material hay
 * que fabricarlo— el proceso del resultado suele decidirse recién cuando
 * producción lo devuelve, y forzarlo acá sería inventar el dato. */
function requiereAsignacion(sel: SeleccionPedido): boolean {
  return tieneCantidad(sel.entrega)
}

/** El personal no siempre puede esperar a que alguien actualice la OT para
 * entregar lo que de verdad está saliendo de almacén — a pedido explícito de
 * planta, después de un caso real (OT 220289) donde una resolución
 * equivocada del material dejó todo enredado. Crea un pedido nuevo y SUELTO
 * (sin marcarlo como materia prima de nada — ver
 * ordenes_controller.crear_pedido_libre) con el material, proceso y máquina
 * que se indiquen acá, y entrega contra él en el mismo paso. Proceso y
 * máquina son obligatorios: acá sí importa dónde se consume. */
function EntregaLibreForm({
  numeroOt,
  fecha,
  materiales,
  materialOptions,
  procesos,
  onRegistrado
}: {
  numeroOt: string
  fecha: string
  materiales: Material[]
  materialOptions: { value: string; label: string }[]
  procesos: Proceso[]
  onRegistrado: (entregas: Entrega[]) => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [abierto, setAbierto] = useState(false)
  const [materialId, setMaterialId] = useState('')
  const [procesoId, setProcesoId] = useState('')
  const [maquinaId, setMaquinaId] = useState('')
  const [datos, setDatos] = useState<BobinasPedido>({ cantidadBobinas: '', bobinas: [] })
  const [error, setError] = useState<string | null>(null)

  const material = materiales.find((m) => String(m.id) === materialId)

  const maquinas = useQuery({
    queryKey: ['maquinas', procesoId],
    queryFn: () => api.listarMaquinas(apiBaseUrl, token, Number(procesoId)),
    enabled: !!procesoId
  })

  const registrar = useMutation({
    mutationFn: () =>
      api.registrarEntrega(apiBaseUrl, token, {
        numero_ot: numeroOt,
        fecha,
        bobinas: datos.bobinas.map(Number),
        material_id: Number(materialId),
        proceso_id: Number(procesoId),
        maquina_id: Number(maquinaId)
      }),
    onSuccess: (entrega) => {
      setAbierto(false)
      setMaterialId('')
      setProcesoId('')
      setMaquinaId('')
      setDatos({ cantidadBobinas: '', bobinas: [] })
      setError(null)
      onRegistrado([entrega])
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo registrar')
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!materialId) {
      setError('Elegí qué material se está entregando')
      return
    }
    if (!procesoId || !maquinaId) {
      setError('Elegí el proceso y la máquina donde se consume')
      return
    }
    if (datos.bobinas.length === 0 || datos.bobinas.some((b) => !b || Number(b) <= 0)) {
      setError('Cargá una cantidad válida mayor a 0')
      return
    }
    setError(null)
    registrar.mutate()
  }

  if (!abierto) {
    return (
      <Button type="button" variant="outline" size="sm" className="mb-4" onClick={() => setAbierto(true)}>
        <Plus className="h-3.5 w-3.5" />
        Entregar un material que la OT no tiene
      </Button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 rounded-md border border-border bg-muted/30 p-4">
      <p className="mb-2 text-xs text-muted-foreground">
        Para un material que todavía no está cargado en esta OT — se crea un pedido nuevo, sin esperar a que se
        actualice la OT.
      </p>
      <div className="flex flex-col gap-2">
        <Combobox
          value={materialId}
          onChange={setMaterialId}
          options={materialOptions}
          placeholder="Buscar código MP..."
          emptyText="Sin materiales activos que coincidan"
        />
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={procesoId}
            onValueChange={(v) => {
              setProcesoId(v)
              setMaquinaId('')
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Proceso" />
            </SelectTrigger>
            <SelectContent>
              {procesos.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={maquinaId} onValueChange={setMaquinaId} disabled={!procesoId}>
            <SelectTrigger>
              <SelectValue placeholder="Máquina" />
            </SelectTrigger>
            <SelectContent>
              {maquinas.data?.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <CampoCantidad
          unidad={material?.unidad ?? ''}
          usaBobinas={material?.usa_bobinas ?? true}
          datos={datos}
          onChange={(d) => setDatos({ ...datos, ...d })}
        />
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button type="submit" size="sm" disabled={registrar.isPending}>
          {registrar.isPending ? 'Registrando...' : 'Registrar'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

interface PendienteForm {
  materialId: string
  procesoId: string
  maquinaId: string
}

function PendienteCard({
  pendiente,
  procesos,
  materiales,
  materialOptions,
  fecha,
  onRegistrado
}: {
  pendiente: OtMaterialPendiente
  procesos: Proceso[]
  materiales: Material[]
  materialOptions: { value: string; label: string }[]
  fecha: string
  onRegistrado: (entregas: Entrega[]) => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [form, setForm] = useState<PendienteForm>({
    materialId: pendiente.material_id != null ? String(pendiente.material_id) : '',
    procesoId: '',
    maquinaId: ''
  })
  const materialPedido = materiales.find((m) => String(m.id) === form.materialId)
  const [seleccion, setSeleccion] = useState<SeleccionPedido>(() => seleccionVacia({ usa_bobinas: true }))
  const [error, setError] = useState<string | null>(null)
  const [crearMaterialAbierto, setCrearMaterialAbierto] = useState(false)

  const maquinas = useQuery({
    queryKey: ['maquinas', form.procesoId],
    queryFn: () => api.listarMaquinas(apiBaseUrl, token, Number(form.procesoId)),
    enabled: !!form.procesoId
  })

  // Con proceso y máquina elegidos el pendiente se convierte en pedido; sin
  // ellos se queda pendiente y solo recibe materia prima.
  const asignar = Boolean(form.procesoId && form.maquinaId)

  const mutation = useMutation({
    mutationFn: async () => {
      // Sin proceso elegido el pendiente sigue siendo pendiente y la materia
      // prima se le cuelga igual — ver requiereAsignacion. La materia prima
      // no promueve el pendiente, así que si acá es la primera vez que se
      // indica a qué material del catálogo corresponde, hay que guardarlo
      // aparte — si no, se pierde apenas se cambia de pantalla y la próxima
      // vez vuelve a preguntar (ver ordenes_controller.actualizar_pendiente,
      // que ya permite esto aunque el pendiente tenga materia prima cargada).
      if (!asignar && form.materialId && pendiente.material_id == null) {
        await api.editarPendiente(apiBaseUrl, token, pendiente.id, { material_id: Number(form.materialId) })
      }
      const destino = asignar
        ? {
            ot_material_id: (
              await api.promoverPendiente(apiBaseUrl, token, pendiente.id, {
                proceso_id: Number(form.procesoId),
                maquina_id: Number(form.maquinaId),
                material_id: form.materialId ? Number(form.materialId) : null
              })
            ).ot_material_id
          }
        : { pendiente_id: pendiente.id }
      return enviarSeleccion(apiBaseUrl, token, destino, fecha, seleccion, pendiente.codigo_mp, materiales)
    },
    onSuccess: ({ exitos, fallos }) => {
      setError(
        fallos.length > 0
          ? `Algunos materiales no se pudieron registrar (podés reintentarlos): ${fallos.join(', ')}`
          : null
      )
      // Limpiar lo que sí entró, para que no quede en pantalla como si
      // faltara guardarlo — y no se registre dos veces de un click de más.
      if (fallos.length === 0) setSeleccion(seleccionVacia({ usa_bobinas: true }))
      onRegistrado(exitos)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo registrar')
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.materialId) {
      setError('Indica a qué material del catálogo corresponde')
      return
    }
    if (requiereAsignacion(seleccion) && !asignar) {
      setError(`Para entregar ${pendiente.codigo_mp} elegí su proceso y su máquina`)
      return
    }
    if (Boolean(form.procesoId) !== Boolean(form.maquinaId)) {
      setError('Elegiste proceso pero falta la máquina (o al revés)')
      return
    }
    const problema = validarSeleccion(seleccion)
    if (problema) {
      setError(problema)
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-warning/30 bg-warning/5 p-4">
      <p className="mb-3 text-sm font-medium">
        {pendiente.codigo_mp}
        {pendiente.cantidad_requerida != null
          ? ` — ${pendiente.cantidad_requerida}${materialPedido?.unidad ? ` ${materialPedido.unidad}` : ''} (del Excel)`
          : ''}
      </p>

      {pendiente.materias_primas.length > 0 && (
        <p className="mb-3 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          Materia prima ya entregada: {pendiente.materias_primas.join(', ')}.
        </p>
      )}

      {pendiente.material_id == null && (
        <div className="mb-3 flex flex-col gap-1.5">
          <Label className="text-xs">¿A qué material del catálogo corresponde?</Label>
          <Combobox
            value={form.materialId}
            onChange={(v) => setForm({ ...form, materialId: v })}
            options={materialOptions}
            placeholder="Buscar código MP..."
            emptyText="Sin materiales activos que coincidan"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setCrearMaterialAbierto(true)}
          >
            No está en el catálogo — crear "{pendiente.codigo_mp}" como material nuevo
          </Button>
          <CrearMaterialDialog
            open={crearMaterialAbierto}
            codigoInicial={pendiente.codigo_mp}
            onOpenChange={setCrearMaterialAbierto}
            onCreado={(material) => setForm({ ...form, materialId: String(material.id) })}
            materialesExistentes={materiales}
          />
        </div>
      )}

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Proceso {requiereAsignacion(seleccion) ? '(obligatorio)' : '(opcional)'}</Label>
          <Select value={form.procesoId} onValueChange={(v) => setForm({ ...form, procesoId: v, maquinaId: '' })}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona" />
            </SelectTrigger>
            <SelectContent>
              {procesos.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Máquina {requiereAsignacion(seleccion) ? '(obligatorio)' : '(opcional)'}</Label>
          <Select
            value={form.maquinaId}
            onValueChange={(v) => setForm({ ...form, maquinaId: v })}
            disabled={!form.procesoId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecciona" />
            </SelectTrigger>
            <SelectContent>
              {maquinas.data?.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Proceso y máquina solo hacen falta para entregar el material; para
          cargarle materia prima no, y a veces todavía no se sabe adónde va.
          Ver requiereAsignacion. */}
      <p className="mb-2 text-xs text-muted-foreground">
        Cantidad que sale de almacén ahora. Si todavía no sale nada, dejala vacía.
      </p>

      <EntregaDelPedido
        datos={seleccion.entrega}
        onChange={(entrega) => setSeleccion({ ...seleccion, entrega })}
        materiales={materiales}
        materialOptions={materialOptions}
        unidadPedido={materialPedido?.unidad ?? ''}
        usaBobinasPedido={materialPedido?.usa_bobinas ?? true}
        requerido={!seleccion.materiasPrimas.some(tieneCantidad)}
      />

      <MateriasPrimas
        entradas={seleccion.materiasPrimas}
        onChange={(materiasPrimas) => setSeleccion({ ...seleccion, materiasPrimas })}
        materiales={materiales}
        materialOptions={materialOptions}
        procesos={procesos}
      />

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <Button type="submit" className="mt-3" disabled={mutation.isPending}>
        {mutation.isPending
          ? 'Guardando...'
          : requiereAsignacion(seleccion)
            ? 'Asignar y registrar entrega'
            : asignar
              ? 'Asignar y registrar materia prima'
              : 'Registrar materia prima'}
      </Button>
    </form>
  )
}

/** Cambiar el proceso/máquina de un pedido ya creado. El proceso se elige
 * antes de saberlo con certeza —al asignar el material, incluso cuando lo que
 * se está cargando es solo su materia prima— así que equivocarse no puede
 * obligar a rehacer la OT. Lo ya entregado/devuelto se mueve con el pedido.
 * Ver ordenes_controller.mover_pedido. */
function MoverPedido({
  pedido,
  procesos,
  onMovido
}: {
  pedido: Consumo
  procesos: Proceso[]
  onMovido: () => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [abierto, setAbierto] = useState(false)
  const [procesoId, setProcesoId] = useState('')
  const [maquinaId, setMaquinaId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const maquinas = useQuery({
    queryKey: ['maquinas', procesoId],
    queryFn: () => api.listarMaquinas(apiBaseUrl, token, Number(procesoId)),
    enabled: !!procesoId
  })

  const mutation = useMutation({
    mutationFn: () =>
      api.moverPedido(apiBaseUrl, token, pedido.ot_material_id, {
        proceso_id: Number(procesoId),
        maquina_id: Number(maquinaId)
      }),
    onSuccess: () => {
      setAbierto(false)
      setProcesoId('')
      setMaquinaId('')
      setError(null)
      onMovido()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo mover el pedido')
  })

  if (!abierto) {
    return (
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setAbierto(true)}>
        Este pedido va a otro proceso — mover
      </Button>
    )
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        Mover {pedido.codigo_mp} de {pedido.proceso} · {pedido.maquina} a:
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select
          value={procesoId}
          onValueChange={(v) => {
            setProcesoId(v)
            setMaquinaId('')
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Proceso" />
          </SelectTrigger>
          <SelectContent>
            {procesos.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={maquinaId} onValueChange={setMaquinaId} disabled={!procesoId}>
          <SelectTrigger>
            <SelectValue placeholder="Máquina" />
          </SelectTrigger>
          <SelectContent>
            {maquinas.data?.map((m) => (
              <SelectItem key={m.id} value={String(m.id)}>
                {m.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Lo que ya se entregó o devolvió se mueve con el pedido. Su materia prima no se toca: tiene su propio
        proceso.
      </p>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!procesoId || !maquinaId || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Moviendo...' : 'Mover'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

/** Corregir el material o la cantidad de un pedido ya asignado a un proceso
 * — para el mismo tipo de error de tipeo del Excel que ya se puede arreglar
 * en un pendiente (ver DetalleOt.tsx), pero para cuando el material ya se
 * promovió. Se bloquea (ni se ofrece el botón) en cuanto el pedido tiene
 * algo real registrado — entregas, devoluciones o materia prima — porque
 * ahí ya no es "solo un dato pedido", es material que se movió de verdad. */
function EditarPedido({
  pedido,
  materialOptions,
  onEditado,
  onEliminado
}: {
  pedido: Consumo
  materialOptions: { value: string; label: string }[]
  onEditado: () => void
  onEliminado: () => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [abierto, setAbierto] = useState(false)
  const [materialId, setMaterialId] = useState('')
  const [cantidad, setCantidad] = useState(
    pedido.cantidad_requerida != null ? String(pedido.cantidad_requerida) : ''
  )
  const [error, setError] = useState<string | null>(null)

  // Corregir a qué material corresponde el pedido sigue siendo seguro con
  // materia prima, entregas o devoluciones ya cargadas (ver
  // ordenes_controller.actualizar_pedido — bloqueado solo si alguna ya tiene
  // el SID completado, el backend avisa si es el caso). La cantidad y el
  // borrado del pedido entero sí quedan bloqueados apenas hay cualquier
  // movimiento — ver eliminar_pedido.
  const tieneMovimiento =
    pedido.tiene_materia_prima ||
    pedido.total_entregado > 0 ||
    pedido.total_devuelto > 0 ||
    pedido.total_ingresado > 0
  const soloCorregirMaterial = tieneMovimiento

  const editar = useMutation({
    mutationFn: () =>
      api.editarPedido(apiBaseUrl, token, pedido.ot_material_id, {
        material_id: materialId ? Number(materialId) : undefined,
        cantidad_requerida: soloCorregirMaterial || !cantidad ? undefined : Number(cantidad)
      }),
    onSuccess: () => {
      setAbierto(false)
      setError(null)
      onEditado()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo guardar')
  })

  const eliminar = useMutation({
    mutationFn: () => api.eliminarPedido(apiBaseUrl, token, pedido.ot_material_id),
    onSuccess: onEliminado,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo eliminar')
  })

  function handleEliminar() {
    if (!confirm(`¿Eliminar el pedido de ${pedido.codigo_mp}? Esta acción no se puede deshacer.`)) return
    eliminar.mutate()
  }

  if (!abierto) {
    return (
      <div className="mt-3 flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setAbierto(true)}>
          {soloCorregirMaterial ? 'Corregir material' : 'Corregir material/cantidad'}
        </Button>
        {!soloCorregirMaterial && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={eliminar.isPending}
            onClick={handleEliminar}
          >
            {eliminar.isPending ? 'Eliminando...' : 'Eliminar pedido'}
          </Button>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        {soloCorregirMaterial
          ? `A qué material corresponde realmente ${pedido.codigo_mp} — por ejemplo si se resolvió a uno equivocado del catálogo:`
          : `Corregir ${pedido.codigo_mp} — por ejemplo si el código o la cantidad vinieron mal del Excel:`}
      </p>
      <div className="flex flex-col gap-2">
        <Combobox
          value={materialId}
          onChange={setMaterialId}
          options={materialOptions}
          placeholder="Nuevo material (dejalo vacío para no cambiarlo)"
          emptyText="Sin materiales activos que coincidan"
        />
        {!soloCorregirMaterial && (
          <Input
            type="number"
            step="0.01"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            placeholder={`Cantidad${pedido.unidad ? ` (${pedido.unidad})` : ''}`}
          />
        )}
      </div>
      {soloCorregirMaterial && (
        <p className="mt-1 text-xs text-muted-foreground">
          Ya tiene materia prima cargada — la cantidad y el borrado del pedido ya no se pueden tocar desde acá.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" disabled={editar.isPending} onClick={() => editar.mutate()}>
          {editar.isPending ? 'Guardando...' : 'Guardar'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

function PedidoEntregaCard({
  pedido,
  seleccion,
  onChange,
  onQuitar,
  materiales,
  materialOptions,
  procesos,
  onMovido
}: {
  pedido: Consumo
  seleccion: SeleccionPedido
  onChange: (seleccion: SeleccionPedido) => void
  onQuitar: () => void
  materiales: Material[]
  materialOptions: { value: string; label: string }[]
  procesos: Proceso[]
  onMovido: () => void
}) {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium">
          {pedido.codigo_mp}
          <span className="ml-2 font-normal text-muted-foreground">
            {pedido.proceso} · {pedido.maquina}
          </span>
        </p>
        <button type="button" onClick={onQuitar} className="text-muted-foreground hover:text-destructive">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Un pedido cuyo material se fabrica en esta OT puede no tener nada que
          entregar todavía: primero se le carga la materia prima, después el
          material fabricado entra a almacén (Registrar Devolución) y recién
          ahí se entrega. Por eso la cantidad de arriba puede quedar vacía. */}
      {pedido.tiene_materia_prima && pedido.total_ingresado === 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          A este pedido se le agregó materia prima. Cuando el {pedido.codigo_mp} esté fabricado, registrá su ingreso
          a almacén desde Registrar Devolución y después entregalo acá.
        </p>
      )}

      <EntregaDelPedido
        datos={seleccion.entrega}
        onChange={(entrega) => onChange({ ...seleccion, entrega })}
        materiales={materiales}
        materialOptions={materialOptions}
        unidadPedido={pedido.unidad}
        usaBobinasPedido={pedido.usa_bobinas}
        requerido={!seleccion.materiasPrimas.some(tieneCantidad)}
        procesos={procesos}
        procesoIdPedido={String(pedido.proceso_id)}
        maquinaIdPedido={String(pedido.maquina_id)}
      />

      <MateriasPrimas
        entradas={seleccion.materiasPrimas}
        onChange={(materiasPrimas) => onChange({ ...seleccion, materiasPrimas })}
        materiales={materiales}
        materialOptions={materialOptions}
        procesos={procesos}
      />

      <MoverPedido pedido={pedido} procesos={procesos} onMovido={onMovido} />

      <EditarPedido
        pedido={pedido}
        materialOptions={materialOptions}
        onEditado={onMovido}
        onEliminado={() => {
          onQuitar()
          onMovido()
        }}
      />
    </div>
  )
}

export function RegistrarEntrega() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [numeroOt, setNumeroOt] = useState('')
  const [otBuscada, setOtBuscada] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<Record<number, SeleccionPedido>>({})
  const [fecha, setFecha] = useState(hoyISO())
  const [error, setError] = useState<string | null>(null)
  const [confirmaciones, setConfirmaciones] = useState<Entrega[]>([])
  // El cartel de confirmación está arriba de todo y las tarjetas de pendientes
  // quedan bastante más abajo: sin traerlo a la vista, guardar desde una de
  // ellas no daba ninguna señal en pantalla.
  const confirmacionRef = useRef<HTMLDivElement>(null)

  const pedidos = useQuery({
    queryKey: ['consumo', otBuscada],
    queryFn: () => api.consultarConsumo(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  const pendientes = useQuery({
    queryKey: ['pendientes', otBuscada],
    queryFn: () => api.listarPendientes(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  // Solo para ubicar de qué cliente/producto es esta OT en pantalla — el
  // personal en planta trabaja con muchas OT abiertas a la vez y el número
  // solo no alcanza para reconocerla de un vistazo. Si la OT no existe en
  // la base (todavía solo en Excel) esto falla en silencio y no se muestra
  // el encabezado; el aviso de "Ve a Crear OT" ya cubre ese caso.
  const otDetalle = useQuery({
    queryKey: ['ot-detalle', otBuscada],
    queryFn: () => api.obtenerDetalleOt(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada,
    retry: false
  })

  // Solo para mostrar "¿por cuál material se entregó?" en la lista de
  // pedidos — la mayoría de las OT no tienen sustituciones, pero es una
  // sola consulta para toda la OT, no una por pedido.
  const entregas = useQuery({
    queryKey: ['entregas', otBuscada],
    queryFn: () => api.listarEntregas(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  const entregasPorPedido = useMemo(() => {
    const mapa = new Map<number, typeof entregas.data>()
    for (const e of entregas.data ?? []) {
      mapa.set(e.ot_material_id, [...(mapa.get(e.ot_material_id) ?? []), e])
    }
    return mapa
  }, [entregas.data])

  // Los cargos de tinta (Laminación, FLaminación, Superficie) no se entregan
  // en planta — se registran en Crear OT, pero no aparecen aquí.
  const pedidosVisibles = useMemo(() => pedidos.data?.filter((p) => !p.es_tinta), [pedidos.data])
  const pendientesVisibles = useMemo(() => pendientes.data?.filter((p) => !p.es_tinta), [pendientes.data])

  const procesos = useQuery({ queryKey: ['procesos'], queryFn: () => api.listarProcesos(apiBaseUrl, token) })
  const materiales = useQuery({ queryKey: ['materiales'], queryFn: () => api.listarMateriales(apiBaseUrl, token) })

  // Listado de OT recientes a las que todavía les falta alguna entrega, para
  // no obligar a escribir el número si no se lo sabe de memoria. Solo se
  // muestra antes de buscar una OT puntual, para no competir con esa vista.
  const otsRecientes = useQuery({
    queryKey: ['ordenes-trabajo-recientes'],
    queryFn: () => api.listarOrdenes(apiBaseUrl, token),
    enabled: !otBuscada
  })
  const consumoTodo = useQuery({
    queryKey: ['consumo-todo'],
    queryFn: () => api.consultarConsumo(apiBaseUrl, token),
    enabled: !otBuscada
  })

  const otsConEntregaPendiente = useMemo(() => {
    // Una OT necesita entrega si tiene algún pedido sin completar, o si
    // todavía no tiene ningún pedido (recién creada, sus materiales siguen
    // como pendientes sin proceso/máquina asignado — ver Crear OT).
    const conPedidos = new Set<string>()
    const conPendiente = new Set<string>()
    for (const p of consumoTodo.data ?? []) {
      if (p.es_tinta) continue
      conPedidos.add(p.numero_ot)
      if (p.estado_entrega === 'PENDIENTE' || p.estado_entrega === 'PARCIAL') conPendiente.add(p.numero_ot)
    }
    return { conPedidos, conPendiente }
  }, [consumoTodo.data])

  const otsPendientesRecientes = useMemo(() => {
    if (!otsRecientes.data) return []
    return otsRecientes.data
      .filter(
        (ot) =>
          otsConEntregaPendiente.conPendiente.has(ot.numero_ot) ||
          !otsConEntregaPendiente.conPedidos.has(ot.numero_ot)
      )
      .slice(0, 15)
  }, [otsRecientes.data, otsConEntregaPendiente])

  const materialOptions = useMemo(
    () =>
      (materiales.data ?? []).map((m) => ({
        value: String(m.id),
        label: m.codigo_mp + (m.descripcion ? ` — ${m.descripcion}` : '')
      })),
    [materiales.data]
  )

  function alMoverPedido() {
    queryClient.invalidateQueries({ queryKey: ['consumo', otBuscada] })
  }

  // Lo registrado desde una tarjeta de pendiente va al mismo cartel verde de
  // arriba que el resto: sin eso no quedaba ninguna señal de que se guardó.
  function alPromoverPendiente(entregas: Entrega[]) {
    setConfirmaciones(entregas)
    setError(null)
    requestAnimationFrame(() => confirmacionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    queryClient.invalidateQueries({ queryKey: ['pendientes', otBuscada] })
    queryClient.invalidateQueries({ queryKey: ['consumo', otBuscada] })
    queryClient.invalidateQueries({ queryKey: ['entregas', otBuscada] })
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const exitosEntrega: Entrega[] = []
      const mensajesFallidos: string[] = []
      const restantePorPedido = new Map<number, SeleccionPedido>()

      for (const [otMaterialIdStr, sel] of Object.entries(seleccion)) {
        const otMaterialId = Number(otMaterialIdStr)
        const pedido = pedidos.data?.find((p) => p.ot_material_id === otMaterialId)
        const { exitos, fallos, restante } = await enviarSeleccion(
          apiBaseUrl,
          token,
          { ot_material_id: otMaterialId },
          fecha,
          sel,
          pedido?.codigo_mp ?? `#${otMaterialId}`,
          materiales.data ?? []
        )
        exitosEntrega.push(...exitos)
        mensajesFallidos.push(...fallos)
        if (restante) restantePorPedido.set(otMaterialId, restante)
      }

      return { exitosEntrega, mensajesFallidos, restantePorPedido }
    },
    onSuccess: ({ exitosEntrega, mensajesFallidos, restantePorPedido }) => {
      setConfirmaciones(exitosEntrega)
      setError(mensajesFallidos.length > 0 ? `No se pudieron registrar: ${mensajesFallidos.join(', ')}` : null)
      setSeleccion(() => {
        const restante: Record<number, SeleccionPedido> = {}
        for (const [otMaterialId, sel] of restantePorPedido) restante[otMaterialId] = sel
        return restante
      })
      queryClient.invalidateQueries({ queryKey: ['consumo', otBuscada] })
      queryClient.invalidateQueries({ queryKey: ['entregas', otBuscada] })
    },
    onError: () => setError('Error al registrar las entregas')
  })

  function buscar(e: FormEvent) {
    e.preventDefault()
    setConfirmaciones([])
    setSeleccion({})
    setOtBuscada(numeroOt)
  }

  function seleccionarOtRecomendada(numero: string) {
    setNumeroOt(numero)
    setConfirmaciones([])
    setSeleccion({})
    setOtBuscada(numero)
  }

  function toggleSeleccion(pedido: Consumo) {
    setConfirmaciones([])
    setSeleccion((prev) => {
      const copia = { ...prev }
      if (copia[pedido.ot_material_id]) {
        delete copia[pedido.ot_material_id]
      } else {
        copia[pedido.ot_material_id] = seleccionVaciaContinuando(pedido, entregasPorPedido.get(pedido.ot_material_id))
      }
      return copia
    })
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const pedidosSeleccionados = Object.entries(seleccion)
    if (pedidosSeleccionados.length === 0) {
      setError('Selecciona al menos un material')
      return
    }
    for (const [, sel] of pedidosSeleccionados) {
      const problema = validarSeleccion(sel)
      if (problema) {
        setError(problema)
        return
      }
    }
    setError(null)
    mutation.mutate()
  }

  const hayPedidosSeleccionados = Object.keys(seleccion).length > 0

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold">Registrar Entrega de Materia Prima</h1>

      {confirmaciones.length > 0 && (
        <motion.div
          ref={confirmacionRef}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-6 flex flex-col gap-2 rounded-md border border-success/30 bg-success/10 p-4"
        >
          {confirmaciones.map((confirmacion) => (
            <div key={`entrega-${confirmacion.id}`} className="flex items-start gap-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <div>
                <p>
                  {confirmacion.total_entregado} {confirmacion.unidad} de {confirmacion.codigo_mp}
                  {confirmacion.codigo_mp_entregado !== confirmacion.codigo_mp
                    ? ` — se entregó como ${confirmacion.codigo_mp_entregado}`
                    : ''}{' '}
                  ({confirmacion.proceso} · {confirmacion.maquina}).
                </p>
                {confirmacion.pedido_creado && (
                  <p className="text-muted-foreground">
                    Se creó el pedido de {confirmacion.codigo_mp} en {confirmacion.proceso} — {confirmacion.maquina}.
                  </p>
                )}
                {confirmacion.observacion && (
                  <p className="text-muted-foreground">Nota: {confirmacion.observacion}</p>
                )}
                {confirmacion.cantidad_requerida ? (
                  <p className="text-muted-foreground">
                    Van {confirmacion.total_entregado_pedido} de {confirmacion.cantidad_requerida}{' '}
                    {confirmacion.unidad} requeridos
                    {confirmacion.total_entregado_pedido >= confirmacion.cantidad_requerida
                      ? ' — pedido completo.'
                      : ` — faltan ${(confirmacion.cantidad_requerida - confirmacion.total_entregado_pedido).toFixed(2)} ${confirmacion.unidad}.`}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Acumulado del pedido: {confirmacion.total_entregado_pedido} {confirmacion.unidad}
                  </p>
                )}
              </div>
            </div>
          ))}
        </motion.div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Buscar OT</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={buscar} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>Número de OT</Label>
              <Input value={numeroOt} onChange={(e) => setNumeroOt(e.target.value)} placeholder="2121" />
            </div>
            <Button type="submit" variant="outline">
              <Search className="h-4 w-4" />
              Buscar
            </Button>
          </form>

          {otDetalle.isSuccess && (otDetalle.data.cliente || otDetalle.data.descripcion_producto) && (
            <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{otDetalle.data.cliente ?? 'Sin cliente'}</p>
              {otDetalle.data.descripcion_producto && (
                <p className="text-muted-foreground">{otDetalle.data.descripcion_producto}</p>
              )}
            </div>
          )}

          {otBuscada && (
            <div className="mt-4">
              <EntregaLibreForm
                numeroOt={otBuscada}
                fecha={fecha}
                materiales={materiales.data ?? []}
                materialOptions={materialOptions}
                procesos={procesos.data ?? []}
                onRegistrado={alPromoverPendiente}
              />
            </div>
          )}

          {pedidos.isSuccess &&
            pedidosVisibles?.length === 0 &&
            pendientes.isSuccess &&
            pendientesVisibles?.length === 0 && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                <p className="flex items-start gap-2">
                  <PackagePlus className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  Esta OT no tiene materiales pedidos todavía.
                </p>
                <Button type="button" size="sm" variant="outline" onClick={() => navigate('/crear-ot')}>
                  Ve a Crear OT
                </Button>
              </div>
            )}

          {pedidosVisibles && pedidosVisibles.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Materiales pedidos en esta OT — marca todos a los que corresponda la entrega:
              </p>
              {pedidosVisibles.map((pedido) => {
                const materialesSustituidos = [
                  ...new Set(
                    (entregasPorPedido.get(pedido.ot_material_id) ?? [])
                      .map((e) => e.codigo_mp_entregado)
                      .filter((codigo) => codigo !== pedido.codigo_mp)
                  )
                ]
                return (
                  <button
                    key={pedido.ot_material_id}
                    type="button"
                    onClick={() => toggleSeleccion(pedido)}
                    className={cn(
                      'flex flex-col rounded-md border p-3 text-left text-sm transition-colors',
                      seleccion[pedido.ot_material_id]
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:bg-muted'
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {pedido.proceso} — {pedido.maquina} — {pedido.codigo_mp}
                      {pedido.tiene_materia_prima && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          <Beaker className="h-3 w-3" />
                          se fabrica en esta OT
                        </span>
                      )}
                      {pedido.es_materia_prima && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          materia prima de {pedido.insumo_de_codigo_mp}
                        </span>
                      )}
                      {materialesSustituidos.length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                          <ArrowRightLeft className="h-3 w-3" />
                          {materialesSustituidos.join(', ')}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {pedido.diseno ? `Diseño: ${pedido.diseno} · ` : ''}Entregado: {pedido.total_entregado}{' '}
                      {pedido.unidad}
                      {pedido.cantidad_requerida ? ` de ${pedido.cantidad_requerida} requeridos` : ''}
                      {pedido.total_ingresado > 0 ? ` · Fabricado en almacén: ${pedido.total_ingresado}` : ''} ·{' '}
                      {pedido.estado_entrega}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {!otBuscada && otsPendientesRecientes.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>OT recientes con entregas pendientes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {otsPendientesRecientes.map((ot) => (
              <button
                key={ot.id}
                type="button"
                onClick={() => seleccionarOtRecomendada(ot.numero_ot)}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-left text-sm transition-colors hover:bg-muted"
              >
                <div className="min-w-0">
                  <p className="font-medium">OT {ot.numero_ot}</p>
                  <p className="truncate text-muted-foreground">
                    {ot.cliente ?? 'Sin cliente'}
                    {ot.diseno ? ` · ${ot.diseno}` : ''}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  {formatearFechaHoraCompleta(ot.fecha_creacion)}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {pendientesVisibles && pendientesVisibles.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Materiales pendientes de asignar (vienen del Excel)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Estos materiales vinieron de la hoja Excel sin proceso ni máquina. Asígnalos y registra la entrega
              en un solo paso.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label>Fecha</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="max-w-40" />
            </div>
            {pendientesVisibles.map((pendiente) => (
              <PendienteCard
                key={pendiente.id}
                pendiente={pendiente}
                procesos={procesos.data ?? []}
                materiales={materiales.data ?? []}
                materialOptions={materialOptions}
                fecha={fecha}
                onRegistrado={alPromoverPendiente}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {hayPedidosSeleccionados && (
        <Card>
          <CardHeader>
            <CardTitle>Cantidades entregadas</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Fecha</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>

              {pedidosVisibles
                ?.filter((p) => seleccion[p.ot_material_id])
                .map((pedido) => (
                  <PedidoEntregaCard
                    key={pedido.ot_material_id}
                    pedido={pedido}
                    seleccion={seleccion[pedido.ot_material_id]}
                    onChange={(sel) => setSeleccion((prev) => ({ ...prev, [pedido.ot_material_id]: sel }))}
                    onQuitar={() => toggleSeleccion(pedido)}
                    materiales={materiales.data ?? []}
                    materialOptions={materialOptions}
                    procesos={procesos.data ?? []}
                    onMovido={alMoverPedido}
                  />
                ))}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending
                  ? 'Guardando...'
                  : `Guardar ${Object.keys(seleccion).length > 1 ? `${Object.keys(seleccion).length} entregas` : 'entrega'}`}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
