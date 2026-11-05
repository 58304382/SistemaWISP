"""Pruebas de los reportes administrativos de solo lectura."""

from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock

from app.main import app
from app.modules.cotizaciones.schemas.reporte import ReporteCotizacionesResponse
from app.modules.cotizaciones.services.reportes import generar_reporte_cotizaciones
from app.modules.finanzas.schemas.reporte import (
    ReporteCajaResponse,
    ReporteCobrosResponse,
)
from app.modules.finanzas.services.reportes import (
    generar_reporte_caja,
    generar_reporte_cobros,
)
from app.modules.soporte_tecnico.schemas.reporte import ReporteSoporteResponse
from app.modules.soporte_tecnico.services.reportes import generar_reporte_soporte


class ReporteCotizacionesServiceTests(unittest.TestCase):
    def _cotizacion(self, estado: str, numero: str):
        return SimpleNamespace(
            id_cotizacion=1,
            numero_cotizacion=numero,
            fecha=date(2026, 10, 21),
            origen="DIRECTA",
            estado=estado,
            porcentaje_descuento=Decimal("0.00"),
            cliente=SimpleNamespace(nombres="Ana", apellidos="López"),
            detalles=[
                SimpleNamespace(
                    cantidad=Decimal("2"), precio_unitario=Decimal("10.00")
                )
            ],
            evaluacion_orden=None,
        )

    def test_resume_cotizaciones_y_reutiliza_calcular_totales(self) -> None:
        db = MagicMock()
        db.scalars.return_value.unique.return_value.all.return_value = [
            self._cotizacion("GENERADA", "COT-2026-0001"),
            self._cotizacion("ACEPTADA", "COT-2026-0002"),
        ]

        resultado = generar_reporte_cotizaciones(
            db, "diario", date(2026, 10, 21), "Administrador"
        )
        validado = ReporteCotizacionesResponse.model_validate(resultado)

        self.assertEqual(validado.total_cotizaciones, 2)
        self.assertEqual(validado.pendientes, 1)
        self.assertEqual(validado.aceptadas, 1)
        self.assertEqual(validado.importe_total, Decimal("40.00"))
        self.assertEqual(validado.cotizaciones[0].referencia, "COT-2026-0001")
        db.commit.assert_not_called()
        db.flush.assert_not_called()

    def test_una_proforma_no_duplica_la_cotizacion(self) -> None:
        db = MagicMock()
        db.scalars.return_value.unique.return_value.all.return_value = [
            self._cotizacion("COMPLETADA", "COT-2026-0003")
        ]

        resultado = generar_reporte_cotizaciones(
            db, "diario", date(2026, 10, 21), "Administrador"
        )

        self.assertEqual(resultado["total_cotizaciones"], 1)
        self.assertEqual(resultado["importe_total"], Decimal("20.00"))
        self.assertEqual(resultado["aceptadas"], 1)


class ReporteCobrosServiceTests(unittest.TestCase):
    def test_solo_pagos_persistidos_y_desglose_por_concepto(self) -> None:
        db = MagicMock()
        pago = SimpleNamespace(
            id_pago=1,
            fecha_hora=datetime(2026, 10, 21, 10, 30),
            monto_total=Decimal("100.00"),
            referencia="REF-01",
            cliente=SimpleNamespace(nombres="Luis", apellidos="Pérez"),
            metodo_pago=SimpleNamespace(nombre="Efectivo"),
        )
        pagos = MagicMock()
        pagos.unique.return_value.all.return_value = [pago]
        detalles = MagicMock()
        detalles.all.return_value = [
            SimpleNamespace(id_pago=1, concepto="Internet", monto_aplicado=Decimal("60.00")),
            SimpleNamespace(
                id_pago=1, concepto="Instalación", monto_aplicado=Decimal("30.00")
            ),
        ]
        db.scalars.side_effect = [pagos, detalles]

        resultado = generar_reporte_cobros(
            db, "diario", date(2026, 10, 21), "Administrador"
        )
        validado = ReporteCobrosResponse.model_validate(resultado)

        self.assertEqual(validado.total_pagos, 1)
        self.assertEqual(validado.total_cobrado, Decimal("100.00"))
        self.assertEqual(
            [(item.concepto, item.importe) for item in validado.conceptos],
            [
                ("Internet", Decimal("60.00")),
                ("Instalación", Decimal("30.00")),
                ("Sin aplicar", Decimal("10.00")),
            ],
        )
        self.assertEqual(validado.cobros[0].concepto, "Instalación, Internet")
        db.commit.assert_not_called()

    def test_reporte_vacio_no_consulta_detalles(self) -> None:
        db = MagicMock()
        pagos = MagicMock()
        pagos.unique.return_value.all.return_value = []
        db.scalars.return_value = pagos

        resultado = generar_reporte_cobros(
            db, "diario", date(2026, 10, 21), "Administrador"
        )

        self.assertEqual(resultado["total_pagos"], 0)
        self.assertEqual(resultado["total_cobrado"], Decimal("0.00"))
        self.assertEqual(resultado["conceptos"], [])


