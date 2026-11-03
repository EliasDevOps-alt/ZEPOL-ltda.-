import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../api/api.dart';
import '../api/modelos.dart';

/// Dónde se guarda la copia local entre una apertura y otra de la app.
abstract class AlmacenLocal {
  Future<String?> leer(String clave);
  Future<void> guardar(String clave, String texto);
}

/// Un archivo por tabla en la carpeta privada de la app.
class AlmacenArchivos implements AlmacenLocal {
  Directory? _carpeta;

  Future<File> _archivo(String clave) async {
    _carpeta ??= await getApplicationSupportDirectory();
    return File('${_carpeta!.path}${Platform.pathSeparator}cache_$clave.json');
  }

  @override
  Future<String?> leer(String clave) async {
    final f = await _archivo(clave);
    return await f.exists() ? f.readAsString() : null;
  }

  @override
  Future<void> guardar(String clave, String texto) async {
    final f = await _archivo(clave);
    // Se escribe a un temporal y se renombra: si la app se cierra a mitad de
    // camino el archivo anterior queda entero.
    final tmp = File('${f.path}.tmp');
    await tmp.writeAsString(texto, flush: true);
    await tmp.rename(f.path);
  }
}

/// Copia local de lo que la tablet consulta sin parar (órdenes, consumo,
/// entregas, devoluciones y catálogos), puesta al día en segundo plano.
///
/// Las pantallas leen de acá al instante en vez de pedirle todo al servidor cada
/// vez que se abren o se busca algo; cada tanto (y después de cada cosa que se
/// registra) se vuelve a leer el servidor sin que nadie espere, y solo si algo
/// cambió se avisa a las pantallas. Es el mismo criterio que el vigilante del
/// Excel en el servidor: una tarea de fondo que mantiene la copia al día.
class Repositorio extends ChangeNotifier {
  Repositorio({
    required this.api,
    required this.servidor,
    this.almacen,
    this.automatica = false,
    this.intervalo = const Duration(seconds: 60),
    this.esperaMaximaReconexion = const Duration(seconds: 30),
  });

  /// La API con la sesión vigente (cambia con cada login, por eso es una función).
  final Api Function() api;
  final String? Function() servidor;
  final AlmacenLocal? almacen;

  /// Con true se vuelve a sincronizar sola cada [intervalo] mientras haya sesión.
  ///
  /// Además (si [automatica]) escucha los avisos en tiempo real del servidor
  /// ("cambió la OT X"): al llegar uno vuelve a leer SOLO esa OT. La ronda
  /// completa cada [intervalo] queda como respaldo por si se pierde un aviso.
  final bool automatica;
  final Duration intervalo;
  final Duration esperaMaximaReconexion;

  // Tablas que se copian: clave → ruta del servidor.
  static const _rutas = {
    'ordenes': '/ordenes-trabajo',
    'consumo': '/consumo',
    'entregas': '/entregas',
    'devoluciones': '/devoluciones',
    'materiales': '/catalogos/materiales',
    'procesos': '/catalogos/procesos',
  };
  static const _limiteGrande = Duration(seconds: 90);

  // Lo último leído, como texto, para saber si algo cambió y para guardarlo.
  final _texto = <String, String>{};

  List<OrdenTrabajo> ordenes = [];
  List<Consumo> consumo = [];
  List<Entrega> entregas = [];
  List<Devolucion> devoluciones = [];
  List<MaterialMp> materiales = [];
  List<Proceso> procesos = [];
  final _maquinas = <int, List<Maquina>>{};

  // Lo que el servidor solo entrega de a UNA OT (materiales pendientes del Excel y
  // encabezado): se guarda cada vez que una OT se abre con conexión, así esa OT
  // se puede volver a abrir sin wifi. Clave 'pend:<OT>' / 'enc:<OT>'; las más
  // viejas se descartan pasado el tope.
  final _porOt = <String, String>{};
  static const _topePorOt = 300;
  static const _clavePorOt = 'porot';

  bool _hayDatos = false;
  bool sincronizando = false;
  DateTime? sincronizadoEn;
  String? errorSincronizacion;

  /// Ya hay una copia (de una sincronización o del disco) para mostrar.
  bool get tieneDatos => _hayDatos;

  Timer? _reloj;

  // Avisos en tiempo real
  bool _escuchando = false;
  bool avisosConectados = false;
  final _otsPorRefrescar = <String>{};
  // OT refrescadas por aviso MIENTRAS corría una ronda completa: esa ronda pudo
  // haber leído antes del cambio y pisarlo con datos viejos, así que se vuelven a leer.
  final _refrescadasEnRonda = <String>{};
  bool _refrescandoOts = false;
  final _cambiosDeOt = StreamController<String>.broadcast();

