import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/modelos.dart';
import '../actualizacion/banner_actualizacion.dart';
import '../estado/sesion.dart';
import '../tema.dart';
import '../widgets/tarjeta_marca.dart';
import 'configuracion_servidor.dart';

class Login extends StatefulWidget {
  const Login({super.key});

  @override
  State<Login> createState() => _LoginState();
}

class _LoginState extends State<Login> {
  final _password = TextEditingController();
  List<UsuarioLogin>? _usuarios;
  String? _inicial;
  String? _error;
  String? _errorUsuarios;
  bool _cargando = false;

  @override
  void initState() {
    super.initState();
    final sesion = context.read<Sesion>();
    _usuarios = sesion.usuariosGuardados() ?? _deLaCopiaLocal(sesion);
    final ultimo = sesion.ultimoUsuario;
    if (ultimo.isNotEmpty) _inicial = ultimo;
    _cargarUsuarios();
  }

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  /// Los usuarios que la tablet guardó para poder entrar sin conexión (null si no hay).
  List<UsuarioLogin>? _deLaCopiaLocal(Sesion sesion) =>
      sesion.credenciales.hayGuardadas ? sesion.credenciales.todas.map((c) => c.toLogin()).toList() : null;

  Future<void> _cargarUsuarios() async {
    final sesion = context.read<Sesion>();
    // Reintenta rápido: la primera conexión a veces se cuelga (servidor recién despierto).
    for (var intento = 0; intento < 3; intento++) {
      try {
        final lista = await sesion.apiPublica.listarUsuariosLogin();
        sesion.guardarUsuarios(lista);
        if (mounted) {
          setState(() {
            _usuarios = lista;
            _errorUsuarios = null;
          });
        }
        return;
      } catch (e) {
        if (intento == 2 && mounted) {
          setState(() {
            _errorUsuarios = '$e';
            // Sin conexión: se ofrecen los usuarios guardados en la tablet.
            _usuarios ??= _deLaCopiaLocal(sesion);
          });
        }
        await Future<void>.delayed(const Duration(milliseconds: 800));
      }
    }
  }

  Future<void> _ingresar() async {
    if (_cargando) return;
    if (_inicial == null) {
      setState(() => _error = 'Selecciona tu usuario');
      return;
    }
    setState(() {
      _error = null;
      _cargando = true;
    });
    try {
      await context.read<Sesion>().iniciarSesion(_inicial!, _password.text);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  void _cambiarServidor() {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (ctx) => ConfiguracionServidor(alGuardar: () {
        Navigator.of(ctx).pop();
        setState(() => _usuarios = context.read<Sesion>().usuariosGuardados());
        _cargarUsuarios();
      }),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final servidor = context.watch<Sesion>().servidor;
    final usuarios = _usuarios ?? const <UsuarioLogin>[];
    // Si el último usuario ya no existe en la lista, no dejarlo elegido.
    final inicialValida = usuarios.any((u) => u.inicial == _inicial) ? _inicial : null;

    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: TarjetaMarca(
            subtitulo: 'Control de Materia Prima — Envases Flexibles',
            child: AutofillGroup(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: inicialValida,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Usuario'),
                    hint: Text(_usuarios == null ? 'Conectando con el servidor...' : 'Selecciona tu nombre'),
                    items: [
                      for (final u in usuarios) DropdownMenuItem(value: u.inicial, child: Text(u.nombre)),
                    ],
                    onChanged: (v) => setState(() => _inicial = v),
                  ),
                  if (_errorUsuarios != null)
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                              usuarios.isNotEmpty
                                  ? 'Sin conexión: se usan los usuarios guardados en la tablet.'
                                  : 'No se pudo cargar la lista de usuarios.',
                              style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 13)),
                        ),
                        TextButton(onPressed: _cargarUsuarios, child: const Text('Reintentar')),
                      ],
                    ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _password,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Clave'),
                    onSubmitted: (_) => _ingresar(),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _cargando ? null : _ingresar,
                    child: Text(_cargando ? 'Ingresando...' : 'Ingresar'),
                  ),
                  const SizedBox(height: 8),
                  TextButton.icon(
                    onPressed: _cambiarServidor,
                    icon: const Icon(Icons.settings_outlined, size: 18, color: Colores.textoApagado),
                    label: Text('Servidor: $servidor', style: const TextStyle(color: Colores.textoApagado)),
                  ),
                  const VersionYBusqueda(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
