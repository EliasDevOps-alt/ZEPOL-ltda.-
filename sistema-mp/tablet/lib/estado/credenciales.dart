import 'dart:async';
import 'dart:convert';
import 'dart:isolate';

import 'package:bcrypt/bcrypt.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/modelos.dart';

/// Un usuario tal como lo guarda la tablet para poder entrar sin conexión: lo
/// necesario para armar la sesión y el hash bcrypt de su clave (nunca la clave).
class CredencialLocal {
  CredencialLocal({
    required this.id,
    required this.inicial,
    required this.nombre,
    required this.rol,
    required this.modulosRestringidos,
    required this.hash,
  });

  final int id;
  final String inicial;
  final String nombre;
  final String rol;
  final List<String> modulosRestringidos;
  final String hash;

  factory CredencialLocal.fromJson(Map<String, dynamic> j) => CredencialLocal(
        id: j['id'] as int,
        inicial: j['inicial'] as String,
        nombre: j['nombre'] as String,
        rol: j['rol'] as String,
        modulosRestringidos: List<String>.from(j['modulos_restringidos'] as List? ?? const []),
        hash: j['password_hash'] as String,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'inicial': inicial,
        'nombre': nombre,
        'rol': rol,
        'modulos_restringidos': modulosRestringidos,
        'password_hash': hash,
      };

  Usuario toUsuario() =>
      Usuario(id: id, inicial: inicial, nombre: nombre, rol: rol, modulosRestringidos: modulosRestringidos);

  UsuarioLogin toLogin() => UsuarioLogin(inicial, nombre);
}

/// Comprueba una clave contra un hash bcrypt.
typedef VerificadorDeClave = Future<bool> Function(String clave, String hash);

/// Por defecto en otro hilo: bcrypt es lento a propósito y en la tablet
/// congelaría la pantalla mientras se calcula.
Future<bool> verificarClaveEnSegundoPlano(String clave, String hash) =>
    Isolate.run(() => BCrypt.checkpw(clave, hash));

/// Los usuarios con el hash de su clave, bajados del servidor mientras hay
/// conexión, para poder iniciar sesión cuando no la hay. Se renuevan en cada
/// sincronización: un cambio de clave o un usuario dado de baja llegan solos.
class CredencialesLocales {
  CredencialesLocales({VerificadorDeClave? verificador}) : _verificar = verificador ?? verificarClaveEnSegundoPlano;

  final VerificadorDeClave _verificar;
  SharedPreferences? _prefs;
  String? _servidor;
  List<CredencialLocal> _lista = const [];

  String get _clave => 'zepol.credenciales:$_servidor';

  /// Carga lo guardado para ese servidor (cada servidor tiene lo suyo).
  Future<void> abrir(SharedPreferences prefs, String? servidor) async {
    _prefs = prefs;
    _servidor = servidor;
    _lista = const [];
    final crudo = prefs.getString(_clave);
    if (crudo == null) return;
    try {
      _lista = (jsonDecode(crudo) as List).map((e) => CredencialLocal.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      _lista = const []; // una copia ilegible se ignora: se vuelve a bajar
    }
  }

  List<CredencialLocal> get todas => _lista;
  bool get hayGuardadas => _lista.isNotEmpty;

  /// Reemplaza lo guardado por lo que acaba de decir el servidor.
  Future<void> reemplazar(List<CredencialLocal> nuevas) async {
    _lista = List.unmodifiable(nuevas);
    await _prefs?.setString(_clave, jsonEncode(nuevas.map((c) => c.toJson()).toList()));
  }

  Future<void> borrar() async {
    _lista = const [];
    await _prefs?.remove(_clave);
  }

  CredencialLocal? de(String inicial) {
    final i = inicial.trim().toUpperCase();
    for (final c in _lista) {
      if (c.inicial.toUpperCase() == i) return c;
    }
    return null;
  }

  /// El usuario si la clave es correcta, o null.
  Future<CredencialLocal?> verificar(String inicial, String clave) async {
    final c = de(inicial);
    if (c == null || clave.isEmpty) return null;
    return await _verificar(clave, c.hash) ? c : null;
  }
}
