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

// Versión tablet de Historial.tsx (submódulo de Registrar Entrega): el registro
// completo de entregas, devoluciones e ingresos de cada OT, y el lugar donde
// se CORRIGE o ELIMINA un movimiento ya guardado. Mismas reglas que la PC:
//  - el filtro Día/Mes/Año/Todos va por la fecha de cada MOVIMIENTO, no la de
//    creación de la OT; con algo escrito en el buscador se busca en todas las
//    fechas; los totales del pedido siempre son los reales;
//  - un movimiento con el SID ya registrado no se puede corregir ni borrar;
//  - quién corrigió y cuándo se muestra en la propia ficha ("Editado por…");
//  - un sobrante puede cambiar (o quitar) de cuál entrega es;
//  - los ingresos de material fabricado sin pedido van en su propia tarjeta.

enum _ModoFecha { dia, mes, anio, todos }

const _meses = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

String _iso(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class Historial extends StatefulWidget {
  const Historial({super.key});

  @override
  State<Historial> createState() => _HistorialState();
}

class _HistorialState extends State<Historial> {
  final _q = TextEditingController();
  String _busqueda = '';
  _ModoFecha _modo = _ModoFecha.mes;
  // Día de referencia del período (para Mes/Año se usa su mes/año).
  DateTime _ref = DateTime.now();

  bool _cargando = false;
  String? _error;
  List<OrdenTrabajo> _ordenes = [];
  List<Consumo> _consumo = [];
  List<Entrega> _entregas = [];
  List<Devolucion> _devoluciones = [];
  List<MaterialMp> _materiales = [];
  List<Proceso> _procesos = [];
  final _cacheMaquinas = <int, Future<List<Maquina>>>{};

  Api get _api => context.read<Sesion>().api;
  late final Repositorio _repo;

  @override
  void initState() {
    super.initState();
    _repo = context.read<Repositorio>();
    _repo.addListener(_tomarDeLaCopia);
    _cargar();
  }

  @override
  void dispose() {
    _repo.removeListener(_tomarDeLaCopia);
    _q.dispose();
    super.dispose();
  }

  Future<List<Maquina>> _maquinasDe(int procesoId) {
    final copia = _repo.maquinasDe(procesoId);
    if (copia != null) return Future.value(copia);
    return _cacheMaquinas.putIfAbsent(
      procesoId,
      () => _api.listarMaquinas(procesoId).catchError((Object e) {
        _cacheMaquinas.remove(procesoId);
        throw e;
      }),
    );
  }

  /// Lo que se ve sale de la copia local (ver Repositorio): abrir la pantalla o
  /// buscar no espera al servidor, que se vuelve a leer en segundo plano.
  void _tomarDeLaCopia() {
    if (!mounted) return;
    setState(() {
      _ordenes = _repo.buscarOrdenes(_busqueda);
      _consumo = _repo.consumo;
      _entregas = _repo.entregas;
      _devoluciones = _repo.devoluciones;
      _materiales = _repo.materiales;
      _procesos = _repo.procesos;
    });
  }

  /// La copia local trae las últimas 2000 OT (el tope del servidor). Si lo buscado
  /// no está ahí, puede ser una OT más antigua: se le pregunta al servidor.
  Future<void> _completarBusquedaEnServidor() async {
    final q = _busqueda;
    if (q.isEmpty || _ordenes.isNotEmpty) return;
    try {
      final r = await _api.listarOrdenes(q: q);
      if (mounted && _busqueda == q && r.isNotEmpty) setState(() => _ordenes = r);
    } catch (_) {
      // Sin conexión: queda lo que diga la copia.
    }
  }

  Future<void> _cargar() async {
    final habiaCopia = _repo.tieneDatos;
    if (habiaCopia) _tomarDeLaCopia();
    setState(() {
      _cargando = !habiaCopia;
      _error = null;
    });
    await _repo.sincronizar();
    if (!mounted) return;
    if (_repo.tieneDatos) {
      _tomarDeLaCopia();
    } else {
      _error = _repo.errorSincronizacion ?? 'No se pudo cargar';
    }
    setState(() => _cargando = false);
  }

  /// Corregir o borrar un movimiento cambia totales y estados: se vuelve a leer todo.
  Future<void> _refrescar() => _cargar();

  void _buscar() {
    FocusScope.of(context).unfocus();
    _busqueda = _q.text.trim();
    _tomarDeLaCopia();
    _completarBusquedaEnServidor();
  }

  bool get _buscando => _busqueda.isNotEmpty;
  bool get _filtrando => _modo != _ModoFecha.todos && !_buscando;

  (String, String) get _rango => switch (_modo) {
        _ModoFecha.dia => (_iso(_ref), _iso(_ref)),
        _ModoFecha.mes => (
            _iso(DateTime(_ref.year, _ref.month, 1)),
            _iso(DateTime(_ref.year, _ref.month + 1, 0)),
          ),
        _ => ('${_ref.year}-01-01', '${_ref.year}-12-31'),
      };

  bool _enRango(String fecha) {
    if (!_filtrando) return true;
    final (desde, hasta) = _rango;
    return fecha.compareTo(desde) >= 0 && fecha.compareTo(hasta) <= 0;
  }

  String get _textoPeriodo => switch (_modo) {
        _ModoFecha.dia => formatearFecha(_iso(_ref)),
        _ModoFecha.mes => '${_meses[_ref.month - 1]} ${_ref.year}',
        _ModoFecha.anio => '${_ref.year}',
        _ModoFecha.todos => '',
      };

  void _moverPeriodo(int paso) => setState(() {
        _ref = switch (_modo) {
          _ModoFecha.dia => _ref.add(Duration(days: paso)),
          _ModoFecha.mes => DateTime(_ref.year, _ref.month + paso, 1),
          _ => DateTime(_ref.year + paso, 1, 1),
        };
      });

  Future<void> _elegirDia() async {
    final elegida = await elegirFecha(context, _iso(_ref));
    if (elegida != null) setState(() => _ref = DateTime.parse(elegida));
  }

  @override
  Widget build(BuildContext context) {
    final usuario = context.watch<Sesion>().usuario!;
    final puedeEntregas = usuario.tieneAcceso(Modulo.registrarEntrega);
    final puedeDevoluciones = usuario.tieneAcceso(Modulo.registrarDevolucion);

    final letras = letrasDeEntregas(_entregas.map(
        (e) => (id: e.id, numeroOt: e.numeroOt, codigo: e.codigoMpEntregado, fecha: e.fecha, hora: e.hora)));
    final consumoPorOt = <String, List<Consumo>>{};
    for (final p in _consumo) {
      consumoPorOt.putIfAbsent(p.numeroOt, () => []).add(p);
    }
    final entregasPorPedido = <int, List<Entrega>>{};
    for (final e in _entregas) {
      if (_enRango(e.fecha)) entregasPorPedido.putIfAbsent(e.otMaterialId, () => []).add(e);
    }
    final devolucionesPorPedido = <int, List<Devolucion>>{};
    final sueltosPorOt = <String, List<Devolucion>>{};
    for (final d in _devoluciones) {
      if (!_enRango(d.fecha)) continue;
      if (d.otMaterialId != null) {
        devolucionesPorPedido.putIfAbsent(d.otMaterialId!, () => []).add(d);
      } else if (d.esIngresoProduccion) {
        sueltosPorOt.putIfAbsent(d.numeroOt, () => []).add(d);
      }
    }
    List<Consumo> pedidosVisibles(String ot) {
      final todos = consumoPorOt[ot] ?? const <Consumo>[];
      if (!_filtrando) return todos;
      return todos
          .where((p) => entregasPorPedido.containsKey(p.otMaterialId) || devolucionesPorPedido.containsKey(p.otMaterialId))
          .toList();
    }

    final ordenes = _ordenes
        .where((ot) => !_filtrando || pedidosVisibles(ot.numeroOt).isNotEmpty || sueltosPorOt.containsKey(ot.numeroOt))
        .toList();

    final cabecera = <Widget>[
          const Text('Historial de OT', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w600)),
          const SizedBox(height: 16),
          Tarjeta(
            titulo: 'Buscar',
            children: [
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _q,
                      decoration: const InputDecoration(hintText: 'Buscar OT, cliente, diseño...'),
                      textInputAction: TextInputAction.search,
                      onSubmitted: (_) => _buscar(),
                    ),
                  ),
                  const SizedBox(width: 10),
                  FilledButton.icon(onPressed: _buscar, icon: const Icon(Icons.search), label: const Text('Buscar')),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  SegmentedButton<_ModoFecha>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(value: _ModoFecha.dia, label: Text('Día')),
                      ButtonSegment(value: _ModoFecha.mes, label: Text('Mes')),
                      ButtonSegment(value: _ModoFecha.anio, label: Text('Año')),
                      ButtonSegment(value: _ModoFecha.todos, label: Text('Todos')),
                    ],
                    selected: {_modo},
                    onSelectionChanged: (s) => setState(() {
                      _modo = s.first;
                      _ref = DateTime.now();
                    }),
                  ),
                  if (_modo != _ModoFecha.todos)
                    Opacity(
                      opacity: _buscando ? 0.5 : 1,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(onPressed: () => _moverPeriodo(-1), icon: const Icon(Icons.chevron_left)),
                          _modo == _ModoFecha.dia
                              ? OutlinedButton.icon(
                                  onPressed: _elegirDia,
                                  icon: const Icon(Icons.calendar_today, size: 18),
                                  label: Text(_textoPeriodo),
                                )
                              : SizedBox(
                                  width: 150,
                                  child: Text(_textoPeriodo,
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(fontWeight: FontWeight.w600)),
                                ),
                          IconButton(onPressed: () => _moverPeriodo(1), icon: const Icon(Icons.chevron_right)),
                        ],
                      ),
                    ),
                  if (_buscando)
                    const Text('Buscando en todas las fechas',
                        style: TextStyle(fontSize: 12, color: Colores.textoApagado)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          // Al recargar tras una corrección la lista se queda donde estaba (si se
          // vaciara, la pantalla saltaría al principio); solo una barra arriba.
          if (_cargando && _ordenes.isEmpty)
            const Center(child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator())),
          if (_cargando && _ordenes.isNotEmpty)
            const Padding(padding: EdgeInsets.only(bottom: 8), child: LinearProgressIndicator()),
          if (_error != null)
            Aviso(
              color: Colores.peligro,
              texto: 'No se pudo cargar: $_error',
              accion: TextButton(onPressed: _cargar, child: const Text('Reintentar')),
            ),
          if (!_cargando && _error == null && _ordenes.isEmpty)
            const Text('Sin órdenes de trabajo.', style: TextStyle(color: Colores.textoApagado)),
          if (!_cargando && _error == null && _ordenes.isNotEmpty && ordenes.isEmpty)
            const Text(
              'No hay entregas ni devoluciones en este período. Prueba con otro día, mes o año, o elige Todos.',
              style: TextStyle(color: Colores.textoApagado),
            ),
    ];

    // Cada OT se reparte en filas chicas (cabecera, ingresos sueltos, un pedido
    // por fila) que ListView.builder arma solo al acercarse a la pantalla. Un
    // bloque por OT hacía que cada OT nueva que entraba a la vista costara
    // varias decenas de milisegundos de golpe y el desplazamiento se trababa.
    final filas = <Widget Function()>[];
    if (_error == null) {
      for (final ot in ordenes) {
        filas.addAll(_filasDeOt(
          ot: ot,
          pedidos: pedidosVisibles(ot.numeroOt),
          sueltos: sueltosPorOt[ot.numeroOt] ?? const [],
          entregasPorPedido: entregasPorPedido,
          devolucionesPorPedido: devolucionesPorPedido,
          letras: letras,
          materiales: _materiales,
          procesos: _procesos,
          maquinasDe: _maquinasDe,
          puedeEntregas: puedeEntregas,
          puedeDevoluciones: puedeDevoluciones,
          alCambiar: _refrescar,
        ));
      }
    }

    return RefreshIndicator(
      onRefresh: _refrescar,
      child: ListView.builder(
        padding: const EdgeInsets.all(20),
        itemCount: cabecera.length + filas.length,
        itemBuilder: (context, i) => i < cabecera.length ? cabecera[i] : filas[i - cabecera.length](),
      ),
    );
  }
}

