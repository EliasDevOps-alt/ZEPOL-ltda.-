/**
 * Evita que la rueda del ratón cambie el valor de un campo numérico.
 *
 * Con el cursor sobre un `<input type="number">` que tiene el foco, girar la
 * rueda sube o baja el número en lugar de mover la página: quien solo quería
 * seguir bajando cambiaba un peso o una cantidad sin darse cuenta.
 *
 * Se registra UNA vez para toda la app, en el documento y en fase de captura,
 * o sea antes que cualquier otro manejador, y suelta el foco del campo que
 * recibe la rueda. Sin foco el navegador ya no toca el valor y el scroll sigue
 * su curso. Vale para cualquier campo numérico, exista hoy o se agregue mañana,
 * sin acordarse de arreglarlo componente por componente.
 */
export function evitarCambioDeNumeroConLaRueda(): void {
  document.addEventListener(
    'wheel',
    (evento) => {
      const campo = evento.target
      if (campo instanceof HTMLInputElement && campo.type === 'number' && campo === document.activeElement) {
        campo.blur()
      }
    },
    { capture: true, passive: true }
  )
}
