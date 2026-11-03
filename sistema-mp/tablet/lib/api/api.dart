import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'modelos.dart';

class ApiError implements Exception {
  ApiError(this.mensaje, {this.status});
  final String mensaje;
  final int? status;

  @override
  String toString() => mensaje;
}

/// Cliente de la API del backend (el mismo que usa el escritorio, ver
/// frontend/src/renderer/src/lib/api.ts). Cada función es un endpoint.
class Api {
  Api(this.baseUrl, {this.token, this.alExpirarSesion, this.alEscribir, http.Client? cliente}) : _cliente = cliente;

  final String baseUrl;
  // En los tests se pasa un cliente falso (backend en memoria); en la app, null.
  final http.Client? _cliente;
  final String? token;
  // Se llama ante un 401 con sesión iniciada: el token venció y hay que volver al login.
  final void Function()? alExpirarSesion;
  // Se llama tras registrar, corregir o borrar algo: la copia local se pone al día.
  final void Function()? alEscribir;

  static const _tiempoLimite = Duration(seconds: 20);
  // Las consultas de TODAS las OT (Historial, listas de pendientes) son grandes:
  // /entregas completo tarda ~9 s y el backend las atiende de a una.
  static const _limiteGrande = Duration(seconds: 90);

  Future<dynamic> _pedir(String metodo, String ruta, {Object? cuerpo, Duration? limite}) async {
    final uri = Uri.parse('$baseUrl$ruta');
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (token != null) headers['Authorization'] = 'Bearer $token';

    http.Response res;
    try {
      final req = http.Request(metodo, uri)..headers.addAll(headers);
      if (cuerpo != null) req.body = jsonEncode(cuerpo);
      final enviado = _cliente != null ? _cliente.send(req) : req.send();
      res = await http.Response.fromStream(await enviado.timeout(limite ?? _tiempoLimite));
    } on TimeoutException {
      throw ApiError('El servidor no respondió a tiempo');
    } catch (_) {
      throw ApiError('No se pudo conectar con el servidor ($baseUrl)');
    }

    final texto = utf8.decode(res.bodyBytes);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      if (res.statusCode == 401 && token != null) alExpirarSesion?.call();
      String mensaje = 'Error ${res.statusCode}';
      try {
        final detalle = (jsonDecode(texto) as Map<String, dynamic>)['detail'];
        if (detalle is String) mensaje = detalle;
      } catch (_) {}
      throw ApiError(mensaje, status: res.statusCode);
    }
    if (metodo != 'GET') alEscribir?.call();
    if (res.statusCode == 204 || texto.isEmpty) return null;
    return jsonDecode(texto);
  }

  List<T> _lista<T>(dynamic datos, T Function(Map<String, dynamic>) desde) =>
      (datos as List).map((e) => desde(e as Map<String, dynamic>)).toList();

  static String _ot(String numeroOt) => Uri.encodeComponent(numeroOt);

  /// Una lectura tal cual la manda el servidor (para la copia local).
  Future<dynamic> obtenerCrudo(String ruta, {Duration? limite}) => _pedir('GET', ruta, limite: limite);

  /// Avisos en tiempo real del servidor ("cambió la OT X", ver backend/services/eventos.py).
  /// Un flujo que se queda abierto: el primero es {"conectado": true}; luego {"ots": [...]} o {"todo": true}.
  /// Termina (o falla) cuando se corta la conexión; quien lo usa reconecta.
  Stream<Map<String, dynamic>> avisos() async* {
    final req = http.Request('GET', Uri.parse('$baseUrl/eventos'))
      ..headers['Accept'] = 'text/event-stream'
      ..headers['Authorization'] = 'Bearer $token';
    // Cliente propio (cerrable) cuando no hay uno de prueba: este se queda abierto horas.
    final propio = _cliente == null ? http.Client() : null;
    try {
      http.StreamedResponse res;
      try {
        res = await (propio ?? _cliente!).send(req).timeout(_tiempoLimite);
      } catch (_) {
        throw ApiError('No se pudo conectar con el servidor ($baseUrl)');
      }
      if (res.statusCode == 401) {
        alExpirarSesion?.call();
        throw ApiError('Sesión vencida', status: 401);
      }
      if (res.statusCode != 200) throw ApiError('Error ${res.statusCode}', status: res.statusCode);
      // Lo primero que sale es "conectado": así quien escucha sabe que la conexión
      // está viva aunque todavía no haya cambiado nada.
      yield {'conectado': true};
      // El servidor manda un latido cada 15 s: 45 s sin nada = conexión muerta.
      final lineas = res.stream.transform(utf8.decoder).transform(const LineSplitter()).timeout(
            const Duration(seconds: 45),
            onTimeout: (sink) => sink.addError(TimeoutException('Sin latidos del servidor')),
          );
      await for (final linea in lineas) {
        if (!linea.startsWith('data:')) continue; // ": latido" y líneas vacías
        try {
          yield jsonDecode(linea.substring(5).trim()) as Map<String, dynamic>;
        } catch (_) {
          // un aviso ilegible se ignora
        }
      }
    } finally {
      propio?.close();
    }
  }

  // ---- Sesión ----

  Future<List<UsuarioLogin>> listarUsuariosLogin() async =>
      _lista(await _pedir('GET', '/auth/usuarios', limite: const Duration(seconds: 5)), UsuarioLogin.fromJson);

  Future<(String, Usuario)> login(String inicial, String password) async {
    final j = await _pedir('POST', '/auth/login', cuerpo: {'inicial': inicial, 'password': password})
        as Map<String, dynamic>;
    return (j['access_token'] as String, Usuario.fromJson(j['usuario'] as Map<String, dynamic>));
  }

  // ---- Catálogos ----

  Future<List<Proceso>> listarProcesos() async => _lista(await _pedir('GET', '/catalogos/procesos'), Proceso.fromJson);

  Future<List<Maquina>> listarMaquinas(int procesoId) async =>
      _lista(await _pedir('GET', '/catalogos/maquinas?proceso_id=$procesoId'), Maquina.fromJson);

  Future<List<MaterialMp>> listarMateriales() async =>
      _lista(await _pedir('GET', '/catalogos/materiales'), MaterialMp.fromJson);

  // ---- OT ----

  /// q busca por OT, cliente o diseño en todas las fechas.
  Future<List<OrdenTrabajo>> listarOrdenes({String? q}) async {
    final qs = q != null && q.trim().isNotEmpty ? '?q=${Uri.encodeQueryComponent(q.trim())}' : '';
    return _lista(await _pedir('GET', '/ordenes-trabajo$qs'), OrdenTrabajo.fromJson);
  }

  Future<OtEncabezado> obtenerEncabezadoOt(String numeroOt) async =>
      OtEncabezado.fromJson(await _pedir('GET', '/ordenes-trabajo/${_ot(numeroOt)}/detalle') as Map<String, dynamic>);

  Future<List<Consumo>> consultarConsumo([String? numeroOt]) async {
    final qs = numeroOt != null ? '?numero_ot=${_ot(numeroOt)}' : '';
    return _lista(await _pedir('GET', '/consumo$qs', limite: numeroOt == null ? _limiteGrande : null), Consumo.fromJson);
  }

  Future<List<Pendiente>> listarPendientes(String numeroOt) async =>
      _lista(await _pedir('GET', '/ordenes-trabajo/${_ot(numeroOt)}/pendientes'), Pendiente.fromJson);

  /// Le asigna proceso y máquina a un pendiente: pasa a ser un pedido. Devuelve su ot_material_id.
  Future<int> promoverPendiente(int pendienteId, {required int procesoId, required int maquinaId, int? materialId}) async {
    final j = await _pedir('POST', '/ot-materiales-pendientes/$pendienteId/promover',
        cuerpo: {'proceso_id': procesoId, 'maquina_id': maquinaId, 'material_id': materialId}) as Map<String, dynamic>;
    return j['ot_material_id'] as int;
  }

  // ---- Entregas ----

  /// Sin número de OT trae las entregas de todas las OT.
  Future<List<Entrega>> listarEntregas([String? numeroOt]) async {
    final qs = numeroOt != null ? '?numero_ot=${_ot(numeroOt)}' : '';
    return _lista(await _pedir('GET', '/entregas$qs', limite: numeroOt == null ? _limiteGrande : null), Entrega.fromJson);
  }

  /// Exactamente uno de otMaterialId / numeroOt (pedido suelto, con material,
  /// proceso y máquina obligatorios — "Entregar un material que la OT no tiene").
  Future<Entrega> registrarEntrega({
    int? otMaterialId,
    String? numeroOt,
    required String fecha,
    required List<double> bobinas,
    int? materialId,
    int? procesoId,
    int? maquinaId,
    String? observacion,
  }) async {
    final cuerpo = <String, dynamic>{
      'fecha': fecha,
      'bobinas': bobinas,
      if (otMaterialId != null) 'ot_material_id': otMaterialId,
      if (numeroOt != null) 'numero_ot': numeroOt,
      if (materialId != null) 'material_id': materialId,
      if (procesoId != null) 'proceso_id': procesoId,
      if (maquinaId != null) 'maquina_id': maquinaId,
      if (observacion != null && observacion.isNotEmpty) 'observacion': observacion,
    };
    return Entrega.fromJson(await _pedir('POST', '/entregas', cuerpo: cuerpo) as Map<String, dynamic>);
  }

  // ---- Devoluciones ----

  /// Materiales que REALMENTE se entregaron contra un pedido, con lo que queda por devolver de cada uno.
  Future<List<BalanceMaterial>> listarMaterialesEntregados(int otMaterialId) async =>
      _lista(await _pedir('GET', '/entregas/materiales-entregados/$otMaterialId'), BalanceMaterial.fromJson);

  /// Sin número de OT trae las devoluciones de todas las OT.
  Future<List<Devolucion>> listarDevolucionesPorOt([String? numeroOt]) async {
    final qs = numeroOt != null ? '?numero_ot=${_ot(numeroOt)}' : '';
    return _lista(
        await _pedir('GET', '/devoluciones$qs', limite: numeroOt == null ? _limiteGrande : null), Devolucion.fromJson);
  }

  /// Uno de otMaterialId / pendienteId. esIngresoProduccion = material fabricado
  /// que entra a almacén (no un sobrante). entregaId: de qué entrega es el sobrante.
  Future<Devolucion> registrarDevolucion({
    int? otMaterialId,
    int? pendienteId,
    required int materialId,
    required String fecha,
    required List<double> bobinas,
    bool esIngresoProduccion = false,
    int? entregaId,
  }) async {
    final cuerpo = <String, dynamic>{
      'material_id': materialId,
      'fecha': fecha,
      'bobinas': bobinas,
      'es_ingreso_produccion': esIngresoProduccion,
      if (otMaterialId != null) 'ot_material_id': otMaterialId,
      if (pendienteId != null) 'pendiente_id': pendienteId,
      if (entregaId != null) 'entrega_id': entregaId,
    };
    return Devolucion.fromJson(await _pedir('POST', '/devoluciones', cuerpo: cuerpo) as Map<String, dynamic>);
  }

  /// Dónde registrar un ingreso "libre": el pedido que la OT ya tenga para ese
  /// material, o un pendiente suelto nuevo (nunca duplica).
  Future<({int? otMaterialId, int? pendienteId})> resolverIngresoLibre(
      String numeroOt, int materialId, double cantidad) async {
    final j = await _pedir('POST', '/ordenes-trabajo/${_ot(numeroOt)}/ingreso-libre',
        cuerpo: {'material_id': materialId, 'cantidad_requerida': cantidad}) as Map<String, dynamic>;
    return (otMaterialId: j['ot_material_id'] as int?, pendienteId: j['pendiente_id'] as int?);
  }

  // ---- Correcciones (Historial de OT) ----
  // Bloqueadas por el backend si el movimiento ya tiene el SID registrado.

  Future<void> editarEntrega(
    int id, {
    required String fecha,
    required int materialId,
    required List<double> bobinas,
    required String? observacion,
    required int procesoId,
    required int maquinaId,
  }) =>
      _pedir('PATCH', '/entregas/$id', cuerpo: {
        'fecha': fecha,
        'material_id': materialId,
        'bobinas': bobinas,
        'observacion': observacion,
        'proceso_id': procesoId,
        'maquina_id': maquinaId,
      });

  Future<void> eliminarEntrega(int id) => _pedir('DELETE', '/entregas/$id');

  /// entregaId null quita el vínculo con la entrega; con tocarEntrega false no se
  /// manda (un ingreso a almacén nunca tiene entrega).
  Future<void> editarDevolucion(
    int id, {
    required String fecha,
    required int materialId,
    required List<double> bobinas,
    int? entregaId,
    bool tocarEntrega = true,
  }) =>
      _pedir('PATCH', '/devoluciones/$id', cuerpo: {
        'fecha': fecha,
        'material_id': materialId,
        'bobinas': bobinas,
        if (tocarEntrega) 'entrega_id': entregaId,
      });

  Future<void> eliminarDevolucion(int id) => _pedir('DELETE', '/devoluciones/$id');
}
