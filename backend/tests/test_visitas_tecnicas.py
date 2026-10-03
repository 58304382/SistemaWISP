"""Pruebas de visitas, propiedades y cierre atomico de evaluaciones."""

from datetime import date, time
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from pydantic import ValidationError

from app.main import app
from app.routes.visitas_tecnicas import _business_error
from app.schemas.visita_tecnica import (
    EvaluacionVisitaFinalizar,
    PrimeraUbicacionVisitaCreate,
    VisitaTecnicaCreate,
    VisitaTecnicaResponse,
    VisitaTecnicaUpdate,
)
from app.services.cotizaciones import EvaluacionConflictError
from app.services.tareas import _visit_task
from app.services.visitas_tecnicas import (
    UbicacionClienteInactivaError,
    UbicacionClienteNoPerteneceError,
    UbicacionClienteNotFoundError,
    UbicacionVisitaExistenteError,
    VisitaConflictError,
    VisitaNoAsignadaError,
    _locked_visit,
    _validate_client_location,
    _visit_response,
    create_visita,
    finalizar_evaluacion,
    registrar_primera_ubicacion,
    update_visita,
)


def evaluacion_final() -> EvaluacionVisitaFinalizar:
    return EvaluacionVisitaFinalizar(
        descripcion_trabajo="Instalacion de servicio",
        tecnicos_recomendados=2,
        condiciones_lugar="Acceso disponible",
        observacion_tecnica="Factible",
        materiales=[
            {
                "descripcion": "Cable",
                "cantidad": Decimal("25.00"),
                "unidad": "Metro",
            }
        ],
    )


class FinalizarEvaluacionTests(unittest.TestCase):
    """Verifica que visita, evaluacion y cotizacion compartan la transaccion."""

    @patch(
        "app.services.visitas_tecnicas._committed_visit",
        return_value={"estado": "Completada"},
    )
    @patch("app.services.visitas_tecnicas.create_cotizacion_evaluacion")
    @patch("app.services.visitas_tecnicas._locked_visit")
    def test_finaliza_y_crea_cotizacion_antes_del_unico_commit(
        self, locked_visit, create_quote, _committed_visit
    ) -> None:
        db = MagicMock()
        visit = SimpleNamespace(id_empleado=17, estado="En Proceso")
        evaluation = SimpleNamespace(
            id_evaluacion=8,
            descripcion_trabajo="Anterior",
            tecnicos_recomendados=1,
            condiciones_lugar=None,
            observacion_tecnica=None,
        )
        locked_visit.return_value = visit
        db.scalar.return_value = evaluation

        response = finalizar_evaluacion(
            db,
            15,
            evaluacion_final(),
            current_employee_id=17,
            current_user_id=9,
        )

        self.assertEqual(response, {"estado": "Completada"})
        self.assertEqual(visit.estado, "Completada")
        self.assertEqual(evaluation.descripcion_trabajo, "Instalacion de servicio")
        self.assertEqual(evaluation.tecnicos_recomendados, 2)
        material = list(db.add_all.call_args.args[0])[0]
        self.assertEqual(material.descripcion, "Cable")
        self.assertEqual(material.cantidad, Decimal("25.00"))
        self.assertEqual(material.unidad, "Metro")
        quote_data = create_quote.call_args.args[1]
        self.assertEqual(quote_data.id_evaluacion, 8)
        self.assertEqual(create_quote.call_args.kwargs["creado_por"], 9)
        self.assertFalse(create_quote.call_args.kwargs["gestionar_transaccion"])
        db.flush.assert_called_once()
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    @patch("app.services.visitas_tecnicas._committed_visit")
    @patch(
        "app.services.visitas_tecnicas.create_cotizacion_evaluacion",
        side_effect=EvaluacionConflictError,
    )
    @patch("app.services.visitas_tecnicas._locked_visit")
    def test_cotizacion_existente_revierte_toda_la_finalizacion(
        self, locked_visit, _create_quote, committed_visit
    ) -> None:
        db = MagicMock()
        locked_visit.return_value = SimpleNamespace(id_empleado=17, estado="En Proceso")
        db.scalar.return_value = SimpleNamespace(id_evaluacion=8)

        with self.assertRaises(VisitaConflictError):
            finalizar_evaluacion(
                db,
                15,
                evaluacion_final(),
                current_employee_id=17,
                current_user_id=9,
            )

        db.rollback.assert_called_once()
        db.commit.assert_not_called()
        committed_visit.assert_not_called()


