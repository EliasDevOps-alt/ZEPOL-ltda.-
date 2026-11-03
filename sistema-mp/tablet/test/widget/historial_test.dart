import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../soporte/app_de_prueba.dart';
import '../soporte/backend_falso.dart';

/// Abre Historial buscando la OT 1000 (con búsqueda = todas las fechas).
Future<void> abrir(WidgetTester tester, BackendFalso backend) async {
  await montarApp(tester, backend);
  await irA(tester, 'Historial de OT');
  await escribir(tester, 'Buscar OT, cliente, diseño...', '1000');
  await tester.testTextInput.receiveAction(TextInputAction.search);
  await tester.pumpAndSettle();
}

/// La ficha de un movimiento (su recuadro) a partir de un texto suyo.
Finder ficha(String parte) => find.ancestor(of: texto(parte), matching: find.byType(Container)).first;

void main() {
  testWidgets('el filtro va por la fecha del MOVIMIENTO: octubre 2026 sí, otro mes no', (tester) async {
    await montarApp(tester, BackendFalso());
    await irA(tester, 'Historial de OT');
    // Arranca en el mes actual. Los movimientos de prueba son de octubre de 2026.
    final hoy = DateTime.now();
    final mesesHastaOctubre = (hoy.year - 2026) * 12 + hoy.month - 10;
    for (var i = 0; i < mesesHastaOctubre; i++) {
      await tester.tap(find.byIcon(Icons.chevron_left));
      await tester.pump();
    }
    for (var i = 0; i > mesesHastaOctubre; i--) {
      await tester.tap(find.byIcon(Icons.chevron_right));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(find.text('Octubre 2026'), findsOneWidget);
    expect(find.text('OT 1000'), findsOneWidget);
    // La OT 2000 no tiene movimientos: no sale con filtro de fecha.
    expect(find.text('OT 2000'), findsNothing);

    await tester.tap(find.byIcon(Icons.chevron_right));
    await tester.pumpAndSettle();
    expect(find.text('OT 1000'), findsNothing);
    expect(find.textContaining('No hay entregas ni devoluciones en este período'), findsOneWidget);

    await tester.tap(find.text('Todos'));
    await tester.pumpAndSettle();
    expect(find.text('OT 2000'), findsOneWidget);
  });

  testWidgets('un movimiento con SID registrado no se puede corregir ni borrar', (tester) async {
    await abrir(tester, BackendFalso());
    await hastaVer(tester, texto('de la entrega '));
    expect(find.text('SID ya registrado — no se puede corregir.'), findsWidgets);
  });

  testWidgets('corregir una entrega: manda el PATCH y muestra "Editado por"', (tester) async {
    final backend = BackendFalso();
    await abrir(tester, backend);
    await hastaVer(tester, find.text('2 bobinas: 50 kg, 50 kg'));
    final corregir = find.descendant(of: ficha('2 bobinas: 50 kg, 50 kg'), matching: find.text('Corregir'));
    await tocar(tester, corregir);

    // Agrega una tercera bobina de 5 kg.
    final casilla = find.widgetWithText(TextField, 'N.º 3');
    await hastaVer(tester, casilla);
    await tester.enterText(casilla, '5');
    await tester.pump();
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar'));

    final cambio = backend.cuerpos('PATCH', '/entregas/1').single;
    expect(cambio['bobinas'], [50.0, 50.0, 5.0]);
    expect(cambio['proceso_id'], 1);
    expect(cambio['maquina_id'], 11);
    await hastaVer(tester, find.text('3 bobinas: 50 kg, 50 kg, 5 kg'));
    expect(find.textContaining('Editado por ER'), findsOneWidget);
  });

  testWidgets('eliminar pide confirmación; "Cancelar" no borra nada', (tester) async {
    final backend = BackendFalso();
    await abrir(tester, backend);
    await hastaVer(tester, find.text('1 bobina: 110 kg'));
    final eliminar = find.descendant(of: ficha('1 bobina: 110 kg'), matching: find.text('Eliminar'));

    await tocar(tester, eliminar);
    expect(find.textContaining('¿Eliminar esta entrega de BOPP20620?'), findsOneWidget);
    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
    expect(backend.peticiones.where((r) => r.method == 'DELETE'), isEmpty);

    await tocar(tester, eliminar);
    await tester.tap(find.widgetWithText(FilledButton, 'Eliminar').last);
    await tester.pumpAndSettle();
    expect(backend.peticiones.where((r) => r.method == 'DELETE').single.url.path, '/entregas/2');
    expect(find.text('1 bobina: 110 kg'), findsNothing);
  });

  testWidgets('un error al guardar se muestra y la ficha sigue en edición', (tester) async {
    final backend = BackendFalso();
    await abrir(tester, backend);
    await hastaVer(tester, find.text('1 bobina: 110 kg'));
    await tocar(tester, find.descendant(of: ficha('1 bobina: 110 kg'), matching: find.text('Corregir')));
    backend.forzarError = 400;
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar'));
    expect(find.text('Error forzado'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Guardar'), findsOneWidget);
  });
}
