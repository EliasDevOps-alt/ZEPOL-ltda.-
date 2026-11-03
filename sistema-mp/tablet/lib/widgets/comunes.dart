import 'package:flutter/material.dart';

import '../api/modelos.dart';
import '../tema.dart';

// Piezas visuales que comparten las pantallas de la tablet.

/// "PA15520 (A)" con la letra en naranja y negrita, como el escritorio.
InlineSpan codigoConLetra(String codigo, String? letra, {TextStyle? estilo}) => TextSpan(
      style: estilo,
      children: [
        TextSpan(text: codigo),
        if (letra != null)
          TextSpan(text: ' ($letra)', style: const TextStyle(color: Colores.aviso, fontWeight: FontWeight.w700)),
      ],
    );

class Tarjeta extends StatelessWidget {
  const Tarjeta({super.key, required this.titulo, required this.children, this.accion});

  final String titulo;
  final List<Widget> children;
  final Widget? accion;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: Text(titulo, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600))),
                ?accion,
              ],
            ),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }
}

class Aviso extends StatelessWidget {
  const Aviso({super.key, required this.color, required this.texto, this.accion});

  final Color color;
  final String texto;
  final Widget? accion;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Expanded(child: Text(texto, style: TextStyle(color: color))),
          ?accion,
        ],
      ),
    );
  }
}

class BotonLista extends StatelessWidget {
  const BotonLista({
    super.key,
    required this.child,
    required this.alTocar,
    this.seleccionado = false,
    this.color = Colores.primario,
    this.resaltarBorde = false,
  });

  final Widget child;
  final VoidCallback alTocar;
  final bool seleccionado;
  // Naranja para lo que entrega producción, como el escritorio.
  final Color color;
  // Borde del color aunque no esté seleccionado.
  final bool resaltarBorde;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: seleccionado ? color.withValues(alpha: 0.1) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(
          color: seleccionado ? color : (resaltarBorde ? color.withValues(alpha: 0.4) : Colores.borde),
          width: seleccionado ? 2 : 1,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: alTocar,
        child: Padding(padding: const EdgeInsets.all(12), child: child),
      ),
    );
  }
}

class Etiqueta extends StatelessWidget {
  const Etiqueta(this.texto, {super.key, required this.color, this.icono});

  final String texto;
  final Color color;
  final IconData? icono;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icono != null) ...[Icon(icono, size: 12, color: color), const SizedBox(width: 4)],
          Text(texto, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: color)),
        ],
      ),
    );
  }
}

/// Calendario para la fecha del movimiento. Devuelve 'YYYY-MM-DD' (hora local) o null.
Future<String?> elegirFecha(BuildContext context, String actual) async {
  final p = actual.split('-').map(int.parse).toList();
  final d = await showDatePicker(
    context: context,
    initialDate: DateTime(p[0], p[1], p[2]),
    firstDate: DateTime(2024),
    lastDate: DateTime.now().add(const Duration(days: 31)),
  );
  if (d == null) return null;
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

/// Cliente y producto de la OT buscada, para reconocerla de un vistazo.
class EncabezadoOt extends StatelessWidget {
  const EncabezadoOt({super.key, required this.encabezado});

  final OtEncabezado encabezado;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colores.apagado,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colores.borde),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(encabezado.cliente ?? 'Sin cliente', style: const TextStyle(fontWeight: FontWeight.w600)),
          if ((encabezado.descripcionProducto ?? '').isNotEmpty)
            Text(encabezado.descripcionProducto!, style: const TextStyle(color: Colores.textoApagado)),
        ],
      ),
    );
  }
}

/// El código original del Excel, chico y con ícono, al lado del material del
/// catálogo al que se resolvió (para rastrear de qué línea del Excel viene).
class CodigoExcel extends StatelessWidget {
  const CodigoExcel(this.codigo, {super.key});

  final String codigo;

  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.table_chart_outlined, size: 14, color: Colores.textoApagado),
      const SizedBox(width: 2),
      Text(codigo, style: const TextStyle(fontSize: 12, color: Colores.textoApagado)),
    ]);
  }
}

/// Pregunta antes de algo que no se puede deshacer (eliminar un movimiento).
Future<bool> confirmar(BuildContext context, String mensaje, {String accion = 'Eliminar'}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      content: Text(mensaje),
      actions: [
        TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancelar')),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: Colores.peligro, minimumSize: const Size(64, 44)),
          onPressed: () => Navigator.of(ctx).pop(true),
          child: Text(accion),
        ),
      ],
    ),
  );
  return r ?? false;
}
