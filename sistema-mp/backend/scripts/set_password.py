"""Asigna/cambia la clave de un usuario. Uso: python scripts/set_password.py ER"""

from __future__ import annotations

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.database import SessionLocal
from app.security import hash_password


def main() -> None:
    if len(sys.argv) != 2:
        print("Uso: python scripts/set_password.py <INICIAL>")
        raise SystemExit(1)

    inicial = sys.argv[1].upper()
    password = getpass.getpass(f"Nueva clave para {inicial}: ")

    db = SessionLocal()
    try:
        from app.models import Usuario

        usuario = db.scalar(select(Usuario).where(Usuario.inicial == inicial))
        if usuario is None:
            print(f"No existe un usuario con inicial {inicial}")
            raise SystemExit(1)
        usuario.password_hash = hash_password(password)
        db.commit()
        print(f"Clave actualizada para {usuario.nombre} ({inicial})")
    finally:
        db.close()


if __name__ == "__main__":
    main()
