import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

/// Lo que la app necesita del sistema Android (versión instalada, permiso e
/// instalación de un APK). En las pruebas se reemplaza por uno falso.
abstract class PlataformaActualizador {
  /// Versión de la app instalada: el código (número que sube en cada versión) y el nombre ("1.0.3").
  Future<({int codigo, String nombre})> version();
  Future<bool> puedeInstalar();

  /// Abre la pantalla de Android donde se permite a ZEPOL instalar actualizaciones (una sola vez).
  Future<void> pedirPermiso();

  /// Le pide a Android que instale el APK; Android muestra su confirmación.
  Future<void> instalar(String ruta);

  /// Carpeta donde guardar lo descargado.
  Future<String> carpetaDescargas();
}

class PlataformaReal implements PlataformaActualizador {
  static const _canal = MethodChannel('zepol/actualizador');

  @override
  Future<({int codigo, String nombre})> version() async {
    final r = Map<String, dynamic>.from(await _canal.invokeMethod('version') as Map);
    return (codigo: (r['codigo'] as num).toInt(), nombre: r['nombre'] as String);
  }

  @override
  Future<bool> puedeInstalar() async => await _canal.invokeMethod<bool>('puedeInstalar') ?? false;

  @override
  Future<void> pedirPermiso() => _canal.invokeMethod('pedirPermiso');

  @override
  Future<void> instalar(String ruta) => _canal.invokeMethod('instalar', {'ruta': ruta});

  @override
  Future<String> carpetaDescargas() async => (await getTemporaryDirectory()).path;
}

/// Lo que publica el servidor en `/updates/tablet/latest.json`.
class VersionPublicada {
  VersionPublicada({
    required this.codigo,
    required this.nombre,
    required this.apk,
    required this.sha256,
    required this.tamano,
    this.notas = '',
    this.obligatoria = false,
  });

  final int codigo;
  final String nombre;
  final String apk; // nombre del archivo, junto al manifiesto
  final String sha256;
  final int tamano;
  final String notas;
  final bool obligatoria;

  factory VersionPublicada.fromJson(Map<String, dynamic> j) => VersionPublicada(
        codigo: (j['version_code'] as num).toInt(),
        nombre: j['version_name'] as String,
        apk: j['apk'] as String,
        sha256: (j['sha256'] as String).toLowerCase(),
        tamano: (j['tamano'] as num).toInt(),
        notas: j['notas'] as String? ?? '',
        obligatoria: j['obligatoria'] as bool? ?? false,
      );
}

enum EstadoActualizacion {
  sinRevisar,
  revisando,
  alDia,
  disponible,
  descargando,
  listaParaInstalar,
  necesitaPermiso,
  error,
}

/// Busca en el servidor de la planta una versión nueva de la app, la descarga y
/// la deja lista para instalar: no hace falta reinstalar a mano ni llevar la
/// tablet a la PC. La instalación en sí la confirma Android con un toque (no
/// permite instalar en silencio a una app común).
class Actualizador extends ChangeNotifier {
  Actualizador({
    required this.servidor,
    required this.plataforma,
    http.Client? cliente,
    this.automatica = false,
    this.intervalo = const Duration(hours: 1),
  }) : _cliente = cliente;

  /// Dirección del servidor configurado en la tablet (null si todavía no hay).
  final String? Function() servidor;
  final PlataformaActualizador? plataforma;
  final http.Client? _cliente;

  /// Con true revisa sola cada [intervalo] y baja la versión nueva apenas la ve.
  final bool automatica;
  final Duration intervalo;

  static const _rutaManifiesto = '/updates/tablet/latest.json';

  EstadoActualizacion estado = EstadoActualizacion.sinRevisar;
  ({int codigo, String nombre})? instalada;
  VersionPublicada? nueva;
  String? mensaje;

  /// Avance de la descarga, de 0 a 1.
  double progreso = 0;
  String? _rutaApk;
  Timer? _reloj;
  Future<void>? _enCurso;
  bool _cerrado = false;

  bool get hayActualizacion =>
      estado == EstadoActualizacion.disponible ||
      estado == EstadoActualizacion.descargando ||
      estado == EstadoActualizacion.listaParaInstalar ||
      estado == EstadoActualizacion.necesitaPermiso;

