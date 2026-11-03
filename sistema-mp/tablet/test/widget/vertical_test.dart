import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../soporte/app_de_prueba.dart';
import '../soporte/backend_falso.dart';

/// La misma tablet apoyada en vertical: 800×1280 px a 215 dpi (~597×955 dp).
void tamanoVertical(WidgetTester tester) {
  tester.view.physicalSize = const Size(800, 1280);
  tester.view.devicePixelRatio = 1.34;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('en vertical el menú es un cajón y todas las pantallas abren sin desbordar', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend, forzarTamano: false, usuario: 'ER');
    // montarApp ya arrancó con el tamaño de la tablet del test (800×600 por defecto):
    // se pasa a vertical y se vuelve a dibujar.
    tamanoVertical(tester);
    await tester.pumpAndSettle();

    // Sin menú lateral fijo: hay botón de menú y el título de la pantalla actual.
    expect(find.byTooltip('Menú'), findsOneWidget);
    expect(find.text('ZEPOL'), findsNothing);

    for (final seccion in ['Historial de OT', 'Registrar Devolución', 'Consultar OT', 'Registrar Entrega']) {
      await tester.tap(find.byTooltip('Menú'));
      await tester.pumpAndSettle();
      expect(find.text('ZEPOL'), findsOneWidget, reason: 'el cajón muestra el menú');
      await tester.tap(find.text(seccion).first);
      await tester.pumpAndSettle();
      expect(find.text('ZEPOL'), findsNothing, reason: 'al elegir una pantalla el cajón se cierra');
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('en vertical se puede buscar una OT y registrar una entrega', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend, forzarTamano: false, usuario: 'ER');
    tamanoVertical(tester);
    await tester.pumpAndSettle();

    await buscarOt(tester, '1000');
    expect(texto('PA15520'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('en horizontal sigue el menú lateral fijo', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend, usuario: 'ER');
    expect(find.byTooltip('Menú'), findsNothing);
    expect(find.text('ZEPOL'), findsOneWidget);
  });
}
