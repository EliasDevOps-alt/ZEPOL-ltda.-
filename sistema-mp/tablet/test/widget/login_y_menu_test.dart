import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../soporte/app_de_prueba.dart';
import '../soporte/backend_falso.dart';

void main() {
  testWidgets('primera vez: pide el servidor, después el login', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend, usuario: null, servidor: false);
    expect(find.text('Dirección del servidor'), findsOneWidget);

    await escribir(tester, 'Servidor', BackendFalso.servidor);
    await tester.tap(find.widgetWithText(FilledButton, 'Guardar'));
    await tester.pumpAndSettle();

    expect(find.text('Control de Materia Prima — Envases Flexibles'), findsOneWidget);
    expect(find.text('Servidor: ${BackendFalso.servidor}'), findsOneWidget);
  });

  testWidgets('un servidor mal escrito no se guarda y se avisa', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend, usuario: null, servidor: false);
    await escribir(tester, 'Servidor', '192.168.0.99:8000');
    await tester.tap(find.widgetWithText(FilledButton, 'Guardar'));
    await tester.pumpAndSettle();
    expect(find.textContaining('No se pudo conectar con el servidor (http://192.168.0.99:8000)'), findsOneWidget);
    expect(find.text('Dirección del servidor'), findsOneWidget);
  });

  testWidgets('clave incorrecta muestra el error; la correcta entra', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend, usuario: null);

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Erasmo').last);
    await tester.pumpAndSettle();

    await escribir(tester, 'Clave', 'mala');
    await tester.tap(find.widgetWithText(FilledButton, 'Ingresar'));
    await tester.pumpAndSettle();
    expect(find.text('Usuario o clave incorrectos'), findsOneWidget);

    await escribir(tester, 'Clave', BackendFalso.clave);
    await tester.tap(find.widgetWithText(FilledButton, 'Ingresar'));
    await tester.pumpAndSettle();
    expect(find.text('Registrar Entrega'), findsWidgets);
    expect(find.text('Erasmo'), findsOneWidget);
  });

  testWidgets('sin elegir usuario no intenta entrar', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend, usuario: null);
    await tester.tap(find.widgetWithText(FilledButton, 'Ingresar'));
    await tester.pumpAndSettle();
    expect(find.text('Selecciona tu usuario'), findsOneWidget);
    expect(backend.peticiones.where((r) => r.url.path == '/auth/login'), isEmpty);
  });

  testWidgets('Erasmo ve sus 4 pantallas; Producto Terminado y Reportes no están', (tester) async {
    await montarApp(tester, BackendFalso());
    for (final s in ['Registrar Entrega', 'Historial de OT', 'Registrar Devolución', 'Consultar OT']) {
      expect(find.text(s), findsWidgets, reason: s);
    }
    expect(find.text('Reportes'), findsNothing);
    expect(find.text('Producto Terminado'), findsNothing);
  });

  testWidgets('un módulo restringido desde la PC no aparece en la tablet', (tester) async {
    await montarApp(tester, BackendFalso(), usuario: 'SD');
    expect(find.text('Registrar Devolución'), findsNothing);
    expect(find.text('Registrar Entrega'), findsWidgets);
  });

  testWidgets('cerrar sesión vuelve al login', (tester) async {
    await montarApp(tester, BackendFalso());
    await tester.tap(find.byTooltip('Cerrar sesión'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, 'Ingresar'), findsOneWidget);
  });

  testWidgets('si el token venció, cualquier pantalla vuelve sola al login', (tester) async {
    final backend = BackendFalso()..forzarError = 401;
    await montarApp(tester, backend);
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, 'Ingresar'), findsOneWidget);
  });
}
