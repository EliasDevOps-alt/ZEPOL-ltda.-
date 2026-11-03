import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../soporte/app_de_prueba.dart';
import '../soporte/backend_falso.dart';

Future<void> abrirOt(WidgetTester tester, BackendFalso backend) async {
  await montarApp(tester, backend);
  await irA(tester, 'Registrar Devolución');
  await buscarOt(tester, '1000');
}

Future<void> cargarBobinas(WidgetTester tester, List<String> pesos) async {
  for (var i = 0; i < pesos.length; i++) {
    final casilla = find.widgetWithText(TextField, 'N.º ${i + 1}').first;
    await hastaVer(tester, casilla);
    await tester.enterText(casilla, pesos[i]);
    await tester.pump();
  }
}

void main() {
  testWidgets('antes de buscar: materiales pendientes de devolver de todas las OT', (tester) async {
    await montarApp(tester, BackendFalso());
    await irA(tester, 'Registrar Devolución');
    expect(find.text('Materiales pendientes de devolver'), findsOneWidget);
    expect(texto('BOPP20620 — OT 1000'), findsOneWidget);
    // 100 + 110 entregados − 30 devueltos
    expect(find.text('Disponible para devolver: 180.00 kg'), findsOneWidget);
  });

  testWidgets('cada entrega es su propia opción; el material fabricado en la OT, una sola', (tester) async {
    await abrirOt(tester, BackendFalso());
    expect(texto('BOPP20620 (A)'), findsOneWidget);
    expect(texto('BOPP20620 (B)'), findsOneWidget);
    // Entrega A: 100 entregados, 30 ya devueltos de ella.
    expect(texto('Queda: 70 kg'), findsOneWidget);
    expect(texto('se fabrica en esta OT'), findsOneWidget);
  });

  testWidgets('sobrante de una entrega: queda vinculado a ESA entrega', (tester) async {
    final backend = BackendFalso();
    await abrirOt(tester, backend);
    await tocar(tester, texto('BOPP20620 (B)'));
    expect(find.text('Disponible de esa entrega (14:15): 110.00 kg'), findsOneWidget);

    await cargarBobinas(tester, ['8']);
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar registro'));

    final enviado = backend.cuerpos('POST', '/devoluciones').single;
    expect(enviado['ot_material_id'], 10);
    expect(enviado['entrega_id'], 2);
    expect(enviado['es_ingreso_produccion'], isFalse);
    expect(texto('8 kg de BOPP20620 devueltos (de la entrega de las 14:15)'), findsOneWidget);
  });

  testWidgets('pasarse de lo disponible avisa pero deja guardar', (tester) async {
    final backend = BackendFalso();
    await abrirOt(tester, backend);
    await tocar(tester, texto('BOPP20620 (A)'));
    await cargarBobinas(tester, ['500']);
    expect(find.textContaining('Estás registrando más de lo que el sistema tiene como entregado'), findsOneWidget);
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar registro'));
    expect(backend.cuerpos('POST', '/devoluciones'), hasLength(1));
  });

  testWidgets('material fabricado en la OT: arranca en "ingreso a almacén" y puede pasar a sobrante',
      (tester) async {
    final backend = BackendFalso();
    await abrirOt(tester, backend);
    await tocar(tester, texto('NORD — LDPE-3'));
    await hastaVer(tester, texto('Registro de ingreso a almacén.'));
    expect(texto('Registro de ingreso a almacén.'), findsOneWidget);
    expect(find.textContaining('Disponible para devolver'), findsNothing);

    await cargarBobinas(tester, ['20']);
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar registro'));
    final ingreso = backend.cuerpos('POST', '/devoluciones').single;
    expect(ingreso['ot_material_id'], 11);
    expect(ingreso['es_ingreso_produccion'], isTrue);
    expect(ingreso.containsKey('entrega_id'), isFalse);
    expect(texto('20 kg de LDPE-3 ingresados a almacén'), findsOneWidget);
  });

  testWidgets('el modo sobrante del material fabricado manda es_ingreso_produccion false', (tester) async {
    final backend = BackendFalso();
    await abrirOt(tester, backend);
    await tocar(tester, texto('NORD — LDPE-3'));
    await tocar(tester, find.text('Devolución de sobrante'));
    expect(find.textContaining('Disponible para devolver según el sistema'), findsOneWidget);
    await cargarBobinas(tester, ['3']);
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar registro'));
    expect(backend.cuerpos('POST', '/devoluciones').single['es_ingreso_produccion'], isFalse);
  });

  testWidgets('sin cantidad no guarda', (tester) async {
    final backend = BackendFalso();
    await abrirOt(tester, backend);
    await tocar(tester, texto('BOPP20620 (A)'));
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar registro'));
    expect(find.text('Cada material seleccionado necesita una cantidad válida mayor a 0'), findsOneWidget);
    expect(backend.cuerpos('POST', '/devoluciones'), isEmpty);
  });

  testWidgets('"Registrar ingreso de LDPE-3" de un material que la OT no tiene crea un pendiente', (tester) async {
    final backend = BackendFalso();
    await abrirOt(tester, backend);
    await tocar(tester, find.text('Registrar ingreso de LDPE-3'));
    await elegirMaterial(tester, 'Material', 'BOPP20560');
    await cargarBobinas(tester, ['15']);
    await tocar(tester, find.widgetWithText(FilledButton, 'Registrar'));

    final resolver = backend.cuerpos('POST', '/ordenes-trabajo/1000/ingreso-libre').single;
    expect(resolver, {'material_id': 101, 'cantidad_requerida': 15.0});
    final enviado = backend.cuerpos('POST', '/devoluciones').single;
    expect(enviado['pendiente_id'], isNotNull);
    expect(enviado.containsKey('ot_material_id'), isFalse);
    expect(enviado['es_ingreso_produccion'], isTrue);
    // El pendiente nuevo aparece en la lista, en naranja, para más tandas.
    await hastaVer(tester, texto('material ingresado de producción a almacén'));
    expect(texto('material ingresado de producción a almacén'), findsOneWidget);
  });
}
