"""Pruebas automatizadas de cálculos, filtros y permisos del Dashboard.

Las pruebas usan objetos simulados y no modifican PostgreSQL ni ejecutan
operaciones de escritura.
"""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock

from fastapi import HTTPException
from fastapi.testclient import TestClient

import app.models  # Registra todas las relaciones ORM para compilar las consultas.
from app.core.database import get_db
from app.core.security import create_access_token
from app.main import app
from app.modules.dashboard.routers.dashboard import (
    DASHBOARD_MODULE_CODE,
    require_dashboard_access,
)
from app.modules.dashboard.schemas.dashboard import (
    DashboardComercialResponse,
    DashboardFinancieroResponse,
    DashboardOperativoResponse,
    ResumenDashboardResponse,
)
from app.modules.dashboard.services.dashboard import (
    PeriodoDashboardInvalidoError,
    calcular_indicadores_clientes,
    calcular_indicadores_financieros,
    calcular_indicadores_servicios,
    calcular_series_financieras,
    calcular_series_operativas,
    granularidad_serie,
    obtener_dashboard_comercial,
    obtener_dashboard_financiero,
    obtener_dashboard_operativo,
    obtener_resumen,
    resolver_periodo,
)


# ==========================================
# UTILIDADES DE PRUEBA
# ==========================================
def _resultado(rows):
    resultado = MagicMock()
    resultado.all.return_value = rows
    return resultado


def _usuario(rol: str, modulos: list | None = None):
    return SimpleNamespace(
        id=1,
        username="usuario-prueba",
        rol=SimpleNamespace(nombre=rol),
        modulos=modulos or [],
    )


def _filas_financieras():
    """Filas simuladas de las cuatro agregaciones financieras, en orden."""

    return [
        _resultado(
            [
                ("INTERNET", Decimal("100.00"), 2),
                ("INSTALACIONES", Decimal("50.00"), 1),
            ]
        ),
        _resultado([("INTERNET", Decimal("90.00"), 2)]),
        _resultado([("INTERNET", Decimal("30.00"), 3)]),
        _resultado([("INTERNET", Decimal("10.00"), 1)]),
    ]


# ==========================================
# FILTROS DE PERÍODO
# ==========================================
class PeriodoDashboardTests(unittest.TestCase):
    referencia = date(2026, 11, 4)

    def test_resuelve_hoy_semana_y_mes(self):
        self.assertEqual(
            resolver_periodo("hoy", fecha_referencia=self.referencia),
            (self.referencia, self.referencia),
        )
        self.assertEqual(
            resolver_periodo("semana", fecha_referencia=self.referencia),
            (date(2026, 11, 2), date(2026, 11, 8)),
        )
        self.assertEqual(
            resolver_periodo("mes", fecha_referencia=self.referencia),
            (date(2026, 11, 1), date(2026, 11, 30)),
        )

    def test_rango_personalizado_valida_y_elige_granularidad(self):
        inicio, fin = resolver_periodo(
            "personalizado",
            fecha_inicio=date(2026, 1, 1),
            fecha_fin=date(2026, 1, 31),
        )
        self.assertEqual((inicio, fin), (date(2026, 1, 1), date(2026, 1, 31)))
        self.assertEqual(granularidad_serie(inicio, fin), "diaria")
        self.assertEqual(
            granularidad_serie(date(2026, 1, 1), date(2026, 12, 31)),
            "mensual",
        )

    def test_rango_personalizado_incompleto_invertido_o_inexistente_falla(self):
        with self.assertRaises(PeriodoDashboardInvalidoError):
            resolver_periodo("personalizado", fecha_inicio=date(2026, 1, 1))
        with self.assertRaises(PeriodoDashboardInvalidoError):
            resolver_periodo(
                "personalizado",
                fecha_inicio=date(2026, 2, 1),
                fecha_fin=date(2026, 1, 1),
            )
        with self.assertRaises(PeriodoDashboardInvalidoError):
            resolver_periodo("trimestre", fecha_referencia=self.referencia)


