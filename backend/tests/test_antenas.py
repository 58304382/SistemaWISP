"""Pruebas unitarias del CRUD protegido y fotografías de antenas."""

from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.modules.mapas.routers.antenas import delete_antena_route, require_antenas_administrator
from app.modules.mapas.schemas.antena import AntenaCreate, AntenaUpdate
from app.modules.mapas.services.antenas import (
    AntenaConflictError,
    create_antena,
    delete_antena,
    get_antena,
    list_antenas,
    update_antena,
)
from app.modules.auth.services.auth import require_module_access


class AntenaServiceTests(unittest.TestCase):
    def _antenna(self, **overrides):
        values = {
            "id_antena": 4,
            "nombre": "Torre Norte",
            "latitud": Decimal("14.6349142"),
            "longitud": Decimal("-90.5068824"),
            "direccion_sector": "Sector Norte",
            "referencia": "Junto al tanque",
            "foto_antena": None,
            "estado": "Activa",
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_lista_antenas(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [self._antenna()]

        response = list_antenas(db)

        self.assertEqual(len(response), 1)
        self.assertEqual(response[0]["nombre"], "Torre Norte")

    def test_obtiene_antena(self) -> None:
        db = MagicMock()
        db.get.return_value = self._antenna()

        response = get_antena(db, 4)

        self.assertEqual(response["id_antena"], 4)

    def test_crea_antena_valida(self) -> None:
        db = MagicMock()

        def assign_id() -> None:
            db.add.call_args.args[0].id_antena = 4

        db.flush.side_effect = assign_id
        db.get.side_effect = lambda _model, _identifier: db.add.call_args.args[0]
        data = AntenaCreate(
            nombre="Torre Norte",
            latitud=Decimal("14.6349142"),
            longitud=Decimal("-90.5068824"),
        )

        response = create_antena(db, data)

        self.assertEqual(response["id_antena"], 4)
        self.assertEqual(response["estado"], "Activa")
        db.commit.assert_called_once()

    @patch("app.modules.mapas.services.antenas.store_image")
    def test_crea_foto_en_directorio_antenas(self, store_image) -> None:
        db = MagicMock()

        def assign_id() -> None:
            db.add.call_args.args[0].id_antena = 4

        db.flush.side_effect = assign_id
        db.get.side_effect = lambda _model, _identifier: db.add.call_args.args[0]
        store_image.return_value = (
            "uploads/antenas/antena_4.webp",
            Path("uploads/antenas/antena_4.webp"),
        )

        response = create_antena(
            db,
            AntenaCreate(
                nombre="Torre Norte",
                latitud=Decimal("14.6349142"),
                longitud=Decimal("-90.5068824"),
            ),
            b"webp",
        )

        store_image.assert_called_once_with(b"webp", "antenas", "antena", 4)
        self.assertEqual(response["foto_antena"], "/uploads/antenas/antena_4.webp")

    def test_actualiza_antena(self) -> None:
        db = MagicMock()
        antenna = self._antenna()
        db.get.return_value = antenna

        response = update_antena(
            db,
            antenna,
            AntenaUpdate(nombre="Torre Central", estado="Inactiva"),
        )

        self.assertEqual(response["nombre"], "Torre Central")
        self.assertEqual(response["estado"], "Inactiva")
        db.commit.assert_called_once()

    @patch("app.modules.mapas.services.antenas.remove_image_file")
    @patch("app.modules.mapas.services.antenas.safe_image_path")
    def test_elimina_antena_y_luego_su_fotografia(self, safe_image_path, remove_image_file) -> None:
        db = MagicMock()
        antenna = self._antenna(foto_antena="uploads/antenas/antena_4.webp")
        image_path = Path("uploads/antenas/antena_4.webp")
        safe_image_path.return_value = image_path

        delete_antena(db, antenna)

        safe_image_path.assert_called_once_with(antenna.foto_antena, "antenas")
        db.delete.assert_called_once_with(antenna)
        db.commit.assert_called_once()
        remove_image_file.assert_called_once_with(image_path)

    @patch("app.modules.mapas.services.antenas.remove_image_file")
    def test_conflicto_conserva_antena_y_fotografia(self, remove_image_file) -> None:
        db = MagicMock()
        db.commit.side_effect = IntegrityError("DELETE", {}, Exception("relación"))
        antenna = self._antenna()

        with self.assertRaises(AntenaConflictError):
            delete_antena(db, antenna)

        db.rollback.assert_called_once()
        remove_image_file.assert_not_called()

    def test_rechaza_latitud_invalida(self) -> None:
        with self.assertRaises(ValidationError):
            AntenaCreate(nombre="Torre", latitud=Decimal("91"), longitud=Decimal("-90"))

    def test_rechaza_longitud_invalida(self) -> None:
        with self.assertRaises(ValidationError):
            AntenaCreate(nombre="Torre", latitud=Decimal("14"), longitud=Decimal("181"))

    def test_rechaza_estado_invalido(self) -> None:
        with self.assertRaises(ValidationError):
            AntenaCreate(
                nombre="Torre",
                latitud=Decimal("14"),
                longitud=Decimal("-90"),
                estado="Eliminada",
            )


class AntenaSecurityTests(unittest.TestCase):
    def test_permiso_mapas_acepta_y_rechaza_usuario(self) -> None:
        dependency = require_module_access("mapas")
        allowed = SimpleNamespace(
            modulos=[SimpleNamespace(codigo="mapas", activo=True)],
            rol=SimpleNamespace(nombre="Empleado"),
        )
        denied = SimpleNamespace(
            modulos=[],
            rol=SimpleNamespace(nombre="Administrador"),
        )

        self.assertIs(dependency(allowed), allowed)
        with self.assertRaises(HTTPException) as context:
            dependency(denied)
        self.assertEqual(context.exception.status_code, 403)

    def test_endpoints_antenas_conservan_seguridad_jwt(self) -> None:
        paths = app.openapi()["paths"]
        for path, method in (
            ("/api/antenas", "get"),
            ("/api/antenas", "post"),
            ("/api/antenas/{id_antena}", "get"),
            ("/api/antenas/{id_antena}", "patch"),
            ("/api/antenas/{id_antena}", "delete"),
            ("/api/ubicaciones-cliente", "get"),
            ("/api/ubicaciones-cliente/{id_ubicacion}", "delete"),
        ):
            self.assertEqual(
                paths[path][method]["security"],
                [{"OAuth2PasswordBearer": []}],
            )

    def test_tecnico_no_puede_administrar_antenas(self) -> None:
        employee = SimpleNamespace(rol=SimpleNamespace(nombre="Empleado"))
        administrator = SimpleNamespace(rol=SimpleNamespace(nombre="Administrador"))

        with self.assertRaises(HTTPException) as context:
            require_antenas_administrator(employee)

        self.assertEqual(context.exception.status_code, 403)
        self.assertIs(require_antenas_administrator(administrator), administrator)

    @patch("app.modules.mapas.routers.antenas.delete_antena")
    @patch("app.modules.mapas.routers.antenas.get_antena_model")
    def test_endpoint_traduce_relacion_de_antena_a_conflicto(self, get_model, delete_service) -> None:
        get_model.return_value = SimpleNamespace(id_antena=4)
        delete_service.side_effect = AntenaConflictError

        with self.assertRaises(HTTPException) as context:
            delete_antena_route(4, SimpleNamespace(), MagicMock())

        self.assertEqual(context.exception.status_code, 409)
        self.assertIn("relacionada", context.exception.detail)


if __name__ == "__main__":
    unittest.main()