// ---------------------------------------------------------------------------

/// Las filas de una OT, cada una armada recién cuando la lista la necesita.
List<Widget Function()> _filasDeOt({
  required OrdenTrabajo ot,
  required List<Consumo> pedidos,
  required List<Devolucion> sueltos,
  required Map<int, List<Entrega>> entregasPorPedido,
  required Map<int, List<Devolucion>> devolucionesPorPedido,
  required Map<int, String> letras,
  required List<MaterialMp> materiales,
  required List<Proceso> procesos,
  required Future<List<Maquina>> Function(int) maquinasDe,
  required bool puedeEntregas,
  required bool puedeDevoluciones,
  required Future<void> Function() alCambiar,
}) {
  final sueltosPorMaterial = <int, List<Devolucion>>{};
  for (final d in sueltos) {
    sueltosPorMaterial.putIfAbsent(d.materialId, () => []).add(d);
  }
  final grupos = sueltosPorMaterial.values.toList();
  return [
    () => Container(
          key: ValueKey('ot-${ot.id}'),
          padding: const EdgeInsets.only(bottom: 6),
          margin: const EdgeInsets.only(top: 12, bottom: 10),
          decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Colores.borde))),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('OT ${ot.numeroOt}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                    Text(
                      '${ot.cliente ?? 'Sin cliente'}${ot.diseno != null ? ' · ${ot.diseno}' : ''}',
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
    if (pedidos.isEmpty && sueltos.isEmpty)
      () => const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text('Esta OT todavía no tiene materiales entregados.', style: TextStyle(color: Colores.textoApagado)),
          ),
    for (final movs in grupos)
      () => Padding(
            key: ValueKey('ing-${ot.id}-${movs.first.materialId}'),
            padding: const EdgeInsets.only(bottom: 12),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      Text(movs.first.codigoMp, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                      const Etiqueta('material fabricado', color: Colores.aviso),
                    ]),
                    const SizedBox(height: 10),
                    _Subtitulo(Icons.move_to_inbox_outlined, 'Ingresos (${movs.length})'),
                    for (final d in movs)
                      _FilaDevolucion(
                        key: ValueKey('d${d.id}'),
                        devolucion: d,
                        unidad: d.unidad,
                        materiales: materiales,
                        entregasDelPedido: const [],
                        letras: letras,
                        puedeCorregir: puedeDevoluciones,
                        alCambiar: alCambiar,
                      ),
                  ],
                ),
              ),
            ),
          ),
    for (final p in pedidos)
      () => Padding(
            key: ValueKey('ped-${p.otMaterialId}'),
            padding: const EdgeInsets.only(bottom: 12),
            child: _TarjetaPedido(
              pedido: p,
              entregas: entregasPorPedido[p.otMaterialId] ?? const [],
              devoluciones: devolucionesPorPedido[p.otMaterialId] ?? const [],
              letras: letras,
              materiales: materiales,
              procesos: procesos,
              maquinasDe: maquinasDe,
              puedeEntregas: puedeEntregas,
              puedeDevoluciones: puedeDevoluciones,
              alCambiar: alCambiar,
            ),
          ),
  ];
}