# ==========================================
# CÁLCULOS FINANCIEROS
# ==========================================
class IndicadoresFinancierosTests(unittest.TestCase):
    def test_no_duplica_ingresos_de_caja_y_separa_pagos_de_aplicaciones(self):
        db = MagicMock()
        db.execute.side_effect = _filas_financieras()

        resultado = calcular_indicadores_financieros(
            db, date(2026, 11, 1), date(2026, 11, 30)
        )

        self.assertEqual(resultado["ingresos"], Decimal("150.00"))
        self.assertEqual(resultado["cobros_aplicados"], Decimal("90.00"))
        self.assertEqual(resultado["cartera_pendiente"], Decimal("30.00"))
        self.assertEqual(resultado["documentos_pendientes"], 3)
        self.assertEqual(resultado["morosidad_monto"], Decimal("10.00"))
        self.assertEqual(resultado["documentos_vencidos"], 1)
        self.assertEqual(
            resultado["ingresos_por_origen"],
            [
                {
                    "origen": "INSTALACIONES",
                    "monto": Decimal("50.00"),
                    "cantidad": 1,
                },
                {
                    "origen": "INTERNET",
                    "monto": Decimal("100.00"),
                    "cantidad": 2,
                },
            ],
        )
        db.commit.assert_not_called()
        db.flush.assert_not_called()

    def test_las_consultas_financieras_no_suman_movimientos_de_caja(self):
        db = MagicMock()
        db.execute.side_effect = _filas_financieras()

        calcular_indicadores_financieros(db, date(2026, 11, 1), date(2026, 11, 30))

        sentencias = [str(llamada.args[0]).lower() for llamada in db.execute.call_args_list]
        self.assertTrue(any("pagos" in sentencia for sentencia in sentencias))
        self.assertFalse(
            any("movimientos_caja" in sentencia for sentencia in sentencias)
        )


class IndicadoresClientesServiciosTests(unittest.TestCase):
    def test_clientes_y_servicios_se_agregan_por_estado(self):
        db_clientes = MagicMock()
        db_clientes.execute.return_value = _resultado(
            [("Activo", 5), ("Inactivo", 1)]
        )
        clientes = calcular_indicadores_clientes(db_clientes)
        self.assertEqual(clientes["total"], 6)
        self.assertEqual(clientes["activos"], 5)
        self.assertEqual(clientes["inactivos"], 1)

        db_servicios = MagicMock()
        db_servicios.execute.return_value = _resultado(
            [
                ("Activo", 2, Decimal("800.00"), 2),
                ("Inactivo", 1, Decimal("100.00"), 1),
            ]
        )
        servicios = calcular_indicadores_servicios(db_servicios)
        self.assertEqual(servicios["total"], 3)
        self.assertEqual(servicios["activos"], 2)
        self.assertEqual(servicios["inactivos"], 1)
        self.assertEqual(servicios["clientes_con_servicio_activo"], 2)
        self.assertEqual(
            servicios["ingreso_mensual_contratado"], Decimal("800.00")
        )