  /// Empieza a revisar (al abrir la app con sesión) y, si es automática, cada hora.
  void iniciar() {
    _cerrado = false;
    unawaited(revisar());
    if (!automatica) return;
    _reloj?.cancel();
    _reloj = Timer.periodic(intervalo, (_) => unawaited(revisar()));
  }

  void detener() {
    _reloj?.cancel();
    _reloj = null;
  }

  void _cambiar(EstadoActualizacion nuevo, {String? texto}) {
    estado = nuevo;
    mensaje = texto;
    if (!_cerrado) notifyListeners();
  }

  Future<http.StreamedResponse> _pedir(String url) async {
    final req = http.Request('GET', Uri.parse(url));
    final propio = _cliente == null ? http.Client() : null;
    try {
      final res = await (propio ?? _cliente!).send(req).timeout(const Duration(seconds: 20));
      if (propio == null) return res;
      // Con un cliente propio el cuerpo se copia antes de cerrarlo.
      final bytes = await res.stream.toBytes();
      return http.StreamedResponse(Stream.value(bytes), res.statusCode,
          contentLength: bytes.length, request: req, headers: res.headers);
    } finally {
      propio?.close();
    }
  }

  /// Pregunta al servidor si hay una versión más nueva. [manual]: la pidió una
  /// persona, así que también se informa "ya estás al día" o el error; en la
  /// revisión automática los fallos de red pasan en silencio.
  Future<void> revisar({bool manual = false}) {
    final actual = _enCurso;
    if (actual != null) return actual;
    return _enCurso = _revisar(manual).whenComplete(() => _enCurso = null);
  }

  Future<void> _revisar(bool manual) async {
    final base = servidor();
    final p = plataforma;
    if (base == null || p == null) return;
    // Si ya se está bajando o ya está lista una, no se la pisa.
    if (estado == EstadoActualizacion.descargando) return;

    if (manual || estado == EstadoActualizacion.sinRevisar) _cambiar(EstadoActualizacion.revisando);
    try {
      instalada ??= await p.version();
      await _limpiarDescargasViejas(p);

      final res = await _pedir('$base$_rutaManifiesto');
      if (res.statusCode == 404) {
        // El servidor todavía no publicó ninguna versión de la tablet.
        _cambiar(EstadoActualizacion.alDia, texto: manual ? 'El servidor no tiene versiones publicadas' : null);
        return;
      }
      if (res.statusCode != 200) throw 'El servidor respondió ${res.statusCode}';
      final publicada =
          VersionPublicada.fromJson(jsonDecode(utf8.decode(await res.stream.toBytes())) as Map<String, dynamic>);

      // Se compara el número de versión, no el nombre; y nunca se "baja" de versión.
      if (publicada.codigo <= instalada!.codigo) {
        nueva = null;
        _cambiar(EstadoActualizacion.alDia);
        return;
      }
      final yaLista = nueva?.codigo == publicada.codigo && estado == EstadoActualizacion.listaParaInstalar;
      nueva = publicada;
      if (yaLista) return;
      _cambiar(EstadoActualizacion.disponible);
      // Se baja sola para que esté lista cuando el operador pueda parar un momento.
      if (automatica) await descargar();
    } catch (e) {
      if (manual) {
        _cambiar(EstadoActualizacion.error, texto: _legible(e));
      } else if (estado == EstadoActualizacion.revisando) {
        _cambiar(EstadoActualizacion.sinRevisar);
      }
    }
  }

  String _legible(Object e) {
    if (e is TimeoutException) return 'El servidor no respondió a tiempo';
    if (e is SocketException || e is http.ClientException) return 'No se pudo conectar con el servidor';
    return '$e';
  }

