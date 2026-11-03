import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../tema.dart';
import '../util/formato.dart';

/// Lo escrito en un CampoCantidad: una casilla por bobina (siempre queda una
/// vacía al final para la siguiente) o una sola casilla de cantidad total.
/// Mismo comportamiento que CampoCantidad.tsx del escritorio.
class Bobinas extends ChangeNotifier {
  Bobinas() {
    _agregar();
  }

  /// Con pesos ya cargados (para corregir un movimiento), más la casilla vacía del final.
  Bobinas.desde(List<double> valores) {
    for (final v in valores) {
      _agregar();
      campos.last.text = numero(v);
    }
    _agregar();
  }

  final List<TextEditingController> campos = [];
  final List<FocusNode> focos = [];

  void _agregar() {
    campos.add(TextEditingController());
    focos.add(FocusNode());
  }

  /// Pesos cargados (ignora las casillas vacías).
  List<double> get pesos =>
      campos.map((c) => c.text.trim()).where((t) => t.isNotEmpty).map((t) => leerNumero(t) ?? 0).toList();

  /// Alguna casilla con texto que no es un número mayor a 0.
  bool get hayInvalido => campos.any((c) {
        final t = c.text.trim();
        if (t.isEmpty) return false;
        final n = leerNumero(t);
        return n == null || n <= 0;
      });

  double get total => redondearPeso(pesos.fold(0.0, (a, b) => a + b));

  void _alCambiar(int i) {
    // Al escribir en la última casilla aparece otra vacía: cargar N bobinas es
    // escribir N pesos seguidos.
    if (i == campos.length - 1 && campos[i].text.trim().isNotEmpty) _agregar();
    notifyListeners();
  }

  void _quitar(int i) {
    campos.removeAt(i).dispose();
    focos.removeAt(i).dispose();
    if (campos.isEmpty) _agregar();
    notifyListeners();
  }

  void refrescar() => notifyListeners();

  void limpiar() {
    for (final c in campos) {
      c.dispose();
    }
    for (final f in focos) {
      f.dispose();
    }
    campos.clear();
    focos.clear();
    _agregar();
    notifyListeners();
  }

  @override
  void dispose() {
    for (final c in campos) {
      c.dispose();
    }
    for (final f in focos) {
      f.dispose();
    }
    super.dispose();
  }
}

/// Un peso es dígitos con, como mucho, UN separador decimal (punto o coma): "55.99"
/// o "55,99". Lo que dejaría el texto como "66.33.66" o "2..2" se rechaza al
/// escribir o pegar y el campo se queda como estaba (igual que el campo numérico
/// de la PC, que tampoco acepta dos puntos).
class SoloUnDecimal extends TextInputFormatter {
  const SoloUnDecimal();

  static final _valido = RegExp(r'^[0-9]*[.,]?[0-9]*$');

  @override
  TextEditingValue formatEditUpdate(TextEditingValue anterior, TextEditingValue nuevo) =>
      _valido.hasMatch(nuevo.text) ? nuevo : anterior;
}

const _soloNumeros = SoloUnDecimal();

class CampoCantidad extends StatelessWidget {
  const CampoCantidad({
    super.key,
    required this.bobinas,
    required this.unidad,
    required this.usaBobinas,
    this.requerido,
  });

  final Bobinas bobinas;
  final String unidad;
  // Propiedad del material (usa_bobinas), nunca se deduce de la unidad.
  final bool usaBobinas;
  final bool? requerido;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: bobinas,
      builder: (context, _) {
        final sufijo = requerido == null ? '' : (requerido! ? ' (obligatorio)' : ' (opcional)');
        final unidadTexto = unidad.isNotEmpty ? ' ($unidad)' : '';

        if (!usaBobinas) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Cantidad$unidadTexto$sufijo', style: const TextStyle(fontWeight: FontWeight.w500)),
              const SizedBox(height: 6),
              SizedBox(
                width: 220,
                child: TextField(
                  controller: bobinas.campos.first,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [_soloNumeros],
                  onChanged: (_) => bobinas.refrescar(),
                ),
              ),
            ],
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Peso de cada bobina$unidadTexto$sufijo', style: const TextStyle(fontWeight: FontWeight.w500)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (var i = 0; i < bobinas.campos.length; i++)
                  SizedBox(
                    width: 170,
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: bobinas.campos[i],
                            focusNode: bobinas.focos[i],
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            inputFormatters: [_soloNumeros],
                            // En la tablet no hay Tab: la tecla de acción del
                            // teclado pasa a la casilla siguiente.
                            textInputAction: TextInputAction.next,
                            onSubmitted: (_) {
                              if (i + 1 < bobinas.focos.length) bobinas.focos[i + 1].requestFocus();
                            },
                            decoration: InputDecoration(hintText: 'N.º ${i + 1}'),
                            onChanged: (_) => bobinas._alCambiar(i),
                          ),
                        ),
                        if (bobinas.campos.length > 1)
                          IconButton(
                            tooltip: 'Quitar bobina N.º ${i + 1}',
                            onPressed: () => bobinas._quitar(i),
                            icon: const Icon(Icons.close, color: Colores.peligro, size: 20),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
            if (bobinas.total > 0) ...[
              const SizedBox(height: 8),
              Text('Total: ${bobinas.total.toStringAsFixed(2)} $unidad',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
            ],
          ],
        );
      },
    );
  }
}