# ==========================================
# RESPUESTA CONSOLIDADA
# ==========================================
class ResumenDashboardTests(unittest.TestCase):
    def _db_resumen(self):
        db = MagicMock()
        db.execute.side_effect = [
            *_filas_financieras(),
            _resultado([("Activo", 5), ("Inactivo", 1)]),
            _resultado(
                [
                    ("Activo", 2, Decimal("800.00"), 2),
                    ("Inactivo", 1, Decimal("100.00"), 1),
                ]
            ),
            _resultado([("Programada", 2), ("Completada", 1)]),
            _resultado([("En Proceso", 1)]),
            _resultado(
                [
                    ("GENERADA", 2),
                    ("ACEPTADA", 1),
                    ("COMPLETADA", 1),
                ]
            ),
            _resultado([("Pendiente", 1), ("Completada", 2)]),
            _resultado([("Programada", 3), ("En Proceso", 1)]),
        ]
        return db

    def test_resumen_consolida_indicadores_y_conteos_sin_escribir(self):
        db = self._db_resumen()

        resultado = obtener_resumen(
            db, "hoy", fecha_referencia=date(2026, 11, 4)
        )
        validado = ResumenDashboardResponse.model_validate(resultado)

        self.assertEqual(validado.periodo.fecha_inicio, date(2026, 11, 4))
        self.assertEqual(validado.periodo.fecha_fin, date(2026, 11, 4))
        self.assertEqual(validado.financiero.ingresos, Decimal("150.00"))
        self.assertEqual(validado.financiero.cartera_pendiente, Decimal("30.00"))
        self.assertEqual(validado.clientes.total, 6)
        self.assertEqual(validado.servicios.activos, 2)
        self.assertEqual(validado.operativo.visitas_tecnicas.total, 3)
        self.assertEqual(validado.operativo.instalaciones.total, 1)
        self.assertEqual(validado.operativo.cotizaciones.total, 4)
        self.assertEqual(validado.operativo.ordenes_trabajo.total, 3)
        self.assertEqual(validado.operativo.tickets.total, 4)
        db.commit.assert_not_called()
        db.flush.assert_not_called()


# ==========================================
# SERIES PARA GRÁFICAS
# ==========================================
class SeriesDashboardTests(unittest.TestCase):
    def test_series_financieras_completan_dias_sin_datos(self):
        db = MagicMock()
        db.execute.side_effect = [
            _resultado([(date(2026, 11, 1), Decimal("10.00"))]),
            _resultado([]),
            _resultado([(date(2026, 11, 2), Decimal("5.00"), 1)]),
        ]

        resultado = calcular_series_financieras(
            db, date(2026, 11, 1), date(2026, 11, 2), "diaria"
        )

        self.assertEqual(
            resultado["ingresos"],
            [
                {"fecha": date(2026, 11, 1), "monto": Decimal("10.00")},
                {"fecha": date(2026, 11, 2), "monto": Decimal("0.00")},
            ],
        )
        self.assertEqual(
            resultado["cobros_aplicados"],
            [
                {"fecha": date(2026, 11, 1), "monto": Decimal("0.00")},
                {"fecha": date(2026, 11, 2), "monto": Decimal("0.00")},
            ],
        )
        self.assertEqual(
            resultado["cartera_por_vencimiento"][1],
            {
                "fecha": date(2026, 11, 2),
                "monto": Decimal("5.00"),
                "documentos": 1,
            },
        )

    def test_series_operativas_completan_dias_y_usan_conteo_cero(self):
        db = MagicMock()
        db.execute.side_effect = [
            _resultado([(date(2026, 11, 1), 2)]),
            _resultado([]),
            _resultado([(date(2026, 11, 2), 1)]),
            _resultado([]),
            _resultado([(date(2026, 11, 1), 3)]),
        ]

        resultado = calcular_series_operativas(
            db, date(2026, 11, 1), date(2026, 11, 2), "diaria"
        )

        self.assertEqual(len(resultado["visitas_tecnicas"]), 2)
        self.assertEqual(resultado["visitas_tecnicas"][0]["cantidad"], 2)
        self.assertEqual(resultado["visitas_tecnicas"][1]["cantidad"], 0)
        self.assertEqual(resultado["instalaciones"][1]["cantidad"], 0)
        self.assertEqual(resultado["cotizaciones"][1]["cantidad"], 1)
        self.assertEqual(resultado["tickets"][0]["cantidad"], 3)


