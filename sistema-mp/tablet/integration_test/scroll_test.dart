// Mide el desplazamiento de Historial de OT en la tablet real con MUCHAS OT
// (como la base de la planta), para encontrar dónde se traba el scroll.
//
//   flutter test integration_test/scroll_test.dart -d <id> --profile
//
// Imprime cuántos cuadros tardaron más de 16 ms y el peor. En --profile los
// números son los reales; en debug salen inflados.

import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import '../test/soporte/app_de_prueba.dart';
import '../test/soporte/backend_falso.dart';

void cargarMuchasOt(BackendFalso b, int cantidad) {
  var idPedido = 500, idEntrega = 5000, idDev = 3000;
  for (var i = 0; i < cantidad; i++) {
    final n = '${220000 + i}';
    b.ordenes.add({
      'id': 100 + i,
      'numero_ot': n,
      'cliente': 'Cliente número $i S.A.',
      'diseno': 'Diseño $i',
      'descripcion_producto': 'Producto $i',
      'fecha_creacion': '2026-10-${(i % 28 + 1).toString().padLeft(2, '0')}T09:00:00',
    });
    for (var k = 0; k < 3; k++) {
      final pedido = idPedido++;
      b.pedidos.add({
        'id': pedido,
        'ot': n,
        'material_id': 100 + k,
        'proceso_id': 1,
        'maquina_id': 11,
        'requerido': 200.0,
        'insumo_de': null
      });
      for (var e = 0; e < 3; e++) {
        b.entregas.add({
          'id': idEntrega++,
          'pedido': pedido,
          'material_id': 100 + k,
          'fecha': '2026-10-${(i % 28 + 1).toString().padLeft(2, '0')}',
          'hora': '1$e:00:00',
          'bobinas': [10.5, 20.25, 30.0, 40.0],
          'usuario': 'ER',
          'proceso_id': null,
          'maquina_id': null,
          'observacion': null,
          'sid': false,
          'editado_por': null,
          'editado_en': null,
        });
      }
      b.devoluciones.add({
        'id': idDev++,
        'pedido': pedido,
        'pendiente': null,
        'material_id': 100 + k,
        'fecha': '2026-10-${(i % 28 + 1).toString().padLeft(2, '0')}',
        'hora': '17:00:00',
        'bobinas': [5.0],
        'entrega_id': null,
        'ingreso': false,
        'sid': false,
        'usuario': 'ER',
        'editado_por': null,
        'editado_en': null,
      });
    }
  }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('scroll de Historial con 150 OT', (tester) async {
    tester.testTextInput.register();
    final backend = BackendFalso();
    cargarMuchasOt(backend, 150);
    await montarApp(tester, backend, forzarTamano: false);
    await irA(tester, 'Historial de OT');
    await tester.tap(find.text('Todos').first);
    await tester.pumpAndSettle();

    final tiempos = <FrameTiming>[];
    void alMedir(List<FrameTiming> t) => tiempos.addAll(t);
    SchedulerBinding.instance.addTimingsCallback(alMedir);

    final lista = find.byType(Scrollable).at(1);
    final reloj = Stopwatch()..start();
    for (var i = 0; i < 6; i++) {
      await tester.fling(lista, const Offset(0, -900), 2500);
      await tester.pumpAndSettle();
    }
    reloj.stop();
    await tester.pump(const Duration(seconds: 1));
    SchedulerBinding.instance.removeTimingsCallback(alMedir);

    int ms(Duration d) => d.inMilliseconds;
    final construccion = tiempos.map((t) => ms(t.buildDuration)).toList()..sort();
    final raster = tiempos.map((t) => ms(t.rasterDuration)).toList()..sort();
    final lentos = tiempos.where((t) => ms(t.totalSpan) > 16).length;
    // ignore: avoid_print
    print('RESULTADO cuadros=${tiempos.length} lentos(>16ms)=$lentos '
        'build_peor=${construccion.isEmpty ? 0 : construccion.last}ms '
        'raster_peor=${raster.isEmpty ? 0 : raster.last}ms '
        'build_p90=${construccion.isEmpty ? 0 : construccion[(construccion.length * 0.9).floor()]}ms');
    final peores = [...tiempos]..sort((a, b) => b.totalSpan.compareTo(a.totalSpan));
    for (final t in peores.take(6)) {
      // ignore: avoid_print
      print('PEOR total=${ms(t.totalSpan)}ms build=${ms(t.buildDuration)}ms raster=${ms(t.rasterDuration)}ms');
    }
    // ignore: avoid_print
    print('LENTOS build>16=${tiempos.where((t) => ms(t.buildDuration) > 16).length} '
        'raster>16=${tiempos.where((t) => ms(t.rasterDuration) > 16).length} '
        'suma_build=${tiempos.fold<int>(0, (a, t) => a + ms(t.buildDuration))}ms '
        'suma_raster=${tiempos.fold<int>(0, (a, t) => a + ms(t.rasterDuration))}ms');
    // ignore: avoid_print
    print('LENTOS>32ms=${tiempos.where((t) => ms(t.totalSpan) > 32).length}');
    binding.reportData = {'cuadros': tiempos.length, 'lentos': lentos};
  });
}
