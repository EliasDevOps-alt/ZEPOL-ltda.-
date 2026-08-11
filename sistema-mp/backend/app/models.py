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
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


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


class OrdenTrabajo(Base):
    """El cliente es único por OT. El diseño NO vive aquí: cada proceso de la
    OT puede tener su propio diseño (ver OtProceso.diseno)."""

    __tablename__ = "ordenes_trabajo"

    id: Mapped[int] = mapped_column(primary_key=True)
    numero_ot: Mapped[str] = mapped_column(String(30), unique=True)
    cliente: Mapped[Optional[str]] = mapped_column(String(150))
    fecha_creacion: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    activo: Mapped[bool] = mapped_column(Boolean, default=True)

    procesos: Mapped[List["OtProceso"]] = relationship(back_populates="ot")


class OtProceso(Base):
    """Un paso de la OT en un proceso concreto (ej. OT 2121 -> Laminación en NORD,
    diseño "pipocas"). Bajo este mismo paso pueden pedirse varios materiales
    distintos (OtMaterial)."""

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
    diseno: Mapped[Optional[str]] = mapped_column(String(150))
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
    estado_sid_id: Mapped[int] = mapped_column(ForeignKey("estados_sid.id"))
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ot_proceso: Mapped["OtProceso"] = relationship(
        foreign_keys=[ot_proceso_id, proceso_id], back_populates="materiales"
    )
    material: Mapped["Material"] = relationship()
    estado_sid: Mapped["EstadoSid"] = relationship()
    entregas: Mapped[List["Entrega"]] = relationship(back_populates="ot_material")
    devoluciones: Mapped[List["Devolucion"]] = relationship(back_populates="ot_material")


class Entrega(Base):
    """Entrega PARCIAL o total contra un pedido (OtMaterial). Varias entregas
    en fechas distintas pueden apuntar al mismo pedido (hoy 200kg, mañana 300kg)."""

    __tablename__ = "entregas"

    id: Mapped[int] = mapped_column(primary_key=True)
    ot_material_id: Mapped[int] = mapped_column(ForeignKey("ot_materiales.id"))
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    fecha: Mapped[date] = mapped_column(Date)
    hora: Mapped[time] = mapped_column(Time, server_default=func.current_time())
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ot_material: Mapped["OtMaterial"] = relationship(back_populates="entregas")
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
    vino, así que se valida contra el total entregado de ese material."""

    __tablename__ = "devoluciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    ot_material_id: Mapped[int] = mapped_column(ForeignKey("ot_materiales.id"))
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    fecha: Mapped[date] = mapped_column(Date)
    hora: Mapped[time] = mapped_column(Time, server_default=func.current_time())
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ot_material: Mapped["OtMaterial"] = relationship(back_populates="devoluciones")
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
