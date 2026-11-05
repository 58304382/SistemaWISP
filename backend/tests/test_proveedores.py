"""Pruebas del contrato, eliminación protegida y seguridad de Proveedores."""

from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.modules.auth.services.auth import require_module_access
from app.modules.proveedores.models.proveedor import Proveedor
from app.modules.proveedores.routers.proveedores import (
    delete_proveedor_route,
    require_proveedores_administrator,
)
from app.modules.proveedores.schemas.proveedor import ProveedorCreate
from app.modules.proveedores.services.proveedores import (
    ProveedorEnUsoError,
    delete_proveedor,
)


class ProveedorContractTests(unittest.TestCase):
    def test_modelo_conserva_campos_reales_y_id_autogenerado(self) -> None:
        columns = Proveedor.__table__.columns

        self.assertEqual(
            set(columns.keys()),
            {
                "id_proveedor",
                "nombre",
                "nit",
                "contacto",
                "telefono",
                "correo",
                "direccion",
                "id_municipio",
                "estado",
                "observaciones",
            },
        )
        self.assertTrue(columns["id_proveedor"].primary_key)
        self.assertIsNone(columns["id_proveedor"].default)

    def test_valida_nombre_correo_municipio_y_estado(self) -> None:
        valid = ProveedorCreate(nombre="Proveedor Uno", correo="ventas@proveedor.gt", id_municipio=1)
        self.assertEqual(valid.estado, "Activo")

        invalid_values = (
            {"nombre": "   ", "id_municipio": 1},
            {"nombre": "Proveedor", "correo": "correo-invalido", "id_municipio": 1},
            {"nombre": "Proveedor", "id_municipio": 0},
            {"nombre": "Proveedor", "id_municipio": 1, "estado": "Eliminado"},
        )
        for values in invalid_values:
            with self.subTest(values=values), self.assertRaises(ValidationError):
                ProveedorCreate(**values)

    def test_eliminacion_conflictiva_hace_rollback(self) -> None:
        db = MagicMock()
        db.commit.side_effect = IntegrityError("DELETE", {}, Exception("relación"))
        proveedor = SimpleNamespace(id_proveedor=1)

        with self.assertRaises(ProveedorEnUsoError):
            delete_proveedor(db, proveedor)

        db.delete.assert_called_once_with(proveedor)
        db.rollback.assert_called_once()


class ProveedorSecurityTests(unittest.TestCase):
    def test_permiso_y_rol_administrador_son_obligatorios(self) -> None:
        dependency = require_module_access("proveedores")
        allowed = SimpleNamespace(
            modulos=[SimpleNamespace(codigo="proveedores", activo=True)],
            rol=SimpleNamespace(nombre="Administrador"),
        )
        denied = SimpleNamespace(modulos=[], rol=SimpleNamespace(nombre="Administrador"))

        self.assertIs(dependency(allowed), allowed)
        self.assertIs(require_proveedores_administrator(allowed), allowed)
        with self.assertRaises(HTTPException):
            dependency(denied)
        with self.assertRaises(HTTPException):
            require_proveedores_administrator(
                SimpleNamespace(rol=SimpleNamespace(nombre="Empleado"))
            )

    def test_endpoints_declaran_seguridad_jwt(self) -> None:
        paths = app.openapi()["paths"]
        for path, method in (
            ("/api/proveedores", "get"),
            ("/api/proveedores", "post"),
            ("/api/proveedores/{id_proveedor}", "get"),
            ("/api/proveedores/{id_proveedor}", "put"),
            ("/api/proveedores/{id_proveedor}", "delete"),
            ("/api/proveedores/{id_proveedor}/estado", "patch"),
        ):
            self.assertEqual(paths[path][method]["security"], [{"OAuth2PasswordBearer": []}])

    @patch("app.modules.proveedores.routers.proveedores.delete_proveedor")
    @patch("app.modules.proveedores.routers.proveedores.get_proveedor")
    def test_relacion_se_traduce_a_conflicto_con_inactivacion(self, get_item, delete_item) -> None:
        get_item.return_value = SimpleNamespace(id_proveedor=1)
        delete_item.side_effect = ProveedorEnUsoError

        with self.assertRaises(HTTPException) as context:
            delete_proveedor_route(1, SimpleNamespace(), MagicMock())

        self.assertEqual(context.exception.status_code, 409)
        self.assertIn("inactivarlo", context.exception.detail)


if __name__ == "__main__":
    unittest.main()
