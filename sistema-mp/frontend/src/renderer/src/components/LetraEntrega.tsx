import { formatearFecha, textoDeEntrega } from '@renderer/lib/fechas'

// La letra con que se distingue una entrega cuando el material tiene 2 o más en la
// OT (ver lib/letrasEntrega.ts). Va en el naranja del sistema (`warning`, el mismo
// de las marcas de datos corregidos) y en negrita, para que salte a la vista y no se
// confunda con el resto del texto. Pedido de la planta (2026-10-22).

/** "(A)" — o solo "A" con `conParentesis={false}`, para frases como "entrega A". */
export function LetraEntrega({ letra, conParentesis = true }: { letra: string; conParentesis?: boolean }) {
  return <span className="font-semibold text-warning">{conParentesis ? `(${letra})` : letra}</span>
}

/** "PA15520" o, si esa entrega lleva letra, "PA15520 (A)" con la letra en naranja. */
export function CodigoConLetra({ codigo, letra }: { codigo: string; letra?: string }) {
  return (
    <>
      {codigo}
      {letra && (
        <>
          {' '}
          <LetraEntrega letra={letra} />
        </>
      )}
    </>
  )
}

/**
 * "de la entrega de las 11:00" para una devolución vinculada a una entrega (nada si
 * no lo está). Si esa entrega lleva letra: "de la entrega A (11:00)", con la letra
 * en naranja. Si la entrega fue otro día se incluye la fecha.
 */
export function TextoDeEntrega({
  entregaFecha,
  entregaHora,
  fechaDevolucion,
  letra
}: {
  entregaFecha: string | null
  entregaHora: string | null
  fechaDevolucion: string
  letra?: string
}) {
  if (!entregaHora) return null
  if (!letra) return <>{textoDeEntrega(entregaFecha, entregaHora, fechaDevolucion)}</>
  const hora = entregaHora.slice(0, 5)
  const cuando = entregaFecha && entregaFecha !== fechaDevolucion ? `${formatearFecha(entregaFecha)} ${hora}` : hora
  return (
    <>
      de la entrega <LetraEntrega letra={letra} conParentesis={false} /> ({cuando})
    </>
  )
}
