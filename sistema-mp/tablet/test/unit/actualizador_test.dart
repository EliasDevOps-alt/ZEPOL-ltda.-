// Actualizaciones de la tablet desde el servidor: detectar una versión nueva,
// bajarla completa y comprobada, y dejarla lista para instalar.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zepol_tablet/actualizacion/actualizador.dart';

class _PlataformaFalsa implements PlataformaActualizador {
  _PlataformaFalsa(this.carpeta);
  final String carpeta;
  int codigo = 2;
  String nombre = '1.0.1';
  bool permitido = true;
  final instalados = <String>[];
  int vecesPidioPermiso = 0;
  bool fallarAlInstalar = false;

  @override
  Future<({int codigo, String nombre})> version() async => (codigo: codigo, nombre: nombre);
  @override
  Future<bool> puedeInstalar() async => permitido;
  @override
  Future<void> pedirPermiso() async => vecesPidioPermiso++;
  @override
  Future<void> instalar(String ruta) async {
    if (fallarAlInstalar) throw ErrorDeInstalacion('no se pudo');
    instalados.add(ruta);
  }

  @override
  Future<String> carpetaDescargas() async => carpeta;
}

class ErrorDeInstalacion implements Exception {
  ErrorDeInstalacion(this.m);
  final String m;
  @override
  String toString() => m;
}

/// Servidor de la planta con una versión de la tablet publicada.
class _ServidorFalso {
  _ServidorFalso({int codigo = 3, String nombre = '1.0.2', List<int>? apk}) {
    publicar(codigo: codigo, nombre: nombre, apk: apk);
  }

  static const base = 'http://servidor:8000';
  Map<String, dynamic>? manifiesto;
  List<int> apk = [];
  int? estadoManifiesto; // fuerza un código de respuesta
  bool sinRed = false;
  bool cortarDescarga = false;
  int manifiestosPedidos = 0;
  int apksPedidos = 0;
  String? ultimoApkPedido;

  void publicar({int codigo = 3, String nombre = '1.0.2', List<int>? apk, String notas = '', bool obligatoria = false}) {
    this.apk = apk ?? List<int>.generate(100000, (i) => i % 251);
    manifiesto = {
      'version_code': codigo,
      'version_name': nombre,
      'apk': 'zepol-tablet-$nombre+$codigo.apk',
      'sha256': sha256.convert(this.apk).toString(),
      'tamano': this.apk.length,
      'notas': notas,
      'obligatoria': obligatoria,
    };
  }

  late final cliente = MockClient.streaming((req, cuerpo) async {
    if (sinRed) throw http.ClientException('Sin red', req.url);
    if (req.url.path == '/updates/tablet/latest.json') {
      manifiestosPedidos++;
      if (estadoManifiesto != null) return http.StreamedResponse(Stream.value(utf8.encode('x')), estadoManifiesto!);
      if (manifiesto == null) return http.StreamedResponse(Stream.value(utf8.encode('no')), 404);
      return http.StreamedResponse(Stream.value(utf8.encode(jsonEncode(manifiesto))), 200);
    }
    if (req.url.path.startsWith('/updates/tablet/') && req.url.path.endsWith('.apk')) {
      apksPedidos++;
      ultimoApkPedido = Uri.decodeComponent(req.url.path.split('/').last);
      final datos = cortarDescarga ? apk.sublist(0, apk.length ~/ 2) : apk;
      // En trozos de 10 000 bytes, como llegaría por la red.
      Stream<List<int>> trozos() async* {
        for (var i = 0; i < datos.length; i += 10000) {
          yield datos.sublist(i, i + 10000 > datos.length ? datos.length : i + 10000);
          await Future<void>.delayed(Duration.zero);
        }
      }

      return http.StreamedResponse(trozos(), 200, contentLength: apk.length);
    }
    return http.StreamedResponse(Stream.value(utf8.encode('?')), 404);
  });
}

