"""Pruebas de la proyección de propiedades de instalaciones en Tareas."""

from datetime import date, time
from decimal import Decimal
from types import SimpleNamespace
import unittest

from app.services.tareas import _installation_task


class TareaInstalacionUbicacionTests(unittest.TestCase):
    def _installation(self, *, id_ubicacion: int | None, ubicacion: object | None):
        employee = SimpleNamespace(
            id_empleado=7,
            codigo="EMP-0007",
            nombres="Ana",
            apellidos="Lopez",
        )
        assignment = SimpleNamespace(
            id_empleado=7,
            es_encargado=True,
            empleado=employee,
        )
        return SimpleNamespace(
            id_instalacion=9,
            id_visita=15,
            id_cliente=5,
            id_ubicacion=id_ubicacion,
            ubicacion=ubicacion,
            fecha_programada=date(2026, 10, 5),
            hora_programada=time(9, 30),
            observaciones=None,
            estado="Programada",
            cliente=SimpleNamespace(nombres="Juan", apellidos="Perez"),
            visita=SimpleNamespace(
                id_ubicacion=31,
                motivo_visita="Instalar enlace",
                id_tipo_instalacion=2,
                tipo_instalacion=SimpleNamespace(nombre="Internet"),
            ),
            asignaciones=[assignment],
        )

    def test_instalacion_expone_su_propiedad_directa_y_no_la_de_la_visita(self) -> None:
        location = SimpleNamespace(
            id_ubicacion=44,
            numero_propiedad=2,
            direccion="Sector Norte",
            referencia="Frente al parque",
            foto_fachada="uploads/ubicaciones_clientes/ubicacion_44.webp",
            latitud=Decimal("14.6349142"),
            longitud=Decimal("-90.5068824"),
        )

        task = _installation_task(
            self._installation(id_ubicacion=44, ubicacion=location),
            current_employee_id=7,
            actions_enabled=True,
        )

        self.assertEqual(task["id_ubicacion"], 44)
        self.assertEqual(task["numero_propiedad"], 2)
        self.assertEqual(task["direccion_propiedad"], "Sector Norte")
        self.assertEqual(task["referencia_propiedad"], "Frente al parque")
        self.assertEqual(
            task["foto_fachada"],
            "/uploads/ubicaciones_clientes/ubicacion_44.webp",
        )
        self.assertEqual(task["latitud"], Decimal("14.6349142"))
        self.assertEqual(task["longitud"], Decimal("-90.5068824"))
        self.assertTrue(task["ubicacion_disponible"])

    def test_instalacion_historica_sin_propiedad_no_inventa_coordenadas(self) -> None:
        task = _installation_task(
            self._installation(id_ubicacion=None, ubicacion=None),
            current_employee_id=7,
            actions_enabled=True,
        )

        self.assertIsNone(task["id_ubicacion"])
        self.assertIsNone(task["numero_propiedad"])
        self.assertIsNone(task["latitud"])
        self.assertIsNone(task["longitud"])
        self.assertFalse(task["ubicacion_disponible"])


if __name__ == "__main__":
    unittest.main()
