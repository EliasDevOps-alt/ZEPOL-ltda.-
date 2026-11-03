// Materiales pendientes y encabezado de una OT: el servidor los da de a una OT,
// así que la tablet los guarda al abrir la OT con conexión para poder volver a
// abrirla sin wifi.

import 'package:flutter_test/flutter_test.dart';
import 'package:zepol_tablet/api/api.dart';

import '../soporte/backend_falso.dart';
import '../soporte/equipo.dart';

void main() {
  late BackendFalso servidor;
  late Equipo tablet;

  setUp(() async {
    servidor = BackendFalso();
    tablet = await Equipo.crear('Tablet', servidor, usuario: 'ER');
    await tablet.sincronizar();
  });

  test('95. una OT abierta con wifi se puede volver a abrir sin wifi: pendientes y encabezado', () async {
    expect(tablet.repo.pendientesGuardados('1000'), isNull, reason: 'todavía no se abrió');
    final con = await tablet.repo.pendientesDe('1000');
    await tablet.repo.encabezadoDe('1000');
    expect(con.single.codigoMp, 'LDPE45840');

    tablet.cortarRed();
    final sin = await tablet.repo.pendientesDe('1000');
    expect(sin.single.codigoMp, 'LDPE45840');
    expect((await tablet.repo.encabezadoDe('1000')).cliente, 'Coronilla S.A.');
  });

  test('96. una OT que nunca se abrió con wifi y se pide sin wifi da error de conexión', () async {
    tablet.cortarRed();
    await expectLater(tablet.repo.pendientesDe('2000'), throwsA(isA<ApiError>()));
  });

  test('97. un error real del servidor (OT inexistente) no se tapa con la copia', () async {
    await tablet.repo.pendientesDe('1000');
    await expectLater(
        tablet.repo.pendientesDe('9999'), throwsA(isA<ApiError>().having((e) => e.status, 'status', 404)));
  });

  test('98. con wifi se actualiza: si la PC resolvió el pendiente, la tablet lo ve', () async {
    await tablet.repo.pendientesDe('1000');
    servidor.pendientes.clear();
    expect(await tablet.repo.pendientesDe('1000'), isEmpty);
    tablet.cortarRed();
    expect(await tablet.repo.pendientesDe('1000'), isEmpty, reason: 'la copia guardada es la última leída');
  });

  test('99. lo guardado por OT sobrevive a cerrar y abrir la app', () async {
    await tablet.repo.pendientesDe('1000');
    await tablet.repo.encabezadoDe('1000');
    final reabierta = await Equipo.crear('Reabierta', servidor, usuario: 'ER', disco: tablet.disco);
    reabierta.cortarRed();
    await reabierta.repo.cargarDelDisco();
    expect(reabierta.repo.pendientesGuardados('1000')!.single.codigoMp, 'LDPE45840');
    expect(reabierta.repo.encabezadoGuardado('1000')!.cliente, 'Coronilla S.A.');
  });

  test('100. se guardan como máximo 300 OT: las más viejas se descartan', () async {
    for (var i = 0; i < 305; i++) {
      crearOtEnServidor(servidor, 'T$i', pedidoId: 2000 + i);
      await tablet.repo.encabezadoDe('T$i');
    }
    expect(tablet.repo.encabezadoGuardado('T0'), isNull);
    expect(tablet.repo.encabezadoGuardado('T304'), isNotNull);
  });
}
