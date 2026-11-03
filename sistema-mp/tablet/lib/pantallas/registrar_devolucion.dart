import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api.dart';
import '../api/modelos.dart';
import '../estado/repositorio.dart';
import '../estado/sesion.dart';
import '../tema.dart';
import '../util/formato.dart';
import '../widgets/campo_cantidad.dart';
import '../widgets/comunes.dart';
import '../widgets/selectores.dart';

// Versión tablet de RegistrarDevolucion.tsx. Registra las dos formas en que un
// material vuelve de planta a almacén, que cuentan distinto:
//  - sobrante: se había entregado y no se usó (descuenta del consumo neto);
//  - ingreso a almacén: material FABRICADO en la OT que entra por primera vez
//    (no descuenta nada; después se entrega desde Registrar Entrega).
// Mismas reglas que el escritorio:
//  - un pedido con 2+ entregas se abre en una opción por ENTREGA y el sobrante
//    queda vinculado a esa entrega (salvo que su material se fabrique en la OT);
//  - lo que entrega producción de un material todavía sin pedido (pendiente)
//    va en la misma lista, en naranja, y se registra en tandas;
//  - pasarse de lo "disponible para devolver" es un aviso, nunca un bloqueo;
//  - acá nunca se pregunta proceso ni máquina: almacén no tiene máquinas.

enum _Modo { sobrante, ingreso }

class _Fuente {
  _Fuente(this.clave, this.pedido, [this.entrega]);
  final String clave;
  final Consumo pedido;
  // Si viene, la opción es de ESTA entrega puntual.
  final Entrega? entrega;
}

class _Entrada {
  _Entrada(this.materialId, {this.entregaId});
  int? materialId;
  final int? entregaId;
  final bobinas = Bobinas();
}

class _Seleccion {
  _Seleccion(this.modo, this.entradas);
  _Modo modo;
  final List<_Entrada> entradas;
  // Materiales que realmente se entregaron contra el pedido (solo sobrante de pedido entero).
  Future<List<BalanceMaterial>>? balance;
  List<BalanceMaterial>? balanceListo;

  void dispose() {
    for (final e in entradas) {
      e.bobinas.dispose();
    }
  }
}

class RegistrarDevolucion extends StatefulWidget {
  const RegistrarDevolucion({super.key});

  @override
  State<RegistrarDevolucion> createState() => _RegistrarDevolucionState();
}

class _RegistrarDevolucionState extends State<RegistrarDevolucion> {
  final _numeroOt = TextEditingController();
  final _scroll = ScrollController();

  List<MaterialMp>? _materiales;
  String? _errorCatalogos;

  // Materiales entregados y no devueltos del todo, de cualquier OT (antes de buscar una).
  List<({Consumo pedido, List<String> sustituidos})>? _porDevolver;
  bool _cargandoPorDevolver = false;

  String? _otBuscada;
  bool _cargandoOt = false;
  String? _errorOt;
  OtEncabezado? _encabezado;
  List<Consumo> _pedidos = [];
  List<Entrega> _entregas = [];
  List<Pendiente> _pendientes = [];

  final _seleccion = <String, _Seleccion>{};
  // Lo que entrega producción de un pendiente (sin pedido), por id de pendiente.
  final _ingresos = <int, List<_Entrada>>{};
  String _fecha = hoyIso();
  String? _error;
  bool _guardando = false;
  List<Devolucion> _confirmaciones = [];

  Api get _api => context.read<Sesion>().api;
  late final Repositorio _repo;
  StreamSubscription<String>? _suscripcionOt;

  @override
  void initState() {
    super.initState();
    _repo = context.read<Repositorio>();
    _repo.addListener(_alCambiarCopia);
    // Otro equipo cambió la OT que se está viendo: se actualiza sin tocar nada.
    _suscripcionOt = _repo.cambiosDeOt.listen((ot) {
      if (mounted && ot == _otBuscada && !_guardando) _cargarOt(usarCopia: true);
    });
    _cargarMateriales();
    _cargarPorDevolver();
  }

  // Cuando la copia local se pone al día, la lista de materiales por devolver también.
  void _alCambiarCopia() {
    if (!mounted || !_repo.tieneDatos) return;
    if (_otBuscada == null) _porDevolverDeLaCopia();
    if (_materiales == null) setState(() => _materiales = _repo.materiales);
  }

  @override
  void dispose() {
    _repo.removeListener(_alCambiarCopia);
    _suscripcionOt?.cancel();
    _numeroOt.dispose();
    _scroll.dispose();
    _limpiarSeleccion();
    super.dispose();
  }

  Future<void> _cargarMateriales() async {
    setState(() => _errorCatalogos = null);
    if (_repo.tieneDatos) {
      setState(() => _materiales = _repo.materiales);
      return;
    }
    try {
      final lista = await _api.listarMateriales();
      if (mounted) setState(() => _materiales = lista);
    } catch (e) {
      if (mounted) setState(() => _errorCatalogos = '$e');
    }
  }

  Future<void> _cargarPorDevolver() async {
    if (_repo.tieneDatos) {
      _porDevolverDeLaCopia();
      return;
    }
    setState(() => _cargandoPorDevolver = true);
    try {
      await _repo.sincronizar();
      if (mounted && _repo.tieneDatos) _porDevolverDeLaCopia();
    } finally {
      // Solo una ayuda: si falla, se busca la OT a mano.
      if (mounted) setState(() => _cargandoPorDevolver = false);
    }
  }

