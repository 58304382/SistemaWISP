"""Pruebas de numeración transaccional para propiedades de clientes."""

from datetime import datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from pydantic import ValidationError
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError

from app.schemas.ubicacion_cliente import (
    UbicacionClienteCreate,
    UbicacionClienteResponse,
    UbicacionClienteUpdate,
)
from app.services.ubicaciones_cliente import (
    PROPERTY_NUMBER_CONSTRAINT,
    UbicacionClienteConflictError,
    _response,
    create_ubicacion_cliente,
    create_ubicacion_cliente_in_transaction,
)


def _integrity_error(constraint_name: str) -> IntegrityError:
    original = Exception("conflicto de integridad")
    original.diag = SimpleNamespace(constraint_name=constraint_name)  # type: ignore[attr-defined]
    return IntegrityError("INSERT", {}, original)


class UbicacionesClienteNumberingTests(unittest.TestCase):
    """Verifica correlativos, bloqueo, retry y limpieza de archivos."""

    def _create_with_number(self, next_number: int, client_id: int = 7):
        db = MagicMock()
        db.scalar.side_effect = [client_id, next_number]
        expected = {"numero_propiedad": next_number}
        data = UbicacionClienteCreate(id_cliente=client_id)

        with patch(
            "app.services.ubicaciones_cliente.get_ubicacion_cliente",
            return_value=expected,
        ):
            response = create_ubicacion_cliente(db, data)

        location = db.add.call_args.args[0]
        return db, location, response

    def test_primera_propiedad_recibe_numero_uno_y_bloquea_cliente(self) -> None:
        db, location, response = self._create_with_number(1)

        self.assertEqual(location.numero_propiedad, 1)
        self.assertEqual(response["numero_propiedad"], 1)
        lock_query = db.scalar.call_args_list[0].args[0]
        compiled = str(lock_query.compile(dialect=postgresql.dialect()))
        self.assertIn("FOR UPDATE OF clientes", compiled)
        db.commit.assert_called_once()

    def test_siguiente_propiedad_recibe_numero_dos(self) -> None:
        _db, location, _response_data = self._create_with_number(2)

        self.assertEqual(location.numero_propiedad, 2)

    def test_no_rellena_huecos_y_asigna_cuatro_despues_de_uno_y_tres(self) -> None:
        _db, location, _response_data = self._create_with_number(4)

        self.assertEqual(location.numero_propiedad, 4)

    def test_clientes_diferentes_pueden_tener_propiedad_uno(self) -> None:
        _db_a, location_a, _response_a = self._create_with_number(1, client_id=7)
        _db_b, location_b, _response_b = self._create_with_number(1, client_id=9)

        self.assertEqual((location_a.id_cliente, location_a.numero_propiedad), (7, 1))
        self.assertEqual((location_b.id_cliente, location_b.numero_propiedad), (9, 1))

    def test_response_incluye_numero_propiedad(self) -> None:
        location = SimpleNamespace(
            id_ubicacion=12,
            id_cliente=7,
            numero_propiedad=3,
            cliente=SimpleNamespace(nombres="Ana", apellidos="López"),
            direccion="Zona 1",
            latitud=Decimal("14.1234567"),
            longitud=Decimal("-90.1234567"),
            foto_fachada=None,
            referencia=None,
            observaciones=None,
            estado="Activo",
            fecha_registro=datetime(2026, 10, 2, 10, 0),
        )

        response = UbicacionClienteResponse.model_validate(_response(location))

        self.assertEqual(response.numero_propiedad, 3)

    def test_numero_propiedad_no_se_acepta_en_create_ni_update(self) -> None:
        with self.assertRaises(ValidationError):
            UbicacionClienteCreate.model_validate(
                {"id_cliente": 7, "numero_propiedad": 99}
            )
        with self.assertRaises(ValidationError):
            UbicacionClienteUpdate.model_validate({"numero_propiedad": 99})

    def test_conflicto_de_numeracion_reintenta_una_vez_con_nueva_instancia(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [7, 1, 7, 2]
        db.flush.side_effect = [_integrity_error(PROPERTY_NUMBER_CONSTRAINT), None]
        data = UbicacionClienteCreate(id_cliente=7)

        with patch(
            "app.services.ubicaciones_cliente.get_ubicacion_cliente",
            return_value={"numero_propiedad": 2},
        ):
            response = create_ubicacion_cliente(db, data)

        first_location = db.add.call_args_list[0].args[0]
        second_location = db.add.call_args_list[1].args[0]
        self.assertIsNot(first_location, second_location)
        self.assertEqual(first_location.numero_propiedad, 1)
        self.assertEqual(second_location.numero_propiedad, 2)
        self.assertEqual(response["numero_propiedad"], 2)
        db.rollback.assert_called_once()
        db.commit.assert_called_once()

    @patch("app.services.ubicaciones_cliente.remove_image_file")
    @patch("app.services.ubicaciones_cliente.store_image")
    def test_rollback_elimina_fotografia_y_no_reintenta_otro_conflicto(
        self,
        store_image,
        remove_image_file,
    ) -> None:
        saved_image = Path("ubicacion_7.webp")
        store_image.return_value = (
            "uploads/ubicaciones_clientes/ubicacion_7.webp",
            saved_image,
        )
        db = MagicMock()
        db.scalar.side_effect = [7, 1]
        db.commit.side_effect = _integrity_error("otra_restriccion")

        with self.assertRaises(UbicacionClienteConflictError):
            create_ubicacion_cliente(
                db,
                UbicacionClienteCreate(id_cliente=7),
                image_content=b"imagen",
            )

        db.rollback.assert_called_once()
        self.assertEqual(db.add.call_count, 1)
        remove_image_file.assert_called_once_with(saved_image)

    @patch("app.services.ubicaciones_cliente.store_image")
    def test_helper_atomico_genera_numero_y_guarda_fachada_sin_commit(
        self, store_image
    ) -> None:
        db = MagicMock()
        db.scalar.side_effect = [7, 1]
        saved_image = Path("ubicacion_31.webp")
        store_image.return_value = (
            "uploads/ubicaciones_clientes/ubicacion_31.webp",
            saved_image,
        )

        def assign_id() -> None:
            db.add.call_args.args[0].id_ubicacion = 31

        db.flush.side_effect = assign_id

        location, stored_path = create_ubicacion_cliente_in_transaction(
            db,
            UbicacionClienteCreate(id_cliente=7, direccion="Sector Norte"),
            image_content=b"fachada",
        )

        self.assertEqual(location.numero_propiedad, 1)
        self.assertEqual(location.foto_fachada, store_image.return_value[0])
        self.assertEqual(stored_path, saved_image)
        store_image.assert_called_once_with(
            b"fachada", "ubicaciones_clientes", "ubicacion", 31
        )
        db.commit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
