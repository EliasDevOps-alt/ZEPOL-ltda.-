from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .database import get_db
from .models import Usuario

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 12

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def create_access_token(usuario_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": str(usuario_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_usuario(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> Usuario:
    credenciales_invalidas = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales inválidas",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        usuario_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise credenciales_invalidas

    usuario = db.get(Usuario, usuario_id)
    if usuario is None or not usuario.activo:
        raise credenciales_invalidas
    return usuario


# Códigos de módulo que un usuario 'personal' puede tener restringidos —
# deben coincidir con los que ofrece la pantalla de Usuarios en el frontend.
MODULOS_RESTRINGIBLES = {
    "crear_ot",
    "registrar_entrega",
    "registrar_devolucion",
    "registro_sid",
    "materiales",
    "maquinas",
    "excel_oc_mp",
}


def requiere_modulo(modulo: str):
    """Dependencia para gatear una acción de un módulo específico. Un
    'admin' siempre pasa; un 'personal' pasa salvo que ese módulo esté en su
    lista de restringidos. Las lecturas (GET) de datos compartidos entre
    pantallas deliberadamente NO pasan por acá — ver el mapeo de módulos en
    el plan de esta feature."""

    def _verificar(usuario: Usuario = Depends(get_current_usuario)) -> Usuario:
        if usuario.rol == "admin":
            return usuario
        bloqueados = {m.modulo for m in usuario.modulos_restringidos}
        if modulo in bloqueados:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"No tenés acceso al módulo '{modulo}'")
        return usuario

    return _verificar


def requiere_admin(usuario: Usuario = Depends(get_current_usuario)) -> Usuario:
    if usuario.rol != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo un administrador puede hacer esto")
    return usuario
