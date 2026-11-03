// Fechas y números con las mismas reglas que el escritorio (lib/fechas.ts,
// lib/utils.ts, lib/letrasEntrega.ts).

/// Hoy en hora LOCAL de la tablet (YYYY-MM-DD). Nunca pasar por UTC: de 20:00
/// a 23:59 en La Paz daría el día siguiente (bug real del escritorio).
String hoyIso() {
  final d = DateTime.now();
  return '${d.year}-${_dos(d.month)}-${_dos(d.day)}';
}

String _dos(int n) => n.toString().padLeft(2, '0');

/// 'YYYY-MM-DD' → 'DD/MM/YYYY', partiendo el texto (sin convertir zonas).
String formatearFecha(String iso) {
  final p = iso.split('-');
  return p.length == 3 ? '${p[2]}/${p[1]}/${p[0]}' : iso;
}

/// Timestamp completo (fecha_creacion) → 'DD/MM/YYYY HH:MM' en hora local.
String formatearFechaHoraCompleta(String datetime) {
  final d = DateTime.tryParse(datetime);
  if (d == null) return datetime;
  return '${_dos(d.day)}/${_dos(d.month)}/${d.year} ${_dos(d.hour)}:${_dos(d.minute)}';
}

String horaCorta(String hora) => hora.length >= 5 ? hora.substring(0, 5) : hora;

/// Redondeo a 3 decimales para sumas de pesos (evita 22.880000000000003).
double redondearPeso(double n) => (n * 1000).round() / 1000;

/// Número para mostrar: sin ".0" de más.
String numero(double n) {
  final r = redondearPeso(n);
  return r == r.roundToDouble() ? r.toInt().toString() : r.toString();
}

/// Lee lo que escribió el operador: el teclado de Android puede poner coma decimal.
double? leerNumero(String texto) => double.tryParse(texto.trim().replaceAll(',', '.'));

/// A, B, … Z, AA, AB … (como las columnas de una planilla).
String _letraDeIndice(int indice) {
  var n = indice;
  var letra = '';
  do {
    letra = String.fromCharCode(65 + (n % 26)) + letra;
    n = n ~/ 26 - 1;
  } while (n >= 0);
  return letra;
}

/// id de entrega → su letra (A), (B)… cuando una OT tiene 2+ entregas del
/// mismo material realmente entregado. Mismo orden que el escritorio
/// (fecha, hora, id), así la letra de una entrega es la misma en las dos apps.
Map<int, String> letrasDeEntregas(Iterable<({int id, String numeroOt, String codigo, String fecha, String hora})> entregas) {
  final grupos = <String, List<({int id, String numeroOt, String codigo, String fecha, String hora})>>{};
  for (final e in entregas) {
    grupos.putIfAbsent('${e.numeroOt}|${e.codigo.trim().toLowerCase()}', () => []).add(e);
  }
  final letras = <int, String>{};
  for (final grupo in grupos.values) {
    if (grupo.length < 2) continue;
    grupo.sort((a, b) {
      final f = a.fecha.compareTo(b.fecha);
      if (f != 0) return f;
      final h = a.hora.compareTo(b.hora);
      return h != 0 ? h : a.id - b.id;
    });
    for (var i = 0; i < grupo.length; i++) {
      letras[grupo[i].id] = _letraDeIndice(i);
    }
  }
  return letras;
}
