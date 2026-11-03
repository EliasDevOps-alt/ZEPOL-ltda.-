// Consultar OT: cada entrega de un pedido con varias muestra SU propio estado de
// SID (antes solo la primera mostraba el del pedido y las demás parecían pendientes).

import 'package:flutter_test/flutter_test.dart';

import '../soporte/app_de_prueba.dart';
import '../soporte/backend_falso.dart';

void main() {
  testWidgets('238. cada entrega muestra su SID: la A registrada sin fecha (antigua), la B pendiente', (tester) async {
    final backend = BackendFalso();
    backend.entregas.firstWhere((e) => e['id'] == 1)['sid'] = true; // A: marcada antes de guardar la fecha
    await montarApp(tester, backend);
    await irA(tester, 'Consultar OT');
    await buscarOt(tester, '1000');
    expect(texto('SID COMPLETADO · sin fecha guardada'), findsOneWidget);
    expect(texto('SID PENDIENTE'), findsWidgets);
  });

  testWidgets('239. las dos entregas registradas: las dos tarjetas dicen COMPLETADO, cada una con su fecha', (tester) async {
    final backend = BackendFalso();
    backend.entregas.firstWhere((e) => e['id'] == 1)
      ..['sid'] = true
      ..['sid_en'] = '2026-09-28T13:51:48';
    backend.entregas.firstWhere((e) => e['id'] == 2)
      ..['sid'] = true
      ..['sid_en'] = '2026-09-28T13:52:14';
    await montarApp(tester, backend);
    await irA(tester, 'Consultar OT');
    await buscarOt(tester, '1000');
    expect(texto('SID COMPLETADO · 28/09/2026'), findsNWidgets(2));
    expect(texto('SID PENDIENTE'), findsNothing);
  });

  testWidgets('240. un pedido con UNA sola entrega sigue mostrando el SID del pedido', (tester) async {
    final backend = BackendFalso();
    backend.entregas.removeWhere((e) => e['id'] == 2); // el pedido 10 queda con una sola entrega
    await montarApp(tester, backend);
    await irA(tester, 'Consultar OT');
    await buscarOt(tester, '1000');
    expect(texto('SID PENDIENTE'), findsWidgets); // etiqueta "SID <estado del pedido>"
    expect(texto('SID COMPLETADO ·'), findsNothing);
  });
}
