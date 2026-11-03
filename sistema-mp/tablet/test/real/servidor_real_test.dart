// PC y tablet contra el servidor REAL (el backend de esta laptop, con su base).
//
//   1. generar un token temporal de administrador (nunca se imprime) y guardarlo
//      en un archivo; 2. correr con la ruta del archivo:
//
//   ZEPOL_TOKEN_FILE=<archivo> flutter test test/real/servidor_real_test.dart
//
// Sin ZEPOL_TOKEN_FILE las pruebas se saltean (no corren en un `flutter test` común).
//
// Todo lo que crean lo borran al terminar: una OT de uso interno (uso_interno=true:
// NO se escribe en el Excel OC-MP) con número ZZT-xxxxx, sus entregas y devoluciones.
// Cualquier OT ZZT que quedara de una corrida cortada se limpia al empezar.

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
  _Equipo(this.nombre, String token) {
    red = ClienteConRed(http.Client());
    api = Api(_servidor, token: token, cliente: red, alEscribir: () => unawaited(repo.sincronizar()));
    repo = Repositorio(api: () => api, servidor: () => _servidor);
  }
  final String nombre;
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

Matcher errorApi(String parte) => throwsA(isA<ApiError>().having((e) => e.mensaje, 'mensaje', contains(parte)));

