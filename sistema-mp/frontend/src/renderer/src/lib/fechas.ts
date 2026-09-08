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

export function mesActualISO(): string {
  return hoyISO().slice(0, 7)
}

/** Último día del mes 'YYYY-MM'. new Date(anio, mes, 0) es el día 0 del mes
 * siguiente, o sea el último del mes pedido. */
export function ultimoDiaDelMes(mesISO: string): string {
  const [anio, mes] = mesISO.split('-').map(Number)
  return aISO(new Date(anio, mes, 0))
}
