import 'package:flutter_test/flutter_test.dart';
import 'package:zepol_tablet/api/modelos.dart';

void main() {
  group('Usuario.tieneAcceso', () {
    Usuario u(String rol, List<String> restringidos) =>
        Usuario(id: 1, inicial: 'ER', nombre: 'Erasmo', rol: rol, modulosRestringidos: restringidos);

    test('un admin entra a todo, aunque tenga módulos en la lista', () {
      expect(u('admin', [Modulo.registrarEntrega]).tieneAcceso(Modulo.registrarEntrega), isTrue);
    });

    test('un personal entra a todo salvo lo restringido', () {
      final erasmo = u('personal', ['crear_ot', 'registro_sid']);
      expect(erasmo.tieneAcceso(Modulo.registrarEntrega), isTrue);
      expect(erasmo.tieneAcceso(Modulo.registrarDevolucion), isTrue);
      expect(erasmo.tieneAcceso('registro_sid'), isFalse);
    });

    test('ida y vuelta por JSON (así se guarda la sesión en la tablet)', () {
      final original = u('personal', ['materiales']);
      final copia = Usuario.fromJson(original.toJson());
      expect(copia.inicial, 'ER');
      expect(copia.modulosRestringidos, ['materiales']);
    });
  });

  test('Consumo: números enteros o decimales del JSON y requerido nulo', () {
    final c = Consumo.fromJson({
      'ot_material_id': 10,
      'numero_ot': '1000',
      'cliente': null,
      'proceso': 'Laminación',
      'proceso_id': 1,
      'maquina': 'NORD',
      'maquina_id': 11,
      'diseno': null,
      'material_id': 100,
      'codigo_mp': 'BOPP20620',
      'unidad': 'kg',
      'es_tinta': false,
      'usa_bobinas': true,
      'es_materia_prima': false,
      'insumo_de_codigo_mp': null,
      'tiene_materia_prima': true,
      'cantidad_requerida': null,
      'total_entregado': 210,
      'total_devuelto': 30.5,
      'total_ingresado': 0,
      'consumo_neto': 179.5,
      'estado_entrega': 'PARCIAL',
      'estado_sid': 'PENDIENTE',
    });
    expect(c.cantidadRequerida, isNull);
    expect(c.totalEntregado, 210.0);
    expect(c.totalDevuelto, 30.5);
    expect(c.tieneMateriaPrima, isTrue);
  });

  test('Entrega: campos opcionales ausentes toman su valor por defecto', () {
    final e = Entrega.fromJson({
      'id': 1,
      'ot_material_id': 10,
      'numero_ot': '1000',
      'proceso': 'Laminación',
      'proceso_id': 1,
      'maquina': 'NORD',
      'maquina_id': 11,
      'codigo_mp': 'BOPP20620',
      'fecha': '2026-10-21',
      'hora': '14:14:00',
      'bobinas': [50, 50.25],
      'total_entregado': 100.25,
      'total_entregado_pedido': 100.25,
      'material_entregado_id': 100,
      'codigo_mp_entregado': 'BOPP20620',
    });
    expect(e.bobinas, [50.0, 50.25]);
    expect(e.usaBobinas, isTrue);
    expect(e.sidCompletado, isFalse);
    expect(e.totalDevueltoEntrega, 0);
    expect(e.editadoPor, isNull);
  });

  test('Devolucion: un ingreso sin pedido (pendiente) tiene ot_material_id nulo', () {
    final d = Devolucion.fromJson({
      'id': 5,
      'ot_material_id': null,
      'material_id': 102,
      'codigo_mp': 'LDPE-3',
      'unidad': 'kg',
      'fecha': '2026-10-22',
      'hora': '09:00:00',
      'total_devuelto': 150,
      'es_ingreso_produccion': true,
      'numero_ot': '1000',
      'bobinas': [150],
    });
    expect(d.otMaterialId, isNull);
    expect(d.esIngresoProduccion, isTrue);
    expect(d.entregaId, isNull);
  });
}