class VisitaPropiedadTests(unittest.TestCase):
    """Cubre el contrato nullable y la validacion cliente-propiedad."""

    def _create_data(self, id_ubicacion: int | None) -> VisitaTecnicaCreate:
        return VisitaTecnicaCreate(
            id_cliente=5,
            id_ubicacion=id_ubicacion,
            id_empleado=7,
            id_tipo_instalacion=2,
            fecha_programada=date(2026, 10, 5),
            hora_programada=time(9, 30),
            motivo_visita="Evaluar instalacion",
        )

    @patch("app.services.visitas_tecnicas._committed_visit", return_value={"ok": True})
    @patch("app.services.visitas_tecnicas._validate_active_technician")
    @patch("app.services.visitas_tecnicas._validate_active_type")
    @patch("app.services.visitas_tecnicas._validate_active_client")
    def test_crea_visita_con_propiedad_valida(
        self, _client, _type, _technician, _committed
    ) -> None:
        db = MagicMock()
        db.get.return_value = SimpleNamespace(id_cliente=5, estado="Activo")

        response = create_visita(db, self._create_data(18))

        visit = db.add.call_args.args[0]
        self.assertEqual(visit.id_ubicacion, 18)
        self.assertEqual(response, {"ok": True})
        db.get.assert_called_once()
        db.commit.assert_called_once()

    @patch("app.services.visitas_tecnicas._committed_visit", return_value={"ok": True})
    @patch("app.services.visitas_tecnicas._validate_active_technician")
    @patch("app.services.visitas_tecnicas._validate_active_type")
    @patch("app.services.visitas_tecnicas._validate_active_client")
    def test_crea_visita_sin_propiedad(
        self, _client, _type, _technician, _committed
    ) -> None:
        db = MagicMock()

        create_visita(db, self._create_data(None))

        self.assertIsNone(db.add.call_args.args[0].id_ubicacion)
        db.get.assert_not_called()

    def test_rechaza_propiedad_inexistente(self) -> None:
        db = MagicMock()
        db.get.return_value = None

        with self.assertRaises(UbicacionClienteNotFoundError):
            _validate_client_location(db, 18, 5)

    def test_rechaza_propiedad_de_otro_cliente(self) -> None:
        db = MagicMock()
        db.get.return_value = SimpleNamespace(id_cliente=8, estado="Activo")

        with self.assertRaises(UbicacionClienteNoPerteneceError):
            _validate_client_location(db, 18, 5)

    def test_rechaza_propiedad_inactiva(self) -> None:
        db = MagicMock()
        db.get.return_value = SimpleNamespace(id_cliente=5, estado="Inactivo")

        with self.assertRaises(UbicacionClienteInactivaError):
            _validate_client_location(db, 18, 5)

    @patch("app.services.visitas_tecnicas._committed_visit", return_value={"ok": True})
    @patch("app.services.visitas_tecnicas._validate_active_technician")
    @patch("app.services.visitas_tecnicas._validate_active_type")
    @patch("app.services.visitas_tecnicas._validate_active_client")
    def test_actualiza_visita_con_propiedad(
        self, _client, _type, _technician, _committed
    ) -> None:
        db = MagicMock()
        db.get.return_value = SimpleNamespace(id_cliente=5, estado="Activo")
        visit = SimpleNamespace(
            id_visita=12,
            id_cliente=5,
            id_ubicacion=None,
            id_empleado=7,
            id_tipo_instalacion=2,
            estado="Programada",
        )

        update_visita(db, visit, VisitaTecnicaUpdate(id_ubicacion=18))

        self.assertEqual(visit.id_ubicacion, 18)
        db.commit.assert_called_once()

    @patch("app.services.visitas_tecnicas._committed_visit", return_value={"ok": True})
    @patch("app.services.visitas_tecnicas._validate_active_technician")
    @patch("app.services.visitas_tecnicas._validate_active_type")
    @patch("app.services.visitas_tecnicas._validate_active_client")
    def test_permite_retirar_propiedad_de_visita(
        self, _client, _type, _technician, _committed
    ) -> None:
        db = MagicMock()
        visit = SimpleNamespace(
            id_visita=12,
            id_cliente=5,
            id_ubicacion=18,
            id_empleado=7,
            id_tipo_instalacion=2,
            estado="Programada",
        )

        update_visita(db, visit, VisitaTecnicaUpdate(id_ubicacion=None))

        self.assertIsNone(visit.id_ubicacion)
        db.get.assert_not_called()

    def test_response_devuelve_propiedad_asociada(self) -> None:
        visit = SimpleNamespace(
            id_visita=12,
            id_cliente=5,
            id_ubicacion=18,
            ubicacion=SimpleNamespace(numero_propiedad=2),
            cliente=SimpleNamespace(nombres="Juan", apellidos="Perez", telefono="5555", direccion="Zona 1"),
            id_empleado=7,
            empleado=SimpleNamespace(nombres="Ana", apellidos="Lopez"),
            id_tipo_instalacion=2,
            tipo_instalacion=SimpleNamespace(nombre="Internet"),
            fecha_programada=date(2026, 10, 5),
            hora_programada=time(9, 30),
            motivo_visita="Evaluar",
            foto_referencia=None,
            indicaciones=None,
            observaciones=None,
            estado="Programada",
            evaluacion=None,
        )

        response = VisitaTecnicaResponse.model_validate(_visit_response(visit))

        self.assertEqual(response.id_ubicacion, 18)
        self.assertEqual(response.numero_propiedad, 2)

    def test_endpoints_conservan_seguridad_jwt(self) -> None:
        paths = app.openapi()["paths"]

        self.assertEqual(
            paths["/api/visitas-tecnicas"]["post"]["security"],
            [{"OAuth2PasswordBearer": []}],
        )
        self.assertEqual(
            paths["/api/ubicaciones-cliente/cliente/{id_cliente}"]["get"]["security"],
            [{"OAuth2PasswordBearer": []}],
        )

    def test_errores_de_propiedad_tienen_status_http_apropiado(self) -> None:
        self.assertEqual(_business_error(UbicacionClienteNotFoundError()).status_code, 404)
        self.assertEqual(
            _business_error(UbicacionClienteNoPerteneceError()).status_code, 400
        )


