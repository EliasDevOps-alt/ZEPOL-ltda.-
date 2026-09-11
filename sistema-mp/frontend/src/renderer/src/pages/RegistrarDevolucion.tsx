import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowRightLeft, Beaker, CheckCircle2, FileSpreadsheet, Plus, Search, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Combobox } from '@renderer/components/ui/combobox'
import { CampoCantidad, type BobinasPedido } from '@renderer/components/CampoCantidad'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import { hoyISO } from '@renderer/lib/fechas'
import type { Consumo, Devolucion, Entrega, Material, OtMaterialPendiente } from '@renderer/lib/types'

interface EntradaDevolucion extends BobinasPedido {
  // Material que realmente se está devolviendo — un pedido puede tener
  // entregas de más de uno (por una sustitución), así que hace falta elegir
  // de cuál se devuelve.
  materialId: string
}

function entradaVacia(): EntradaDevolucion {
  return { materialId: '', cantidadBobinas: '', bobinas: [] }
}

/** Lo que entra a almacén de un material que todavía no tiene pedido. */
interface EntradaIngreso extends BobinasPedido {
  materialId: string
}

/** Esta pantalla registra las dos formas en que un material vuelve de planta a
 * almacén, que van a la misma tabla pero cuentan distinto:
 *  - 'sobrante': material que se había entregado y no se usó. Descuenta del
 *    consumo neto del pedido.
 *  - 'ingreso': material FABRICADO en esta OT entrando a almacén por primera
 *    vez (el LDPE-4 que salió de mezclar LDPE-1 y LDPE-2). Nunca se había
 *    entregado, así que no descuenta nada — recién después se entrega al
 *    proceso que lo pidió, desde Registrar Entrega. Solo se ofrece en pedidos
 *    con materia prima cargada (Consumo.tiene_materia_prima). */
type ModoDevolucion = 'sobrante' | 'ingreso'

interface SeleccionDevolucion {
  modo: ModoDevolucion
  entradas: EntradaDevolucion[]
}

function seleccionVacia(pedido: Consumo): SeleccionDevolucion {
  return {
    // Si el material de este pedido se fabrica en la OT, lo que se viene a
    // registrar casi siempre es su ingreso a almacén.
    modo: pedido.tiene_materia_prima ? 'ingreso' : 'sobrante',
    entradas: [
      {
        ...(pedido.usa_bobinas ? { cantidadBobinas: '', bobinas: [] } : { cantidadBobinas: '1', bobinas: [''] }),
        materialId: String(pedido.material_id)
      }
    ]
  }
}

/** Material que producción entrega y entra a almacén, cuando todavía figura
 * como pendiente (sin pedido). Pasa siempre que a un material hubo que
 * fabricarlo: su materia prima salió de almacén antes de que se supiera a qué
 * proceso iría el resultado.
 *
 * Acá NO se pregunta proceso ni máquina, a propósito: este movimiento es
 * producción -> almacén, y almacén no tiene máquinas. El proceso se elige
 * cuando el material sale hacia producción, en Registrar Entrega. Lo único que
 * hace falta registrar es cuánto entró — y se puede registrar varias veces,
 * porque producción puede entregar en tandas (hoy 2 bobinas, mañana 1). */
function ingresoVacio(): EntradaIngreso {
  return { materialId: '', cantidadBobinas: '', bobinas: [] }
}

/** Lo que fabrica producción puede salir dividido en más de un material en
 * una sola tanda (ej. de 100kg que entran a extrusión, 80kg salen como
 * LDPE-3 y 20kg como una variante fuera de especificación) — antes había que
 * registrar cada uno por separado (todo el submit, buscar la OT de nuevo,
 * volver a seleccionar el pendiente), lo cual era tedioso para algo que pasa
 * en el mismo momento. Ahora es una lista repetible como la de materia prima
 * en Registrar Entrega: "+ Agregar otro material" agrega una fila más, y se
 * manda un POST /devoluciones por fila en un solo submit. */