class _Subtitulo extends StatelessWidget {
  const _Subtitulo(this.icono, this.texto);
  final IconData icono;
  final String texto;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(children: [
          Icon(icono, size: 16, color: Colores.textoApagado),
          const SizedBox(width: 6),
          Text(texto, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Colores.textoApagado)),
        ]),
      );
}

class _Total extends StatelessWidget {
  const _Total(this.rotulo, this.valor);
  final String rotulo;
  final String valor;

  @override
  Widget build(BuildContext context) => Container(
        width: 140,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Colores.apagado, borderRadius: BorderRadius.circular(8)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(rotulo, style: const TextStyle(fontSize: 12, color: Colores.textoApagado)),
          Text(valor, style: const TextStyle(fontWeight: FontWeight.w600)),
        ]),
      );
}

class _TarjetaPedido extends StatelessWidget {
  const _TarjetaPedido({
    required this.pedido,
    required this.entregas,
    required this.devoluciones,
    required this.letras,
    required this.materiales,
    required this.procesos,
    required this.maquinasDe,
    required this.puedeEntregas,
    required this.puedeDevoluciones,
    required this.alCambiar,
  });

  final Consumo pedido;
  final List<Entrega> entregas;
  final List<Devolucion> devoluciones;
  final Map<int, String> letras;
  final List<MaterialMp> materiales;
  final List<Proceso> procesos;
  final Future<List<Maquina>> Function(int) maquinasDe;
  final bool puedeEntregas;
  final bool puedeDevoluciones;
  final Future<void> Function() alCambiar;

