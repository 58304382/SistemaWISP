from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


# READ COMMITTED permite que una consulta posterior a un FOR UPDATE vea el
# commit de la transacción concurrente que acaba de liberar el bloqueo.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    isolation_level="READ COMMITTED",
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
