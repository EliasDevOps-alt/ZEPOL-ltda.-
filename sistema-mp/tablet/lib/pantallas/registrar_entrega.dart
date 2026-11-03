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

// Versión tablet de RegistrarEntrega.tsx. Mismas reglas que el escritorio:
//  - un pedido con 2+ entregas se abre en una opción por ENTREGA (proceso,
//    máquina, material y hora), con 0 o 1 es una opción por pedido;
//  - se pueden marcar varias y se manda un POST /entregas por cada una;
//  - Proceso y Máquina de cada entrega van precargados con los de la entrega
//    anterior (o los del pedido) y se pueden cambiar;
//  - "¿Se entregó un material distinto?" solo en la primera entrega;
//  - los cargos de tinta no se muestran (nunca se entregan).
// No están en la tablet (se hacen en la PC): corregir/eliminar un pedido y
// crear un material nuevo en el catálogo.

/// Una opción de la lista "Materiales pedidos en esta OT".
class _Fuente {
  _Fuente(this.clave, this.pedido, this.entregas);
  final String clave;
  final Consumo pedido;
  // La entrega de esta opción, o todas las del pedido cuando tiene 0 o 1.
  final List<Entrega> entregas;
}

/// Lo que se está cargando para una entrega nueva.
class _Seleccion {
  _Seleccion({this.materialId, this.procesoId, this.maquinaId});

  int? materialId; // null = el material del pedido, tal cual
  int? procesoId;
  int? maquinaId;
  bool cambiarMaterial = false;
  final bobinas = Bobinas();
  final nota = TextEditingController();

  void dispose() {
    bobinas.dispose();
    nota.dispose();
  }

  /// Qué falta antes de poder guardarla, o null si está todo bien.
  String? problema() {
    if (bobinas.hayInvalido) return 'La cantidad entregada debe ser válida y mayor a 0';
    if (bobinas.pesos.isEmpty) return 'Completa la cantidad entregada';
    if (procesoId != null && maquinaId == null) return 'Elige la máquina de esta entrega';
    return null;
  }
}

/// Arranca con el proceso/máquina/material de la última entrega del pedido;
/// sin entregas, con los del pedido.
_Seleccion _seleccionContinuando(Consumo pedido, List<Entrega> entregas) {
  if (entregas.isEmpty) return _Seleccion(procesoId: pedido.procesoId, maquinaId: pedido.maquinaId);
  final ultima = entregas.last;
  return _Seleccion(
    procesoId: ultima.procesoId,
    maquinaId: ultima.maquinaId,
    materialId: ultima.materialEntregadoId != pedido.materialId ? ultima.materialEntregadoId : null,
  );
}

class RegistrarEntrega extends StatefulWidget {
  const RegistrarEntrega({super.key});

  @override
  State<RegistrarEntrega> createState() => _RegistrarEntregaState();
}

class _RegistrarEntregaState extends State<RegistrarEntrega> {
  final _numeroOt = TextEditingController();
  final _scroll = ScrollController();

  // Catálogos
  List<Proceso>? _procesos;
  List<MaterialMp>? _materiales;
  String? _errorCatalogos;
  final _cacheMaquinas = <int, Future<List<Maquina>>>{};

  // OT recientes con entregas pendientes (antes de buscar una)
  List<OrdenTrabajo>? _recientes;
  bool _cargandoRecientes = false;

  // OT buscada
  String? _otBuscada;
  bool _cargandoOt = false;
  String? _errorOt;
  OtEncabezado? _encabezado;
  List<Consumo> _pedidos = [];
  List<Pendiente> _pendientes = [];
  List<Entrega> _entregas = [];

  final _seleccion = <String, _Seleccion>{};
  String _fecha = hoyIso();
  String? _error;
  bool _guardando = false;
  List<Entrega> _confirmaciones = [];

  Api get _api => context.read<Sesion>().api;
  late final Repositorio _repo;
  StreamSubscription<String>? _suscripcionOt;

  @override
  void initState() {
    super.initState();
    _repo = context.read<Repositorio>();
    // Cuando la copia local se pone al día, la lista de OT recientes también.
    _repo.addListener(_alCambiarCopia);
    // Otro equipo cambió la OT que se está viendo: se actualiza sin tocar nada.
    _suscripcionOt = _repo.cambiosDeOt.listen((ot) {
      if (mounted && ot == _otBuscada && !_guardando) _cargarOt(usarCopia: true);
    });
    _cargarCatalogos();
    _cargarRecientes();
  }

  void _alCambiarCopia() {
    if (!mounted) return;
    if (_repo.tieneDatos && _otBuscada == null) _recientesDeLaCopia();
    if (_repo.tieneDatos && (_procesos == null || _materiales == null)) {
      setState(() {
        _procesos = _repo.procesos;
        _materiales = _repo.materiales;
      });
    }
  }

