import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../estado/sesion.dart';
import '../widgets/tarjeta_marca.dart';

/// Se pide una sola vez (o al tocar "Servidor" en el login): la dirección del
/// backend en la red de la planta, ej. 192.168.121.72:8000.
class ConfiguracionServidor extends StatefulWidget {
  const ConfiguracionServidor({super.key, this.alGuardar});

  // Si viene del login, vuelve atrás al guardar.
  final VoidCallback? alGuardar;

  @override
  State<ConfiguracionServidor> createState() => _ConfiguracionServidorState();
}

class _ConfiguracionServidorState extends State<ConfiguracionServidor> {
  late final TextEditingController _url;
  String? _error;
  bool _probando = false;

  @override
  void initState() {
    super.initState();
    _url = TextEditingController(text: context.read<Sesion>().servidor ?? 'http://192.168.121.72:8000');
  }

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _guardar() async {
    if (_url.text.trim().isEmpty) {
      setState(() => _error = 'Escribe la dirección del servidor');
      return;
    }
    final sesion = context.read<Sesion>();
    setState(() {
      _probando = true;
      _error = null;
    });
    try {
      // Se prueba ANTES de guardar: guardarla primero cambiaba de pantalla al
      // login con una IP mal escrita, y ahí solo decía "no se pudo cargar la
      // lista de usuarios" sin explicar por qué.
      await sesion.probarServidor(_url.text);
      await sesion.fijarServidor(_url.text);
      widget.alGuardar?.call();
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _probando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: TarjetaMarca(
            subtitulo: 'Dirección del servidor',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Es la PC de planta baja donde corre el sistema. Pregunta la dirección si no la sabes.'),
                const SizedBox(height: 16),
                TextField(
                  controller: _url,
                  keyboardType: TextInputType.url,
                  decoration: const InputDecoration(labelText: 'Servidor', hintText: 'http://192.168.121.72:8000'),
                  onSubmitted: (_) => _guardar(),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _probando ? null : _guardar,
                  child: Text(_probando ? 'Probando conexión...' : 'Guardar'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