  @override
  Widget build(BuildContext context) {
    final p = pedido;
    final u = p.unidad;
    final sustituidos = {for (final e in entregas) e.codigoMpEntregado}..remove(p.codigoMp);
    // El título es el material que REALMENTE se entregó; el del pedido va en "pedido: X".
    final entregados = <String, String?>{};
    for (final e in entregas) {
      entregados.putIfAbsent('${e.codigoMpEntregado}|${letras[e.id] ?? ''}', () => letras[e.id]);
    }
    final estilo = TextStyle(
        fontSize: 16, fontWeight: FontWeight.w600, color: sustituidos.isNotEmpty ? Colores.aviso : Colores.texto);
    final colorEstado = switch (p.estadoEntrega) {
      'COMPLETO' => Colores.exito,
      'PARCIAL' => Colores.aviso,
      _ => Colores.textoApagado,
    };
    final falta = p.cantidadRequerida != null ? p.cantidadRequerida! - p.totalEntregado : 0;

    final listaEntregas = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Subtitulo(Icons.outbox_outlined, 'Entregas (${entregas.length})'),
        for (final e in entregas)
          _FilaEntrega(
            key: ValueKey('e${e.id}'),
            entrega: e,
            pedido: p,
            letra: letras[e.id],
            materiales: materiales,
            procesos: procesos,
            maquinasDe: maquinasDe,
            puedeCorregir: puedeEntregas,
            alCambiar: alCambiar,
          ),
        if (entregas.isEmpty)
          Text(
            p.tieneMateriaPrima ? 'Sin entregas todavía — primero se fabrica con su materia prima.' : 'Sin entregas.',
            style: const TextStyle(fontSize: 12, color: Colores.textoApagado),
          ),
      ],
    );
    final listaDevoluciones = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Subtitulo(Icons.move_to_inbox_outlined, 'Devoluciones e ingresos (${devoluciones.length})'),
        for (final d in devoluciones)
          _FilaDevolucion(
            key: ValueKey('d${d.id}'),
            devolucion: d,
            unidad: u,
            materiales: materiales,
            entregasDelPedido: entregas,
            letras: letras,
            puedeCorregir: puedeDevoluciones,
            alCambiar: alCambiar,
          ),
        if (devoluciones.isEmpty)
          const Text('Sin devoluciones.', style: TextStyle(fontSize: 12, color: Colores.textoApagado)),
      ],
    );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text.rich(entregados.isEmpty
                              ? TextSpan(text: p.codigoMp, style: estilo)
                              : TextSpan(children: [
                                  for (final (i, k) in entregados.keys.indexed) ...[
                                    if (i > 0) TextSpan(text: ' / ', style: estilo),
                                    codigoConLetra(k.split('|').first, entregados[k], estilo: estilo),
                                  ],
                                ])),
                          if (p.tieneMateriaPrima)
                            const Etiqueta('se fabrica en esta OT', color: Colores.primario, icono: Icons.science_outlined),
                          if (p.esMateriaPrima)
                            Etiqueta('materia prima de ${p.insumoDeCodigoMp}', color: Colores.textoApagado),
                          if (sustituidos.isNotEmpty)
                            Etiqueta('pedido: ${p.codigoMp}', color: Colores.aviso, icono: Icons.swap_horiz),
                        ],
                      ),
                      Text('${p.proceso} · ${p.maquina}', style: const TextStyle(color: Colores.textoApagado)),
                    ],
                  ),
                ),
                Etiqueta(p.estadoEntrega, color: colorEstado),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(spacing: 10, runSpacing: 10, children: [
              _Total('Requerido', p.cantidadRequerida != null ? '${numero(p.cantidadRequerida!)} $u' : '—'),
              if (p.totalIngresado > 0) _Total('Ingresó a almacén', '${numero(p.totalIngresado)} $u'),
              _Total('Entregado', '${numero(p.totalEntregado)} $u'),
              _Total('Devuelto', '${numero(p.totalDevuelto)} $u'),
              _Total('Consumo neto', '${numero(p.consumoNeto)} $u'),
            ]),
            if (falta > 0) ...[
              const SizedBox(height: 6),
              Text('Aún falta entregar: ${falta.toStringAsFixed(2)} $u',
                  style: const TextStyle(fontSize: 12, color: Colores.textoApagado)),
            ],
            const SizedBox(height: 14),
            listaEntregas,
            const SizedBox(height: 14),
            listaDevoluciones,
          ],
        ),
      ),
    );
  }
}

