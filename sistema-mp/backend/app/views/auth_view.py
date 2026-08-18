from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas
from ..controllers import auth_controller
from ..database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


def _usuario_out(usuario) -> schemas.UsuarioOut:
    return schemas.UsuarioOut(
        id=usuario.id,
        inicial=usuario.inicial,
        nombre=usuario.nombre,
        rol=usuario.rol,
        modulos_restringidos=[m.modulo for m in usuario.modulos_restringidos],
    )


@router.post("/login", response_model=schemas.TokenOut)
def login(data: schemas.LoginRequest, db: Session = Depends(get_db)):
    token, usuario = auth_controller.iniciar_sesion(db, data.inicial, data.password)
    return schemas.TokenOut(access_token=token, usuario=_usuario_out(usuario))


@router.get("/usuarios", response_model=List[schemas.UsuarioLoginOut])
def listar_usuarios_login(db: Session = Depends(get_db)):
    """Público a propósito — se necesita para poblar el selector de la
    pantalla de Login, antes de que exista una sesión."""
    return auth_controller.listar_usuarios_activos(db)
