import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../estado/conexion.dart';
import '../tema.dart';

/// Barra en lo alto de toda la app:
///  * ROJA y fija mientras no hay conexión con el servidor;
///  * VERDE unos segundos cuando la conexión vuelve ("Conexión establecida").
/// Con conexión normal no ocupa nada.
class BarraConexion extends StatefulWidget {
  const BarraConexion({super.key, this.duracionVerde = const Duration(seconds: 4)});

  final Duration duracionVerde;

  @override
  State<BarraConexion> createState() => _BarraConexionState();
}

class _BarraConexionState extends State<BarraConexion> {
  late final Conexion _conexion;
  int _vistas = 0;
  bool _verde = false;
  Timer? _reloj;

  @override
  void initState() {
    super.initState();
    _conexion = context.read<Conexion>();
    _vistas = _conexion.restablecimientos;
    _conexion.addListener(_alCambiar);
  }

  void _alCambiar() {
    if (!mounted) return;
    if (_conexion.restablecimientos != _vistas) {
      _vistas = _conexion.restablecimientos;
      _verde = true;
      _reloj?.cancel();
      _reloj = Timer(widget.duracionVerde, () {
        if (mounted) setState(() => _verde = false);
      });
    }
    // Si vuelve a caerse mientras estaba el verde, manda el rojo.
    if (_conexion.sinConexion) {
      _verde = false;
      _reloj?.cancel();
    }
    setState(() {});
  }

  @override
  void dispose() {
    _reloj?.cancel();
    _conexion.removeListener(_alCambiar);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final String? texto;
    final String? detalle;
    final Color color;
    final IconData icono;
    if (_conexion.sinConexion) {
      texto = 'Sin conexión al servidor';
      detalle = 'Se ven los últimos datos guardados. Lo que registres no se guarda hasta que vuelva la conexión.';
      color = Colores.peligro;
      icono = Icons.cloud_off;
    } else if (_verde) {
      texto = 'Conexión establecida hacia el servidor';
      detalle = null;
      color = Colores.exito;
      icono = Icons.cloud_done;
    } else {
      return const SizedBox.shrink();
    }
    return Material(
      color: color,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(children: [
            Icon(icono, color: Colors.white, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Text.rich(
                TextSpan(children: [
                  TextSpan(text: texto, style: const TextStyle(fontWeight: FontWeight.w700)),
                  if (detalle != null) TextSpan(text: '  —  $detalle', style: const TextStyle(fontSize: 12.5)),
                ]),
                style: const TextStyle(color: Colors.white),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
