import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowRightLeft, Beaker, CheckCircle2, Search, X } from 'lucide-react'
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
import type { Consumo, Devolucion, Material, OtMaterialPendiente } from '@renderer/lib/types'

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}

interface EntradaDevolucion extends BobinasPedido {
  // Material que realmente se está devolviendo — un pedido puede tener
  // entregas de más de uno (por una sustitución), así que hace falta elegir
  // de cuál se devuelve.
  materialId: string
}

function entradaVacia(): EntradaDevolucion {
  return { materialId: '', cantidadBobinas: '', bobinas: [] }
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
 * hace falta registrar es cuánto entró. */
function PendienteIngresoCard({
  pendiente,
  materiales,
  materialOptions,
  fecha,
  onRegistrado
}: {
  pendiente: OtMaterialPendiente
  materiales: Material[]
  materialOptions: { value: string; label: string }[]
  fecha: string
  onRegistrado: (devolucion: Devolucion) => void
}) {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token

  const [materialId, setMaterialId] = useState(
    pendiente.material_id != null ? String(pendiente.material_id) : ''
  )
  const material = materiales.find((m) => String(m.id) === materialId)
  const [cantidad, setCantidad] = useState<BobinasPedido>({ cantidadBobinas: '', bobinas: [] })
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      api.registrarDevolucion(apiBaseUrl, token, {
        pendiente_id: pendiente.id,
        material_id: Number(materialId),
        fecha,
        bobinas: cantidad.bobinas.map(Number),
        es_ingreso_produccion: true
      }),
    onSuccess: (devolucion) => {
      setError(null)
      setCantidad({ cantidadBobinas: '', bobinas: [] })
      onRegistrado(devolucion)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo registrar')
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!materialId) {
      setError('Indica a qué material del catálogo corresponde')
      return
    }
    if (cantidad.bobinas.length === 0 || cantidad.bobinas.some((b) => !b || Number(b) <= 0)) {
      setError('Completa la cantidad que entra a almacén')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-warning/40 bg-warning/5 p-4">
      <p className="mb-1 text-sm font-medium">{pendiente.codigo_mp}</p>
      <p className="mb-3 text-xs text-muted-foreground">
        <span className="font-medium text-warning">Producción lo está entregando.</span> Entra a almacén, no es un
        sobrante — no descuenta del consumo. Materia prima usada: {pendiente.materias_primas.join(', ')}.
        {pendiente.total_ingresado > 0 && ` Ya entraron ${pendiente.total_ingresado} ${material?.unidad ?? ''}.`}
      </p>

      {pendiente.material_id == null && (
        <div className="mb-3 flex flex-col gap-1.5">
          <Label className="text-xs">¿A qué material del catálogo corresponde?</Label>
          <Combobox
            value={materialId}
            onChange={setMaterialId}
            options={materialOptions}
            placeholder="Buscar código MP..."
            emptyText="Sin materiales activos que coincidan"
          />
        </div>
      )}

      <CampoCantidad
        unidad={material?.unidad ?? ''}
        usaBobinas={material?.usa_bobinas ?? true}
        datos={cantidad}
        onChange={setCantidad}
      />

      <p className="mt-1.5 text-xs text-muted-foreground">
        Después, cuando salga hacia producción, en Registrar Entrega elegís el proceso y la máquina.
      </p>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <Button type="submit" className="mt-3" disabled={mutation.isPending}>
        {mutation.isPending ? 'Guardando...' : 'Registrar ingreso a almacén'}
      </Button>
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
        <p className="text-sm font-medium">{pedido.codigo_mp}</p>
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

  const materialOptions = useMemo(
    () =>
      (materiales.data ?? []).map((m) => ({
        value: String(m.id),
        label: m.codigo_mp + (m.descripcion ? ` — ${m.descripcion}` : '')
      })),
    [materiales.data]
  )

  function alRegistrarIngreso(devolucion: Devolucion) {
    setConfirmaciones([devolucion])
    queryClient.invalidateQueries({ queryKey: ['pendientes', otBuscada] })
    queryClient.invalidateQueries({ queryKey: ['consumo', otBuscada] })
  }

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
      return { exitos, mensajesFallidos, fallidosPorPedido }
    },
    onSuccess: ({ exitos, mensajesFallidos, fallidosPorPedido }) => {
      setConfirmaciones(exitos)
      setError(mensajesFallidos.length > 0 ? `No se pudieron registrar: ${mensajesFallidos.join(', ')}` : null)
      setSeleccion(() => {
        const restante: Record<number, SeleccionDevolucion> = {}
        for (const [otMaterialId, sel] of fallidosPorPedido) restante[otMaterialId] = sel
        return restante
      })
      queryClient.invalidateQueries({ queryKey: ['consumo', otBuscada] })
    },
    onError: () => setError('Error al registrar las devoluciones')
  })

  function buscar(e: FormEvent) {
    e.preventDefault()
    setConfirmaciones([])
    setSeleccion({})
    setOtBuscada(numeroOt)
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
    if (pedidosSeleccionados.length === 0) {
      setError('Selecciona al menos un material')
      return
    }
    for (const [, sel] of pedidosSeleccionados) {
      if (sel.entradas.some((e) => e.bobinas.length === 0 || e.bobinas.some((b) => !b || Number(b) <= 0))) {
        setError('Cada material seleccionado necesita una cantidad válida mayor a 0')
        return
      }
    }
    setError(null)
    mutation.mutate()
  }

  const hayPedidosSeleccionados = Object.keys(seleccion).length > 0

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

          {pedidos.isSuccess && pedidosVisibles?.length === 0 && pendientesConMateriaPrima.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">No hay materiales entregados para esa OT.</p>
          )}

          {pedidosVisibles && pedidosVisibles.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Materiales de esta OT — marca todos a los que corresponda. Por acá vuelven los sobrantes y también
                entra a almacén el material que se fabricó en la OT.
              </p>
              {pedidosVisibles.map((pedido) => (
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
                    {pedido.material_sustituido && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                        <ArrowRightLeft className="h-3 w-3" />
                        hubo sustitución
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
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {pendientesConMateriaPrima.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Material que entrega producción</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              A estos materiales se les cargó materia prima y producción todavía no los entregó. Registrá solo
              cuánto entra a almacén — el proceso y la máquina se eligen después, al sacarlo hacia producción.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label>Fecha</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="max-w-40" />
            </div>
            {pendientesConMateriaPrima.map((pendiente) => (
              <PendienteIngresoCard
                key={pendiente.id}
                pendiente={pendiente}
                materiales={materiales.data ?? []}
                materialOptions={materialOptions}
                fecha={fecha}
                onRegistrado={alRegistrarIngreso}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {hayPedidosSeleccionados && (
        <Card>
          <CardHeader>
            <CardTitle>Cantidades devueltas</CardTitle>
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

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending
                  ? 'Guardando...'
                  : `Guardar ${Object.keys(seleccion).length > 1 ? `${Object.keys(seleccion).length} devoluciones` : 'devolución'}`}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
