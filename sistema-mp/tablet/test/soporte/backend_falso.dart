import 'dart:async';
import 'package:bcrypt/bcrypt.dart';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Backend en memoria con los mismos endpoints (y las mismas reglas básicas)
/// que el FastAPI real, para probar la app sin servidor ni base de datos.
/// Lo usan las pruebas de widgets y las de integración (que corren en la
/// tablet). Cada petición queda en [peticiones] para comprobar qué mandó la app.
///
/// Datos de ejemplo — OT 1000 (Coronilla S.A.), armada como los casos reales:
///  - pedido 10: BOPP20620 en Laminación/NORD, 2 entregas (A y B) y un
///    sobrante de la A con el SID ya registrado (no se puede corregir);
///  - pedido 11: LDPE-3, se fabrica en esta OT (tiene materia prima), con 150 kg
///    ya ingresados a almacén;
///  - pedido 12: PA15520 en Impresión/F4, sin entregas todavía;
///  - pendiente 50: "LDPE45840" del Excel, sin material del catálogo;
///  - cargo de tinta "Laminación" (no se muestra en Entrega/Devolución).
class BackendFalso {
  BackendFalso() {
    _cargarDatos();
  }

  static const servidor = 'http://servidor-falso:8000';
  static const clave = 'clave';

  final peticiones = <http.Request>[];

  /// Si se define, toda petición autenticada responde este código (ej. 401).
  int? forzarError;

  /// Hash bcrypt de la clave de cada usuario (como los guarda el backend); se
  /// calculan una vez y rápido (4 vueltas) para no demorar las pruebas.
  late final hashes = <String, String>{
    for (final u in usuarios) u['inicial'] as String: BCrypt.hashpw(clave, BCrypt.gensalt(logRounds: 4)),
  };

  /// Claves cambiadas en el servidor (inicial → clave nueva); su hash cambia con ellas.
  final cambiosDeClave = <String, String>{};
  bool sinFuncionCredenciales = false;

  /// Cambia la clave de un usuario en el servidor.
  void cambiarClave(String inicial, String nueva) {
    cambiosDeClave[inicial] = nueva;
    hashes[inicial] = BCrypt.hashpw(nueva, BCrypt.gensalt(logRounds: 4));
  }

  /// Usuarios que el servidor NO entrega para entrar sin conexión (dados de baja).
  final inactivos = <String>{};

  /// Versión de la app de la tablet publicada en /updates/tablet (null = ninguna).
  Map<String, dynamic>? manifiestoTablet;
  List<int> apkTablet = [];

  /// Simula que el servidor no es alcanzable (sin wifi): toda petición falla de red.
  bool sinRed = false;

  late final http.Client cliente = _ConAvisos(MockClient(_atender), this);

  // ---- Avisos en tiempo real (GET /eventos, text/event-stream) ----
  final _flujos = <StreamController<List<int>>>[];

  /// Cuántas conexiones de avisos hay abiertas.
  int get conexionesDeAvisos => _flujos.where((f) => !f.isClosed).length;

  Future<http.StreamedResponse> _abrirAvisos(http.BaseRequest req) async {
    if (sinRed) throw http.ClientException('Sin conexión', req.url);
    peticiones.add(http.Request('GET', req.url)..headers.addAll(req.headers));
    final auth = req.headers['Authorization'] ?? req.headers['authorization'];
    if (auth == null || !auth.startsWith('Bearer tok-')) {
      return http.StreamedResponse(Stream.value(utf8.encode('{"detail":"Credenciales inválidas"}')), 401, request: req);
    }
    final flujo = StreamController<List<int>>();
    _flujos.add(flujo);
    flujo.add(utf8.encode(': conectado$_finDeEvento'));
    return http.StreamedResponse(flujo.stream, 200, request: req);
  }

  // Un evento de text/event-stream termina con una línea en blanco.
  static const _finDeEvento = '\n\n';

  void _escribirAvisos(String texto) {
    for (final f in _flujos) {
      if (!f.isClosed) f.add(utf8.encode('$texto$_finDeEvento'));
    }
  }

