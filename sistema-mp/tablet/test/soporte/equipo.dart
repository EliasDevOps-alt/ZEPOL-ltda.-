import 'dart:async';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:zepol_tablet/api/api.dart';
import 'package:zepol_tablet/estado/repositorio.dart';
import 'package:zepol_tablet/estado/sesion.dart';

import 'backend_falso.dart';

/// La conexión de UN equipo al servidor, que se puede cortar sin afectar a los
/// demás (la tablet sin wifi mientras la PC sigue conectada).
class ClienteConRed extends http.BaseClient {
  ClienteConRed(this._interno);
  final http.Client _interno;
  bool _conectado = true;
  final _flujos = <StreamController<List<int>>>[];

  bool get conectado => _conectado;

  /// Al cortar la red también se caen las conexiones abiertas (los avisos).
  set conectado(bool valor) {
    _conectado = valor;
    if (!valor) {
      for (final f in _flujos) {
        if (!f.isClosed) f.addError(http.ClientException('Sin wifi'));
        f.close();
      }
      _flujos.clear();
    }
  }

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (!_conectado) throw http.ClientException('Sin wifi', request.url);
    final res = await _interno.send(request);
    if (request.url.path != '/eventos' || res.statusCode != 200) return res;
    final c = StreamController<List<int>>();
    _flujos.add(c);
    res.stream.listen((datos) {
      if (!c.isClosed) c.add(datos);
    }, onDone: () {
      if (!c.isClosed) c.close();
    }, onError: (Object e) {
      if (!c.isClosed) c.addError(e);
    });
    return http.StreamedResponse(c.stream, res.statusCode, request: request);
  }
}

/// Copia local en memoria (el disco de la tablet en los tests).
class DiscoEnMemoria implements AlmacenLocal {
  final datos = <String, String>{};
  @override
  Future<String?> leer(String clave) async => datos[clave];
  @override
  Future<void> guardar(String clave, String texto) async => datos[clave] = texto;
}

/// Un equipo (PC o tablet) con su propia sesión, su propia red y su propia
/// copia local, contra un mismo servidor falso compartido.
class Equipo {
  Equipo._(this.nombre, this.backend, this.red, this.sesion, this.disco);

  final String nombre;
  final BackendFalso backend;
  final ClienteConRed red;
  final Sesion sesion;
  final DiscoEnMemoria disco;

  static Future<Equipo> crear(
    String nombre,
    BackendFalso backend, {
    String usuario = 'ER',
    DiscoEnMemoria? disco,
    bool automatica = false,
  }) async {
    SharedPreferences.setMockInitialValues({});
    final red = ClienteConRed(backend.cliente);
    final d = disco ?? DiscoEnMemoria();
    final sesion = Sesion(cliente: red, almacen: d, sincronizacionAutomatica: automatica);
    await sesion.cargar();
    await sesion.fijarServidor(BackendFalso.servidor);
    await sesion.iniciarSesion(usuario, BackendFalso.clave);
    // Los usuarios para entrar sin conexión se bajan sin esperar: acá se deja listo.
    await sesion.sincronizarCredenciales();
    return Equipo._(nombre, backend, red, sesion, d);
  }

  Api get api => sesion.api;
  Repositorio get repo => sesion.repo;

  void cortarRed() => red.conectado = false;
  void devolverRed() => red.conectado = true;

  /// Espera a que la copia deje de sincronizarse (incluida la vuelta extra que
  /// se pide cuando algo se registró en plena ronda).
  Future<void> reposo() async {
    do {
      await Future<void>.delayed(const Duration(milliseconds: 2));
    } while (repo.sincronizando);
  }

  /// Sincroniza y espera a que termine todo.
  Future<void> sincronizar() async {
    await repo.sincronizar();
    await reposo();
  }

  // Atajos de uso común
  Future<int> entregar(int pedido, List<double> bobinas, {String fecha = '2026-11-03'}) async =>
      (await api.registrarEntrega(otMaterialId: pedido, fecha: fecha, bobinas: bobinas)).id;

  Future<int> devolver(int pedido, int material, List<double> bobinas, {String fecha = '2026-11-03'}) async =>
      (await api.registrarDevolucion(otMaterialId: pedido, materialId: material, fecha: fecha, bobinas: bobinas)).id;
}

/// Crea una OT nueva (con un pedido) directamente en el servidor falso, como si
/// alguien la hubiera cargado desde la PC o el Excel.
void crearOtEnServidor(BackendFalso b, String numero, {int pedidoId = 900, String cliente = 'Cliente nuevo'}) {
  b.ordenes.add({
    'id': 50 + b.ordenes.length,
    'numero_ot': numero,
    'cliente': cliente,
    'diseno': null,
    'descripcion_producto': null,
    'fecha_creacion': '2026-11-03T08:00:00',
  });
  b.pedidos.add({
    'id': pedidoId,
    'ot': numero,
    'material_id': 100,
    'proceso_id': 1,
    'maquina_id': 11,
    'requerido': 100.0,
    'insumo_de': null,
  });
}
