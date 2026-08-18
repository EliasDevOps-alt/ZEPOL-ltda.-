from __future__ import annotations

from typing import List

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import security
from ..models import Usuario


def iniciar_sesion(db: Session, inicial: str, password: str) -> tuple[str, Usuario]:
    usuario = db.scalar(select(Usuario).where(Usuario.inicial == inicial.upper()))
    credenciales_invalidas = HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario o clave incorrectos")
    if not usuario or not usuario.activo or not usuario.password_hash:
        raise credenciales_invalidas
    if not security.verify_password(password, usuario.password_hash):
        raise credenciales_invalidas

    token = security.create_access_token(usuario.id)
    return token, usuario


def listar_usuarios_activos(db: Session) -> List[Usuario]:
    """Solo inicial+nombre de usuarios activos, para poblar el selector de
    Login — se pide sin estar autenticado todavía, por eso no expone nada
    más (ni rol, ni si tienen o no contraseña)."""
    return db.scalars(select(Usuario).where(Usuario.activo.is_(True)).order_by(Usuario.nombre)).all()
