// Los mismos datos que usa el escritorio (frontend/src/renderer/src/lib/types.ts),
// solo con los campos que la tablet necesita. Si el backend agrega un campo que
// hace falta acá, se suma en los dos lados.

double _num(dynamic v) => v == null ? 0 : (v as num).toDouble();
double? _numONulo(dynamic v) => v == null ? null : (v as num).toDouble();

/// Módulos que se pueden restringir a un usuario "personal" (ver
/// security.MODULOS_RESTRINGIBLES en el backend).
class Modulo {
  static const registrarEntrega = 'registrar_entrega';
  static const registrarDevolucion = 'registrar_devolucion';
}

class Usuario {
  Usuario({
    required this.id,
    required this.inicial,
    required this.nombre,
    required this.rol,
    required this.modulosRestringidos,
  });

  final int id;
  final String inicial;
  final String nombre;
  final String rol;
  final List<String> modulosRestringidos;

  factory Usuario.fromJson(Map<String, dynamic> j) => Usuario(
        id: j['id'] as int,
        inicial: j['inicial'] as String,
        nombre: j['nombre'] as String,
        rol: j['rol'] as String,
        modulosRestringidos: List<String>.from(j['modulos_restringidos'] as List? ?? const []),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'inicial': inicial,
        'nombre': nombre,
        'rol': rol,
        'modulos_restringidos': modulosRestringidos,
      };

  /// Un admin ve todo; un "personal" todo salvo lo que tenga restringido.
  bool tieneAcceso(String modulo) => rol == 'admin' || !modulosRestringidos.contains(modulo);
}

class UsuarioLogin {
  UsuarioLogin(this.inicial, this.nombre);
  final String inicial;
  final String nombre;

  factory UsuarioLogin.fromJson(Map<String, dynamic> j) =>
      UsuarioLogin(j['inicial'] as String, j['nombre'] as String);

  Map<String, dynamic> toJson() => {'inicial': inicial, 'nombre': nombre};
}

class Proceso {
  Proceso(this.id, this.nombre);
  final int id;
  final String nombre;

  factory Proceso.fromJson(Map<String, dynamic> j) => Proceso(j['id'] as int, j['nombre'] as String);
}

class Maquina {
  Maquina(this.id, this.nombre);
  final int id;
  final String nombre;

  factory Maquina.fromJson(Map<String, dynamic> j) => Maquina(j['id'] as int, j['nombre'] as String);
}

class MaterialMp {
  MaterialMp({
    required this.id,
    required this.codigoMp,
    required this.descripcion,
    required this.unidad,
    required this.esTinta,
    required this.usaBobinas,
  });

  final int id;
  final String codigoMp;
  final String? descripcion;
  final String unidad;
  final bool esTinta;
  // Propiedad del material, no se adivina por la unidad (ZIPPER es "mts" y no usa bobinas).
  final bool usaBobinas;

  factory MaterialMp.fromJson(Map<String, dynamic> j) => MaterialMp(
        id: j['id'] as int,
        codigoMp: j['codigo_mp'] as String,
        descripcion: j['descripcion'] as String?,
        unidad: j['unidad'] as String? ?? '',
        esTinta: j['es_tinta'] as bool? ?? false,
        usaBobinas: j['usa_bobinas'] as bool? ?? true,
      );
}

/// Una fila de /consumo: un pedido (OtMaterial) con sus totales.
class Consumo {
  Consumo({
    required this.otMaterialId,
    required this.numeroOt,
    required this.proceso,
    required this.procesoId,
    required this.maquina,
    required this.maquinaId,
    required this.diseno,
    required this.materialId,
    required this.codigoMp,
    required this.unidad,
    required this.esTinta,
    required this.usaBobinas,
    required this.esMateriaPrima,
    required this.insumoDeCodigoMp,
    required this.tieneMateriaPrima,
    required this.cantidadRequerida,
    required this.totalEntregado,
    required this.totalDevuelto,
    required this.totalIngresado,
    required this.estadoEntrega,
    required this.cliente,
    required this.consumoNeto,
    required this.estadoSid,
  });

  final int otMaterialId;
  final String numeroOt;
  final String proceso;
  final int procesoId;
  final String maquina;
  final int maquinaId;
  final String? diseno;
  final int materialId;
  final String codigoMp;
  final String unidad;
  final bool esTinta;
  final bool usaBobinas;
  final bool esMateriaPrima;
  final String? insumoDeCodigoMp;
  final bool tieneMateriaPrima;
  final double? cantidadRequerida;
  final double totalEntregado;
  // Sobrantes que volvieron (no incluye el material fabricado: eso es totalIngresado).
  final double totalDevuelto;
  final double totalIngresado;
  final String estadoEntrega;
  final String? cliente;
  final double consumoNeto;
  final String estadoSid;

