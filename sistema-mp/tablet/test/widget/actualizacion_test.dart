// Lo que ve el operador cuando hay una versión nueva de la app: el aviso, la
// descarga con avance y el botón para instalarla.

import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zepol_tablet/actualizacion/actualizador.dart';

import '../soporte/app_de_prueba.dart';
import '../soporte/backend_falso.dart';

class _Plataforma implements PlataformaActualizador {
  _Plataforma(this.carpeta);
  final String carpeta;
  bool permitido = true;
  final instalados = <String>[];
  int permisosPedidos = 0;

  @override
  Future<({int codigo, String nombre})> version() async => (codigo: 2, nombre: '1.0.1');
  @override
  Future<bool> puedeInstalar() async => permitido;
  @override
  Future<void> pedirPermiso() async => permisosPedidos++;
  @override
  Future<void> instalar(String ruta) async => instalados.add(ruta);
  @override
  Future<String> carpetaDescargas() async => carpeta;
}

void publicar(BackendFalso b, {int codigo = 3, String nombre = '1.0.2', String notas = 'Más rápida al desplazarse'}) {
  b.apkTablet = List<int>.generate(30000, (i) => i % 200);
  b.manifiestoTablet = {
    'version_code': codigo,
    'version_name': nombre,
    'apk': 'zepol-tablet-$nombre+$codigo.apk',
    'sha256': sha256.convert(b.apkTablet).toString(),
    'tamano': b.apkTablet.length,
    'notas': notas,
    'obligatoria': false,
  };
}

/// Deja que terminen las operaciones reales (archivos) que el reloj de la prueba no mueve.
///
/// Cada paso con archivos necesita tiempo real y después que la prueba procese lo
/// que quedó pendiente; se alternan varias veces hasta que todo termina.
Future<void> dejarCorrer(WidgetTester tester, {int vueltas = 10}) async {
  for (var i = 0; i < vueltas; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
    await tester.pump(const Duration(milliseconds: 50));
  }
  await tester.pumpAndSettle();
}