  /// El servidor avisa que cambiaron estas OT (o `todo` si cambió mucho).
  void avisar(List<String> ots, {bool todo = false}) =>
      _escribirAvisos('data: ${jsonEncode({'ots': todo ? [] : ots, if (todo) 'todo': true, 't': 0})}');

  void latido() => _escribirAvisos(': latido');
  void avisoIlegible() => _escribirAvisos('data: {esto no es json');

  /// El servidor corta las conexiones de avisos (se cayó, se reinició).
  void cortarAvisos() {
    for (final f in _flujos) {
      if (!f.isClosed) f.close();
    }
    _flujos.clear();
  }

  // ---- Estado ----
  final usuarios = <Map<String, dynamic>>[
    {
      'id': 1,
      'inicial': 'ER',
      'nombre': 'Erasmo',
      'rol': 'personal',
      'modulos_restringidos': ['crear_ot', 'registro_sid', 'excel_oc_mp', 'materiales', 'maquinas'],
    },
    {'id': 2, 'inicial': 'BO', 'nombre': 'Boris', 'rol': 'admin', 'modulos_restringidos': <String>[]},
    {
      'id': 3,
      'inicial': 'SD',
      'nombre': 'Sin devoluciones',
      'rol': 'personal',
      'modulos_restringidos': ['registrar_devolucion'],
    },
  ];
  final procesos = [
    {'id': 1, 'nombre': 'Laminación'},
    {'id': 2, 'nombre': 'Impresión'},
    {'id': 3, 'nombre': 'Extrusión'},
  ];
  final maquinas = {
    1: [
      {'id': 11, 'nombre': 'NORD', 'proceso_id': 1},
    ],
    2: [
      {'id': 21, 'nombre': 'F4', 'proceso_id': 2},
    ],
    3: [
      {'id': 31, 'nombre': 'CHINA', 'proceso_id': 3},
    ],
  };
  final materiales = <Map<String, dynamic>>[
    _mat(100, 'BOPP20620', 'BOPP 20 micrones 620 mm', 'kg'),
    _mat(101, 'BOPP20560', 'BOPP 20 micrones 560 mm', 'kg'),
    _mat(102, 'LDPE-3', 'Polietileno 3', 'kg'),
    _mat(103, 'PA15520', 'Poliamida 15', 'kg'),
    _mat(104, 'ZIPPER PP', 'Zipper', 'mts', usaBobinas: false),
    _mat(105, 'Laminación', 'Cargo de tinta', 'kg', esTinta: true),
  ];
  final ordenes = <Map<String, dynamic>>[
    {
      'id': 1,
      'numero_ot': '1000',
      'cliente': 'Coronilla S.A.',
      'diseno': 'Bobinas pastas',
      'descripcion_producto': 'Coronilla Bobinas Pastas 22 cm',
      'fecha_creacion': '2026-10-12T09:28:00',
    },
    {
      'id': 2,
      'numero_ot': '2000',
      'cliente': 'Hipermaxi S.A.',
      'diseno': null,
      'descripcion_producto': null,
      'fecha_creacion': '2026-10-20T10:00:00',
    },
  ];
  // Pedidos (OtMaterial)
  final pedidos = <Map<String, dynamic>>[];
  final pendientes = <Map<String, dynamic>>[];
  final entregas = <Map<String, dynamic>>[];
  final devoluciones = <Map<String, dynamic>>[];
  int _siguienteId = 1000;

  static Map<String, dynamic> _mat(int id, String codigo, String desc, String unidad,
          {bool usaBobinas = true, bool esTinta = false}) =>
      {'id': id, 'codigo_mp': codigo, 'descripcion': desc, 'unidad': unidad, 'es_tinta': esTinta, 'usa_bobinas': usaBobinas};

