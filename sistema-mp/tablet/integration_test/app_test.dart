// Prueba de integración: la app completa corriendo EN LA TABLET (pantalla,
// teclado y Android reales) contra el backend falso en memoria, así no toca la
// base de datos ni la sesión guardada en la tablet (SharedPreferences va en
// memoria durante la prueba).
//
// Correr con la tablet conectada por USB:
//   flutter test integration_test -d <id de la tablet>
//
// Recorre el día de trabajo de Erasmo de punta a punta: configurar el
// servidor, entrar, registrar una entrega, corregirla y borrarla en el
// Historial, devolver un sobrante y verlo en Consultar OT.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import '../test/soporte/app_de_prueba.dart';
import '../test/soporte/backend_falso.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<void> cargarBobinas(WidgetTester tester, List<String> pesos) async {
    for (var i = 0; i < pesos.length; i++) {
      final casilla = find.widgetWithText(TextField, 'N.º ${i + 1}').first;
      await hastaVer(tester, casilla);
      await tester.enterText(casilla, pesos[i]);
      await tester.pump();
    }
  }

  testWidgets('día de trabajo completo de Erasmo', (tester) async {
    // En la tablet real se escribe con el teclado de prueba (no el de Android).
    tester.testTextInput.register();
    final backend = BackendFalso();
    await montarApp(tester, backend, usuario: null, servidor: false, forzarTamano: false);

    // 1. Primera vez: dirección del servidor.
    expect(find.text('Dirección del servidor'), findsOneWidget);
    await escribir(tester, 'Servidor', BackendFalso.servidor);
    await tester.tap(find.widgetWithText(FilledButton, 'Guardar'));
    await tester.pumpAndSettle();

    // 2. Login.
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Erasmo').last);
    await tester.pumpAndSettle();
    await escribir(tester, 'Clave', BackendFalso.clave);
    await tester.tap(find.widgetWithText(FilledButton, 'Ingresar'));
    await tester.pumpAndSettle();
    expect(find.text('Historial de OT'), findsOneWidget);
    expect(find.text('Reportes'), findsNothing);

    // 3. Registrar Entrega: 2 bobinas del PA15520 (primera entrega del pedido).
    await buscarOt(tester, '1000');
    await tocar(tester, texto('PA15520'));
    await cargarBobinas(tester, ['20,5', '19.5']);
    expect(find.text('Total: 40.00 kg'), findsOneWidget);
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar entrega'));
    expect(texto('Entrega de las 16:30'), findsOneWidget);
    final entrega = backend.cuerpos('POST', '/entregas').single;
    expect(entrega['ot_material_id'], 12);
    expect(entrega['bobinas'], [20.5, 19.5]);
    final idEntrega = backend.entregas.last['id'];

    // 4. Historial: corregirla (una bobina más) y después borrarla.
    await irA(tester, 'Historial de OT');
    await tester.tap(find.text('Todos'));
    await tester.pumpAndSettle();
    await escribir(tester, 'Buscar OT, cliente, diseño...', '1000');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();

    final ficha = find.ancestor(of: find.text('2 bobinas: 20.5 kg, 19.5 kg'), matching: find.byType(Container)).first;
    await hastaVer(tester, find.text('2 bobinas: 20.5 kg, 19.5 kg'));
    await tocar(tester, find.descendant(of: ficha, matching: find.text('Corregir')));
    final casilla3 = find.widgetWithText(TextField, 'N.º 3');
    await hastaVer(tester, casilla3);
    await tester.enterText(casilla3, '10');
    await tester.pump();
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar'));
    expect(backend.cuerpos('PATCH', '/entregas/$idEntrega').single['bobinas'], [20.5, 19.5, 10.0]);

    final corregida = find.text('3 bobinas: 20.5 kg, 19.5 kg, 10 kg');
    await hastaVer(tester, corregida);
    expect(find.textContaining('Editado por ER'), findsOneWidget);
    final fichaCorregida = find.ancestor(of: corregida, matching: find.byType(Container)).first;
    await tocar(tester, find.descendant(of: fichaCorregida, matching: find.text('Eliminar')));
    await tester.tap(find.widgetWithText(FilledButton, 'Eliminar').last);
    await tester.pumpAndSettle();
    expect(backend.entregas.where((e) => e['id'] == idEntrega), isEmpty);

    // 5. Registrar Devolución: sobrante de la entrega (B) del BOPP20620.
    await irA(tester, 'Registrar Devolución');
    await buscarOt(tester, '1000');
    await tocar(tester, texto('BOPP20620 (B)'));
    await cargarBobinas(tester, ['12']);
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar registro'));
    expect(texto('12 kg de BOPP20620 devueltos (de la entrega de las 14:15)'), findsOneWidget);
    expect(backend.cuerpos('POST', '/devoluciones').single['entrega_id'], 2);

    // 6. Consultar OT: la entrega (B) ahora tiene 110 − 12 = 98 kg de consumo.
    await irA(tester, 'Consultar OT');
    await buscarOt(tester, '1000');
    await hastaVer(tester, texto('BOPP20620 (B)'));
    expect(find.text('98 kg'), findsOneWidget);

    // 7. Cerrar sesión.
    await tester.tap(find.byTooltip('Cerrar sesión'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, 'Ingresar'), findsOneWidget);
  });
}
