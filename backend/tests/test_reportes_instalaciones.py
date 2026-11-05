"""Pruebas del reporte administrativo de instalaciones."""

from datetime import date
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock

from app.main import app
from app.modules.instalaciones.schemas.reporte import ReporteInstalacionesResponse
from app.modules.instalaciones.services.reportes import (
    calcular_rango_reporte,
    generar_reporte_instalaciones,
)


class RangoReporteInstalacionesTests(unittest.TestCase):
    def test_calcula_periodo_diario(self) -> None:
        referencia = date(2026, 10, 21)
        self.assertEqual(
            calcular_rango_reporte("diario", referencia),
            (referencia, referencia),
        )

    def test_calcula_semana_de_lunes_a_domingo(self) -> None:
        self.assertEqual(
            calcular_rango_reporte("semanal", date(2026, 10, 21)),
            (date(2026, 10, 19), date(2026, 10, 25)),
        )

    def test_calcula_mes_incluso_bisiesto(self) -> None:
        self.assertEqual(
            calcular_rango_reporte("mensual", date(2028, 2, 10)),
            (date(2028, 2, 1), date(2028, 2, 29)),
        )


class ReporteInstalacionesServiceTests(unittest.TestCase):
    def _instalacion(self):
        encargado = SimpleNamespace(
            es_encargado=True,
            empleado=SimpleNamespace(nombres="Ana", apellidos="López"),
        )
        return SimpleNamespace(
            id_instalacion=8,
            fecha_programada=date(2026, 10, 21),
            hora_programada=None,
            estado="Completada",
            observaciones="Acceso coordinado",
            observaciones_tecnicas="Se instaló el equipo",
            cliente=SimpleNamespace(nombres="Luis", apellidos="Pérez"),
            visita=SimpleNamespace(
                tipo_instalacion=SimpleNamespace(nombre="Residencial")
            ),
            asignaciones=[encargado],
        )

    def test_genera_indicadores_y_filas_con_relaciones_reales(self) -> None:
        db = MagicMock()
        db.scalars.return_value.unique.return_value.all.return_value = [
            self._instalacion()
        ]

        resultado = generar_reporte_instalaciones(
            db, "semanal", date(2026, 10, 21), "Administrador Principal"
        )
        validado = ReporteInstalacionesResponse.model_validate(resultado)

        self.assertEqual(validado.fecha_inicio, date(2026, 10, 19))
        self.assertEqual(validado.fecha_fin, date(2026, 10, 25))
        self.assertEqual(validado.total_instalaciones, 1)
        self.assertEqual(validado.instalaciones[0].cliente, "Luis Pérez")
        self.assertEqual(validado.instalaciones[0].tipo_instalacion, "Residencial")
        self.assertEqual(validado.instalaciones[0].tecnico_responsable, "Ana López")
        self.assertIn("General: Acceso coordinado", validado.instalaciones[0].observaciones)
        self.assertIn("Técnicas: Se instaló", validado.instalaciones[0].observaciones)
        db.commit.assert_not_called()
        db.flush.assert_not_called()

    def test_reporte_vacio_conserva_todos_los_estados(self) -> None:
        db = MagicMock()
        db.scalars.return_value.unique.return_value.all.return_value = []

        resultado = generar_reporte_instalaciones(
            db, "diario", date(2026, 10, 21), "Administrador"
        )

        self.assertEqual(resultado["total_instalaciones"], 0)
        self.assertEqual(resultado["instalaciones"], [])
        self.assertEqual(
            resultado["estados"],
            [
                {"estado": "Programada", "cantidad": 0},
                {"estado": "En Proceso", "cantidad": 0},
                {"estado": "Completada", "cantidad": 0},
            ],
        )

    def test_sin_encargado_o_visita_no_inventa_datos(self) -> None:
        db = MagicMock()
        instalacion = self._instalacion()
        instalacion.visita = None
        instalacion.asignaciones = []
        instalacion.observaciones = None
        instalacion.observaciones_tecnicas = None
        db.scalars.return_value.unique.return_value.all.return_value = [instalacion]

        resultado = generar_reporte_instalaciones(
            db, "diario", date(2026, 10, 21), "Administrador"
        )
        fila = resultado["instalaciones"][0]

        self.assertIsNone(fila["tipo_instalacion"])
        self.assertIsNone(fila["tecnico_responsable"])
        self.assertIsNone(fila["observaciones"])


class ReporteInstalacionesSecurityTests(unittest.TestCase):
    def test_endpoint_declara_jwt_y_filtros_tipados(self) -> None:
        operation = app.openapi()["paths"]["/api/instalaciones/reporte"]["get"]

        self.assertEqual(operation["security"], [{"OAuth2PasswordBearer": []}])
        parameters = {item["name"]: item for item in operation["parameters"]}
        self.assertEqual(set(parameters), {"periodo", "fecha"})
        self.assertTrue(parameters["periodo"]["required"])
        self.assertTrue(parameters["fecha"]["required"])


if __name__ == "__main__":
    unittest.main()