  @override
  void dispose() {
    _repo.removeListener(_alCambiarCopia);
    _suscripcionOt?.cancel();
    _numeroOt.dispose();
    _scroll.dispose();
    for (final s in _seleccion.values) {
      s.dispose();
    }
    super.dispose();
  }

  Future<List<Maquina>> _maquinasDe(int procesoId) {
    final copia = _repo.maquinasDe(procesoId);
    if (copia != null) return Future.value(copia);
    return _cacheMaquinas.putIfAbsent(
      procesoId,
      () => _api.listarMaquinas(procesoId).catchError((Object e) {
        _cacheMaquinas.remove(procesoId); // que se pueda reintentar
        throw e;
      }),
    );
  }

  Future<void> _cargarCatalogos() async {
    setState(() => _errorCatalogos = null);
    if (_repo.tieneDatos) {
      setState(() {
        _procesos = _repo.procesos;
        _materiales = _repo.materiales;
      });
      return;
    }
    try {
      final r = await Future.wait([_api.listarProcesos(), _api.listarMateriales()]);
      if (!mounted) return;
      setState(() {
        _procesos = r[0] as List<Proceso>;
        _materiales = r[1] as List<MaterialMp>;
      });
    } catch (e) {
      if (mounted) setState(() => _errorCatalogos = '$e');
    }
  }

  /// OT a las que les falta alguna entrega: algún pedido PENDIENTE/PARCIAL, o
  /// ningún pedido todavía (sus materiales siguen como pendientes del Excel).
  Future<void> _cargarRecientes() async {
    if (_repo.tieneDatos) {
      _recientesDeLaCopia();
      return;
    }
    setState(() => _cargandoRecientes = true);
    try {
      await _repo.sincronizar();
      if (mounted && _repo.tieneDatos) _recientesDeLaCopia();
    } finally {
      // Es solo una ayuda: si falla, se busca la OT a mano.
      if (mounted) setState(() => _cargandoRecientes = false);
    }
  }

  void _recientesDeLaCopia() {
    final conPedidos = <String>{};
    final conPendiente = <String>{};
    for (final p in _repo.consumo) {
      if (p.esTinta) continue;
      conPedidos.add(p.numeroOt);
      if (p.estadoEntrega == 'PENDIENTE' || p.estadoEntrega == 'PARCIAL') conPendiente.add(p.numeroOt);
    }
    setState(() {
      _recientes = _repo.ordenes
          .where((ot) => conPendiente.contains(ot.numeroOt) || !conPedidos.contains(ot.numeroOt))
          .take(15)
          .toList();
    });
  }

