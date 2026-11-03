// Una OT abierta en pantalla se actualiza sola cuando otro equipo la cambia
// (el servidor avisa y la copia de la tablet vuelve a leer esa OT).

import 'package:flutter_test/flutter_test.dart';

import '../soporte/app_de_prueba.dart';
import '../soporte/backend_falso.dart';

void otraEntregaDelPedido10(BackendFalso b) => b.entregas.add({
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

void main() {
  testWidgets('124. Registrar Entrega: la OT abierta suma la entrega que registró otro equipo', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    await buscarOt(tester, '1000');
    expect(texto('BOPP20620 (B)'), findsOneWidget);
    expect(texto('BOPP20620 (C)'), findsNothing);

    otraEntregaDelPedido10(backend);
    await sesion.repo.refrescarOt('1000'); // lo que hace la tablet al recibir el aviso
    await tester.pumpAndSettle();

    expect(texto('BOPP20620 (C)'), findsOneWidget);
  });

  testWidgets('125. Registrar Devolución: la OT abierta suma la entrega que registró otro equipo', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    await irA(tester, 'Registrar Devolución');
    await buscarOt(tester, '1000');
    expect(texto('BOPP20620 (C)'), findsNothing);

    otraEntregaDelPedido10(backend);
    await sesion.repo.refrescarOt('1000');
    await tester.pumpAndSettle();

    expect(texto('BOPP20620 (C)'), findsOneWidget);
  });

  testWidgets('126. Consultar OT: la OT abierta muestra la entrega nueva sin volver a buscar', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    await irA(tester, 'Consultar OT');
    await buscarOt(tester, '1000');
    expect(texto('77 kg'), findsNothing);

    otraEntregaDelPedido10(backend);
    await sesion.repo.refrescarOt('1000');
    await tester.pumpAndSettle();

    expect(texto('77'), findsWidgets);
  });

  testWidgets('127. un aviso de OTRA OT no mueve la pantalla de la que está abierta', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    await buscarOt(tester, '1000');
    final pedidosAntes = backend.peticiones.where((r) => r.url.queryParameters['numero_ot'] == '1000').length;

    await sesion.repo.refrescarOt('2000');
    await tester.pumpAndSettle();

    final despues = backend.peticiones.where((r) => r.url.queryParameters['numero_ot'] == '1000').length;
    expect(despues, pedidosAntes, reason: 'la OT 1000 no se volvió a leer');
    expect(texto('BOPP20620 (B)'), findsOneWidget);
  });
}
