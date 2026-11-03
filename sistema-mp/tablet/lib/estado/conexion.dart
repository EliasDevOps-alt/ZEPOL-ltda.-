import 'package:flutter/foundation.dart';

enum EstadoConexion { desconocido, enLinea, sinConexion }

/// Si la tablet puede hablar con el servidor, según lo que pasa en cada petición
/// (cualquier respuesta del servidor, aunque sea un error, cuenta como "hay
/// conexión"; un fallo de red o un tiempo agotado cuenta como "sin conexión").
/// La pantalla lo muestra como una barra roja / verde (ver BarraConexion).
class Conexion extends ChangeNotifier {
  EstadoConexion estado = EstadoConexion.desconocido;
  int _restablecimientos = 0;

  /// Cuántas veces volvió la conexión después de haberse caído: la barra verde
  /// aparece con cada una.
  int get restablecimientos => _restablecimientos;

  bool get sinConexion => estado == EstadoConexion.sinConexion;

  /// Lo avisa quien habla con el servidor: [ok] = el servidor contestó.
  void reportar(bool ok) {
    final nuevo = ok ? EstadoConexion.enLinea : EstadoConexion.sinConexion;
    if (nuevo == estado) return;
    final antes = estado;
    estado = nuevo;
    if (ok && antes == EstadoConexion.sinConexion) _restablecimientos++;
    notifyListeners();
  }
}
