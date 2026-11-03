import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../soporte/app_de_prueba.dart';
import '../soporte/backend_falso.dart';

/// Escribe pesos en las casillas de bobinas de la tarjeta visible (la última
/// casilla vacía se agrega sola).
Future<void> cargarBobinas(WidgetTester tester, List<String> pesos) async {
  for (var i = 0; i < pesos.length; i++) {
    final casilla = find.widgetWithText(TextField, 'N.º ${i + 1}').first;
    await hastaVer(tester, casilla);
    await tester.enterText(casilla, pesos[i]);
    await tester.pump();
  }
}

void main() {
  testWidgets('lista: cliente, una opción por entrega con su letra, sin cargos de tinta', (tester) async {
    await montarApp(tester, BackendFalso());
    await buscarOt(tester, '1000');

    expect(find.text('Coronilla S.A.'), findsOneWidget);
    // El pedido 10 tuvo 2 entregas: dos opciones, (A) y (B).
    expect(texto('BOPP20620 (A)'), findsOneWidget);
    expect(texto('BOPP20620 (B)'), findsOneWidget);
    expect(texto('se fabrica en esta OT'), findsOneWidget);
    expect(texto('materia prima de LDPE-3'), findsOneWidget);
    // El cargo de tinta "Laminación" no es un material que se entregue.
    expect(texto('NORD — Laminación'), findsNothing);
    // El pendiente del Excel aparece para asignarle proceso y máquina.
    await hastaVer(tester, find.text('LDPE45840'));
    expect(find.text('LDPE45840'), findsOneWidget);
  });

  testWidgets('entrega sobre una entrega anterior: proceso y máquina precargados, sin "material distinto"',
      (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    await buscarOt(tester, '1000');
    await tocar(tester, texto('BOPP20620 (B)'));

    expect(find.text('Cantidades entregadas'), findsOneWidget);
    expect(find.text('NORD'), findsWidgets);
    expect(find.textContaining('¿Se entregó un material distinto?'), findsNothing);

    await cargarBobinas(tester, ['12,5', '7']);
    expect(find.text('Total: 19.50 kg'), findsOneWidget);
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar entrega'));

    final enviado = backend.cuerpos('POST', '/entregas').single;
    expect(enviado['ot_material_id'], 10);
    expect(enviado['bobinas'], [12.5, 7.0]);
    expect(enviado['proceso_id'], 1);
    expect(enviado['maquina_id'], 11);
    expect(enviado.containsKey('material_id'), isFalse);
    expect(texto('Entrega de las 16:30'), findsOneWidget);
    // Ahora el pedido tiene 3 entregas: aparece la (C).
    expect(texto('BOPP20620 (C)'), findsWidgets);
  });

  testWidgets('primera entrega de un pedido: ofrece "material distinto"; sin cantidad no guarda',
      (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    await buscarOt(tester, '1000');
    await tocar(tester, texto('PA15520'));

    expect(find.textContaining('¿Se entregó un material distinto?'), findsOneWidget);
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar entrega'));
    expect(find.text('Completa la cantidad entregada'), findsOneWidget);
    expect(backend.cuerpos('POST', '/entregas'), isEmpty);
  });

  testWidgets('material distinto: se elige del buscador y viaja como material_id', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    await buscarOt(tester, '1000');
    await tocar(tester, texto('PA15520'));
    await tocar(tester, find.textContaining('¿Se entregó un material distinto?'));

    await elegirMaterial(tester, 'Material realmente entregado', 'BOPP20560');

    await cargarBobinas(tester, ['40']);
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar entrega'));
    final enviado = backend.cuerpos('POST', '/entregas').single;
    expect(enviado['ot_material_id'], 12);
    expect(enviado['material_id'], 101);
    expect(texto('se entregó como'), findsOneWidget);
  });

  testWidgets('pendiente del Excel: exige material, proceso y máquina; después promueve y entrega',
      (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    await buscarOt(tester, '1000');

    await tocar(tester, find.widgetWithText(FilledButton, 'Asignar y registrar entrega'));
    expect(find.text('Indica a qué material del catálogo corresponde'), findsOneWidget);

    await elegirMaterial(tester, '¿A qué material del catálogo corresponde?', 'LDPE-3');
    await elegirEnLista(tester, 'Proceso (obligatorio)', 'Extrusión');
    await elegirEnLista(tester, 'Máquina (obligatorio)', 'CHINA');

    await cargarBobinas(tester, ['25']);
    await tocar(tester, find.widgetWithText(FilledButton, 'Asignar y registrar entrega'));

    final promover = backend.cuerpos('POST', '/ot-materiales-pendientes/50/promover').single;
    expect(promover, {'proceso_id': 3, 'maquina_id': 31, 'material_id': 102});
    final entrega = backend.cuerpos('POST', '/entregas').single;
    expect(entrega['bobinas'], [25.0]);
    expect(texto('Entrega de las 16:30'), findsOneWidget);
    expect(find.text('LDPE45840'), findsNothing);
  });

  testWidgets('"Entregar un material que la OT no tiene" exige proceso y máquina', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    await buscarOt(tester, '1000');
    await tocar(tester, find.text('Entregar un material que la OT no tiene'));

    await elegirMaterial(tester, 'Material', 'BOPP20560');
    await cargarBobinas(tester, ['10']);
    await tocar(tester, find.widgetWithText(FilledButton, 'Registrar'));
    expect(find.text('Elige el proceso y la máquina donde se consume'), findsOneWidget);
    expect(backend.cuerpos('POST', '/entregas'), isEmpty);

    await elegirEnLista(tester, 'Proceso (obligatorio)', 'Impresión');
    await elegirEnLista(tester, 'Máquina (obligatorio)', 'F4');
    await tocar(tester, find.widgetWithText(FilledButton, 'Registrar'));

    final enviado = backend.cuerpos('POST', '/entregas').single;
    expect(enviado['numero_ot'], '1000');
    expect(enviado['material_id'], 101);
    expect(enviado['proceso_id'], 2);
    expect(enviado['maquina_id'], 21);
    expect(texto('Se creó el pedido de BOPP20560'), findsOneWidget);
  });

  testWidgets('un error del servidor se muestra y la selección queda para reintentar', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    await buscarOt(tester, '1000');
    await tocar(tester, texto('PA15520'));
    await cargarBobinas(tester, ['5']);
    backend.forzarError = 500;
    await tocar(tester, find.widgetWithText(FilledButton, 'Guardar entrega'));
    expect(find.textContaining('No se pudieron registrar: PA15520'), findsOneWidget);
    expect(find.text('Cantidades entregadas'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Guardar entrega'), findsOneWidget);
  });

  testWidgets('OT recientes con entregas pendientes: tocarla la busca', (tester) async {
    await montarApp(tester, BackendFalso());
    expect(find.text('OT recientes con entregas pendientes'), findsOneWidget);
    await tocar(tester, find.text('OT 1000'));
    expect(find.text('Coronilla S.A.'), findsOneWidget);
  });
}
