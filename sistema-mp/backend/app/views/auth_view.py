from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas
from ..controllers import auth_controller
from ..database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=schemas.TokenOut)
def login(data: schemas.LoginRequest, db: Session = Depends(get_db)):
    token, usuario = auth_controller.iniciar_sesion(db, data.inicial, data.password)
    return schemas.TokenOut(access_token=token, usuario=schemas.UsuarioOut.model_validate(usuario))