  /// Número de cada OT cuyos datos acaban de cambiar en la copia (por un aviso
  /// del servidor): las pantallas que la tengan abierta se actualizan.
  Stream<String> get cambiosDeOt => _cambiosDeOt.stream;

  Future<void>? _enCurso;
  bool _otraVuelta = false;
  bool _cerrado = false;

  List<Maquina>? maquinasDe(int procesoId) => _maquinas[procesoId];

  /// Lo guardado en la tablet, para poder mostrar algo antes de que conteste el servidor.
  Future<void> cargarDelDisco() async {
    final a = almacen;
    if (a == null) return;
    try {
      final base = '${_sufijo()}_';
      final porOt = await a.leer('$base$_clavePorOt');
      if (porOt != null) {
        _porOt
          ..clear()
          ..addAll((jsonDecode(porOt) as Map<String, dynamic>).map((k, v) => MapEntry(k, v as String)));
      }
      for (final k in [..._rutas.keys, 'maquinas']) {
        final t = await a.leer('$base$k');
        if (t != null) _texto[k] = t;
      }
      if (_rutas.keys.every(_texto.containsKey) && !_hayDatos) {
        _interpretar();
        _hayDatos = true;
        notifyListeners();
      }
    } catch (_) {
      // Una copia ilegible simplemente se ignora: se vuelve a bajar.
    }
  }

  // Cada servidor tiene su propia copia.
  String _sufijo() => (servidor() ?? '').hashCode.toRadixString(16);

  void _interpretar() {
    List<T> lista<T>(String k, T Function(Map<String, dynamic>) f) =>
        (jsonDecode(_texto[k]!) as List).map((e) => f(e as Map<String, dynamic>)).toList();
    ordenes = lista('ordenes', OrdenTrabajo.fromJson);
    consumo = lista('consumo', Consumo.fromJson);
    entregas = lista('entregas', Entrega.fromJson);
    devoluciones = lista('devoluciones', Devolucion.fromJson);
    materiales = lista('materiales', MaterialMp.fromJson);
    procesos = lista('procesos', Proceso.fromJson);
    final m = _texto['maquinas'];
    _maquinas.clear();
    if (m != null) {
      (jsonDecode(m) as Map<String, dynamic>).forEach((k, v) {
        _maquinas[int.parse(k)] =
            (v as List).map((e) => Maquina.fromJson(e as Map<String, dynamic>)).toList();
      });
    }
  }

  /// Arranca la sincronización de fondo (al entrar a la app con sesión).
  void iniciar() {
    _cerrado = false;
    unawaited(sincronizar());
    if (!automatica) return;
    _reloj?.cancel();
    _reloj = Timer.periodic(intervalo, (_) => unawaited(sincronizar()));
    if (!_escuchando) {
      _escuchando = true;
      unawaited(_bucleDeAvisos());
    }
  }

  /// Para al cerrar la sesión.
  void detener() {
    _reloj?.cancel();
    _reloj = null;
    _escuchando = false;
  }

  /// Mantiene abierta la conexión de avisos; si se corta reintenta (esperando
  /// cada vez más) y, al reconectar, sincroniza todo por si se perdió algún aviso.
  Future<void> _bucleDeAvisos() async {
    var espera = const Duration(seconds: 1);
    var primera = true;
    while (_escuchando && !_cerrado) {
      try {
        await for (final aviso in api().avisos()) {
          if (!_escuchando || _cerrado) break;
          if (aviso['conectado'] == true) {
            avisosConectados = true;
            espera = const Duration(seconds: 1);
            // Lo que cambió mientras no se escuchaba.
            if (!primera) unawaited(sincronizar());
            continue;
          }
          alAviso(aviso);
        }
      } catch (_) {
        // Sin red o servidor caído: se reintenta abajo.
      }
      avisosConectados = false;
      primera = false;
      if (!_escuchando || _cerrado) break;
      await Future<void>.delayed(espera);
      final doble = espera * 2;
      espera = doble > esperaMaximaReconexion ? esperaMaximaReconexion : doble;
    }
  }

  /// Un aviso del servidor: {"ots": [...]} o {"todo": true}.
  @visibleForTesting
  void alAviso(Map<String, dynamic> aviso) {
    if (aviso['todo'] == true) {
      unawaited(sincronizar());
      return;
    }
    final ots = (aviso['ots'] as List? ?? const []).cast<String>();
    _otsPorRefrescar.addAll(ots);
    unawaited(_refrescarOtsPendientes());
  }

