// Corre EN LA TABLET contra el backend de la laptop (por `adb reverse tcp:8000
// tcp:8000`, servidor `localhost:8000`), con el disco real de la tablet para la
// copia local. La PC se simula con un segundo cliente sobre el mismo servidor.
//
//   adb reverse tcp:8000 tcp:8000
//   flutter test integration_test/tablet_servidor_real_test.dart -d <id> \
//       --dart-define-from-file=<archivo.json con {"ZEPOL_TOKEN": "..."}>
//
// Crea una OT de uso interno (no toca el Excel) y la borra al terminar.

import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:zepol_tablet/api/api.dart';
import 'package:zepol_tablet/estado/repositorio.dart';

import '../test/soporte/equipo.dart' show ClienteConRed;

const _servidor = 'http://localhost:8000';
const _token = String.fromEnvironment('ZEPOL_TOKEN');

class _Equipo {
  _Equipo(AlmacenLocal? almacen) {
    red = ClienteConRed(http.Client());
    api = Api(_servidor, token: _token, cliente: red, alEscribir: () => unawaited(repo.sincronizar()));
    repo = Repositorio(api: () => api, servidor: () => _servidor, almacen: almacen);
  }
  late final ClienteConRed red;
  late final Api api;
  late final Repositorio repo;

  Future<void> sincronizar() async {
    await repo.sincronizar();
    do {
      await Future<void>.delayed(const Duration(milliseconds: 30));
    } while (repo.sincronizando);
  }
}

