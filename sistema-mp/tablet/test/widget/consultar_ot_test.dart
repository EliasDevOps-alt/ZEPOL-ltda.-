import 'package:flutter_test/flutter_test.dart';

import '../soporte/app_de_prueba.dart';
import '../soporte/backend_falso.dart';

void main() {
  testWidgets('una tarjeta por entrega, con su consumo y lo del pedido en la primera', (tester) async {
    await montarApp(tester, BackendFalso());
    await irA(tester, 'Consultar OT');
    await buscarOt(tester, '1000');

    expect(texto('Coronilla S.A.'), findsOneWidget);
    expect(texto('BOPP20620 (A)'), findsOneWidget);
    expect(texto('BOPP20620 (B)'), findsOneWidget);
    // Entrega A: 100 − 30 devueltos de ella = 70; el pedido entero: 210 − 30 = 180.
    expect(find.text('70 kg'), findsOneWidget);
    expect(find.text('Pedido: 180 kg'), findsOneWidget);
    // Requerido y el estado del pedido solo una vez (en la primera tarjeta).
    expect(find.text('200 kg'), findsOneWidget);
  });

  testWidgets('el ingreso a almacén no se resta del consumo neto', (tester) async {
    await montarApp(tester, BackendFalso());
    await irA(tester, 'Consultar OT');
    await buscarOt(tester, '1000');
    await hastaVer(tester, texto('NORD — LDPE-3'));
    expect(find.text('Ingresó a almacén'), findsWidgets);
    expect(find.text('150 kg'), findsOneWidget);
  });

  testWidgets('OT sin movimientos lo dice', (tester) async {
    await montarApp(tester, BackendFalso());
    await irA(tester, 'Consultar OT');
    await buscarOt(tester, '2000');
    expect(find.text('No hay movimientos para esa OT.'), findsOneWidget);
  });
}
