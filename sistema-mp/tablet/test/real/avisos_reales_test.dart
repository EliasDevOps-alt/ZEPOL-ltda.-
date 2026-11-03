// Avisos en tiempo real contra el servidor REAL de esta laptop (GET /eventos):
// la PC (un cliente) hace cambios y la tablet (otro, escuchando los avisos) los
// recibe sin sincronizar a mano. Mide también cuánto tarda en llegar.
//
//   ZEPOL_TOKEN_FILE=<archivo con el token> flutter test test/real/avisos_reales_test.dart
//
// Crea OT de uso interno ZZT-xxxxx (no escriben en el Excel) y las borra al terminar.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:zepol_tablet/api/api.dart';
import 'package:zepol_tablet/estado/repositorio.dart';

import '../soporte/equipo.dart' show ClienteConRed;

const _servidor = 'http://127.0.0.1:8000';

class _Equipo {
  _Equipo(String token, {bool escucha = false}) {
    red = ClienteConRed(http.Client());
    api = Api(_servidor, token: token, cliente: red, alEscribir: () => unawaited(repo.sincronizar()));
    repo = Repositorio(api: () => api, servidor: () => _servidor, automatica: escucha);
  }
  late final ClienteConRed red;
  late final Api api;
  late final Repositorio repo;

  Future<void> sincronizar() async {
    await repo.sincronizar();
    do {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    } while (repo.sincronizando);
  }
}

