import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/modelos.dart';
import '../estado/repositorio.dart';
import '../estado/sesion.dart';
import '../tema.dart';
import '../util/formato.dart';
import '../widgets/comunes.dart';

// Versión tablet de Consulta.tsx. En la PC es una tabla de 10 columnas; en la
// tablet (~710 dp de ancho) no entra sin scroll horizontal, así que cada fila
// de la tabla es una TARJETA con los mismos datos. Mismo criterio de filas:
//  - un pedido con 0 o 1 entrega es una tarjeta;
//  - con 2+ entregas, una tarjeta por ENTREGA (con su proceso, máquina,
//    material, hora y las devoluciones que dicen ser de ella); lo que es del
//    pedido entero (requerido, ingreso, avance, SID) va solo en la primera;
//  - las devoluciones que no dicen de cuál entrega son van en una tarjeta
//    aparte "devuelto sin indicar entrega";
//  - los ingresos de material fabricado sin pedido van en tarjetas propias.

class _Fila {
  _Fila({required this.pedido, required this.primera, this.entrega, this.devoluciones, this.sinEntrega});

  final Consumo pedido;
  final bool primera;
  // Fila de UNA entrega (el pedido tuvo 2+).
  final Entrega? entrega;
  // Las devoluciones vinculadas a esa entrega.
  final List<Devolucion>? devoluciones;
  // Fila de devoluciones que no dicen de cuál entrega son.
  final List<Devolucion>? sinEntrega;
}

class _IngresoSuelto {
  _IngresoSuelto(this.codigo, this.unidad);
  final String codigo;
  final String unidad;
  double total = 0;
  bool todoEnSid = true;
}

class ConsultarOt extends StatefulWidget {
  const ConsultarOt({super.key});

  @override
  State<ConsultarOt> createState() => _ConsultarOtState();
}

class _ConsultarOtState extends State<ConsultarOt> {
  final _numeroOt = TextEditingController();
  String? _otBuscada;
  bool _cargando = false;
  String? _error;
  List<Consumo> _pedidos = [];
  List<Entrega> _entregas = [];
  List<Devolucion> _devoluciones = [];

  StreamSubscription<String>? _suscripcionOt;

  @override
  void initState() {
    super.initState();
    // Otro equipo cambió la OT que se está viendo: se actualiza sin tocar nada.
    _suscripcionOt = context.read<Repositorio>().cambiosDeOt.listen((ot) {
      if (mounted && ot == _otBuscada) _buscar(ot_: ot, automatica: true);
    });
  }

  @override
  void dispose() {
    _suscripcionOt?.cancel();
    _numeroOt.dispose();
    super.dispose();
  }

