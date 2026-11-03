import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api.dart';
import '../api/modelos.dart';
import '../actualizacion/actualizador.dart';
import 'conexion.dart';
import 'credenciales.dart';
import 'repositorio.dart';

/// Dirección del servidor y sesión iniciada, guardadas en la tablet: una vez
/// configurada la IP y hecho el login, al volver a abrir la app sigue adentro
/// (igual que el escritorio con config.json y localStorage).
class Sesion extends ChangeNotifier {
  Sesion({
    this.cliente,
    AlmacenLocal? almacen,
    bool sincronizacionAutomatica = false,
    PlataformaActualizador? plataforma,
    VerificadorDeClave? verificadorDeClave,
  }) : credenciales = CredencialesLocales(verificador: verificadorDeClave) {
    repo = Repositorio(
      api: () => api,
      servidor: () => servidor,
      almacen: almacen,
      automatica: sincronizacionAutomatica,
    );
    actualizador = Actualizador(
      servidor: () => servidor,
      plataforma: plataforma,
      cliente: cliente,
      automatica: sincronizacionAutomatica,
    );
    // Cada ronda completa renueva también los usuarios para entrar sin conexión.
    repo.alRondaCompleta = () => unawaited(sincronizarCredenciales());
    // Si se entró sin conexión, al volver el servidor se pasa a una sesión normal.
    conexion.addListener(_alCambiarConexion);
  }

  /// Si la tablet puede hablar con el servidor (barra roja / verde).
  final conexion = Conexion();

  /// Usuarios y hash de sus claves, bajados del servidor para poder entrar sin conexión.
  final CredencialesLocales credenciales;

  /// Busca versiones nuevas de la app en el servidor y las baja (ver actualizacion/).
  late final Actualizador actualizador;

  /// Copia local de los datos, puesta al día en segundo plano.
  late final Repositorio repo;

  // Conexión HTTP: null en la app; un backend falso en los tests.
  final http.Client? cliente;

  static const _claveServidor = 'zepol.servidor';
  static const _claveSesion = 'zepol.sesion';
  static const _claveUsuarios = 'zepol.login.usuarios';
  static const _claveUltimo = 'zepol.login.ultimo';

  late SharedPreferences _prefs;
  bool cargada = false;
  String? servidor;
  String? token;
  Usuario? usuario;

  Future<void> cargar() async {
    _prefs = await SharedPreferences.getInstance();
    servidor = _prefs.getString(_claveServidor);
    await credenciales.abrir(_prefs, servidor);
    final cruda = _prefs.getString(_claveSesion);
    if (cruda != null) {
      try {
        final j = jsonDecode(cruda) as Map<String, dynamic>;
        token = j['token'] as String;
        usuario = Usuario.fromJson(j['usuario'] as Map<String, dynamic>);
      } catch (_) {
        await _prefs.remove(_claveSesion);
      }
    }
    cargada = true;
    notifyListeners();
    // La copia guardada se lee sin frenar el arranque.
    if (servidor != null && usuario != null) unawaited(repo.cargarDelDisco());
    // Se busca una versión nueva aunque todavía no haya sesión iniciada.
    if (servidor != null) actualizador.iniciar();
  }

  /// La API sin sesión (para la lista de usuarios y el login).
  Api get apiPublica => Api(servidor!, alResultadoDeRed: conexion.reportar, cliente: cliente);

  /// La API con el token; un 401 cierra la sesión y vuelve al login.
  Api get api => Api(servidor!,
      token: token,
      alExpirarSesion: cerrarSesion,
      alEscribir: () => unawaited(repo.sincronizar()),
      alResultadoDeRed: conexion.reportar,
      cliente: cliente);

  /// "192.168.121.72:8000/" → "http://192.168.121.72:8000".
  static String normalizarServidor(String url) {
    var limpia = url.trim();
    if (!limpia.startsWith('http://') && !limpia.startsWith('https://')) limpia = 'http://$limpia';
    while (limpia.endsWith('/')) {
      limpia = limpia.substring(0, limpia.length - 1);
    }
    return limpia;
  }

  /// Comprueba que en esa dirección responda el sistema, sin guardarla.
  Future<void> probarServidor(String url) =>
      Api(normalizarServidor(url), alResultadoDeRed: conexion.reportar, cliente: cliente).listarUsuariosLogin();

  Future<void> fijarServidor(String url) async {
    final limpia = normalizarServidor(url);
    servidor = limpia;
    await _prefs.setString(_claveServidor, limpia);
    await credenciales.abrir(_prefs, limpia);
    notifyListeners();
    actualizador.iniciar();
  }

