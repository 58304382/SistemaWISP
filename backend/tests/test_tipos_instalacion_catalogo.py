"""Pruebas del CRUD administrativo de tipos de instalacion."""

import unittest
from unittest.mock import MagicMock

from app.main import app
from app.modules.visitas_tecnicas.models.tipo_instalacion import TipoInstalacion
from app.modules.visitas_tecnicas.schemas.tipo_instalacion import (
    TipoInstalacionCreate,
    TipoInstalacionUpdate,
)
from app.modules.visitas_tecnicas.services.tipos_instalacion import (
    TipoInstalacionDuplicateError,
    TipoInstalacionEnUsoError,
    create_tipo_instalacion,
    list_tipos_instalacion,
    update_tipo_instalacion,
)


class TipoInstalacionCatalogoServiceTests(unittest.TestCase):
    def _tipo(self, estado: str = "Activo") -> TipoInstalacion:
        return TipoInstalacion(
            id_tipo_instalacion=2,
            nombre="Cámaras",
            descripcion="Instalación de cámaras",
            estado=estado,
        )

    def test_lista_administrativa_incluye_inactivos(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [self._tipo("Inactivo")]

        tipos = list_tipos_instalacion(db, incluir_inactivos=True)

        self.assertEqual([tipo.estado for tipo in tipos], ["Inactivo"])
        db.commit.assert_not_called()

    def test_crea_tipo_normalizando_datos(self) -> None:
        db = MagicMock()
        db.scalar.return_value = None

        create_tipo_instalacion(
            db,
            TipoInstalacionCreate(
                nombre="  Redes  ",
                descripcion="  Cableado estructurado  ",
                estado="Activo",
            ),
        )

        creado = db.add.call_args.args[0]
        self.assertEqual(creado.nombre, "Redes")
        self.assertEqual(creado.descripcion, "Cableado estructurado")
        self.assertEqual(creado.estado, "Activo")
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    def test_rechaza_nombre_duplicado_sin_distinguir_mayusculas(self) -> None:
        db = MagicMock()
        db.scalar.return_value = 1

        with self.assertRaises(TipoInstalacionDuplicateError):
            create_tipo_instalacion(
                db,
                TipoInstalacionCreate(nombre="internet", estado="Activo"),
            )

        db.add.assert_not_called()
        db.commit.assert_not_called()

    def test_actualiza_datos_sin_inactivar(self) -> None:
        db = MagicMock()
        db.scalar.return_value = None
        tipo = self._tipo()

        update_tipo_instalacion(
            db,
            tipo,
            TipoInstalacionUpdate(
                nombre="Cámaras IP",
                descripcion=None,
                estado="Activo",
            ),
        )

        self.assertEqual(tipo.nombre, "Cámaras IP")
        self.assertIsNone(tipo.descripcion)
        db.commit.assert_called_once()

    def test_bloquea_inactivacion_con_visitas_o_instalaciones_en_proceso(self) -> None:
        db = MagicMock()
        # Primera consulta: visitas activas. Segunda: instalaciones activas.
        db.scalar.side_effect = [1, 0]
        tipo = self._tipo()

        with self.assertRaises(TipoInstalacionEnUsoError):
            update_tipo_instalacion(
                db,
                tipo,
                TipoInstalacionUpdate(estado="Inactivo"),
            )

        self.assertEqual(tipo.estado, "Activo")
        db.commit.assert_not_called()
        self.assertEqual(db.scalar.call_count, 2)

    def test_permite_inactivar_cuando_solo_existe_historial_completado(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [0, 0]
        tipo = self._tipo()

        update_tipo_instalacion(
            db,
            tipo,
            TipoInstalacionUpdate(estado="Inactivo"),
        )

        self.assertEqual(tipo.estado, "Inactivo")
        db.commit.assert_called_once()


class TipoInstalacionCatalogoSecurityTests(unittest.TestCase):
    def test_endpoints_administrativos_exigen_jwt(self) -> None:
        paths = app.openapi()["paths"]
        todos = paths["/api/tipos-instalacion/todos"]["get"]
        crear = paths["/api/tipos-instalacion"]["post"]
        editar = paths["/api/tipos-instalacion/{id_tipo_instalacion}"]["patch"]

        for operation in (todos, crear, editar):
            self.assertEqual(operation["security"], [{"OAuth2PasswordBearer": []}])
        self.assertIn("requestBody", crear)
        self.assertIn("requestBody", editar)

    def test_consulta_de_formularios_conserva_su_endpoint(self) -> None:
        operation = app.openapi()["paths"]["/api/tipos-instalacion"]["get"]

        self.assertEqual(operation["security"], [{"OAuth2PasswordBearer": []}])


if __name__ == "__main__":
    unittest.main()
