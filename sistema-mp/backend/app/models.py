from __future__ import annotations

from datetime import date, datetime, time
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Usuario(Base):
    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    inicial: Mapped[str] = mapped_column(String(5), unique=True)
    nombre: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[Optional[str]] = mapped_column(String(255))
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    # 'admin' ve y usa todo, sin excepción. 'personal' arranca con acceso a
    # todos los módulos también — se restringe puntualmente vía
    # modulos_restringidos, nunca al revés.
    rol: Mapped[str] = mapped_column(String(10), default="personal")
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    modulos_restringidos: Mapped[List["UsuarioModuloRestringido"]] = relationship(
        back_populates="usuario", cascade="all, delete-orphan"
    )


class UsuarioModuloRestringido(Base):
    """Una fila = ese módulo está bloqueado para ese usuario 'personal'. Sin
    filas = acceso a todo. No tiene efecto sobre usuarios 'admin' (ver
    security.requiere_modulo, que ignora esta tabla para ese rol)."""

    __tablename__ = "usuario_modulos_restringidos"

    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), primary_key=True)
    modulo: Mapped[str] = mapped_column(String(30), primary_key=True)

    usuario: Mapped["Usuario"] = relationship(back_populates="modulos_restringidos")


class Proceso(Base):
    __tablename__ = "procesos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(50), unique=True)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)

    maquinas: Mapped[List["Maquina"]] = relationship(back_populates="proceso")


class Maquina(Base):
    __tablename__ = "maquinas"
    __table_args__ = (
        UniqueConstraint("nombre", "proceso_id"),
        # (id, proceso_id) queda disponible como llave única para que
        # OtProceso pueda referenciar "esta máquina Y su proceso" en una FK compuesta.
        UniqueConstraint("id", "proceso_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(50))
    proceso_id: Mapped[int] = mapped_column(ForeignKey("procesos.id"))
    activo: Mapped[bool] = mapped_column(Boolean, default=True)

    proceso: Mapped["Proceso"] = relationship(back_populates="maquinas")


class EstadoSid(Base):
    __tablename__ = "estados_sid"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(20), unique=True)


class Material(Base):
    __tablename__ = "materiales"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo_mp: Mapped[str] = mapped_column(String(50), unique=True)
    descripcion: Mapped[Optional[str]] = mapped_column(String(255))
    unidad: Mapped[str] = mapped_column(String(10))
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    # Cargos de tinta (Laminación, FLaminación, Superficie): aparecen como
    # "material" en el Excel OC-MP pero no son materia prima física, así que
    # Registrar Entrega/Devolución los excluyen de la lista de pedidos.
    es_tinta: Mapped[bool] = mapped_column(Boolean, default=False)
    # Si el material se entrega/devuelve como varias bobinas con su propio
    # peso cada una (el caso más común: kg de film/rollo) o como un solo
    # campo de cantidad total. No se deriva de la unidad (ej. ZIPPER es en
    # "mts" pero NO se maneja en bobinas) — es una propiedad del material,
    # decidida al crearlo, porque la unidad sola no alcanza para saberlo.
    usa_bobinas: Mapped[bool] = mapped_column(Boolean, default=True)


class Configuracion(Base):
    """Ajustes editables desde la app (no desde .env), como la ruta del
    Excel 'OC-MP' que el jefe de área puede mover de carpeta por accidente."""

    __tablename__ = "configuracion"

    clave: Mapped[str] = mapped_column(String(50), primary_key=True)
    valor: Mapped[Optional[str]] = mapped_column(Text)


class OrdenTrabajo(Base):
    """El cliente y el diseño son únicos por OT (una OT es un solo pedido de
    un solo cliente para un solo diseño, aunque pase por varios procesos)."""

    __tablename__ = "ordenes_trabajo"

    id: Mapped[int] = mapped_column(primary_key=True)
    numero_ot: Mapped[str] = mapped_column(String(30), unique=True)
    cliente: Mapped[Optional[str]] = mapped_column(String(150))
    diseno: Mapped[Optional[str]] = mapped_column(String(150))
    fecha_creacion: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    activo: Mapped[bool] = mapped_column(Boolean, default=True)

    # Columnas comerciales espejo de la hoja "oc mp" del Excel OC-MP.
    fecha_seguimiento_mp: Mapped[Optional[date]] = mapped_column(Date)
    alm: Mapped[Optional[str]] = mapped_column(String(20))
    so: Mapped[Optional[str]] = mapped_column(String(20))
    tipo_trabajo: Mapped[Optional[str]] = mapped_column(String(20))
    indicador: Mapped[Optional[str]] = mapped_column(String(20))
    status_entrega_mp: Mapped[Optional[str]] = mapped_column(String(50))
    vendedor: Mapped[Optional[str]] = mapped_column(String(100))
    ciudad: Mapped[Optional[str]] = mapped_column(String(100))
    fecha_pedido: Mapped[Optional[date]] = mapped_column(Date)
    fecha_entrega: Mapped[Optional[date]] = mapped_column(Date)
    descripcion_producto: Mapped[Optional[str]] = mapped_column(String(255))
    codigo_producto: Mapped[Optional[str]] = mapped_column(String(50))
    total_ot: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    entrega_mes: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    medida: Mapped[Optional[str]] = mapped_column(String(20))
    equivalencia_kg: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    pu_usd: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    pt_usd: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    factura_clises: Mapped[Optional[str]] = mapped_column(String(10))
    precio_clise_usd: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    precio_total_pedido_usd: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))

    # Escritura hacia el Excel OC-MP — ver app/services/excel_oc_mp.py,
    # escribir_oc_mp. Default TRUE a propósito: cubre OTs previas a este
    # feature y las importadas desde Excel, que nunca disparan una
    # escritura. Solo se pone FALSE cuando una OT creada nativamente no se
    # pudo escribir en el Excel (archivo bloqueado, más de 6 materiales...).
    sincronizado_excel: Mapped[bool] = mapped_column(Boolean, default=True)
    excel_sync_error: Mapped[Optional[str]] = mapped_column(Text)

    procesos: Mapped[List["OtProceso"]] = relationship(back_populates="ot")
    pendientes: Mapped[List["OtMaterialPendiente"]] = relationship(back_populates="ot")