  void _porDevolverDeLaCopia() {
    final entregadosPorPedido = <int, Set<String>>{};
    for (final e in _repo.entregas) {
      entregadosPorPedido.putIfAbsent(e.otMaterialId, () => {}).add(e.codigoMpEntregado);
    }
    final lista = _repo.consumo.where((p) => !p.esTinta && p.totalEntregado - p.totalDevuelto > 0.005).toList()
      ..sort((a, b) => (b.totalEntregado - b.totalDevuelto).compareTo(a.totalEntregado - a.totalDevuelto));
    setState(() {
      _porDevolver = [
        for (final p in lista.take(15))
          (
            pedido: p,
            sustituidos: ((entregadosPorPedido[p.otMaterialId] ?? <String>{}).toSet()..remove(p.codigoMp)).toList(),
          ),
      ];
    });
  }

  void _limpiarSeleccion() {
    for (final s in _seleccion.values) {
      s.dispose();
    }
    _seleccion.clear();
    for (final lista in _ingresos.values) {
      for (final e in lista) {
        e.bobinas.dispose();
      }
    }
    _ingresos.clear();
  }

  Future<void> _buscar(String numero) async {
    final n = numero.trim();
    if (n.isEmpty) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _numeroOt.text = n;
      _otBuscada = n;
      _confirmaciones = [];
      _error = null;
      _encabezado = null;
      _limpiarSeleccion();
    });
    await _cargarOt(usarCopia: true);
  }

  void _volverALista() {
    setState(() {
      _otBuscada = null;
      _numeroOt.clear();
      _pedidos = [];
      _entregas = [];
      _pendientes = [];
      _encabezado = null;
      _confirmaciones = [];
      _error = null;
      _limpiarSeleccion();
    });
    _cargarPorDevolver();
  }

  /// Con [usarCopia] se muestra al instante lo que la copia local sabe de la OT
  /// y el servidor confirma enseguida (tras registrar algo no: ahí se espera lo del servidor).
  Future<void> _cargarOt({bool usarCopia = false}) async {
    final ot = _otBuscada;
    if (ot == null) return;
    final previos = usarCopia && _repo.tieneDatos ? _repo.consumoDe(ot).where((p) => !p.esTinta).toList() : <Consumo>[];
    final pendPrevios = usarCopia ? (_repo.pendientesGuardados(ot) ?? []).where((p) => !p.esTinta).toList() : <Pendiente>[];
    final hayCopia = previos.isNotEmpty || pendPrevios.isNotEmpty;
    setState(() {
      if (hayCopia) {
        _pedidos = previos;
        _entregas = _repo.entregasDe(ot);
        _pendientes = pendPrevios;
        _encabezado ??= _repo.encabezadoGuardado(ot);
      }
      _cargandoOt = !hayCopia;
      _errorOt = null;
    });
    try {
      final r = await Future.wait([_api.consultarConsumo(ot), _api.listarEntregas(ot), _repo.pendientesDe(ot)]);
      if (!mounted || _otBuscada != ot) return;
      setState(() {
        _pedidos = (r[0] as List<Consumo>).where((p) => !p.esTinta).toList();
        _entregas = r[1] as List<Entrega>;
        _pendientes = r[2] as List<Pendiente>;
      });
    } catch (e) {
      if (mounted) setState(() => _errorOt = '$e');
    } finally {
      if (mounted) setState(() => _cargandoOt = false);
    }
    try {
      final enc = await _repo.encabezadoDe(ot);
      if (mounted && _otBuscada == ot) setState(() => _encabezado = enc);
    } catch (_) {}
  }

  List<_Fuente> get _fuentes {
    final lista = <_Fuente>[];
    for (final pedido in _pedidos) {
      final suyas = _entregas.where((e) => e.otMaterialId == pedido.otMaterialId).toList();
      // Un pedido cuyo material se fabrica en la OT sigue siendo una sola opción:
      // ahí también se registra el ingreso a almacén.
      if (suyas.length >= 2 && !pedido.tieneMateriaPrima) {
        for (final e in suyas) {
          lista.add(_Fuente('e${e.id}', pedido, e));
        }
      } else {
        lista.add(_Fuente('p${pedido.otMaterialId}', pedido));
      }
    }
    return lista;
  }

  /// Pendientes que siguen recibiendo lo que entrega producción: ya tienen
  /// materia prima (se están fabricando) o ya recibieron algún ingreso.
  List<Pendiente> get _pendientesConMovimiento =>
      _pendientes.where((p) => !p.esTinta && (p.materiasPrimas.isNotEmpty || p.totalIngresado > 0)).toList();

  Map<int, String> get _letras => letrasDeEntregas(_entregas.map(
      (e) => (id: e.id, numeroOt: e.numeroOt, codigo: e.codigoMpEntregado, fecha: e.fecha, hora: e.hora)));

  MaterialMp? _material(int? id) => _materiales?.where((m) => m.id == id).firstOrNull;

  /// Pide los materiales entregados contra el pedido; si fue uno solo, todas
  /// las entradas pasan a ser de ese material (aunque no sea el del pedido).
  void _pedirBalance(_Seleccion sel, Consumo pedido) {
    sel.balance ??= _api.listarMaterialesEntregados(pedido.otMaterialId).then((lista) {
      if (mounted) {
        setState(() {
          sel.balanceListo = lista;
          if (lista.length == 1) {
            for (final e in sel.entradas) {
              e.materialId = lista.first.materialId;
            }
          }
        });
      }
      return lista;
    });
  }

  void _alternar(_Fuente f) {
    setState(() {
      _confirmaciones = [];
      final actual = _seleccion.remove(f.clave);
      if (actual != null) {
        actual.dispose();
        return;
      }
      final e = f.entrega;
      final sel = e != null
          ? _Seleccion(_Modo.sobrante, [_Entrada(e.materialEntregadoId, entregaId: e.id)])
          // Si el material se fabrica en la OT, casi siempre se viene a registrar su ingreso.
          : _Seleccion(f.pedido.tieneMateriaPrima ? _Modo.ingreso : _Modo.sobrante, [_Entrada(f.pedido.materialId)]);
      if (e == null && sel.modo == _Modo.sobrante) _pedirBalance(sel, f.pedido);
      _seleccion[f.clave] = sel;
    });
  }

  void _cambiarModo(_Fuente f, _Seleccion sel, _Modo modo) {
    setState(() {
      sel.modo = modo;
      // Al cambiar de modo el material vuelve al del pedido; en sobrante, si se
      // entregó uno solo, el balance lo corrige.
      for (final e in sel.entradas) {
        e.materialId = f.pedido.materialId;
      }
      if (modo == _Modo.sobrante) {
        final lista = sel.balanceListo;
        if (lista != null && lista.length == 1) {
          for (final e in sel.entradas) {
            e.materialId = lista.first.materialId;
          }
        }
        _pedirBalance(sel, f.pedido);
      }
    });
  }

  void _alternarIngreso(Pendiente p) {
    setState(() {
      _confirmaciones = [];
      final actual = _ingresos.remove(p.id);
      if (actual != null) {
        for (final e in actual) {
          e.bobinas.dispose();
        }
      } else {
        _ingresos[p.id] = [_Entrada(p.materialId)];
      }
    });
  }

  Future<void> _elegirFecha() async {
    final elegida = await elegirFecha(context, _fecha);
    if (elegida != null) setState(() => _fecha = elegida);
  }

  void _mostrarConfirmacion() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(0, duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
      }
    });
  }

  void _alRegistrarIngresoLibre(Devolucion d) {
    setState(() {
      _confirmaciones = [d];
      _error = null;
    });
    _mostrarConfirmacion();
    _cargarOt();
  }

  Future<void> _guardar() async {
    if (_guardando) return; // un segundo toque mientras guarda no registra otra vez
    if (_seleccion.isEmpty && _ingresos.isEmpty) {
      setState(() => _error = 'Selecciona al menos un material');
      return;
    }
    final todas = [
      for (final s in _seleccion.values) ...s.entradas,
      for (final l in _ingresos.values) ...l,
    ];
    if (todas.any((e) => e.bobinas.pesos.isEmpty || e.bobinas.hayInvalido)) {
      setState(() => _error = 'Cada material seleccionado necesita una cantidad válida mayor a 0');
      return;
    }
    if (_seleccion.values.any((s) => s.entradas.any((e) => e.materialId == null))) {
      setState(() => _error = 'Elige qué material se está devolviendo');
      return;
    }
    if (_ingresos.values.any((l) => l.any((e) => e.materialId == null))) {
      setState(() => _error = 'Indica a qué material del catálogo corresponde lo que entrega producción');
      return;
    }

    final fuentes = {for (final f in _fuentes) f.clave: f};
    final pendientes = {for (final p in _pendientes) p.id: p};
    setState(() {
      _guardando = true;
      _error = null;
    });
    final exitos = <Devolucion>[];
    final fallos = <String>[];

    for (final entry in _seleccion.entries.toList()) {
      final fuente = fuentes[entry.key];
      if (fuente == null) continue;
      final sel = entry.value;
      for (final entrada in sel.entradas.toList()) {
        try {
          exitos.add(await _api.registrarDevolucion(
            otMaterialId: fuente.pedido.otMaterialId,
            materialId: entrada.materialId!,
            fecha: _fecha,
            bobinas: entrada.bobinas.pesos,
            esIngresoProduccion: sel.modo == _Modo.ingreso,
            entregaId: sel.modo == _Modo.sobrante ? entrada.entregaId : null,
          ));
          sel.entradas.remove(entrada);
          entrada.bobinas.dispose();
        } catch (e) {
          fallos.add('${fuente.pedido.codigoMp} (${e is ApiError ? e.mensaje : 'error de conexión'})');
        }
      }
      if (sel.entradas.isEmpty) _seleccion.remove(entry.key); // lo que entró se limpia
    }

    for (final entry in _ingresos.entries.toList()) {
      final lista = entry.value;
      for (final entrada in lista.toList()) {
        try {
          exitos.add(await _api.registrarDevolucion(
            pendienteId: entry.key,
            materialId: entrada.materialId!,
            fecha: _fecha,
            bobinas: entrada.bobinas.pesos,
            esIngresoProduccion: true,
          ));
          lista.remove(entrada);
          entrada.bobinas.dispose();
        } catch (e) {
          fallos.add('${pendientes[entry.key]?.codigoMp ?? '#${entry.key}'} '
              '(${e is ApiError ? e.mensaje : 'error de conexión'})');
        }
      }
      if (lista.isEmpty) _ingresos.remove(entry.key);
    }

    if (!mounted) return;
    setState(() {
      _guardando = false;
      _confirmaciones = exitos;
      _error = fallos.isEmpty ? null : 'No se pudieron registrar: ${fallos.join(', ')}';
    });
    if (exitos.isNotEmpty) _mostrarConfirmacion();
    await _cargarOt();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      controller: _scroll,
      padding: const EdgeInsets.all(20),
      children: [
        const Text('Registrar Devolución', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w600)),
        const SizedBox(height: 16),
        if (_confirmaciones.isNotEmpty) ...[
          _Confirmaciones(devoluciones: _confirmaciones),
          const SizedBox(height: 16),
        ],
        if (_errorCatalogos != null) ...[
          Aviso(
            color: Colores.peligro,
            texto: 'No se pudieron cargar los materiales: $_errorCatalogos',
            accion: TextButton(onPressed: _cargarMateriales, child: const Text('Reintentar')),
          ),
          const SizedBox(height: 12),
        ],
        _tarjetaBuscar(),
        if (_otBuscada == null) ...[const SizedBox(height: 16), _tarjetaPorDevolver()],
        if (_seleccion.isNotEmpty || _ingresos.isNotEmpty) ...[const SizedBox(height: 16), _tarjetaCantidades()],
      ],
    );
  }

  Widget _tarjetaBuscar() {
    final letras = _letras;
    final pendientes = _pendientesConMovimiento;
    return Tarjeta(
      titulo: 'Buscar OT',
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _numeroOt,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(labelText: 'Número de OT', hintText: '2121'),
                textInputAction: TextInputAction.search,
                onSubmitted: _buscar,
              ),
            ),
            const SizedBox(width: 10),
            FilledButton.icon(
              onPressed: () => _buscar(_numeroOt.text),
              icon: const Icon(Icons.search),
              label: const Text('Buscar'),
            ),
            if (_otBuscada != null) ...[
              const SizedBox(width: 8),
              IconButton(tooltip: 'Otra OT', onPressed: _volverALista, icon: const Icon(Icons.close)),
            ],
          ],
        ),
        if (_encabezado != null &&
            ((_encabezado!.cliente ?? '').isNotEmpty || (_encabezado!.descripcionProducto ?? '').isNotEmpty)) ...[
          const SizedBox(height: 12),
          EncabezadoOt(encabezado: _encabezado!),
        ],
        if (_otBuscada != null && _materiales != null) ...[
          const SizedBox(height: 12),
          _IngresoLibre(
            key: ValueKey('libre-$_otBuscada'),
            numeroOt: _otBuscada!,
            fecha: _fecha,
            materiales: _materiales!,
            alRegistrar: _alRegistrarIngresoLibre,
          ),
        ],
        if (_cargandoOt) ...[const SizedBox(height: 16), const Center(child: CircularProgressIndicator())],
        if (_errorOt != null) ...[
          const SizedBox(height: 12),
          Aviso(
            color: Colores.peligro,
            texto: _errorOt!,
            accion: TextButton(onPressed: _cargarOt, child: const Text('Reintentar')),
          ),
        ],
        if (_otBuscada != null && !_cargandoOt && _errorOt == null && _pedidos.isEmpty && pendientes.isEmpty) ...[
          const SizedBox(height: 12),
          const Text('No hay materiales entregados para esa OT.', style: TextStyle(color: Colores.textoApagado)),
        ],
        if (_pedidos.isNotEmpty || pendientes.isNotEmpty) ...[
          const SizedBox(height: 16),
          const Text(
            'Materiales de esta OT — toca todos a los que corresponda. Por acá vuelven los sobrantes y también entra '
            'a almacén el material que se fabricó en la OT.',
            style: TextStyle(fontSize: 13, color: Colores.textoApagado),
          ),
          const SizedBox(height: 8),
          // Lo que entrega producción va en la misma lista: se registra en tandas
          // y en otra sección parecía que ya estaba cerrado.
          for (final p in pendientes)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _OpcionPendiente(
                pendiente: p,
                resuelto: p.materialId != null ? _material(p.materialId) : null,
                seleccionada: _ingresos.containsKey(p.id),
                alTocar: () => _alternarIngreso(p),
              ),
            ),
          for (final f in _fuentes)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _OpcionPedido(
                fuente: f,
                entregasDelPedido: _entregas.where((e) => e.otMaterialId == f.pedido.otMaterialId).toList(),
                letras: letras,
                seleccionada: _seleccion.containsKey(f.clave),
                alTocar: () => _alternar(f),
              ),
            ),
        ],
      ],
    );
  }

  Widget _tarjetaPorDevolver() {
    return Tarjeta(
      titulo: 'Materiales pendientes de devolver',
      accion: IconButton(
        tooltip: 'Actualizar',
        onPressed: _cargandoPorDevolver ? null : _cargarPorDevolver,
        icon: const Icon(Icons.refresh),
      ),
      children: [
        if (_cargandoPorDevolver && _porDevolver == null) const Center(child: CircularProgressIndicator()),
        if (_porDevolver != null && _porDevolver!.isEmpty)
          const Text('No hay materiales pendientes de devolver.', style: TextStyle(color: Colores.textoApagado)),
        for (final item in _porDevolver ?? const <({Consumo pedido, List<String> sustituidos})>[])
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: BotonLista(
              alTocar: () => _buscar(item.pedido.numeroOt),
              child: _FilaPorDevolver(pedido: item.pedido, sustituidos: item.sustituidos),
            ),
          ),
      ],
    );
  }

  Widget _tarjetaCantidades() {
    final letras = _letras;
    final cantidad = _seleccion.length + _ingresos.length;
    return Tarjeta(
      titulo: 'Cantidades a registrar',
      children: [
        Row(
          children: [
            const Text('Fecha: ', style: TextStyle(fontWeight: FontWeight.w500)),
            OutlinedButton.icon(
              onPressed: _elegirFecha,
              icon: const Icon(Icons.calendar_today, size: 18),
              label: Text(formatearFecha(_fecha)),
            ),
          ],
        ),
        const SizedBox(height: 16),
        for (final f in _fuentes.where((f) => _seleccion.containsKey(f.clave)))
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _TarjetaDevolucion(
              key: ValueKey('sel-${f.clave}'),
              fuente: f,
              letra: f.entrega != null ? letras[f.entrega!.id] : null,
              seleccion: _seleccion[f.clave]!,
              alCambiar: () => setState(() {}),
              alCambiarModo: (m) => _cambiarModo(f, _seleccion[f.clave]!, m),
              alQuitar: () => _alternar(f),
            ),
          ),
        for (final p in _pendientesConMovimiento.where((p) => _ingresos.containsKey(p.id)))
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _TarjetaIngresoPendiente(
              key: ValueKey('ing-${p.id}'),
              pendiente: p,
              materiales: _materiales ?? const [],
              entradas: _ingresos[p.id]!,
              alCambiar: () => setState(() {}),
              alQuitar: () => _alternarIngreso(p),
            ),
          ),
        if (_error != null) ...[
          Text(_error!, style: const TextStyle(color: Colores.peligro)),
          const SizedBox(height: 12),
        ],
        FilledButton(
          onPressed: _guardando ? null : _guardar,
          child: Text(_guardando ? 'Guardando...' : (cantidad > 1 ? 'Guardar $cantidad registros' : 'Guardar registro')),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------

class _FilaPorDevolver extends StatelessWidget {
  const _FilaPorDevolver({required this.pedido, required this.sustituidos});

  final Consumo pedido;
  final List<String> sustituidos;

  @override
  Widget build(BuildContext context) {
    // Lo que hay para devolver es lo que REALMENTE salió de almacén.
    final principal = sustituidos.length == 1 ? sustituidos.first : pedido.codigoMp;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(TextSpan(children: [
          TextSpan(text: principal, style: const TextStyle(fontWeight: FontWeight.w600)),
          if (sustituidos.length == 1)
            TextSpan(text: ' (pedido: ${pedido.codigoMp})', style: const TextStyle(color: Colores.aviso)),
          if (sustituidos.length > 1)
            TextSpan(text: ' (se entregó: ${sustituidos.join(', ')})', style: const TextStyle(color: Colores.aviso)),
          TextSpan(text: ' — OT ${pedido.numeroOt}', style: const TextStyle(color: Colores.textoApagado)),
        ])),
        Text(
          '${pedido.cliente ?? 'Sin cliente'}${pedido.diseno != null ? ' · ${pedido.diseno}' : ''}'
          ' · ${pedido.proceso} · ${pedido.maquina}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: Colores.textoApagado),
        ),
        Text(
          'Disponible para devolver: ${(pedido.totalEntregado - pedido.totalDevuelto).toStringAsFixed(2)} ${pedido.unidad}',
          style: const TextStyle(color: Colores.textoApagado),
        ),
      ],
    );
  }
}

