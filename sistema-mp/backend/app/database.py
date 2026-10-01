import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

load_dotenv()

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://zepol:zepol@localhost:5432/zepol_mp",
)

# pool_pre_ping: antes de usar una conexión del pool verifica que siga viva.
# Sin esto, una conexión que Postgres cerró por inactividad (típico: el
# servidor sin uso toda la noche) hacía fallar o demorar la primera petición
# del día, justo la de la pantalla de Login.
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