void main() {
  final archivo = Platform.environment['ZEPOL_TOKEN_FILE'];
  final hay = archivo != null && File(archivo).existsSync();
  if (!hay) {
    test('servidor real (se saltea sin ZEPOL_TOKEN_FILE)', () {}, skip: 'definir ZEPOL_TOKEN_FILE');
    return;
  }
  final token = File(archivo).readAsStringSync().trim();
  final bruto = http.Client();
  Map<String, String> cab() => {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'};

  Future<http.Response> crudo(String metodo, String ruta, [Object? cuerpo]) async {
    final req = http.Request(metodo, Uri.parse('$_servidor$ruta'))..headers.addAll(cab());
    if (cuerpo != null) req.body = jsonEncode(cuerpo);
    return http.Response.fromStream(await bruto.send(req));
  }

  late _Equipo pc;
  late _Equipo tablet;
  final numeroOt = 'ZZT${DateTime.now().millisecondsSinceEpoch % 100000}';
  late int pedidoId; // pedido real (OtMaterial) de la OT de prueba
  const materialId = 3; // LDPE-3, con bobinas
  const procesoId = 1; // Impresión
  const maquinaId = 1; // F4

  Future<void> limpiarOt(String n) async {
    final r = await crudo('GET', '/entregas?numero_ot=$n');
    if (r.statusCode == 200) {
      for (final e in jsonDecode(r.body) as List) {
        await crudo('POST', '/entregas/${e['id']}/sid/pendiente');
      }
    }
    final d = await crudo('GET', '/devoluciones?numero_ot=$n');
    if (d.statusCode == 200) {
      for (final e in jsonDecode(d.body) as List) {
        await crudo('POST', '/devoluciones/${e['id']}/sid/pendiente');
      }
    }
    await crudo('DELETE', '/ordenes-trabajo/$n');
  }

  setUpAll(() async {
    pc = _Equipo('PC', token);
    tablet = _Equipo('Tablet', token);
    // Restos de una corrida anterior cortada.
    final previas = await crudo('GET', '/ordenes-trabajo?q=ZZT');
    if (previas.statusCode == 200) {
      for (final o in jsonDecode(previas.body) as List) {
        await limpiarOt(o['numero_ot'] as String);
      }
    }
  });

  tearDownAll(() async {
    await limpiarOt(numeroOt);
    final quedan = await crudo('GET', '/ordenes-trabajo?q=$numeroOt');
    expect((jsonDecode(quedan.body) as List), isEmpty, reason: 'la OT de prueba debe quedar borrada');
  });

  test('70. el servidor local responde y el token sirve', () async {
    expect((await http.get(Uri.parse('$_servidor/health'))).statusCode, 200);
    expect((await crudo('GET', '/catalogos/procesos')).statusCode, 200);
  });

  test('71. se crea una OT de uso interno (sin tocar el Excel) con un material', () async {
    final r = await crudo('POST', '/ordenes-trabajo/detalle', {
      'numero_ot': numeroOt,
      'cliente': 'PRUEBA SINCRONIZACION',
      'uso_interno': true,
      'materiales': [
        {'material_id': materialId, 'cantidad_requerida': 100},
      ],
    });
    expect(r.statusCode, anyOf(200, 201), reason: r.body);
    final cuerpo = jsonDecode(r.body) as Map<String, dynamic>;
    expect(cuerpo['uso_interno'], true);
    expect(cuerpo['sincronizado_excel'], true, reason: 'uso interno no escribe en el Excel');
  });

  test('72. la tablet ve la OT nueva al sincronizar', () async {
    await tablet.sincronizar();
    expect(tablet.repo.tieneDatos, isTrue);
    expect(tablet.repo.buscarOrdenes(numeroOt).single.cliente, 'PRUEBA SINCRONIZACION');
  });

  test('73. el material pendiente se asigna a un proceso y máquina: nace el pedido', () async {
    final pend = jsonDecode((await crudo('GET', '/ordenes-trabajo/$numeroOt/pendientes')).body) as List;
    expect(pend, hasLength(1));
    final r = await crudo('POST', '/ot-materiales-pendientes/${pend.single['id']}/promover',
        {'proceso_id': procesoId, 'maquina_id': maquinaId, 'material_id': materialId});
    expect(r.statusCode, 200, reason: r.body);
    pedidoId = (jsonDecode(r.body) as Map<String, dynamic>)['ot_material_id'] as int;
    await tablet.sincronizar();
    expect(tablet.repo.consumoDe(numeroOt).single.otMaterialId, pedidoId);
  });

  test('74. la PC registra una entrega y la tablet la ve (totales y estado incluidos)', () async {
    final e = await pc.api.registrarEntrega(otMaterialId: pedidoId, fecha: '2026-11-03', bobinas: [10, 5.5]);
    await tablet.sincronizar();
    expect(tablet.repo.entregasDe(numeroOt).single.id, e.id);
    final pedido = tablet.repo.consumoDe(numeroOt).single;
    expect(pedido.totalEntregado, 15.5);
    expect(pedido.estadoEntrega, 'PARCIAL');
  });

  test('75. la tablet registra una devolución y la PC la ve', () async {
    final d = await tablet.api.registrarDevolucion(
        otMaterialId: pedidoId, materialId: materialId, fecha: '2026-11-03', bobinas: [2]);
    await pc.sincronizar();
    expect(pc.repo.devolucionesDe(numeroOt).single.id, d.id);
    expect(pc.repo.consumoDe(numeroOt).single.totalDevuelto, 2);
  });

  test('76. la PC corrige una entrega y la tablet ve el peso nuevo y quién la corrigió', () async {
    final e = pc.repo.entregasDe(numeroOt).single;
    await pc.api.editarEntrega(e.id,
        fecha: '2026-11-03', materialId: materialId, bobinas: [20], observacion: 'corregida', procesoId: procesoId, maquinaId: maquinaId);
    await tablet.sincronizar();
    final visto = tablet.repo.entregasDe(numeroOt).single;
    expect(visto.bobinas, [20]);
    expect(visto.editadoPor, isNotNull);
  });

  test('77. las dos registran a la vez en la MISMA OT: se guardan las dos', () async {
    final antes = pc.repo.entregasDe(numeroOt).length;
    await Future.wait([
      pc.api.registrarEntrega(otMaterialId: pedidoId, fecha: '2026-11-03', bobinas: [1]),
      tablet.api.registrarEntrega(otMaterialId: pedidoId, fecha: '2026-11-03', bobinas: [2]),
    ]);
    await pc.sincronizar();
    await tablet.sincronizar();
    expect(pc.repo.entregasDe(numeroOt), hasLength(antes + 2));
    expect(tablet.repo.entregasDe(numeroOt), hasLength(antes + 2));
    expect(pc.repo.consumoDe(numeroOt).single.totalEntregado, tablet.repo.consumoDe(numeroOt).single.totalEntregado);
  });

  test('78. SID registrado por la PC: el servidor real rechaza corregir y borrar desde la tablet', () async {
    final e = tablet.repo.entregasDe(numeroOt).first;
    expect((await crudo('POST', '/entregas/${e.id}/sid/completado')).statusCode, 200);
    // La tablet todavía no lo sabe (copia vieja): el servidor manda.
    expect(tablet.repo.entregasDe(numeroOt).firstWhere((x) => x.id == e.id).sidCompletado, isFalse);
    await expectLater(
        tablet.api.editarEntrega(e.id,
            fecha: '2026-11-03', materialId: materialId, bobinas: [99], observacion: null, procesoId: procesoId, maquinaId: maquinaId),
        errorApi('SID'));
    await expectLater(tablet.api.eliminarEntrega(e.id), errorApi('SID'));
    await tablet.sincronizar();
    expect(tablet.repo.entregasDe(numeroOt).firstWhere((x) => x.id == e.id).sidCompletado, isTrue);
  });

  test('79. la OT con SID registrado no se puede eliminar', () async {
    final r = await crudo('DELETE', '/ordenes-trabajo/$numeroOt');
    expect(r.statusCode, 400);
    expect(r.body, contains('SID'));
  });

  test('80. la tablet SIN WIFI intenta borrar: falla, y nada cambia en el servidor', () async {
    final e = tablet.repo.entregasDe(numeroOt).last;
    tablet.red.conectado = false;
    await expectLater(tablet.api.eliminarEntrega(e.id), errorApi('No se pudo conectar'));
    tablet.red.conectado = true;
    final en = jsonDecode((await crudo('GET', '/entregas?numero_ot=$numeroOt')).body) as List;
    expect(en.any((x) => x['id'] == e.id), isTrue);
  });

  test('81. mientras la tablet no tiene wifi la PC borra; al volver, la tablet se pone al día', () async {
    final e = tablet.repo.entregasDe(numeroOt).last;
    tablet.red.conectado = false;
    await pc.api.eliminarEntrega(e.id);
    await tablet.sincronizar();
    expect(tablet.repo.entregasDe(numeroOt).any((x) => x.id == e.id), isTrue, reason: 'sin wifi ve lo último que supo');
    tablet.red.conectado = true;
    await tablet.sincronizar();
    expect(tablet.repo.entregasDe(numeroOt).any((x) => x.id == e.id), isFalse);
  });

  test('82. la tablet borra lo que la PC ya borró: aviso claro, sin romper nada', () async {
    final e = await pc.api.registrarEntrega(otMaterialId: pedidoId, fecha: '2026-11-03', bobinas: [3]);
    await tablet.sincronizar();
    await pc.api.eliminarEntrega(e.id);
    await expectLater(tablet.api.eliminarEntrega(e.id), errorApi('no encontrada'));
    await tablet.sincronizar();
    expect(tablet.repo.entregasDe(numeroOt).any((x) => x.id == e.id), isFalse);
  });

  test('83. desmarcado el SID, la tablet vuelve a poder borrar; todo se limpia y la OT se elimina', () async {
    for (final e in tablet.repo.entregasDe(numeroOt)) {
      await crudo('POST', '/entregas/${e.id}/sid/pendiente');
    }
    await tablet.sincronizar();
    final primera = tablet.repo.entregasDe(numeroOt).first;
    await tablet.api.eliminarEntrega(primera.id);
    for (final d in tablet.repo.devolucionesDe(numeroOt)) {
      await tablet.api.eliminarDevolucion(d.id);
    }
    // La OT se elimina desde la PC (Crear OT) y la tablet deja de verla.
    final r = await crudo('DELETE', '/ordenes-trabajo/$numeroOt');
    expect(r.statusCode, 200, reason: r.body);
    await tablet.sincronizar();
    await pc.sincronizar();
    expect(tablet.repo.buscarOrdenes(numeroOt), isEmpty);
    expect(pc.repo.buscarOrdenes(numeroOt), isEmpty);
    expect(tablet.repo.consumoDe(numeroOt), isEmpty);
  });

  test('84. una OT que ya no existe: registrar contra ella da un error del servidor, no un cuelgue', () async {
    await expectLater(
        tablet.api.registrarEntrega(otMaterialId: pedidoId, fecha: '2026-11-03', bobinas: [1]), throwsA(isA<ApiError>()));
  });

  test('85. lo que tarda una sincronización completa con la base real', () async {
    final reloj = Stopwatch()..start();
    await tablet.sincronizar();
    reloj.stop();
    // ignore: avoid_print
    print('SINCRONIZACION COMPLETA: ${reloj.elapsedMilliseconds} ms — '
        '${tablet.repo.ordenes.length} OT, ${tablet.repo.consumo.length} pedidos, '
        '${tablet.repo.entregas.length} entregas, ${tablet.repo.devoluciones.length} devoluciones');
    expect(tablet.repo.errorSincronizacion, isNull);
    expect(reloj.elapsedMilliseconds, lessThan(60000));
  });
}
