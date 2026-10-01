import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Redondea a 3 decimales (la precisión con la que se guardan los pesos).
 * Sumar números con coma flotante da cosas como 10.22 + 12.66 =
 * 22.880000000000003, que no se puede mostrar tal cual en pantalla. */
export function redondearPeso(n: number): number {
  return Math.round(n * 1000) / 1000
}