  void _cargarDatos() {
    pedidos.addAll([
      {'id': 10, 'ot': '1000', 'material_id': 100, 'proceso_id': 1, 'maquina_id': 11, 'requerido': 200.0, 'insumo_de': null},
      {'id': 11, 'ot': '1000', 'material_id': 102, 'proceso_id': 1, 'maquina_id': 11, 'requerido': 100.0, 'insumo_de': null},
      {'id': 12, 'ot': '1000', 'material_id': 103, 'proceso_id': 2, 'maquina_id': 21, 'requerido': 50.0, 'insumo_de': null},
      {'id': 13, 'ot': '1000', 'material_id': 105, 'proceso_id': 1, 'maquina_id': 11, 'requerido': 1.0, 'insumo_de': null},
      // Materia prima del LDPE-3: hace que el pedido 11 "se fabrique en esta OT".
      {'id': 14, 'ot': '1000', 'material_id': 104, 'proceso_id': 3, 'maquina_id': 31, 'requerido': 10.0, 'insumo_de': 11},
    ]);
    pendientes.add({
      'id': 50,
      'ot': '1000',
      'codigo_mp': 'LDPE45840',
      'material_id': null,
      'cantidad_requerida': 80.0,
      'origen_libre': false,
      'materias_primas': <String>[],
    });
    entregas.addAll([
      _entrega(1, pedido: 10, material: 100, fecha: '2026-10-21', hora: '14:14:00', bobinas: [50, 50], usuario: 'ER'),
      _entrega(2, pedido: 10, material: 100, fecha: '2026-10-21', hora: '14:15:00', bobinas: [110], usuario: 'ER'),
    ]);
    devoluciones.addAll([
      _devolucion(1, pedido: 10, material: 100, fecha: '2026-10-21', hora: '15:00:00', bobinas: [30], entrega: 1,
          sid: true),
      _devolucion(2, pedido: 11, material: 102, fecha: '2026-10-22', hora: '09:00:00', bobinas: [150], ingreso: true),
    ]);
  }

  Map<String, dynamic> _entrega(int id,
          {required int pedido,
          required int material,
          required String fecha,
          required String hora,
          required List<num> bobinas,
          String usuario = 'ER',
          int? procesoId,
          int? maquinaId,
          String? observacion,
          bool sid = false}) =>
      {
        'id': id,
        'pedido': pedido,
        'material_id': material,
        'fecha': fecha,
        'hora': hora,
        'bobinas': bobinas.map((b) => b.toDouble()).toList(),
        'usuario': usuario,
        'proceso_id': procesoId,
        'maquina_id': maquinaId,
        'observacion': observacion,
        'sid': sid,
        'editado_por': null,
        'editado_en': null,
      };

  Map<String, dynamic> _devolucion(int id,
          {int? pedido,
          int? pendiente,
          required int material,
          required String fecha,
          required String hora,
          required List<num> bobinas,
          int? entrega,
          bool ingreso = false,
          bool sid = false,
          String usuario = 'ER'}) =>
      {
        'id': id,
        'pedido': pedido,
        'pendiente': pendiente,
        'material_id': material,
        'fecha': fecha,
        'hora': hora,
        'bobinas': bobinas.map((b) => b.toDouble()).toList(),
        'entrega_id': entrega,
        'ingreso': ingreso,
        'sid': sid,
        'usuario': usuario,
        'editado_por': null,
        'editado_en': null,
      };

  // ---- Lo que se calcula (como vista_consumo) ----
  Map<String, dynamic> _material(int id) => materiales.firstWhere((m) => m['id'] == id);
  Map<String, dynamic> _pedido(int id) => pedidos.firstWhere((p) => p['id'] == id);
  Map<String, dynamic> _ot(String n) => ordenes.firstWhere((o) => o['numero_ot'] == n);
  String _proceso(int id) => procesos.firstWhere((p) => p['id'] == id)['nombre'] as String;
  String _maquina(int id) =>
      maquinas.values.expand((l) => l).firstWhere((m) => m['id'] == id)['nombre'] as String;
  double _suma(List b) => (b.fold<double>(0, (a, x) => a + (x as num)) * 1000).round() / 1000;

  double _entregado(int pedido) =>
      _suma(entregas.where((e) => e['pedido'] == pedido).expand((e) => e['bobinas'] as List).toList());
  double _devuelto(int pedido) => _suma(devoluciones
      .where((d) => d['pedido'] == pedido && d['ingreso'] != true)
      .expand((d) => d['bobinas'] as List)
      .toList());
  double _ingresado(int pedido) => _suma(devoluciones
      .where((d) => d['pedido'] == pedido && d['ingreso'] == true)
      .expand((d) => d['bobinas'] as List)
      .toList());

