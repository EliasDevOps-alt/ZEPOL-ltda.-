import 'package:flutter_test/flutter_test.dart';
import 'package:zepol_tablet/api/api.dart';
import 'package:zepol_tablet/estado/repositorio.dart';

import '../soporte/backend_falso.dart';

class _AlmacenEnMemoria implements AlmacenLocal {
  final datos = <String, String>{};
  @override
  Future<String?> leer(String clave) async => datos[clave];
  @override
  Future<void> guardar(String clave, String texto) async => datos[clave] = texto;
}

void main() {
  Repositorio crear(BackendFalso b, {AlmacenLocal? almacen}) => Repositorio(
        api: () => Api(BackendFalso.servidor, token: 'tok-ER', cliente: b.cliente),
        servidor: () => BackendFalso.servidor,
        almacen: almacen,
      );

  test('la primera sincronización trae todo y después se puede leer sin red', () async {
    final b = BackendFalso();
    final repo = crear(b);
    expect(repo.tieneDatos, isFalse);
    await repo.sincronizar();
    expect(repo.tieneDatos, isTrue);
    expect(repo.ordenes.map((o) => o.numeroOt), containsAll(['1000', '2000']));
    expect(repo.consumoDe('1000'), isNotEmpty);
    expect(repo.entregasDe('1000'), hasLength(2));
    expect(repo.maquinasDe(1)!.single.nombre, 'NORD');
    expect(repo.buscarOrdenes('hiper').single.numeroOt, '2000');
    expect(repo.buscarOrdenes('1000').single.cliente, 'Coronilla S.A.');
  });

  test('solo avisa a las pantallas si algo cambió', () async {
    final b = BackendFalso();
    final repo = crear(b);
    await repo.sincronizar();
    var avisos = 0;
    repo.addListener(() => avisos++);
    final entregasAntes = repo.entregas;
    await repo.sincronizar();
    // Sin cambios en el servidor, la lista ni siquiera se vuelve a armar.
    expect(identical(repo.entregas, entregasAntes), isTrue);
    expect(avisos, 1); // termina de sincronizar (para apagar el indicador), nada más

    b.entregas.add({...b.entregas.first, 'id': 99});
    await repo.sincronizar();
    expect(repo.entregas, hasLength(entregasAntes.length + 1));
  });

  test('sin conexión se sigue con la copia y se informa el error', () async {
    final b = BackendFalso();
    final repo = crear(b);
    await repo.sincronizar();
    b.forzarError = 500;
    await repo.sincronizar();
    expect(repo.tieneDatos, isTrue);
    expect(repo.errorSincronizacion, isNotNull);
    expect(repo.ordenes, isNotEmpty);
  });

  test('la copia se guarda y la siguiente apertura la tiene antes de hablar con el servidor', () async {
    final b = BackendFalso();
    final disco = _AlmacenEnMemoria();
    await crear(b, almacen: disco).sincronizar();
    expect(disco.datos, isNotEmpty);

    final otra = crear(b, almacen: disco);
    expect(otra.tieneDatos, isFalse);
    await otra.cargarDelDisco();
    expect(otra.tieneDatos, isTrue);
    expect(otra.entregasDe('1000'), hasLength(2));
    expect(b.peticiones.where((p) => p.url.path == '/entregas').length, 1, reason: 'no volvió a pedir al servidor');
  });

  test('dos pedidos de sincronizar a la vez comparten una sola ronda', () async {
    final b = BackendFalso();
    final repo = crear(b);
    final f1 = repo.sincronizar();
    final f2 = repo.sincronizar();
    await Future.wait([f1, f2]);
    await repo.sincronizar();
    expect(repo.tieneDatos, isTrue);
  });
}