class _OpcionPendiente extends StatelessWidget {
  const _OpcionPendiente({
    required this.pendiente,
    required this.resuelto,
    required this.seleccionada,
    required this.alTocar,
  });

  final Pendiente pendiente;
  final MaterialMp? resuelto;
  final bool seleccionada;
  final VoidCallback alTocar;

  @override
  Widget build(BuildContext context) {
    final p = pendiente;
    return BotonLista(
      seleccionado: seleccionada,
      color: Colores.aviso,
      resaltarBorde: true,
      alTocar: alTocar,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(resuelto?.codigoMp ?? p.codigoMp, style: const TextStyle(fontWeight: FontWeight.w600)),
              if (resuelto != null && resuelto!.codigoMp != p.codigoMp) CodigoExcel(p.codigoMp),
              Etiqueta(
                p.materiasPrimas.isNotEmpty ? 'lo entrega producción' : 'material ingresado de producción a almacén',
                color: Colores.aviso,
                icono: Icons.science_outlined,
              ),
            ],
          ),
          Text(
            'Ingresó a almacén: ${numero(p.totalIngresado)}'
            '${p.cantidadRequerida != null ? ' de ${numero(p.cantidadRequerida!)}' : ''}'
            '${p.materiasPrimas.isNotEmpty ? ' · Materia prima: ${p.materiasPrimas.join(', ')}' : ''}'
            ' · Sin proceso asignado todavía',
            style: const TextStyle(fontSize: 13, color: Colores.textoApagado),
          ),
        ],
      ),
    );
  }
}