  Future<void> _refrescarOtsPendientes() async {
    if (_refrescandoOts) return;
    _refrescandoOts = true;
    try {
      while (_otsPorRefrescar.isNotEmpty && !_cerrado) {
        final ot = _otsPorRefrescar.first;
        _otsPorRefrescar.remove(ot);
        try {
          await refrescarOt(ot);
        } catch (_) {
          // Sin red: la ronda completa lo recoge cuando vuelva.
        }
      }
    } finally {
      _refrescandoOts = false;
    }
  }

  /// Vuelve a leer del servidor SOLO una OT (pedidos, entregas, devoluciones y,
  /// si estaban guardados, sus pendientes y encabezado) y la cambia en la copia.
  Future<void> refrescarOt(String numeroOt) async {
    if (!_hayDatos) return; // sin copia base, la ronda completa se encarga
    final c = api();
    final q = Uri.encodeQueryComponent(numeroOt);
    final r = await Future.wait([
      c.obtenerCrudo('/consumo?numero_ot=$q'),
      c.obtenerCrudo('/entregas?numero_ot=$q'),
      c.obtenerCrudo('/devoluciones?numero_ot=$q'),
    ]);
    List<T> filas<T>(dynamic crudo, T Function(Map<String, dynamic>) f) =>
        (crudo as List).map((e) => f(e as Map<String, dynamic>)).toList();
    final nuevoConsumo = filas(r[0], Consumo.fromJson);
    final nuevasEntregas = filas(r[1], Entrega.fromJson);
    final nuevasDevoluciones = filas(r[2], Devolucion.fromJson);
    consumo = [...consumo.where((x) => x.numeroOt != numeroOt), ...nuevoConsumo];
    entregas = [...entregas.where((x) => x.numeroOt != numeroOt), ...nuevasEntregas];
    devoluciones = [...devoluciones.where((x) => x.numeroOt != numeroOt), ...nuevasDevoluciones];

    // ¿Existe la OT? Una OT nueva o una borrada cambian la lista de órdenes.
    final conocida = ordenes.any((o) => o.numeroOt == numeroOt);
    final sinMovimientos = nuevoConsumo.isEmpty && nuevasEntregas.isEmpty && nuevasDevoluciones.isEmpty;
    if (!conocida || sinMovimientos) {
      ordenes = filas(await c.obtenerCrudo('/ordenes-trabajo'), OrdenTrabajo.fromJson);
    }
    // Los datos por OT que ya se tenían guardados se mantienen al día.
    if (_porOt.containsKey('pend:$numeroOt')) {
      try {
        await _leerPorOt('pend:$numeroOt', '/ordenes-trabajo/${Uri.encodeComponent(numeroOt)}/pendientes');
      } catch (_) {}
    }
    if (_cerrado) return;
    if (sincronizando) _refrescadasEnRonda.add(numeroOt);
    notifyListeners();
    _cambiosDeOt.add(numeroOt);
  }

  /// Vuelve a leer el servidor. Si ya hay una en curso se une a ella (y pide
  /// otra vuelta al terminar, por si lo que cambió llegó después de empezar).
  Future<void> sincronizar() {
    final actual = _enCurso;
    if (actual != null) {
      _otraVuelta = true;
      return actual;
    }
    return _enCurso = _sincronizar().whenComplete(() {
      _enCurso = null;
      if (_otraVuelta && !_cerrado) {
        _otraVuelta = false;
        unawaited(sincronizar());
      }
    });
  }

