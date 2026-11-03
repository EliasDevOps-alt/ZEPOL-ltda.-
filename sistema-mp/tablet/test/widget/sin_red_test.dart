// La pantalla de la tablet cuando se corta el wifi y cuando vuelve: qué sigue
// viendo el operador, qué avisos le salen y que nada se guarda a medias.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../soporte/app_de_prueba.dart';
import '../soporte/backend_falso.dart';

Finder ficha(String parte) => find.ancestor(of: texto(parte), matching: find.byType(Container)).first;

Future<void> cargarBobinas(WidgetTester tester, List<String> pesos) async {
  for (var i = 0; i < pesos.length; i++) {
    final casilla = find.widgetWithText(TextField, 'N.º ${i + 1}').first;
    await hastaVer(tester, casilla);
    await tester.enterText(casilla, pesos[i]);
    await tester.pump();
  }
}

void main() {
  testWidgets('60. Historial: sin wifi se sigue buscando y viendo lo último sincronizado', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    await irA(tester, 'Historial de OT');
    backend.sinRed = true;
    await escribir(tester, 'Buscar OT, cliente, diseño...', 'hipermaxi');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text('OT 2000'), findsOneWidget);
    expect(find.textContaining('No se pudo cargar'), findsNothing);
  });

  testWidgets('61. Historial: eliminar una entrega sin wifi avisa y la entrega sigue en pantalla', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    await irA(tester, 'Historial de OT');
    await escribir(tester, 'Buscar OT, cliente, diseño...', '1000');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    await hastaVer(tester, find.text('1 bobina: 110 kg'));

    backend.sinRed = true;
    await tocar(tester, find.descendant(of: ficha('1 bobina: 110 kg'), matching: find.text('Eliminar')));
    await tester.tap(find.widgetWithText(FilledButton, 'Eliminar').last);
    await tester.pumpAndSettle();

    expect(find.textContaining('No se pudo conectar con el servidor'), findsOneWidget);
    expect(find.text('1 bobina: 110 kg'), findsOneWidget);
    expect(backend.entregas.any((e) => e['id'] == 2), isTrue);
  });

  testWidgets('62. Historial: corregir sin wifi avisa y la ficha sigue en edición para reintentar', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    await irA(tester, 'Historial de OT');
    await escribir(tester, 'Buscar OT, cliente, diseño...', '1000');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    await hastaVer(tester, find.text('1 bobina: 110 kg'));
    await tocar(tester, find.descendant(of: ficha('1 bobina: 110 kg'), matching: find.text('Corregir')));

    backend.sinRed = true;
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar'));
    expect(find.textContaining('No se pudo conectar con el servidor'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Guardar'), findsOneWidget);

    // Vuelve el wifi: el mismo botón ahora guarda.
    backend.sinRed = false;
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar'));
    expect(backend.cuerpos('PATCH', '/entregas/2'), hasLength(1));
  });

  testWidgets('63. Historial: se actualiza solo cuando llega a la tablet lo que registró otro equipo', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    await irA(tester, 'Historial de OT');
    await escribir(tester, 'Buscar OT, cliente, diseño...', '1000');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.textContaining('bobinas: 77 kg'), findsNothing);

    // La PC registra una entrega de 77 kg y la tablet la recoge en su próxima ronda.
    backend.entregas.add({
      'id': 700,
      'pedido': 10,
      'material_id': 100,
      'fecha': '2026-10-23',
      'hora': '10:00:00',
      'bobinas': [77.0],
      'usuario': 'BO',
      'proceso_id': null,
      'maquina_id': null,
      'observacion': null,
      'sid': false,
      'editado_por': null,
      'editado_en': null,
    });
    await sesion.repo.sincronizar();
    await tester.pumpAndSettle();
    await hastaVer(tester, find.text('1 bobina: 77 kg'));
    expect(find.text('1 bobina: 77 kg'), findsOneWidget);
  });

  testWidgets('64. Historial: la PC borra una entrega y desaparece de la tablet sin tocar nada', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    await irA(tester, 'Historial de OT');
    await escribir(tester, 'Buscar OT, cliente, diseño...', '1000');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    await hastaVer(tester, find.text('1 bobina: 110 kg'));

    backend.entregas.removeWhere((e) => e['id'] == 2);
    await sesion.repo.sincronizar();
    await tester.pumpAndSettle();
    expect(find.text('1 bobina: 110 kg'), findsNothing);
  });

  testWidgets('65. Historial: sin wifi y luego con wifi, lo de la PC aparece al sincronizar', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    await irA(tester, 'Historial de OT');
    await escribir(tester, 'Buscar OT, cliente, diseño...', '1000');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();

    backend.sinRed = true;
    backend.entregas.removeWhere((e) => e['id'] == 2);
    await sesion.repo.sincronizar();
    await tester.pumpAndSettle();
    await hastaVer(tester, find.text('1 bobina: 110 kg'));
    expect(find.text('1 bobina: 110 kg'), findsOneWidget, reason: 'sin wifi sigue viendo lo último que supo');

    backend.sinRed = false;
    await sesion.repo.sincronizar();
    await tester.pumpAndSettle();
    expect(find.text('1 bobina: 110 kg'), findsNothing);
  });

  testWidgets('66. Registrar Entrega: sin wifi la OT se abre con la copia y guardar avisa sin registrar nada', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    backend.sinRed = true;
    await buscarOt(tester, '1000');
    // Sin wifi igual se ven los pedidos (de la copia).
    expect(texto('BOPP20620 (B)'), findsOneWidget);

    await tocar(tester, texto('BOPP20620 (B)'));
    await cargarBobinas(tester, ['12']);
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar entrega'));
    expect(find.textContaining('No se pudo conectar con el servidor'), findsWidgets);
    expect(backend.entregas, hasLength(2), reason: 'no se registró nada');

    // Vuelve el wifi: se reintenta con los pesos que seguían escritos.
    backend.sinRed = false;
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar entrega'));
    expect(backend.cuerpos('POST', '/entregas').single['bobinas'], [12.0]);
    expect(backend.entregas, hasLength(3));
  });

  testWidgets('67. Registrar Entrega: una OT que la copia no conoce y sin wifi dice que no puede conectar', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    backend.sinRed = true;
    await buscarOt(tester, '4242');
    expect(find.textContaining('No se pudo conectar con el servidor'), findsWidgets);
  });

  testWidgets('68. Registrar Devolución: sin wifi guardar avisa y no registra nada', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    await irA(tester, 'Registrar Devolución');
    await buscarOt(tester, '1000');
    backend.sinRed = true;
    await tocar(tester, texto('BOPP20620 (B)'));
    await cargarBobinas(tester, ['5']);
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar registro'));
    expect(find.textContaining('No se pudo conectar con el servidor'), findsWidgets);
    expect(backend.devoluciones, hasLength(2));
  });

  testWidgets('69. Consultar OT: sin wifi muestra al instante lo de la copia', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    await irA(tester, 'Consultar OT');
    backend.sinRed = true;
    await buscarOt(tester, '1000');
    expect(texto('BOPP20620'), findsWidgets);
  });

  testWidgets('101. Registrar Entrega: una OT ya abierta con wifi sigue mostrando su material pendiente sin wifi', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    await buscarOt(tester, '1000');
    await hastaVer(tester, find.text('LDPE45840'));

    // Se cierra la OT, se corta el wifi y se la vuelve a abrir.
    await tocar(tester, find.byTooltip('Otra OT'));
    backend.sinRed = true;
    await buscarOt(tester, '1000');
    // El encabezado está arriba de todo: se mira antes de bajar hasta el pendiente.
    expect(find.text('Coronilla S.A.'), findsOneWidget);
    await hastaVer(tester, find.text('LDPE45840'));
    expect(find.text('LDPE45840'), findsOneWidget);
  });
}