  void _limpiarSeleccion() {
    for (final s in _seleccion.values) {
      s.dispose();
    }
    _seleccion.clear();
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
      _pendientes = [];
      _entregas = [];
      _encabezado = null;
      _confirmaciones = [];
      _error = null;
      _limpiarSeleccion();
    });
    _cargarRecientes();
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
      final r = await Future.wait([_api.consultarConsumo(ot), _repo.pendientesDe(ot), _api.listarEntregas(ot)]);
      if (!mounted || _otBuscada != ot) return;
      setState(() {
        _pedidos = (r[0] as List<Consumo>).where((p) => !p.esTinta).toList();
        _pendientes = (r[1] as List<Pendiente>).where((p) => !p.esTinta).toList();
        _entregas = r[2] as List<Entrega>;
      });
    } catch (e) {
      if (mounted) setState(() => _errorOt = '$e');
    } finally {
      if (mounted) setState(() => _cargandoOt = false);
    }
    // Cliente y producto, solo para reconocer la OT; si falla no se muestra.
    try {
      final enc = await _repo.encabezadoDe(ot);
      if (mounted && _otBuscada == ot) setState(() => _encabezado = enc);
    } catch (_) {}
  }

  List<_Fuente> get _fuentes {
    final porPedido = <int, List<Entrega>>{};
    for (final e in _entregas) {
      porPedido.putIfAbsent(e.otMaterialId, () => []).add(e);
    }
    final lista = <_Fuente>[];
    for (final pedido in _pedidos) {
      final suyas = porPedido[pedido.otMaterialId] ?? const <Entrega>[];
      if (suyas.length >= 2) {
        for (final e in suyas) {
          lista.add(_Fuente('e${e.id}', pedido, [e]));
        }
      } else {
        lista.add(_Fuente('p${pedido.otMaterialId}', pedido, suyas));
      }
    }
    return lista;
  }

  Map<int, String> get _letras => letrasDeEntregas(_entregas.map(
      (e) => (id: e.id, numeroOt: e.numeroOt, codigo: e.codigoMpEntregado, fecha: e.fecha, hora: e.hora)));

  void _alternar(_Fuente f) {
    setState(() {
      _confirmaciones = [];
      final actual = _seleccion.remove(f.clave);
      if (actual != null) {
        actual.dispose();
      } else {
        _seleccion[f.clave] = _seleccionContinuando(f.pedido, f.entregas);
      }
    });
  }

  Future<void> _elegirFecha() async {
    final elegida = await elegirFecha(context, _fecha);
    if (elegida != null) setState(() => _fecha = elegida);
  }

  /// Lo registrado desde una tarjeta de pendiente o desde "material que la OT
  /// no tiene" va al mismo cartel verde que el resto.
  void _alRegistrarAparte(List<Entrega> entregas) {
    setState(() {
      _confirmaciones = entregas;
      _error = null;
    });
    _mostrarConfirmacion();
    _cargarOt();
  }

  /// El cartel verde queda arriba de todo: sin subir hasta él, guardar desde
  /// abajo no daba ninguna señal en pantalla (mismo problema que el escritorio).
  void _mostrarConfirmacion() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(0, duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _guardar() async {
    if (_guardando) return; // un segundo toque mientras guarda no registra otra vez
    if (_seleccion.isEmpty) {
      setState(() => _error = 'Selecciona al menos un material');
      return;
    }
    for (final s in _seleccion.values) {
      final p = s.problema();
      if (p != null) {
        setState(() => _error = p);
        return;
      }
    }
    final fuentes = {for (final f in _fuentes) f.clave: f};
    setState(() {
      _guardando = true;
      _error = null;
    });

    final exitos = <Entrega>[];
    final fallos = <String>[];
    for (final entry in _seleccion.entries.toList()) {
      final fuente = fuentes[entry.key];
      if (fuente == null) continue;
      final s = entry.value;
      try {
        final e = await _api.registrarEntrega(
          otMaterialId: fuente.pedido.otMaterialId,
          fecha: _fecha,
          bobinas: s.bobinas.pesos,
          materialId: s.materialId,
          procesoId: s.procesoId,
          maquinaId: s.maquinaId,
          observacion: s.nota.text.trim(),
        );
        exitos.add(e);
        _seleccion.remove(entry.key)?.dispose(); // lo que entró se limpia: no se registra dos veces
      } catch (e) {
        final codigo = _materiales?.where((m) => m.id == s.materialId).firstOrNull?.codigoMp ?? fuente.pedido.codigoMp;
        fallos.add('$codigo (${e is ApiError ? e.mensaje : 'error de conexión'})');
      }
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
    // La tablet de la planta (1280×800 a 215 dpi) deja ~710 dp al lado del
    // menú: no alcanza para dos columnas, va todo en una, en el orden de uso.
    return LayoutBuilder(builder: (context, c) {
      final titulo = [
        const Text('Registrar Entrega', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w600)),
        const SizedBox(height: 16),
      ];
      if (c.maxWidth < 1000) {
        return ListView(
          controller: _scroll,
          padding: const EdgeInsets.all(20),
          children: [
            ...titulo,
            ..._confirmacion(),
            ..._buscarOt(),
            ..._cantidades(),
            ..._pendientesExcel(),
          ],
        );
      }
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 5,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 20, 10, 20),
              children: [...titulo, ..._buscarOt(), ..._pendientesExcel()],
            ),
          ),
          Expanded(
            flex: 6,
            child: ListView(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(10, 20, 20, 20),
              children: [..._confirmacion(), ..._cantidades()],
            ),
          ),
        ],
      );
    });
  }

  List<Widget> _confirmacion() => _confirmaciones.isEmpty
      ? const []
      : [_Confirmaciones(entregas: _confirmaciones, letras: _letras), const SizedBox(height: 16)];

  List<Widget> _buscarOt() {
    final letras = _letras;
    final procesos = _procesos ?? const <Proceso>[];
    final materiales = _materiales ?? const <MaterialMp>[];

    return [
      if (_errorCatalogos != null) ...[
        Aviso(
          color: Colores.peligro,
          texto: 'No se pudieron cargar los procesos y materiales: $_errorCatalogos',
          accion: TextButton(onPressed: _cargarCatalogos, child: const Text('Reintentar')),
        ),
        const SizedBox(height: 12),
      ],
      Tarjeta(
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
          if (_otBuscada != null && _procesos != null && _materiales != null) ...[
            const SizedBox(height: 12),
            _EntregaLibre(
              key: ValueKey('libre-$_otBuscada'),
              numeroOt: _otBuscada!,
              fecha: _fecha,
              procesos: procesos,
              materiales: materiales,
              maquinasDe: _maquinasDe,
              alRegistrar: _alRegistrarAparte,
            ),
          ],
          if (_cargandoOt) ...[
            const SizedBox(height: 16),
            const Center(child: CircularProgressIndicator()),
          ],
          if (_errorOt != null) ...[
            const SizedBox(height: 12),
            Aviso(
              color: Colores.peligro,
              texto: _errorOt!,
              accion: TextButton(onPressed: _cargarOt, child: const Text('Reintentar')),
            ),
          ],
          if (_otBuscada != null && !_cargandoOt && _errorOt == null && _pedidos.isEmpty && _pendientes.isEmpty) ...[
            const SizedBox(height: 12),
            const Aviso(
              color: Colores.aviso,
              texto: 'Esta OT no tiene materiales pedidos todavía. Hay que cargarla en Crear OT (en la PC).',
            ),
          ],
          if (_pedidos.isNotEmpty) ...[
            const SizedBox(height: 16),
            const Text('Materiales pedidos en esta OT — toca todos a los que corresponda la entrega:',
                style: TextStyle(fontSize: 13, color: Colores.textoApagado)),
            const SizedBox(height: 8),
            for (final f in _fuentes)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _OpcionPedido(
                  fuente: f,
                  letras: letras,
                  seleccionada: _seleccion.containsKey(f.clave),
                  alTocar: () => _alternar(f),
                ),
              ),
          ],
        ],
      ),
      if (_otBuscada == null) ...[
        const SizedBox(height: 16),
        Tarjeta(
          titulo: 'OT recientes con entregas pendientes',
          accion: IconButton(
            tooltip: 'Actualizar',
            onPressed: _cargandoRecientes ? null : _cargarRecientes,
            icon: const Icon(Icons.refresh),
          ),
          children: [
            if (_cargandoRecientes && _recientes == null) const Center(child: CircularProgressIndicator()),
            if (_recientes != null && _recientes!.isEmpty)
              const Text('No hay OT recientes con entregas pendientes.', style: TextStyle(color: Colores.textoApagado)),
            for (final ot in _recientes ?? const <OrdenTrabajo>[])
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: BotonLista(
                  alTocar: () => _buscar(ot.numeroOt),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('OT ${ot.numeroOt}', style: const TextStyle(fontWeight: FontWeight.w600)),
                            Text(
                              '${ot.cliente ?? 'Sin cliente'}${ot.diseno != null ? ' · ${ot.diseno}' : ''}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: Colores.textoApagado),
                            ),
                          ],
                        ),
                      ),
                      Text(formatearFechaHoraCompleta(ot.fechaCreacion),
                          style: const TextStyle(fontSize: 12, color: Colores.textoApagado)),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ],
    ];
  }

  List<Widget> _pendientesExcel() {
    final procesos = _procesos ?? const <Proceso>[];
    final materiales = _materiales ?? const <MaterialMp>[];
    final pendientesParaAsignar = _pendientes.where((p) => !p.origenLibre).toList();
    return [
      if (pendientesParaAsignar.isNotEmpty && _procesos != null && _materiales != null) ...[
        const SizedBox(height: 16),
        Tarjeta(
          titulo: 'Materiales pendientes de asignar (vienen del Excel)',
          children: [
            const Text(
              'Vinieron de la hoja Excel sin proceso ni máquina. Asígnalos y registra la entrega en un solo paso '
              '(con la fecha de "Cantidades entregadas").',
              style: TextStyle(fontSize: 13, color: Colores.textoApagado),
            ),
            const SizedBox(height: 12),
            for (final p in pendientesParaAsignar)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _TarjetaPendiente(
                  key: ValueKey('pendiente-${p.id}'),
                  pendiente: p,
                  fecha: _fecha,
                  procesos: procesos,
                  materiales: materiales,
                  maquinasDe: _maquinasDe,
                  alRegistrar: _alRegistrarAparte,
                ),
              ),
          ],
        ),
      ],
    ];
  }

  List<Widget> _cantidades() {
    final fuentes = _fuentes.where((f) => _seleccion.containsKey(f.clave)).toList();
    final cantidad = _seleccion.length;
    return [
      const SizedBox(height: 16),
      Tarjeta(
        titulo: 'Cantidades entregadas',
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
          if (fuentes.isEmpty)
            const Text(
              'Busca una OT y toca los materiales que se están entregando.',
              style: TextStyle(color: Colores.textoApagado),
            ),
          for (final f in fuentes)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _TarjetaSeleccion(
                key: ValueKey('sel-${f.clave}'),
                fuente: f,
                seleccion: _seleccion[f.clave]!,
                procesos: _procesos ?? const [],
                materiales: _materiales ?? const [],
                maquinasDe: _maquinasDe,
                alCambiar: () => setState(() {}),
                alQuitar: () => _alternar(f),
              ),
            ),
          if (_error != null) ...[
            Text(_error!, style: const TextStyle(color: Colores.peligro)),
            const SizedBox(height: 12),
          ],
          if (fuentes.isNotEmpty)
            FilledButton(
              onPressed: _guardando ? null : _guardar,
              child: Text(_guardando ? 'Guardando...' : (cantidad > 1 ? 'Guardar $cantidad entregas' : 'Guardar entrega')),
            ),
        ],
      ),
    ];
  }
}