  Map<String, dynamic> _consumo(Map<String, dynamic> p) {
    final m = _material(p['material_id'] as int);
    final ot = _ot(p['ot'] as String);
    final entregado = _entregado(p['id'] as int);
    final requerido = p['requerido'] as double?;
    final movs = entregas.where((e) => e['pedido'] == p['id']).toList();
    final insumoDe = p['insumo_de'] as int?;
    return {
      'ot_material_id': p['id'],
      'numero_ot': p['ot'],
      'cliente': ot['cliente'],
      'proceso': _proceso(p['proceso_id'] as int),
      'proceso_id': p['proceso_id'],
      'maquina': _maquina(p['maquina_id'] as int),
      'maquina_id': p['maquina_id'],
      'diseno': ot['diseno'],
      'material_id': m['id'],
      'codigo_mp': m['codigo_mp'],
      'descripcion': m['descripcion'],
      'unidad': m['unidad'],
      'es_tinta': m['es_tinta'],
      'usa_bobinas': m['usa_bobinas'],
      'es_materia_prima': insumoDe != null,
      'insumo_de_codigo_mp': insumoDe != null ? _material(_pedido(insumoDe)['material_id'] as int)['codigo_mp'] : null,
      'tiene_materia_prima': pedidos.any((x) => x['insumo_de'] == p['id']),
      'estado_sid': movs.isNotEmpty && movs.every((e) => e['sid'] == true) ? 'COMPLETADO' : 'PENDIENTE',
      'sid_devolucion_completado': false,
      'cantidad_requerida': requerido,
      'total_entregado': entregado,
      'total_devuelto': _devuelto(p['id'] as int),
      'total_ingresado': _ingresado(p['id'] as int),
      'consumo_neto': (((entregado - _devuelto(p['id'] as int)) * 1000).round()) / 1000,
      'estado_entrega': entregado <= 0
          ? 'PENDIENTE'
          : (requerido != null && entregado >= requerido ? 'COMPLETO' : 'PARCIAL'),
      'material_sustituido': false,
    };
  }

  Map<String, dynamic> _entregaOut(Map<String, dynamic> e, {bool pedidoCreado = false}) {
    final p = _pedido(e['pedido'] as int);
    final mPedido = _material(p['material_id'] as int);
    final mEntregado = _material(e['material_id'] as int);
    final procesoId = (e['proceso_id'] ?? p['proceso_id']) as int;
    final maquinaId = (e['maquina_id'] ?? p['maquina_id']) as int;
    return {
      'id': e['id'],
      'ot_material_id': p['id'],
      'numero_ot': p['ot'],
      'proceso': _proceso(procesoId),
      'proceso_id': procesoId,
      'maquina': _maquina(maquinaId),
      'maquina_id': maquinaId,
      'diseno': _ot(p['ot'] as String)['diseno'],
      'codigo_mp': mPedido['codigo_mp'],
      'unidad': mPedido['unidad'],
      'usuario': e['usuario'],
      'fecha': e['fecha'],
      'hora': e['hora'],
      'bobinas': e['bobinas'],
      'total_entregado': _suma(e['bobinas'] as List),
      'cantidad_requerida': p['requerido'],
      'total_entregado_pedido': _entregado(p['id'] as int),
      'material_entregado_id': mEntregado['id'],
      'codigo_mp_entregado': mEntregado['codigo_mp'],
      'descripcion_entregado': mEntregado['descripcion'],
      'usa_bobinas': mEntregado['usa_bobinas'],
      'sid_completado': e['sid'],
      'sid_completado_en': e['sid_en'],
      'sid_completado_por': null,
      'total_devuelto_entrega': _suma(devoluciones
          .where((d) => d['entrega_id'] == e['id'] && d['ingreso'] != true)
          .expand((d) => d['bobinas'] as List)
          .toList()),
      'observacion': e['observacion'],
      'pedido_creado': pedidoCreado,
      'editado_por': e['editado_por'],
      'editado_en': e['editado_en'],
    };
  }

