import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zepol_tablet/api/api.dart';

import '../soporte/backend_falso.dart';

void main() {
  late BackendFalso backend;
  late Api api;

  setUp(() {
    backend = BackendFalso();
    api = Api(BackendFalso.servidor, token: 'tok-ER', cliente: backend.cliente);
  });

  test('manda el token y lee la lista de pedidos', () async {
    final pedidos = await api.consultarConsumo('1000');
    expect(backend.peticiones.last.headers['Authorization'], 'Bearer tok-ER');
    expect(pedidos.map((p) => p.codigoMp), contains('BOPP20620'));
  });

  test('el número de OT viaja codificado en la URL (S/OT, fuelles)', () async {
    await expectLater(api.listarPendientes('F-6321'), throwsA(isA<ApiError>()));
    expect(backend.peticiones.last.url.path, '/ordenes-trabajo/F-6321/pendientes');
  });

  test('un error del backend llega con su mensaje ("detail")', () async {
    final e = await api
        .registrarEntrega(otMaterialId: 10, fecha: '2026-10-29', bobinas: [0])
        .then<Object?>((_) => null, onError: (Object e) => e);
    expect(e, isA<ApiError>().having((x) => x.mensaje, 'mensaje', 'Cantidad inválida'));
  });

  test('un 401 con sesión avisa para volver al login', () async {
    var expiro = false;
    final conTokenVencido =
        Api(BackendFalso.servidor, token: 'tok-NADIE', cliente: backend.cliente, alExpirarSesion: () => expiro = true);
    await expectLater(conTokenVencido.listarProcesos(), throwsA(isA<ApiError>()));
    expect(expiro, isTrue);
  });

  test('un 401 en el login (clave mala) NO cierra ninguna sesión', () async {
    var expiro = false;
    final publica = Api(BackendFalso.servidor, cliente: backend.cliente, alExpirarSesion: () => expiro = true);
    await expectLater(
      publica.login('ER', 'mala'),
      throwsA(isA<ApiError>().having((e) => e.mensaje, 'mensaje', 'Usuario o clave incorrectos')),
    );
    expect(expiro, isFalse);
  });

  test('sin conexión dice a qué servidor intentó llegar', () async {
    final caido = Api('http://10.0.0.1:8000',
        cliente: MockClient((_) async => throw const SocketExceptionFalsa()));
    await expectLater(
      caido.listarUsuariosLogin(),
      throwsA(isA<ApiError>().having((e) => e.mensaje, 'mensaje', contains('10.0.0.1:8000'))),
    );
  });

  test('si el servidor no responde a tiempo, lo dice', () async {
    final lento = Api('http://x', cliente: MockClient((_) => Completer<http.Response>().future));
    await expectLater(
      lento.listarUsuariosLogin(), // tiene 5 s de límite
      throwsA(isA<ApiError>().having((e) => e.mensaje, 'mensaje', 'El servidor no respondió a tiempo')),
    );
  }, timeout: const Timeout(Duration(seconds: 15)));

  test('registrarEntrega no manda los campos vacíos', () async {
    await api.registrarEntrega(otMaterialId: 12, fecha: '2026-10-29', bobinas: [10.5], observacion: '');
    final cuerpo = backend.cuerpos('POST', '/entregas').single;
    expect(cuerpo, {'fecha': '2026-10-29', 'bobinas': [10.5], 'ot_material_id': 12});
  });

  test('editarDevolucion: entregaId null QUITA el vínculo; en un ingreso no se manda', () async {
    final sobrante = backend.devoluciones.firstWhere((d) => d['ingreso'] != true);
    sobrante['sid'] = false;
    await api.editarDevolucion(sobrante['id'] as int,
        fecha: '2026-10-21', materialId: 100, bobinas: [30], entregaId: null);
    final ingreso = backend.devoluciones.firstWhere((d) => d['ingreso'] == true);
    await api.editarDevolucion(ingreso['id'] as int,
        fecha: '2026-10-22', materialId: 102, bobinas: [150], tocarEntrega: false);
    final cuerpos = [
      for (final r in backend.peticiones.where((r) => r.method == 'PATCH')) jsonDecode(r.body) as Map,
    ];
    expect(cuerpos[0].containsKey('entrega_id'), isTrue);
    expect(cuerpos[0]['entrega_id'], isNull);
    expect(cuerpos[1].containsKey('entrega_id'), isFalse);
  });

  test('resolverIngresoLibre reutiliza el pedido que la OT ya tiene', () async {
    final r = await api.resolverIngresoLibre('1000', 102, 20);
    expect(r.otMaterialId, 11);
    expect(r.pendienteId, isNull);
    final nuevo = await api.resolverIngresoLibre('1000', 101, 20);
    expect(nuevo.otMaterialId, isNull);
    expect(nuevo.pendienteId, isNotNull);
  });
}

class SocketExceptionFalsa implements Exception {
  const SocketExceptionFalsa();
}