  /// [automatica]: la pide un aviso del servidor, no la persona (no se le quita el teclado).
  Future<void> _buscar({String? ot_, bool automatica = false}) async {
    final ot = (ot_ ?? _numeroOt.text).trim();
    if (ot.isEmpty) return;
    if (!automatica) FocusScope.of(context).unfocus();
    final api = context.read<Sesion>().api;
    // Al instante lo que la copia local sabe de la OT; el servidor lo confirma enseguida.
    final repo = context.read<Repositorio>();
    final previos = repo.tieneDatos ? repo.consumoDe(ot) : <Consumo>[];
    setState(() {
      _otBuscada = ot;
      if (previos.isNotEmpty) {
        _pedidos = previos;
        _entregas = repo.entregasDe(ot);
        _devoluciones = repo.devolucionesDe(ot);
      }
      _cargando = previos.isEmpty;
      _error = null;
    });
    try {
      final r = await Future.wait([api.consultarConsumo(ot), api.listarEntregas(ot), api.listarDevolucionesPorOt(ot)]);
      if (!mounted || _otBuscada != ot) return;
      setState(() {
        _pedidos = r[0] as List<Consumo>;
        _entregas = r[1] as List<Entrega>;
        _devoluciones = r[2] as List<Devolucion>;
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  Map<int, List<Entrega>> get _entregasPorPedido {
    final m = <int, List<Entrega>>{};
    for (final e in _entregas) {
      m.putIfAbsent(e.otMaterialId, () => []).add(e);
    }
    return m;
  }

  /// Sobrantes por pedido (los ingresos a almacén no: van en su propio total).
  Map<int, List<Devolucion>> get _devolucionesPorPedido {
    final m = <int, List<Devolucion>>{};
    for (final d in _devoluciones) {
      if (d.otMaterialId == null || d.esIngresoProduccion) continue;
      m.putIfAbsent(d.otMaterialId!, () => []).add(d);
    }
    return m;
  }

  List<_Fila> _armarFilas(Map<int, List<Entrega>> entregas, Map<int, List<Devolucion>> devoluciones) {
    final filas = <_Fila>[];
    for (final p in _pedidos) {
      final suyas = entregas[p.otMaterialId] ?? const <Entrega>[];
      final devs = devoluciones[p.otMaterialId] ?? const <Devolucion>[];
      if (suyas.length < 2) {
        filas.add(_Fila(pedido: p, primera: true));
        continue;
      }
      for (final (i, e) in suyas.indexed) {
        filas.add(_Fila(
          pedido: p,
          primera: i == 0,
          entrega: e,
          devoluciones: devs.where((d) => d.entregaId == e.id).toList(),
        ));
      }
      final ids = suyas.map((e) => e.id).toSet();
      final sueltas = devs.where((d) => d.entregaId == null || !ids.contains(d.entregaId)).toList();
      if (sueltas.isNotEmpty) filas.add(_Fila(pedido: p, primera: false, sinEntrega: sueltas));
    }
    return filas;
  }

  List<_IngresoSuelto> get _ingresosSueltos {
    final m = <int, _IngresoSuelto>{};
    for (final d in _devoluciones) {
      if (!d.esIngresoProduccion || d.otMaterialId != null) continue;
      final i = m.putIfAbsent(d.materialId, () => _IngresoSuelto(d.codigoMp, d.unidad));
      i.total = redondearPeso(i.total + d.totalDevuelto);
      i.todoEnSid = i.todoEnSid && d.sidCompletado;
    }
    return m.values.toList();
  }

  @override
  Widget build(BuildContext context) {
    final entregas = _entregasPorPedido;
    final devoluciones = _devolucionesPorPedido;
    final filas = _armarFilas(entregas, devoluciones);
    final ingresos = _ingresosSueltos;
    final letras = letrasDeEntregas(_entregas.map(
        (e) => (id: e.id, numeroOt: e.numeroOt, codigo: e.codigoMpEntregado, fecha: e.fecha, hora: e.hora)));
    final hayFilas = _pedidos.isNotEmpty || ingresos.isNotEmpty;
    final cliente = _pedidos.isNotEmpty
        ? _pedidos.first.cliente
        : _devoluciones.where((d) => d.esIngresoProduccion).firstOrNull?.cliente;
    final diseno = _pedidos.isNotEmpty ? _pedidos.first.diseno : null;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text('Consultar OT', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w600)),
        const SizedBox(height: 16),
        Tarjeta(
          titulo: 'Buscar',
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _numeroOt,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(labelText: 'Número de OT', hintText: '123'),
                    textInputAction: TextInputAction.search,
                    onSubmitted: (_) => _buscar(),
                  ),
                ),
                const SizedBox(width: 10),
                FilledButton.icon(onPressed: _buscar, icon: const Icon(Icons.search), label: const Text('Buscar')),
              ],
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (_cargando) const Center(child: CircularProgressIndicator()),
        if (_error != null)
          Aviso(
            color: hayFilas ? Colores.aviso : Colores.peligro,
            // Con datos de la copia local se sigue mostrando lo último que se supo.
            texto: hayFilas ? '$_error. Se muestra la última copia guardada en la tablet.' : _error!,
            accion: TextButton(onPressed: _buscar, child: const Text('Reintentar')),
          ),
        if (_otBuscada != null && !_cargando && _error == null && !hayFilas)
          const Text('No hay movimientos para esa OT.', style: TextStyle(color: Colores.textoApagado)),
        if (!_cargando && hayFilas) ...[
          Text(
            '${cliente ?? 'Sin cliente'}${diseno != null && diseno.isNotEmpty ? ' · Descripción: $diseno' : ''}',
            style: const TextStyle(color: Colores.textoApagado),
          ),
          const SizedBox(height: 10),
          for (final f in filas)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _TarjetaFila(
                fila: f,
                entregasDelPedido: entregas[f.pedido.otMaterialId] ?? const [],
                devolucionesDelPedido: devoluciones[f.pedido.otMaterialId] ?? const [],
                letras: letras,
              ),
            ),
          for (final i in ingresos)
            Padding(padding: const EdgeInsets.only(bottom: 10), child: _TarjetaIngresoSuelto(ingreso: i)),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------

/// Un dato de la tarjeta: rótulo chico arriba, valor abajo (y, si hay 2+
/// movimientos, una línea por cada uno con su hora y el total al final).
class _Dato extends StatelessWidget {
  const _Dato(this.rotulo, this.valor, {this.lineas = const [], this.destacado = false, this.pie});

  final String rotulo;
  final String valor;
  final List<InlineSpan> lineas;
  final bool destacado;
  final String? pie;

  @override
  Widget build(BuildContext context) {
    const chico = TextStyle(fontSize: 13);
    return SizedBox(
      width: 200,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(rotulo, style: const TextStyle(fontSize: 12, color: Colores.textoApagado)),
          const SizedBox(height: 2),
          if (lineas.length >= 2) ...[
            for (final l in lineas) Text.rich(l, style: chico),
            Container(
              margin: const EdgeInsets.only(top: 2),
              padding: const EdgeInsets.only(top: 2),
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: Colores.borde))),
              child: Text('Total: $valor', style: const TextStyle(fontSize: 12, color: Colores.textoApagado)),
            ),
          ] else if (lineas.length == 1)
            Text.rich(lineas.first, style: chico.copyWith(fontWeight: destacado ? FontWeight.w600 : null))
          else
            Text(valor, style: TextStyle(fontWeight: destacado ? FontWeight.w600 : FontWeight.w500)),
          if (pie != null) Text(pie!, style: const TextStyle(fontSize: 12, color: Colores.textoApagado)),
        ],
      ),
    );
  }
}

