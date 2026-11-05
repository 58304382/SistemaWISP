"""Restablece de forma interactiva y restringida la contraseña de LUIS26."""

from getpass import getpass
from pathlib import Path
import sys

# Permite ejecutar el comando desde backend/ sin instalar la aplicación como paquete.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.models  # noqa: E402,F401  # Registra las relaciones ORM antes de consultar.
from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import joinedload  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.core.security import get_password_hash, verify_password  # noqa: E402
from app.modules.auth.services.auth import authenticate_user  # noqa: E402
from app.modules.usuarios.models.usuario import Usuario  # noqa: E402


USUARIO_ID = 14
USERNAME = "LUIS26"
LONGITUD_MINIMA = 8


def main() -> int:
    """Solicita, confirma y guarda únicamente el hash de la cuenta autorizada."""

    nueva_password = getpass("Nueva contraseña para LUIS26: ")
    confirmacion = getpass("Confirme la nueva contraseña: ")

    if len(nueva_password) < LONGITUD_MINIMA:
        print(f"Error: la contraseña debe tener al menos {LONGITUD_MINIMA} caracteres.")
        return 1
    if nueva_password != confirmacion:
        print("Error: las contraseñas no coinciden.")
        return 1

    nuevo_hash = get_password_hash(nueva_password)
    if not verify_password(nueva_password, nuevo_hash):
        print("Error: no fue posible verificar el hash Argon2 generado.")
        return 1

    with SessionLocal() as db:
        usuario = db.scalar(
            select(Usuario)
            .options(joinedload(Usuario.rol))
            .where(Usuario.id == USUARIO_ID)
        )
        if usuario is None or usuario.username != USERNAME:
            print("Error: el ID 14 no corresponde exactamente al usuario LUIS26.")
            return 1
        if usuario.rol.nombre != "Administrador":
            print("Error: LUIS26 ya no tiene el rol Administrador.")
            return 1

        # SQLAlchemy actualiza solo la columna modificada; no se alteran rol ni permisos.
        usuario.password_hash = nuevo_hash
        try:
            db.commit()
        except Exception:
            db.rollback()
            print("Error: PostgreSQL rechazó el restablecimiento.")
            return 1

        autenticado = authenticate_user(db, USERNAME, nueva_password)
        if autenticado is None or autenticado.id != USUARIO_ID:
            print("Error: el hash se guardó, pero la autenticación segura no pudo verificarse.")
            return 1

    # No se muestran ni registran la contraseña, el hash o el token.
    print("Contraseña de LUIS26 restablecida y autenticación verificada correctamente.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