# ==========================================
# RESPUESTAS ESPECÍFICAS DE ENDPOINTS
# ==========================================
class RespuestasDashboardTests(unittest.TestCase):
    def test_financiero_comercial_y_operativo_validan_sus_contratos(self):
        # Financiero: 4 agregados + 3 series.
        db_financiero = MagicMock()
        db_financiero.execute.side_effect = [
            *_filas_financieras(),
            _resultado([]),
            _resultado([]),
            _resultado([]),
        ]
        financiero = DashboardFinancieroResponse.model_validate(
            obtener_dashboard_financiero(
                db_financiero, "hoy", fecha_referencia=date(2026, 11, 4)
            )
        )
        self.assertEqual(financiero.indicadores.ingresos, Decimal("150.00"))
        self.assertEqual(len(financiero.series.ingresos), 1)

        # Comercial: clientes, servicios, conteo de cotizaciones y 2 series.
        db_comercial = MagicMock()
        db_comercial.execute.side_effect = [
            _resultado([("Activo", 2)]),
            _resultado([("Activo", 1, Decimal("200.00"), 1)]),
            _resultado([("GENERADA", 2)]),
            _resultado([]),
            _resultado([]),
        ]
        comercial = DashboardComercialResponse.model_validate(
            obtener_dashboard_comercial(
                db_comercial, "hoy", fecha_referencia=date(2026, 11, 4)
            )
        )
        self.assertEqual(comercial.clientes.total, 2)
        self.assertEqual(comercial.cotizaciones.total, 2)

        # Operativo: 5 conteos + 5 series.
        db_operativo = MagicMock()
        db_operativo.execute.side_effect = [
            _resultado([]),
            _resultado([]),
            _resultado([]),
            _resultado([]),
            _resultado([]),
            _resultado([]),
            _resultado([]),
            _resultado([]),
            _resultado([]),
            _resultado([]),
        ]
        operativo = DashboardOperativoResponse.model_validate(
            obtener_dashboard_operativo(
                db_operativo, "hoy", fecha_referencia=date(2026, 11, 4)
            )
        )
        self.assertEqual(operativo.operativo.visitas_tecnicas.total, 0)
        self.assertEqual(len(operativo.series.tickets), 1)


# ==========================================
# PERMISOS
# ==========================================
class PermisoDashboardTests(unittest.TestCase):
    def test_codigo_de_permiso_es_dashboard(self):
        self.assertEqual(DASHBOARD_MODULE_CODE, "dashboard")

    def test_empleado_con_permiso_activo_accede(self):
        usuario = _usuario(
            "Empleado",
            [SimpleNamespace(codigo="dashboard", activo=True)],
        )
        self.assertIs(require_dashboard_access(usuario), usuario)

    def test_empleado_sin_permiso_o_permiso_inactivo_recibe_403(self):
        for modulos in (
            [],
            [SimpleNamespace(codigo="reportes", activo=True)],
            [SimpleNamespace(codigo="dashboard", activo=False)],
        ):
            with self.subTest(modulos=modulos):
                with self.assertRaises(HTTPException) as contexto:
                    require_dashboard_access(_usuario("Empleado", modulos))
                self.assertEqual(contexto.exception.status_code, 403)

    def test_administrador_conserva_su_acceso_administrativo(self):
        usuario = _usuario("Administrador", [])
        self.assertIs(require_dashboard_access(usuario), usuario)


class PermisoEndpointsDashboardTests(unittest.TestCase):
    """Comprueba que las cuatro rutas quedan protegidas por JWT y permiso."""

    rutas = (
        "/api/dashboard/resumen",
        "/api/dashboard/financiero",
        "/api/dashboard/comercial",
        "/api/dashboard/operativo",
    )

    def setUp(self):
        self.previos = app.dependency_overrides.copy()
        self.usuario = _usuario("Empleado", [])
        self.db = MagicMock()
        self.db.scalar.return_value = self.usuario
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.previos)

    def _headers(self):
        token = create_access_token(
            subject="1",
            username=self.usuario.username,
            role="Empleado",
        )
        return {"Authorization": f"Bearer {token}"}

    def test_los_cuatro_endpoints_exigen_token(self):
        for ruta in self.rutas:
            with self.subTest(ruta=ruta):
                self.assertEqual(self.client.get(ruta).status_code, 401)

    def test_empleado_sin_permiso_dashboard_recibe_403_en_todas_las_rutas(self):
        for ruta in self.rutas:
            with self.subTest(ruta=ruta):
                respuesta = self.client.get(ruta, headers=self._headers())
                self.assertEqual(respuesta.status_code, 403)
        self.db.execute.assert_not_called()
        self.db.commit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
