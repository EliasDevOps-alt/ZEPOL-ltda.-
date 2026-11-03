import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api.dart';
import '../api/modelos.dart';
import '../actualizacion/actualizador.dart';
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
  }) {
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
  }

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
  Api get apiPublica => Api(servidor!, cliente: cliente);

  /// La API con el token; un 401 cierra la sesión y vuelve al login.
  Api get api => Api(servidor!,
      token: token, alExpirarSesion: cerrarSesion, alEscribir: () => unawaited(repo.sincronizar()), cliente: cliente);

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
  Future<void> probarServidor(String url) => Api(normalizarServidor(url), cliente: cliente).listarUsuariosLogin();

  Future<void> fijarServidor(String url) async {
    final limpia = normalizarServidor(url);
    servidor = limpia;
    await _prefs.setString(_claveServidor, limpia);
    notifyListeners();
    actualizador.iniciar();
  }

  Future<void> iniciarSesion(String inicial, String password) async {
    final (nuevoToken, nuevoUsuario) = await apiPublica.login(inicial, password);
    token = nuevoToken;
    usuario = nuevoUsuario;
    await _prefs.setString(_claveSesion, jsonEncode({'token': nuevoToken, 'usuario': nuevoUsuario.toJson()}));
    await _prefs.setString(_claveUltimo, inicial);
    notifyListeners();
  }

  void cerrarSesion() {
    repo.detener();
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