class PrimeraUbicacionVisitaTests(unittest.TestCase):
    """Verifica autorización, atomicidad y exclusión concurrente del flujo técnico."""

    def _data(self) -> PrimeraUbicacionVisitaCreate:
        return PrimeraUbicacionVisitaCreate(
            direccion="Sector Norte",
            referencia="Frente al parque",
            observaciones="Portón azul",
        )

    def test_acepta_coordenadas_validas_y_ambas_nulas(self) -> None:
        with_coordinates = PrimeraUbicacionVisitaCreate(
            direccion="Sector Norte",
            latitud=Decimal("14.6349142"),
            longitud=Decimal("-90.5068824"),
        )
        without_coordinates = PrimeraUbicacionVisitaCreate(direccion="Sector Norte")

        self.assertEqual(with_coordinates.latitud, Decimal("14.6349142"))
        self.assertEqual(with_coordinates.longitud, Decimal("-90.5068824"))
        self.assertIsNone(without_coordinates.latitud)
        self.assertIsNone(without_coordinates.longitud)

    def test_rechaza_un_solo_componente_de_coordenadas(self) -> None:
        for payload in (
            {"direccion": "Sector Norte", "latitud": "14.5"},
            {"direccion": "Sector Norte", "longitud": "-90.5"},
        ):
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                PrimeraUbicacionVisitaCreate.model_validate(payload)

    def test_rechaza_coordenadas_fuera_de_rango(self) -> None:
        invalid_pairs = (
            ("-90.0000001", "-90"),
            ("90.0000001", "-90"),
            ("14", "-180.0000001"),
            ("14", "180.0000001"),
        )
        for latitude, longitude in invalid_pairs:
            with self.subTest(latitude=latitude, longitude=longitude), self.assertRaises(
                ValidationError
            ):
                PrimeraUbicacionVisitaCreate(
                    direccion="Sector Norte",
                    latitud=latitude,
                    longitud=longitude,
                )

    @patch(
        "app.services.visitas_tecnicas.get_ubicacion_cliente",
        return_value={"id_ubicacion": 31, "numero_propiedad": 1},
    )
    @patch("app.services.visitas_tecnicas.create_ubicacion_cliente_in_transaction")
    @patch("app.services.visitas_tecnicas._locked_visit")
    def test_coordenadas_validas_llegan_a_la_propiedad(
        self, locked_visit, create_location, _get_location
    ) -> None:
        db = MagicMock()
        locked_visit.return_value = SimpleNamespace(
            id_cliente=5,
            id_empleado=7,
            id_ubicacion=None,
            estado="Programada",
        )
        create_location.return_value = (SimpleNamespace(id_ubicacion=31), None)
        data = PrimeraUbicacionVisitaCreate(
            direccion="Sector Norte",
            latitud=Decimal("14.6349142"),
            longitud=Decimal("-90.5068824"),
        )

        registrar_primera_ubicacion(db, 15, data, current_employee_id=7)

        location_data = create_location.call_args.args[1]
        self.assertEqual(location_data.latitud, Decimal("14.6349142"))
        self.assertEqual(location_data.longitud, Decimal("-90.5068824"))
        db.commit.assert_called_once()

    @patch(
        "app.services.visitas_tecnicas.get_ubicacion_cliente",
        return_value={"id_ubicacion": 31, "numero_propiedad": 1},
    )
    @patch("app.services.visitas_tecnicas.create_ubicacion_cliente_in_transaction")
    @patch("app.services.visitas_tecnicas._locked_visit")
    def test_visita_sin_propiedad_crea_y_vincula_en_un_commit(
        self, locked_visit, create_location, _get_location
    ) -> None:
        db = MagicMock()
        visit = SimpleNamespace(
            id_visita=15,
            id_cliente=5,
            id_empleado=7,
            id_ubicacion=None,
            estado="Programada",
        )
        location = SimpleNamespace(id_ubicacion=31, numero_propiedad=1)
        locked_visit.return_value = visit
        create_location.return_value = (location, None)

        response = registrar_primera_ubicacion(
            db, 15, self._data(), current_employee_id=7, image_content=b"fachada"
        )

        self.assertEqual(visit.id_ubicacion, 31)
        self.assertEqual(response["numero_propiedad"], 1)
        location_data = create_location.call_args.args[1]
        self.assertEqual(location_data.id_cliente, 5)
        self.assertEqual(location_data.direccion, "Sector Norte")
        self.assertIsNone(location_data.latitud)
        self.assertIsNone(location_data.longitud)
        self.assertEqual(create_location.call_args.args[2], b"fachada")
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    @patch("app.services.visitas_tecnicas.create_ubicacion_cliente_in_transaction")
    @patch("app.services.visitas_tecnicas._locked_visit")
    def test_visita_con_propiedad_rechaza_segunda_creacion(
        self, locked_visit, create_location
    ) -> None:
        db = MagicMock()
        locked_visit.return_value = SimpleNamespace(
            id_cliente=5,
            id_empleado=7,
            id_ubicacion=31,
            estado="Programada",
        )

        with self.assertRaises(UbicacionVisitaExistenteError):
            registrar_primera_ubicacion(db, 15, self._data(), current_employee_id=7)

        create_location.assert_not_called()
        db.commit.assert_not_called()

    @patch("app.services.visitas_tecnicas.create_ubicacion_cliente_in_transaction")
    @patch("app.services.visitas_tecnicas._locked_visit")
    def test_tecnico_no_asignado_no_puede_registrar(
        self, locked_visit, create_location
    ) -> None:
        db = MagicMock()
        locked_visit.return_value = SimpleNamespace(
            id_cliente=5,
            id_empleado=7,
            id_ubicacion=None,
            estado="Programada",
        )

        with self.assertRaises(VisitaNoAsignadaError):
            registrar_primera_ubicacion(db, 15, self._data(), current_employee_id=9)

        create_location.assert_not_called()
        self.assertEqual(_business_error(VisitaNoAsignadaError()).status_code, 403)

    @patch("app.services.visitas_tecnicas.remove_image_file")
    @patch("app.services.visitas_tecnicas.create_ubicacion_cliente_in_transaction")
    @patch("app.services.visitas_tecnicas._locked_visit")
    def test_fallo_de_vinculacion_revierte_y_elimina_fotografia(
        self, locked_visit, create_location, remove_image
    ) -> None:
        db = MagicMock()
        db.flush.side_effect = RuntimeError("fallo al vincular")
        locked_visit.return_value = SimpleNamespace(
            id_cliente=5,
            id_empleado=7,
            id_ubicacion=None,
            estado="Programada",
        )
        saved_image = Path("fachada_31.webp")
        create_location.return_value = (
            SimpleNamespace(id_ubicacion=31, numero_propiedad=1),
            saved_image,
        )

        with self.assertRaises(RuntimeError):
            registrar_primera_ubicacion(
                db, 15, self._data(), current_employee_id=7, image_content=b"fachada"
            )

        db.rollback.assert_called_once()
        db.commit.assert_not_called()
        remove_image.assert_called_once_with(saved_image)

    @patch("app.services.visitas_tecnicas.create_ubicacion_cliente_in_transaction")
    @patch("app.services.visitas_tecnicas._locked_visit")
    def test_segunda_solicitud_bloqueada_detecta_vinculo_existente(
        self, locked_visit, create_location
    ) -> None:
        db = MagicMock()
        # Representa la fila releída después de esperar el commit de la primera solicitud.
        locked_visit.return_value = SimpleNamespace(
            id_cliente=5,
            id_empleado=7,
            id_ubicacion=31,
            estado="Programada",
        )

        with self.assertRaises(UbicacionVisitaExistenteError):
            registrar_primera_ubicacion(db, 15, self._data(), current_employee_id=7)

        create_location.assert_not_called()

    def test_bloqueo_concurrente_usa_for_update_sobre_visita(self) -> None:
        from sqlalchemy.dialects import postgresql

        db = MagicMock()
        db.scalar.return_value = SimpleNamespace(id_visita=15)

        _locked_visit(db, 15)

        query = db.scalar.call_args.args[0]
        compiled = str(query.compile(dialect=postgresql.dialect()))
        self.assertIn("FOR UPDATE OF visitas_tecnicas", compiled)

    def test_endpoint_atomico_conserva_seguridad_jwt(self) -> None:
        operation = app.openapi()["paths"][
            "/api/visitas-tecnicas/{id_visita}/ubicacion"
        ]["post"]

        self.assertEqual(operation["security"], [{"OAuth2PasswordBearer": []}])
        self.assertIn("201", operation["responses"])

    def test_tarea_expone_propiedad_existente_en_solo_lectura(self) -> None:
        visit = SimpleNamespace(
            id_visita=15,
            id_cliente=5,
            id_ubicacion=31,
            id_empleado=7,
            id_tipo_instalacion=2,
            fecha_programada=date(2026, 10, 5),
            hora_programada=time(9, 30),
            motivo_visita="Evaluar",
            estado="Programada",
            cliente=SimpleNamespace(nombres="Juan", apellidos="Perez"),
            empleado=SimpleNamespace(
                id_empleado=7,
                codigo="EMP-0007",
                nombres="Ana",
                apellidos="Lopez",
            ),
            tipo_instalacion=SimpleNamespace(nombre="Internet"),
            ubicacion=SimpleNamespace(
                numero_propiedad=1,
                direccion="Sector Norte",
                referencia="Frente al parque",
                foto_fachada="uploads/ubicaciones_clientes/ubicacion_31.webp",
                latitud=Decimal("14.6349142"),
                longitud=Decimal("-90.5068824"),
            ),
        )

        task = _visit_task(visit, current_employee_id=7)

        self.assertEqual(task["numero_propiedad"], 1)
        self.assertEqual(task["direccion_propiedad"], "Sector Norte")
        self.assertEqual(task["referencia_propiedad"], "Frente al parque")
        self.assertEqual(
            task["foto_fachada"],
            "/uploads/ubicaciones_clientes/ubicacion_31.webp",
        )
        self.assertEqual(task["latitud"], Decimal("14.6349142"))
        self.assertEqual(task["longitud"], Decimal("-90.5068824"))


if __name__ == "__main__":
    unittest.main()
