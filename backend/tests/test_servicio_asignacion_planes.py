"""Pruebas de reglas críticas de la asignación de planes sin modificar PostgreSQL."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace as NS
import unittest
from unittest.mock import MagicMock

from pydantic import ValidationError
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError

import app.models  # Registra relaciones dependientes antes de instanciar el modelo probado.
from app.modules.servicios.models.asignacion_plan import ServicioAsignacionPlan
from app.modules.servicios.schemas.asignacion_plan import (
    AsignacionPlanCreate,
    DiaVencimientoAsignacionUpdate,
)
from app.modules.servicios.services.asignaciones_planes import (
    AsignacionActivaDuplicadaError,
    AsignacionConRegistrosRelacionadosError,
    AsignacionInvalidaError,
    _get_cliente,
    create_asignacion,
    delete_asignacion,
    update_dia_vencimiento,
)


class AsignacionPlanServiceTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.cliente = NS(id_cliente=4)
        self.plan = NS(id=2, precio_mensual=Decimal("225.00"), estado="Activo")
        self.data = AsignacionPlanCreate(
            id_cliente=4,
            id_plan=2,
            fecha_inicio=date(2026, 10, 25),
            estado="Activo",
        )

    def test_costo_se_toma_del_plan_y_no_del_cliente_http(self):
        self.db.scalar.side_effect = [self.cliente, self.plan, None]
        self.db.refresh.side_effect = lambda asignacion: setattr(asignacion, "id_asignacion", 8)

        asignacion = create_asignacion(self.db, self.data)

        self.assertEqual(asignacion.costo_mensual, Decimal("225.00"))
        self.assertEqual(asignacion.id_plan, 2)
        self.assertIsNone(asignacion.dia_vencimiento)
        self.db.add.assert_called_once_with(asignacion)
        self.db.commit.assert_called_once()

    def test_modelo_mapea_dia_vencimiento_smallint_nullable(self):
        columna = ServicioAsignacionPlan.__table__.c.dia_vencimiento

        self.assertEqual(str(columna.type), "SMALLINT")
        self.assertTrue(columna.nullable)

    def test_schema_acepta_unicamente_dias_entre_1_y_31(self):
        self.assertEqual(DiaVencimientoAsignacionUpdate(dia_vencimiento=1).dia_vencimiento, 1)
        self.assertEqual(DiaVencimientoAsignacionUpdate(dia_vencimiento=31).dia_vencimiento, 31)
        for valor in (0, 32, None):
            with self.subTest(valor=valor), self.assertRaises(ValidationError):
                DiaVencimientoAsignacionUpdate.model_validate({"dia_vencimiento": valor})

    def test_actualiza_solo_dia_vencimiento_y_conserva_precio(self):
        asignacion = NS(
            id_asignacion=8,
            dia_vencimiento=None,
            costo_mensual=Decimal("225.00"),
            fecha_actualizacion=None,
        )

        resultado = update_dia_vencimiento(self.db, asignacion, 15)

        self.assertIs(resultado, asignacion)
        self.assertEqual(asignacion.dia_vencimiento, 15)
        self.assertEqual(asignacion.costo_mensual, Decimal("225.00"))
        self.assertIsNotNone(asignacion.fecha_actualizacion)
        self.db.commit.assert_called_once()
        self.db.refresh.assert_called_once_with(asignacion)

    def test_revierte_actualizacion_rechazada_por_postgresql(self):
        asignacion = NS(dia_vencimiento=None, fecha_actualizacion=None)
        self.db.commit.side_effect = IntegrityError("UPDATE", {}, Exception("dato"))

        with self.assertRaises(AsignacionInvalidaError):
            update_dia_vencimiento(self.db, asignacion, 15)

        self.db.rollback.assert_called_once()

    def test_rechaza_otra_asignacion_activa_del_mismo_cliente(self):
        self.db.scalar.side_effect = [self.cliente, self.plan, 3]

        with self.assertRaises(AsignacionActivaDuplicadaError):
            create_asignacion(self.db, self.data)

        self.db.add.assert_not_called()
        self.db.commit.assert_not_called()

    def test_bloquea_solo_cliente_ante_la_carga_eager_de_municipio(self):
        """Evita el FOR UPDATE global que PostgreSQL rechaza sobre el LEFT JOIN."""

        self.db.scalar.return_value = self.cliente

        _get_cliente(self.db, self.cliente.id_cliente)

        query = self.db.scalar.call_args.args[0]
        sql = str(query.compile(dialect=postgresql.dialect()))
        self.assertIn("FOR UPDATE OF clientes", sql)

    def test_elimina_unicamente_la_asignacion_sin_relaciones(self):
        asignacion = NS(id_asignacion=8)

        delete_asignacion(self.db, asignacion)

        self.db.delete.assert_called_once_with(asignacion)
        self.db.commit.assert_called_once()

    def test_bloquea_eliminacion_si_postgresql_detecta_relaciones(self):
        asignacion = NS(id_asignacion=8)
        self.db.commit.side_effect = IntegrityError("DELETE", {}, Exception("FK"))

        with self.assertRaises(AsignacionConRegistrosRelacionadosError):
            delete_asignacion(self.db, asignacion)

        self.db.rollback.assert_called_once()

    def test_schema_rechaza_costo_enviado_por_el_cliente(self):
        with self.assertRaises(ValidationError):
            AsignacionPlanCreate.model_validate(
                {
                    "id_cliente": 4,
                    "id_plan": 2,
                    "fecha_inicio": "2026-10-25",
                    "estado": "Activo",
                    "costo_mensual": "1.00",
                }
            )


if __name__ == "__main__":
    unittest.main()
