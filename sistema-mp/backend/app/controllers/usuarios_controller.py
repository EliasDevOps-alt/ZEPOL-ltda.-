from __future__ import annotations

from typing import List

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas, security
from ..models import Usuario, UsuarioModuloRestringido


def listar_usuarios(db: Session) -> List[Usuario]:
    return db.scalars(select(Usuario).order_by(Usuario.nombre)).all()


def _aplicar_modulos_restringidos(db: Session, usuario: Usuario, modulos: List[str]) -> None:
    for fila in list(usuario.modulos_restringidos):
        db.delete(fila)
    db.flush()
    for modulo in modulos:
        if modulo not in security.MODULOS_RESTRINGIBLES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Módulo desconocido: {modulo}")
        db.add(UsuarioModuloRestringido(usuario_id=usuario.id, modulo=modulo))


def crear_usuario(db: Session, data: schemas.UsuarioCreate) -> Usuario:
    inicial = data.inicial.strip().upper()
    if not inicial or len(inicial) > 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La inicial debe tener entre 1 y 5 caracteres")
    existente = db.scalar(select(Usuario).where(Usuario.inicial == inicial))
    if existente is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ya existe un usuario con inicial {inicial}")

    usuario = Usuario(
        inicial=inicial,
        nombre=data.nombre,
        rol=data.rol,
        password_hash=security.hash_password(data.password),
    )
    db.add(usuario)
    db.flush()
    if data.rol == "personal":
        _aplicar_modulos_restringidos(db, usuario, data.modulos_restringidos)
    db.commit()
    db.refresh(usuario)
    return usuario


def actualizar_usuario(db: Session, usuario_id: int, data: schemas.UsuarioUpdate) -> Usuario:
    usuario = db.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")

    usuario.nombre = data.nombre
    usuario.rol = data.rol
    usuario.activo = data.activo
    # Un admin ignora esta tabla igual (ver security.requiere_modulo), pero
    # limpiamos las filas al pasar a admin para no dejar basura colgada.
    _aplicar_modulos_restringidos(db, usuario, data.modulos_restringidos if data.rol == "personal" else [])
    db.commit()
    db.refresh(usuario)
    return usuario


def resetear_password(db: Session, usuario_id: int, password: str) -> Usuario:
    usuario = db.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    usuario.password_hash = security.hash_password(password)
    db.commit()
    db.refresh(usuario)
    return usuario