/// Recuadro de un movimiento; en modo edición se pinta en celeste.
BoxDecoration _caja({bool editando = false}) => BoxDecoration(
      color: editando ? Colores.primario.withValues(alpha: 0.05) : null,
      border: Border.all(color: editando ? Colores.primario.withValues(alpha: 0.3) : Colores.borde),
      borderRadius: BorderRadius.circular(8),
    );

Widget _botonesCorregir({
  required bool sidCompletado,
  required bool puedeCorregir,
  required bool eliminando,
  required VoidCallback alCorregir,
  required VoidCallback alEliminar,
}) {
  if (sidCompletado) {
    return const Text('SID ya registrado — no se puede corregir.',
        style: TextStyle(fontSize: 12, color: Colores.textoApagado));
  }
  if (!puedeCorregir) return const SizedBox.shrink();
  return Wrap(spacing: 8, children: [
    _BotonFila(icono: Icons.edit, texto: 'Corregir', alTocar: alCorregir),
    _BotonFila(
      icono: Icons.delete_outline,
      texto: eliminando ? 'Eliminando...' : 'Eliminar',
      alTocar: eliminando ? null : alEliminar,
      relleno: true,
    ),
  ]);
}

/// Botón de las filas de movimientos. Hay 2 por cada entrega y devolución de la
/// lista, así que es a propósito más liviano que OutlinedButton/FilledButton
/// (cada uno arma varias capas de Material): con ellos el Historial se trababa
/// al desplazarse. Mismo aspecto y mismo alto táctil (48).
class _BotonFila extends StatelessWidget {
  const _BotonFila({required this.icono, required this.texto, required this.alTocar, this.relleno = false});

  final IconData icono;
  final String texto;
  final VoidCallback? alTocar;
  final bool relleno;

  @override
  Widget build(BuildContext context) {
    final color = relleno ? Colors.white : Colores.primario;
    return Material(
      color: relleno ? (alTocar == null ? Colores.textoApagado : Colores.peligro) : Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: relleno ? BorderSide.none : const BorderSide(color: Colores.borde),
      ),
      child: InkWell(
        onTap: alTocar,
        customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icono, size: 18, color: color),
            const SizedBox(width: 8),
            Text(texto, style: TextStyle(color: color, fontWeight: FontWeight.w500)),
          ]),
        ),
      ),
    );
  }
}

Widget _editadoPor(String? por, String? en) => por == null
    ? const SizedBox.shrink()
    : Text('Editado por $por el ${en != null ? formatearFechaHoraCompleta(en) : ''}',
        style: const TextStyle(fontSize: 12, color: Colores.primario));

class _FilaEntrega extends StatefulWidget {
  const _FilaEntrega({
    super.key,
    required this.entrega,
    required this.pedido,
    required this.letra,
    required this.materiales,
    required this.procesos,
    required this.maquinasDe,
    required this.puedeCorregir,
    required this.alCambiar,
  });

  final Entrega entrega;
  final Consumo pedido;
  final String? letra;
  final List<MaterialMp> materiales;
  final List<Proceso> procesos;
  final Future<List<Maquina>> Function(int) maquinasDe;
  final bool puedeCorregir;
  final Future<void> Function() alCambiar;

  @override
  State<_FilaEntrega> createState() => _FilaEntregaState();
}

