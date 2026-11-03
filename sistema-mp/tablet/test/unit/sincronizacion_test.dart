// La PC y la tablet contra el MISMO servidor: qué ve cada una cuando la otra
// registra, corrige, borra o crea cosas; qué pasa con la tablet sin wifi; y qué
// pasa cuando el SID ya se registró.
//
// Los hechos que estas pruebas fijan (importantes para entender la tablet):
//  * Lo que se registra, corrige o borra va SIEMPRE al servidor en el momento.
//    Sin wifi esa acción falla con un aviso y NO queda guardada ni encolada
//    para después: hay que repetirla al volver la conexión.
//  * Lo que se LEE sale de la copia local; sin wifi se sigue viendo lo último
//    sincronizado, y al volver la conexión la copia se pone al día sola.
//  * Mandan las reglas del servidor (SID registrado, entrega ya borrada...):
//    una copia vieja en la tablet nunca puede saltárselas.

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:zepol_tablet/api/api.dart';
import 'package:zepol_tablet/api/modelos.dart';
import 'package:zepol_tablet/estado/repositorio.dart';
import 'package:zepol_tablet/util/formato.dart';

import '../soporte/backend_falso.dart';
import '../soporte/equipo.dart';

Matcher errorApi(String parte) => throwsA(isA<ApiError>().having((e) => e.mensaje, 'mensaje', contains(parte)));

/// Un cliente que corta la red después de [n] peticiones (la red cae a mitad de una ronda).
class _CortaTras extends ClienteConRed {
  _CortaTras(super.interno, this.n);
  final int n;
  bool cortar = true;
  int _pasaron = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    if (cortar && _pasaron >= n) throw http.ClientException('Se cayó la red', request.url);
    _pasaron++;
    return super.send(request);
  }
}