void main() {
  late Directory carpeta;
  late _PlataformaFalsa plataforma;
  late _ServidorFalso servidor;
  String? direccion;

  Actualizador crear({bool automatica = false, Duration intervalo = const Duration(hours: 1)}) => Actualizador(
        servidor: () => direccion,
        plataforma: plataforma,
        cliente: servidor.cliente,
        automatica: automatica,
        intervalo: intervalo,
      );

  setUp(() async {
    carpeta = await Directory.systemTemp.createTemp('zepol_act_');
    plataforma = _PlataformaFalsa(carpeta.path);
    servidor = _ServidorFalso();
    direccion = _ServidorFalso.base;
  });

  tearDown(() async {
    if (await carpeta.exists()) await carpeta.delete(recursive: true);
  });

  group('revisar', () {
    test('142. con la misma versión instalada dice que está al día', () async {
      servidor.publicar(codigo: 2, nombre: '1.0.1');
      final a = crear();
      await a.revisar(manual: true);
      expect(a.estado, EstadoActualizacion.alDia);
      expect(a.hayActualizacion, isFalse);
    });

    test('143. con una versión mayor publicada, avisa que hay una nueva', () async {
      servidor.publicar(codigo: 3, nombre: '1.0.2', notas: 'Corrige el scroll');
      final a = crear();
      await a.revisar();
      expect(a.estado, EstadoActualizacion.disponible);
      expect(a.nueva!.nombre, '1.0.2');
      expect(a.nueva!.notas, 'Corrige el scroll');
      expect(a.instalada!.nombre, '1.0.1');
    });

    test('144. si el servidor tiene una versión MÁS VIEJA, no baja de versión', () async {
      servidor.publicar(codigo: 1, nombre: '1.0.0');
      final a = crear();
      await a.revisar();
      expect(a.estado, EstadoActualizacion.alDia);
      expect(a.nueva, isNull);
    });

    test('145. se compara el número de versión, no el nombre (1.0.10 > 1.0.9)', () async {
      plataforma
        ..codigo = 9
        ..nombre = '1.0.9';
      servidor.publicar(codigo: 10, nombre: '1.0.10');
      final a = crear();
      await a.revisar();
      expect(a.estado, EstadoActualizacion.disponible);
    });

    test('146. un servidor sin versiones publicadas (404) no es un error', () async {
      servidor.manifiesto = null;
      final a = crear();
      await a.revisar(manual: true);
      expect(a.estado, EstadoActualizacion.alDia);
      expect(a.mensaje, contains('no tiene versiones'));
    });

    test('147. sin red, la búsqueda manual informa el error', () async {
      servidor.sinRed = true;
      final a = crear();
      await a.revisar(manual: true);
      expect(a.estado, EstadoActualizacion.error);
      expect(a.mensaje, contains('No se pudo conectar'));
    });

    test('148. sin red, la búsqueda automática pasa en silencio (sin error en pantalla)', () async {
      servidor.sinRed = true;
      final a = crear();
      await a.revisar();
      expect(a.estado, isNot(EstadoActualizacion.error));
    });

    test('149. un manifiesto roto es un error en la búsqueda manual', () async {
      servidor.manifiesto = {'version_code': 'x'};
      final a = crear();
      await a.revisar(manual: true);
      expect(a.estado, EstadoActualizacion.error);
    });

    test('150. un error 500 del servidor se informa en la búsqueda manual', () async {
      servidor.estadoManifiesto = 500;
      final a = crear();
      await a.revisar(manual: true);
      expect(a.estado, EstadoActualizacion.error);
      expect(a.mensaje, contains('500'));
    });

    test('151. sin dirección de servidor configurada no hace nada', () async {
      direccion = null;
      final a = crear();
      await a.revisar(manual: true);
      expect(a.estado, EstadoActualizacion.sinRevisar);
      expect(servidor.manifiestosPedidos, 0);
    });

    test('152. sin plataforma (pruebas, escritorio) no hace nada', () async {
      final a = Actualizador(servidor: () => direccion, plataforma: null, cliente: servidor.cliente);
      await a.revisar(manual: true);
      expect(a.estado, EstadoActualizacion.sinRevisar);
    });

    test('153. dos revisiones a la vez comparten una sola consulta', () async {
      final a = crear();
      await Future.wait([a.revisar(), a.revisar(), a.revisar()]);
      expect(servidor.manifiestosPedidos, 1);
    });
  });

  group('descargar', () {
    test('154. baja el APK completo, verifica su huella y queda lista para instalar', () async {
      final a = crear();
      await a.revisar();
      await a.descargar();
      expect(a.estado, EstadoActualizacion.listaParaInstalar);
      expect(a.progreso, 1);
      final archivos = carpeta.listSync().whereType<File>().map((f) => f.path.split(Platform.pathSeparator).last).toList();
      expect(archivos, ['zepol-tablet-1.0.2+3.apk']);
      expect(File('${carpeta.path}/zepol-tablet-1.0.2+3.apk').readAsBytesSync(), servidor.apk);
    });

    test('155. el progreso avanza sin retroceder hasta el 100 %', () async {
      final a = crear();
      await a.revisar();
      final vistos = <double>[];
      a.addListener(() => vistos.add(a.progreso));
      await a.descargar();
      expect(vistos, isNotEmpty);
      for (var i = 1; i < vistos.length; i++) {
        expect(vistos[i], greaterThanOrEqualTo(vistos[i - 1]));
      }
      expect(vistos.last, 1);
    });

    test('156. un archivo alterado (huella distinta) se rechaza y se borra', () async {
      final a = crear();
      await a.revisar();
      servidor.apk = List<int>.from(servidor.apk)..[500] ^= 0xFF; // mismo tamaño, otro contenido
      await a.descargar();
      expect(a.estado, EstadoActualizacion.error);
      expect(a.mensaje, contains('no coincide'));
      expect(carpeta.listSync(), isEmpty);
    });

    test('157. una descarga cortada a la mitad se rechaza, no deja basura y se puede reintentar', () async {
      final a = crear();
      await a.revisar();
      servidor.cortarDescarga = true;
      await a.descargar();
      expect(a.estado, EstadoActualizacion.error);
      expect(a.mensaje, contains('incompleta'));
      expect(carpeta.listSync(), isEmpty);

      servidor.cortarDescarga = false;
      await a.descargar();
      expect(a.estado, EstadoActualizacion.listaParaInstalar);
    });

    test('158. sin red al descargar: error claro y se puede reintentar', () async {
      final a = crear();
      await a.revisar();
      servidor.sinRed = true;
      await a.descargar();
      expect(a.estado, EstadoActualizacion.error);
      servidor.sinRed = false;
      await a.descargar();
      expect(a.estado, EstadoActualizacion.listaParaInstalar);
    });

    test('159. el nombre del APK con símbolos se pide bien escrito en la dirección', () async {
      servidor.publicar(codigo: 3, nombre: '1.0.2');
      servidor.manifiesto!['apk'] = 'zepol tablet 1.0.2.apk';
      final a = crear();
      await a.revisar();
      await a.descargar();
      expect(servidor.ultimoApkPedido, 'zepol tablet 1.0.2.apk');
    });

    test('160. si el servidor no tiene el archivo (404) se informa', () async {
      servidor.manifiesto!['apk'] = 'no-existe.txt';
      final a = crear();
      await a.revisar();
      await a.descargar();
      expect(a.estado, EstadoActualizacion.error);
    });

    test('161. ya descargada, volver a revisar no la baja otra vez', () async {
      final a = crear();
      await a.revisar();
      await a.descargar();
      await a.revisar();
      expect(servidor.apksPedidos, 1);
      expect(a.estado, EstadoActualizacion.listaParaInstalar);
    });

    test('162. si aparece una versión todavía más nueva, se baja esa', () async {
      final a = crear();
      await a.revisar();
      await a.descargar();
      servidor.publicar(codigo: 4, nombre: '1.0.3');
      await a.revisar();
      expect(a.estado, EstadoActualizacion.disponible);
      await a.descargar();
      expect(a.nueva!.nombre, '1.0.3');
      expect(a.estado, EstadoActualizacion.listaParaInstalar);
    });

    test('163. con la automática activa, la versión nueva se baja sola al detectarla', () async {
      final a = crear(automatica: true);
      await a.revisar();
      expect(a.estado, EstadoActualizacion.listaParaInstalar);
      expect(servidor.apksPedidos, 1);
    });

    test('164. sin la automática (manual) no se baja nada hasta que se pida', () async {
      final a = crear();
      await a.revisar();
      expect(a.estado, EstadoActualizacion.disponible);
      expect(servidor.apksPedidos, 0);
    });
  });

  group('instalar', () {
    test('165. con permiso, le pasa el APK descargado a Android', () async {
      final a = crear();
      await a.revisar();
      await a.descargar();
      await a.instalar();
      expect(plataforma.instalados, ['${carpeta.path}${Platform.pathSeparator}zepol-tablet-1.0.2+3.apk']);
    });

    test('166. sin permiso de instalar: lo pide, avisa y NO instala', () async {
      plataforma.permitido = false;
      final a = crear();
      await a.revisar();
      await a.descargar();
      await a.instalar();
      expect(plataforma.vecesPidioPermiso, 1);
      expect(plataforma.instalados, isEmpty);
      expect(a.estado, EstadoActualizacion.necesitaPermiso);
      expect(a.mensaje, contains('permiso'));
    });

    test('167. con el permiso ya dado, tocar Instalar de nuevo instala', () async {
      plataforma.permitido = false;
      final a = crear();
      await a.revisar();
      await a.descargar();
      await a.instalar();
      plataforma.permitido = true;
      await a.instalar();
      expect(plataforma.instalados, hasLength(1));
    });

    test('168. instalar sin haber descargado no hace nada', () async {
      final a = crear();
      await a.revisar();
      await a.instalar();
      expect(plataforma.instalados, isEmpty);
    });

    test('169. si Android falla al instalar, se informa', () async {
      plataforma.fallarAlInstalar = true;
      final a = crear();
      await a.revisar();
      await a.descargar();
      await a.instalar();
      expect(a.estado, EstadoActualizacion.error);
      expect(a.mensaje, contains('No se pudo instalar'));
    });
  });

  group('después de actualizar', () {
    test('170. el APK ya instalado se borra de la tablet al abrir la versión nueva', () async {
      final a = crear(automatica: true);
      await a.revisar();
      expect(carpeta.listSync(), hasLength(1));
      // La tablet ya tiene la 1.0.2 (código 3): la copia descargada sobra.
      plataforma
        ..codigo = 3
        ..nombre = '1.0.2';
      final b = crear(automatica: true);
      await b.revisar();
      expect(b.estado, EstadoActualizacion.alDia);
      expect(carpeta.listSync(), isEmpty);
    });

    test('171. una descarga a medias de una vez anterior (.parte) se borra', () async {
      File('${carpeta.path}/zepol-tablet-1.0.2+3.apk.parte').writeAsBytesSync([1, 2, 3]);
      final a = crear();
      await a.revisar();
      expect(carpeta.listSync().whereType<File>().where((f) => f.path.endsWith('.parte')), isEmpty);
    });
  });

  group('revisión periódica', () {
    test('172. iniciar revisa ya y después cada intervalo; detener lo para', () async {
      final a = crear(automatica: true, intervalo: const Duration(milliseconds: 60));
      a.iniciar();
      await Future<void>.delayed(const Duration(milliseconds: 320));
      a.detener();
      final n = servidor.manifiestosPedidos;
      expect(n, greaterThanOrEqualTo(3));
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(servidor.manifiestosPedidos, n, reason: 'detenido');
      a.dispose();
    });

    test('173. una versión publicada DESPUÉS de abrir la app se detecta en la siguiente revisión', () async {
      servidor.publicar(codigo: 2, nombre: '1.0.1');
      final a = crear(automatica: true, intervalo: const Duration(milliseconds: 60));
      a.iniciar();
      await Future<void>.delayed(const Duration(milliseconds: 120));
      expect(a.estado, EstadoActualizacion.alDia);
      servidor.publicar(codigo: 5, nombre: '1.1.0');
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(a.estado, EstadoActualizacion.listaParaInstalar);
      expect(a.nueva!.nombre, '1.1.0');
      a.detener();
      a.dispose();
    });

    test('174. una versión marcada como obligatoria lo indica', () async {
      servidor.publicar(codigo: 3, nombre: '1.0.2', obligatoria: true);
      final a = crear();
      await a.revisar();
      expect(a.nueva!.obligatoria, isTrue);
    });
  });
}
