import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../tema.dart';
import '../widgets/comunes.dart';
import 'actualizador.dart';

/// Franja que avisa que hay una versión nueva de la app, la va bajando y, cuando
/// está lista, deja instalarla con un toque. Si no hay nada nuevo no ocupa lugar.
class BannerActualizacion extends StatelessWidget {
  const BannerActualizacion({super.key});

  @override
  Widget build(BuildContext context) {
    final a = context.watch<Actualizador>();
    final v = a.nueva;
    if (!a.hayActualizacion || v == null) {
      // Un error al bajar/instalar sí se muestra, con "Reintentar".
      if (a.estado == EstadoActualizacion.error && a.nueva != null && a.mensaje != null) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Aviso(
            color: Colores.peligro,
            texto: a.mensaje!,
            accion: TextButton(onPressed: a.descargar, child: const Text('Reintentar')),
          ),
        );
      }
      return const SizedBox.shrink();
    }

    final titulo = 'Hay una versión nueva de ZEPOL: ${v.nombre}';
    final Widget detalle;
    final Widget? boton;
    switch (a.estado) {
      case EstadoActualizacion.descargando:
        detalle = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Descargando… ${(a.progreso * 100).floor()} %'),
          const SizedBox(height: 4),
          LinearProgressIndicator(value: a.progreso),
        ]);
        boton = null;
      case EstadoActualizacion.listaParaInstalar:
        detalle = Text(v.notas.isNotEmpty ? v.notas : 'Lista para instalar. Guarda lo que estés haciendo antes.');
        boton = FilledButton.icon(
          onPressed: a.instalar,
          icon: const Icon(Icons.system_update),
          label: const Text('Instalar ahora'),
        );
      case EstadoActualizacion.necesitaPermiso:
        detalle = Text(a.mensaje ?? 'Falta un permiso para instalar.');
        boton = FilledButton.icon(onPressed: a.instalar, icon: const Icon(Icons.system_update), label: const Text('Instalar'));
      default:
        detalle = Text(v.notas.isNotEmpty ? v.notas : 'Disponible para descargar.');
        boton = FilledButton.icon(onPressed: a.descargar, icon: const Icon(Icons.download), label: const Text('Descargar'));
    }

    final color = v.obligatoria ? Colores.aviso : Colores.primario;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Row(children: [
          Icon(Icons.system_update_alt, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(titulo, style: TextStyle(fontWeight: FontWeight.w600, color: color)),
              const SizedBox(height: 2),
              detalle,
            ]),
          ),
          if (boton != null) ...[const SizedBox(width: 12), boton],
        ]),
      ),
    );
  }
}

/// "Versión 1.0.3" con un botón para buscar actualizaciones a mano (en el login,
/// donde se ve antes de entrar).
class VersionYBusqueda extends StatelessWidget {
  const VersionYBusqueda({super.key});

  @override
  Widget build(BuildContext context) {
    final a = context.watch<Actualizador>();
    final nombre = a.instalada?.nombre;
    final buscando = a.estado == EstadoActualizacion.revisando;
    final String texto;
    if (buscando) {
      texto = 'Buscando actualización...';
    } else if (a.hayActualizacion && a.nueva != null) {
      texto = 'Versión nueva ${a.nueva!.nombre} disponible';
    } else if (a.estado == EstadoActualizacion.error) {
      texto = a.mensaje ?? 'No se pudo buscar';
    } else if (a.estado == EstadoActualizacion.alDia) {
      texto = a.mensaje ?? 'Estás en la última versión';
    } else {
      texto = '';
    }
    return Column(mainAxisSize: MainAxisSize.min, children: [
      TextButton.icon(
        onPressed: buscando ? null : () => a.revisar(manual: true),
        icon: const Icon(Icons.system_update_alt, size: 18, color: Colores.textoApagado),
        label: Text('Buscar actualización${nombre != null ? ' (versión $nombre)' : ''}',
            style: const TextStyle(color: Colores.textoApagado)),
      ),
      if (texto.isNotEmpty) Text(texto, style: const TextStyle(fontSize: 12, color: Colores.textoApagado)),
    ]);
  }
}
