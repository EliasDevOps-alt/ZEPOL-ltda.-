import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, History, Plus, Trash2, Upload } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Combobox } from '@renderer/components/ui/combobox'
import { Switch } from '@renderer/components/ui/switch'
import { useAuth } from '@renderer/lib/AuthContext'
import { useConfig } from '@renderer/lib/ConfigContext'
import { cn } from '@renderer/lib/utils'
import * as api from '@renderer/lib/api'
import { ApiError } from '@renderer/lib/api'
import type {
  CamposComercialesOt,
  OtDetalleOut,
  OtExcel,
  OtMaterialPendiente,
  ProcesoDetalleOut
} from '@renderer/lib/types'

interface FilaMaterial {
  materialId: string
  cantidad: string
}

function filaMaterialVacia(): FilaMaterial {
  return { materialId: '', cantidad: '' }
}

interface ComercialesForm {
  fecha_seguimiento_mp: string
  alm: string
  so: string
  tipo_trabajo: string
  indicador: string
  status_entrega_mp: string
  vendedor: string
  ciudad: string
  fecha_pedido: string
  fecha_entrega: string
  descripcion_producto: string
  codigo_producto: string
  total_ot: string
  entrega_mes: string
  medida: string
  equivalencia_kg: string
  pu_usd: string
  pt_usd: string
  factura_clises: string
  precio_clise_usd: string
  precio_total_pedido_usd: string
}

const COMERCIALES_VACIO: ComercialesForm = {
  fecha_seguimiento_mp: '',
  alm: '',
  so: '',
  tipo_trabajo: '',
  indicador: '',
  status_entrega_mp: '',
  vendedor: '',
  ciudad: '',
  fecha_pedido: '',
  fecha_entrega: '',
  descripcion_producto: '',
  codigo_producto: '',
  total_ot: '',
  entrega_mes: '',
  medida: '',
  equivalencia_kg: '',
  pu_usd: '',
  pt_usd: '',
  factura_clises: '',
  precio_clise_usd: '',
  precio_total_pedido_usd: ''
}

function comercialesDesdeApi(d: CamposComercialesOt): ComercialesForm {
  return {
    fecha_seguimiento_mp: d.fecha_seguimiento_mp ?? '',
    alm: d.alm ?? '',
    so: d.so ?? '',
    tipo_trabajo: d.tipo_trabajo ?? '',
    indicador: d.indicador ?? '',
    status_entrega_mp: d.status_entrega_mp ?? '',
    vendedor: d.vendedor ?? '',
    ciudad: d.ciudad ?? '',
    fecha_pedido: d.fecha_pedido ?? '',
    fecha_entrega: d.fecha_entrega ?? '',
    descripcion_producto: d.descripcion_producto ?? '',
    codigo_producto: d.codigo_producto ?? '',
    total_ot: d.total_ot != null ? String(d.total_ot) : '',
    entrega_mes: d.entrega_mes != null ? String(d.entrega_mes) : '',
    medida: d.medida ?? '',
    equivalencia_kg: d.equivalencia_kg != null ? String(d.equivalencia_kg) : '',
    pu_usd: d.pu_usd != null ? String(d.pu_usd) : '',
    pt_usd: d.pt_usd != null ? String(d.pt_usd) : '',
    factura_clises: d.factura_clises ?? '',
    precio_clise_usd: d.precio_clise_usd != null ? String(d.precio_clise_usd) : '',
    precio_total_pedido_usd: d.precio_total_pedido_usd != null ? String(d.precio_total_pedido_usd) : ''
  }
}

