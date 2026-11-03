import 'package:flutter/material.dart';

import '../tema.dart';

/// La tarjeta del login del escritorio: franja de colores del logo arriba,
/// "ZEPOL" y un subtítulo.
class TarjetaMarca extends StatelessWidget {
  const TarjetaMarca({super.key, required this.subtitulo, required this.child});

  final String subtitulo;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 440),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(height: 6, decoration: const BoxDecoration(gradient: LinearGradient(colors: Colores.acentos))),
            Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('ZEPOL',
                      style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: Colores.primario)),
                  Text(subtitulo, style: const TextStyle(color: Colores.textoApagado)),
                  const SizedBox(height: 20),
                  child,
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
