"""Pruebas del versionado y la seguridad de la configuración de comprobantes."""

from datetime import datetime
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.database import Base, get_db
from app.main import app
from app.modules.auth.services.auth import get_current_user
from app.modules.finanzas.models.comprobante_configuracion import (
    ConfiguracionComprobante,
)
from app.modules.finanzas.routers.cobros import (
    save_receipt_configuration_endpoint,
)
from app.modules.finanzas.schemas.comprobante_configuracion import (
    ConfiguracionComprobanteCreate,
)
from app.modules.finanzas.services.comprobante_configuracion import (
    ConfiguracionComprobanteConflictError,
    get_active_configuration,
    save_configuration,
)


def configuracion(
    identifier: int = 1,
    version: int = 1,
    estado: str = "Activa",
) -> ConfiguracionComprobante:
    return ConfiguracionComprobante(
        id_configuracion=identifier,
        version=version,
        nombre_comercial="Multiservicios Tale",
        estado=estado,
        fecha_creacion=datetime(2026, 11, 3),
    )


class ConfiguracionComprobantesServiceTests(unittest.TestCase):
    def test_model_coincide_con_la_tabla_existente(self) -> None:
        tabla = Base.metadata.tables["configuracion_comprobantes"]

        esperadas = {
            "id_configuracion",
            "version",
            "nombre_comercial",
            "descripcion_empresa",
            "direccion",
            "telefono",
            "mensaje_final",
            "nota_fiscal",
            "estado",
            "fecha_creacion",
            "fecha_publicacion",
        }
        self.assertEqual(set(tabla.columns.keys()), esperadas)
        self.assertEqual(
            ConfiguracionComprobante.__table__.primary_key.columns.keys(),
            ["id_configuracion"],
        )

    def test_nota_fiscal_vacia_se_conserva_para_eliminarla(self) -> None:
        data = ConfiguracionComprobanteCreate(
            nombre_comercial="Multiservicios Tale",
            nota_fiscal="   ",
        )

        self.assertEqual(data.nota_fiscal, "")

    def test_guarda_nota_fiscal_vacia_sin_reinsertar_texto(self) -> None:
        db = MagicMock()
        db.scalar.return_value = None

        respuesta = save_configuration(
            db,
            ConfiguracionComprobanteCreate(
                nombre_comercial="Multiservicios Tale",
                nota_fiscal="",
            ),
        )

        guardada = db.add.call_args.args[0]
        self.assertEqual(guardada.nota_fiscal, "")
        self.assertEqual(respuesta["nota_fiscal"], "")

    def test_guarda_version_nueva_y_desactiva_la_anterior(self) -> None:
        db = MagicMock()
        anterior = configuracion(identifier=4, version=6, estado="Activa")
        db.scalar.return_value = anterior
        data = ConfiguracionComprobanteCreate(
            nombre_comercial="  Multiservicios Tale  ",
            descripcion_empresa="Internet",
            telefono="2222-2222",
            nota_fiscal="No constituye comprobante fiscal.",
        )

        respuesta = save_configuration(db, data)

        guardada = db.add.call_args.args[0]
        self.assertEqual(guardada.version, 7)
        self.assertEqual(guardada.estado, "Activa")
        self.assertEqual(guardada.nombre_comercial, "Multiservicios Tale")
        self.assertIsNotNone(guardada.fecha_publicacion)
        self.assertEqual(respuesta["version"], 7)
        self.assertEqual(respuesta["estado"], "Activa")
        self.assertEqual(db.execute.call_count, 2)
        db.commit.assert_called_once()

    def test_primera_version_inicia_en_uno(self) -> None:
        db = MagicMock()
        db.scalar.return_value = None

        respuesta = save_configuration(
            db,
            ConfiguracionComprobanteCreate(nombre_comercial="Multiservicios Tale"),
        )

        guardada = db.add.call_args.args[0]
        self.assertEqual(guardada.version, 1)
        self.assertEqual(guardada.estado, "Activa")
        self.assertEqual(respuesta["version"], 1)

    def test_consulta_configuracion_activa(self) -> None:
        db = MagicMock()
        db.scalar.return_value = configuracion(identifier=9, version=3)

        respuesta = get_active_configuration(db)

        self.assertEqual(respuesta["id_configuracion"], 9)
        self.assertEqual(respuesta["estado"], "Activa")

    def test_conflicto_de_transaccion_no_deja_cambios(self) -> None:
        db = MagicMock()
        db.commit.side_effect = __import__("sqlalchemy").exc.IntegrityError(
            "insert", {}, Exception()
        )

        with self.assertRaises(ConfiguracionComprobanteConflictError):
            save_configuration(
                db,
                ConfiguracionComprobanteCreate(nombre_comercial="Empresa"),
            )

        db.rollback.assert_called_once()


class ConfiguracionComprobantesSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.overrides = dict(app.dependency_overrides)
        self.db = MagicMock()
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides = self.overrides

    def test_modificacion_rechaza_empleado_sin_escribir(self) -> None:
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
            id=8,
            rol=SimpleNamespace(nombre="Empleado"),
        )

        respuesta = self.client.post(
            "/api/cobros/configuracion-comprobantes",
            json={"nombre_comercial": "Empresa"},
        )

        self.assertEqual(respuesta.status_code, 403)
        self.db.commit.assert_not_called()

    def test_modificacion_requiere_jwt(self) -> None:
        respuesta = self.client.post(
            "/api/cobros/configuracion-comprobantes",
            json={"nombre_comercial": "Empresa"},
        )

        self.assertEqual(respuesta.status_code, 401)

    def test_administrador_guarda_por_endpoint(self) -> None:
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
            id=1,
            rol=SimpleNamespace(nombre="Administrador"),
        )
        guardada = {
            "id_configuracion": 1,
            "version": 1,
            "nombre_comercial": "Empresa",
            "descripcion_empresa": None,
            "direccion": None,
            "telefono": None,
            "mensaje_final": None,
            "nota_fiscal": None,
            "estado": "Activa",
            "fecha_creacion": "2026-11-03T10:00:00",
            "fecha_publicacion": "2026-11-03T10:00:00",
        }
        with patch(
            "app.modules.finanzas.routers.cobros.save_receipt_configuration",
            return_value=guardada,
        ) as servicio:
            respuesta = self.client.post(
                "/api/cobros/configuracion-comprobantes",
                json={"nombre_comercial": "Empresa"},
            )

        self.assertEqual(respuesta.status_code, 201)
        self.assertEqual(respuesta.json()["version"], 1)
        servicio.assert_called_once()

    def test_endpoint_activo_devuelve_404_sin_configuracion(self) -> None:
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
            id=1,
            rol=SimpleNamespace(nombre="Administrador"),
        )
        with patch(
            "app.modules.finanzas.routers.cobros.get_active_receipt_configuration",
            return_value=None,
        ):
            respuesta = self.client.get(
                "/api/cobros/configuracion-comprobantes/activa"
            )

        self.assertEqual(respuesta.status_code, 404)

    def test_endpoint_guardar_retorna_conflicto(self) -> None:
        db = MagicMock()
        with patch(
            "app.modules.finanzas.routers.cobros.save_receipt_configuration",
            side_effect=ConfiguracionComprobanteConflictError,
        ):
            with self.assertRaises(HTTPException) as contexto:
                save_receipt_configuration_endpoint(
                    ConfiguracionComprobanteCreate(nombre_comercial="Empresa"),
                    SimpleNamespace(),
                    db,
                )

        self.assertEqual(contexto.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