class _FilaEntregaState extends State<_FilaEntrega> {
  bool _editando = false;
  bool _ocupado = false;
  String? _error;
  late String _fecha;
  late int _materialId;
  late int? _procesoId;
  late int? _maquinaId;
  // Las casillas de pesos y la nota solo existen mientras se corrige: crear
  // decenas de controladores por fila hacía lenta la lista al desplazarla.
  Bobinas? _bobinasL;
  TextEditingController? _notaL;
  Bobinas get _bobinas => _bobinasL ??= Bobinas.desde(widget.entrega.bobinas);
  TextEditingController get _nota => _notaL ??= TextEditingController(text: widget.entrega.observacion ?? '');

  @override
  void initState() {
    super.initState();
    _reiniciar();
  }

  void _soltarCampos() {
    _bobinasL?.dispose();
    _notaL?.dispose();
    _bobinasL = null;
    _notaL = null;
  }

  void _reiniciar() {
    final e = widget.entrega;
    _fecha = e.fecha;
    _materialId = e.materialEntregadoId;
    _procesoId = e.procesoId;
    _maquinaId = e.maquinaId;
    _soltarCampos();
  }

  // Tras corregir, el Historial se vuelve a leer y llega la entrega actualizada.
  @override
  void didUpdateWidget(covariant _FilaEntrega old) {
    super.didUpdateWidget(old);
    if (!_editando && old.entrega != widget.entrega) {
      _reiniciar();
    }
  }

  @override
  void dispose() {
    _soltarCampos();
    super.dispose();
  }

  Future<void> _guardar() async {
    if (_ocupado) return;
    if (_bobinas.pesos.isEmpty || _bobinas.hayInvalido) {
      setState(() => _error = 'La cantidad debe ser válida y mayor a 0');
      return;
    }
    if (_procesoId == null || _maquinaId == null) {
      setState(() => _error = 'Elige el proceso y la máquina');
      return;
    }
    setState(() {
      _ocupado = true;
      _error = null;
    });
    try {
      await context.read<Sesion>().api.editarEntrega(
            widget.entrega.id,
            fecha: _fecha,
            materialId: _materialId,
            bobinas: _bobinas.pesos,
            observacion: _nota.text.trim().isEmpty ? null : _nota.text.trim(),
            procesoId: _procesoId!,
            maquinaId: _maquinaId!,
          );
      if (mounted) setState(() => _editando = false);
      await widget.alCambiar();
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiError ? e.mensaje : 'No se pudo guardar');
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _eliminar() async {
    final e = widget.entrega;
    if (!await confirmar(context, '¿Eliminar esta entrega de ${e.codigoMpEntregado}? Esta acción no se puede deshacer.')) {
      return;
    }
    if (!mounted) return;
    setState(() {
      _ocupado = true;
      _error = null;
    });
    try {
      await context.read<Sesion>().api.eliminarEntrega(e.id);
      await widget.alCambiar();
    } catch (err) {
      if (mounted) setState(() => _error = err is ApiError ? err.mensaje : 'No se pudo eliminar');
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = widget.entrega;
    final p = widget.pedido;
    const chico = TextStyle(fontSize: 13, color: Colores.textoApagado);

    if (!_editando) {
      final maquinaDistinta = e.procesoId != p.procesoId || e.maquinaId != p.maquinaId;
      return Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(10),
        decoration: _caja(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text.rich(TextSpan(children: [
                    TextSpan(text: '${formatearFecha(e.fecha)} ${horaCorta(e.hora)} · '),
                    codigoConLetra(e.codigoMpEntregado, widget.letra),
                    if (e.codigoMpEntregado != e.codigoMp)
                      TextSpan(text: ' (pedido: ${e.codigoMp})', style: const TextStyle(color: Colores.aviso)),
                    if (maquinaDistinta)
                      TextSpan(
                        text: ' (${e.proceso} · ${e.maquina}; pedido: ${p.proceso} · ${p.maquina})',
                        style: const TextStyle(color: Colores.aviso),
                      ),
                  ])),
                ),
                Text('${numero(e.totalEntregado)} ${e.unidad}', style: const TextStyle(fontWeight: FontWeight.w600)),
              ],
            ),
            Text(e.usuario, style: chico),
            if (e.observacion != null && e.observacion!.isNotEmpty) Text('Nota: ${e.observacion}', style: chico),
            if (e.usaBobinas)
              Text(
                '${e.bobinas.length} ${e.bobinas.length == 1 ? 'bobina' : 'bobinas'}: '
                '${e.bobinas.map((b) => '${numero(b)} ${e.unidad}').join(', ')}',
                style: chico,
              ),
            _editadoPor(e.editadoPor, e.editadoEn),
            if (_error != null) Text(_error!, style: const TextStyle(color: Colores.peligro)),
            const SizedBox(height: 8),
            _botonesCorregir(
              sidCompletado: e.sidCompletado,
              puedeCorregir: widget.puedeCorregir,
              eliminando: _ocupado,
              alCorregir: () => setState(() => _editando = true),
              alEliminar: _eliminar,
            ),
          ],
        ),
      );
    }

    final material = widget.materiales.where((m) => m.id == _materialId).firstOrNull;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: _caja(editando: true),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            const Text('Fecha: ', style: TextStyle(fontWeight: FontWeight.w500)),
            OutlinedButton.icon(
              onPressed: () async {
                final f = await elegirFecha(context, _fecha);
                if (f != null) setState(() => _fecha = f);
              },
              icon: const Icon(Icons.calendar_today, size: 18),
              label: Text(formatearFecha(_fecha)),
            ),
          ]),
          const SizedBox(height: 12),
          SelectorMaterial(
            etiqueta: 'Material entregado',
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
            alCambiar: (pr, m) => setState(() {
              _procesoId = pr;
              _maquinaId = m;
            }),
          ),
          const SizedBox(height: 12),
          CampoCantidad(
            bobinas: _bobinas,
            unidad: material?.unidad ?? e.unidad,
            usaBobinas: material?.usaBobinas ?? e.usaBobinas,
          ),
          const SizedBox(height: 12),
          TextField(controller: _nota, decoration: const InputDecoration(labelText: 'Nota (opcional)')),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colores.peligro)),
          ],
          const SizedBox(height: 12),
          Row(children: [
            FilledButton(onPressed: _ocupado ? null : _guardar, child: Text(_ocupado ? 'Guardando...' : 'Guardar')),
            const SizedBox(width: 8),
            OutlinedButton(
              onPressed: () => setState(() {
                _reiniciar();
                _editando = false;
                _error = null;
              }),
              child: const Text('Cancelar'),
            ),
          ]),
        ],
      ),
    );
  }
}