void main() {
  late BackendFalso servidor;
  late Equipo pc;
  late Equipo tablet;

  setUp(() async {
    servidor = BackendFalso();
    pc = await Equipo.crear('PC', servidor, usuario: 'BO');
    tablet = await Equipo.crear('Tablet', servidor, usuario: 'ER');
    await pc.sincronizar();
    await tablet.sincronizar();
  });

  Consumo pedido(Equipo e, int id) => e.repo.consumo.firstWhere((c) => c.otMaterialId == id);
  Entrega? entrega(Equipo e, int id) => e.repo.entregas.where((x) => x.id == id).firstOrNull;
  Devolucion? devolucion(Equipo e, int id) => e.repo.devoluciones.where((x) => x.id == id).firstOrNull;
  int escrituras() => servidor.peticiones.where((r) => r.method != 'GET').length;
  Map<String, dynamic> filaEntrega(int id) => servidor.entregas.firstWhere((e) => e['id'] == id);
  Map<String, dynamic> filaDevolucion(int id) => servidor.devoluciones.firstWhere((d) => d['id'] == id);

  group('lo que registra un equipo lo ve el otro', () {
    test('1. la PC registra una entrega y la tablet la ve al sincronizar', () async {
      final id = await pc.entregar(12, [10, 5.5]);
      expect(entrega(tablet, id), isNull, reason: 'todavía no sincronizó');
      await tablet.sincronizar();
      expect(entrega(tablet, id)!.bobinas, [10, 5.5]);
      expect(entrega(tablet, id)!.usuario, 'BO');
    });

    test('2. la tablet registra una entrega y la PC la ve', () async {
      final id = await tablet.entregar(12, [20]);
      await pc.sincronizar();
      expect(entrega(pc, id)!.usuario, 'ER');
    });

    test('3. la PC registra una devolución y la tablet la ve', () async {
      final id = await pc.devolver(10, 100, [15]);
      await tablet.sincronizar();
      expect(devolucion(tablet, id)!.bobinas, [15]);
    });

    test('4. la PC borra una entrega y la tablet deja de verla', () async {
      final id = await pc.entregar(12, [10]);
      await tablet.sincronizar();
      expect(entrega(tablet, id), isNotNull);
      await pc.api.eliminarEntrega(id);
      await tablet.sincronizar();
      expect(entrega(tablet, id), isNull);
    });

    test('5. la PC borra una devolución y la tablet deja de verla', () async {
      final id = await pc.devolver(10, 100, [15]);
      await tablet.sincronizar();
      await pc.api.eliminarDevolucion(id);
      await tablet.sincronizar();
      expect(devolucion(tablet, id), isNull);
    });

    test('6. la PC corrige una entrega y la tablet ve el peso nuevo y quién la corrigió', () async {
      final id = await pc.entregar(12, [10]);
      await tablet.sincronizar();
      await pc.api.editarEntrega(id,
          fecha: '2026-11-03', materialId: 103, bobinas: [12, 3], observacion: 'pesaje corregido', procesoId: 2, maquinaId: 21);
      await tablet.sincronizar();
      final e = entrega(tablet, id)!;
      expect(e.bobinas, [12, 3]);
      expect(e.editadoPor, 'BO');
      expect(e.observacion, 'pesaje corregido');
    });

    test('7. la PC corrige una devolución y la tablet ve el peso nuevo', () async {
      final id = await pc.devolver(10, 100, [15]);
      await tablet.sincronizar();
      await pc.api.editarDevolucion(id, fecha: '2026-11-03', materialId: 100, bobinas: [9]);
      await tablet.sincronizar();
      expect(devolucion(tablet, id)!.bobinas, [9]);
      expect(devolucion(tablet, id)!.editadoPor, 'BO');
    });

    test('8. una OT creada en el servidor aparece en la búsqueda de la tablet', () async {
      expect(tablet.repo.buscarOrdenes('7777'), isEmpty);
      crearOtEnServidor(servidor, '7777');
      await tablet.sincronizar();
      expect(tablet.repo.buscarOrdenes('7777').single.cliente, 'Cliente nuevo');
      expect(tablet.repo.consumoDe('7777'), hasLength(1));
    });

    test('9. una OT eliminada en el servidor desaparece de la tablet', () async {
      crearOtEnServidor(servidor, '7777');
      await tablet.sincronizar();
      expect(tablet.repo.buscarOrdenes('7777'), hasLength(1));
      servidor.ordenes.removeWhere((o) => o['numero_ot'] == '7777');
      servidor.pedidos.removeWhere((p) => p['ot'] == '7777');
      await tablet.sincronizar();
      expect(tablet.repo.buscarOrdenes('7777'), isEmpty);
      expect(tablet.repo.consumoDe('7777'), isEmpty);
    });

    test('10. el total entregado del pedido cambia en la tablet cuando la PC entrega', () async {
      expect(pedido(tablet, 12).totalEntregado, 0);
      await pc.entregar(12, [20]);
      await tablet.sincronizar();
      expect(pedido(tablet, 12).totalEntregado, 20);
    });

    test('11. el estado PENDIENTE → PARCIAL → COMPLETO se ve en la tablet', () async {
      expect(pedido(tablet, 12).estadoEntrega, 'PENDIENTE');
      await pc.entregar(12, [20]);
      await tablet.sincronizar();
      expect(pedido(tablet, 12).estadoEntrega, 'PARCIAL');
      await pc.entregar(12, [30]);
      await tablet.sincronizar();
      expect(pedido(tablet, 12).estadoEntrega, 'COMPLETO');
    });

    test('12. el total devuelto del pedido se ve en la tablet', () async {
      await pc.devolver(12, 103, [4]);
      await tablet.sincronizar();
      expect(pedido(tablet, 12).totalDevuelto, 4);
    });

    test('13. la PC ve lo que registra la tablet en los totales del pedido', () async {
      await tablet.entregar(12, [7]);
      await pc.sincronizar();
      expect(pedido(pc, 12).totalEntregado, 7);
    });
  });

  group('la copia se pone al día sola', () {
    test('14. sin cambios en el servidor la copia no se vuelve a armar', () async {
      final antes = tablet.repo.entregas;
      await tablet.sincronizar();
      expect(identical(tablet.repo.entregas, antes), isTrue);
    });

    test('15. lo que registra la propia tablet aparece en su copia sin sincronizar a mano', () async {
      final id = await tablet.entregar(12, [8]);
      await tablet.reposo();
      expect(entrega(tablet, id), isNotNull);
    });

    test('16. registrar dispara una lectura nueva del servidor', () async {
      int lecturas() => servidor.peticiones.where((r) => r.url.path == '/entregas' && r.method == 'GET').length;
      final antes = lecturas();
      await tablet.entregar(12, [8]);
      await tablet.reposo();
      expect(lecturas(), greaterThan(antes));
    });

    test('17. una escritura rechazada por el servidor no dispara lecturas de más', () async {
      final antes = servidor.peticiones.length;
      await expectLater(tablet.api.eliminarEntrega(99999), errorApi('no encontrada'));
      await tablet.reposo();
      expect(servidor.peticiones.length, antes + 1, reason: 'solo el DELETE rechazado');
    });

    test('18. con la sincronización automática la tablet recoge lo de la PC sin que nadie haga nada', () async {
      final repo = Repositorio(
          api: () => tablet.api,
          servidor: () => BackendFalso.servidor,
          automatica: true,
          intervalo: const Duration(milliseconds: 30));
      repo.iniciar();
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(repo.tieneDatos, isTrue);
      final id = await pc.entregar(12, [3]);
      await Future<void>.delayed(const Duration(milliseconds: 300));
      expect(repo.entregas.any((e) => e.id == id), isTrue);
      repo.detener();
      repo.dispose();
    });

    test('19. al cerrar sesión (detener) deja de leer el servidor', () async {
      final repo = Repositorio(
          api: () => tablet.api,
          servidor: () => BackendFalso.servidor,
          automatica: true,
          intervalo: const Duration(milliseconds: 20));
      repo.iniciar();
      await Future<void>.delayed(const Duration(milliseconds: 150));
      repo.detener();
      await Future<void>.delayed(const Duration(milliseconds: 100));
      final n = servidor.peticiones.length;
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(servidor.peticiones.length, n);
      repo.dispose();
    });

    test('20. varias sincronizaciones pedidas a la vez no hacen rondas paralelas', () async {
      int rondas() => servidor.peticiones.where((r) => r.url.path == '/consumo').length;
      final antes = rondas();
      await Future.wait([tablet.repo.sincronizar(), tablet.repo.sincronizar(), tablet.repo.sincronizar()]);
      await tablet.reposo();
      expect(rondas() - antes, lessThanOrEqualTo(2), reason: 'una ronda más la vuelta extra pedida');
    });
  });

  group('la misma OT en las dos máquinas', () {
    test('21. las dos registran una entrega del mismo pedido: se guardan las dos', () async {
      final a = await pc.entregar(12, [10]);
      final b = await tablet.entregar(12, [15]);
      expect(a, isNot(b));
      await pc.sincronizar();
      await tablet.sincronizar();
      for (final e in [pc, tablet]) {
        expect(pedido(e, 12).totalEntregado, 25);
        expect(e.repo.entregas.where((x) => x.otMaterialId == 12), hasLength(2));
      }
    });

    test('22. registradas a la vez no se pisan', () async {
      await Future.wait([pc.entregar(12, [10]), tablet.entregar(12, [15]), pc.entregar(12, [1])]);
      await pc.sincronizar();
      await tablet.sincronizar();
      expect(pedido(tablet, 12).totalEntregado, 26);
      expect(tablet.repo.entregas.where((x) => x.otMaterialId == 12), hasLength(3));
    });

    test('23. las dos entregas del mismo material llevan letras distintas e iguales en las dos máquinas', () async {
      final a = await pc.entregar(12, [10]);
      final b = await tablet.entregar(12, [15]);
      await pc.sincronizar();
      await tablet.sincronizar();
      Map<int, String> letras(Equipo e) => letrasDeEntregas(e.repo.entregas
          .map((x) => (id: x.id, numeroOt: x.numeroOt, codigo: x.codigoMpEntregado, fecha: x.fecha, hora: x.hora)));
      expect(letras(pc)[a], isNotNull);
      expect(letras(pc)[b], isNotNull);
      expect(letras(pc)[a], isNot(letras(pc)[b]));
      expect(letras(pc), letras(tablet));
    });

    test('24. la tablet tiene en su copia una entrega que la PC ya borró: al borrarla recibe un aviso claro', () async {
      final id = await pc.entregar(12, [10]);
      await tablet.sincronizar();
      await pc.api.eliminarEntrega(id);
      expect(entrega(tablet, id), isNotNull, reason: 'su copia todavía la tiene');
      await expectLater(tablet.api.eliminarEntrega(id), errorApi('no encontrada'));
      await tablet.sincronizar();
      expect(entrega(tablet, id), isNull);
    });

    test('25. las dos corrigen la misma entrega: queda la última y dice quién', () async {
      final id = await pc.entregar(12, [10]);
      await tablet.sincronizar();
      await pc.api.editarEntrega(id,
          fecha: '2026-11-03', materialId: 103, bobinas: [11], observacion: null, procesoId: 2, maquinaId: 21);
      await tablet.api.editarEntrega(id,
          fecha: '2026-11-03', materialId: 103, bobinas: [22], observacion: null, procesoId: 2, maquinaId: 21);
      await pc.sincronizar();
      expect(entrega(pc, id)!.bobinas, [22]);
      expect(entrega(pc, id)!.editadoPor, 'ER');
    });

    test('26. la PC corrige y la tablet borra la misma entrega: queda borrada', () async {
      final id = await pc.entregar(12, [10]);
      await tablet.sincronizar();
      await pc.api.editarEntrega(id,
          fecha: '2026-11-03', materialId: 103, bobinas: [11], observacion: null, procesoId: 2, maquinaId: 21);
      await tablet.api.eliminarEntrega(id);
      await pc.sincronizar();
      expect(entrega(pc, id), isNull);
    });

    test('27. las dos borran la misma entrega: la segunda recibe "no encontrada" y nada se rompe', () async {
      final id = await pc.entregar(12, [10]);
      await tablet.sincronizar();
      await pc.api.eliminarEntrega(id);
      await expectLater(tablet.api.eliminarEntrega(id), errorApi('no encontrada'));
      await tablet.sincronizar();
      expect(tablet.repo.tieneDatos, isTrue);
      expect(entrega(tablet, id), isNull);
    });

    test('28. las dos corrigen y borran devoluciones de la misma OT sin interferirse', () async {
      final a = await pc.devolver(12, 103, [2]);
      final b = await tablet.devolver(12, 103, [3]);
      await pc.api.eliminarDevolucion(a);
      await tablet.api.editarDevolucion(b, fecha: '2026-11-03', materialId: 103, bobinas: [4]);
      await pc.sincronizar();
      await tablet.sincronizar();
      for (final e in [pc, tablet]) {
        expect(devolucion(e, a), isNull);
        expect(devolucion(e, b)!.bobinas, [4]);
      }
    });

    test('29. dos entregas libres del mismo material nuevo en la misma OT comparten UN pedido', () async {
      final a = await pc.api.registrarEntrega(
          numeroOt: '1000', fecha: '2026-11-03', bobinas: [5], materialId: 101, procesoId: 1, maquinaId: 11);
      final b = await tablet.api.registrarEntrega(
          numeroOt: '1000', fecha: '2026-11-03', bobinas: [6], materialId: 101, procesoId: 1, maquinaId: 11);
      expect(a.otMaterialId, b.otMaterialId);
      await tablet.sincronizar();
      expect(tablet.repo.consumoDe('1000').where((c) => c.materialId == 101), hasLength(1));
    });

    test('30. la tablet registra en una OT y la PC en otra: cada una ve las dos', () async {
      crearOtEnServidor(servidor, '8888', pedidoId: 901);
      await pc.entregar(901, [10]);
      await tablet.entregar(12, [20]);
      await pc.sincronizar();
      await tablet.sincronizar();
      for (final e in [pc, tablet]) {
        expect(e.repo.entregasDe('8888'), hasLength(1));
        expect(e.repo.entregasDe('1000').where((x) => x.otMaterialId == 12), hasLength(1));
      }
    });
  });

  group('el SID ya registrado', () {
    test('31. la PC registra el SID de una entrega: la tablet con copia vieja no puede corregirla', () async {
      final id = await tablet.entregar(12, [10]);
      await tablet.reposo();
      filaEntrega(id)['sid'] = true; // la PC lo marcó en Registro SID
      expect(entrega(tablet, id)!.sidCompletado, isFalse, reason: 'la tablet no lo sabe todavía');
      await expectLater(
        tablet.api.editarEntrega(id,
            fecha: '2026-11-03', materialId: 103, bobinas: [99], observacion: null, procesoId: 2, maquinaId: 21),
        errorApi('SID'),
      );
      expect(filaEntrega(id)['bobinas'], [10]);
    });

    test('32. lo mismo al borrar: el servidor rechaza y la entrega sigue', () async {
      final id = await tablet.entregar(12, [10]);
      filaEntrega(id)['sid'] = true;
      await expectLater(tablet.api.eliminarEntrega(id), errorApi('SID'));
      expect(servidor.entregas.any((e) => e['id'] == id), isTrue);
    });

    test('33. SID de una devolución: no se puede corregir', () async {
      final id = await tablet.devolver(12, 103, [3]);
      filaDevolucion(id)['sid'] = true;
      await expectLater(
          tablet.api.editarDevolucion(id, fecha: '2026-11-03', materialId: 103, bobinas: [9]), errorApi('SID'));
    });

    test('34. SID de una devolución: no se puede borrar', () async {
      final id = await tablet.devolver(12, 103, [3]);
      filaDevolucion(id)['sid'] = true;
      await expectLater(tablet.api.eliminarDevolucion(id), errorApi('SID'));
      expect(servidor.devoluciones.any((d) => d['id'] == id), isTrue);
    });

    test('35. tras sincronizar la tablet SÍ sabe que está registrada (la pantalla la bloquea)', () async {
      final id = await tablet.entregar(12, [10]);
      filaEntrega(id)['sid'] = true;
      await tablet.sincronizar();
      expect(entrega(tablet, id)!.sidCompletado, isTrue);
    });

    test('36. si la PC desmarca el SID, la tablet puede corregir otra vez', () async {
      final id = await tablet.entregar(12, [10]);
      filaEntrega(id)['sid'] = true;
      await expectLater(tablet.api.eliminarEntrega(id), errorApi('SID'));
      filaEntrega(id)['sid'] = false;
      await tablet.api.eliminarEntrega(id);
      expect(servidor.entregas.any((e) => e['id'] == id), isFalse);
    });

    test('37. la PC marca el SID MIENTRAS la tablet está sin wifi: sin wifi falla por la red, con wifi por el SID', () async {
      final id = await tablet.entregar(12, [10]);
      await tablet.reposo();
      tablet.cortarRed();
      filaEntrega(id)['sid'] = true;
      await expectLater(tablet.api.eliminarEntrega(id), errorApi('No se pudo conectar'));
      tablet.devolverRed();
      await expectLater(tablet.api.eliminarEntrega(id), errorApi('SID'));
      expect(servidor.entregas.any((e) => e['id'] == id), isTrue);
    });

    test('38. la corrección hecha sin wifi NO se aplica sola al volver la red', () async {
      final id = await tablet.entregar(12, [10]);
      await tablet.reposo();
      tablet.cortarRed();
      await expectLater(
        tablet.api.editarEntrega(id,
            fecha: '2026-11-03', materialId: 103, bobinas: [77], observacion: null, procesoId: 2, maquinaId: 21),
        errorApi('No se pudo conectar'),
      );
      tablet.devolverRed();
      await tablet.sincronizar();
      expect(filaEntrega(id)['bobinas'], [10]);
      expect(entrega(tablet, id)!.bobinas, [10]);
    });
  });

  group('la tablet sin wifi', () {
    test('39. sincronizar sin red no borra la copia y deja el error a la vista', () async {
      tablet.cortarRed();
      await tablet.sincronizar();
      expect(tablet.repo.tieneDatos, isTrue);
      expect(tablet.repo.errorSincronizacion, isNotNull);
      expect(tablet.repo.ordenes, isNotEmpty);
      expect(tablet.repo.consumoDe('1000'), isNotEmpty);
    });

    test('40. sin red se sigue buscando OT y viendo pedidos con la copia', () async {
      tablet.cortarRed();
      expect(tablet.repo.buscarOrdenes('coronilla').single.numeroOt, '1000');
      expect(tablet.repo.consumoDe('1000'), hasLength(5));
      expect(tablet.repo.entregasDe('1000'), hasLength(2));
      expect(tablet.repo.devolucionesDe('1000'), hasLength(2));
    });

    test('41. sin red, registrar una entrega falla con aviso y NO llega al servidor', () async {
      tablet.cortarRed();
      final antes = servidor.entregas.length;
      await expectLater(tablet.entregar(12, [10]), errorApi('No se pudo conectar'));
      expect(servidor.entregas.length, antes);
    });

    test('42. sin red, eliminar una entrega falla y la entrega sigue donde estaba', () async {
      final id = await pc.entregar(12, [10]);
      await tablet.sincronizar();
      tablet.cortarRed();
      await expectLater(tablet.api.eliminarEntrega(id), errorApi('No se pudo conectar'));
      expect(servidor.entregas.any((e) => e['id'] == id), isTrue);
      expect(entrega(tablet, id), isNotNull);
    });

    test('43. sin red, eliminar una devolución falla y sigue en el servidor', () async {
      final id = await pc.devolver(12, 103, [2]);
      await tablet.sincronizar();
      tablet.cortarRed();
      await expectLater(tablet.api.eliminarDevolucion(id), errorApi('No se pudo conectar'));
      expect(servidor.devoluciones.any((d) => d['id'] == id), isTrue);
    });

    test('44. sin red, registrar una devolución falla y no llega', () async {
      tablet.cortarRed();
      final antes = servidor.devoluciones.length;
      await expectLater(tablet.devolver(12, 103, [2]), errorApi('No se pudo conectar'));
      expect(servidor.devoluciones.length, antes);
    });

    test('45. nada queda encolado: al volver la red el servidor no recibe ninguna escritura sola', () async {
      tablet.cortarRed();
      final antes = escrituras();
      await expectLater(tablet.entregar(12, [10]), throwsA(isA<ApiError>()));
      await expectLater(tablet.api.eliminarEntrega(1), throwsA(isA<ApiError>()));
      tablet.devolverRed();
      await tablet.sincronizar();
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(escrituras(), antes);
    });

    test('46. mientras la tablet no tiene red la PC registra: al volver la red la tablet lo recibe', () async {
      tablet.cortarRed();
      final id = await pc.entregar(12, [10]);
      await tablet.sincronizar();
      expect(entrega(tablet, id), isNull);
      tablet.devolverRed();
      await tablet.sincronizar();
      expect(entrega(tablet, id), isNotNull);
    });

    test('47. mientras la tablet no tiene red la PC borra: sigue viendo lo último hasta que vuelve', () async {
      final id = await pc.entregar(12, [10]);
      await tablet.sincronizar();
      tablet.cortarRed();
      await pc.api.eliminarEntrega(id);
      await tablet.sincronizar();
      expect(entrega(tablet, id), isNotNull, reason: 'sin red sigue viendo lo último que supo');
      tablet.devolverRed();
      await tablet.sincronizar();
      expect(entrega(tablet, id), isNull);
    });

    test('48. al volver la red, repetir la eliminación funciona', () async {
      final id = await pc.entregar(12, [10]);
      await tablet.sincronizar();
      tablet.cortarRed();
      await expectLater(tablet.api.eliminarEntrega(id), throwsA(isA<ApiError>()));
      tablet.devolverRed();
      await tablet.api.eliminarEntrega(id);
      await tablet.reposo();
      expect(entrega(tablet, id), isNull);
      expect(servidor.entregas.any((e) => e['id'] == id), isFalse);
    });

    test('49. al volver la red, repetir el registro funciona y no queda duplicado', () async {
      tablet.cortarRed();
      await expectLater(tablet.entregar(12, [10]), throwsA(isA<ApiError>()));
      tablet.devolverRed();
      await tablet.entregar(12, [10]);
      await tablet.reposo();
      expect(servidor.entregas.where((e) => e['pedido'] == 12), hasLength(1));
    });

    test('50. la PC sigue trabajando normal mientras la tablet no tiene red', () async {
      tablet.cortarRed();
      final id = await pc.entregar(12, [10]);
      await pc.reposo();
      expect(entrega(pc, id), isNotNull);
    });

    test('51. una OT nueva creada mientras la tablet no tenía red se ve al volver, no antes', () async {
      tablet.cortarRed();
      crearOtEnServidor(servidor, '7777');
      await tablet.sincronizar();
      expect(tablet.repo.buscarOrdenes('7777'), isEmpty);
      tablet.devolverRed();
      await tablet.sincronizar();
      expect(tablet.repo.buscarOrdenes('7777'), hasLength(1));
    });

    test('52. un servidor que contesta 500 se trata igual que sin red: se conserva la copia', () async {
      servidor.forzarError = 500;
      await tablet.sincronizar();
      expect(tablet.repo.errorSincronizacion, isNotNull);
      expect(tablet.repo.ordenes, isNotEmpty);
      servidor.forzarError = null;
      await tablet.sincronizar();
      expect(tablet.repo.errorSincronizacion, isNull);
    });

    test('53. la red cae a mitad de la primera sincronización: no queda una copia a medias', () async {
      await pc.entregar(12, [10]);
      final cortando = _CortaTras(servidor.cliente, 3);
      final repo = Repositorio(
          api: () => Api(BackendFalso.servidor, token: 'tok-ER', cliente: cortando),
          servidor: () => BackendFalso.servidor);
      await repo.sincronizar();
      expect(repo.tieneDatos, isFalse, reason: 'una ronda incompleta no deja una copia a medias');
      cortando.cortar = false;
      await repo.sincronizar();
      expect(repo.tieneDatos, isTrue);
      expect(repo.entregas.where((e) => e.otMaterialId == 12), hasLength(1));
      repo.dispose();
    });

    test('54. con una copia ya hecha, una ronda cortada a mitad no la deja mezclada', () async {
      final copiaAntes = tablet.repo.entregas.length;
      await pc.entregar(12, [10]);
      final cortando = _CortaTras(servidor.cliente, 3);
      final repo = Repositorio(
          api: () => Api(BackendFalso.servidor, token: 'tok-ER', cliente: cortando),
          servidor: () => BackendFalso.servidor,
          almacen: tablet.disco);
      await repo.cargarDelDisco();
      expect(repo.entregas, hasLength(copiaAntes));
      await repo.sincronizar();
      expect(repo.entregas, hasLength(copiaAntes), reason: 'sigue la copia anterior completa');
      cortando.cortar = false;
      await repo.sincronizar();
      expect(repo.entregas, hasLength(copiaAntes + 1));
      repo.dispose();
    });
  });

  group('cerrar y abrir la app', () {
    test('55. al reabrir sin wifi se ve la última copia guardada en la tablet', () async {
      final reabierta = await Equipo.crear('Tablet reabierta', servidor, usuario: 'ER', disco: tablet.disco);
      reabierta.cortarRed();
      await reabierta.repo.cargarDelDisco();
      expect(reabierta.repo.tieneDatos, isTrue);
      expect(reabierta.repo.buscarOrdenes('hipermaxi'), hasLength(1));
      expect(reabierta.repo.consumoDe('1000'), isNotEmpty);
    });

    test('56. la primera vez, sin wifi y sin copia, no hay nada que mostrar (y se avisa)', () async {
      final nueva = await Equipo.crear('Tablet nueva', servidor, usuario: 'ER');
      nueva.cortarRed();
      await nueva.sincronizar();
      expect(nueva.repo.tieneDatos, isFalse);
      expect(nueva.repo.errorSincronizacion, isNotNull);
    });

    test('57. la copia guardada de un servidor no se mezcla con la de otro', () async {
      var direccion = 'http://uno:8000';
      final disco = DiscoEnMemoria();
      final repo = Repositorio(api: () => tablet.api, servidor: () => direccion, almacen: disco);
      await repo.sincronizar();
      expect(disco.datos, isNotEmpty);
      direccion = 'http://dos:8000';
      final otra = Repositorio(api: () => tablet.api, servidor: () => direccion, almacen: disco);
      await otra.cargarDelDisco();
      expect(otra.tieneDatos, isFalse);
      repo.dispose();
      otra.dispose();
    });

    test('58. una copia guardada dañada se ignora y se vuelve a bajar del servidor', () async {
      final disco = DiscoEnMemoria();
      final primera = await Equipo.crear('x', servidor, disco: disco);
      await primera.sincronizar();
      for (final k in disco.datos.keys.toList()) {
        disco.datos[k] = '{esto no es json';
      }
      final reabierta = await Equipo.crear('Tablet', servidor, usuario: 'ER', disco: disco);
      await reabierta.repo.cargarDelDisco();
      expect(reabierta.repo.tieneDatos, isFalse);
      await reabierta.sincronizar();
      expect(reabierta.repo.tieneDatos, isTrue);
    });

    test('59. un 401 al sincronizar (sesión vencida) cierra la sesión', () async {
      final vencida = await Equipo.crear('Vencida', servidor, usuario: 'ER');
      vencida.sesion.token = 'token-roto';
      await vencida.repo.sincronizar();
      expect(vencida.sesion.usuario, isNull);
    });
  });
}