function comercialesParaApi(c: ComercialesForm): CamposComercialesOt {
  return {
    fecha_seguimiento_mp: c.fecha_seguimiento_mp || null,
    alm: c.alm || null,
    so: c.so || null,
    tipo_trabajo: c.tipo_trabajo || null,
    indicador: c.indicador || null,
    status_entrega_mp: c.status_entrega_mp || null,
    vendedor: c.vendedor || null,
    ciudad: c.ciudad || null,
    fecha_pedido: c.fecha_pedido || null,
    fecha_entrega: c.fecha_entrega || null,
    descripcion_producto: c.descripcion_producto || null,
    codigo_producto: c.codigo_producto || null,
    total_ot: c.total_ot ? Number(c.total_ot) : null,
    entrega_mes: c.entrega_mes ? Number(c.entrega_mes) : null,
    medida: c.medida || null,
    equivalencia_kg: c.equivalencia_kg ? Number(c.equivalencia_kg) : null,
    pu_usd: c.pu_usd ? Number(c.pu_usd) : null,
    pt_usd: c.pt_usd ? Number(c.pt_usd) : null,
    factura_clises: c.factura_clises || null,
    precio_clise_usd: c.precio_clise_usd ? Number(c.precio_clise_usd) : null,
    precio_total_pedido_usd: c.precio_total_pedido_usd ? Number(c.precio_total_pedido_usd) : null
  }
}

function sumarPrecioTotal(ptUsd: string, precioClise: string): string {
  if (!ptUsd && !precioClise) return ''
  const total = (Number(ptUsd) || 0) + (Number(precioClise) || 0)
  return total.toFixed(2)
}