  factory Consumo.fromJson(Map<String, dynamic> j) => Consumo(
        otMaterialId: j['ot_material_id'] as int,
        numeroOt: j['numero_ot'] as String,
        proceso: j['proceso'] as String,
        procesoId: j['proceso_id'] as int,
        maquina: j['maquina'] as String,
        maquinaId: j['maquina_id'] as int,
        diseno: j['diseno'] as String?,
        materialId: j['material_id'] as int,
        codigoMp: j['codigo_mp'] as String,
        unidad: j['unidad'] as String? ?? '',
        esTinta: j['es_tinta'] as bool? ?? false,
        usaBobinas: j['usa_bobinas'] as bool? ?? true,
        esMateriaPrima: j['es_materia_prima'] as bool? ?? false,
        insumoDeCodigoMp: j['insumo_de_codigo_mp'] as String?,
        tieneMateriaPrima: j['tiene_materia_prima'] as bool? ?? false,
        cantidadRequerida: _numONulo(j['cantidad_requerida']),
        totalEntregado: _num(j['total_entregado']),
        totalDevuelto: _num(j['total_devuelto']),
        totalIngresado: _num(j['total_ingresado']),
        estadoEntrega: j['estado_entrega'] as String,
        cliente: j['cliente'] as String?,
        consumoNeto: _num(j['consumo_neto']),
        estadoSid: j['estado_sid'] as String? ?? '',
      );
}

class Entrega {
  Entrega({
    required this.id,
    required this.otMaterialId,
    required this.numeroOt,
    required this.proceso,
    required this.procesoId,
    required this.maquina,
    required this.maquinaId,
    required this.codigoMp,
    required this.unidad,
    required this.fecha,
    required this.hora,
    required this.bobinas,
    required this.totalEntregado,
    required this.cantidadRequerida,
    required this.totalEntregadoPedido,
    required this.materialEntregadoId,
    required this.codigoMpEntregado,
    required this.usaBobinas,
    required this.observacion,
    required this.pedidoCreado,
    required this.totalDevueltoEntrega,
    required this.usuario,
    required this.sidCompletado,
    this.sidCompletadoEn,
    required this.editadoPor,
    required this.editadoEn,
  });

  final int id;
  final int otMaterialId;
  final String numeroOt;
  final String proceso;
  final int procesoId;
  final String maquina;
  final int maquinaId;
  final String codigoMp;
  final String unidad;
  final String fecha;
  final String hora;
  final List<double> bobinas;
  final double totalEntregado;
  final double? cantidadRequerida;
  final double totalEntregadoPedido;
  final int materialEntregadoId;
  final String codigoMpEntregado;
  final bool usaBobinas;
  final String? observacion;
  final bool pedidoCreado;
  // Sobrantes ya devueltos indicando que son de ESTA entrega.
  final double totalDevueltoEntrega;
  final String usuario;
  // Con el SID ya registrado no se puede corregir ni borrar.
  final bool sidCompletado;
  // Cuándo se registró el SID; null en los marcados antes de que se guardara la fecha.
  final String? sidCompletadoEn;
  final String? editadoPor;
  final String? editadoEn;

  factory Entrega.fromJson(Map<String, dynamic> j) => Entrega(
        id: j['id'] as int,
        otMaterialId: j['ot_material_id'] as int,
        numeroOt: j['numero_ot'] as String,
        proceso: j['proceso'] as String,
        procesoId: j['proceso_id'] as int,
        maquina: j['maquina'] as String,
        maquinaId: j['maquina_id'] as int,
        codigoMp: j['codigo_mp'] as String,
        unidad: j['unidad'] as String? ?? '',
        fecha: j['fecha'] as String,
        hora: j['hora'] as String,
        bobinas: (j['bobinas'] as List? ?? const []).map(_num).toList(),
        totalEntregado: _num(j['total_entregado']),
        cantidadRequerida: _numONulo(j['cantidad_requerida']),
        totalEntregadoPedido: _num(j['total_entregado_pedido']),
        materialEntregadoId: j['material_entregado_id'] as int,
        codigoMpEntregado: j['codigo_mp_entregado'] as String,
        usaBobinas: j['usa_bobinas'] as bool? ?? true,
        observacion: j['observacion'] as String?,
        pedidoCreado: j['pedido_creado'] as bool? ?? false,
        totalDevueltoEntrega: _num(j['total_devuelto_entrega']),
        usuario: j['usuario'] as String? ?? '',
        sidCompletado: j['sid_completado'] as bool? ?? false,
        sidCompletadoEn: j['sid_completado_en'] as String?,
        editadoPor: j['editado_por'] as String?,
        editadoEn: j['editado_en'] as String?,
      );
}

/// Material de la OT que vino del Excel sin proceso ni máquina todavía.
class Pendiente {
  Pendiente({
    required this.id,
    required this.codigoMp,
    required this.materialId,
    required this.cantidadRequerida,
    required this.esTinta,
    required this.materiasPrimas,
    required this.totalIngresado,
    required this.origenLibre,
  });

  final int id;
  final String codigoMp;
  final int? materialId;
  final double? cantidadRequerida;
  final bool esTinta;
  final List<String> materiasPrimas;
  // Cuánto ya entró a almacén fabricado, sin pedido todavía.
  final double totalIngresado;
  // Creado desde "Registrar ingreso": no se ofrece para asignar en Registrar Entrega.
  final bool origenLibre;

