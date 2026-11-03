import 'package:flutter_test/flutter_test.dart';
import 'package:zepol_tablet/widgets/campo_cantidad.dart';

void main() {
  test('arranca con una casilla vacía y sin pesos', () {
    final b = Bobinas();
    expect(b.campos, hasLength(1));
    expect(b.pesos, isEmpty);
    expect(b.hayInvalido, isFalse);
    expect(b.total, 0);
  });

  test('las casillas vacías no cuentan y la coma decimal se acepta', () {
    final b = Bobinas.desde([50.5, 60]);
    expect(b.campos.map((c) => c.text), ['50.5', '60', '']);
    b.campos.last.text = '';
    b.campos.first.text = '50,5';
    expect(b.pesos, [50.5, 60]);
    expect(b.total, 110.5);
  });

  test('un texto que no es un número mayor a 0 es inválido; vacío no', () {
    final b = Bobinas.desde([10]);
    b.campos.first.text = '0';
    expect(b.hayInvalido, isTrue);
    b.campos.first.text = 'abc';
    expect(b.hayInvalido, isTrue);
    b.campos.first.text = '';
    expect(b.hayInvalido, isFalse);
  });

  test('el total se redondea como un peso', () {
    final b = Bobinas.desde([0.1, 0.2]);
    expect(b.total, 0.3);
  });

  test('limpiar deja una sola casilla vacía y avisa a la pantalla', () {
    final b = Bobinas.desde([1, 2, 3]);
    var avisos = 0;
    b.addListener(() => avisos++);
    b.limpiar();
    expect(b.campos, hasLength(1));
    expect(b.campos.first.text, '');
    expect(avisos, 1);
  });
}
