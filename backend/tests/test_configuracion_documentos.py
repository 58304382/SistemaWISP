"""Pruebas del versionado y seguridad de documentos comerciales."""

from datetime import datetime
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import inspect

from app.core.database import Base, get_db
from app.main import app
from app.modules.auth.services.auth import get_current_user
from app.modules.cotizaciones.models.cotizacion import ConfiguracionDocumentoComercial
from app.modules.cotizaciones.schemas.cotizacion import ConfiguracionDocumentoCreate
from app.modules.cotizaciones.services.configuracion_documentos import (
    publish_configuration,
    save_configuration,
)


def configuration(identifier: int = 1, version: int = 1, state: str = "Borrador") -> ConfiguracionDocumentoComercial:
    item = ConfiguracionDocumentoComercial(
        id_configuracion=identifier,
        version=version,
        nombre_comercial="Empresa",
        estado=state,
        fecha_creacion=datetime(2026, 10, 23),
    )
    return item


class ConfiguracionDocumentosServiceTests(unittest.TestCase):
    def test_model_matches_existing_table(self) -> None:
        table = Base.metadata.tables["configuracion_documentos_comerciales"]
        self.assertEqual(inspect(ConfiguracionDocumentoComercial).primary_key[0].name, "id_configuracion")
        self.assertIn("terminos_cotizacion", table.columns)
        self.assertIn("terminos_proforma", table.columns)
        self.assertIn("logo_ruta", table.columns)

    @patch("app.modules.cotizaciones.services.configuracion_documentos.store_image")
    def test_save_creates_next_draft_and_unique_logo(self, store_image: MagicMock) -> None:
        db = MagicMock()
        latest = configuration(identifier=4, version=6, state="Activo")
        db.scalar.return_value = latest
        store_image.return_value = ("uploads/documentos_comerciales/logo_5_uuid.webp", MagicMock())
        data = ConfiguracionDocumentoCreate(nombre_comercial=" Nueva empresa ")

        response = save_configuration(db, data, b"webp")

        saved = db.add.call_args.args[0]
        self.assertEqual(saved.version, 7)
        self.assertEqual(saved.estado, "Borrador")
        self.assertEqual(saved.logo_ruta, "uploads/documentos_comerciales/logo_5_uuid.webp")
        store_image.assert_called_once_with(
            b"webp", "documentos_comerciales", "logo", saved.id_configuracion
        )
        db.commit.assert_called_once()
        self.assertEqual(response["logo_url"], "/uploads/documentos_comerciales/logo_5_uuid.webp")

    def test_publish_deactivates_other_active_versions(self) -> None:
        db = MagicMock()
        selected = configuration(identifier=9, version=3)
        db.get.return_value = selected

        response = publish_configuration(db, 9)

        self.assertEqual(selected.estado, "Activo")
        self.assertEqual(response["estado"], "Activo")
        self.assertGreaterEqual(db.execute.call_count, 2)
        db.commit.assert_called_once()


class ConfiguracionDocumentosSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.overrides = dict(app.dependency_overrides)
        self.db = MagicMock()
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides = self.overrides

    def test_save_rejects_non_administrator_without_writing(self) -> None:
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
            id=8,
            rol=SimpleNamespace(nombre="Empleado"),
        )

        response = self.client.post(
            "/api/cotizaciones/configuracion-documentos",
            data={"nombre_comercial": "Empresa"},
        )

        self.assertEqual(response.status_code, 403)
        self.db.commit.assert_not_called()

    def test_save_requires_jwt(self) -> None:
        response = self.client.post(
            "/api/cotizaciones/configuracion-documentos",
            data={"nombre_comercial": "Empresa"},
        )
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