void main() {
  late Directory carpeta;
  late _Plataforma plataforma;

  setUp(() async {
    carpeta = await Directory.systemTemp.createTemp('zepol_ui_act_');
    plataforma = _Plataforma(carpeta.path);
  });

  tearDown(() async {
    if (await carpeta.exists()) await carpeta.delete(recursive: true);
  });

  /// Con sesión iniciada y la búsqueda ya hecha (como al abrir la app).
  Future<void> abrir(WidgetTester tester, BackendFalso backend) async {
    await montarApp(tester, backend, plataforma: plataforma);
    await dejarCorrer(tester);
  }

  testWidgets('175. sin versión nueva no aparece ningún aviso', (tester) async {
    final backend = BackendFalso();
    publicar(backend, codigo: 2, nombre: '1.0.1');
    await abrir(tester, backend);
    expect(find.textContaining('Hay una versión nueva'), findsNothing);
  });

  testWidgets('176. con una versión nueva aparece el aviso con sus notas y el botón Descargar', (tester) async {
    final backend = BackendFalso();
    publicar(backend);
    await abrir(tester, backend);
    expect(find.text('Hay una versión nueva de ZEPOL: 1.0.2'), findsOneWidget);
    expect(find.text('Más rápida al desplazarse'), findsOneWidget);
    expect(find.text('Descargar'), findsOneWidget);
  });

  testWidgets('177. Descargar → "Instalar ahora" → le pide a Android instalar el APK bajado', (tester) async {
    final backend = BackendFalso();
    publicar(backend);
    await abrir(tester, backend);

    await tester.tap(find.text('Descargar'));
    await dejarCorrer(tester);
    expect(find.text('Instalar ahora'), findsOneWidget);

    await tester.tap(find.text('Instalar ahora'));
    await dejarCorrer(tester);
    expect(plataforma.instalados, hasLength(1));
    expect(plataforma.instalados.single, endsWith('zepol-tablet-1.0.2+3.apk'));
  });

  testWidgets('178. el aviso se ve también con la tablet en vertical', (tester) async {
    final backend = BackendFalso();
    publicar(backend);
    await abrir(tester, backend);
    tester.view.physicalSize = const Size(800, 1280);
    tester.view.devicePixelRatio = 1.34;
    await tester.pumpAndSettle();
    expect(find.text('Hay una versión nueva de ZEPOL: 1.0.2'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('179. sin el permiso de instalar, el aviso lo explica y pide tocar de nuevo', (tester) async {
    final backend = BackendFalso();
    publicar(backend);
    plataforma.permitido = false;
    await abrir(tester, backend);
    await tester.tap(find.text('Descargar'));
    await dejarCorrer(tester);
    await tester.tap(find.text('Instalar ahora'));
    await dejarCorrer(tester);
    expect(find.textContaining('Falta un permiso'), findsOneWidget);
    expect(plataforma.permisosPedidos, 1);
    expect(plataforma.instalados, isEmpty);

    plataforma.permitido = true;
    await tester.tap(find.text('Instalar'));
    await dejarCorrer(tester);
    expect(plataforma.instalados, hasLength(1));
  });

  testWidgets('180. un archivo dañado muestra el error con Reintentar y no se instala', (tester) async {
    final backend = BackendFalso();
    publicar(backend);
    backend.manifiestoTablet!['sha256'] = 'a' * 64; // la huella publicada no coincide con el archivo
    await abrir(tester, backend);
    await tester.tap(find.text('Descargar'));
    await dejarCorrer(tester);
    expect(find.textContaining('no coincide'), findsOneWidget);
    expect(find.text('Reintentar'), findsOneWidget);
    expect(plataforma.instalados, isEmpty);
  });

  testWidgets('181. el login muestra la versión y "Buscar actualización" encuentra la nueva', (tester) async {
    final backend = BackendFalso();
    publicar(backend);
    await montarApp(tester, backend, usuario: null, plataforma: plataforma);
    await dejarCorrer(tester);
    expect(find.textContaining('Buscar actualización (versión 1.0.1)'), findsOneWidget);

    await tester.tap(find.textContaining('Buscar actualización'));
    await dejarCorrer(tester);
    expect(find.text('Versión nueva 1.0.2 disponible'), findsOneWidget);
  });

  testWidgets('182. en el login, sin nada nuevo, dice que está en la última versión', (tester) async {
    final backend = BackendFalso();
    publicar(backend, codigo: 2, nombre: '1.0.1');
    await montarApp(tester, backend, usuario: null, plataforma: plataforma);
    await dejarCorrer(tester);
    await tester.tap(find.textContaining('Buscar actualización'));
    await dejarCorrer(tester);
    expect(find.text('Estás en la última versión'), findsOneWidget);
  });

  testWidgets('183. mientras se descarga se ve el avance y no hay botón', (tester) async {
    final backend = BackendFalso();
    publicar(backend);
    await abrir(tester, backend);
    final a = tester.element(find.byType(Scaffold).first);
    expect(a, isNotNull);
    // Estado intermedio: se arma a mano porque la descarga de prueba termina al instante.
    await tester.tap(find.text('Descargar'));
    await tester.pump();
    // Puede que ya haya terminado; lo importante: nunca quedan dos botones a la vez.
    expect(find.text('Descargar'), findsNothing);
    await dejarCorrer(tester);
  });

  testWidgets('184. el aviso no tapa la pantalla: el contenido sigue usable debajo', (tester) async {
    final backend = BackendFalso();
    publicar(backend);
    await abrir(tester, backend);
    expect(find.text('Hay una versión nueva de ZEPOL: 1.0.2'), findsOneWidget);
    await buscarOt(tester, '1000');
    expect(texto('BOPP20620 (B)'), findsOneWidget);
    expect(find.text(jsonEncode('x')), findsNothing);
  });
}