  factory Pendiente.fromJson(Map<String, dynamic> j) => Pendiente(
        id: j['id'] as int,
        codigoMp: j['codigo_mp'] as String,
        materialId: j['material_id'] as int?,
        cantidadRequerida: _numONulo(j['cantidad_requerida']),
        esTinta: j['es_tinta'] as bool? ?? false,
        materiasPrimas: List<String>.from(j['materias_primas'] as List? ?? const []),
        totalIngresado: _num(j['total_ingresado']),
        origenLibre: j['origen_libre'] as bool? ?? false,
      );
}

class OrdenTrabajo {
  OrdenTrabajo(this.id, this.numeroOt, this.cliente, this.diseno, this.fechaCreacion);
  final int id;
  final String numeroOt;
  final String? cliente;
  final String? diseno;
  final String fechaCreacion;

  factory OrdenTrabajo.fromJson(Map<String, dynamic> j) => OrdenTrabajo(
        j['id'] as int,
        j['numero_ot'] as String,
        j['cliente'] as String?,
        j['diseno'] as String?,
        j['fecha_creacion'] as String,
      );
}

/// Solo lo que se muestra para reconocer la OT: cliente y descripción del producto.
class OtEncabezado {
  OtEncabezado(this.cliente, this.descripcionProducto);
  final String? cliente;
  final String? descripcionProducto;

  factory OtEncabezado.fromJson(Map<String, dynamic> j) =>
      OtEncabezado(j['cliente'] as String?, j['descripcion_producto'] as String?);
}

/// Cuánto se entregó y devolvió de UN material contra un pedido (un pedido
/// puede tener entregas de más de un material si hubo una sustitución).
class BalanceMaterial {
  BalanceMaterial({
    required this.materialId,
    required this.codigoMp,
    required this.unidad,
    required this.usaBobinas,
    required this.disponible,
  });

  final int materialId;
  final String codigoMp;
  final String unidad;
  final bool usaBobinas;
  final double disponible;

  factory BalanceMaterial.fromJson(Map<String, dynamic> j) => BalanceMaterial(
        materialId: j['material_id'] as int,
        codigoMp: j['codigo_mp'] as String,
        unidad: j['unidad'] as String? ?? '',
        usaBobinas: j['usa_bobinas'] as bool? ?? true,
        disponible: _num(j['disponible']),
      );
}

class Devolucion {
  Devolucion({
    required this.id,
    required this.codigoMp,
    required this.unidad,
    required this.hora,
    required this.totalDevuelto,
    required this.esIngresoProduccion,
    required this.entregaHora,
    required this.otMaterialId,
    required this.materialId,
    required this.fecha,
    required this.sidCompletado,
    required this.entregaId,
    required this.cliente,
    required this.numeroOt,
    required this.usuario,
    required this.bobinas,
    required this.usaBobinas,
    required this.entregaFecha,
    required this.editadoPor,
    required this.editadoEn,
  });

  final int id;
  final String codigoMp;
  final String unidad;
  final String hora;
  final double totalDevuelto;
  // true = material fabricado en la OT que entra a almacén (no un sobrante).
  final bool esIngresoProduccion;
  // Hora de la entrega de la que es el sobrante (null = del pedido en general).
  final String? entregaHora;
  // null = ingreso de un material todavía sin pedido (pendiente).
  final int? otMaterialId;
  final int materialId;
  final String fecha;
  final bool sidCompletado;
  final int? entregaId;
  final String? cliente;
  final String numeroOt;
  final String usuario;
  final List<double> bobinas;
  final bool usaBobinas;
  final String? entregaFecha;
  final String? editadoPor;
  final String? editadoEn;

  factory Devolucion.fromJson(Map<String, dynamic> j) => Devolucion(
        id: j['id'] as int,
        codigoMp: j['codigo_mp'] as String,
        unidad: j['unidad'] as String? ?? '',
        hora: j['hora'] as String? ?? '',
        totalDevuelto: _num(j['total_devuelto']),
        esIngresoProduccion: j['es_ingreso_produccion'] as bool? ?? false,
        entregaHora: j['entrega_hora'] as String?,
        otMaterialId: j['ot_material_id'] as int?,
        materialId: j['material_id'] as int,
        fecha: j['fecha'] as String,
        sidCompletado: j['sid_completado'] as bool? ?? false,
        entregaId: j['entrega_id'] as int?,
        cliente: j['cliente'] as String?,
        numeroOt: j['numero_ot'] as String? ?? '',
        usuario: j['usuario'] as String? ?? '',
        bobinas: (j['bobinas'] as List? ?? const []).map(_num).toList(),
        usaBobinas: j['usa_bobinas'] as bool? ?? true,
        entregaFecha: j['entrega_fecha'] as String?,
        editadoPor: j['editado_por'] as String?,
        editadoEn: j['editado_en'] as String?,
      );
}
