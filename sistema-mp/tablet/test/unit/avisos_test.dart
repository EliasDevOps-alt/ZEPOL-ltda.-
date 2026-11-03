// Avisos en tiempo real: el servidor dice "cambió la OT X" y la tablet vuelve a
// leer SOLO esa OT (no toda la base) y la cambia en su copia.

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:zepol_tablet/api/api.dart';
import 'package:zepol_tablet/api/modelos.dart';
import 'package:zepol_tablet/estado/repositorio.dart';

import '../soporte/backend_falso.dart';
import '../soporte/equipo.dart';

/// Cliente que deja la respuesta de /entregas (lista completa) "viajando" hasta
/// que se la libera: así llega vieja, como en una red lenta.
class _Lento extends ClienteConRed {
  _Lento(super.interno);
  Completer<void>? retener;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final res = await super.send(request);
    final completa = request.url.path == '/entregas' && !request.url.queryParameters.containsKey('numero_ot');
    if (completa && retener != null) await retener!.future;
    return res;
  }
}

/// Espera (hasta [limite]) a que se cumpla [condicion].
Future<bool> esperar(bool Function() condicion, {Duration limite = const Duration(seconds: 3)}) async {
  final fin = DateTime.now().add(limite);
  while (DateTime.now().isBefore(fin)) {
    if (condicion()) return true;
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  return condicion();
}

void main() {
  late BackendFalso servidor;
  late Equipo pc;
  late Equipo tablet;

  setUp(() async {
    servidor = BackendFalso();
    pc = await Equipo.crear('PC', servidor, usuario: 'BO');
    tablet = await Equipo.crear('Tablet', servidor, usuario: 'ER', automatica: true);
    await tablet.sincronizar();
    tablet.repo.iniciar();
    expect(await esperar(() => servidor.conexionesDeAvisos == 1), isTrue, reason: 'la tablet abrió la conexión de avisos');
  });

  tearDown(() {
    tablet.repo.detener();
  });

  Entrega? entrega(int id) => tablet.repo.entregas.where((x) => x.id == id).firstOrNull;
  // Solo lo que pidió la tablet (la PC también lee cuando registra).
  bool deLaTablet(http.Request r) => r.headers['Authorization'] == 'Bearer tok-ER';
  int lecturas(String ruta, {bool conOt = false}) => servidor.peticiones
      .where((r) =>
          deLaTablet(r) &&
          r.method == 'GET' &&
          r.url.path == ruta &&
          r.url.queryParameters.containsKey('numero_ot') == conOt)
      .length;

  test('102. la tablet se conecta a los avisos al iniciar y manda su sesión', () async {
    expect(servidor.conexionesDeAvisos, 1);
    expect(tablet.repo.avisosConectados || await esperar(() => tablet.repo.avisosConectados), isTrue);
  });

  test('103. aviso de una OT: la tablet ve la entrega nueva sin esperar a la ronda completa', () async {
    final id = await pc.entregar(12, [10]);
    expect(entrega(id), isNull);
    servidor.avisar(['1000']);
    expect(await esperar(() => entrega(id) != null), isTrue);
  });

  test('104. solo se vuelve a leer ESA OT: no se piden las listas completas', () async {
    await Future<void>.delayed(const Duration(milliseconds: 50));
    final completasAntes = lecturas('/entregas') + lecturas('/consumo') + lecturas('/devoluciones');
    final id = await pc.entregar(12, [10]);
    servidor.avisar(['1000']);
    expect(await esperar(() => entrega(id) != null), isTrue);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(lecturas('/entregas') + lecturas('/consumo') + lecturas('/devoluciones'), completasAntes);
    expect(lecturas('/entregas', conOt: true), greaterThan(0));
    final conOt = servidor.peticiones.where((r) => deLaTablet(r) && r.url.queryParameters['numero_ot'] != null);
    expect(conOt.every((r) => r.url.queryParameters['numero_ot'] == '1000'), isTrue);
  });

  test('105. el aviso de borrado hace desaparecer la entrega de la tablet', () async {
    final id = await pc.entregar(12, [10]);
    servidor.avisar(['1000']);
    expect(await esperar(() => entrega(id) != null), isTrue);
    await pc.api.eliminarEntrega(id);
    servidor.avisar(['1000']);
    expect(await esperar(() => entrega(id) == null), isTrue);
  });

  test('106. el aviso de una corrección trae el peso nuevo', () async {
    final id = await pc.entregar(12, [10]);
    servidor.avisar(['1000']);
    await esperar(() => entrega(id) != null);
    await pc.api.editarEntrega(id,
        fecha: '2026-11-03', materialId: 103, bobinas: [3, 4], observacion: null, procesoId: 2, maquinaId: 21);
    servidor.avisar(['1000']);
    expect(await esperar(() => entrega(id)?.bobinas.length == 2), isTrue);
    expect(entrega(id)!.editadoPor, 'BO');
  });

  test('107. el aviso de que la PC marcó el SID bloquea la entrega en la tablet', () async {
    final id = await pc.entregar(12, [10]);
    servidor.avisar(['1000']);
    await esperar(() => entrega(id) != null);
    servidor.entregas.firstWhere((e) => e['id'] == id)['sid'] = true;
    servidor.avisar(['1000']);
    expect(await esperar(() => entrega(id)?.sidCompletado == true), isTrue);
  });

  test('108. una OT nueva (aviso) aparece en la búsqueda de la tablet', () async {
    crearOtEnServidor(servidor, '7777');
    servidor.avisar(['7777']);
    expect(await esperar(() => tablet.repo.buscarOrdenes('7777').isNotEmpty), isTrue);
    expect(tablet.repo.consumoDe('7777'), hasLength(1));
  });

  test('109. una OT eliminada (aviso) desaparece de la tablet', () async {
    crearOtEnServidor(servidor, '7777');
    servidor.avisar(['7777']);
    await esperar(() => tablet.repo.buscarOrdenes('7777').isNotEmpty);
    servidor.ordenes.removeWhere((o) => o['numero_ot'] == '7777');
    servidor.pedidos.removeWhere((p) => p['ot'] == '7777');
    servidor.avisar(['7777']);
    expect(await esperar(() => tablet.repo.buscarOrdenes('7777').isEmpty), isTrue);
    expect(tablet.repo.consumoDe('7777'), isEmpty);
  });

  test('110. el aviso "cambió mucho" (todo) hace una sincronización completa', () async {
    final antes = lecturas('/entregas');
    final id = await pc.entregar(12, [10]);
    servidor.avisar([], todo: true);
    expect(await esperar(() => entrega(id) != null), isTrue);
    expect(lecturas('/entregas'), greaterThan(antes));
  });

  test('111. varios avisos de OT distintas: cada una se lee una sola vez', () async {
    crearOtEnServidor(servidor, '7001', pedidoId: 951);
    crearOtEnServidor(servidor, '7002', pedidoId: 952);
    servidor.avisar(['7001', '7002', '1000']);
    expect(await esperar(() => tablet.repo.buscarOrdenes('700').length == 2), isTrue);
    await Future<void>.delayed(const Duration(milliseconds: 100));
    for (final ot in ['7001', '7002', '1000']) {
      final n = servidor.peticiones
          .where((r) => deLaTablet(r) && r.url.path == '/consumo' && r.url.queryParameters['numero_ot'] == ot)
          .length;
      expect(n, 1, reason: 'OT $ot');
    }
  });

  test('112. cambiosDeOt avisa a las pantallas qué OT cambió', () async {
    final recibidas = <String>[];
    final sub = tablet.repo.cambiosDeOt.listen(recibidas.add);
    servidor.avisar(['1000']);
    expect(await esperar(() => recibidas.contains('1000')), isTrue);
    await sub.cancel();
  });

  test('113. los latidos y los avisos ilegibles se ignoran sin romper la conexión', () async {
    servidor.latido();
    servidor.avisoIlegible();
    final id = await pc.entregar(12, [10]);
    servidor.avisar(['1000']);
    expect(await esperar(() => entrega(id) != null), isTrue);
    expect(servidor.conexionesDeAvisos, 1);
  });

  test('114. si el servidor corta la conexión, la tablet reconecta y se pone al día de lo que se perdió', () async {
    final sinAviso = await pc.entregar(12, [10]); // pasa mientras no hay conexión
    servidor.cortarAvisos();
    expect(await esperar(() => !tablet.repo.avisosConectados), isTrue);
    expect(entrega(sinAviso), isNull);
    // Reconecta (a los ~1 s) y sincroniza todo.
    expect(await esperar(() => entrega(sinAviso) != null, limite: const Duration(seconds: 5)), isTrue);
    expect(servidor.conexionesDeAvisos, 1);
    // Y los avisos vuelven a funcionar.
    final otro = await pc.entregar(12, [2]);
    servidor.avisar(['1000']);
    expect(await esperar(() => entrega(otro) != null), isTrue);
  });

  test('115. la tablet sin wifi no recibe avisos; al volver recoge todo', () async {
    tablet.cortarRed();
    expect(await esperar(() => !tablet.repo.avisosConectados), isTrue);
    final id = await pc.entregar(12, [10]);
    servidor.avisar(['1000']);
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(entrega(id), isNull);
    tablet.devolverRed();
    expect(await esperar(() => entrega(id) != null, limite: const Duration(seconds: 15)), isTrue);
  });

  test('116. un aviso con la tablet sin wifi no rompe nada', () async {
    tablet.cortarRed();
    // Llega un aviso "viejo" justo al cortar: se intenta leer y falla sin excepción.
    tablet.repo.alAviso({'ots': ['1000']});
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(tablet.repo.tieneDatos, isTrue);
    expect(tablet.repo.entregasDe('1000'), isNotEmpty);
  });

  test('117. los materiales pendientes guardados de la OT se actualizan con el aviso', () async {
    await tablet.repo.pendientesDe('1000');
    servidor.pendientes.clear();
    servidor.avisar(['1000']);
    await esperar(() => tablet.repo.pendientesGuardados('1000')?.isEmpty ?? false);
    expect(tablet.repo.pendientesGuardados('1000'), isEmpty);
  });

  test('118. detener (cerrar sesión) cierra la escucha: ya no se atienden avisos', () async {
    tablet.repo.detener();
    servidor.cortarAvisos();
    await Future<void>.delayed(const Duration(milliseconds: 1500));
    expect(servidor.conexionesDeAvisos, 0, reason: 'no vuelve a conectarse');
  });

  test('119. una sesión vencida (401 en los avisos) cierra la sesión de la tablet', () async {
    final vencida = await Equipo.crear('Vencida', servidor, usuario: 'ER', automatica: true);
    await vencida.sincronizar();
    vencida.sesion.token = 'token-roto';
    vencida.repo.iniciar();
    expect(await esperar(() => vencida.sesion.usuario == null), isTrue);
    vencida.repo.detener();
  });

  test('120. un aviso de una OT que no existe en el servidor no rompe la copia', () async {
    servidor.avisar(['NOEXISTE']);
    await Future<void>.delayed(const Duration(milliseconds: 150));
    expect(tablet.repo.tieneDatos, isTrue);
    expect(tablet.repo.buscarOrdenes('1000'), hasLength(1));
  });

  test('121. un cambio en otra OT no toca los datos de la que la tablet tiene abierta', () async {
    crearOtEnServidor(servidor, '7001', pedidoId: 951);
    final antes = tablet.repo.entregasDe('1000').length;
    servidor.avisar(['7001']);
    await esperar(() => tablet.repo.buscarOrdenes('7001').isNotEmpty);
    expect(tablet.repo.entregasDe('1000'), hasLength(antes));
  });

  test('122. la copia por avisos y la ronda completa dan el mismo resultado', () async {
    final id = await pc.entregar(12, [10]);
    servidor.avisar(['1000']);
    await esperar(() => entrega(id) != null);
    final porAviso = tablet.repo.entregasDe('1000').map((e) => '${e.id}:${e.totalEntregado}').toList()..sort();
    await tablet.sincronizar();
    final completa = tablet.repo.entregasDe('1000').map((e) => '${e.id}:${e.totalEntregado}').toList()..sort();
    expect(porAviso, completa);
    final consumo = tablet.repo.consumoDe('1000').map((c) => c.totalEntregado).toList();
    expect(consumo, isNotEmpty);
  });

  test('123. el total entregado del pedido se actualiza por aviso', () async {
    await pc.entregar(12, [20]);
    servidor.avisar(['1000']);
    Consumo p() => tablet.repo.consumo.firstWhere((c) => c.otMaterialId == 12);
    expect(await esperar(() => p().totalEntregado == 20), isTrue);
    expect(p().estadoEntrega, 'PARCIAL');
  });

  test('140. un aviso que llega durante una sincronización completa no se pierde (la ronda vieja no lo pisa)', () async {
    final lento = _Lento(servidor.cliente);
    final repo = Repositorio(
        api: () => Api(BackendFalso.servidor, token: 'tok-ER', cliente: lento), servidor: () => BackendFalso.servidor);
    await repo.sincronizar();

    lento.retener = Completer<void>();
    final ronda = repo.sincronizar(); // la lista de entregas queda "viajando" con datos de ANTES
    await Future<void>.delayed(const Duration(milliseconds: 50));
    final id = await pc.entregar(12, [10]);
    repo.alAviso({'ots': ['1000']}); // el aviso llega mientras la ronda sigue en curso
    expect(await esperar(() => repo.entregas.any((e) => e.id == id)), isTrue);

    // Cambia otra tabla que la ronda lee DESPUÉS: así la ronda reconstruye todas
    // sus listas, incluida la de entregas con los datos viejos que traía.
    servidor.materiales.add({
      'id': 777,
      'codigo_mp': 'NUEVO-MP',
      'descripcion': 'Material nuevo',
      'unidad': 'kg',
      'es_tinta': false,
      'usa_bobinas': true,
    });
    lento.retener!.complete(); // llega la lista vieja de la ronda completa
    await ronda;
    expect(await esperar(() => repo.entregas.any((e) => e.id == id)), isTrue,
        reason: 'la entrega nueva no puede desaparecer por una ronda que leyó antes');
    repo.dispose();
  });
}
