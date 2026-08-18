from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from .. import schemas, security
from ..controllers import usuarios_controller
from ..database import get_db
from ..models import Usuario

router = APIRouter(prefix="/usuarios", tags=["usuarios"], dependencies=[Depends(security.requiere_admin)])


def _serializar(usuario: Usuario) -> schemas.UsuarioAdminOut:
    return schemas.UsuarioAdminOut(
        id=usuario.id,
        inicial=usuario.inicial,
        nombre=usuario.nombre,
        rol=usuario.rol,
        activo=usuario.activo,
        modulos_restringidos=[m.modulo for m in usuario.modulos_restringidos],
    )


@router.get("", response_model=List[schemas.UsuarioAdminOut])
def listar_usuarios(db: Session = Depends(get_db)):
    return [_serializar(u) for u in usuarios_controller.listar_usuarios(db)]


@router.post("", response_model=schemas.UsuarioAdminOut, status_code=status.HTTP_201_CREATED)
def crear_usuario(data: schemas.UsuarioCreate, db: Session = Depends(get_db)):
    return _serializar(usuarios_controller.crear_usuario(db, data))


@router.put("/{usuario_id}", response_model=schemas.UsuarioAdminOut)
def actualizar_usuario(usuario_id: int, data: schemas.UsuarioUpdate, db: Session = Depends(get_db)):
    return _serializar(usuarios_controller.actualizar_usuario(db, usuario_id, data))


@router.put("/{usuario_id}/password", response_model=schemas.UsuarioAdminOut)
def resetear_password(usuario_id: int, data: schemas.UsuarioPasswordIn, db: Session = Depends(get_db)):
    return _serializar(usuarios_controller.resetear_password(db, usuario_id, data.password))
