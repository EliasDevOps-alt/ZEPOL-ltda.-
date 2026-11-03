import 'package:flutter_test/flutter_test.dart';
import 'package:zepol_tablet/util/formato.dart';

void main() {
  group('fechas', () {
    test('formatearFecha parte el texto, sin pasar por zonas horarias', () {
      expect(formatearFecha('2026-10-29'), '29/10/2026');
      expect(formatearFecha('basura'), 'basura');
    });

    test('formatearFechaHoraCompleta usa la hora local', () {
      expect(formatearFechaHoraCompleta('2026-10-12T09:28:00'), '12/10/2026 09:28');
    });

    test('horaCorta deja HH:MM', () {
      expect(horaCorta('14:15:35.076'), '14:15');
      expect(horaCorta('9:0'), '9:0');
    });

    test('hoyIso es la fecha local de hoy (no UTC)', () {
      final d = DateTime.now();
      expect(hoyIso(), '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}');
    });
  });

  group('números', () {
    test('redondearPeso evita los decimales sueltos de las sumas', () {
      expect(redondearPeso(0.1 + 0.2), 0.3);
      expect(redondearPeso(22.880000000000003), 22.88);
    });

    test('numero no muestra ".0" de más', () {
      expect(numero(100), '100');
      expect(numero(22.880000000000003), '22.88');
      expect(numero(0.5), '0.5');
    });

    test('leerNumero acepta coma decimal del teclado de Android', () {
      expect(leerNumero('12,5'), 12.5);
      expect(leerNumero(' 7 '), 7);
      expect(leerNumero('abc'), isNull);
      expect(leerNumero(''), isNull);
    });
  });

  group('letras (A), (B)…', () {
    test('solo los materiales con 2+ entregas, en orden de fecha, hora e id', () {
      final letras = letrasDeEntregas([
        (id: 2, numeroOt: '1', codigo: 'PA15520', fecha: '2026-10-02', hora: '09:00:00'),
        (id: 1, numeroOt: '1', codigo: 'PA15520', fecha: '2026-10-01', hora: '16:00:00'),
        (id: 3, numeroOt: '1', codigo: 'BOPP20520', fecha: '2026-10-01', hora: '11:00:00'),
      ]);
      expect(letras, {1: 'A', 2: 'B'});
    });

    test('se agrupa por OT y el código no distingue mayúsculas ni espacios', () {
      final letras = letrasDeEntregas([
        (id: 1, numeroOt: '1', codigo: 'ldpe-3 ', fecha: '2026-10-01', hora: '10:00:00'),
        (id: 2, numeroOt: '1', codigo: 'LDPE-3', fecha: '2026-10-01', hora: '11:00:00'),
        (id: 3, numeroOt: '2', codigo: 'LDPE-3', fecha: '2026-10-01', hora: '12:00:00'),
      ]);
      expect(letras, {1: 'A', 2: 'B'});
    });

    test('misma fecha y hora: desempata el id', () {
      final letras = letrasDeEntregas([
        (id: 9, numeroOt: '1', codigo: 'X', fecha: '2026-10-01', hora: '10:00:00'),
        (id: 4, numeroOt: '1', codigo: 'X', fecha: '2026-10-01', hora: '10:00:00'),
      ]);
      expect(letras, {4: 'A', 9: 'B'});
    });

    test('después de la Z sigue AA, como las columnas de una planilla', () {
      final entregas = [
        for (var i = 0; i < 28; i++)
          (id: i, numeroOt: '1', codigo: 'X', fecha: '2026-10-01', hora: '10:${i.toString().padLeft(2, '0')}:00'),
      ];
      final letras = letrasDeEntregas(entregas);
      expect(letras[25], 'Z');
      expect(letras[26], 'AA');
      expect(letras[27], 'AB');
    });
  });
}
