// Lo que ve el operador cuando se cae o vuelve la conexión con el servidor
// (barra roja y verde) y al entrar sin conexión desde la pantalla de login.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zepol_tablet/tema.dart';

import '../soporte/app_de_prueba.dart';
import '../soporte/backend_falso.dart';

/// El color de fondo de la barra que contiene ese texto.
Color? colorDeLaBarra(WidgetTester tester, String texto) {
  final material = find.ancestor(of: find.textContaining(texto, findRichText: true), matching: find.byType(Material)).first;
  return tester.widget<Material>(material).color;
}

/// Hace una consulta al servidor desde la tablet (la que dispara la barra).
Future<void> consultar(WidgetTester tester, dynamic sesion) async {
  try {
    await sesion.api.listarProcesos();
  } catch (_) {}
  await tester.pump();
}

void main() {
  testWidgets('223. con conexión normal no hay ninguna barra', (tester) async {
    final backend = BackendFalso();
    await montarApp(tester, backend);
    expect(find.textContaining('Sin conexión al servidor'), findsNothing);
    expect(find.textContaining('Conexión establecida'), findsNothing);
  });

  testWidgets('224. al cortarse la conexión sale la barra ROJA "Sin conexión al servidor"', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    backend.sinRed = true;
    await consultar(tester, sesion);
    expect(find.textContaining('Sin conexión al servidor', findRichText: true), findsOneWidget);
    expect(colorDeLaBarra(tester, 'Sin conexión al servidor'), Colores.peligro);
  });

  testWidgets('225. la barra roja explica que lo que se registre no se guarda hasta que vuelva', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    backend.sinRed = true;
    await consultar(tester, sesion);
    expect(find.textContaining('no se guarda hasta que vuelva la conexión', findRichText: true), findsOneWidget);
  });

  testWidgets('226. la barra roja se queda mientras no vuelva la conexión', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    backend.sinRed = true;
    await consultar(tester, sesion);
    await tester.pump(const Duration(seconds: 30));
    expect(find.textContaining('Sin conexión al servidor', findRichText: true), findsOneWidget);
  });

  testWidgets('227. al volver la conexión sale la barra VERDE "Conexión establecida hacia el servidor"', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    backend.sinRed = true;
    await consultar(tester, sesion);
    backend.sinRed = false;
    await consultar(tester, sesion);
    expect(find.textContaining('Sin conexión al servidor', findRichText: true), findsNothing);
    expect(find.textContaining('Conexión establecida hacia el servidor', findRichText: true), findsOneWidget);
    expect(colorDeLaBarra(tester, 'Conexión establecida'), Colores.exito);
    await tester.pump(const Duration(seconds: 5)); // deja correr el reloj de la barra
  });

  testWidgets('228. la barra verde desaparece sola a los pocos segundos', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    backend.sinRed = true;
    await consultar(tester, sesion);
    backend.sinRed = false;
    await consultar(tester, sesion);
    expect(find.textContaining('Conexión establecida', findRichText: true), findsOneWidget);
    await tester.pump(const Duration(seconds: 5));
    expect(find.textContaining('Conexión establecida', findRichText: true), findsNothing);
  });

  testWidgets('229. si se vuelve a caer mientras estaba el verde, manda el rojo', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    backend.sinRed = true;
    await consultar(tester, sesion);
    backend.sinRed = false;
    await consultar(tester, sesion);
    backend.sinRed = true;
    await consultar(tester, sesion);
    expect(find.textContaining('Conexión establecida', findRichText: true), findsNothing);
    expect(find.textContaining('Sin conexión al servidor', findRichText: true), findsOneWidget);
  });

  testWidgets('230. cada corte y vuelta repite el ciclo rojo → verde', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    for (var i = 0; i < 3; i++) {
      backend.sinRed = true;
      await consultar(tester, sesion);
      expect(find.textContaining('Sin conexión al servidor', findRichText: true), findsOneWidget, reason: 'ciclo $i');
      backend.sinRed = false;
      await consultar(tester, sesion);
      expect(find.textContaining('Conexión establecida', findRichText: true), findsOneWidget, reason: 'ciclo $i');
      await tester.pump(const Duration(seconds: 5));
    }
  });

  testWidgets('231. un error del servidor (500) no es "sin conexión": el servidor contestó', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    backend.forzarError = 500;
    await consultar(tester, sesion);
    expect(find.textContaining('Sin conexión al servidor', findRichText: true), findsNothing);
  });

  testWidgets('232. la barra roja también se ve en la pantalla de login', (tester) async {
    final backend = BackendFalso();
    backend.sinRed = true;
    await montarApp(tester, backend, usuario: null);
    await tester.pump(const Duration(seconds: 5));
    expect(find.textContaining('Sin conexión al servidor', findRichText: true), findsOneWidget);
  });

  testWidgets('233. en vertical la barra también se ve y no desborda', (tester) async {
    final backend = BackendFalso();
    final sesion = await montarApp(tester, backend);
    tester.view.physicalSize = const Size(800, 1280);
    tester.view.devicePixelRatio = 1.34;
    backend.sinRed = true;
    await consultar(tester, sesion);
    expect(find.textContaining('Sin conexión al servidor', findRichText: true), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  group('iniciar sesión desde la pantalla, sin conexión', () {
    Future<void> elegirUsuario(WidgetTester tester, String nombre) async {
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text(nombre).last);
      await tester.pumpAndSettle();
    }

    testWidgets('234. sin conexión se listan los usuarios guardados y se entra con la clave', (tester) async {
      final backend = BackendFalso();
      await montarApp(tester, backend, usuario: null, guardado: usuariosParaEntrarSinConexion(backend));
      backend.sinRed = true;
      await tester.pumpAndSettle(const Duration(seconds: 5));
      // Sin conexión y sin lista de usuarios cacheada del selector: salen los guardados para entrar.
      await elegirUsuario(tester, 'Erasmo');
      await escribir(tester, 'Clave', BackendFalso.clave);
      await tester.tap(find.widgetWithText(FilledButton, 'Ingresar'));
      await tester.pumpAndSettle();
      expect(find.text('Historial de OT'), findsOneWidget, reason: 'entró a la app');
      expect(find.textContaining('Sin conexión al servidor', findRichText: true), findsOneWidget);
    });

    testWidgets('235. con una clave mala se queda en el login y lo dice', (tester) async {
      final backend = BackendFalso();
      await montarApp(tester, backend, usuario: null, guardado: usuariosParaEntrarSinConexion(backend));
      backend.sinRed = true;
      await tester.pumpAndSettle(const Duration(seconds: 5));
      await elegirUsuario(tester, 'Erasmo');
      await escribir(tester, 'Clave', 'mala');
      await tester.tap(find.widgetWithText(FilledButton, 'Ingresar'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Clave incorrecta'), findsOneWidget);
      expect(find.text('Historial de OT'), findsNothing);
    });

    testWidgets('236. sin usuarios guardados y sin conexión explica qué hacer', (tester) async {
      final backend = BackendFalso();
      backend.sinRed = true; // nunca hubo conexión: no hay lista ni usuarios guardados
      await montarApp(tester, backend, usuario: null);
      await tester.pump(const Duration(seconds: 5));
      expect(find.textContaining('No se pudo cargar la lista de usuarios'), findsOneWidget);
    });

    testWidgets('237. entrando sin conexión, al volver el servidor sigue adentro y sale el verde', (tester) async {
      final backend = BackendFalso();
      final sesion = await montarApp(tester, backend, usuario: null, guardado: usuariosParaEntrarSinConexion(backend));
      backend.sinRed = true;
      await tester.pumpAndSettle(const Duration(seconds: 5));
      await elegirUsuario(tester, 'Erasmo');
      await escribir(tester, 'Clave', BackendFalso.clave);
      await tester.tap(find.widgetWithText(FilledButton, 'Ingresar'));
      await tester.pumpAndSettle();
      expect(sesion.sinSesionRemota, isTrue);

      backend.sinRed = false;
      await consultar(tester, sesion); // vuelve el servidor
      await tester.pumpAndSettle();
      expect(sesion.sinSesionRemota, isFalse, reason: 'la sesión pasó a ser una sesión normal');
      expect(find.textContaining('Conexión establecida', findRichText: true), findsOneWidget);
      expect(find.text('Historial de OT'), findsOneWidget);
      await tester.pump(const Duration(seconds: 5));
    });
  });
}
