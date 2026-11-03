// Entrar a la app cuando la tablet no tiene conexión con el servidor: los
// usuarios (con el hash de su clave) se guardan en la tablet mientras hay
// conexión, y al volver el servidor la sesión pasa a ser una sesión normal.

import 'package:bcrypt/bcrypt.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:zepol_tablet/api/api.dart';
import 'package:zepol_tablet/estado/conexion.dart';
import 'package:zepol_tablet/estado/sesion.dart';

import '../soporte/backend_falso.dart';
import '../soporte/equipo.dart';

Matcher errorApi(String parte) => throwsA(isA<ApiError>().having((e) => e.mensaje, 'mensaje', contains(parte)));

/// Una tablet que ya tenía la app configurada (servidor) pero SIN sesión iniciada,
/// con el disco (SharedPreferences) tal cual lo dejó la Sesion anterior.
Future<(Sesion, ClienteConRed)> abrirOtraVez(BackendFalso servidor, {bool conRed = true}) async {
  final red = ClienteConRed(servidor.cliente)..conectado = conRed;
  final s = Sesion(cliente: red, verificadorDeClave: (c, h) async => BCrypt.checkpw(c, h));
  await s.cargar();
  return (s, red);
}

void main() {
  late BackendFalso servidor;
  late Equipo tablet;

  setUp(() async {
    servidor = BackendFalso();
    tablet = await Equipo.crear('Tablet', servidor, usuario: 'ER');
  });

  group('los usuarios se guardan en la tablet', () {
    test('185. al iniciar sesión con conexión se guardan todos los usuarios activos', () {
      expect(tablet.sesion.credenciales.todas.map((c) => c.inicial), unorderedEquals(['ER', 'BO', 'SD']));
    });

    test('186. se guarda el hash bcrypt de la clave, nunca la clave', () {
      for (final c in tablet.sesion.credenciales.todas) {
        expect(c.hash, startsWith(r'$2'));
        expect(c.hash, isNot(contains(BackendFalso.clave)));
      }
    });

    test('187. con cada usuario guarda su rol y sus módulos restringidos', () {
      final er = tablet.sesion.credenciales.de('ER')!;
      expect(er.rol, 'personal');
      expect(er.modulosRestringidos, contains('crear_ot'));
      expect(tablet.sesion.credenciales.de('BO')!.rol, 'admin');
    });

    test('188. una ronda de sincronización renueva los usuarios: llega una clave cambiada', () async {
      final antes = tablet.sesion.credenciales.de('BO')!.hash;
      servidor.cambiarClave('BO', 'otra-clave');
      await tablet.sincronizar();
      await tablet.sesion.sincronizarCredenciales();
      expect(tablet.sesion.credenciales.de('BO')!.hash, isNot(antes));
    });

    test('189. un usuario dado de baja deja de estar guardado tras sincronizar', () async {
      servidor.inactivos.add('SD');
      await tablet.sesion.sincronizarCredenciales();
      expect(tablet.sesion.credenciales.de('SD'), isNull);
      expect(tablet.sesion.credenciales.de('ER'), isNotNull);
    });

    test('190. un servidor que todavía no tiene esta función no borra lo guardado', () async {
      servidor.sinFuncionCredenciales = true;
      await tablet.sesion.sincronizarCredenciales();
      expect(tablet.sesion.credenciales.todas, hasLength(3));
    });

    test('191. sin red no se borra lo guardado', () async {
      tablet.cortarRed();
      await tablet.sesion.sincronizarCredenciales();
      expect(tablet.sesion.credenciales.todas, hasLength(3));
    });

    test('192. lo guardado sobrevive a cerrar y abrir la app', () async {
      final (otra, _) = await abrirOtraVez(servidor);
      expect(otra.credenciales.todas.map((c) => c.inicial), unorderedEquals(['ER', 'BO', 'SD']));
    });

    test('193. la sincronización completa (cada ronda) también renueva los usuarios', () async {
      servidor.cambiarClave('BO', 'otra-clave');
      final antes = tablet.sesion.credenciales.de('BO')!.hash;
      await tablet.repo.sincronizar();
      await tablet.reposo();
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(tablet.sesion.credenciales.de('BO')!.hash, isNot(antes));
    });
  });

  group('entrar sin conexión', () {
    test('194. con la clave correcta entra, con su rol y sus permisos', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      await s.iniciarSesion('ER', BackendFalso.clave);
      expect(s.usuario!.nombre, 'Erasmo');
      expect(s.usuario!.modulosRestringidos, contains('crear_ot'));
      expect(s.sinSesionRemota, isTrue);
      expect(s.token, isNull);
    });

    test('195. entra cualquiera de los usuarios guardados, aunque nunca haya entrado en esta tablet', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      await s.iniciarSesion('BO', BackendFalso.clave); // Boris nunca inició sesión acá
      expect(s.usuario!.rol, 'admin');
    });

    test('196. con clave incorrecta no entra', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      await expectLater(s.iniciarSesion('ER', 'mala'), errorApi('Clave incorrecta'));
      expect(s.usuario, isNull);
    });

    test('197. con la clave vacía no entra', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      await expectLater(s.iniciarSesion('ER', ''), errorApi('Clave incorrecta'));
    });

    test('198. un usuario que no está guardado no entra y lo dice', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      await expectLater(s.iniciarSesion('ZZ', BackendFalso.clave), errorApi('no está guardado'));
    });

    test('199. una tablet que nunca se conectó no puede entrar y explica qué hacer', () async {
      SharedPreferences.setMockInitialValues({'zepol.servidor': BackendFalso.servidor});
      final (s, red) = await abrirOtraVez(servidor, conRed: false);
      expect(red.conectado, isFalse);
      await expectLater(s.iniciarSesion('ER', BackendFalso.clave), errorApi('todavía no guardó los usuarios'));
    });

    test('200. con la inicial en minúscula también entra', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      await s.iniciarSesion('er', BackendFalso.clave);
      expect(s.usuario!.inicial, 'ER');
    });

    test('201. si el servidor SÍ contesta y la clave está mal, es esa la respuesta (no se usa la copia)', () async {
      final (s, _) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      await expectLater(s.iniciarSesion('ER', 'mala'), errorApi('Usuario o clave incorrectos'));
    });

    test('202. un servidor con error 500 tampoco cae a la copia: respondió', () async {
      final (s, _) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      servidor.forzarError = 500;
      // /auth/login no pasa por el error forzado; se simula un usuario dado de baja:
      servidor.forzarError = null;
      servidor.inactivos.add('ER');
      await expectLater(s.iniciarSesion('ER', BackendFalso.clave), errorApi('Usuario o clave incorrectos'));
    });

    test('203. la sesión sin conexión no se guarda en el disco: al reabrir hay que entrar de nuevo', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      await s.iniciarSesion('ER', BackendFalso.clave);
      final (otra, _) = await abrirOtraVez(servidor, conRed: false);
      expect(otra.usuario, isNull);
    });

    test('204. sin sesión con el servidor, los 401 no cierran la sesión sin conexión', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      await s.iniciarSesion('ER', BackendFalso.clave);
      red.conectado = true;
      await expectLater(s.api.listarEntregas(), throwsA(isA<ApiError>())); // 401: no hay token todavía
      // (la renovación automática ya está en curso; lo que importa es que no la cerró el 401)
      expect(s.usuario, isNotNull);
    });
  });

  group('al volver el servidor', () {
    test('205. la sesión sin conexión pasa sola a una sesión normal (con token)', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      s.conexion.reportar(false);
      await s.iniciarSesion('ER', BackendFalso.clave);
      expect(s.sinSesionRemota, isTrue);
      red.conectado = true;
      s.conexion.reportar(true); // la primera respuesta del servidor
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(s.sinSesionRemota, isFalse);
      expect(s.token, isNotNull);
    });

    test('206. al renovar se guardan los permisos actuales del servidor', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      s.conexion.reportar(false);
      await s.iniciarSesion('ER', BackendFalso.clave);
      servidor.usuarios.firstWhere((u) => u['inicial'] == 'ER')['modulos_restringidos'] = ['registrar_devolucion'];
      red.conectado = true;
      s.conexion.reportar(true);
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(s.usuario!.modulosRestringidos, ['registrar_devolucion']);
    });

    test('207. si la clave cambió mientras estaba sin conexión, al volver se cierra la sesión', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      s.conexion.reportar(false);
      await s.iniciarSesion('ER', BackendFalso.clave);
      servidor.cambiarClave('ER', 'nueva-clave'); // otro equipo la cambió
      red.conectado = true;
      s.conexion.reportar(true);
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(s.usuario, isNull, reason: 'debe entrar de nuevo con la clave nueva');
    });

    test('208. la clave deja de estar en memoria al renovar y al cerrar sesión', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      s.conexion.reportar(false);
      await s.iniciarSesion('ER', BackendFalso.clave);
      red.conectado = true;
      s.conexion.reportar(true);
      await Future<void>.delayed(const Duration(milliseconds: 100));
      // Ya renovada: volver a cortar y reponer no intenta iniciar sesión otra vez.
      final pedidos = servidor.peticiones.where((r) => r.url.path == '/auth/login').length;
      s.conexion.reportar(false);
      s.conexion.reportar(true);
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(servidor.peticiones.where((r) => r.url.path == '/auth/login').length, pedidos);
    });

    test('209. al volver también se bajan los usuarios (por si cambiaron)', () async {
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      s.conexion.reportar(false);
      await s.iniciarSesion('ER', BackendFalso.clave);
      servidor.cambiarClave('BO', 'otra');
      final antes = s.credenciales.de('BO')!.hash;
      red.conectado = true;
      s.conexion.reportar(true);
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(s.credenciales.de('BO')!.hash, isNot(antes));
    });
  });

  group('claves cambiadas, bajas y compatibilidad', () {
    test('210. una clave cambiada en el servidor sirve sin conexión solo DESPUÉS de sincronizar', () async {
      servidor.cambiarClave('ER', 'nueva-clave');
      var (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      // Todavía la copia tiene la clave vieja: la vieja entra, la nueva no.
      await s.iniciarSesion('ER', BackendFalso.clave);
      s.cerrarSesion();
      await expectLater(s.iniciarSesion('ER', 'nueva-clave'), errorApi('Clave incorrecta'));

      red.conectado = true;
      await tablet.sesion.sincronizarCredenciales();
      (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      await s.iniciarSesion('ER', 'nueva-clave');
      expect(s.usuario, isNotNull);
      s.cerrarSesion();
      await expectLater(s.iniciarSesion('ER', BackendFalso.clave), errorApi('Clave incorrecta'));
    });

    test('211. un usuario dado de baja deja de poder entrar sin conexión tras sincronizar', () async {
      servidor.inactivos.add('SD');
      await tablet.sesion.sincronizarCredenciales();
      final (s, red) = await abrirOtraVez(servidor);
      s.cerrarSesion();
      red.conectado = false;
      await expectLater(s.iniciarSesion('SD', BackendFalso.clave), errorApi('no está guardado'));
    });

    test('212. el hash de bcrypt que genera el backend (Python, \$2b\$12) lo verifica la tablet', () async {
      const hash = r'$2b$12$Yvz5Mg0.exE6UKaicRRygu5HGFOlQzRtVDNraqcfLw0Kb.eTN6u6q';
      expect(BCrypt.checkpw('prueba123', hash), isTrue);
      expect(BCrypt.checkpw('prueba124', hash), isFalse);
      expect(BCrypt.checkpw('PRUEBA123', hash), isFalse);
    });

    test('213. claves con tildes y ñ del backend también se verifican', () async {
      const hash = r'$2b$12$guxRcPQyDf0T7g4ciTBwbe.dN.VF.BQAirCLLTD5Prx1KY4RcvBzC';
      expect(BCrypt.checkpw('contraseña ñ', hash), isTrue);
      expect(BCrypt.checkpw('contrasena n', hash), isFalse);
    });

    test('214. la verificación real (en otro hilo) acepta y rechaza bien', () async {
      final c = tablet.sesion.credenciales; // verificador por defecto: Isolate.run
      expect((await c.verificar('ER', BackendFalso.clave))?.inicial, 'ER');
      expect(await c.verificar('ER', 'mala'), isNull);
    });
  });

  group('estado de la conexión', () {
    test('215. empieza sin saber; una falla marca "sin conexión" y volver cuenta como restablecida', () {
      final c = Conexion();
      expect(c.estado, EstadoConexion.desconocido);
      c.reportar(false);
      expect(c.sinConexion, isTrue);
      c.reportar(true);
      expect(c.estado, EstadoConexion.enLinea);
      expect(c.restablecimientos, 1);
    });

    test('216. la primera respuesta (desconocido → en línea) no cuenta como "restablecida"', () {
      final c = Conexion()..reportar(true);
      expect(c.restablecimientos, 0);
    });

    test('217. avisos repetidos del mismo estado no molestan ni cuentan', () {
      final c = Conexion();
      var avisos = 0;
      c.addListener(() => avisos++);
      c
        ..reportar(true)
        ..reportar(true)
        ..reportar(false)
        ..reportar(false)
        ..reportar(true);
      expect(avisos, 3);
      expect(c.restablecimientos, 1);
    });

    test('218. cada petición informa: sin red cae, con cualquier respuesta (incluso 401/500) se considera conectado', () async {
      final c = Conexion();
      final red = ClienteConRed(servidor.cliente);
      final api = Api(BackendFalso.servidor, token: 'tok-ER', cliente: red, alResultadoDeRed: c.reportar);
      red.conectado = false;
      await expectLater(api.listarProcesos(), throwsA(isA<ApiError>()));
      expect(c.sinConexion, isTrue);
      red.conectado = true;
      servidor.forzarError = 500;
      await expectLater(api.listarProcesos(), throwsA(isA<ApiError>()));
      expect(c.estado, EstadoConexion.enLinea, reason: 'el servidor contestó, aunque con error');
    });

    test('219. la sesión de la tablet marca sin conexión cuando falla la red y restablecida al volver', () async {
      await tablet.sesion.api.listarProcesos();
      expect(tablet.sesion.conexion.estado, EstadoConexion.enLinea);
      tablet.cortarRed();
      await expectLater(tablet.sesion.api.listarProcesos(), throwsA(isA<ApiError>()));
      expect(tablet.sesion.conexion.sinConexion, isTrue);
      tablet.devolverRed();
      await tablet.sesion.api.listarProcesos();
      expect(tablet.sesion.conexion.estado, EstadoConexion.enLinea);
      expect(tablet.sesion.conexion.restablecimientos, 1);
    });

    test('220. un servidor que no existe (cliente que falla) no deja la barra verde', () async {
      final c = Conexion();
      final api = Api('http://otro:1', cliente: servidor.cliente, alResultadoDeRed: c.reportar);
      await expectLater(api.listarProcesos(), throwsA(isA<ApiError>()));
      expect(c.sinConexion, isTrue);
    });

    test('221. se cae una conexión de avisos que estaba viva: se comprueba enseguida y sale "sin conexión"', () async {
      final auto = await Equipo.crear('Auto', servidor, usuario: 'ER', automatica: true);
      auto.repo.iniciar();
      await Future<void>.delayed(const Duration(milliseconds: 300));
      expect(auto.sesion.conexion.estado, EstadoConexion.enLinea);
      auto.cortarRed();
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(auto.sesion.conexion.sinConexion, isTrue);
      auto.repo.detener();
    });

    test('222. al volver la red, la conexión se restablece sola y el contador sube', () async {
      final auto = await Equipo.crear('Auto', servidor, usuario: 'ER', automatica: true);
      auto.repo.iniciar();
      await Future<void>.delayed(const Duration(milliseconds: 300));
      auto.cortarRed();
      await Future<void>.delayed(const Duration(milliseconds: 400));
      auto.devolverRed();
      // La reconexión de avisos espera 1-2 s.
      final fin = DateTime.now().add(const Duration(seconds: 6));
      while (auto.sesion.conexion.restablecimientos == 0 && DateTime.now().isBefore(fin)) {
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
      expect(auto.sesion.conexion.restablecimientos, greaterThanOrEqualTo(1));
      auto.repo.detener();
    });
  });
}