const _estiloEstado = {
  'COMPLETO': Colores.exito,
  'PARCIAL': Colores.aviso,
};

class _TarjetaFila extends StatelessWidget {
  const _TarjetaFila({
    required this.fila,
    required this.entregasDelPedido,
    required this.devolucionesDelPedido,
    required this.letras,
  });

  final _Fila fila;
  final List<Entrega> entregasDelPedido;
  final List<Devolucion> devolucionesDelPedido;
  final Map<int, String> letras;

  @override
  Widget build(BuildContext context) {
    final p = fila.pedido;
    final u = p.unidad;
    final entrega = fila.entrega;
    final sinEntrega = fila.sinEntrega;
    final ultima = entregasDelPedido.isEmpty ? null : entregasDelPedido.last;
    final proceso = entrega?.proceso ?? ultima?.proceso ?? p.proceso;
    final maquina = entrega?.maquina ?? ultima?.maquina ?? p.maquina;

    // Material: el que REALMENTE salió (en naranja si no es el del pedido).
    final List<(String, String?)> materiales;
    if (entrega != null) {
      materiales = [(entrega.codigoMpEntregado, letras[entrega.id])];
    } else if (entregasDelPedido.isNotEmpty) {
      final vistos = <String>{};
      materiales = [
        for (final e in entregasDelPedido)
          if (vistos.add('${e.codigoMpEntregado}|${letras[e.id]}')) (e.codigoMpEntregado, letras[e.id]),
      ];
    } else {
      materiales = [(p.codigoMp, null)];
    }
    final sustituido = sinEntrega == null && materiales.any((m) => m.$1 != p.codigoMp);

    InlineSpan lineaEntrega(Entrega e) =>
        TextSpan(text: '${formatearFecha(e.fecha)} ${horaCorta(e.hora)} · ${numero(e.totalEntregado)} $u');
    InlineSpan lineaDevolucion(Devolucion d) {
      final deEntrega = d.entregaId == null ? null : entregasDelPedido.where((e) => e.id == d.entregaId).firstOrNull;
      final letra = deEntrega != null ? letras[deEntrega.id] : null;
      return TextSpan(children: [
        TextSpan(text: '${formatearFecha(d.fecha)} ${horaCorta(d.hora)} · ${numero(d.totalDevuelto)} $u'),
        // En una tarjeta de UNA entrega ya se sabe de cuál es.
        if (deEntrega != null && entrega == null) ...[
          const TextSpan(text: ' (de la entrega '),
          if (letra != null)
            TextSpan(text: letra, style: const TextStyle(color: Colores.aviso, fontWeight: FontWeight.w700))
          else
            const TextSpan(text: 'de las'),
          TextSpan(text: '${letra != null ? ',' : ''} ${horaCorta(deEntrega.hora)})'),
        ],
      ]);
    }

    double suma(Iterable<double> xs) => redondearPeso(xs.fold(0.0, (a, b) => a + b));

    final datos = <Widget>[];
    if (sinEntrega != null) {
      datos.add(_Dato('Devuelto', '${suma(sinEntrega.map((d) => d.totalDevuelto))} $u',
          lineas: sinEntrega.map(lineaDevolucion).toList()));
    } else if (entrega != null) {
      final devs = fila.devoluciones!;
      final entregado = entrega.totalEntregado;
      final devuelto = suma(devs.map((d) => d.totalDevuelto));
      if (fila.primera) {
        datos.add(_Dato('Requerido', p.cantidadRequerida != null ? '${numero(p.cantidadRequerida!)} $u' : '—'));
      }
      datos.add(_Dato('Entregado', '${numero(entregado)} $u', lineas: [lineaEntrega(entrega)]));
      datos.add(_Dato('Devuelto', '${numero(devuelto)} $u', lineas: devs.map(lineaDevolucion).toList()));
      if (fila.primera && p.totalIngresado > 0) {
        datos.add(_Dato('Ingresó a almacén', '${numero(p.totalIngresado)} $u'));
      }
      datos.add(_Dato('Consumo neto', '${numero(redondearPeso(entregado - devuelto))} $u',
          destacado: true, pie: fila.primera ? 'Pedido: ${numero(p.consumoNeto)} $u' : null));
    } else {
      datos.add(_Dato('Requerido', p.cantidadRequerida != null ? '${numero(p.cantidadRequerida!)} $u' : '—'));
      datos.add(_Dato('Entregado', '${numero(p.totalEntregado)} $u',
          lineas: entregasDelPedido.length >= 2 ? entregasDelPedido.map(lineaEntrega).toList() : const []));
      datos.add(_Dato('Devuelto', '${numero(p.totalDevuelto)} $u',
          lineas: devolucionesDelPedido.length >= 2 ? devolucionesDelPedido.map(lineaDevolucion).toList() : const []));
      if (p.totalIngresado > 0) datos.add(_Dato('Ingresó a almacén', '${numero(p.totalIngresado)} $u'));
      datos.add(_Dato('Consumo neto', '${numero(p.consumoNeto)} $u', destacado: true));
    }

    final colorEstado = _estiloEstado[p.estadoEntrega] ?? Colores.textoApagado;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (sinEntrega != null) ...[
                  Text(p.codigoMp, style: const TextStyle(fontWeight: FontWeight.w600)),
                  const Etiqueta('devuelto sin indicar entrega', color: Colores.textoApagado),
                ] else ...[
                  Text.rich(TextSpan(children: [
                    TextSpan(text: '$proceso — $maquina — ', style: const TextStyle(fontWeight: FontWeight.w600)),
                    for (final (i, m) in materiales.indexed) ...[
                      if (i > 0) const TextSpan(text: ' / '),
                      codigoConLetra(m.$1, m.$2,
                          estilo: TextStyle(
                              fontWeight: FontWeight.w600, color: m.$1 != p.codigoMp ? Colores.aviso : Colores.texto)),
                    ],
                  ])),
                  if (sustituido) Etiqueta('pedido: ${p.codigoMp}', color: Colores.aviso, icono: Icons.swap_horiz),
                ],
                // Lo del pedido entero, solo en su primera tarjeta.
                if (fila.primera && sinEntrega == null) ...[
                  Etiqueta(p.estadoEntrega, color: colorEstado),
                  Etiqueta('SID ${p.estadoSid}', color: Colores.textoApagado),
                ],
              ],
            ),
            const SizedBox(height: 10),
            Wrap(spacing: 16, runSpacing: 10, children: datos),
          ],
        ),
      ),
    );
  }
}

class _TarjetaIngresoSuelto extends StatelessWidget {
  const _TarjetaIngresoSuelto({required this.ingreso});

  final _IngresoSuelto ingreso;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Text(ingreso.codigo, style: const TextStyle(fontWeight: FontWeight.w600)),
              const Etiqueta('material fabricado', color: Colores.aviso),
              Etiqueta('SID ${ingreso.todoEnSid ? 'COMPLETADO' : 'PENDIENTE'}', color: Colores.textoApagado),
            ]),
            const SizedBox(height: 10),
            _Dato('Ingresó a almacén', '${numero(ingreso.total)} ${ingreso.unidad}'),
          ],
        ),
      ),
    );
  }
}
