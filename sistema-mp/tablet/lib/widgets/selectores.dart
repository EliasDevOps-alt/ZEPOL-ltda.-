import 'package:flutter/material.dart';

import '../api/modelos.dart';
import '../tema.dart';

/// Campo para elegir un material del catálogo (500+ códigos): al tocarlo abre
/// un buscador. Con la búsqueda vacía muestra la lista completa.
class SelectorMaterial extends StatelessWidget {
  const SelectorMaterial({
    super.key,
    required this.materiales,
    required this.valor,
    required this.alCambiar,
    this.etiqueta = 'Material',
  });

  final List<MaterialMp> materiales;
  final int? valor;
  final ValueChanged<int> alCambiar;
  final String etiqueta;

  @override
  Widget build(BuildContext context) {
    final elegido = materiales.where((m) => m.id == valor).firstOrNull;
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: () async {
        final id = await showDialog<int>(
          context: context,
          builder: (_) => _BuscadorMaterial(materiales: materiales),
        );
        if (id != null) alCambiar(id);
      },
      child: InputDecorator(
        decoration: InputDecoration(labelText: etiqueta, suffixIcon: const Icon(Icons.search)),
        isEmpty: elegido == null,
        child: Text(
          elegido == null ? '' : _textoMaterial(elegido),
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }
}

String _textoMaterial(MaterialMp m) => m.descripcion != null && m.descripcion!.isNotEmpty
    ? '${m.codigoMp} — ${m.descripcion}'
    : m.codigoMp;

class _BuscadorMaterial extends StatefulWidget {
  const _BuscadorMaterial({required this.materiales});

  final List<MaterialMp> materiales;

  @override
  State<_BuscadorMaterial> createState() => _BuscadorMaterialState();
}

class _BuscadorMaterialState extends State<_BuscadorMaterial> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final q = _q.trim().toLowerCase();
    final lista = q.isEmpty
        ? widget.materiales
        : widget.materiales
            .where((m) => m.codigoMp.toLowerCase().contains(q) || (m.descripcion ?? '').toLowerCase().contains(q))
            .toList();
    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560, maxHeight: 620),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              TextField(
                autofocus: true,
                decoration: const InputDecoration(hintText: 'Buscar código MP...', prefixIcon: Icon(Icons.search)),
                onChanged: (v) => setState(() => _q = v),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: lista.isEmpty
                    ? const Center(child: Text('Sin materiales activos que coincidan'))
                    : ListView.builder(
                        itemCount: lista.length,
                        itemBuilder: (_, i) {
                          final m = lista[i];
                          return ListTile(
                            title: Text(m.codigoMp, style: const TextStyle(fontWeight: FontWeight.w600)),
                            subtitle: m.descripcion != null ? Text(m.descripcion!) : null,
                            trailing: Text(m.unidad, style: const TextStyle(color: Colores.textoApagado)),
                            onTap: () => Navigator.of(context).pop(m.id),
                          );
                        },
                      ),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancelar')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Proceso y Máquina lado a lado; cambiar el proceso vacía la máquina.
class SelectorProcesoMaquina extends StatelessWidget {
  const SelectorProcesoMaquina({
    super.key,
    required this.procesos,
    required this.maquinasDe,
    required this.procesoId,
    required this.maquinaId,
    required this.alCambiar,
    this.obligatorio = false,
  });

  final List<Proceso> procesos;
  // Las máquinas de un proceso (con caché en la pantalla que lo usa).
  final Future<List<Maquina>> Function(int procesoId) maquinasDe;
  final int? procesoId;
  final int? maquinaId;
  final void Function(int? procesoId, int? maquinaId) alCambiar;
  final bool obligatorio;

  @override
  Widget build(BuildContext context) {
    final sufijo = obligatorio ? ' (obligatorio)' : '';
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: DropdownButtonFormField<int>(
            key: ValueKey('proceso-$procesoId'),
            initialValue: procesos.any((p) => p.id == procesoId) ? procesoId : null,
            isExpanded: true,
            decoration: InputDecoration(labelText: 'Proceso$sufijo'),
            items: [for (final p in procesos) DropdownMenuItem(value: p.id, child: Text(p.nombre))],
            onChanged: (v) => alCambiar(v, null),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: procesoId == null
              ? DropdownButtonFormField<int>(
                  isExpanded: true,
                  decoration: InputDecoration(labelText: 'Máquina$sufijo'),
                  items: const [],
                  onChanged: null,
                )
              : FutureBuilder<List<Maquina>>(
                  future: maquinasDe(procesoId!),
                  builder: (context, snap) {
                    final maquinas = snap.data ?? const <Maquina>[];
                    return DropdownButtonFormField<int>(
                      key: ValueKey('maquina-$procesoId-$maquinaId-${maquinas.length}'),
                      initialValue: maquinas.any((m) => m.id == maquinaId) ? maquinaId : null,
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: 'Máquina$sufijo',
                        errorText: snap.hasError ? 'No se pudieron cargar las máquinas' : null,
                      ),
                      hint: snap.connectionState == ConnectionState.waiting ? const Text('Cargando...') : null,
                      items: [for (final m in maquinas) DropdownMenuItem(value: m.id, child: Text(m.nombre))],
                      onChanged: (v) => alCambiar(procesoId, v),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