  Map<String, dynamic> _devolucionOut(Map<String, dynamic> d) {
    final p = d['pedido'] != null ? _pedido(d['pedido'] as int) : null;
    final pend = d['pendiente'] != null ? pendientes.firstWhere((x) => x['id'] == d['pendiente']) : null;
    final ot = _ot((p ?? pend)!['ot'] as String);
    final m = _material(d['material_id'] as int);
    final ent = d['entrega_id'] != null ? entregas.where((e) => e['id'] == d['entrega_id']).firstOrNull : null;
    return {
      'id': d['id'],
      'ot_material_id': p?['id'],
      'pendiente_id': pend?['id'],
      'numero_ot': ot['numero_ot'],
      'cliente': ot['cliente'],
      'maquina': p != null ? _maquina(p['maquina_id'] as int) : null,
      'proceso': p != null ? _proceso(p['proceso_id'] as int) : null,
      'material_id': m['id'],
      'codigo_mp': m['codigo_mp'],
      'descripcion': m['descripcion'],
      'unidad': m['unidad'],
      'usuario': d['usuario'],
      'fecha': d['fecha'],
      'hora': d['hora'],
      'bobinas': d['bobinas'],
      'total_devuelto': _suma(d['bobinas'] as List),
      'total_devuelto_pedido': p != null ? _devuelto(p['id'] as int) : 0,
      'usa_bobinas': m['usa_bobinas'],
      'sid_completado': d['sid'],
      'sid_completado_en': null,
      'sid_completado_por': null,
      'es_ingreso_produccion': d['ingreso'],
      'entrega_id': ent?['id'],
      'entrega_fecha': ent?['fecha'],
      'entrega_hora': ent?['hora'],
      'editado_por': d['editado_por'],
      'editado_en': d['editado_en'],
    };
  }

  Map<String, dynamic> _pendienteOut(Map<String, dynamic> p) => {
        'id': p['id'],
        'codigo_mp': p['codigo_mp'],
        'material_id': p['material_id'],
        'cantidad_requerida': p['cantidad_requerida'],
        'es_tinta': false,
        'materias_primas': p['materias_primas'],
        'total_ingresado': _suma(devoluciones
            .where((d) => d['pendiente'] == p['id'])
            .expand((d) => d['bobinas'] as List)
            .toList()),
        'origen_libre': p['origen_libre'],
      };

  // ---- HTTP ----

  http.Response _json(Object? cuerpo, [int status = 200]) => http.Response.bytes(
        utf8.encode(jsonEncode(cuerpo)),
        status,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );

  http.Response _error(int status, String detalle) => _json({'detail': detalle}, status);

  Map<String, dynamic>? _usuarioDelToken(http.Request req) {
    final auth = req.headers['Authorization'] ?? req.headers['authorization'];
    if (auth == null || !auth.startsWith('Bearer tok-')) return null;
    final inicial = auth.substring('Bearer tok-'.length);
    return usuarios.where((u) => u['inicial'] == inicial).firstOrNull;
  }

  String _hora() => '16:30:00';

