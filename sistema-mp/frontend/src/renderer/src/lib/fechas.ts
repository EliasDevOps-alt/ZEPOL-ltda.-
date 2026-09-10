/** Fechas en formato ISO corto (YYYY-MM-DD) para los filtros de pantalla y
 * los campos <input type="date">, siempre en la hora LOCAL de la planta.
 *
 * Cuidado con Date.toISOString(): convierte a UTC, y la planta está en
 * UTC-4 (America/La_Paz), así que entre las 20:00 y las 23:59 devuelve el
 * día SIGUIENTE. Eso hacía dos cosas silenciosas: una entrega registrada de
 * noche se guardaba con la fecha de mañana, y el filtro "día" de Todas las
 * OT / Registro SID abría vacío sin explicación. Por eso el string se arma
 * a partir de los componentes locales y nunca con toISOString.
 *
 * Estaba duplicado en las cuatro pantallas que lo usan y el error estaba en
 * las cuatro copias — vive acá para que no vuelva a pasar. */
function aISO(fecha: Date): string {
  const anio = fecha.getFullYear()
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${anio}-${mes}-${dia}`
}

export function hoyISO(): string {
  return aISO(new Date())
}

/** Fecha local (YYYY-MM-DD) de un timestamp completo tipo fecha_creacion —
 * para agrupar por día en pantalla. new Date(datetime) ya interpreta un
 * datetime con 'T' y sin offset como hora local (a diferencia de un string
 * de solo fecha, ver la nota de arriba), así que acá sí es seguro. */
export function soloFechaLocal(datetime: string): string {
  return aISO(new Date(datetime))
}

export function mesActualISO(): string {
  return hoyISO().slice(0, 7)
}

/** Último día del mes 'YYYY-MM'. new Date(anio, mes, 0) es el día 0 del mes
 * siguiente, o sea el último del mes pedido. */
export function ultimoDiaDelMes(mesISO: string): string {
  const [anio, mes] = mesISO.split('-').map(Number)
  return aISO(new Date(anio, mes, 0))
}

/** 'YYYY-MM-DD' (fecha del movimiento) + 'HH:MM:SS' (su hora de registro) a
 * 'DD/MM/YYYY HH:MM'. Se arma con split, nunca con `new Date(fechaISO)`: un
 * string de solo fecha se interpreta como medianoche UTC, y en UTC-4 eso
 * muestra el día anterior — mismo tipo de bug que el de toISOString de
 * arriba, en la dirección contraria. */
export function formatearFechaHora(fechaISO: string, horaISO: string): string {
  const [anio, mes, dia] = fechaISO.split('-')
  return `${dia}/${mes}/${anio} ${horaISO.slice(0, 5)}`
}

/** Timestamp completo (fecha_creacion, editado_en, creado_en) a
 * 'DD/MM/YYYY HH:MM'. Estos sí llevan 'T' y sin offset, así que
 * `new Date(...)` los interpreta en hora local del navegador — que es la
 * correcta, a diferencia del caso de arriba. */
export function formatearFechaHoraCompleta(datetime: string): string {
  const d = new Date(datetime)
  return `${d.toLocaleDateString('es-BO')} ${d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}`
}