function PendienteIngresoCard({
  pendiente,
  materiales,
  materialOptions,
  entradas,
  onChange,
  onQuitar
}: {
  pendiente: OtMaterialPendiente
  materiales: Material[]
  materialOptions: { value: string; label: string }[]
  entradas: EntradaIngreso[]
  onChange: (entradas: EntradaIngreso[]) => void
  onQuitar: () => void
}) {
  // Si el pendiente ya se resolvió a un material del catálogo (ver el
  // Combobox "¿A qué material corresponde?" más abajo), mostrar ESE código
  // como identidad principal — el código de Excel puede no significar nada
  // para quien lo lee (ej. "LDPE45840" cuando el material real es "LDPE-3").
  // Se conserva igual al lado, con ícono, para poder rastrear de qué pedido
  // de Excel viene.
  const materialResuelto = pendiente.material_id != null ? materiales.find((m) => m.id === pendiente.material_id) : undefined

  function actualizar(indice: number, cambios: Partial<EntradaIngreso>) {
    onChange(entradas.map((e, i) => (i === indice ? { ...e, ...cambios } : e)))
  }
  function agregar() {
    onChange([...entradas, ingresoVacio()])
  }
  function quitar(indice: number) {
    onChange(entradas.filter((_, i) => i !== indice))
  }

  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 p-4">
      <div className="mb-1 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {materialResuelto ? materialResuelto.codigo_mp : pendiente.codigo_mp}
          {materialResuelto && (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <FileSpreadsheet className="h-3 w-3" />
              {pendiente.codigo_mp}
            </span>
          )}
        </p>
        <button type="button" onClick={onQuitar} className="text-muted-foreground hover:text-destructive">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        <span className="font-medium text-warning">Producción lo está entregando.</span> Entra a almacén, no es un
        sobrante — no descuenta del consumo.
        {pendiente.total_ingresado > 0 && ` Ya entraron ${pendiente.total_ingresado} en entregas anteriores.`}
      </p>

      {entradas.map((entrada, indice) => {
        const material = materiales.find((m) => String(m.id) === entrada.materialId)
        // Sin resolver, cada fila necesita su propio match — puede que la
        // primera sea LDPE-3 y la segunda una variante que tampoco está en
        // el Excel. Ya resuelto, con una sola fila no hace falta preguntar
        // (se asume el material del pendiente); con más de una sí, para
        // distinguir cuál es cuál.
        const necesitaCombobox = pendiente.material_id == null || entradas.length > 1
        return (
          <div key={indice} className={indice > 0 ? 'mt-3 border-t border-warning/30 pt-3' : ''}>
            {necesitaCombobox && (
              <div className="mb-2 flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label className="text-xs">
                    {pendiente.material_id == null
                      ? '¿A qué material del catálogo corresponde?'
                      : 'Esta tanda entró como'}
                  </Label>
                  <Combobox
                    value={entrada.materialId}
                    onChange={(v) => actualizar(indice, { materialId: v })}
                    options={materialOptions}
                    placeholder="Buscar código MP..."
                    emptyText="Sin materiales activos que coincidan"
                  />
                </div>
                {indice > 0 && (
                  <button
                    type="button"
                    onClick={() => quitar(indice)}
                    className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10"
                    aria-label="Quitar este material"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            <CampoCantidad
              unidad={material?.unidad ?? ''}
              usaBobinas={material?.usa_bobinas ?? true}
              datos={entrada}
              onChange={(d) => actualizar(indice, d)}
            />
          </div>
        )
      })}

      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={agregar}>
        <Plus className="h-3.5 w-3.5" />
        Agregar otro material
      </Button>

      <p className="mt-2 text-xs text-muted-foreground">
        Cuando salga hacia producción, en Registrar Entrega elegís el proceso y la máquina.
      </p>
    </div>
  )
}

/** Contraparte de EntregaLibreForm (Registrar Entrega) — un material
 * fabricado que entra a almacén sin que nadie haya cargado antes en la OT
 * que hacía falta. Crea (o reutiliza) un pendiente suelto y registra el
 * ingreso contra él en el mismo paso. Sin proceso ni máquina a propósito —
 * esto es producción → almacén, y almacén no tiene máquinas; eso se
 * resuelve recién cuando el material sale hacia producción, en Registrar
 * Entrega. */
function IngresoLibreForm({
  numeroOt,
  fecha,
  materiales,
  materialOptions,
  onRegistrado
}: {
  numeroOt: string
  fecha: string
  materiales: Material[]
  materialOptions: { value: string; label: string }[]
  onRegistrado: (devolucion: Devolucion) => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [abierto, setAbierto] = useState(false)
  const [materialId, setMaterialId] = useState('')
  const [datos, setDatos] = useState<BobinasPedido>({ cantidadBobinas: '', bobinas: [] })
  const [error, setError] = useState<string | null>(null)

  const material = materiales.find((m) => String(m.id) === materialId)

  const registrar = useMutation({
    mutationFn: async () => {
      const cantidadTotal = datos.bobinas.reduce((acc, b) => acc + (Number(b) || 0), 0)
      const pendiente = await api.crearPendienteLibre(apiBaseUrl, token, numeroOt, {
        material_id: Number(materialId),
        cantidad_requerida: cantidadTotal
      })
      return api.registrarDevolucion(apiBaseUrl, token, {
        pendiente_id: pendiente.id,
        material_id: Number(materialId),
        fecha,
        bobinas: datos.bobinas.map(Number),
        es_ingreso_produccion: true
      })
    },
    onSuccess: (devolucion) => {
      setAbierto(false)
      setMaterialId('')
      setDatos({ cantidadBobinas: '', bobinas: [] })
      setError(null)
      onRegistrado(devolucion)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo registrar')
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!materialId) {
      setError('Elegí qué material está entrando a almacén')
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
        Registrar ingreso de un material que la OT no tiene
      </Button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 rounded-md border border-warning/40 bg-warning/5 p-4">
      <p className="mb-2 text-xs text-muted-foreground">
        Para un material fabricado que todavía no está cargado en esta OT — entra a almacén, no es un sobrante.
      </p>
      <div className="flex flex-col gap-2">
        <Combobox
          value={materialId}
          onChange={setMaterialId}
          options={materialOptions}
          placeholder="Buscar código MP..."
          emptyText="Sin materiales activos que coincidan"
        />
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

function PedidoDevolucionCard({
  pedido,
  seleccion,
  onChange,
  onQuitar
}: {
  pedido: Consumo
  seleccion: SeleccionDevolucion
  onChange: (seleccion: SeleccionDevolucion) => void
  onQuitar: () => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const entradas = seleccion.entradas
  // En un ingreso a almacén no hay "materiales entregados" que consultar ni
  // saldo contra el cual comparar: el material entra por primera vez y siempre
  // es el del propio pedido.
  const esIngreso = seleccion.modo === 'ingreso'

  const balance = useQuery({
    queryKey: ['materiales-entregados', pedido.ot_material_id],
    queryFn: () => api.listarMaterialesEntregados(apiBaseUrl, token, pedido.ot_material_id),
    enabled: !esIngreso
  })

  const materiales = esIngreso ? [] : (balance.data ?? [])

  // Lo que hay para devolver es lo que REALMENTE salió de almacén, no lo que
  // pedía la OT — si hubo una sustitución total (un solo material entregado,
  // distinto del pedido), el título de la tarjeta tiene que decir ESE
  // material: mostrar "BOPLH20620" arriba mientras todo lo de abajo (saldo,
  // cantidad) es de "BOPLH20760" confundía y no tenía sentido.
  const materialPrincipal = materiales.length === 1 ? materiales[0].codigo_mp : pedido.codigo_mp

  // Cuando solo se entregó un material, no tiene sentido preguntar cuál se
  // devuelve — se corrige solo, en cada entrada, aunque el pedido tenga su
  // propio material distinto (sustitución total). Con más de un material
  // entregado, el Select de abajo deja elegir explícitamente.
  useEffect(() => {
    if (materiales.length !== 1) return
    const unico = String(materiales[0].material_id)
    if (entradas.some((e) => e.materialId !== unico)) {
      onChange({ ...seleccion, entradas: entradas.map((e) => ({ ...e, materialId: unico })) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materiales])

  function cambiarEntradas(nuevas: EntradaDevolucion[]) {
    onChange({ ...seleccion, entradas: nuevas })
  }
  function actualizar(indice: number, cambios: Partial<EntradaDevolucion>) {
    cambiarEntradas(entradas.map((e, i) => (i === indice ? { ...e, ...cambios } : e)))
  }
  function agregar() {
    cambiarEntradas([...entradas, entradaVacia()])
  }
  function quitar(indice: number) {
    cambiarEntradas(entradas.filter((_, i) => i !== indice))
  }
  function cambiarModo(modo: ModoDevolucion) {
    // Al cambiar de modo el material vuelve al del pedido: en un ingreso
    // siempre es ése, y en un sobrante el efecto de arriba lo corrige si hay
    // uno solo entregado.
    onChange({ modo, entradas: entradas.map((e) => ({ ...e, materialId: String(pedido.material_id) })) })
  }

  return (
    <div className={cn('rounded-md border p-4', esIngreso ? 'border-warning/40 bg-warning/5' : 'border-border')}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium">
          {materialPrincipal}
          {materialPrincipal !== pedido.codigo_mp && (
            <span className="ml-1.5 text-xs font-normal text-warning">(pedido: {pedido.codigo_mp})</span>
          )}
        </p>
        <button type="button" onClick={onQuitar} className="text-muted-foreground hover:text-destructive">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Un pedido con materia prima puede recibir las dos cosas: el material
          recién fabricado entrando, y más adelante sobrantes volviendo de
          planta. Por eso se pregunta en vez de asumir. */}
      {pedido.tiene_materia_prima && (
        <div className="mb-3 flex flex-col gap-1.5">
          <Label className="text-xs">¿Qué estás registrando?</Label>
          <Select value={seleccion.modo} onValueChange={(v) => cambiarModo(v as ModoDevolucion)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ingreso">Ingreso a almacén — material fabricado en esta OT</SelectItem>
              <SelectItem value="sobrante">Devolución de sobrante</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {esIngreso && (
        <p className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-muted-foreground">
          <span className="font-medium text-warning">Registro de ingreso a almacén.</span> Entra{' '}
          {pedido.codigo_mp} fabricado en esta OT, no un sobrante — no descuenta del consumo.
          {pedido.cantidad_requerida != null
            ? ` Van ${pedido.total_ingresado} de ${pedido.cantidad_requerida} ${pedido.unidad}.`
            : ` Ingresado hasta ahora: ${pedido.total_ingresado} ${pedido.unidad}.`}{' '}
          Una vez en almacén se entrega desde Registrar Entrega.
        </p>
      )}

      {/* Dato del pedido, no de una devolución puntual — se muestra una sola
          vez para toda la tarjeta. No confundir con "disponible para
          devolver" de cada entrada, que nunca es negativo. */}
      {!esIngreso &&
        pedido.cantidad_requerida != null &&
        pedido.cantidad_requerida - pedido.total_entregado > 0 && (
          <p className="mb-3 text-xs text-muted-foreground">
            Aún falta entregar del pedido: {(pedido.cantidad_requerida - pedido.total_entregado).toFixed(2)}{' '}
            {pedido.unidad}
          </p>
        )}

      {entradas.map((entrada, indice) => {
        const seleccionado = materiales.find((m) => String(m.material_id) === entrada.materialId)
        const disponible = seleccionado
          ? seleccionado.disponible
          : materiales.length <= 1
            ? pedido.total_entregado - pedido.total_devuelto
            : 0
        const unidad = seleccionado?.unidad ?? pedido.unidad
        const usaBobinas = seleccionado?.usa_bobinas ?? pedido.usa_bobinas
        const excedeDisponible = entrada.bobinas.reduce((acc, b) => acc + (Number(b) || 0), 0) > disponible

        return (
          <div key={indice} className={indice > 0 ? 'mt-3 border-t border-border pt-3' : ''}>
            {materiales.length > 1 && (
              <div className="mb-2 flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label className="text-xs">¿Qué material se está devolviendo?</Label>
                  <Select value={entrada.materialId} onValueChange={(v) => actualizar(indice, { materialId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona" />
                    </SelectTrigger>
                    <SelectContent>
                      {materiales.map((m) => (
                        <SelectItem key={m.material_id} value={String(m.material_id)}>
                          {m.codigo_mp} — disponible: {m.disponible.toFixed(2)} {m.unidad}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {indice > 0 && (
                  <button
                    type="button"
                    onClick={() => quitar(indice)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {!esIngreso && (
              <p className="mb-1 text-xs text-muted-foreground">
                Disponible para devolver según el sistema: {disponible.toFixed(2)} {unidad}
              </p>
            )}
            <CampoCantidad unidad={unidad} usaBobinas={usaBobinas} datos={entrada} onChange={(d) => actualizar(indice, d)} />
            {/* Aviso, no bloqueo: el registro de entregas puede estar
                incompleto o el conteo físico real puede diferir del sistema —
                se deja guardar igual, el operador sabe qué volvió a bodega. */}
            {!esIngreso && excedeDisponible && (
              <p className="mt-2 text-xs text-warning">
                Estás registrando más de lo que el sistema tiene como entregado ({disponible.toFixed(2)} {unidad}).
                Se puede guardar igual si es lo que realmente volvió a bodega.
              </p>
            )}
          </div>
        )
      })}

      {/* Devolver varios materiales de un mismo pedido solo tiene sentido si
          se le entregó más de uno (una sustitución parcial) — si no, alcanza
          con el selector de arriba. */}
      {!esIngreso && materiales.length > 1 && (
        <button type="button" onClick={agregar} className="mt-3 text-xs text-primary hover:underline">
          + Agregar otro material devuelto
        </button>
      )}
    </div>
  )
}

export function RegistrarDevolucion() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [numeroOt, setNumeroOt] = useState('')
  const [otBuscada, setOtBuscada] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<Record<number, SeleccionDevolucion>>({})
  // Los materiales que entrega producción se eligen de la misma lista que los
  // pedidos, pero son otra cosa (no tienen pedido todavía), así que llevan su
  // propia selección, indexada por id de pendiente.
  const [ingresos, setIngresos] = useState<Record<number, EntradaIngreso[]>>({})
  const [fecha, setFecha] = useState(hoyISO())
  const [error, setError] = useState<string | null>(null)
  const [confirmaciones, setConfirmaciones] = useState<Devolucion[]>([])

  const pedidos = useQuery({
    queryKey: ['consumo', otBuscada],
    queryFn: () => api.consultarConsumo(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  // Los cargos de tinta (Laminación, FLaminación, Superficie) no se devuelven
  // en planta — se registran en Crear OT, pero no aparecen aquí.
  const pedidosVisibles = useMemo(() => pedidos.data?.filter((p) => !p.es_tinta), [pedidos.data])

  // Solo para mostrar QUÉ material se entregó realmente cuando hubo una
  // sustitución (Consumo.material_sustituido no dice cuál) — el pedido pide
  // BOPLH20620 pero lo que hay para devolver es lo que de verdad salió de
  // almacén, ej. BOPLH20760. Mismo patrón que RegistrarEntrega.tsx.
  const entregas = useQuery({
    queryKey: ['entregas', otBuscada],
    queryFn: () => api.listarEntregas(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  function materialesSustituidosDe(entregasDeLaOt: Entrega[] | undefined, pedido: Consumo): string[] {
    return [
      ...new Set(
        (entregasDeLaOt ?? [])
          .filter((e) => e.ot_material_id === pedido.ot_material_id)
          .map((e) => e.codigo_mp_entregado)
          .filter((codigo) => codigo !== pedido.codigo_mp)
      )
    ]
  }

  // Un material al que hubo que fabricarle materia prima puede seguir sin
  // proceso asignado, así que no tiene pedido y no sale en /consumo. Igual
  // producción lo entrega y hay que poder registrar su ingreso — ver
  // PendienteIngresoCard.
  const pendientes = useQuery({
    queryKey: ['pendientes', otBuscada],
    queryFn: () => api.listarPendientes(apiBaseUrl, token, otBuscada!),
    enabled: !!otBuscada
  })

  const pendientesConMateriaPrima = useMemo(
    () => (pendientes.data ?? []).filter((p) => !p.es_tinta && p.materias_primas.length > 0),
    [pendientes.data]
  )

  const materiales = useQuery({ queryKey: ['materiales'], queryFn: () => api.listarMateriales(apiBaseUrl, token) })

  // Materiales entregados y todavía no devueltos del todo, de cualquier OT —
  // para no obligar a saberse el número de OT de memoria, igual que "OT
  // recientes con entregas pendientes" en Registrar Entrega, pero acá a nivel
  // material en vez de a nivel OT (es lo que hay que devolver, no la OT en
  // general). Solo se muestra antes de buscar una OT puntual. No incluye los
  // ingresos a almacén pendientes (material que se está fabricando en otra
  // OT): eso vive en /pendientes por OT, no hay un listado cruzado de eso.
  const consumoTodo = useQuery({
    queryKey: ['consumo-todo'],
    queryFn: () => api.consultarConsumo(apiBaseUrl, token),
    enabled: !otBuscada
  })

  // Igual que "entregas" de arriba, pero de todas las OT — para poder mostrar
  // qué material se entregó realmente en la lista cruzada de abajo.
  const entregasTodas = useQuery({
    queryKey: ['entregas-todas'],
    queryFn: () => api.listarEntregas(apiBaseUrl, token),
    enabled: !otBuscada
  })

  const materialesPendientesDevolver = useMemo(() => {
    return (consumoTodo.data ?? [])
      .filter((p) => !p.es_tinta && p.total_entregado - p.total_devuelto > 0.005)
      .sort((a, b) => b.total_entregado - b.total_devuelto - (a.total_entregado - a.total_devuelto))
      .slice(0, 15)
  }, [consumoTodo.data])

  const materialOptions = useMemo(
    () =>
      (materiales.data ?? []).map((m) => ({
        value: String(m.id),
        label: m.codigo_mp + (m.descripcion ? ` — ${m.descripcion}` : '')
      })),
    [materiales.data]
  )

  const mutation = useMutation({
    mutationFn: async () => {
      const exitos: Devolucion[] = []
      const mensajesFallidos: string[] = []
      const fallidosPorPedido = new Map<number, SeleccionDevolucion>()
      for (const [otMaterialIdStr, sel] of Object.entries(seleccion)) {
        const otMaterialId = Number(otMaterialIdStr)
        const pedido = pedidos.data?.find((p) => p.ot_material_id === otMaterialId)
        for (const entrada of sel.entradas) {
          try {
            const devolucion = await api.registrarDevolucion(apiBaseUrl, token, {
              ot_material_id: otMaterialId,
              material_id: Number(entrada.materialId),
              fecha,
              bobinas: entrada.bobinas.map(Number),
              es_ingreso_produccion: sel.modo === 'ingreso'
            })
            exitos.push(devolucion)
          } catch (err) {
            mensajesFallidos.push(
              `${pedido?.codigo_mp ?? `#${otMaterialId}`} (${err instanceof ApiError ? err.message : 'error de conexión'})`
            )
            const previo = fallidosPorPedido.get(otMaterialId)
            fallidosPorPedido.set(otMaterialId, {
              modo: sel.modo,
              entradas: [...(previo?.entradas ?? []), entrada]
            })
          }
        }
      }
      const ingresosFallidos = new Map<number, EntradaIngreso[]>()
      for (const [pendienteIdStr, entradasIngreso] of Object.entries(ingresos)) {
        const pendienteId = Number(pendienteIdStr)
        const pendiente = pendientes.data?.find((p) => p.id === pendienteId)
        for (const datos of entradasIngreso) {
          try {
            exitos.push(
              await api.registrarDevolucion(apiBaseUrl, token, {
                pendiente_id: pendienteId,
                material_id: Number(datos.materialId),
                fecha,
                bobinas: datos.bobinas.map(Number),
                es_ingreso_produccion: true
              })
            )
          } catch (err) {
            mensajesFallidos.push(
              `${pendiente?.codigo_mp ?? `#${pendienteId}`} (${err instanceof ApiError ? err.message : 'error de conexión'})`
            )
            const previo = ingresosFallidos.get(pendienteId)
            ingresosFallidos.set(pendienteId, [...(previo ?? []), datos])
          }
        }
      }

      return { exitos, mensajesFallidos, fallidosPorPedido, ingresosFallidos }
    },
    onSuccess: ({ exitos, mensajesFallidos, fallidosPorPedido, ingresosFallidos }) => {
      setConfirmaciones(exitos)
      setError(mensajesFallidos.length > 0 ? `No se pudieron registrar: ${mensajesFallidos.join(', ')}` : null)
      setSeleccion(() => {
        const restante: Record<number, SeleccionDevolucion> = {}
        for (const [otMaterialId, sel] of fallidosPorPedido) restante[otMaterialId] = sel
        return restante
      })
      setIngresos(() => {
        const restante: Record<number, EntradaIngreso[]> = {}
        for (const [pendienteId, entradasIngreso] of ingresosFallidos) restante[pendienteId] = entradasIngreso
        return restante
      })
      queryClient.invalidateQueries({ queryKey: ['consumo', otBuscada] })
      queryClient.invalidateQueries({ queryKey: ['pendientes', otBuscada] })
    },
    onError: () => setError('Error al registrar las devoluciones')
  })

  function buscar(e: FormEvent) {
    e.preventDefault()
    setConfirmaciones([])
    setSeleccion({})
    setIngresos({})
    setOtBuscada(numeroOt)
  }

  function seleccionarOtRecomendada(numero: string) {
    setNumeroOt(numero)
    setConfirmaciones([])
    setSeleccion({})
    setIngresos({})
    setOtBuscada(numero)
  }

  // Lo registrado desde IngresoLibreForm va al mismo cartel verde que el
  // resto — sin eso no quedaba ninguna señal de que se guardó.
  function alRegistrarIngresoLibre(devolucion: Devolucion) {
    setConfirmaciones([devolucion])
    setError(null)
    queryClient.invalidateQueries({ queryKey: ['pendientes', otBuscada] })
    queryClient.invalidateQueries({ queryKey: ['consumo', otBuscada] })
  }

  function toggleIngreso(pendiente: OtMaterialPendiente) {
    setConfirmaciones([])
    setIngresos((prev) => {
      const copia = { ...prev }
      if (copia[pendiente.id]) {
        delete copia[pendiente.id]
      } else {
        copia[pendiente.id] = [
          {
            cantidadBobinas: '',
            bobinas: [],
            materialId: pendiente.material_id != null ? String(pendiente.material_id) : ''
          }
        ]
      }
      return copia
    })
  }

  function toggleSeleccion(pedido: Consumo) {
    setConfirmaciones([])
    setSeleccion((prev) => {
      const copia = { ...prev }
      if (copia[pedido.ot_material_id]) {
        delete copia[pedido.ot_material_id]
      } else {
        copia[pedido.ot_material_id] = seleccionVacia(pedido)
      }
      return copia
    })
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const pedidosSeleccionados = Object.entries(seleccion)
    const ingresosSeleccionados = Object.entries(ingresos)
    if (pedidosSeleccionados.length === 0 && ingresosSeleccionados.length === 0) {
      setError('Selecciona al menos un material')
      return
    }
    for (const [, sel] of pedidosSeleccionados) {
      if (sel.entradas.some((e) => e.bobinas.length === 0 || e.bobinas.some((b) => !b || Number(b) <= 0))) {
        setError('Cada material seleccionado necesita una cantidad válida mayor a 0')
        return
      }
    }
    for (const [, entradasIngreso] of ingresosSeleccionados) {
      for (const datos of entradasIngreso) {
        if (!datos.materialId) {
          setError('Indica a qué material del catálogo corresponde lo que entrega producción')
          return
        }
        if (datos.bobinas.length === 0 || datos.bobinas.some((b) => !b || Number(b) <= 0)) {
          setError('Cada material seleccionado necesita una cantidad válida mayor a 0')
          return
        }
      }
    }
    setError(null)
    mutation.mutate()
  }

  const cantidadSeleccionada = Object.keys(seleccion).length + Object.keys(ingresos).length

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold">Registrar Devolución de Materia Prima</h1>

      {confirmaciones.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-6 flex flex-col gap-2 rounded-md border border-success/30 bg-success/10 p-4"
        >
          {confirmaciones.map((confirmacion) => (
            <div key={confirmacion.id} className="flex items-start gap-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <p>
                {confirmacion.total_devuelto} de {confirmacion.codigo_mp}{' '}
                {confirmacion.es_ingreso_produccion ? 'ingresados a almacén.' : 'devueltos.'}
              </p>
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

          {otBuscada && (
            <div className="mt-4">
              <IngresoLibreForm
                numeroOt={otBuscada}
                fecha={fecha}
                materiales={materiales.data ?? []}
                materialOptions={materialOptions}
                onRegistrado={alRegistrarIngresoLibre}
              />
            </div>
          )}

          {pedidos.isSuccess && pedidosVisibles?.length === 0 && pendientesConMateriaPrima.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">No hay materiales entregados para esa OT.</p>
          )}

          {pedidosVisibles && pedidosVisibles.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Materiales de esta OT — marca todos a los que corresponda. Por acá vuelven los sobrantes y también
                entra a almacén el material que se fabricó en la OT.
              </p>
              {/* Los materiales que entrega producción van en la misma lista
                  que los pedidos: se registran en tandas (hoy dos bobinas,
                  mañana una) y tener que buscarlos en otra sección hacía
                  parecer que ya estaban cerrados. */}
              {pendientesConMateriaPrima.map((pendiente) => {
                // Igual que en PendienteIngresoCard: si el pendiente ya se
                // resolvió a un material del catálogo, mostrar ESE código
                // como identidad principal — el código de Excel puede no
                // significar nada para quien lo lee.
                const materialResuelto =
                  pendiente.material_id != null
                    ? (materiales.data ?? []).find((m) => m.id === pendiente.material_id)
                    : undefined
                return (
                <button
                  key={`pendiente-${pendiente.id}`}
                  type="button"
                  onClick={() => toggleIngreso(pendiente)}
                  className={cn(
                    'flex flex-col rounded-md border p-3 text-left text-sm transition-colors',
                    ingresos[pendiente.id] ? 'border-warning bg-warning/10' : 'border-warning/40 hover:bg-warning/5'
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {materialResuelto ? materialResuelto.codigo_mp : pendiente.codigo_mp}
                    {materialResuelto && (
                      <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                        <FileSpreadsheet className="h-3 w-3" />
                        {pendiente.codigo_mp}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning">
                      <Beaker className="h-3 w-3" />
                      lo entrega producción
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    Ingresó a almacén: {pendiente.total_ingresado}
                    {pendiente.cantidad_requerida ? ` de ${pendiente.cantidad_requerida}` : ''} · Materia prima:{' '}
                    {pendiente.materias_primas.join(', ')} · Sin proceso asignado todavía
                  </span>
                </button>
                )
              })}
              {pedidosVisibles.map((pedido) => {
                const materialesSustituidos = materialesSustituidosDe(entregas.data, pedido)
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
                        se entregó {materialesSustituidos.join(', ')}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    Entregado: {pedido.total_entregado} {pedido.unidad}
                    {pedido.cantidad_requerida ? ` de ${pedido.cantidad_requerida} requeridos` : ''} · Ya devuelto:{' '}
                    {pedido.total_devuelto} {pedido.unidad}
                    {pedido.total_ingresado > 0
                      ? ` · Ingresó fabricado: ${pedido.total_ingresado} ${pedido.unidad}`
                      : ''}{' '}
                    · {pedido.estado_entrega}
                  </span>
                </button>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {!otBuscada && materialesPendientesDevolver.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Materiales pendientes de devolver</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {materialesPendientesDevolver.map((p) => {
              // Lo que hay para devolver es lo que REALMENTE salió de
              // almacén, no necesariamente lo que pedía la OT — si hubo una
              // sustitución mostramos el material entregado como principal
              // (ver PedidoDevolucionCard, que ya selecciona ese mismo
              // material para registrar la devolución).
              const materialesSustituidos = materialesSustituidosDe(entregasTodas.data, p)
              const materialPrincipal = materialesSustituidos.length === 1 ? materialesSustituidos[0] : p.codigo_mp
              return (
                <button
                  key={p.ot_material_id}
                  type="button"
                  onClick={() => seleccionarOtRecomendada(p.numero_ot)}
                  className="flex flex-col rounded-md border border-border p-3 text-left text-sm transition-colors hover:bg-muted"
                >
                  <span className="font-medium">
                    {materialPrincipal}
                    {materialesSustituidos.length === 1 && (
                      <span className="font-normal text-warning"> (pedido: {p.codigo_mp})</span>
                    )}
                    {materialesSustituidos.length > 1 && (
                      <span className="font-normal text-warning"> (se entregó: {materialesSustituidos.join(', ')})</span>
                    )}{' '}
                    <span className="font-normal text-muted-foreground">— OT {p.numero_ot}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {p.cliente ?? 'Sin cliente'}
                    {p.diseno ? ` · ${p.diseno}` : ''} · {p.proceso} · {p.maquina}
                  </span>
                  <span className="text-muted-foreground">
                    Disponible para devolver: {(p.total_entregado - p.total_devuelto).toFixed(2)} {p.unidad}
                  </span>
                </button>
              )
            })}
          </CardContent>
        </Card>
      )}

      {cantidadSeleccionada > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cantidades a registrar</CardTitle>
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
                  <PedidoDevolucionCard
                    key={pedido.ot_material_id}
                    pedido={pedido}
                    seleccion={seleccion[pedido.ot_material_id]}
                    onChange={(sel) => setSeleccion((prev) => ({ ...prev, [pedido.ot_material_id]: sel }))}
                    onQuitar={() => toggleSeleccion(pedido)}
                  />
                ))}

              {pendientesConMateriaPrima
                .filter((p) => ingresos[p.id])
                .map((pendiente) => (
                  <PendienteIngresoCard
                    key={pendiente.id}
                    pendiente={pendiente}
                    materiales={materiales.data ?? []}
                    materialOptions={materialOptions}
                    entradas={ingresos[pendiente.id]}
                    onChange={(entradas) => setIngresos((prev) => ({ ...prev, [pendiente.id]: entradas }))}
                    onQuitar={() => toggleIngreso(pendiente)}
                  />
                ))}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending
                  ? 'Guardando...'
                  : `Guardar ${cantidadSeleccionada > 1 ? `${cantidadSeleccionada} registros` : 'registro'}`}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
