from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class UsuarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    inicial: str
    nombre: str


class LoginRequest(BaseModel):
    inicial: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario: UsuarioOut


class ProcesoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    nombre: str


class MaquinaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    nombre: str
    proceso_id: int


class MaterialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    codigo_mp: str
    descripcion: Optional[str]
    unidad: str


class EstadoSidOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    nombre: str


class MaterialAdminOut(BaseModel):
    id: int
    codigo_mp: str
    descripcion: Optional[str]
    unidad: str
    activo: bool


class MaterialCreate(BaseModel):
    codigo_mp: str
    descripcion: Optional[str] = None
    unidad: str


class MaterialUpdate(BaseModel):
    codigo_mp: str
    descripcion: Optional[str] = None
    unidad: str
    activo: bool = True


class OrdenTrabajoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    numero_ot: str
    cliente: Optional[str]
    diseno: Optional[str]
    fecha_creacion: datetime


class MaterialPedidoIn(BaseModel):
    material_id: int
    cantidad_requerida: Optional[float] = None


class ProcesoDetalleIn(BaseModel):
    proceso_id: int
    maquina_id: int
    materiales: List[MaterialPedidoIn] = Field(min_length=1)


class OtDetalleCreate(BaseModel):
    """Define (o amplía) la estructura completa de una OT: uno o varios
    procesos (cada uno con su máquina) y los materiales que cada uno pide
    con su cantidad requerida. Cliente y diseño son únicos para toda la OT.
    No registra ninguna entrega todavía."""

    numero_ot: str
    cliente: Optional[str] = None
    diseno: Optional[str] = None
    procesos: List[ProcesoDetalleIn] = Field(min_length=1)


class MaterialPedidoOut(BaseModel):
    ot_material_id: int
    material_id: int
    codigo_mp: str
    unidad: str
    cantidad_requerida: Optional[float]
    total_entregado: float
    total_devuelto: float


class ProcesoDetalleOut(BaseModel):
    ot_proceso_id: int
    proceso_id: int
    proceso: str
    maquina_id: int
    maquina: str
    materiales: List[MaterialPedidoOut]


class OtDetalleOut(BaseModel):
    numero_ot: str
    cliente: Optional[str]
    diseno: Optional[str]
    procesos: List[ProcesoDetalleOut]


class EntregaCreate(BaseModel):
    ot_material_id: int
    fecha: date
    bobinas: List[float] = Field(min_length=1)


class EntregaOut(BaseModel):
    id: int
    ot_material_id: int
    numero_ot: str
    proceso: str
    maquina: str
    diseno: Optional[str]
    codigo_mp: str
    unidad: str
    usuario: str
    fecha: date
    bobinas: List[float]
    total_entregado: float
    cantidad_requerida: Optional[float]
    total_entregado_pedido: float


class DevolucionCreate(BaseModel):
    ot_material_id: int
    fecha: date
    bobinas: List[float] = Field(min_length=1)


class DevolucionOut(BaseModel):
    id: int
    ot_material_id: int
    usuario: str
    fecha: date
    bobinas: List[float]
    total_devuelto: float
    total_devuelto_pedido: float


class PedidoMaterialOut(BaseModel):
    """Un material pedido dentro de una OT+proceso, con su avance de entrega."""

    ot_material_id: int
    numero_ot: str
    cliente: Optional[str]
    proceso: str
    maquina: str
    diseno: Optional[str]
    codigo_mp: str
    unidad: str
    cantidad_requerida: Optional[float]
    total_entregado: float
    total_devuelto: float
    consumo_neto: float
    estado_entrega: str


class ConsumoOut(PedidoMaterialOut):
    estado_sid: str