// ---------------------------------------------------------------------------

class _OpcionPedido extends StatelessWidget {
  const _OpcionPedido({required this.fuente, required this.letras, required this.seleccionada, required this.alTocar});

  final _Fuente fuente;
  final Map<int, String> letras;
  final bool seleccionada;
  final VoidCallback alTocar;

  @override
  Widget build(BuildContext context) {
    final pedido = fuente.pedido;
    final entregas = fuente.entregas;
    final sustituidos = {for (final e in entregas) e.codigoMpEntregado}..remove(pedido.codigoMp);
    // El título es lo que REALMENTE se entregó; el código del pedido va en "pedido: X".
    final entregados = <String, String?>{};
    for (final e in entregas) {
      entregados.putIfAbsent('${e.codigoMpEntregado}|${letras[e.id] ?? ''}', () => letras[e.id]);
    }
    final ultima = entregas.isEmpty ? null : entregas.last;
    final estiloTitulo = TextStyle(
      fontWeight: FontWeight.w600,
      color: sustituidos.isNotEmpty ? Colores.aviso : Colores.texto,
    );
    final titulo = entregados.isEmpty
        ? TextSpan(text: pedido.codigoMp, style: estiloTitulo)
        : TextSpan(children: [
            for (final (i, k) in entregados.keys.indexed) ...[
              if (i > 0) const TextSpan(text: ' / '),
              codigoConLetra(k.split('|').first, entregados[k], estilo: estiloTitulo),
            ],
          ]);

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
                  text: '${ultima?.proceso ?? pedido.proceso} — ${ultima?.maquina ?? pedido.maquina} — ',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                titulo,
              ])),
              if (pedido.tieneMateriaPrima)
                const Etiqueta('se fabrica en esta OT', color: Colores.primario, icono: Icons.science_outlined),
              if (pedido.esMateriaPrima)
                Etiqueta('materia prima de ${pedido.insumoDeCodigoMp}', color: Colores.textoApagado),
              if (sustituidos.isNotEmpty)
                Etiqueta('pedido: ${pedido.codigoMp}', color: Colores.aviso, icono: Icons.swap_horiz),
            ],
          ),
          for (final e in entregas)
            Text.rich(
              TextSpan(children: [
                TextSpan(
                    text: '${formatearFecha(e.fecha)} ${horaCorta(e.hora)}',
                    style: const TextStyle(fontWeight: FontWeight.w500)),
                TextSpan(
                  text: ' — ${numero(e.totalEntregado)} ${pedido.unidad}'
                      '${e.codigoMpEntregado != pedido.codigoMp ? ' (${e.codigoMpEntregado})' : ''}',
                  style: const TextStyle(color: Colores.textoApagado),
                ),
              ]),
              style: const TextStyle(fontSize: 13),
            ),
          Text(
            '${pedido.diseno != null ? 'Descripción: ${pedido.diseno} · ' : ''}'
            'Acumulado del pedido: ${numero(pedido.totalEntregado)} ${pedido.unidad}'
            '${pedido.cantidadRequerida != null ? ' de ${numero(pedido.cantidadRequerida!)} requeridos' : ''}'
            '${pedido.totalIngresado > 0 ? ' · Fabricado en almacén: ${numero(pedido.totalIngresado)}' : ''}'
            ' · ${pedido.estadoEntrega}',
            style: const TextStyle(fontSize: 12, color: Colores.textoApagado),
          ),
        ],
      ),
    );
  }
}