  Future<http.Response> _atender(http.Request req) async {
    // Otra dirección = un servidor que no existe (IP mal escrita).
    if (req.url.host != Uri.parse(servidor).host) throw http.ClientException('Sin conexión', req.url);
    if (sinRed) throw http.ClientException('Sin conexión', req.url);
    peticiones.add(req);
    // Archivos estáticos de actualizaciones: no piden sesión.
    if (req.url.path == '/updates/tablet/latest.json') {
      return manifiestoTablet == null ? _error(404, 'Not Found') : _json(manifiestoTablet);
    }
    if (req.url.path.startsWith('/updates/tablet/') && req.url.path.endsWith('.apk')) {
      return http.Response.bytes(apkTablet, 200);
    }
    final ruta = req.url.path;
    final q = req.url.queryParameters;
    final metodo = req.method;
    Map<String, dynamic> cuerpo() => jsonDecode(req.body) as Map<String, dynamic>;

    if (ruta == '/auth/usuarios') {
      return _json([
        for (final u in usuarios) {'inicial': u['inicial'], 'nombre': u['nombre']},
      ]);
    }
    if (ruta == '/auth/login') {
      final c = cuerpo();
      final u = usuarios.where((x) => x['inicial'] == c['inicial']).firstOrNull;
      final claveReal = cambiosDeClave[c['inicial']] ?? clave;
      if (u == null || inactivos.contains(u['inicial']) || c['password'] != claveReal) {
        return _error(401, 'Usuario o clave incorrectos');
      }
      return _json({'access_token': 'tok-${u['inicial']}', 'token_type': 'bearer', 'usuario': u});
    }

    final usuario = _usuarioDelToken(req);
    if (usuario == null) return _error(401, 'No autenticado');
    if (ruta == '/auth/credenciales-offline') {
      if (sinFuncionCredenciales) return _error(404, 'Not Found');
      return _json([
        for (final u in usuarios)
          if (!inactivos.contains(u['inicial']))
            {...u, 'password_hash': hashes[u['inicial']]},
      ]);
    }
    if (forzarError != null) return _error(forzarError!, 'Error forzado');
    bool puede(String modulo) =>
        usuario['rol'] == 'admin' || !(usuario['modulos_restringidos'] as List).contains(modulo);

    // Catálogos
    if (ruta == '/catalogos/procesos') return _json(procesos);
    if (ruta == '/catalogos/maquinas') return _json(maquinas[int.parse(q['proceso_id']!)] ?? []);
    if (ruta == '/catalogos/materiales') return _json(materiales);

    // OT
    if (ruta == '/ordenes-trabajo') {
      final texto = (q['q'] ?? '').toLowerCase();
      return _json([
        for (final o in ordenes.reversed)
          if (texto.isEmpty ||
              (o['numero_ot'] as String).toLowerCase().contains(texto) ||
              ((o['cliente'] as String?) ?? '').toLowerCase().contains(texto))
            {...o, 'sincronizado_excel': true, 'uso_interno': false},
      ]);
    }
    final rOt = RegExp(r'^/ordenes-trabajo/([^/]+)/(detalle|pendientes|ingreso-libre)$').firstMatch(ruta);
    if (rOt != null) {
      final n = Uri.decodeComponent(rOt.group(1)!).toUpperCase();
      final ot = ordenes.where((o) => o['numero_ot'] == n).firstOrNull;
      if (ot == null) return _error(404, 'OT no encontrada');
      switch (rOt.group(2)) {
        case 'detalle':
          return _json({'numero_ot': n, 'cliente': ot['cliente'], 'descripcion_producto': ot['descripcion_producto']});
        case 'pendientes':
          return _json([for (final p in pendientes.where((p) => p['ot'] == n)) _pendienteOut(p)]);
        case 'ingreso-libre':
          final c = cuerpo();
          final pedido =
              pedidos.where((p) => p['ot'] == n && p['material_id'] == c['material_id']).firstOrNull;
          if (pedido != null) return _json({'ot_material_id': pedido['id'], 'pendiente_id': null});
          final nuevo = {
            'id': _siguienteId++,
            'ot': n,
            'codigo_mp': _material(c['material_id'] as int)['codigo_mp'],
            'material_id': c['material_id'],
            'cantidad_requerida': c['cantidad_requerida'],
            'origen_libre': true,
            'materias_primas': <String>[],
          };
          pendientes.add(nuevo);
          return _json({'ot_material_id': null, 'pendiente_id': nuevo['id']});
      }
    }
    if (ruta == '/consumo') {
      final n = q['numero_ot']?.toUpperCase();
      return _json([
        for (final p in pedidos)
          if (n == null || p['ot'] == n) _consumo(p),
      ]);
    }
    final rProm = RegExp(r'^/ot-materiales-pendientes/(\d+)/promover$').firstMatch(ruta);
    if (rProm != null) {
      final pend = pendientes.firstWhere((p) => p['id'] == int.parse(rProm.group(1)!));
      final c = cuerpo();
      final nuevo = {
        'id': _siguienteId++,
        'ot': pend['ot'],
        'material_id': c['material_id'] ?? pend['material_id'],
        'proceso_id': c['proceso_id'],
        'maquina_id': c['maquina_id'],
        'requerido': pend['cantidad_requerida'],
        'insumo_de': null,
      };
      pedidos.add(nuevo);
      pendientes.remove(pend);
      return _json({'ot_material_id': nuevo['id']});
    }

    // Entregas
    if (ruta == '/entregas' && metodo == 'GET') {
      final n = q['numero_ot']?.toUpperCase();
      return _json([
        for (final e in entregas)
          if (n == null || _pedido(e['pedido'] as int)['ot'] == n) _entregaOut(e),
      ]);
    }
    if (ruta == '/entregas' && metodo == 'POST') {
      if (!puede('registrar_entrega')) return _error(403, 'Sin acceso a registrar_entrega');
      final c = cuerpo();
      final bobinas = (c['bobinas'] as List).cast<num>();
      if (bobinas.isEmpty || bobinas.any((b) => b <= 0)) return _error(400, 'Cantidad inválida');
      var pedidoId = c['ot_material_id'] as int?;
      var creado = false;
      if (c['numero_ot'] != null) {
        final n = (c['numero_ot'] as String).toUpperCase();
        final existente = pedidos.where((p) => p['ot'] == n && p['material_id'] == c['material_id']).firstOrNull;
        if (existente != null) {
          pedidoId = existente['id'] as int;
        } else {
          pedidoId = _siguienteId++;
          pedidos.add({
            'id': pedidoId,
            'ot': n,
            'material_id': c['material_id'],
            'proceso_id': c['proceso_id'],
            'maquina_id': c['maquina_id'],
            'requerido': null,
            'insumo_de': null,
          });
          creado = true;
        }
      }
      final p = _pedido(pedidoId!);
      final distinto = c['numero_ot'] == null &&
          c['proceso_id'] != null &&
          (c['proceso_id'] != p['proceso_id'] || c['maquina_id'] != p['maquina_id']);
      final e = _entrega(_siguienteId++,
          pedido: pedidoId,
          material: (c['material_id'] ?? p['material_id']) as int,
          fecha: c['fecha'] as String,
          hora: _hora(),
          bobinas: bobinas,
          usuario: usuario['inicial'] as String,
          procesoId: distinto ? c['proceso_id'] as int : null,
          maquinaId: distinto ? c['maquina_id'] as int : null,
          observacion: c['observacion'] as String?);
      entregas.add(e);
      return _json(_entregaOut(e, pedidoCreado: creado), 201);
    }
    final rMatEnt = RegExp(r'^/entregas/materiales-entregados/(\d+)$').firstMatch(ruta);
    if (rMatEnt != null) {
      final pedidoId = int.parse(rMatEnt.group(1)!);
      final porMaterial = <int, List<Map<String, dynamic>>>{};
      for (final e in entregas.where((e) => e['pedido'] == pedidoId)) {
        porMaterial.putIfAbsent(e['material_id'] as int, () => []).add(e);
      }
      return _json([
        for (final entry in porMaterial.entries)
          () {
            final m = _material(entry.key);
            final entregado = _suma(entry.value.expand((e) => e['bobinas'] as List).toList());
            final devuelto = _suma(devoluciones
                .where((d) => d['pedido'] == pedidoId && d['material_id'] == entry.key && d['ingreso'] != true)
                .expand((d) => d['bobinas'] as List)
                .toList());
            return {
              'material_id': m['id'],
              'codigo_mp': m['codigo_mp'],
              'descripcion': m['descripcion'],
              'unidad': m['unidad'],
              'usa_bobinas': m['usa_bobinas'],
              'total_entregado': entregado,
              'total_devuelto': devuelto,
              'disponible': entregado - devuelto < 0 ? 0 : (((entregado - devuelto) * 1000).round()) / 1000,
            };
          }(),
      ]);
    }
    final rEnt = RegExp(r'^/entregas/(\d+)$').firstMatch(ruta);
    if (rEnt != null) {
      if (!puede('registrar_entrega')) return _error(403, 'Sin acceso a registrar_entrega');
      final e = entregas.where((x) => x['id'] == int.parse(rEnt.group(1)!)).firstOrNull;
      if (e == null) return _error(404, 'Entrega no encontrada');
      if (e['sid'] == true) return _error(400, 'Esta entrega ya tiene su SID registrado');
      if (metodo == 'DELETE') {
        entregas.remove(e);
        return http.Response('', 204);
      }
      final c = cuerpo();
      e['fecha'] = c['fecha'];
      e['material_id'] = c['material_id'];
      e['bobinas'] = (c['bobinas'] as List).map((b) => (b as num).toDouble()).toList();
      e['observacion'] = c['observacion'];
      e['proceso_id'] = c['proceso_id'];
      e['maquina_id'] = c['maquina_id'];
      e['editado_por'] = usuario['inicial'];
      e['editado_en'] = '2026-10-29T16:45:00';
      return _json(_entregaOut(e));
    }

    // Devoluciones
    if (ruta == '/devoluciones' && metodo == 'GET') {
      final n = q['numero_ot']?.toUpperCase();
      return _json([
        for (final d in devoluciones)
          if (n == null || _devolucionOut(d)['numero_ot'] == n) _devolucionOut(d),
      ]);
    }
    if (ruta == '/devoluciones' && metodo == 'POST') {
      if (!puede('registrar_devolucion')) return _error(403, 'Sin acceso a registrar_devolucion');
      final c = cuerpo();
      if ((c['ot_material_id'] == null) == (c['pendiente_id'] == null)) {
        return _error(400, 'Indica el pedido o el pendiente, uno solo');
      }
      if (c['pendiente_id'] != null && c['es_ingreso_produccion'] != true) {
        return _error(400, 'Un pendiente solo recibe ingresos a almacén');
      }
      final d = _devolucion(_siguienteId++,
          pedido: c['ot_material_id'] as int?,
          pendiente: c['pendiente_id'] as int?,
          material: c['material_id'] as int,
          fecha: c['fecha'] as String,
          hora: _hora(),
          bobinas: (c['bobinas'] as List).cast<num>(),
          entrega: c['entrega_id'] as int?,
          ingreso: c['es_ingreso_produccion'] == true,
          usuario: usuario['inicial'] as String);
      devoluciones.add(d);
      return _json(_devolucionOut(d), 201);
    }
    final rDev = RegExp(r'^/devoluciones/(\d+)$').firstMatch(ruta);
    if (rDev != null) {
      if (!puede('registrar_devolucion')) return _error(403, 'Sin acceso a registrar_devolucion');
      final d = devoluciones.where((x) => x['id'] == int.parse(rDev.group(1)!)).firstOrNull;
      if (d == null) return _error(404, 'Devolución no encontrada');
      if (d['sid'] == true) return _error(400, 'Esta devolución ya tiene su SID registrado');
      if (metodo == 'DELETE') {
        devoluciones.remove(d);
        return http.Response('', 204);
      }
      final c = cuerpo();
      d['fecha'] = c['fecha'];
      d['material_id'] = c['material_id'];
      d['bobinas'] = (c['bobinas'] as List).map((b) => (b as num).toDouble()).toList();
      if (c.containsKey('entrega_id')) d['entrega_id'] = c['entrega_id'];
      d['editado_por'] = usuario['inicial'];
      d['editado_en'] = '2026-10-29T16:45:00';
      return _json(_devolucionOut(d));
    }

    return _error(404, 'Not Found: $metodo $ruta');
  }

  /// Las peticiones de un método y ruta, con su cuerpo ya decodificado.
  List<Map<String, dynamic>> cuerpos(String metodo, String ruta) => [
        for (final r in peticiones)
          if (r.method == metodo && r.url.path == ruta) jsonDecode(r.body) as Map<String, dynamic>,
      ];
}

/// Delega todo en el servidor falso salvo /eventos, que devuelve un flujo abierto.
class _ConAvisos extends http.BaseClient {
  _ConAvisos(this._mock, this._servidor);
  final http.Client _mock;
  final BackendFalso _servidor;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    if (request.url.path == '/eventos') return _servidor._abrirAvisos(request);
    return _mock.send(request);
  }
}