export function DetalleOt() {
  const { apiBaseUrl } = useConfig()
  const { sesion } = useAuth()
  const token = sesion!.token
  const queryClient = useQueryClient()

  const [numeroOt, setNumeroOt] = useState('')
  const [cliente, setCliente] = useState('')
  const [diseno, setDiseno] = useState('')
  const [materialesForm, setMaterialesForm] = useState<FilaMaterial[]>([filaMaterialVacia()])
  const [comerciales, setComerciales] = useState<ComercialesForm>(COMERCIALES_VACIO)
  const [mostrarComerciales, setMostrarComerciales] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<OtDetalleOut | null>(null)
  const [origenCargado, setOrigenCargado] = useState<'bd' | 'excel' | null>(null)
  const [datosExcel, setDatosExcel] = useState<OtExcel | null>(null)
  const [procesosExistentes, setProcesosExistentes] = useState<ProcesoDetalleOut[]>([])
  const [pendientesExistentes, setPendientesExistentes] = useState<OtMaterialPendiente[]>([])
  const [syncExcel, setSyncExcel] = useState<{ ok: boolean; error: string | null } | null>(null)

  const materiales = useQuery({ queryKey: ['materiales'], queryFn: () => api.listarMateriales(apiBaseUrl, token) })

  const materialOptions = useMemo(
    () =>
      (materiales.data ?? []).map((m) => ({
        value: String(m.id),
        label: m.codigo_mp + (m.descripcion ? ` — ${m.descripcion}` : '')
      })),
    [materiales.data]
  )

  function cargarDesdeDetalle(detalle: OtDetalleOut) {
    setOrigenCargado('bd')
    setDatosExcel(null)
    setCliente(detalle.cliente ?? '')
    setDiseno(detalle.diseno ?? '')
    setComerciales(comercialesDesdeApi(detalle))
    setProcesosExistentes(detalle.procesos)
    setPendientesExistentes(detalle.pendientes)
    setMaterialesForm([filaMaterialVacia()])
    setSyncExcel({ ok: detalle.sincronizado_excel, error: detalle.excel_sync_error })
  }

  const cargar = useMutation({
    mutationFn: () => api.buscarOtConFallback(apiBaseUrl, token, numeroOt),
    onSuccess: (resultado) => {
      setError(null)
      setConfirmacion(null)

      if (resultado.origen === 'bd' && resultado.bd) {
        cargarDesdeDetalle(resultado.bd)
      } else if (resultado.origen === 'excel' && resultado.excel) {
        setOrigenCargado('excel')
        setDatosExcel(resultado.excel)
      } else {
        setOrigenCargado(null)
        setDatosExcel(null)
        setError('No se encontró esa OT ni en la base de datos ni en el Excel')
      }
    },
    onError: (err) => {
      setOrigenCargado(null)
      setDatosExcel(null)
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la OT')
    }
  })

  const importar = useMutation({
    mutationFn: () => api.importarOtDesdeExcel(apiBaseUrl, token, numeroOt),
    onSuccess: (resultado) => {
      setError(null)
      setConfirmacion(null)
      cargarDesdeDetalle(resultado.ot)
      queryClient.invalidateQueries({ queryKey: ['ordenes-trabajo'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo importar la OT desde Excel')
  })

  const guardar = useMutation({
    mutationFn: () =>
      api.guardarDetalleOt(apiBaseUrl, token, {
        numero_ot: numeroOt,
        cliente: cliente || null,
        diseno: diseno || null,
        ...comercialesParaApi(comerciales),
        materiales: materialesForm
          .filter((m) => m.materialId)
          .map((m) => ({
            material_id: Number(m.materialId),
            cantidad_requerida: m.cantidad ? Number(m.cantidad) : null
          }))
      }),
    onSuccess: (detalle) => {
      setConfirmacion(detalle)
      setError(null)
      setProcesosExistentes(detalle.procesos)
      setPendientesExistentes(detalle.pendientes)
      setMaterialesForm([filaMaterialVacia()])
      setSyncExcel({ ok: detalle.sincronizado_excel, error: detalle.excel_sync_error })
      queryClient.invalidateQueries({ queryKey: ['ordenes-trabajo'] })
      queryClient.invalidateQueries({ queryKey: ['consumo', numeroOt] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al guardar la OT')
  })

  const reintentarExcel = useMutation({
    mutationFn: () => api.reintentarSincronizacionExcel(apiBaseUrl, token, numeroOt),
    onSuccess: (detalle) => setSyncExcel({ ok: detalle.sincronizado_excel, error: detalle.excel_sync_error })
  })

  function actualizarFilaMaterial(i: number, cambios: Partial<FilaMaterial>) {
    setMaterialesForm(materialesForm.map((f, idx) => (idx === i ? { ...f, ...cambios } : f)))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!numeroOt) {
      setError('Ingresa el número de OT')
      return
    }
    setError(null)
    guardar.mutate()
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Crear OT</h1>
        <Link
          to={numeroOt ? `/entrega/historial?ot=${encodeURIComponent(numeroOt)}` : '/entrega/historial'}
          className="flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <History className="h-4 w-4" />
          Ver historial
        </Link>
      </div>

      <p className="mb-6 text-sm text-muted-foreground">
        Define el cliente, el diseño y los materiales que necesita esta OT, con su cantidad. El proceso y la
        máquina de cada material se asignan después, en "Registrar Entrega", en el momento de entregarlo.
      </p>

      {materiales.isError && (
        <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          No se pudieron cargar los catálogos. Revisa la conexión con el servidor.
        </div>
      )}

      {confirmacion && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-6 flex items-center gap-3 rounded-md border border-success/30 bg-success/10 p-4"
        >
          <CheckCircle2 className="h-5 w-5 text-success" />
          <p className="text-sm">
            OT {confirmacion.numero_ot} guardada — {confirmacion.procesos.length}{' '}
            {confirmacion.procesos.length === 1 ? 'proceso' : 'procesos'}.
          </p>
        </motion.div>
      )}

      {syncExcel && !syncExcel.ok && (
        <div className="mb-6 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="font-medium text-warning">No se pudo escribir esta OT en el Excel OC-MP</p>
            <p className="text-muted-foreground">{syncExcel.error ?? 'Motivo desconocido.'}</p>
            <p className="text-muted-foreground">
              Los datos ya están guardados en el sistema — reintenta cuando el archivo esté disponible.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={reintentarExcel.isPending || !numeroOt}
              onClick={() => reintentarExcel.mutate()}
            >
              {reintentarExcel.isPending ? 'Reintentando...' : 'Reintentar sincronización'}
            </Button>
          </div>
        </div>
      )}

      {datosExcel && (
        <div className="mb-6 rounded-md border border-warning/30 bg-warning/10 p-4 text-sm">
          <p className="mb-3 flex items-center gap-1.5 font-medium text-warning">
            <FileSpreadsheet className="h-4 w-4" />
            Esta OT viene del Excel — todavía no está en la base de datos
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-3">
            <p>Fecha de seguimiento MP: <span className="text-foreground">{datosExcel.fecha_seguimiento_mp ?? '—'}</span></p>
            <p>Almacén: <span className="text-foreground">{datosExcel.alm ?? '—'}</span></p>
            <p>SO: <span className="text-foreground">{datosExcel.so ?? '—'}</span></p>
            <p>Tipo de trabajo: <span className="text-foreground">{datosExcel.tipo_trabajo ?? '—'}</span></p>
            <p>Indicador: <span className="text-foreground">{datosExcel.indicador ?? '—'}</span></p>
            <p>Status de entrega MP: <span className="text-foreground">{datosExcel.status_entrega_mp ?? '—'}</span></p>
            <p>Cliente: <span className="text-foreground">{datosExcel.cliente ?? '—'}</span></p>
            <p>Vendedor: <span className="text-foreground">{datosExcel.vendedor ?? '—'}</span></p>
            <p>Ciudad: <span className="text-foreground">{datosExcel.ciudad ?? '—'}</span></p>
            <p>Fecha de pedido: <span className="text-foreground">{datosExcel.fecha_pedido ?? '—'}</span></p>
            <p>Fecha de entrega: <span className="text-foreground">{datosExcel.fecha_entrega ?? '—'}</span></p>
            <p>Descripción: <span className="text-foreground">{datosExcel.descripcion_producto ?? '—'}</span></p>
            <p>Código producto: <span className="text-foreground">{datosExcel.codigo_producto ?? '—'}</span></p>
            <p>
              Total OT: <span className="text-foreground">{datosExcel.total_ot ?? '—'}</span>
              {datosExcel.medida ? ` ${datosExcel.medida}` : ''}
            </p>
            <p>Entrega mes: <span className="text-foreground">{datosExcel.entrega_mes ?? '—'}</span></p>
            <p>Equivalencia en Kg: <span className="text-foreground">{datosExcel.equivalencia_kg ?? '—'}</span></p>
            <p>PU US$: <span className="text-foreground">{datosExcel.pu_usd ?? '—'}</span></p>
            <p>PT US$: <span className="text-foreground">{datosExcel.pt_usd ?? '—'}</span></p>
            <p>Factura clisés: <span className="text-foreground">{datosExcel.factura_clises ?? '—'}</span></p>
            <p>Precio clisé US$: <span className="text-foreground">{datosExcel.precio_clise_usd ?? '—'}</span></p>
            <p>Precio total pedido US$: <span className="text-foreground">{datosExcel.precio_total_pedido_usd ?? '—'}</span></p>
          </div>
          {datosExcel.materiales.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Materiales pedidos (sin proceso/máquina asignados en Excel)</p>
              <ul className="flex flex-col gap-0.5">
                {datosExcel.materiales.map((m, i) => (
                  <li key={i} className="text-muted-foreground">
                    {m.codigo_mp}
                    {m.cantidad_requerida != null ? ` — ${m.cantidad_requerida}` : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-1 font-medium text-foreground">
                Total cantidad: {datosExcel.total != null ? datosExcel.total.toFixed(2) : '—'}
              </p>
            </div>
          )}
          <Button type="button" className="mt-4" disabled={importar.isPending} onClick={() => importar.mutate()}>
            {importar.isPending ? 'Guardando...' : 'Guardar en base de datos'}
          </Button>
        </div>
      )}

      {pendientesExistentes.length > 0 && (
        <div className="mb-6 rounded-md border border-warning/30 bg-warning/10 p-4 text-sm">
          <p className="mb-2 font-medium text-warning">
            {pendientesExistentes.length} {pendientesExistentes.length === 1 ? 'material pendiente' : 'materiales pendientes'} de proceso y máquina
          </p>
          <ul className="mb-2 flex flex-col gap-0.5 text-muted-foreground">
            {pendientesExistentes.map((p) => (
              <li key={p.id}>
                {p.codigo_mp}
                {p.cantidad_requerida != null ? ` — ${p.cantidad_requerida}` : ''}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Se completan en{' '}
            <Link to="/entrega" className="text-primary hover:underline">
              Registrar Entrega
            </Link>
            .
          </p>
        </div>
      )}

      {procesosExistentes.length > 0 && (
        <div className="mb-6 rounded-md border border-border bg-muted p-4 text-sm">
          <p className="mb-2 font-medium">Materiales ya asignados a un proceso</p>
          <ul className="flex flex-col gap-0.5 text-muted-foreground">
            {procesosExistentes.map((p) =>
              p.materiales.map((m) => (
                <li key={m.ot_material_id}>
                  {m.codigo_mp} — {p.proceso} / {p.maquina}
                  {m.cantidad_requerida != null ? ` — ${m.cantidad_requerida}` : ''}
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Datos de la OT
            {origenCargado === 'bd' && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Base de datos
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>OT</Label>
                <Input value={numeroOt} onChange={(e) => setNumeroOt(e.target.value)} placeholder="2121" />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!numeroOt || cargar.isPending}
                  onClick={() => cargar.mutate()}
                >
                  <Upload className="h-4 w-4" />
                  Cargar OT existente
                </Button>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Cliente</Label>
                <Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="La Estrella" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Diseño</Label>
                <Input value={diseno} onChange={(e) => setDiseno(e.target.value)} placeholder="pipocas" />
              </div>
            </div>

            <div className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setMostrarComerciales((v) => !v)}
                className="flex w-full items-center justify-between p-3 text-sm font-medium"
              >
                Datos comerciales / OC
                <ChevronDown className={cn('h-4 w-4 transition-transform', mostrarComerciales && 'rotate-180')} />
              </button>
              {mostrarComerciales && (
                <div className="grid grid-cols-1 gap-3 border-t border-border p-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Fecha de seguimiento MP</Label>
                    <Input
                      type="date"
                      value={comerciales.fecha_seguimiento_mp}
                      onChange={(e) => setComerciales({ ...comerciales, fecha_seguimiento_mp: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Almacén</Label>
                    <Input
                      value={comerciales.alm}
                      onChange={(e) => setComerciales({ ...comerciales, alm: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">SO</Label>
                    <Input
                      value={comerciales.so}
                      onChange={(e) => setComerciales({ ...comerciales, so: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Tipo de trabajo</Label>
                    <Input
                      value={comerciales.tipo_trabajo}
                      onChange={(e) => setComerciales({ ...comerciales, tipo_trabajo: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Indicador</Label>
                    <Input
                      value={comerciales.indicador}
                      onChange={(e) => setComerciales({ ...comerciales, indicador: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Status de entrega MP</Label>
                    <Input
                      value={comerciales.status_entrega_mp}
                      onChange={(e) => setComerciales({ ...comerciales, status_entrega_mp: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Vendedor</Label>
                    <Input
                      value={comerciales.vendedor}
                      onChange={(e) => setComerciales({ ...comerciales, vendedor: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Ciudad</Label>
                    <Input
                      value={comerciales.ciudad}
                      onChange={(e) => setComerciales({ ...comerciales, ciudad: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Fecha de pedido</Label>
                    <Input
                      type="date"
                      value={comerciales.fecha_pedido}
                      onChange={(e) => setComerciales({ ...comerciales, fecha_pedido: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Fecha de entrega</Label>
                    <Input
                      type="date"
                      value={comerciales.fecha_entrega}
                      onChange={(e) => setComerciales({ ...comerciales, fecha_entrega: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label className="text-xs">Descripción</Label>
                    <Input
                      value={comerciales.descripcion_producto}
                      onChange={(e) => setComerciales({ ...comerciales, descripcion_producto: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Código producto</Label>
                    <Input
                      value={comerciales.codigo_producto}
                      onChange={(e) => setComerciales({ ...comerciales, codigo_producto: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Total OT</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={comerciales.total_ot}
                      onChange={(e) => setComerciales({ ...comerciales, total_ot: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Medida (Kg/Mb/Bol)</Label>
                    <Input
                      value={comerciales.medida}
                      onChange={(e) => setComerciales({ ...comerciales, medida: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Entrega mes</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={comerciales.entrega_mes}
                      onChange={(e) => setComerciales({ ...comerciales, entrega_mes: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Equivalencia en Kg</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={comerciales.equivalencia_kg}
                      onChange={(e) => setComerciales({ ...comerciales, equivalencia_kg: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">PU US$</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={comerciales.pu_usd}
                      onChange={(e) => setComerciales({ ...comerciales, pu_usd: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">PT US$</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={comerciales.pt_usd}
                      onChange={(e) => {
                        const pt_usd = e.target.value
                        setComerciales({
                          ...comerciales,
                          pt_usd,
                          precio_total_pedido_usd: sumarPrecioTotal(pt_usd, comerciales.precio_clise_usd)
                        })
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Factura clisés</Label>
                    <div className="flex h-10 items-center gap-2">
                      <Switch
                        checked={comerciales.factura_clises === 'si'}
                        onCheckedChange={(checked) => {
                          const factura_clises = checked ? 'si' : 'no'
                          const precio_clise_usd = checked ? comerciales.precio_clise_usd : ''
                          setComerciales({
                            ...comerciales,
                            factura_clises,
                            precio_clise_usd,
                            precio_total_pedido_usd: sumarPrecioTotal(comerciales.pt_usd, precio_clise_usd)
                          })
                        }}
                      />
                      <span className="text-sm text-muted-foreground">
                        {comerciales.factura_clises === 'si' ? 'Sí' : 'No'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Precio clisé US$</Label>
                    <Input
                      type="number"
                      step="0.01"
                      disabled={comerciales.factura_clises !== 'si'}
                      value={comerciales.precio_clise_usd}
                      onChange={(e) => {
                        const precio_clise_usd = e.target.value
                        setComerciales({
                          ...comerciales,
                          precio_clise_usd,
                          precio_total_pedido_usd: sumarPrecioTotal(comerciales.pt_usd, precio_clise_usd)
                        })
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Precio total pedido US$ (PT + clisé)</Label>
                    <Input type="number" step="0.01" disabled value={comerciales.precio_total_pedido_usd} />
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Materiales pedidos</Label>
              {materialesForm.map((fila, i) => {
                const material = materiales.data?.find((m) => String(m.id) === fila.materialId)
                return (
                  <div key={i} className="flex items-end gap-2">
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Combobox
                        value={fila.materialId}
                        onChange={(v) => actualizarFilaMaterial(i, { materialId: v })}
                        options={materialOptions}
                        placeholder="Buscar código MP..."
                        emptyText="Sin materiales activos que coincidan"
                      />
                    </div>
                    <div className="flex w-40 flex-col gap-1.5">
                      <Input
                        type="number"
                        step="0.01"
                        placeholder={`Cantidad ${material?.unidad ? `(${material.unidad})` : ''}`}
                        value={fila.cantidad}
                        onChange={(e) => actualizarFilaMaterial(i, { cantidad: e.target.value })}
                      />
                    </div>
                    {materialesForm.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setMaterialesForm(materialesForm.filter((_, idx) => idx !== i))}
                        className="p-2 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )
              })}
              <p className="text-sm font-medium">
                Total cantidad: {materialesForm.reduce((acc, f) => acc + (Number(f.cantidad) || 0), 0)}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => setMaterialesForm([...materialesForm, filaMaterialVacia()])}
              >
                <Plus className="h-3.5 w-3.5" />
                Agregar material
              </Button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={guardar.isPending}>
              {guardar.isPending ? 'Guardando...' : 'Guardar OT'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
