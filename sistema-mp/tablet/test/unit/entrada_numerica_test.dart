// Un peso solo puede tener UN separador decimal: "66.33.66" y "2..2" no se pueden escribir.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zepol_tablet/widgets/campo_cantidad.dart';

TextEditingValue v(String t) => TextEditingValue(text: t, selection: TextSelection.collapsed(offset: t.length));

/// Escribe de a un carácter, como el teclado, y devuelve cómo queda el campo.
String escribir(String teclas, {String inicial = ''}) {
  const f = SoloUnDecimal();
  var actual = v(inicial);
  for (final c in teclas.split('')) {
    actual = f.formatEditUpdate(actual, v(actual.text + c));
  }
  return actual.text;
}

void main() {
  group('teclado', () {
    test('1. un número con punto decimal se escribe normal', () => expect(escribir('55.99'), '55.99'));
    test('2. con coma decimal también (teclado de Android)', () => expect(escribir('55,99'), '55,99'));
    test('3. un entero', () => expect(escribir('120'), '120'));
    test('4. el segundo punto no entra: 66.33.66 queda 66.3366', () => expect(escribir('66.33.66'), '66.3366'));
    test('5. dos puntos seguidos no entran: 2..2 queda 2.2', () => expect(escribir('2..2'), '2.2'));
    test('6. 2.56.2 queda 2.562', () => expect(escribir('2.56.2'), '2.562'));
    test('7. punto y después coma tampoco: 2.5,3 queda 2.53', () => expect(escribir('2.5,3'), '2.53'));
    test('8. letras y símbolos no entran', () => expect(escribir('1a2b-3 4'), '1234'));
    test('9. se puede empezar con el separador: .5', () => expect(escribir('.5'), '.5'));
    test('10. borrar siempre se puede', () {
      const f = SoloUnDecimal();
      expect(f.formatEditUpdate(v('12.5'), v('12.')).text, '12.');
      expect(f.formatEditUpdate(v('12.'), v('12')).text, '12');
      expect(f.formatEditUpdate(v('12'), v('')).text, '');
    });
  });

  group('pegar', () {
    const f = SoloUnDecimal();
    test('11. pegar "66.33.66" se rechaza entero y el campo queda como estaba', () {
      expect(f.formatEditUpdate(v('5'), v('566.33.66')).text, '5');
    });
    test('12. pegar "12.5" se acepta', () => expect(f.formatEditUpdate(v(''), v('12.5')).text, '12.5'));
    test('13. pegar un texto con letras se rechaza', () => expect(f.formatEditUpdate(v(''), v('12kg')).text, ''));
    test('14. pegar sobre una selección que ya tiene punto, dejando uno solo, se acepta', () {
      // "1.5" con "1.5" seleccionado y pegado "2.5" → "2.5"
      expect(f.formatEditUpdate(v('1.5'), v('2.5')).text, '2.5');
    });
  });

  group('en el campo de la pantalla', () {
    Future<Bobinas> montar(WidgetTester tester, {bool usaBobinas = true}) async {
      final b = Bobinas();
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: SingleChildScrollView(child: CampoCantidad(bobinas: b, unidad: 'kg', usaBobinas: usaBobinas))),
      ));
      return b;
    }

    testWidgets('15. escribir "66.33.66" en una bobina deja un número válido, no un texto roto', (tester) async {
      final b = await montar(tester);
      tester.testTextInput.register();
      await tester.tap(find.byType(TextField).first);
      await tester.pump();
      await tester.enterText(find.byType(TextField).first, '66.33.66');
      await tester.pump();
      expect(b.campos.first.text, isNot('66.33.66'));
      expect(b.hayInvalido, isFalse);
    });

    testWidgets('16. "2..2" tampoco se acepta en la bobina', (tester) async {
      final b = await montar(tester);
      await tester.enterText(find.byType(TextField).first, '2..2');
      await tester.pump();
      expect(b.campos.first.text, isNot('2..2'));
      expect(b.hayInvalido, isFalse);
    });

    testWidgets('17. lo mismo en la cantidad simple (material sin bobinas)', (tester) async {
      final b = await montar(tester, usaBobinas: false);
      await tester.enterText(find.byType(TextField).first, '2.56.2');
      await tester.pump();
      expect(b.campos.first.text, isNot('2.56.2'));
      expect(b.hayInvalido, isFalse);
    });

    testWidgets('18. un peso normal sigue sumando bien', (tester) async {
      final b = await montar(tester);
      await tester.enterText(find.byType(TextField).first, '55.99');
      await tester.pump();
      expect(b.total, 55.99);
    });
  });
}
