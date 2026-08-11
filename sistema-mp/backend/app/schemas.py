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


class EntregaCreate(BaseModel):
    numero_ot: str
    cliente: Optional[str] = None
    diseno: Optional[str] = None
    proceso_id: int
    maquina_id: int
    material_id: int
    # solo se usa si es el primer pedido de este material para esta OT+proceso;
    # en entregas parciales posteriores contra el mismo pedido se ignora.
    cantidad_requerida: Optional[float] = None
    fecha: date
    bobinas: List[float] = Field(min_length=1)


class EntregaOut(BaseModel):
    id: int
    ot_material_id: int
    numero_ot: str
    proceso: str
    maquina: str
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
    proceso: str
    maquina: str
    codigo_mp: str
    unidad: str
    cantidad_requerida: Optional[float]
    total_entregado: float
    total_devuelto: float
    consumo_neto: float
    estado_entrega: str


class ConsumoOut(PedidoMaterialOut):
    estado_sid: str