class _OpcionPedido extends StatelessWidget {
  const _OpcionPedido({
    required this.fuente,
    required this.entregasDelPedido,
    required this.letras,
    required this.seleccionada,
    required this.alTocar,
  });

  final _Fuente fuente;
  final List<Entrega> entregasDelPedido;
  final Map<int, String> letras;
  final bool seleccionada;
  final VoidCallback alTocar;

  @override
  Widget build(BuildContext context) {
    final pedido = fuente.pedido;
    final e = fuente.entrega;

    if (e != null) {
      // Una entrega puntual: su proceso, máquina, material y hora.
      final sustituida = e.codigoMpEntregado != pedido.codigoMp;
      final quedan = redondearPeso(e.totalEntregado - e.totalDevueltoEntrega);
      return BotonLista(
        seleccionado: seleccionada,
        alTocar: alTocar,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text.rich(TextSpan(children: [
                  TextSpan(text: '${e.proceso} — ${e.maquina} — ', style: const TextStyle(fontWeight: FontWeight.w600)),
                  codigoConLetra(e.codigoMpEntregado, letras[e.id],
                      estilo: TextStyle(
                          fontWeight: FontWeight.w600, color: sustituida ? Colores.aviso : Colores.texto)),
                ])),
                if (sustituida) Etiqueta('pedido: ${pedido.codigoMp}', color: Colores.aviso, icono: Icons.swap_horiz),
              ],
            ),
            Text(
              'Entrega de las ${horaCorta(e.hora)} (${formatearFecha(e.fecha)}): ${numero(e.totalEntregado)} '
              '${pedido.unidad} · Ya devuelto de esta entrega: ${numero(e.totalDevueltoEntrega)} ${pedido.unidad}'
              ' · Queda: ${numero(quedan)} ${pedido.unidad}',
              style: const TextStyle(fontSize: 13, color: Colores.textoApagado),
            ),
          ],
        ),
      );
    }

    // El título es lo que REALMENTE se entregó; el código del pedido va en "pedido: X".
    final entregados = {for (final x in entregasDelPedido) x.codigoMpEntregado}.toList();
    final sustituidos = entregados.where((c) => c != pedido.codigoMp).toList();
    final titulo = entregados.isNotEmpty ? entregados.join(' / ') : pedido.codigoMp;
    return BotonLista(
      seleccionado: seleccionada,
      alTocar: alTocar,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text.rich(TextSpan(children: [
                TextSpan(
                    text: '${pedido.proceso} — ${pedido.maquina} — ', style: const TextStyle(fontWeight: FontWeight.w600)),
                TextSpan(
                  text: titulo,
                  style: TextStyle(
                      fontWeight: FontWeight.w600, color: sustituidos.isNotEmpty ? Colores.aviso : Colores.texto),
                ),
              ])),
              if (pedido.tieneMateriaPrima)
                const Etiqueta('se fabrica en esta OT', color: Colores.primario, icono: Icons.science_outlined),
              if (pedido.esMateriaPrima)
                Etiqueta('materia prima de ${pedido.insumoDeCodigoMp}', color: Colores.textoApagado),
              if (sustituidos.isNotEmpty)
                Etiqueta('pedido: ${pedido.codigoMp}', color: Colores.aviso, icono: Icons.swap_horiz),
            ],
          ),
          Text(
            'Entregado: ${numero(pedido.totalEntregado)} ${pedido.unidad}'
            '${pedido.cantidadRequerida != null ? ' de ${numero(pedido.cantidadRequerida!)} requeridos' : ''}'
            ' · Ya devuelto: ${numero(pedido.totalDevuelto)} ${pedido.unidad}'
            '${pedido.totalIngresado > 0 ? ' · Ingresó fabricado: ${numero(pedido.totalIngresado)} ${pedido.unidad}' : ''}'
            ' · ${pedido.estadoEntrega}',
            style: const TextStyle(fontSize: 13, color: Colores.textoApagado),
          ),
        ],
      ),
    );
  }
}