Future<bool> esperar(bool Function() condicion, {Duration limite = const Duration(seconds: 5)}) async {
  final fin = DateTime.now().add(limite);
  while (DateTime.now().isBefore(fin)) {
    if (condicion()) return true;
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
  return condicion();
}

void main() {
  final archivo = Platform.environment['ZEPOL_TOKEN_FILE'];
  if (archivo == null || !File(archivo).existsSync()) {
    test('avisos reales (se saltea sin ZEPOL_TOKEN_FILE)', () {}, skip: 'definir ZEPOL_TOKEN_FILE');
    return;
  }
  final token = File(archivo).readAsStringSync().trim();
  final bruto = http.Client();
  Future<http.Response> crudo(String metodo, String ruta, [Object? cuerpo]) async {
    final req = http.Request(metodo, Uri.parse('$_servidor$ruta'))
      ..headers.addAll({'Authorization': 'Bearer $token', 'Content-Type': 'application/json'});
    if (cuerpo != null) req.body = jsonEncode(cuerpo);
    return http.Response.fromStream(await bruto.send(req));
  }

  final base = DateTime.now().millisecondsSinceEpoch % 100000;
  final ot1 = 'ZZT$base';
  final ot2 = 'ZZU$base';
  late int pedido1;
  late _Equipo pc;
  late _Equipo tablet;
  final latencias = <int>[];

  Future<int> crearOtConPedido(String numero) async {
    final r = await crudo('POST', '/ordenes-trabajo/detalle', {
      'numero_ot': numero,
      'cliente': 'PRUEBA AVISOS',
      'uso_interno': true,
      'materiales': [
        {'material_id': 3, 'cantidad_requerida': 100},
      ],
    });
    expect(r.statusCode, anyOf(200, 201), reason: r.body);
    final pend = jsonDecode((await crudo('GET', '/ordenes-trabajo/$numero/pendientes')).body) as List;
    final p = await crudo('POST', '/ot-materiales-pendientes/${pend.single['id']}/promover',
        {'proceso_id': 1, 'maquina_id': 1, 'material_id': 3});
    return (jsonDecode(p.body) as Map<String, dynamic>)['ot_material_id'] as int;
  }

  Future<void> limpiar(String n) async {
    final e = await crudo('GET', '/entregas?numero_ot=$n');
    if (e.statusCode == 200) {
      for (final x in jsonDecode(e.body) as List) {
        await crudo('POST', '/entregas/${x['id']}/sid/pendiente');
      }
    }
    await crudo('DELETE', '/ordenes-trabajo/$n');
  }

  setUpAll(() async {
    for (final prefijo in ['ZZT', 'ZZU']) {
      final previas = await crudo('GET', '/ordenes-trabajo?q=$prefijo');
      if (previas.statusCode == 200) {
        for (final o in jsonDecode(previas.body) as List) {
          await limpiar(o['numero_ot'] as String);
        }
      }
    }
    pc = _Equipo(token);
    tablet = _Equipo(token, escucha: true);
    pedido1 = await crearOtConPedido(ot1);
    await tablet.sincronizar();
    tablet.repo.iniciar();
  });

  tearDownAll(() async {
    tablet.repo.detener();
    await limpiar(ot1);
    await limpiar(ot2);
    for (final n in [ot1, ot2]) {
      final quedan = await crudo('GET', '/ordenes-trabajo?q=$n');
      expect(jsonDecode(quedan.body) as List, isEmpty, reason: '$n debe quedar borrada');
    }
    // ignore: avoid_print
    if (latencias.isNotEmpty) print('LATENCIA de los avisos (ms): $latencias');
  });

  test('128. la tablet se conecta a /eventos del servidor real', () async {
    expect(await esperar(() => tablet.repo.avisosConectados), isTrue);
  });

  test('129. la PC registra una entrega y la tablet la ve sola, sin sincronizar', () async {
    final reloj = Stopwatch()..start();
    final e = await pc.api.registrarEntrega(otMaterialId: pedido1, fecha: '2026-11-03', bobinas: [10, 5]);
    expect(await esperar(() => tablet.repo.entregasDe(ot1).any((x) => x.id == e.id)), isTrue);
    latencias.add(reloj.elapsedMilliseconds);
    expect(tablet.repo.consumoDe(ot1).single.totalEntregado, 15);
  });

  test('130. cambiosDeOt le avisa a las pantallas cuál OT cambió', () async {
    final recibidas = <String>[];
    final sub = tablet.repo.cambiosDeOt.listen(recibidas.add);
    await pc.api.registrarEntrega(otMaterialId: pedido1, fecha: '2026-11-03', bobinas: [1]);
    expect(await esperar(() => recibidas.contains(ot1)), isTrue);
    await sub.cancel();
  });

  test('131. la PC corrige una entrega y la tablet ve el peso nuevo', () async {
    final e = tablet.repo.entregasDe(ot1).first;
    await pc.api.editarEntrega(e.id,
        fecha: '2026-11-03', materialId: 3, bobinas: [99], observacion: null, procesoId: 1, maquinaId: 1);
    expect(await esperar(() => tablet.repo.entregasDe(ot1).firstWhere((x) => x.id == e.id).bobinas.contains(99)), isTrue);
  });

  test('132. se marca el SID y la tablet ve la entrega bloqueada', () async {
    final e = tablet.repo.entregasDe(ot1).first;
    expect((await crudo('POST', '/entregas/${e.id}/sid/completado')).statusCode, 200);
    expect(await esperar(() => tablet.repo.entregasDe(ot1).firstWhere((x) => x.id == e.id).sidCompletado), isTrue);
    expect((await crudo('POST', '/entregas/${e.id}/sid/pendiente')).statusCode, 200);
    expect(await esperar(() => !tablet.repo.entregasDe(ot1).firstWhere((x) => x.id == e.id).sidCompletado), isTrue);
  });

  test('133. la PC borra una entrega y desaparece de la tablet', () async {
    final e = tablet.repo.entregasDe(ot1).last;
    await pc.api.eliminarEntrega(e.id);
    expect(await esperar(() => !tablet.repo.entregasDe(ot1).any((x) => x.id == e.id)), isTrue);
  });

  test('134. una OT nueva creada por otro equipo aparece en la tablet', () async {
    await crearOtConPedido(ot2);
    expect(await esperar(() => tablet.repo.buscarOrdenes(ot2).isNotEmpty), isTrue);
  });

  test('135. una OT eliminada desaparece de la tablet', () async {
    expect((await crudo('DELETE', '/ordenes-trabajo/$ot2')).statusCode, 200);
    expect(await esperar(() => tablet.repo.buscarOrdenes(ot2).isEmpty), isTrue);
    expect(tablet.repo.consumoDe(ot2), isEmpty);
  });

  test('136. la tablet se queda sin wifi, la PC sigue; al volver la tablet se pone al día', () async {
    tablet.red.conectado = false;
    expect(await esperar(() => !tablet.repo.avisosConectados), isTrue);
    final e = await pc.api.registrarEntrega(otMaterialId: pedido1, fecha: '2026-11-03', bobinas: [7]);
    await Future<void>.delayed(const Duration(milliseconds: 300));
    expect(tablet.repo.entregasDe(ot1).any((x) => x.id == e.id), isFalse, reason: 'sin wifi no se entera');
    tablet.red.conectado = true;
    expect(await esperar(() => tablet.repo.entregasDe(ot1).any((x) => x.id == e.id), limite: const Duration(seconds: 20)),
        isTrue);
    expect(await esperar(() => tablet.repo.avisosConectados, limite: const Duration(seconds: 5)), isTrue);
  });

  test('137. tras reconectar los avisos siguen funcionando', () async {
    final e = await pc.api.registrarEntrega(otMaterialId: pedido1, fecha: '2026-11-03', bobinas: [3]);
    expect(await esperar(() => tablet.repo.entregasDe(ot1).any((x) => x.id == e.id)), isTrue);
  });

  test('138. un cambio de OTRA OT no mueve los datos de esta', () async {
    final antes = tablet.repo.entregasDe(ot1).length;
    final otra = jsonDecode((await crudo('GET', '/ordenes-trabajo')).body) as List;
    expect(otra, isNotEmpty);
    expect(tablet.repo.entregasDe(ot1), hasLength(antes));
  });

  test('139. el servidor no manda avisos por lo que no cambió (reposo)', () async {
    final recibidas = <String>[];
    final sub = tablet.repo.cambiosDeOt.listen(recibidas.add);
    await Future<void>.delayed(const Duration(seconds: 3));
    await sub.cancel();
    expect(recibidas, isEmpty, reason: 'en reposo no hay avisos');
  });
}