  // La clave con que se entró SIN conexión, solo en memoria y solo hasta que vuelva
  // el servidor (para pasar a una sesión normal sin pedirla de nuevo).
  String? _claveSinConexion;
  bool _renovando = false;

  /// Se entró sin conexión: hay usuario pero todavía no una sesión con el servidor.
  bool get sinSesionRemota => usuario != null && token == null;

  /// Entra con el servidor; si no hay conexión, con los usuarios guardados en la tablet.
  Future<void> iniciarSesion(String inicial, String password) async {
    try {
      final (nuevoToken, nuevoUsuario) = await apiPublica.login(inicial, password);
      token = nuevoToken;
      usuario = nuevoUsuario;
      _claveSinConexion = null;
      await _prefs.setString(_claveSesion, jsonEncode({'token': nuevoToken, 'usuario': nuevoUsuario.toJson()}));
      await _prefs.setString(_claveUltimo, inicial);
      notifyListeners();
      // Con la sesión ya se pueden bajar los usuarios para la próxima vez sin conexión.
      unawaited(sincronizarCredenciales());
    } on ApiError catch (e) {
      // Si el servidor contestó (clave incorrecta, usuario inactivo...) es la respuesta final.
      if (e.status != null) rethrow;
      await _iniciarSinConexion(inicial, password, e);
    }
  }

  Future<void> _iniciarSinConexion(String inicial, String password, ApiError causa) async {
    if (!credenciales.hayGuardadas) {
      throw ApiError('Sin conexión con el servidor, y esta tablet todavía no guardó los usuarios. '
          'Conéctala al servidor una vez para poder entrar sin conexión.');
    }
    final cred = await credenciales.verificar(inicial, password);
    if (cred == null) {
      throw ApiError(credenciales.de(inicial) == null
          ? 'Sin conexión con el servidor: ese usuario no está guardado en esta tablet.'
          : 'Clave incorrecta (sin conexión con el servidor).');
    }
    usuario = cred.toUsuario();
    token = null; // todavía sin sesión con el servidor
    _claveSinConexion = password;
    await _prefs.setString(_claveUltimo, inicial);
    notifyListeners();
  }

  /// Baja los usuarios (con el hash de su clave) para poder entrar sin conexión.
  Future<void> sincronizarCredenciales() async {
    if (token == null || servidor == null) return;
    try {
      final lista = await api.credencialesOffline();
      if (lista.isNotEmpty) await credenciales.reemplazar(lista);
    } catch (_) {
      // Sin conexión o servidor sin esta función: se queda lo que ya había.
    }
  }

  void _alCambiarConexion() {
    if (conexion.estado == EstadoConexion.enLinea && sinSesionRemota) unawaited(_renovarSesion());
  }

  /// Volvió el servidor y se había entrado sin conexión: se inicia la sesión de verdad.
  Future<void> _renovarSesion() async {
    final u = usuario;
    final clave = _claveSinConexion;
    if (_renovando || u == null || clave == null || servidor == null) return;
    _renovando = true;
    try {
      final (nuevoToken, nuevoUsuario) = await apiPublica.login(u.inicial, clave);
      token = nuevoToken;
      usuario = nuevoUsuario;
      _claveSinConexion = null;
      await _prefs.setString(_claveSesion, jsonEncode({'token': nuevoToken, 'usuario': nuevoUsuario.toJson()}));
      notifyListeners();
      unawaited(sincronizarCredenciales());
      unawaited(repo.sincronizar());
    } on ApiError catch (e) {
      // La clave cambió mientras estaba sin conexión: que entre de nuevo.
      if (e.status == 401) cerrarSesion();
    } finally {
      _renovando = false;
    }
  }

  void cerrarSesion() {
    repo.detener();
    _claveSinConexion = null;
    token = null;
    usuario = null;
    _prefs.remove(_claveSesion);
    notifyListeners();
  }

  String get ultimoUsuario => _prefs.getString(_claveUltimo) ?? '';

  // La lista de usuarios casi nunca cambia: se muestra la guardada al instante
  // mientras llega la del servidor (mismo criterio que Login.tsx).
  List<UsuarioLogin>? usuariosGuardados() {
    final crudo = _prefs.getString('$_claveUsuarios:$servidor');
    if (crudo == null) return null;
    try {
      return (jsonDecode(crudo) as List).map((e) => UsuarioLogin.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return null;
    }
  }

  void guardarUsuarios(List<UsuarioLogin> lista) {
    _prefs.setString('$_claveUsuarios:$servidor', jsonEncode(lista.map((u) => u.toJson()).toList()));
  }
}