class _FilaDevolucion extends StatefulWidget {
  const _FilaDevolucion({
    super.key,
    required this.devolucion,
    required this.unidad,
    required this.materiales,
    required this.entregasDelPedido,
    required this.letras,
    required this.puedeCorregir,
    required this.alCambiar,
  });

  final Devolucion devolucion;
  final String unidad;
  final List<MaterialMp> materiales;
  // Para poder cambiar de cuál entrega es un sobrante.
  final List<Entrega> entregasDelPedido;
  final Map<int, String> letras;
  final bool puedeCorregir;
  final Future<void> Function() alCambiar;

  @override
  State<_FilaDevolucion> createState() => _FilaDevolucionState();
}

class _FilaDevolucionState extends State<_FilaDevolucion> {
  bool _editando = false;
  bool _ocupado = false;
  String? _error;
  late String _fecha;
  late int _materialId;
  // 0 = sin especificar (del pedido en general).
  late int _entregaId;
  Bobinas? _bobinasL;
  Bobinas get _bobinas => _bobinasL ??= Bobinas.desde(widget.devolucion.bobinas);

  @override
  void initState() {
    super.initState();
    _reiniciar();
  }

  void _reiniciar() {
    final d = widget.devolucion;
    _fecha = d.fecha;
    _materialId = d.materialId;
    _entregaId = d.entregaId ?? 0;
    _bobinasL?.dispose();
    _bobinasL = null;
  }

  @override
  void didUpdateWidget(covariant _FilaDevolucion old) {
    super.didUpdateWidget(old);
    if (!_editando && old.devolucion != widget.devolucion) {
      _reiniciar();
    }
  }

  @override
  void dispose() {
    _bobinasL?.dispose();
    super.dispose();
  }

  /// Solo un sobrante puede decir de cuál entrega es, y solo entre las de su material.
  List<Entrega> get _entregasPosibles => widget.devolucion.esIngresoProduccion
      ? const []
      : widget.entregasDelPedido.where((e) => e.materialEntregadoId == _materialId).toList();

  int get _entregaEfectiva => _entregasPosibles.any((e) => e.id == _entregaId) ? _entregaId : 0;