Matcher errorApi(String parte) => throwsA(isA<ApiError>().having((e) => e.mensaje, 'mensaje', contains(parte)));

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final bruto = http.Client();
  Future<http.Response> crudo(String metodo, String ruta, [Object? cuerpo]) async {
    final req = http.Request(metodo, Uri.parse('$_servidor$ruta'))
      ..headers.addAll({'Authorization': 'Bearer $_token', 'Content-Type': 'application/json'});
    if (cuerpo != null) req.body = jsonEncode(cuerpo);
    return http.Response.fromStream(await bruto.send(req));
  }

  final numeroOt = 'ZZT${DateTime.now().millisecondsSinceEpoch % 100000}';
  late int pedidoId;
  late _Equipo tablet;
  late _Equipo pc;

  setUpAll(() async {
    tablet = _Equipo(AlmacenArchivos());
    pc = _Equipo(null);
    final r = await crudo('POST', '/ordenes-trabajo/detalle', {
      'numero_ot': numeroOt,
      'cliente': 'PRUEBA TABLET',
      'uso_interno': true,
      'materiales': [
        {'material_id': 3, 'cantidad_requerida': 100},
      ],
    });
    expect(r.statusCode, anyOf(200, 201), reason: r.body);
    final pend = jsonDecode((await crudo('GET', '/ordenes-trabajo/$numeroOt/pendientes')).body) as List;
    final p = await crudo('POST', '/ot-materiales-pendientes/${pend.single['id']}/promover',
        {'proceso_id': 1, 'maquina_id': 1, 'material_id': 3});
    pedidoId = (jsonDecode(p.body) as Map<String, dynamic>)['ot_material_id'] as int;
  });

  tearDownAll(() async {
    final e = jsonDecode((await crudo('GET', '/entregas?numero_ot=$numeroOt')).body) as List;
    for (final x in e) {
      await crudo('POST', '/entregas/${x['id']}/sid/pendiente');
    }
    await crudo('DELETE', '/ordenes-trabajo/$numeroOt');
  });

  testWidgets('86. la tablet alcanza al servidor de la laptop y sincroniza todo (tiempo real en la tablet)', (t) async {
    final reloj = Stopwatch()..start();
    await tablet.sincronizar();
    reloj.stop();
    // ignore: avoid_print
    print('TABLET sincronización completa: ${reloj.elapsedMilliseconds} ms — ${tablet.repo.ordenes.length} OT, '
        '${tablet.repo.entregas.length} entregas, ${tablet.repo.devoluciones.length} devoluciones');
    expect(tablet.repo.errorSincronizacion, isNull);
    expect(tablet.repo.tieneDatos, isTrue);
    expect(tablet.repo.buscarOrdenes(numeroOt).single.cliente, 'PRUEBA TABLET');
  });

  testWidgets('87. la copia queda en el disco de la tablet: una app "reabierta" sin red la tiene', (t) async {
    final reabierta = _Equipo(AlmacenArchivos());
    reabierta.red.conectado = false;
    final reloj = Stopwatch()..start();
    await reabierta.repo.cargarDelDisco();
    reloj.stop();
    // ignore: avoid_print
    print('TABLET leer la copia del disco: ${reloj.elapsedMilliseconds} ms');
    expect(reabierta.repo.tieneDatos, isTrue);
    expect(reabierta.repo.buscarOrdenes(numeroOt), hasLength(1));
    expect(reabierta.repo.ordenes.length, tablet.repo.ordenes.length);
  });

  testWidgets('88. buscar una OT con la copia es instantáneo (sin red)', (t) async {
    tablet.red.conectado = false;
    final reloj = Stopwatch()..start();
    final r = tablet.repo.buscarOrdenes('ZZT');
    final pedidos = tablet.repo.consumoDe(numeroOt);
    reloj.stop();
    tablet.red.conectado = true;
    // ignore: avoid_print
    print('TABLET búsqueda local: ${reloj.elapsedMicroseconds} µs');
    expect(r, isNotEmpty);
    expect(pedidos, hasLength(1));
    expect(reloj.elapsedMilliseconds, lessThan(50));
  });

  testWidgets('89. la tablet registra una entrega y una devolución; la PC las ve', (t) async {
    final e = await tablet.api.registrarEntrega(otMaterialId: pedidoId, fecha: '2026-11-03', bobinas: [12, 8]);
    final d = await tablet.api.registrarDevolucion(otMaterialId: pedidoId, materialId: 3, fecha: '2026-11-03', bobinas: [1]);
    await pc.sincronizar();
    expect(pc.repo.entregasDe(numeroOt).single.id, e.id);
    expect(pc.repo.devolucionesDe(numeroOt).single.id, d.id);
    await tablet.sincronizar();
    expect(tablet.repo.consumoDe(numeroOt).single.totalEntregado, 20);
  });

  testWidgets('90. la PC registra y la tablet lo recibe en su siguiente sincronización', (t) async {
    final e = await pc.api.registrarEntrega(otMaterialId: pedidoId, fecha: '2026-11-03', bobinas: [5]);
    expect(tablet.repo.entregasDe(numeroOt).any((x) => x.id == e.id), isFalse);
    await tablet.sincronizar();
    expect(tablet.repo.entregasDe(numeroOt).any((x) => x.id == e.id), isTrue);
  });

  testWidgets('91. sin wifi: registrar, borrar y devolver fallan con aviso y nada llega al servidor', (t) async {
    final antes = tablet.repo.entregasDe(numeroOt).length;
    final aBorrar = tablet.repo.entregasDe(numeroOt).first;
    tablet.red.conectado = false;
    await expectLater(
        tablet.api.registrarEntrega(otMaterialId: pedidoId, fecha: '2026-11-03', bobinas: [9]), errorApi('No se pudo conectar'));
    await expectLater(tablet.api.eliminarEntrega(aBorrar.id), errorApi('No se pudo conectar'));
    await expectLater(
        tablet.api.registrarDevolucion(otMaterialId: pedidoId, materialId: 3, fecha: '2026-11-03', bobinas: [1]),
        errorApi('No se pudo conectar'));
    tablet.red.conectado = true;
    final enServidor = jsonDecode((await crudo('GET', '/entregas?numero_ot=$numeroOt')).body) as List;
    expect(enServidor, hasLength(antes), reason: 'nada se registró ni se borró mientras no había wifi');
  });

  testWidgets('92. vuelve el wifi: la tablet se pone al día con lo que hizo la PC mientras tanto', (t) async {
    tablet.red.conectado = false;
    final e = await pc.api.registrarEntrega(otMaterialId: pedidoId, fecha: '2026-11-03', bobinas: [3]);
    await tablet.sincronizar();
    expect(tablet.repo.entregasDe(numeroOt).any((x) => x.id == e.id), isFalse);
    expect(tablet.repo.errorSincronizacion, isNotNull);
    tablet.red.conectado = true;
    await tablet.sincronizar();
    expect(tablet.repo.errorSincronizacion, isNull);
    expect(tablet.repo.entregasDe(numeroOt).any((x) => x.id == e.id), isTrue);
  });

  testWidgets('93. SID marcado en la PC: la tablet no puede corregir; al sincronizar lo sabe', (t) async {
    final e = tablet.repo.entregasDe(numeroOt).first;
    expect((await crudo('POST', '/entregas/${e.id}/sid/completado')).statusCode, 200);
    await expectLater(tablet.api.eliminarEntrega(e.id), errorApi('SID'));
    await tablet.sincronizar();
    expect(tablet.repo.entregasDe(numeroOt).firstWhere((x) => x.id == e.id).sidCompletado, isTrue);
    await crudo('POST', '/entregas/${e.id}/sid/pendiente');
  });

  testWidgets('94. la PC elimina la OT: la tablet la deja de ver tras sincronizar', (t) async {
    final entregas = jsonDecode((await crudo('GET', '/entregas?numero_ot=$numeroOt')).body) as List;
    for (final x in entregas) {
      await crudo('POST', '/entregas/${x['id']}/sid/pendiente');
    }
    final r = await crudo('DELETE', '/ordenes-trabajo/$numeroOt');
    expect(r.statusCode, 200, reason: r.body);
    await tablet.sincronizar();
    expect(tablet.repo.buscarOrdenes(numeroOt), isEmpty);
    expect(tablet.repo.consumoDe(numeroOt), isEmpty);
  });
}