  Future<void> _sincronizar() async {
    sincronizando = true;
    errorSincronizacion = null;
    _refrescadasEnRonda.clear();
    try {
      final cliente = api();
      // Se lee todo a un lado y solo si la ronda completa salió bien se
      // reemplaza la copia: si la red cae a la mitad queda la copia anterior
      // entera, nunca una mezcla de tablas nuevas y viejas.
      final nuevos = <String, String>{};
      // De a una: el servidor atiende de a una consulta y así la tablet no le
      // compite a la que el operador esté esperando en pantalla.
      for (final e in _rutas.entries) {
        nuevos[e.key] = jsonEncode(await cliente.obtenerCrudo(e.value, limite: _limiteGrande));
      }
      // Máquinas de cada proceso (catálogo chico).
      final mq = <String, dynamic>{};
      for (final p in jsonDecode(nuevos['procesos']!) as List) {
        final id = (p as Map<String, dynamic>)['id'] as int;
        mq['$id'] = await cliente.obtenerCrudo('/catalogos/maquinas?proceso_id=$id');
      }
      nuevos['maquinas'] = jsonEncode(mq);

      final cambiadas = [for (final e in nuevos.entries) if (e.value != _texto[e.key]) e.key];
      if (cambiadas.isNotEmpty || !_hayDatos) {
        for (final k in cambiadas) {
          _texto[k] = nuevos[k]!;
        }
        _interpretar();
        _hayDatos = true;
        for (final k in cambiadas) {
          await _guardar(k, nuevos[k]!);
        }
      }
      sincronizadoEn = DateTime.now();
      if (_refrescadasEnRonda.isNotEmpty) {
        _otsPorRefrescar.addAll(_refrescadasEnRonda);
        _refrescadasEnRonda.clear();
        unawaited(_refrescarOtsPendientes());
      }
    } catch (e) {
      // Sin conexión o servidor ocupado: se sigue con la copia que hay.
      errorSincronizacion = '$e';
    } finally {
      sincronizando = false;
      if (!_cerrado) notifyListeners();
    }
  }

  Future<void> _guardar(String clave, String texto) async {
    try {
      await almacen?.guardar('${_sufijo()}_$clave', texto);
    } catch (_) {}
  }

  // ---- Datos por OT (se guardan al abrir la OT con conexión) ----

  Future<dynamic> _leerPorOt(String clave, String ruta) async {
    try {
      final crudo = await api().obtenerCrudo(ruta);
      _porOt.remove(clave); // vuelve a quedar como la más reciente
      _porOt[clave] = jsonEncode(crudo);
      while (_porOt.length > _topePorOt) {
        _porOt.remove(_porOt.keys.first);
      }
      unawaited(_guardar(_clavePorOt, jsonEncode(_porOt)));
      return crudo;
    } on ApiError catch (e) {
      // Sin conexión: se usa lo guardado, si hay. Un error del servidor de verdad
      // (OT inexistente, sin permiso) sí se informa.
      final guardado = _porOt[clave];
      if (e.status == null && guardado != null) return jsonDecode(guardado);
      rethrow;
    }
  }

  /// Materiales pendientes de la OT (los del Excel que aún no tienen proceso).
  Future<List<Pendiente>> pendientesDe(String ot) async {
    final crudo = await _leerPorOt('pend:$ot', '/ordenes-trabajo/${Uri.encodeComponent(ot)}/pendientes');
    return (crudo as List).map((e) => Pendiente.fromJson(e as Map<String, dynamic>)).toList();
  }

  List<Pendiente>? pendientesGuardados(String ot) {
    final t = _porOt['pend:$ot'];
    if (t == null) return null;
    return (jsonDecode(t) as List).map((e) => Pendiente.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Cliente y descripción del producto de la OT.
  Future<OtEncabezado> encabezadoDe(String ot) async =>
      OtEncabezado.fromJson(await _leerPorOt('enc:$ot', '/ordenes-trabajo/${Uri.encodeComponent(ot)}/detalle')
          as Map<String, dynamic>);

  OtEncabezado? encabezadoGuardado(String ot) {
    final t = _porOt['enc:$ot'];
    return t == null ? null : OtEncabezado.fromJson(jsonDecode(t) as Map<String, dynamic>);
  }

  // ---- Lecturas ya listas para las pantallas ----

  List<Consumo> consumoDe(String numeroOt) => consumo.where((c) => c.numeroOt == numeroOt).toList();
  List<Entrega> entregasDe(String numeroOt) => entregas.where((e) => e.numeroOt == numeroOt).toList();
  List<Devolucion> devolucionesDe(String numeroOt) => devoluciones.where((d) => d.numeroOt == numeroOt).toList();

  /// Búsqueda por OT, cliente o diseño (como la del servidor), sin red.
  List<OrdenTrabajo> buscarOrdenes(String q) {
    final t = q.trim().toLowerCase();
    if (t.isEmpty) return ordenes;
    return ordenes
        .where((o) =>
            o.numeroOt.toLowerCase().contains(t) ||
            (o.cliente ?? '').toLowerCase().contains(t) ||
            (o.diseno ?? '').toLowerCase().contains(t))
        .toList();
  }

  @override
  void dispose() {
    _cerrado = true;
    _escuchando = false;
    _reloj?.cancel();
    _cambiosDeOt.close();
    super.dispose();
  }
}