  Future<void> _guardar() async {
    if (_ocupado) return;
    if (_bobinas.pesos.isEmpty || _bobinas.hayInvalido) {
      setState(() => _error = 'La cantidad debe ser válida y mayor a 0');
      return;
    }
    setState(() {
      _ocupado = true;
      _error = null;
    });
    final d = widget.devolucion;
    try {
      await context.read<Sesion>().api.editarDevolucion(
            d.id,
            fecha: _fecha,
            materialId: _materialId,
            bobinas: _bobinas.pesos,
            tocarEntrega: !d.esIngresoProduccion,
            entregaId: _entregaEfectiva == 0 ? null : _entregaEfectiva,
          );
      if (mounted) setState(() => _editando = false);
      await widget.alCambiar();
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiError ? e.mensaje : 'No se pudo guardar');
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _eliminar() async {
    final d = widget.devolucion;
    if (!await confirmar(context, '¿Eliminar esta devolución de ${d.codigoMp}? Esta acción no se puede deshacer.')) {
      return;
    }
    if (!mounted) return;
    setState(() {
      _ocupado = true;
      _error = null;
    });
    try {
      await context.read<Sesion>().api.eliminarDevolucion(d.id);
      await widget.alCambiar();
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiError ? e.mensaje : 'No se pudo eliminar');
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.devolucion;
    final u = widget.unidad;
    const chico = TextStyle(fontSize: 13, color: Colores.textoApagado);

    if (!_editando) {
      final letra = d.entregaId != null ? widget.letras[d.entregaId] : null;
      final horaEntrega = d.entregaHora != null ? horaCorta(d.entregaHora!) : null;
      final otroDia = d.entregaFecha != null && d.entregaFecha != d.fecha;
      return Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(10),
        decoration: _caja(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text.rich(TextSpan(children: [
                    TextSpan(text: '${formatearFecha(d.fecha)} ${horaCorta(d.hora)} · ${d.codigoMp}'),
                    if (d.esIngresoProduccion)
                      const TextSpan(text: ' (ingreso a almacén)', style: TextStyle(color: Colores.aviso)),
                  ])),
                ),
                Text('${numero(d.totalDevuelto)} $u', style: const TextStyle(fontWeight: FontWeight.w600)),
              ],
            ),
            Text(d.usuario, style: chico),
            if (horaEntrega != null)
              Text.rich(
                TextSpan(children: [
                  const TextSpan(text: 'de la entrega '),
                  if (letra != null) ...[
                    TextSpan(text: letra, style: const TextStyle(color: Colores.aviso, fontWeight: FontWeight.w700)),
                    TextSpan(text: ' (${otroDia ? '${formatearFecha(d.entregaFecha!)} ' : ''}$horaEntrega)'),
                  ] else
                    TextSpan(text: otroDia ? 'del ${formatearFecha(d.entregaFecha!)} $horaEntrega' : 'de las $horaEntrega'),
                ]),
                style: const TextStyle(fontWeight: FontWeight.w500, color: Colores.primario),
              ),
            if (d.usaBobinas)
              Text(
                '${d.bobinas.length} ${d.bobinas.length == 1 ? 'bobina' : 'bobinas'}: '
                '${d.bobinas.map((b) => '${numero(b)} $u').join(', ')}',
                style: chico,
              ),
            _editadoPor(d.editadoPor, d.editadoEn),
            if (_error != null) Text(_error!, style: const TextStyle(color: Colores.peligro)),
            const SizedBox(height: 8),
            _botonesCorregir(
              sidCompletado: d.sidCompletado,
              puedeCorregir: widget.puedeCorregir,
              eliminando: _ocupado,
              alCorregir: () => setState(() => _editando = true),
              alEliminar: _eliminar,
            ),
          ],
        ),
      );
    }

    final material = widget.materiales.where((m) => m.id == _materialId).firstOrNull;
    final posibles = _entregasPosibles;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: _caja(editando: true),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            const Text('Fecha: ', style: TextStyle(fontWeight: FontWeight.w500)),
            OutlinedButton.icon(
              onPressed: () async {
                final f = await elegirFecha(context, _fecha);
                if (f != null) setState(() => _fecha = f);
              },
              icon: const Icon(Icons.calendar_today, size: 18),
              label: Text(formatearFecha(_fecha)),
            ),
          ]),
          const SizedBox(height: 12),
          SelectorMaterial(
            materiales: widget.materiales,
            valor: _materialId,
            alCambiar: (id) => setState(() => _materialId = id),
          ),
          // De cuál entrega es: opcional, se puede cambiar o quitar.
          if (posibles.length >= 2) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              initialValue: _entregaEfectiva,
              isExpanded: true,
              decoration: const InputDecoration(labelText: '¿De cuál entrega es? (opcional)'),
              items: [
                const DropdownMenuItem(value: 0, child: Text('Sin especificar (del pedido en general)')),
                for (final e in posibles)
                  DropdownMenuItem(
                    value: e.id,
                    child: Text('${formatearFecha(e.fecha)} ${horaCorta(e.hora)}'
                        '${widget.letras[e.id] != null ? ' (${widget.letras[e.id]})' : ''}'
                        ' — entregado ${numero(e.totalEntregado)} ${material?.unidad ?? u}'),
                  ),
              ],
              onChanged: (v) => setState(() => _entregaId = v ?? 0),
            ),
          ],
          const SizedBox(height: 12),
          CampoCantidad(bobinas: _bobinas, unidad: material?.unidad ?? u, usaBobinas: material?.usaBobinas ?? d.usaBobinas),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colores.peligro)),
          ],
          const SizedBox(height: 12),
          Row(children: [
            FilledButton(onPressed: _ocupado ? null : _guardar, child: Text(_ocupado ? 'Guardando...' : 'Guardar')),
            const SizedBox(width: 8),
            OutlinedButton(
              onPressed: () => setState(() {
                _reiniciar();
                _editando = false;
                _error = null;
              }),
              child: const Text('Cancelar'),
            ),
          ]),
        ],
      ),
    );
  }
}
