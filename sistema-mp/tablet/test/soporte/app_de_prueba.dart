import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:zepol_tablet/actualizacion/actualizador.dart';
import 'package:zepol_tablet/estado/sesion.dart';
import 'package:zepol_tablet/main.dart';

import 'backend_falso.dart';

/// Pantalla de la tablet de la planta: 1280×800 px a 215 dpi (~955×597 dp).
void tamanoTablet(WidgetTester tester) {
  tester.view.physicalSize = const Size(1280, 800);
  tester.view.devicePixelRatio = 1.34;
  addTearDown(tester.view.reset);
}

/// Monta la app completa contra [backend]. Con [usuario] arranca ya logueado
/// (como una tablet que ya tenía la sesión guardada); con [servidor] en false
/// arranca en la pantalla de configuración.
Future<Sesion> montarApp(
  WidgetTester tester,
  BackendFalso backend, {
  String? usuario = 'ER',
  bool servidor = true,
  // En la tablet real (prueba de integración) se usa su pantalla tal cual.
  bool forzarTamano = true,
  // Para probar las actualizaciones de la app (null = sin ese mecanismo).
  PlataformaActualizador? plataforma,
}) async {
  if (forzarTamano) tamanoTablet(tester);
  final valores = <String, Object>{};
  if (servidor) valores['zepol.servidor'] = BackendFalso.servidor;
  if (usuario != null) {
    final u = backend.usuarios.firstWhere((x) => x['inicial'] == usuario);
    valores['zepol.sesion'] = jsonEncode({'token': 'tok-$usuario', 'usuario': u});
  }
  SharedPreferences.setMockInitialValues(valores);
  final sesion = Sesion(cliente: backend.cliente, plataforma: plataforma);
  await sesion.cargar();
  await tester.pumpWidget(ChangeNotifierProvider.value(value: sesion, child: const ZepolTablet()));
  await tester.pumpAndSettle();
  return sesion;
}

/// Abre una pantalla del menú lateral.
Future<void> irA(WidgetTester tester, String seccion) async {
  await tester.tap(find.text(seccion).first);
  await tester.pumpAndSettle();
}

/// Escribe en el campo con ese rótulo (labelText o hintText).
Future<void> escribir(WidgetTester tester, String rotulo, String texto) async {
  final campo = find.ancestor(of: find.text(rotulo), matching: find.byType(TextField));
  await tester.enterText(campo.first, texto);
  await tester.pump();
}

/// Busca una OT en la pantalla visible (campo "Número de OT" + botón Buscar).
Future<void> buscarOt(WidgetTester tester, String numero) async {
  await escribir(tester, 'Número de OT', numero);
  // La tecla "buscar" del teclado de la tablet (el campo la tiene como acción).
  await tester.testTextInput.receiveAction(TextInputAction.search);
  await tester.pumpAndSettle();
}

/// Texto que puede estar dentro de un Text.rich.
Finder texto(String parte) => find.textContaining(parte, findRichText: true);

/// Baja (o sube) por la pantalla visible hasta que [f] esté construido y a la
/// vista: las listas largas no construyen lo que queda fuera de pantalla.
Future<void> hastaVer(WidgetTester tester, Finder f) async {
  if (f.evaluate().isNotEmpty) {
    await tester.ensureVisible(f.first);
    await tester.pumpAndSettle();
    return;
  }
  // El 1.º Scrollable es el menú lateral; el 2.º, la pantalla abierta.
  final pantalla = find.byType(Scrollable).at(1);
  for (final delta in [300.0, -300.0]) {
    try {
      await tester.scrollUntilVisible(f, delta, scrollable: pantalla, maxScrolls: 40);
      await tester.pumpAndSettle();
      return;
    } on StateError {
      // No estaba en esa dirección: probar hacia el otro lado.
    }
  }
  throw StateError('No se encontró $f en la pantalla');
}

/// Hace visible y toca.
Future<void> tocar(WidgetTester tester, Finder f) async {
  await hastaVer(tester, f);
  await tester.pumpAndSettle();
  await tester.tap(f.first);
  await tester.pumpAndSettle();
}

/// Abre el buscador de materiales del campo con ese rótulo y elige [codigo]
/// (escribiéndolo en la búsqueda, como haría el operador).
Future<void> elegirMaterial(WidgetTester tester, String rotulo, String codigo) async {
  final campo = find.ancestor(of: find.text(rotulo), matching: find.byType(InkWell)).first;
  await tocar(tester, campo);
  await tester.enterText(find.widgetWithText(TextField, 'Buscar código MP...'), codigo);
  await tester.pumpAndSettle();
  await tester.tap(find.descendant(of: find.byType(ListTile), matching: find.text(codigo)).first);
  await tester.pumpAndSettle();
}

/// Elige [opcion] en el desplegable con ese rótulo (Proceso, Máquina…).
Future<void> elegirEnLista(WidgetTester tester, String rotulo, String opcion) async {
  await tocar(tester, find.ancestor(of: find.text(rotulo), matching: find.byType(InputDecorator)).first);
  await tester.tap(find.text(opcion).last);
  await tester.pumpAndSettle();
}