/// Lo que se devuelve (o ingresa) de un pedido o de una entrega puntual.
class _TarjetaDevolucion extends StatelessWidget {
  const _TarjetaDevolucion({
    super.key,
    required this.fuente,
    required this.letra,
    required this.seleccion,
    required this.alCambiar,
    required this.alCambiarModo,
    required this.alQuitar,
  });

  final _Fuente fuente;
  final String? letra;
  final _Seleccion seleccion;
  final VoidCallback alCambiar;
  final ValueChanged<_Modo> alCambiarModo;
  final VoidCallback alQuitar;

  @override
  Widget build(BuildContext context) {
    final pedido = fuente.pedido;
    final entrega = fuente.entrega;
    final esIngreso = seleccion.modo == _Modo.ingreso;
    // De una entrega puntual hay un solo material (el suyo); de un pedido
    // entero, los que realmente se entregaron contra él.
    final balance = esIngreso || entrega != null ? const <BalanceMaterial>[] : (seleccion.balanceListo ?? const []);
    final principal = entrega != null
        ? entrega.codigoMpEntregado
        : (balance.length == 1 ? balance.first.codigoMp : pedido.codigoMp);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: esIngreso ? Colores.aviso.withValues(alpha: 0.05) : null,
        border: Border.all(color: esIngreso ? Colores.aviso.withValues(alpha: 0.4) : Colores.borde),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text.rich(TextSpan(children: [
                  if (entrega != null)
                    TextSpan(
                        text: '${entrega.proceso} — ${entrega.maquina} — ',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                  codigoConLetra(principal, letra, estilo: const TextStyle(fontWeight: FontWeight.w600)),
                  if (principal != pedido.codigoMp)
                    TextSpan(
                        text: '  (pedido: ${pedido.codigoMp})',
                        style: const TextStyle(fontSize: 12, color: Colores.aviso)),
                  if (entrega != null)
                    TextSpan(
                      text: '  · entrega de las ${horaCorta(entrega.hora)} (${formatearFecha(entrega.fecha)})',
                      style: const TextStyle(fontSize: 12, color: Colores.textoApagado),
                    ),
                ])),
              ),
              IconButton(tooltip: 'Quitar', onPressed: alQuitar, icon: const Icon(Icons.close)),
            ],
          ),
          // Un pedido con materia prima puede recibir las dos cosas: por eso se pregunta.
          if (pedido.tieneMateriaPrima && entrega == null) ...[
            const SizedBox(height: 4),
            const Text('¿Qué estás registrando?', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
            const SizedBox(height: 6),
            SegmentedButton<_Modo>(
              segments: const [
                ButtonSegment(value: _Modo.ingreso, label: Text('Ingreso a almacén (fabricado en esta OT)')),
                ButtonSegment(value: _Modo.sobrante, label: Text('Devolución de sobrante')),
              ],
              selected: {seleccion.modo},
              onSelectionChanged: (s) => alCambiarModo(s.first),
            ),
            const SizedBox(height: 12),
          ],
          if (esIngreso) ...[
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colores.aviso.withValues(alpha: 0.1),
                border: Border.all(color: Colores.aviso.withValues(alpha: 0.4)),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text.rich(
                TextSpan(children: [
                  const TextSpan(
                      text: 'Registro de ingreso a almacén. ',
                      style: TextStyle(fontWeight: FontWeight.w600, color: Colores.aviso)),
                  TextSpan(
                    text: 'Entra ${pedido.codigoMp} fabricado en esta OT, no un sobrante — no descuenta del consumo.'
                        '${pedido.cantidadRequerida != null ? ' Van ${numero(pedido.totalIngresado)} de ${numero(pedido.cantidadRequerida!)} ${pedido.unidad}.' : ' Ingresado hasta ahora: ${numero(pedido.totalIngresado)} ${pedido.unidad}.'}'
                        ' Una vez en almacén se entrega desde Registrar Entrega.',
                  ),
                ]),
                style: const TextStyle(fontSize: 12),
              ),
            ),
            const SizedBox(height: 12),
          ],
          if (!esIngreso &&
              entrega == null &&
              pedido.cantidadRequerida != null &&
              pedido.cantidadRequerida! - pedido.totalEntregado > 0) ...[
            Text(
              'Aún falta entregar del pedido: ${(pedido.cantidadRequerida! - pedido.totalEntregado).toStringAsFixed(2)} ${pedido.unidad}',
              style: const TextStyle(fontSize: 12, color: Colores.textoApagado),
            ),
            const SizedBox(height: 8),
          ],
          if (!esIngreso && entrega == null && seleccion.balanceListo == null)
            const Padding(padding: EdgeInsets.only(bottom: 8), child: LinearProgressIndicator()),
          for (final (i, entrada) in seleccion.entradas.indexed)
            _filaEntrada(i, entrada, balance, esIngreso),
          // Varios materiales del mismo pedido solo si se le entregó más de uno (una sustitución parcial).
          if (!esIngreso && balance.length > 1)
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: () {
                  seleccion.entradas.add(_Entrada(null));
                  alCambiar();
                },
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Agregar otro material devuelto'),
              ),
            ),
        ],
      ),
    );
  }

  Widget _filaEntrada(int i, _Entrada entrada, List<BalanceMaterial> balance, bool esIngreso) {
    final pedido = fuente.pedido;
    final entrega = fuente.entrega;
    final elegido = balance.where((m) => m.materialId == entrada.materialId).firstOrNull;
    final double disponible;
    if (entrega != null) {
      disponible = redondearPeso(entrega.totalEntregado - entrega.totalDevueltoEntrega);
    } else if (elegido != null) {
      disponible = elegido.disponible;
    } else {
      disponible = balance.length <= 1 ? pedido.totalEntregado - pedido.totalDevuelto : 0;
    }
    final unidad = entrega?.unidad ?? elegido?.unidad ?? pedido.unidad;
    final usaBobinas = entrega?.usaBobinas ?? elegido?.usaBobinas ?? pedido.usaBobinas;

    return Padding(
      padding: EdgeInsets.only(top: i > 0 ? 12 : 0, bottom: 8),
      child: ListenableBuilder(
        listenable: entrada.bobinas,
        builder: (context, _) {
          final excede = entrada.bobinas.total > disponible;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (i > 0) const Divider(),
              if (balance.length > 1) ...[
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<int>(
                        initialValue: elegido?.materialId,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: '¿Qué material se está devolviendo?'),
                        items: [
                          for (final m in balance)
                            DropdownMenuItem(
                              value: m.materialId,
                              child: Text('${m.codigoMp} — disponible: ${m.disponible.toStringAsFixed(2)} ${m.unidad}'),
                            ),
                        ],
                        onChanged: (v) {
                          entrada.materialId = v;
                          alCambiar();
                        },
                      ),
                    ),
                    if (i > 0)
                      IconButton(
                        tooltip: 'Quitar este material',
                        onPressed: () {
                          seleccion.entradas.removeAt(i).bobinas.dispose();
                          alCambiar();
                        },
                        icon: const Icon(Icons.close, color: Colores.peligro),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
              ],
              if (!esIngreso)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    entrega != null
                        ? 'Disponible de esa entrega (${horaCorta(entrega.hora)}): ${disponible.toStringAsFixed(2)} $unidad'
                        : 'Disponible para devolver según el sistema: ${disponible.toStringAsFixed(2)} $unidad',
                    style: const TextStyle(fontSize: 12, color: Colores.textoApagado),
                  ),
                ),
              CampoCantidad(bobinas: entrada.bobinas, unidad: unidad, usaBobinas: usaBobinas),
              // Aviso, no bloqueo: el conteo físico manda.
              if (!esIngreso && excede)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    'Estás registrando más de lo que el sistema tiene como entregado'
                    '${entrega != null ? ' en esa entrega' : ''} (${disponible.toStringAsFixed(2)} $unidad). '
                    'Se puede guardar igual si es lo que realmente volvió a bodega.',
                    style: const TextStyle(fontSize: 12, color: Colores.aviso),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

/// Lo que entrega producción de un material que todavía no tiene pedido. Solo
/// la cantidad (y el material si el código del Excel no se resolvió); puede
/// salir dividido en más de un material en la misma tanda.
class _TarjetaIngresoPendiente extends StatelessWidget {
  const _TarjetaIngresoPendiente({
    super.key,
    required this.pendiente,
    required this.materiales,
    required this.entradas,
    required this.alCambiar,
    required this.alQuitar,
  });

  final Pendiente pendiente;
  final List<MaterialMp> materiales;
  final List<_Entrada> entradas;
  final VoidCallback alCambiar;
  final VoidCallback alQuitar;

  @override
  Widget build(BuildContext context) {
    final p = pendiente;
    final resuelto = p.materialId != null ? materiales.where((m) => m.id == p.materialId).firstOrNull : null;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colores.aviso.withValues(alpha: 0.05),
        border: Border.all(color: Colores.aviso.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  Text(resuelto?.codigoMp ?? p.codigoMp, style: const TextStyle(fontWeight: FontWeight.w600)),
                  if (resuelto != null && resuelto.codigoMp != p.codigoMp) CodigoExcel(p.codigoMp),
                ]),
              ),
              IconButton(tooltip: 'Quitar', onPressed: alQuitar, icon: const Icon(Icons.close)),
            ],
          ),
          Text.rich(
            TextSpan(children: [
              const TextSpan(
                  text: 'Producción lo está entregando. ',
                  style: TextStyle(fontWeight: FontWeight.w600, color: Colores.aviso)),
              TextSpan(
                text: 'Entra a almacén, no es un sobrante — no descuenta del consumo.'
                    '${p.totalIngresado > 0 ? ' Ya entraron ${numero(p.totalIngresado)} en entregas anteriores.' : ''}',
              ),
            ]),
            style: const TextStyle(fontSize: 12, color: Colores.textoApagado),
          ),
          const SizedBox(height: 12),
          for (final (i, entrada) in entradas.indexed) ...[
            if (i > 0) const Divider(height: 24),
            // Sin resolver, cada fila necesita su material; resuelto, solo si hay más de una.
            if (p.materialId == null || entradas.length > 1) ...[
              Row(
                children: [
                  Expanded(
                    child: SelectorMaterial(
                      etiqueta: p.materialId == null ? '¿A qué material del catálogo corresponde?' : 'Esta tanda entró como',
                      materiales: materiales,
                      valor: entrada.materialId,
                      alCambiar: (id) {
                        entrada.materialId = id;
                        alCambiar();
                      },
                    ),
                  ),
                  if (i > 0)
                    IconButton(
                      tooltip: 'Quitar este material',
                      onPressed: () {
                        entradas.removeAt(i).bobinas.dispose();
                        alCambiar();
                      },
                      icon: const Icon(Icons.close, color: Colores.peligro),
                    ),
                ],
              ),
              const SizedBox(height: 10),
            ],
            Builder(builder: (_) {
              final m = materiales.where((x) => x.id == entrada.materialId).firstOrNull;
              return CampoCantidad(bobinas: entrada.bobinas, unidad: m?.unidad ?? '', usaBobinas: m?.usaBobinas ?? true);
            }),
          ],
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: () {
                entradas.add(_Entrada(null));
                alCambiar();
              },
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Agregar otro material'),
            ),
          ),
          const SizedBox(height: 6),
          const Text('Cuando salga hacia producción, en Registrar Entrega eliges el proceso y la máquina.',
              style: TextStyle(fontSize: 12, color: Colores.textoApagado)),
        ],
      ),
    );
  }
}

