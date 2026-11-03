import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:zepol_tablet/estado/sesion.dart';

import '../soporte/backend_falso.dart';

void main() {
  late BackendFalso backend;

  setUp(() {
    backend = BackendFalso();
    SharedPreferences.setMockInitialValues({});
  });

  test('la dirección del servidor se completa con http:// y sin "/" final', () async {
    final s = Sesion(cliente: backend.cliente);
    await s.cargar();
    await s.fijarServidor(' 192.168.121.72:8000/ ');
    expect(s.servidor, 'http://192.168.121.72:8000');
    await s.fijarServidor('https://zepol.local//');
    expect(s.servidor, 'https://zepol.local');
  });

  test('el login queda guardado: al reabrir la app sigue adentro', () async {
    final s = Sesion(cliente: backend.cliente);
    await s.cargar();
    await s.fijarServidor(BackendFalso.servidor);
    await s.iniciarSesion('ER', BackendFalso.clave);
    expect(s.usuario!.nombre, 'Erasmo');

    final reabierta = Sesion(cliente: backend.cliente);
    await reabierta.cargar();
    expect(reabierta.servidor, BackendFalso.servidor);
    expect(reabierta.token, 'tok-ER');
    expect(reabierta.usuario!.inicial, 'ER');
    expect(reabierta.ultimoUsuario, 'ER');
  });

  test('cerrar sesión borra la sesión pero no el servidor ni el último usuario', () async {
    final s = Sesion(cliente: backend.cliente);
    await s.cargar();
    await s.fijarServidor(BackendFalso.servidor);
    await s.iniciarSesion('ER', BackendFalso.clave);
    s.cerrarSesion();

    final reabierta = Sesion(cliente: backend.cliente);
    await reabierta.cargar();
    expect(reabierta.usuario, isNull);
    expect(reabierta.servidor, BackendFalso.servidor);
    expect(reabierta.ultimoUsuario, 'ER');
  });

  test('un token vencido (401) cierra la sesión solo', () async {
    final s = Sesion(cliente: backend.cliente);
    await s.cargar();
    await s.fijarServidor(BackendFalso.servidor);
    await s.iniciarSesion('ER', BackendFalso.clave);
    backend.forzarError = 401;
    await expectLater(s.api.listarProcesos(), throwsA(anything));
    expect(s.usuario, isNull);
  });

  test('una sesión guardada rota se descarta en vez de romper la app', () async {
    SharedPreferences.setMockInitialValues({'zepol.servidor': 'http://x', 'zepol.sesion': '{no es json'});
    final s = Sesion(cliente: backend.cliente);
    await s.cargar();
    expect(s.usuario, isNull);
    expect(s.servidor, 'http://x');
  });

  test('la lista de usuarios del login se guarda por servidor', () async {
    final s = Sesion(cliente: backend.cliente);
    await s.cargar();
    await s.fijarServidor(BackendFalso.servidor);
    s.guardarUsuarios(await s.apiPublica.listarUsuariosLogin());
    expect(s.usuariosGuardados()!.map((u) => u.nombre), contains('Erasmo'));
    await s.fijarServidor('http://otro:8000');
    expect(s.usuariosGuardados(), isNull);
  });
}