/// Material (si se cambia), Proceso/Máquina, cantidad y nota de UNA entrega.
/// Compartido por la tarjeta de un pedido y la de un pendiente.
class _FormEntrega extends StatelessWidget {
  const _FormEntrega({
    required this.seleccion,
    required this.materiales,
    required this.unidadPedido,
    required this.usaBobinasPedido,
    required this.maquinasDe,
    required this.alCambiar,
    this.procesos,
    this.permitirMaterialDistinto = true,
  });

  final _Seleccion seleccion;
  final List<MaterialMp> materiales;
  final String unidadPedido;
  final bool usaBobinasPedido;
  final Future<List<Maquina>> Function(int) maquinasDe;
  final VoidCallback alCambiar;
  // Sin procesos (tarjeta de pendiente) no se muestran: ahí se eligen arriba.
  final List<Proceso>? procesos;
  // Solo en la primera entrega del pedido.
  final bool permitirMaterialDistinto;

  @override
  Widget build(BuildContext context) {
    final s = seleccion;
    final material = materiales.where((m) => m.id == s.materialId).firstOrNull;
    final unidad = material?.unidad ?? unidadPedido;
    final usaBobinas = material?.usaBobinas ?? usaBobinasPedido;
    final cambiando = s.cambiarMaterial || s.materialId != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (procesos != null) ...[
          SelectorProcesoMaquina(
            procesos: procesos!,
            maquinasDe: maquinasDe,
            procesoId: s.procesoId,
            maquinaId: s.maquinaId,
            alCambiar: (p, m) {
              s.procesoId = p;
              s.maquinaId = m;
              alCambiar();
            },
          ),
          const SizedBox(height: 12),
        ],
        if (cambiando) ...[
          Row(
            children: [
              Expanded(
                child: SelectorMaterial(
                  etiqueta: 'Material realmente entregado',
                  materiales: materiales,
                  valor: s.materialId,
                  alCambiar: (id) {
                    s.materialId = id;
                    alCambiar();
                  },
                ),
              ),
              const SizedBox(width: 8),
              IconButton.outlined(
                tooltip: 'Cancelar — entregar el material del pedido',
                style: IconButton.styleFrom(side: BorderSide(color: Colores.peligro.withValues(alpha: 0.4))),
                onPressed: () {
                  s.cambiarMaterial = false;
                  s.materialId = null;
                  alCambiar();
                },
                icon: const Icon(Icons.close, color: Colores.peligro),
              ),
            ],
          ),
          const SizedBox(height: 12),
        ],
        CampoCantidad(bobinas: s.bobinas, unidad: unidad, usaBobinas: usaBobinas, requerido: true),
        const SizedBox(height: 12),
        TextField(
          controller: s.nota,
          decoration: InputDecoration(
            hintText: cambiando ? 'Nota (opcional) — ej. sin stock del pedido' : 'Nota (opcional)',
          ),
        ),
        if (permitirMaterialDistinto && !cambiando) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton(
              onPressed: () {
                s.cambiarMaterial = true;
                alCambiar();
              },
              child: const Text('¿Se entregó un material distinto? (alternativa o cambio de estructura)'),
            ),
          ),
        ],
      ],
    );
  }
}

