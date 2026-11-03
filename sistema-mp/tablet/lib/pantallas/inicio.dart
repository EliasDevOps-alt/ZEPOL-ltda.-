import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/modelos.dart';
import '../actualizacion/banner_actualizacion.dart';
import '../estado/repositorio.dart';
import '../estado/sesion.dart';
import '../tema.dart';
import 'consultar_ot.dart';
import 'historial.dart';
import 'registrar_devolucion.dart';
import 'registrar_entrega.dart';

class _Seccion {
  const _Seccion(this.titulo, this.icono, this.construir, {this.modulo, this.submodulo = false});

  final String titulo;
  final IconData icono;
  final Widget Function() construir;
  // null = no se restringe (como Consultar OT e Historial en el escritorio).
  final String? modulo;
  // Va con sangría debajo del anterior (Historial de OT bajo Registrar Entrega).
  final bool submodulo;
}

// Lo que hace el personal de almacén (Erasmo, Ever). Producto Terminado y
// Reportes quedan en la PC: a pedido de Elias no van en la tablet.
final _secciones = <_Seccion>[
  _Seccion('Registrar Entrega', Icons.outbox_outlined, () => const RegistrarEntrega(),
      modulo: Modulo.registrarEntrega),
  _Seccion('Historial de OT', Icons.history, () => const Historial(), submodulo: true),
  _Seccion('Registrar Devolución', Icons.move_to_inbox_outlined, () => const RegistrarDevolucion(),
      modulo: Modulo.registrarDevolucion),
  _Seccion('Consultar OT', Icons.search, () => const ConsultarOt()),
];

/// Menú lateral fijo en horizontal (cajón en vertical) con solo las pantallas que el
/// usuario tiene permitidas; los permisos vienen del servidor, así que si se
/// restringe un módulo desde Usuarios en la PC, la tablet lo respeta sola.
class Inicio extends StatefulWidget {
  const Inicio({super.key});

  @override
  State<Inicio> createState() => _InicioState();
}

class _InicioState extends State<Inicio> {
  int _indice = 0;
  final _clave = GlobalKey<ScaffoldState>();

  // Por debajo de este ancho (tablet en vertical) el menú pasa a un cajón que
  // se abre con el botón de arriba, para dejarle el ancho a la pantalla.
  static const _anchoMinimoMenuFijo = 760.0;

  @override
  void initState() {
    super.initState();
    // La copia local de los datos se pone al día en segundo plano desde que se entra.
    context.read<Repositorio>().iniciar();
  }

  Widget _menu(BuildContext context, List<_Seccion> visibles, int indice, {required bool cajon}) {
    final sesion = context.watch<Sesion>();
    final usuario = sesion.usuario!;
    return Container(
      width: 210,
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(right: BorderSide(color: Colores.borde)),
      ),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(height: 5, decoration: const BoxDecoration(gradient: LinearGradient(colors: Colores.acentos))),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 20, 20, 16),
              child:
                  Text('ZEPOL', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Colores.primario)),
            ),
            // Con el teclado abierto queda poco alto: la lista se desplaza
            // en vez de desbordar.
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  for (var i = 0; i < visibles.length; i++)
                    _ItemMenu(
                      seccion: visibles[i],
                      activo: i == indice,
                      alTocar: () {
                        setState(() => _indice = i);
                        if (cajon) Navigator.of(context).pop();
                      },
                    ),
                ],
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: CircleAvatar(
                backgroundColor: Colores.primario.withValues(alpha: 0.12),
                child: Text(usuario.inicial, style: const TextStyle(color: Colores.primario)),
              ),
              title: Text(usuario.nombre, overflow: TextOverflow.ellipsis),
              trailing: IconButton(
                tooltip: 'Cerrar sesión',
                icon: const Icon(Icons.logout),
                onPressed: sesion.cerrarSesion,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final usuario = context.watch<Sesion>().usuario!;
    final visibles = _secciones.where((s) => s.modulo == null || usuario.tieneAcceso(s.modulo!)).toList();
    final indice = _indice < visibles.length ? _indice : 0;

    // IndexedStack conserva lo escrito al cambiar de pantalla y volver.
    final pantallas = visibles.isEmpty
        ? const Center(child: Text('Tu usuario no tiene acceso a ninguna pantalla de la tablet.'))
        : IndexedStack(index: indice, children: [for (final s in visibles) s.construir()]);
    // El aviso de versión nueva va arriba de la pantalla y no ocupa nada si no hay.
    final contenido = Column(children: [const BannerActualizacion(), Expanded(child: pantallas)]);

    return LayoutBuilder(builder: (context, c) {
      final fijo = c.maxWidth >= _anchoMinimoMenuFijo;
      if (fijo) {
        return Scaffold(
          body: SafeArea(
            child: Row(children: [
              _menu(context, visibles, indice, cajon: false),
              Expanded(child: contenido),
            ]),
          ),
        );
      }
      return Scaffold(
        key: _clave,
        drawer: Drawer(width: 230, child: _menu(context, visibles, indice, cajon: true)),
        body: SafeArea(
          child: Column(children: [
            Container(
              height: 56,
              decoration: const BoxDecoration(
                color: Colors.white,
                border: Border(bottom: BorderSide(color: Colores.borde)),
              ),
              child: Row(children: [
                IconButton(
                  tooltip: 'Menú',
                  iconSize: 28,
                  onPressed: () => _clave.currentState?.openDrawer(),
                  icon: const Icon(Icons.menu),
                ),
                Expanded(
                  child: Text(
                    visibles.isEmpty ? 'ZEPOL' : visibles[indice].titulo,
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Colores.primario),
                  ),
                ),
              ]),
            ),
            Expanded(child: contenido),
          ]),
        ),
      );
    });
  }
}

class _ItemMenu extends StatelessWidget {
  const _ItemMenu({required this.seccion, required this.activo, required this.alTocar});

  final _Seccion seccion;
  final bool activo;
  final VoidCallback alTocar;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(seccion.submodulo ? 30 : 10, 2, 10, 2),
      child: Material(
        color: activo ? Colores.primario.withValues(alpha: 0.1) : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: alTocar,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
            child: Row(
              children: [
                Icon(seccion.icono, color: activo ? Colores.primario : Colores.textoApagado),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    seccion.titulo,
                    style: TextStyle(
                      fontWeight: activo ? FontWeight.w600 : FontWeight.w400,
                      color: activo ? Colores.primario : Colores.texto,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
