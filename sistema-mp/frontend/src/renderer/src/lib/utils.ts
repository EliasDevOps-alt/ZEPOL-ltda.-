import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

// Materiales que se cuentan por pieza (unidad, unid, Unidad...) no vienen en
// bobinas/rollos — para esos se pide una sola cantidad en vez de armar N pesos.
export function esUnidadDiscreta(unidad: string): boolean {
  return /unid/i.test(unidad)
}