/// "Registrar ingreso de LDPE-3": un material fabricado que entra a almacén,
/// solo material + cantidad. El backend lo engancha al pedido que la OT ya
/// tenga para ese material, o crea un pendiente suelto (nunca duplica).
class _IngresoLibre extends StatefulWidget {
  const _IngresoLibre({
    super.key,
    required this.numeroOt,
    required this.fecha,
    required this.materiales,
    required this.alRegistrar,
  });

  final String numeroOt;
  final String fecha;
  final List<MaterialMp> materiales;
  final ValueChanged<Devolucion> alRegistrar;

  @override
  State<_IngresoLibre> createState() => _IngresoLibreState();
}

class _IngresoLibreState extends State<_IngresoLibre> {
  bool _abierto = false;
  int? _materialId;
  final _bobinas = Bobinas();
  String? _error;
  bool _guardando = false;

  @override
  void dispose() {
    _bobinas.dispose();
    super.dispose();
  }

  void _cerrar() => setState(() {
        _abierto = false;
        _materialId = null;
        _bobinas.limpiar();
        _error = null;
      });

  Future<void> _guardar() async {
    if (_guardando) return;
    if (_materialId == null) {
      setState(() => _error = 'Elige qué material está entrando a almacén');
      return;
    }
    if (_bobinas.pesos.isEmpty || _bobinas.hayInvalido) {
      setState(() => _error = 'Carga una cantidad válida mayor a 0');
      return;
    }
    setState(() {
      _guardando = true;
      _error = null;
    });
    final api = context.read<Sesion>().api;
    try {
      final destino = await api.resolverIngresoLibre(widget.numeroOt, _materialId!, _bobinas.total);
      final d = await api.registrarDevolucion(
        otMaterialId: destino.otMaterialId,
        pendienteId: destino.otMaterialId == null ? destino.pendienteId : null,
        materialId: _materialId!,
        fecha: widget.fecha,
        bobinas: _bobinas.pesos,
        esIngresoProduccion: true,
      );
      _cerrar();
      widget.alRegistrar(d);
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiError ? e.mensaje : 'No se pudo registrar');
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_abierto) {
      return Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          onPressed: () => setState(() => _abierto = true),
          icon: const Icon(Icons.add, size: 18),
          label: const Text('Registrar ingreso de LDPE-3'),
        ),
      );
    }
    final material = widget.materiales.where((m) => m.id == _materialId).firstOrNull;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colores.aviso.withValues(alpha: 0.05),
        border: Border.all(color: Colores.aviso.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Para un material fabricado que entra a almacén — no es un sobrante.',
              style: TextStyle(fontSize: 12, color: Colores.textoApagado)),
          const SizedBox(height: 12),
          SelectorMaterial(
            materiales: widget.materiales,
            valor: _materialId,
            alCambiar: (id) => setState(() => _materialId = id),
          ),
          const SizedBox(height: 12),
          CampoCantidad(bobinas: _bobinas, unidad: material?.unidad ?? '', usaBobinas: material?.usaBobinas ?? true),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colores.peligro)),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              FilledButton(
                onPressed: _guardando ? null : _guardar,
                child: Text(_guardando ? 'Registrando...' : 'Registrar'),
              ),
              const SizedBox(width: 8),
              OutlinedButton(onPressed: _cerrar, child: const Text('Cancelar')),
            ],
          ),
        ],
      ),
    );
  }
}

class _Confirmaciones extends StatelessWidget {
  const _Confirmaciones({required this.devoluciones});

  final List<Devolucion> devoluciones;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colores.exito.withValues(alpha: 0.1),
        border: Border.all(color: Colores.exito.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final d in devoluciones)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.check_circle, color: Colores.exito),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '${numero(d.totalDevuelto)} ${d.unidad} de ${d.codigoMp} '
                      '${d.esIngresoProduccion ? 'ingresados a almacén' : 'devueltos'}'
                      '${d.entregaHora != null ? ' (de la entrega de las ${horaCorta(d.entregaHora!)})' : ''}.',
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