class _TarjetaSeleccion extends StatelessWidget {
  const _TarjetaSeleccion({
    super.key,
    required this.fuente,
    required this.seleccion,
    required this.procesos,
    required this.materiales,
    required this.maquinasDe,
    required this.alCambiar,
    required this.alQuitar,
  });

  final _Fuente fuente;
  final _Seleccion seleccion;
  final List<Proceso> procesos;
  final List<MaterialMp> materiales;
  final Future<List<Maquina>> Function(int) maquinasDe;
  final VoidCallback alCambiar;
  final VoidCallback alQuitar;

  @override
  Widget build(BuildContext context) {
    final pedido = fuente.pedido;
    final ultima = fuente.entregas.isEmpty ? null : fuente.entregas.last;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(border: Border.all(color: Colores.borde), borderRadius: BorderRadius.circular(8)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text.rich(TextSpan(children: [
                  TextSpan(text: pedido.codigoMp, style: const TextStyle(fontWeight: FontWeight.w600)),
                  TextSpan(
                    text: '   ${ultima?.proceso ?? pedido.proceso} · ${ultima?.maquina ?? pedido.maquina}',
                    style: const TextStyle(color: Colores.textoApagado),
                  ),
                ])),
              ),
              IconButton(tooltip: 'Quitar', onPressed: alQuitar, icon: const Icon(Icons.close)),
            ],
          ),
          if (pedido.tieneMateriaPrima && pedido.totalIngresado == 0) ...[
            Text(
              'A este pedido se le agregó materia prima. Cuando el ${pedido.codigoMp} esté fabricado, registra su '
              'ingreso a almacén desde Registrar Devolución y después entrégalo acá.',
              style: const TextStyle(fontSize: 12, color: Colores.textoApagado),
            ),
            const SizedBox(height: 8),
          ],
          _FormEntrega(
            seleccion: seleccion,
            materiales: materiales,
            unidadPedido: pedido.unidad,
            usaBobinasPedido: pedido.usaBobinas,
            maquinasDe: maquinasDe,
            alCambiar: alCambiar,
            procesos: procesos,
            permitirMaterialDistinto: pedido.totalEntregado <= 0,
          ),
        ],
      ),
    );
  }
}

/// Un pendiente del Excel: se le elige proceso y máquina (y el material del
/// catálogo si el código no coincidió) y se entrega en el mismo paso.
class _TarjetaPendiente extends StatefulWidget {
  const _TarjetaPendiente({
    super.key,
    required this.pendiente,
    required this.fecha,
    required this.procesos,
    required this.materiales,
    required this.maquinasDe,
    required this.alRegistrar,
  });