  /// Baja el APK de la versión nueva y comprueba que llegó completo y sin alterar.
  Future<void> descargar() async {
    final v = nueva;
    final base = servidor();
    final p = plataforma;
    if (v == null || base == null || p == null) return;
    if (estado == EstadoActualizacion.descargando || estado == EstadoActualizacion.listaParaInstalar) return;

    progreso = 0;
    _cambiar(EstadoActualizacion.descargando);
    final carpeta = await p.carpetaDescargas();
    final destino = File('$carpeta${Platform.pathSeparator}zepol-tablet-${v.nombre}+${v.codigo}.apk');
    final parcial = File('${destino.path}.parte');
    final propio = _cliente == null ? http.Client() : null;
    try {
      if (await parcial.exists()) await parcial.delete();
      final req = http.Request('GET', Uri.parse('$base/updates/tablet/${Uri.encodeComponent(v.apk)}'));
      final res = await (propio ?? _cliente!).send(req).timeout(const Duration(seconds: 20));
      if (res.statusCode != 200) throw 'El servidor respondió ${res.statusCode}';

      final salida = parcial.openWrite();
      var recibido = 0;
      var ultimoAviso = 0;
      final huella = AccumulatorSink<Digest>();
      final entrada = sha256.startChunkedConversion(huella);
      try {
        // Si pasan 30 s sin recibir nada se da por perdida la descarga.
        await for (final trozo in res.stream.timeout(const Duration(seconds: 30))) {
          salida.add(trozo);
          entrada.add(trozo);
          recibido += trozo.length;
          progreso = v.tamano > 0 ? (recibido / v.tamano).clamp(0.0, 1.0) : 0;
          // Se avisa a la pantalla como mucho cada ~1 % para no redibujarla de más.
          final porciento = (progreso * 100).floor();
          if (porciento != ultimoAviso) {
            ultimoAviso = porciento;
            if (!_cerrado) notifyListeners();
          }
        }
      } finally {
        await salida.close();
      }
      entrada.close();

      if (recibido != v.tamano) throw 'La descarga quedó incompleta ($recibido de ${v.tamano} bytes)';
      if (huella.events.single.toString() != v.sha256) throw 'El archivo descargado no coincide con el publicado';

      if (await destino.exists()) await destino.delete();
      await parcial.rename(destino.path);
      _rutaApk = destino.path;
      progreso = 1;
      _cambiar(EstadoActualizacion.listaParaInstalar);
    } catch (e) {
      if (await parcial.exists()) await parcial.delete();
      _cambiar(EstadoActualizacion.error, texto: 'No se pudo descargar la actualización: ${_legible(e)}');
    } finally {
      propio?.close();
    }
  }

  /// Le pide a Android que instale lo descargado. La primera vez Android pide
  /// permitir a ZEPOL instalar actualizaciones: se abre esa pantalla y, al volver,
  /// se toca de nuevo "Instalar".
  Future<void> instalar() async {
    final p = plataforma;
    final ruta = _rutaApk;
    if (p == null || ruta == null || estado == EstadoActualizacion.descargando) return;
    try {
      if (!await p.puedeInstalar()) {
        _cambiar(EstadoActualizacion.necesitaPermiso,
            texto: 'Falta un permiso: activa "Permitir de esta fuente" para ZEPOL y vuelve a tocar Instalar.');
        await p.pedirPermiso();
        return;
      }
      await p.instalar(ruta);
    } catch (e) {
      _cambiar(EstadoActualizacion.error, texto: 'No se pudo instalar: ${_legible(e)}');
    }
  }

  /// Después de actualizar, el APK que quedó en la tablet ya no sirve.
  Future<void> _limpiarDescargasViejas(PlataformaActualizador p) async {
    try {
      final carpeta = Directory(await p.carpetaDescargas());
      if (!await carpeta.exists()) return;
      final patron = RegExp(r'zepol-tablet-.*\+(\d+)\.apk(\.parte)?$');
      await for (final f in carpeta.list()) {
        final m = patron.firstMatch(f.path);
        if (m == null || f is! File) continue;
        final codigo = int.parse(m.group(1)!);
        if (m.group(2) != null || codigo <= instalada!.codigo) await f.delete();
      }
    } catch (_) {
      // limpiar es un detalle: si falla no se avisa
    }
  }

  @override
  void dispose() {
    _cerrado = true;
    _reloj?.cancel();
    super.dispose();
  }
}

/// Junta el resultado de una conversión por trozos (como `crypto` pide).
class AccumulatorSink<T> implements Sink<T> {
  final events = <T>[];
  @override
  void add(T data) => events.add(data);
  @override
  void close() {}
}