class ReporteCajaServiceTests(unittest.TestCase):
    def _sesion_cerrada(self):
        return SimpleNamespace(
            id_sesion=1,
            fecha_apertura=datetime(2026, 10, 20, 8, 0),
            fecha_cierre=datetime(2026, 10, 20, 18, 0),
            saldo_inicial=Decimal("100.00"),
            saldo_final=Decimal("200.00"),
        )

    def _movimiento(self, tipo: str, monto: str, concepto: str):
        return SimpleNamespace(
            MovimientoCaja=SimpleNamespace(
                fecha_hora=datetime(2026, 10, 21, 10, 30),
                tipo=tipo,
                monto=Decimal(monto),
                concepto=concepto,
                referencia=None,
            ),
            MetodoPago=SimpleNamespace(nombre="Efectivo"),
            Empleado=SimpleNamespace(nombres="Luis", apellidos="Pérez"),
        )

    def test_conserva_saldo_continuo_y_suma_movimientos_confirmados(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [self._sesion_cerrada()]
        db.execute.return_value.all.return_value = [
            self._movimiento("Ingreso", "50.00", "Pago de instalaciones"),
            self._movimiento("Egreso", "20.00", "Compra de materiales"),
        ]

        resultado = generar_reporte_caja(
            db, "diario", date(2026, 10, 21), "Administrador"
        )
        validado = ReporteCajaResponse.model_validate(resultado)

        self.assertEqual(validado.saldo_inicial, Decimal("200.00"))
        self.assertEqual(validado.entradas, Decimal("50.00"))
        self.assertEqual(validado.salidas, Decimal("20.00"))
        self.assertEqual(validado.saldo_esperado, Decimal("230.00"))
        self.assertEqual(validado.total_movimientos, 2)
        self.assertEqual(validado.movimientos[0].hora.strftime("%H:%M"), "10:30")
        db.commit.assert_not_called()


class ReporteSoporteServiceTests(unittest.TestCase):
    def test_usa_estados_reales_y_resultado_del_historial(self) -> None:
        db = MagicMock()
        db.scalars.return_value.unique.return_value.all.return_value = [
            SimpleNamespace(
                id_ticket=1,
                fecha_apertura=datetime(2026, 10, 21, 9, 0),
                estado="Completada",
                cliente=SimpleNamespace(nombres="Ana", apellidos="López"),
                categoria=SimpleNamespace(nombre="Internet"),
                tecnico=SimpleNamespace(nombres="Luis", apellidos="Pérez"),
                historial=[
                    SimpleNamespace(resultado_solucion=None),
                    SimpleNamespace(resultado_solucion="Servicio restablecido"),
                ],
            )
        ]

        resultado = generar_reporte_soporte(
            db, "diario", date(2026, 10, 21), "Administrador"
        )
        validado = ReporteSoporteResponse.model_validate(resultado)

        self.assertEqual(validado.total_tickets, 1)
        self.assertEqual(validado.programados, 0)
        self.assertEqual(validado.en_proceso, 0)
        self.assertEqual(validado.completados, 1)
        self.assertEqual(validado.tickets[0].resultado, "Servicio restablecido")
        self.assertEqual(validado.tickets[0].tecnico, "Luis Pérez")
        db.commit.assert_not_called()


class ReportesAdministrativosSecurityTests(unittest.TestCase):
    def test_los_cuatro_endpoints_exigen_jwt_y_filtros_tipados(self) -> None:
        paths = app.openapi()["paths"]
        for ruta in (
            "/api/cotizaciones/reporte",
            "/api/cobros/reporte",
            "/api/caja/reporte",
            "/api/tickets/reporte",
        ):
            with self.subTest(ruta=ruta):
                operation = paths[ruta]["get"]
                self.assertEqual(operation["security"], [{"OAuth2PasswordBearer": []}])
                parameters = {item["name"]: item for item in operation["parameters"]}
                self.assertEqual(set(parameters), {"periodo", "fecha"})
                self.assertTrue(parameters["periodo"]["required"])
                self.assertTrue(parameters["fecha"]["required"])


if __name__ == "__main__":
    unittest.main()