  final Pendiente pendiente;
  final String fecha;
  final List<Proceso> procesos;
  final List<MaterialMp> materiales;
  final Future<List<Maquina>> Function(int) maquinasDe;
  final void Function(List<Entrega>) alRegistrar;

  @override
  State<_TarjetaPendiente> createState() => _TarjetaPendienteState();
}

class _TarjetaPendienteState extends State<_TarjetaPendiente> {
  int? _materialId;
  int? _procesoId;
  int? _maquinaId;
  final _sel = _Seleccion();
  String? _error;
  bool _guardando = false;

  @override
  void initState() {
    super.initState();
    _materialId = widget.pendiente.materialId;
  }

  @override
  void dispose() {
    _sel.dispose();
    super.dispose();
  }

  Future<void> _guardar() async {
    if (_guardando) return;
    final p = widget.pendiente;
    String? problema;
    if (_materialId == null) {
      problema = 'Indica a qué material del catálogo corresponde';
    } else if (_procesoId == null || _maquinaId == null) {
      problema = 'Para entregar ${p.codigoMp} elige su proceso y su máquina';
    } else {
      problema = _sel.problema();
    }
    if (problema != null) {
      setState(() => _error = problema);
      return;
    }
    setState(() {
      _guardando = true;
      _error = null;
    });
    final api = context.read<Sesion>().api;
    try {
      final otMaterialId = await api.promoverPendiente(p.id,
          procesoId: _procesoId!, maquinaId: _maquinaId!, materialId: _materialId);
      final entrega = await api.registrarEntrega(
        otMaterialId: otMaterialId,
        fecha: widget.fecha,
        bobinas: _sel.bobinas.pesos,
        materialId: _sel.materialId,
        observacion: _sel.nota.text.trim(),
      );
      widget.alRegistrar([entrega]);
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiError ? e.mensaje : 'No se pudo registrar');
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.pendiente;
    final material = widget.materiales.where((m) => m.id == _materialId).firstOrNull;
    // Ya resuelto a un material del catálogo: ese código es el principal y el
    // del Excel queda al lado para rastrearlo.
    final resuelto = p.materialId != null ? material : null;
    final codigoDistinto = resuelto != null && resuelto.codigoMp != p.codigoMp;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colores.aviso.withValues(alpha: 0.05),
        border: Border.all(color: Colores.aviso.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(resuelto?.codigoMp ?? p.codigoMp, style: const TextStyle(fontWeight: FontWeight.w600)),
              if (codigoDistinto) CodigoExcel(p.codigoMp),
              if (p.cantidadRequerida != null)
                Text('— ${numero(p.cantidadRequerida!)}${material != null ? ' ${material.unidad}' : ''} (del Excel)'),
            ],
          ),
          if (p.materiasPrimas.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text('Materia prima ya entregada: ${p.materiasPrimas.join(', ')}.',
                style: const TextStyle(fontSize: 12, color: Colores.textoApagado)),
          ],
          const SizedBox(height: 12),
          if (p.materialId == null) ...[
            SelectorMaterial(
              etiqueta: '¿A qué material del catálogo corresponde?',
              materiales: widget.materiales,
              valor: _materialId,
              alCambiar: (id) => setState(() => _materialId = id),
            ),
            const SizedBox(height: 12),
          ],
          SelectorProcesoMaquina(
            procesos: widget.procesos,
            maquinasDe: widget.maquinasDe,
            procesoId: _procesoId,
            maquinaId: _maquinaId,
            obligatorio: true,
            alCambiar: (pr, m) => setState(() {
              _procesoId = pr;
              _maquinaId = m;
            }),
          ),
          const SizedBox(height: 12),
          _FormEntrega(
            seleccion: _sel,
            materiales: widget.materiales,
            unidadPedido: material?.unidad ?? '',
            usaBobinasPedido: material?.usaBobinas ?? true,
            maquinasDe: widget.maquinasDe,
            alCambiar: () => setState(() {}),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colores.peligro)),
          ],
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _guardando ? null : _guardar,
            child: Text(_guardando ? 'Guardando...' : 'Asignar y registrar entrega'),
          ),
        ],
      ),
    );
  }
}

/// "Entregar un material que la OT no tiene": crea un pedido suelto con el
/// material, proceso y máquina (obligatorios) y entrega contra él.
class _EntregaLibre extends StatefulWidget {
  const _EntregaLibre({
    super.key,
    required this.numeroOt,
    required this.fecha,
    required this.procesos,
    required this.materiales,
    required this.maquinasDe,
    required this.alRegistrar,
  });

  final String numeroOt;
  final String fecha;
  final List<Proceso> procesos;
  final List<MaterialMp> materiales;
  final Future<List<Maquina>> Function(int) maquinasDe;
  final void Function(List<Entrega>) alRegistrar;