class OtProceso(Base):
    """Un paso de la OT en un proceso concreto (ej. OT 2121 -> Laminación en NORD).
    Bajo este mismo paso pueden pedirse varios materiales distintos (OtMaterial)."""

    __tablename__ = "ot_procesos"
    __table_args__ = (
        ForeignKeyConstraint(["maquina_id", "proceso_id"], ["maquinas.id", "maquinas.proceso_id"]),
        UniqueConstraint("ot_id", "proceso_id", "maquina_id"),
        UniqueConstraint("id", "proceso_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    ot_id: Mapped[int] = mapped_column(ForeignKey("ordenes_trabajo.id"))
    proceso_id: Mapped[int] = mapped_column(ForeignKey("procesos.id"))
    # sin ForeignKey aquí: la FK real es la compuesta (maquina_id, proceso_id)
    # declarada en __table_args__, que además obliga a que la máquina
    # pertenezca al proceso elegido.
    maquina_id: Mapped[int] = mapped_column()
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ot: Mapped["OrdenTrabajo"] = relationship(back_populates="procesos")
    proceso: Mapped["Proceso"] = relationship()
    maquina: Mapped["Maquina"] = relationship()
    materiales: Mapped[List["OtMaterial"]] = relationship(
        back_populates="ot_proceso", foreign_keys="OtMaterial.ot_proceso_id"
    )


class OtMaterial(Base):
    """El pedido real: dentro de un paso de OT, cada material solicitado tiene
    su propia cantidad requerida (OT 2121 en Laminación pide 500kg de PA15520
    Y por separado 200kg de PA15V). Entregas y devoluciones cuelgan de aquí."""

    __tablename__ = "ot_materiales"
    __table_args__ = (
        ForeignKeyConstraint(["ot_proceso_id", "proceso_id"], ["ot_procesos.id", "ot_procesos.proceso_id"]),
        UniqueConstraint("ot_proceso_id", "material_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # sin ForeignKey aquí: la FK real es la compuesta (ot_proceso_id, proceso_id)
    # declarada en __table_args__, que obliga a que el proceso coincida con
    # el del paso de OT elegido.
    ot_proceso_id: Mapped[int] = mapped_column()
    proceso_id: Mapped[int] = mapped_column(ForeignKey("procesos.id"))
    material_id: Mapped[int] = mapped_column(ForeignKey("materiales.id"))
    cantidad_requerida: Mapped[Optional[float]] = mapped_column(Numeric(10, 2))
    estado_sid_id: Mapped[int] = mapped_column(ForeignKey("estados_sid.id"))  # estado del SID de la ENTREGA
    # El SID de la devolución es un trámite independiente del de la entrega,
    # por eso es un campo aparte en vez de reutilizar estados_sid.
    sid_devolucion_completado: Mapped[bool] = mapped_column(Boolean, default=False)
    # Si este pedido es una materia prima que hizo falta para completar OTRO
    # pedido de la misma OT — apunta a ese pedido (los de LDPE-1 y LDPE-2
    # apuntan al de LDPE-4, que se fabrica combinándolos). NULL = pedido
    # normal. Cada materia prima tiene su propio proceso y máquina, que no
    # tienen por qué coincidir con los del pedido que completa: se consume
    # donde se fabrica (Extrusión), no donde se usa el resultado (Laminación).
    # No es exclusivo de Extrusión — cualquier pedido de cualquier proceso
    # puede necesitar materiales extra que la OT no listó.
    insumo_de_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ot_materiales.id"))
    # Igual que insumo_de_id, pero cuando el material que se completa todavía
    # es un pendiente (sin proceso ni máquina asignados). Pasa a menudo: la
    # materia prima sale de almacén hoy para fabricarlo, y recién se sabe a qué
    # proceso irá el resultado cuando producción lo devuelva. Al promover el
    # pendiente estas filas se repuntan a insumo_de_id — ver promover_pendiente.
    insumo_de_pendiente_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("ot_materiales_pendientes.id")
    )
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ot_proceso: Mapped["OtProceso"] = relationship(
        foreign_keys=[ot_proceso_id, proceso_id], back_populates="materiales"
    )
    material: Mapped["Material"] = relationship()
    estado_sid: Mapped["EstadoSid"] = relationship()
    entregas: Mapped[List["Entrega"]] = relationship(back_populates="ot_material")
    devoluciones: Mapped[List["Devolucion"]] = relationship(back_populates="ot_material")
    insumo_de: Mapped[Optional["OtMaterial"]] = relationship(
        remote_side=[id], foreign_keys=[insumo_de_id], back_populates="insumos"
    )
    insumos: Mapped[List["OtMaterial"]] = relationship(
        foreign_keys=[insumo_de_id], back_populates="insumo_de"
    )
    insumo_de_pendiente: Mapped[Optional["OtMaterialPendiente"]] = relationship(
        foreign_keys=[insumo_de_pendiente_id], back_populates="materias_primas"
    )


class OtMaterialPendiente(Base):
    """Material importado desde el Excel OC-MP que todavía no tiene proceso
    ni máquina (la hoja 'oc mp' no los maneja) — queda pendiente hasta que
    se completa en Registrar Entrega (ver ordenes_controller.promover_pendiente),
    momento en el que se crea el OtProceso/OtMaterial real y esta fila se borra."""

    __tablename__ = "ot_materiales_pendientes"

    id: Mapped[int] = mapped_column(primary_key=True)
    ot_id: Mapped[int] = mapped_column(ForeignKey("ordenes_trabajo.id"))
    codigo_mp: Mapped[str] = mapped_column(String(50))
    material_id: Mapped[Optional[int]] = mapped_column(ForeignKey("materiales.id"))
    cantidad_requerida: Mapped[Optional[float]] = mapped_column(Numeric(10, 2))
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ot: Mapped["OrdenTrabajo"] = relationship(back_populates="pendientes")
    material: Mapped[Optional["Material"]] = relationship()
    # Materia prima ya entregada para fabricar este material, antes de que el
    # pendiente tenga proceso asignado.
    materias_primas: Mapped[List["OtMaterial"]] = relationship(
        foreign_keys="OtMaterial.insumo_de_pendiente_id", back_populates="insumo_de_pendiente"
    )
    # Material fabricado que ya entró a almacén sin que este pendiente tenga
    # pedido todavía. Al promoverlo, estas devoluciones se repuntan al pedido.
    ingresos: Mapped[List["Devolucion"]] = relationship(back_populates="ot_material_pendiente")


class Entrega(Base):
    """Entrega PARCIAL o total contra un pedido (OtMaterial). Varias entregas
    en fechas distintas pueden apuntar al mismo pedido (hoy 200kg, mañana 300kg)."""

    __tablename__ = "entregas"

    id: Mapped[int] = mapped_column(primary_key=True)
    ot_material_id: Mapped[int] = mapped_column(ForeignKey("ot_materiales.id"))
    # Material REALMENTE entregado. Normalmente igual a ot_material.material_id,
    # pero puede diferir cuando almacén da una alternativa (otro micronaje/ancho)
    # o un cambio de estructura por falta de stock del material pedido.
    material_id: Mapped[int] = mapped_column(ForeignKey("materiales.id"))
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    fecha: Mapped[date] = mapped_column(Date)
    hora: Mapped[time] = mapped_column(Time, server_default=func.current_time())
    observacion: Mapped[Optional[str]] = mapped_column(Text)
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ot_material: Mapped["OtMaterial"] = relationship(back_populates="entregas")
    material: Mapped["Material"] = relationship()
    usuario: Mapped["Usuario"] = relationship()
    bobinas: Mapped[List["EntregaBobina"]] = relationship(back_populates="entrega", cascade="all, delete-orphan")


class EntregaBobina(Base):
    """Peso por bobina. Sin columna de unidad a propósito: la unidad siempre
    es la del material (Material.unidad), así se elimina el riesgo de
    "entregué en kg pero cargaron en mts"."""

    __tablename__ = "entrega_bobinas"
    __table_args__ = (UniqueConstraint("entrega_id", "numero"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    entrega_id: Mapped[int] = mapped_column(ForeignKey("entregas.id", ondelete="CASCADE"))
    numero: Mapped[int]
    cantidad: Mapped[float] = mapped_column(Numeric(10, 3))

    entrega: Mapped["Entrega"] = relationship(back_populates="bobinas")


class Devolucion(Base):
    """Cuelga del PEDIDO (OtMaterial), no de una entrega puntual: una vez que
    el material está en planta ya no se distingue de qué entrega parcial
    vino, así que se valida contra el total entregado de ese material. Un
    pedido puede tener entregas de más de un material si hubo una
    sustitución (ver Entrega.material_id) — material_id acá indica de cuál
    de esos materiales se está devolviendo, y el saldo disponible se calcula
    por material, no por pedido en conjunto."""

    __tablename__ = "devoluciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Uno de los dos, nunca ambos. El pendiente aparece cuando entra a almacén
    # un material que todavía no tiene pedido: para tenerlo haría falta un
    # proceso y una máquina, y almacén no tiene máquinas — eso se decide recién
    # cuando el material SALE hacia producción (ver promover_pendiente, que
    # repunta estas filas al pedido cuando eso pasa).
    ot_material_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ot_materiales.id"))
    ot_material_pendiente_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("ot_materiales_pendientes.id")
    )
    material_id: Mapped[int] = mapped_column(ForeignKey("materiales.id"))
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    # TRUE cuando lo que entra a almacén es material FABRICADO en esta OT
    # (ej. el LDPE-4 que salió de mezclar LDPE-1 y LDPE-2), no un sobrante sin
    # usar que vuelve de planta. Los dos son producción -> almacén y por eso
    # comparten tabla y pantalla, pero solo el sobrante descuenta del consumo
    # neto: el material fabricado nunca se había entregado. Ver vista_consumo
    # (total_devuelto vs total_ingresado).
    es_ingreso_produccion: Mapped[bool] = mapped_column(Boolean, default=False)
    fecha: Mapped[date] = mapped_column(Date)
    hora: Mapped[time] = mapped_column(Time, server_default=func.current_time())
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ot_material: Mapped[Optional["OtMaterial"]] = relationship(back_populates="devoluciones")
    ot_material_pendiente: Mapped[Optional["OtMaterialPendiente"]] = relationship(
        back_populates="ingresos"
    )
    material: Mapped["Material"] = relationship()
    usuario: Mapped["Usuario"] = relationship()
    bobinas: Mapped[List["DevolucionBobina"]] = relationship(
        back_populates="devolucion", cascade="all, delete-orphan"
    )


class DevolucionBobina(Base):
    __tablename__ = "devolucion_bobinas"
    __table_args__ = (UniqueConstraint("devolucion_id", "numero"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    devolucion_id: Mapped[int] = mapped_column(ForeignKey("devoluciones.id", ondelete="CASCADE"))
    numero: Mapped[int]
    cantidad: Mapped[float] = mapped_column(Numeric(10, 3))

    devolucion: Mapped["Devolucion"] = relationship(back_populates="bobinas")