  @override
  State<_EntregaLibre> createState() => _EntregaLibreState();
}

class _EntregaLibreState extends State<_EntregaLibre> {
  bool _abierto = false;
  int? _materialId;
  int? _procesoId;
  int? _maquinaId;
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
        _procesoId = null;
        _maquinaId = null;
        _bobinas.limpiar();
        _error = null;
      });

  Future<void> _guardar() async {
    if (_guardando) return;
    String? problema;
    if (_materialId == null) {
      problema = 'Elige qué material se está entregando';
    } else if (_procesoId == null || _maquinaId == null) {
      problema = 'Elige el proceso y la máquina donde se consume';
    } else if (_bobinas.pesos.isEmpty || _bobinas.hayInvalido) {
      problema = 'Carga una cantidad válida mayor a 0';
    }
    if (problema != null) {
      setState(() => _error = problema);
      return;
    }
    setState(() {
      _guardando = true;
      _error = null;
    });
    try {
      final entrega = await context.read<Sesion>().api.registrarEntrega(
            numeroOt: widget.numeroOt,
            fecha: widget.fecha,
            bobinas: _bobinas.pesos,
            materialId: _materialId,
            procesoId: _procesoId,
            maquinaId: _maquinaId,
          );
      _cerrar();
      widget.alRegistrar([entrega]);
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
          label: const Text('Entregar un material que la OT no tiene'),
        ),
      );
    }
    final material = widget.materiales.where((m) => m.id == _materialId).firstOrNull;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colores.apagado,
        border: Border.all(color: Colores.borde),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Para un material que todavía no está cargado en esta OT — se crea un pedido nuevo, sin esperar a que '
            'se actualice la OT.',
            style: TextStyle(fontSize: 12, color: Colores.textoApagado),
          ),
          const SizedBox(height: 12),
          SelectorMaterial(
            materiales: widget.materiales,
            valor: _materialId,
            alCambiar: (id) => setState(() => _materialId = id),
          ),
          const SizedBox(height: 12),
          SelectorProcesoMaquina(
            procesos: widget.procesos,
            maquinasDe: widget.maquinasDe,
            procesoId: _procesoId,
            maquinaId: _maquinaId,
            obligatorio: true,
            alCambiar: (p, m) => setState(() {
              _procesoId = p;
              _maquinaId = m;
            }),
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

/// El cartel verde de arriba: una línea por entrega guardada, con su hora.
class _Confirmaciones extends StatelessWidget {
  const _Confirmaciones({required this.entregas, required this.letras});

  final List<Entrega> entregas;
  final Map<int, String> letras;

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
          for (final e in entregas)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.check_circle, color: Colores.exito),
                  const SizedBox(width: 10),
                  Expanded(child: _lineas(e)),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _lineas(Entrega e) {
    final sustituido = e.codigoMpEntregado != e.codigoMp;
    final letra = letras[e.id];
    final requerido = e.cantidadRequerida;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(TextSpan(children: [
          TextSpan(text: 'Entrega de las ${horaCorta(e.hora)}: ', style: const TextStyle(fontWeight: FontWeight.w600)),
          TextSpan(
            text: '${e.usaBobinas ? '${e.bobinas.length} ${e.bobinas.length == 1 ? 'bobina' : 'bobinas'} · ' : ''}'
                '${numero(e.totalEntregado)} ${e.unidad} de ',
          ),
          if (sustituido) ...[
            TextSpan(text: e.codigoMp),
            const TextSpan(text: ' — se entregó como '),
            codigoConLetra(e.codigoMpEntregado, letra),
          ] else
            codigoConLetra(e.codigoMp, letra),
          TextSpan(text: ' (${e.proceso} · ${e.maquina}).'),
        ])),
        if (e.pedidoCreado)
          Text('Se creó el pedido de ${e.codigoMp} en ${e.proceso} — ${e.maquina}.',
              style: const TextStyle(color: Colores.textoApagado)),
        if (e.observacion != null && e.observacion!.isNotEmpty)
          Text('Nota: ${e.observacion}', style: const TextStyle(color: Colores.textoApagado)),
        Text(
          requerido != null && requerido > 0
              ? 'Acumulado del pedido (todas las entregas): ${numero(e.totalEntregadoPedido)} de ${numero(requerido)} '
                  '${e.unidad} requeridos${e.totalEntregadoPedido >= requerido ? ' — pedido completo.' : ' — faltan ${(requerido - e.totalEntregadoPedido).toStringAsFixed(2)} ${e.unidad}.'}'
              : 'Acumulado del pedido (todas las entregas): ${numero(e.totalEntregadoPedido)} ${e.unidad}',
          style: const TextStyle(fontSize: 12, color: Colores.textoApagado),
        ),
      ],
    );
  }
}
