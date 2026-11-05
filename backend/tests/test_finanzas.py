"""Pruebas unitarias de modelos y contratos financieros."""

from calendar import monthrange
from dataclasses import replace
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from threading import Barrier, Lock, Thread
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from uuid import UUID

import jwt
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import inspect as sqlalchemy_inspect
from sqlalchemy.orm import configure_mappers

import app.models  # noqa: F401
from app.core.database import Base
from app.main import app
from app.modules.auth.services.auth import get_current_user, require_module_access
from app.modules.clientes.models.cliente import Cliente
from app.modules.finanzas.routers.caja import cerrar_caja_general, require_caja_administrator
from app.modules.finanzas.routers.cobros import (
    _origenes_pago_autorizados,
    _requerir_origen_pago,
    actualizar_dia_vencimiento_internet,
    confirmar_pago,
    generar_mensualidades_internet_manual,
    get_clientes_para_cobros,
    get_comprobante_pdf,
    get_comprobante_pdf_termico,
    get_comprobante_ticket,
    get_servicios_internet,
    registrar_pendiente,
    require_cobros_access,
)
from app.modules.finanzas.schemas.caja import (
    AperturaCajaCreate,
    ArqueoCajaCreate,
    CategoriaCajaCreate,
    CierreCajaCreate,
    EntregaPagoDetalleCreate,
    MovimientoCajaCreate,
    MovimientoCajaResponse,
    MovimientoManualCajaCreate,
)
from app.modules.servicios.schemas.asignacion_plan import DiaVencimientoAsignacionUpdate
from app.modules.finanzas.schemas.cobros import (
    CobroCreate,
    CobroResponse,
    DistribucionPagoCreate,
    GeneracionMensualidadesInternetCreate,
    PagoAplicadoResponse,
    PagoCreate,
    PagoDetalleResponse,
    PagoResponse,
    PeriodoInternetPagoCreate,
    RegistroPagoCreate,
    RegistroPendienteCreate,
)
from app.modules.finanzas.models.caja import ArqueoCaja, MovimientoCaja
from app.modules.finanzas.models.cobros import Cobro, Pago, PagoDetalle
from app.modules.finanzas.services.cobros import (
    CobroInstalacionInconsistenteError,
    ClaveIdempotenciaEnConflictoError,
    DistribucionPagoIncompatibleError,
    MigracionFinancieraPendienteError,
    SaldoCobroInconsistenteError,
    SaldoPagoInsuficienteError,
    SobrepagoCobroError,
    TipoPagoOrdenInvalidoError,
    _bloquear_cobros_pago,
    _preparar_periodos_pago,
    _reintento_coincide,
    calcular_saldo,
    distribuir_pago,
    generar_cobro_instalacion,
    generar_mensualidades_internet,
    get_cobro,
    list_cobros,
    list_historial_cobros,
    list_metodos_pago_activos,
    list_pagos_aplicados,
    list_pagos_con_saldo,
    registrar_pago,
    registrar_obligacion_pendiente,
)
from app.modules.instalaciones.services.instalaciones import completar_instalacion
from app.modules.servicios.models.asignacion_plan import ServicioAsignacionPlan
from app.modules.finanzas.services.caja import (
    CategoriaCajaInvalidaError,
    EfectivoCierreDesactualizadoError,
    FondosCajaInsuficientesError,
    MetodoPagoCajaInvalidoError,
    MovimientoCajaDuplicadoError,
    ReferenciaMovimientoRequeridaError,
    ResponsableCierreInvalidoError,
    SesionCajaAbiertaError,
    SesionCajaNoAbiertaError,
    SesionCajaNoEncontradaError,
    abrir_caja,
    cerrar_caja,
    list_categorias_manuales_activas,
    list_movimientos_caja,
    registrar_movimiento_manual,
)
from app.modules.finanzas.services.comprobantes import (
    ConceptoTicket,
    TicketComprobante,
    _alto_ticket,
    _construir_ticket,
    _dibujar_pdf,
    _siguiente_numero,
    generar_pdf_termico,
    crear_comprobante_pago,
    consultar_ticket_emitido,
    list_comprobantes,
    ticket_response,
)
from app.modules.finanzas.services.cobros_ordenes import (
    MigracionOrdenesTrabajoPendienteError,
    enriquecer_cobros_orden,
    listar_cotizaciones_orden,
    resolver_cotizacion_orden,
)
from app.modules.finanzas.services.cobros_instalaciones import (
    CotizacionInstalacionInvalidaError,
    CotizacionInstalacionNoEncontradaError,
    listar_cotizaciones_instalacion,
    obtener_o_crear_cobro_instalacion,
    resolver_cotizacion_instalacion,
)


class FinanzasModelsTests(unittest.TestCase):
    """Verifica las doce tablas y relaciones propuestas por la migracion 008."""

    def test_registra_tablas_y_configura_relaciones(self) -> None:
        tablas = {
            "metodos_pago",
            "cobros",
            "pagos",
            "pago_detalles",
            "comprobantes_cobro",
            "gestiones_cobro",
            "categorias_caja",
            "sesiones_caja",
            "movimientos_caja",
            "arqueos_caja",
            "entregas_cobradores",
            "entrega_pago_detalles",
        }

        configure_mappers()

        self.assertTrue(tablas.issubset(Base.metadata.tables))
        self.assertEqual(
            set(Base.metadata.tables["pago_detalles"].primary_key.columns.keys()),
            {"id_pago", "id_cobro"},
        )
        self.assertEqual(
            set(
                Base.metadata.tables["entrega_pago_detalles"]
                .primary_key.columns.keys()
            ),
            {"id_entrega", "id_pago"},
        )
        self.assertEqual(
            Base.metadata.tables["entrega_pago_detalles"].primary_key.name,
            "pk_entrega_pago_detalles",
        )

        pago_constraints = {
            constraint.name
            for constraint in Base.metadata.tables["pagos"].constraints
        }
        self.assertIn("fk_pagos_movimiento_integridad", pago_constraints)
        self.assertIn("uq_pagos_clave_idempotencia", pago_constraints)
        self.assertIn("tipo_pago", Base.metadata.tables["pagos"].columns)
        self.assertTrue(Base.metadata.tables["pagos"].columns.tipo_pago.nullable)

        cobro_constraints = {
            constraint.name
            for constraint in Base.metadata.tables["cobros"].constraints
        }
        self.assertIn("fk_cobros_instalacion_cliente", cobro_constraints)
        self.assertIn("fk_cobros_orden_trabajo_cliente", cobro_constraints)
        self.assertIn("fk_cobros_cotizacion", cobro_constraints)
        self.assertIn("ck_cobros_cotizacion_origen", cobro_constraints)
        self.assertIn("uq_cobros_id_cliente_origen", cobro_constraints)

        orden_constraints = {
            constraint.name
            for constraint in Base.metadata.tables["ordenes_trabajo"].constraints
        }
        self.assertIn("uq_ordenes_trabajo_id_cliente", orden_constraints)

        instalacion_constraints = {
            constraint.name
            for constraint in Base.metadata.tables["instalaciones"].constraints
        }
        self.assertIn("uq_instalaciones_id_cliente", instalacion_constraints)

        cobro_indexes = {
            index.name: index for index in Base.metadata.tables["cobros"].indexes
        }
        self.assertIn("ix_cobros_instalacion", cobro_indexes)
        self.assertIn("uq_cobros_orden_trabajo", cobro_indexes)
        self.assertIn("uq_cobros_instalaciones_cotizacion", cobro_indexes)
        self.assertEqual(
            str(cobro_indexes["ix_cobros_cliente_fecha"].expressions[1]),
            "fecha_emision DESC",
        )

        pago_indexes = {
            index.name: index for index in Base.metadata.tables["pagos"].indexes
        }
        self.assertEqual(
            str(pago_indexes["ix_pagos_cliente_fecha"].expressions[1]),
            "fecha_hora DESC",
        )

        movimiento_indexes = {
            index.name: index
            for index in Base.metadata.tables["movimientos_caja"].indexes
        }
        self.assertEqual(
            str(
                movimiento_indexes["ix_movimientos_caja_sesion_fecha"].expressions[1]
            ),
            "fecha_hora DESC",
        )

    def test_migracion_conserva_tablas_y_catalogos_existentes(self) -> None:
        """Impide introducir operaciones destructivas en la migracion incremental."""

        migration_path = (
            Path(__file__).resolve().parents[1]
            / "migrations"
            / "008_integridad_financiera.sql"
        )
        sql = migration_path.read_text(encoding="utf-8")
        statements = " ".join(
            line.strip()
            for line in sql.splitlines()
            if not line.lstrip().startswith("--")
        ).lower()

        self.assertNotIn("drop table", statements)
        self.assertNotIn("truncate", statements)
        self.assertNotIn("delete from", statements)
        self.assertIn("update categorias_caja", statements)
        self.assertIn("where nombre in", statements)
        self.assertIn("detener el backend", sql.lower())
        self.assertIn("desplegar el backend compatible", sql.lower())

    def test_relaciones_compuestas_son_solo_lectura(self) -> None:
        """Evita que SQLAlchemy copie columnas derivadas de forma ambigua."""

        self.assertTrue(sqlalchemy_inspect(Pago).relationships.movimiento_caja.viewonly)
        self.assertTrue(sqlalchemy_inspect(Pago).relationships.detalles.viewonly)
        self.assertTrue(sqlalchemy_inspect(Cobro).relationships.detalles_pago.viewonly)


class FinanzasSchemasTests(unittest.TestCase):
    """Cubre coherencia basica de fechas y montos financieros."""

    def test_rechaza_vencimiento_anterior_a_emision(self) -> None:
        with self.assertRaises(ValidationError):
            CobroCreate(
                id_cliente=1,
                origen_financiero="INTERNET",
                fecha_emision=date(2026, 10, 15),
                fecha_vencimiento=date(2026, 10, 14),
                monto=Decimal("100.00"),
                estado="Pendiente",
            )

    def test_cobro_instalacion_exige_identificador(self) -> None:
        with self.assertRaises(ValidationError):
            CobroCreate(
                id_cliente=1,
                origen_financiero="INSTALACIONES",
                fecha_emision=date(2026, 10, 15),
                monto=Decimal("100.00"),
                estado="Pendiente",
            )

    def test_pago_incorpora_cliente_origen_e_idempotencia(self) -> None:
        pago = PagoCreate(
            id_cliente=1,
            origen_financiero="INSTALACIONES",
            clave_idempotencia="6f51984f-e46b-4428-94a6-41ff3db37852",
            id_metodo_pago=1,
            id_empleado=2,
            monto_total=Decimal("150.00"),
        )

        self.assertEqual(pago.id_cliente, 1)
        self.assertEqual(
            pago.clave_idempotencia,
            UUID("6f51984f-e46b-4428-94a6-41ff3db37852"),
        )

    def test_pago_rechaza_relacion_legado_de_entrega(self) -> None:
        with self.assertRaises(ValidationError):
            PagoCreate(
                id_cliente=1,
                origen_financiero="INSTALACIONES",
                clave_idempotencia="6f51984f-e46b-4428-94a6-41ff3db37852",
                id_metodo_pago=1,
                id_empleado=2,
                id_entrega=3,
                monto_total=Decimal("150.00"),
            )

    def test_registro_pago_admite_distribucion_parcial_y_anticipo(self) -> None:
        parcial = RegistroPagoCreate(
            id_cliente=1,
            origen_financiero="INSTALACIONES",
            clave_idempotencia="6f51984f-e46b-4428-94a6-41ff3db37852",
            id_metodo_pago=1,
            monto_total=Decimal("150.00"),
            referencia="  REF-1  ",
            aplicaciones=[
                {
                    "id_cobro": 8,
                    "monto_aplicado": Decimal("100.00"),
                    "concepto": "  Abono  ",
                }
            ],
        )
        anticipado = RegistroPagoCreate(
            id_cliente=1,
            origen_financiero="INSTALACIONES",
            clave_idempotencia="ad53c2b0-fb65-4f8f-b4b8-dd6109b1a25a",
            id_metodo_pago=1,
            monto_total=Decimal("50.00"),
        )

        self.assertEqual(parcial.referencia, "REF-1")
        self.assertEqual(parcial.aplicaciones[0].concepto, "Abono")
        self.assertEqual(anticipado.aplicaciones, [])

    def test_registro_pago_rechaza_distribucion_invalida(self) -> None:
        base = {
            "id_cliente": 1,
            "origen_financiero": "INSTALACIONES",
            "clave_idempotencia": "6f51984f-e46b-4428-94a6-41ff3db37852",
            "id_metodo_pago": 1,
            "monto_total": Decimal("100.00"),
        }
        with self.assertRaises(ValidationError):
            RegistroPagoCreate(
                **base,
                aplicaciones=[
                    {"id_cobro": 8, "monto_aplicado": Decimal("60.00")},
                    {"id_cobro": 8, "monto_aplicado": Decimal("40.00")},
                ],
            )
        with self.assertRaises(ValidationError):
            RegistroPagoCreate(
                **base,
                aplicaciones=[
                    {"id_cobro": 8, "monto_aplicado": Decimal("100.01")}
                ],
            )
        with self.assertRaises(ValidationError):
            RegistroPagoCreate(**base, id_empleado=99)

    def test_periodos_internet_admiten_solo_servicios_y_periodos_unicos(self) -> None:
        valido = RegistroPagoCreate(
            id_cliente=1,
            origen_financiero="INTERNET",
            clave_idempotencia="6f51984f-e46b-4428-94a6-41ff3db37852",
            id_metodo_pago=1,
            monto_total=Decimal("450.00"),
            periodos_internet=[
                {"id_servicio": 8, "periodo": "2026-11"},
                {"id_servicio": 8, "periodo": "2026-12"},
            ],
        )
        self.assertEqual(len(valido.periodos_internet), 2)

        with self.assertRaises(ValidationError):
            RegistroPagoCreate(
                id_cliente=1,
                origen_financiero="INTERNET",
                clave_idempotencia="6f51984f-e46b-4428-94a6-41ff3db37852",
                id_metodo_pago=1,
                monto_total=Decimal("450.00"),
                periodos_internet=[
                    {"id_servicio": 8, "periodo": "2026-11"},
                    {"id_servicio": 8, "periodo": "2026-11"},
                ],
            )
        with self.assertRaises(ValidationError):
            RegistroPagoCreate(
                id_cliente=1,
                origen_financiero="INSTALACIONES",
                clave_idempotencia="6f51984f-e46b-4428-94a6-41ff3db37852",
                id_metodo_pago=1,
                monto_total=Decimal("100.00"),
                periodos_internet=[{"id_servicio": 8, "periodo": "2026-11"}],
            )
        self.assertEqual(PeriodoInternetPagoCreate(
            id_servicio=8,
            periodo="2027-01",
        ).periodo, "2027-01")

    def test_distribucion_posterior_exige_aplicaciones_unicas(self) -> None:
        with self.assertRaises(ValidationError):
            DistribucionPagoCreate(aplicaciones=[])
        with self.assertRaises(ValidationError):
            DistribucionPagoCreate(
                aplicaciones=[
                    {"id_cobro": 8, "monto_aplicado": Decimal("20.00")},
                    {"id_cobro": 8, "monto_aplicado": Decimal("30.00")},
                ]
            )

    def test_respuestas_exigen_campos_financieros_persistidos(self) -> None:
        """Evita ocultar omisiones de servicios mediante defaults nulos."""

        campos_por_schema = {
            CobroResponse: ("id_cliente", "origen_financiero", "id_instalacion"),
            PagoResponse: (
                "id_cliente",
                "origen_financiero",
                "id_movimiento_caja",
                "clave_idempotencia",
                "tipo_pago",
            ),
            PagoDetalleResponse: ("id_cliente", "origen_financiero"),
            PagoAplicadoResponse: (
                "id_cliente",
                "origen_financiero",
                "id_movimiento_caja",
                "clave_idempotencia",
            ),
            MovimientoCajaResponse: ("origen_financiero",),
        }

        for schema, campos in campos_por_schema.items():
            for campo in campos:
                with self.subTest(schema=schema.__name__, campo=campo):
                    self.assertTrue(schema.model_fields[campo].is_required())

    def test_categoria_y_movimiento_automaticos_solo_permiten_ingresos(self) -> None:
        with self.assertRaises(ValidationError):
            CategoriaCajaCreate(
                nombre="Instalaciones",
                tipo="Egreso",
                estado="Activo",
                origen_financiero="INSTALACIONES",
            )

        with self.assertRaises(ValidationError):
            MovimientoCajaCreate(
                id_sesion=1,
                id_categoria=1,
                id_metodo_pago=1,
                id_responsable=1,
                tipo="Egreso",
                origen_financiero="INSTALACIONES",
                concepto="Cobro",
                monto=Decimal("10.00"),
            )

    def test_entrega_parcial_rechaza_monto_no_positivo(self) -> None:
        with self.assertRaises(ValidationError):
            EntregaPagoDetalleCreate(id_pago=1, monto_entregado=Decimal("0.00"))

    def test_rechaza_diferencia_incoherente_en_arqueo(self) -> None:
        with self.assertRaises(ValidationError):
            ArqueoCajaCreate(
                id_sesion=1,
                monto_sistema=Decimal("100.00"),
                monto_contado=Decimal("90.00"),
                diferencia=Decimal("10.00"),
            )

    def test_acepta_diferencia_negativa_coherente_en_arqueo(self) -> None:
        arqueo = ArqueoCajaCreate(
            id_sesion=1,
            monto_sistema=Decimal("100.00"),
            monto_contado=Decimal("90.00"),
            diferencia=Decimal("-10.00"),
        )

        self.assertEqual(arqueo.diferencia, Decimal("-10.00"))

    def test_movimiento_manual_no_acepta_identidad_ni_sesion_del_cliente(self) -> None:
        with self.assertRaises(ValidationError):
            MovimientoManualCajaCreate(
                tipo="Ingreso",
                id_categoria=1,
                concepto="Aporte",
                monto=Decimal("10.00"),
                id_metodo_pago=1,
                id_sesion=99,
                id_responsable=88,
            )

    def test_movimiento_manual_rechaza_monto_no_positivo(self) -> None:
        with self.assertRaises(ValidationError):
            MovimientoManualCajaCreate(
                tipo="Egreso",
                id_categoria=1,
                concepto="Compra",
                monto=Decimal("0.00"),
                id_metodo_pago=1,
            )


class GeneracionCobroInstalacionTests(unittest.TestCase):
    """Cubre la obligacion creada al completar una instalacion cotizada."""

    @staticmethod
    def _instalacion() -> SimpleNamespace:
        return SimpleNamespace(
            id_instalacion=12,
            id_cliente=4,
            id_visita=7,
            fecha_finalizacion=datetime(2026, 10, 18, 14, 30),
        )

    @staticmethod
    def _cotizacion() -> SimpleNamespace:
        return SimpleNamespace(
            id_cotizacion=11,
            numero_cotizacion="COT-2026-0011",
            id_cliente=4,
            origen="EVALUACION",
            estado="ACEPTADA",
            proforma=SimpleNamespace(id_proforma=5),
            porcentaje_descuento=Decimal("10.00"),
            detalles=[
                SimpleNamespace(cantidad=Decimal("2"), precio_unitario=Decimal("100.00")),
                SimpleNamespace(cantidad=Decimal("1"), precio_unitario=Decimal("50.00")),
            ],
        )

    def test_crea_cobro_con_total_documentado_sin_confirmar_transaccion(self) -> None:
        db = MagicMock()
        db.scalar.return_value = self._cotizacion()
        db.scalars.return_value.all.return_value = []
        db.execute.return_value.scalar_one.return_value = date(2026, 10, 18)

        cobro = generar_cobro_instalacion(db, self._instalacion())

        self.assertIsInstance(cobro, Cobro)
        self.assertEqual(cobro.id_cliente, 4)
        self.assertIsNone(cobro.id_instalacion)
        self.assertEqual(cobro.id_cotizacion, 11)
        self.assertEqual(cobro.origen_financiero, "INSTALACIONES")
        self.assertEqual(cobro.monto, Decimal("225.00"))
        self.assertEqual(cobro.fecha_emision, date(2026, 10, 18))
        self.assertEqual(cobro.estado, "Pendiente")
        db.add.assert_called_once_with(cobro)
        db.flush.assert_called_once()
        db.commit.assert_not_called()

    def test_sin_documento_comercial_no_inventa_obligacion(self) -> None:
        db = MagicMock()
        instalacion = self._instalacion()
        instalacion.id_visita = None

        self.assertIsNone(generar_cobro_instalacion(db, instalacion))
        db.scalar.assert_not_called()
        db.add.assert_not_called()

    def test_reutiliza_cobro_compatible_y_rechaza_uno_distinto(self) -> None:
        db = MagicMock()
        db.scalar.return_value = self._cotizacion()
        existente = SimpleNamespace(
            id_cliente=4,
            id_cotizacion=11,
            origen_financiero="INSTALACIONES",
            monto=Decimal("225.00"),
            estado="Pendiente",
        )
        db.scalars.return_value.all.return_value = [existente]

        self.assertIs(generar_cobro_instalacion(db, self._instalacion()), existente)
        db.add.assert_not_called()
        statement = str(db.scalars.call_args.args[0])
        self.assertIn("cobros.id_cotizacion", statement)

        existente.monto = Decimal("200.00")
        with self.assertRaises(CobroInstalacionInconsistenteError):
            generar_cobro_instalacion(db, self._instalacion())

    def test_genera_obligacion_antes_de_finalizar_para_anticipos(self) -> None:
        db = MagicMock()
        cotizacion = self._cotizacion()
        instalacion = self._instalacion()
        instalacion.fecha_finalizacion = None
        db.scalar.side_effect = [cotizacion, date(2026, 10, 18)]
        db.scalars.return_value.all.return_value = []
        db.execute.return_value.scalar_one.return_value = date(2026, 10, 18)

        cobro = generar_cobro_instalacion(db, instalacion)

        self.assertIsInstance(cobro, Cobro)
        self.assertEqual(cobro.fecha_emision, date(2026, 10, 18))

    def test_cotizacion_completada_sigue_siendo_cobrable(self) -> None:
        db = MagicMock()
        cotizacion = self._cotizacion()
        cotizacion.estado = "COMPLETADA"
        db.scalar.return_value = cotizacion
        db.scalars.return_value.all.return_value = []

        cobro = generar_cobro_instalacion(db, self._instalacion())

        self.assertIsInstance(cobro, Cobro)
        self.assertEqual(cobro.estado, "Pendiente")

    def test_finalizacion_tecnica_no_cambia_estado_comercial(self) -> None:
        db = MagicMock()
        cotizacion = SimpleNamespace(estado="ACEPTADA")
        db.scalar.return_value = cotizacion
        instalacion = SimpleNamespace(
            id_instalacion=12,
            id_cliente=4,
            id_visita=7,
            estado="En Proceso",
            evidencia_fotografica=None,
        )
        with (
            patch(
                "app.modules.instalaciones.services.instalaciones._lock_installation",
                return_value=instalacion,
            ),
            patch(
                "app.modules.instalaciones.services.instalaciones.store_image",
                return_value=("evidencias_instalacion/12.webp", Path("12.webp")),
            ),
            patch(
                "app.modules.instalaciones.services.instalaciones._committed_response",
                return_value={"id_instalacion": 12},
            ),
        ):
            completar_instalacion(db, instalacion, "Trabajo terminado", b"imagen")

        self.assertEqual(cotizacion.estado, "ACEPTADA")

    def test_finalizacion_no_reabre_cotizacion_ya_completada(self) -> None:
        db = MagicMock()
        cotizacion = SimpleNamespace(estado="COMPLETADA")
        db.scalar.return_value = cotizacion
        instalacion = SimpleNamespace(
            id_instalacion=12,
            id_cliente=4,
            id_visita=7,
            estado="En Proceso",
            evidencia_fotografica=None,
        )
        with (
            patch(
                "app.modules.instalaciones.services.instalaciones._lock_installation",
                return_value=instalacion,
            ),
            patch(
                "app.modules.instalaciones.services.instalaciones.store_image",
                return_value=("evidencias_instalacion/12.webp", Path("12.webp")),
            ),
            patch(
                "app.modules.instalaciones.services.instalaciones._committed_response",
                return_value={"id_instalacion": 12},
            ),
        ):
            completar_instalacion(db, instalacion, "Trabajo terminado", b"imagen")

        self.assertEqual(cotizacion.estado, "COMPLETADA")

    def test_finalizacion_tecnica_no_crea_cobro(self) -> None:
        db = MagicMock()
        instalacion = SimpleNamespace(
            id_instalacion=12,
            id_cliente=4,
            id_visita=7,
            estado="En Proceso",
            evidencia_fotografica=None,
        )
        with (
            patch(
                "app.modules.instalaciones.services.instalaciones._lock_installation",
                return_value=instalacion,
            ),
            patch(
                "app.modules.instalaciones.services.instalaciones.store_image",
                return_value=("evidencias_instalacion/12.webp", Path("12.webp")),
            ),
            patch(
                "app.modules.instalaciones.services.instalaciones._committed_response",
                return_value={"id_instalacion": 12},
            ),
        ):
            response = completar_instalacion(db, instalacion, "Trabajo terminado", b"imagen")

        self.assertEqual(response, {"id_instalacion": 12})
        db.add.assert_not_called()
        db.commit.assert_called_once()
        db.rollback.assert_not_called()


class InstalacionesCobroServiceTests(unittest.TestCase):
    """Cubre la cotizacion EVALUACION como origen de pago de instalaciones."""

    CLAVE = UUID("6f51984f-e46b-4428-94a6-41ff3db37852")

    @staticmethod
    def _fila() -> SimpleNamespace:
        return SimpleNamespace(
            Cotizacion=SimpleNamespace(
                id_cotizacion=11,
                numero_cotizacion="COT-2026-0011",
                id_cliente=4,
                cliente=SimpleNamespace(nombres="Luis", apellidos="Perez"),
                estado="ACEPTADA",
                origen="EVALUACION",
                porcentaje_descuento=Decimal("0.00"),
                detalles=[
                    SimpleNamespace(
                        cantidad=Decimal("1.00"),
                        precio_unitario=Decimal("300.00"),
                    )
                ],
            ),
            Proforma=SimpleNamespace(id_proforma=21),
            Instalacion=SimpleNamespace(
                id_instalacion=30,
                id_visita=7,
                id_cliente=4,
                estado="Completada",
            ),
        )

    def test_lista_cotizacion_de_instalacion_con_saldo(self) -> None:
        db = MagicMock()
        resultado_cotizaciones = MagicMock()
        resultado_cotizaciones.unique.return_value.all.return_value = [self._fila()]
        resultado_cobro = SimpleNamespace(
            id_cobro=50,
            id_cliente=4,
            id_cotizacion=11,
            origen_financiero="INSTALACIONES",
            monto=Decimal("300.00"),
        )
        resultado_aplicaciones = MagicMock()
        resultado_aplicaciones.all.return_value = [(50, Decimal("100.00"))]
        db.execute.side_effect = [resultado_cotizaciones, resultado_aplicaciones]
        db.scalars.return_value.all.return_value = [resultado_cobro]

        with patch(
            "app.modules.finanzas.services.cobros_instalaciones._total_cotizacion",
            return_value=Decimal("300.00"),
        ):
            response = listar_cotizaciones_instalacion(db, 4)

        self.assertEqual(len(response), 1)
        self.assertEqual(response[0]["id_instalacion"], 30)
        self.assertEqual(response[0]["id_cobro"], 50)
        self.assertEqual(response[0]["saldo_pendiente"], Decimal("200.00"))

    def test_lista_una_sola_cotizacion_por_visita_compartida(self) -> None:
        db = MagicMock()
        primera = self._fila()
        segunda = self._fila()
        segunda.Instalacion = SimpleNamespace(
            id_instalacion=31,
            id_visita=7,
            id_cliente=4,
            estado="Programada",
        )
        resultado_cotizaciones = MagicMock()
        resultado_cotizaciones.unique.return_value.all.return_value = [
            primera,
            segunda,
        ]
        db.execute.side_effect = [resultado_cotizaciones]
        db.scalars.return_value.all.return_value = []

        with patch(
            "app.modules.finanzas.services.cobros_instalaciones._total_cotizacion",
            return_value=Decimal("300.00"),
        ):
            response = listar_cotizaciones_instalacion(db, 4)

        self.assertEqual(len(response), 1)
        self.assertEqual(response[0]["id_instalacion"], 30)

    def test_lista_cotizacion_sin_instalacion_programada(self) -> None:
        """La cotizacion aceptada se muestra aunque la visita no tenga instalacion."""

        db = MagicMock()
        fila = self._fila()
        fila.Instalacion = None
        resultado_cotizaciones = MagicMock()
        resultado_cotizaciones.unique.return_value.all.return_value = [fila]
        db.execute.return_value = resultado_cotizaciones

        with patch(
            "app.modules.finanzas.services.cobros_instalaciones._total_cotizacion",
            return_value=Decimal("900.00"),
        ):
            response = listar_cotizaciones_instalacion(db, 4)

        self.assertEqual(len(response), 1)
        self.assertIsNone(response[0]["id_instalacion"])
        self.assertIsNone(response[0]["estado_instalacion"])
        self.assertIsNone(response[0]["id_cobro"])
        self.assertEqual(response[0]["saldo_pendiente"], Decimal("900.00"))
        # Al no existir la instalacion no se consultan cobros ni aplicaciones.
        self.assertEqual(db.execute.call_count, 1)

    def test_resolver_rechaza_cotizacion_inexistente(self) -> None:
        db = MagicMock()
        db.execute.return_value.unique.return_value.one_or_none.return_value = None

        with self.assertRaises(CotizacionInstalacionNoEncontradaError):
            resolver_cotizacion_instalacion(db, 11, 4)

    def test_resolver_rechaza_cotizacion_sin_proforma(self) -> None:
        db = MagicMock()
        fila = self._fila()
        fila.Proforma = None
        db.execute.return_value.unique.return_value.one_or_none.return_value = fila

        with self.assertRaises(CotizacionInstalacionInvalidaError):
            resolver_cotizacion_instalacion(db, 11, 4)

    def test_resolver_acepta_cotizacion_sin_instalacion(self) -> None:
        """La cotizacion puede cobrarse antes de programar el trabajo tecnico."""

        db = MagicMock()
        fila = self._fila()
        fila.Instalacion = None
        db.execute.return_value.unique.return_value.one_or_none.return_value = fila

        with patch(
            "app.modules.finanzas.services.cobros_instalaciones._total_cotizacion",
            return_value=Decimal("300.00"),
        ):
            cotizacion, proforma, instalacion, total = (
                resolver_cotizacion_instalacion(db, 11, 4)
            )

        self.assertEqual(cotizacion.id_cotizacion, 11)
        self.assertEqual(proforma.id_proforma, 21)
        self.assertIsNone(instalacion)
        self.assertEqual(total, Decimal("300.00"))

    def test_resolver_devuelve_cotizacion_cobrable(self) -> None:
        db = MagicMock()
        db.execute.return_value.unique.return_value.one_or_none.return_value = (
            self._fila()
        )

        with patch(
            "app.modules.finanzas.services.cobros_instalaciones._total_cotizacion",
            return_value=Decimal("300.00"),
        ):
            cotizacion, proforma, instalacion, total = (
                resolver_cotizacion_instalacion(db, 11, 4)
            )

        self.assertEqual(cotizacion.id_cotizacion, 11)
        self.assertEqual(proforma.id_proforma, 21)
        self.assertEqual(instalacion.id_instalacion, 30)
        self.assertEqual(total, Decimal("300.00"))

    def test_registro_de_instalacion_admite_cotizacion_con_tipo_pago(self) -> None:
        for tipo_pago in ("ANTICIPO", "TOTAL"):
            with self.subTest(tipo_pago=tipo_pago):
                data = RegistroPagoCreate(
                    id_cliente=4,
                    origen_financiero="INSTALACIONES",
                    clave_idempotencia=self.CLAVE,
                    id_metodo_pago=2,
                    monto_total=Decimal("100.00"),
                    tipo_pago=tipo_pago,
                    id_cotizacion=11,
                )

                self.assertEqual(data.tipo_pago, tipo_pago)

    def test_obligacion_se_identifica_por_cotizacion_sin_instalacion(self) -> None:
        db = MagicMock()
        cotizacion = self._fila().Cotizacion
        db.scalars.return_value.all.return_value = []
        db.execute.return_value.scalar_one.return_value = date(2026, 10, 19)

        cobro = obtener_o_crear_cobro_instalacion(
            db,
            cotizacion,
            Decimal("300.00"),
        )

        self.assertEqual(cobro.id_cotizacion, 11)
        self.assertIsNone(cobro.id_instalacion)
        self.assertEqual(cobro.id_cliente, 4)
        db.add.assert_called_once_with(cobro)
        db.flush.assert_called_once()

    def test_registro_de_instalacion_exige_cotizacion_y_tipo_juntos(self) -> None:
        base = {
            "id_cliente": 4,
            "origen_financiero": "INSTALACIONES",
            "clave_idempotencia": self.CLAVE,
            "id_metodo_pago": 2,
            "monto_total": Decimal("100.00"),
        }

        with self.assertRaises(ValidationError):
            RegistroPagoCreate(**base, id_cotizacion=11)
        with self.assertRaises(ValidationError):
            RegistroPagoCreate(**base, tipo_pago="TOTAL")
        with self.assertRaises(ValidationError):
            RegistroPagoCreate(
                **base,
                recepcion_efectivo="EMPLEADO",
                id_empleado_receptor=7,
            )

    def test_pago_de_instalacion_crea_obligacion_sin_emitir_comprobante(self) -> None:
        db = MagicMock()
        categoria = SimpleNamespace(id_categoria=5)
        metodo = SimpleNamespace(id_metodo_pago=2, nombre="Efectivo", estado="Activo")
        fecha = datetime(2026, 10, 18, 15, 0)
        db.scalar.side_effect = [None, categoria, metodo, fecha]
        cotizacion = SimpleNamespace(
            id_cotizacion=11,
            id_cliente=4,
            numero_cotizacion="COT-2026-0011",
            estado="ACEPTADA",
        )
        cobro = SimpleNamespace(
            id_cobro=50,
            id_cliente=4,
            id_cotizacion=11,
            origen_financiero="INSTALACIONES",
            id_instalacion=None,
            monto=Decimal("300.00"),
            estado="Pendiente",
        )

        def asignar_identidad(objeto) -> None:
            if isinstance(objeto, MovimientoCaja):
                objeto.id_movimiento = 21
            elif isinstance(objeto, Pago):
                objeto.id_pago = 31

        db.add.side_effect = asignar_identidad
        data = RegistroPagoCreate(
            id_cliente=4,
            origen_financiero="INSTALACIONES",
            clave_idempotencia=self.CLAVE,
            id_metodo_pago=2,
            monto_total=Decimal("300.00"),
            tipo_pago="TOTAL",
            id_cotizacion=11,
        )

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_caja"),
            patch(
                "app.modules.finanzas.services.cobros._sesion_abierta",
                return_value=SimpleNamespace(id_sesion=3),
            ),
            patch(
                "app.modules.finanzas.services.cobros.resolver_cotizacion_instalacion",
                return_value=(
                    cotizacion,
                    SimpleNamespace(id_proforma=21),
                    None,
                    Decimal("300.00"),
                ),
            ),
            patch(
                "app.modules.finanzas.services.cobros.obtener_o_crear_cobro_instalacion",
                return_value=cobro,
            ),
            patch(
                "app.modules.finanzas.services.cobros.total_aplicado_cobro",
                return_value=Decimal("0.00"),
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_cliente_y_fuente"),
            patch(
                "app.modules.finanzas.services.cobros._bloquear_cobros_pago",
                return_value=([cobro], {50: Decimal("300.00")}),
            ),
            patch(
                "app.modules.finanzas.services.cobros.crear_comprobante_pago",
                return_value=(
                    SimpleNamespace(id_comprobante=9),
                    SimpleNamespace(),
                    None,
                ),
            ) as comprobante_pdf,
            patch(
                "app.modules.finanzas.services.cobros.ticket_response",
                return_value={"numero": "0001"},
            ),
        ):
            response = registrar_pago(db, data, SimpleNamespace(id_empleado=7, estado="Activo"))

        detalles = db.add_all.call_args.args[0]
        self.assertEqual(len(detalles), 1)
        self.assertEqual(detalles[0].id_cobro, 50)
        self.assertEqual(detalles[0].monto_aplicado, Decimal("300.00"))
        self.assertEqual(detalles[0].concepto, "Cotizacion COT-2026-0011")
        self.assertEqual(response["tipo_pago"], "TOTAL")
        self.assertIsNone(response["comprobante"])
        self.assertEqual(cotizacion.estado, "COMPLETADA")
        comprobante_pdf.assert_not_called()
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    def test_tipo_pago_de_instalacion_debe_corresponder_al_saldo(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [
            None,
            SimpleNamespace(id_categoria=5),
            SimpleNamespace(id_metodo_pago=2, nombre="Efectivo", estado="Activo"),
        ]
        cotizacion = SimpleNamespace(
            id_cotizacion=11,
            id_cliente=4,
            numero_cotizacion="COT-2026-0011",
            estado="ACEPTADA",
        )
        cobro = SimpleNamespace(
            id_cobro=50,
            id_cotizacion=11,
            id_cliente=4,
            monto=Decimal("300.00"),
        )
        data = RegistroPagoCreate(
            id_cliente=4,
            origen_financiero="INSTALACIONES",
            clave_idempotencia=self.CLAVE,
            id_metodo_pago=2,
            monto_total=Decimal("100.00"),
            tipo_pago="TOTAL",
            id_cotizacion=11,
        )

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_caja"),
            patch(
                "app.modules.finanzas.services.cobros._sesion_abierta",
                return_value=SimpleNamespace(id_sesion=3),
            ),
            patch(
                "app.modules.finanzas.services.cobros.resolver_cotizacion_instalacion",
                return_value=(
                    cotizacion,
                    SimpleNamespace(id_proforma=21),
                    None,
                    Decimal("300.00"),
                ),
            ),
            patch(
                "app.modules.finanzas.services.cobros.obtener_o_crear_cobro_instalacion",
                return_value=cobro,
            ),
            patch(
                "app.modules.finanzas.services.cobros.total_aplicado_cobro",
                return_value=Decimal("0.00"),
            ),
        ):
            with self.assertRaises(TipoPagoOrdenInvalidoError):
                registrar_pago(db, data, SimpleNamespace(id_empleado=7, estado="Activo"))

        db.add.assert_not_called()
        db.rollback.assert_called_once()


class GeneracionMensualidadesInternetTests(unittest.TestCase):
    """Cubre fechas, monto histórico e idempotencia sin escribir en PostgreSQL."""

    @staticmethod
    def _resultado(valores):
        resultado = MagicMock()
        resultado.all.return_value = valores
        return resultado

    @staticmethod
    def _asignacion(
        dia: int = 31,
        fecha_inicio: date = date(2026, 1, 15),
    ) -> SimpleNamespace:
        return SimpleNamespace(
            id_asignacion=8,
            id_cliente=4,
            costo_mensual=Decimal("225.50"),
            fecha_inicio=fecha_inicio,
            dia_vencimiento=dia,
            estado="Activo",
        )

    @classmethod
    def _db_con_asignaciones(
        cls,
        asignaciones: list[SimpleNamespace],
        existentes: list[SimpleNamespace] | None = None,
    ) -> MagicMock:
        """Simula bloqueos y filtros sin escribir en PostgreSQL.

        El servicio bloquea primero clientes, luego asignaciones y finalmente
        cobros existentes. El mock distingue cada consulta por su entidad para
        que las pruebas reflejen el orden real de bloqueo.
        """

        db = MagicMock()
        cobros_existentes = list(existentes or [])

        def ejecutar(statement):
            descripcion = statement.column_descriptions[0]
            entidad = descripcion.get("entity")
            nombre = descripcion.get("name")
            if entidad is Cliente:
                return cls._resultado(
                    sorted({asignacion.id_cliente for asignacion in asignaciones})
                )
            if entidad is ServicioAsignacionPlan:
                fechas = [
                    valor
                    for valor in statement.compile().params.values()
                    if isinstance(valor, date)
                ]
                corte = fechas[0]
                elegibles = [
                    asignacion
                    for asignacion in asignaciones
                    if asignacion.fecha_inicio < corte
                ]
                if nombre == "id_cliente":
                    return cls._resultado(
                        sorted({asignacion.id_cliente for asignacion in elegibles})
                    )
                return cls._resultado(elegibles)
            if entidad is Cobro:
                return cls._resultado(cobros_existentes)
            return cls._resultado([])

        db.scalars.side_effect = ejecutar
        return db

    @staticmethod
    def _cobro_existente(
        *,
        id_servicio: int = 8,
        periodo: str = "2026-10",
        dia: int = 20,
        monto: str = "225.50",
    ) -> SimpleNamespace:
        """Construye la mensualidad persistida que debe reutilizarse."""

        anio, mes = (int(valor) for valor in periodo.split("-"))
        return SimpleNamespace(
            id_cobro=40,
            id_cliente=4,
            origen_financiero="INTERNET",
            id_servicio=id_servicio,
            periodo=periodo,
            fecha_emision=date(anio, mes, 1),
            fecha_vencimiento=date(
                anio,
                mes,
                min(dia, monthrange(anio, mes)[1]),
            ),
            monto=Decimal(monto),
        )

    def test_calcula_vencimiento_en_febrero_y_meses_cortos(self) -> None:
        casos = ((2027, 2, 28), (2028, 2, 29), (2027, 4, 30))
        for anio, mes, dia_esperado in casos:
            with self.subTest(anio=anio, mes=mes):
                db = self._db_con_asignaciones([self._asignacion()])

                respuesta = generar_mensualidades_internet(
                    db,
                    GeneracionMensualidadesInternetCreate(mes=mes, anio=anio),
                )

                mensualidad = db.add_all.call_args.args[0][0]
                self.assertEqual(
                    mensualidad.fecha_vencimiento,
                    date(anio, mes, dia_esperado),
                )
                self.assertEqual(mensualidad.fecha_emision, date(anio, mes, 1))
                self.assertEqual(mensualidad.monto, Decimal("225.50"))
                self.assertEqual(mensualidad.id_servicio, 8)
                self.assertEqual(respuesta["generadas"], 1)
                db.commit.assert_called_once()

    def test_bloquea_antes_de_consultar_duplicados_y_reutiliza_existentes(self) -> None:
        asignaciones = [self._asignacion(15), SimpleNamespace(**{
            **vars(self._asignacion(20)), "id_asignacion": 9,
        })]
        existente = self._cobro_existente(id_servicio=9, dia=20)
        db = self._db_con_asignaciones(asignaciones, existentes=[existente])

        respuesta = generar_mensualidades_internet(
            db,
            GeneracionMensualidadesInternetCreate(mes=10, anio=2026),
        )

        consultas = [llamada.args[0] for llamada in db.scalars.call_args_list]
        bloqueo = next(
            str(consulta)
            for consulta in consultas
            if "FOR UPDATE" in str(consulta)
            and "servicio_asignacion_planes.id_asignacion" in str(consulta)
        )
        consulta_duplicados = next(
            consulta for consulta in consultas
            if "cobros.id_servicio" in str(consulta)
        )
        duplicados = str(consulta_duplicados)
        parametros_duplicados = list(consulta_duplicados.compile().params.values())
        self.assertIn("FOR UPDATE", bloqueo)
        self.assertIn("ORDER BY servicio_asignacion_planes.id_asignacion", bloqueo)
        self.assertIn("servicio_asignacion_planes.estado", bloqueo)
        self.assertIn("servicio_asignacion_planes.dia_vencimiento IS NOT NULL", bloqueo)
        self.assertIn("cobros.id_servicio", duplicados)
        self.assertIn("cobros.periodo", duplicados)
        self.assertIn("INTERNET", parametros_duplicados)
        self.assertIn("2026-10", parametros_duplicados)
        self.assertEqual(respuesta["generadas"], 1)
        self.assertEqual(respuesta["existentes"], 1)
        self.assertEqual(respuesta["total_elegibles"], 2)
        self.assertEqual(db.add_all.call_args.args[0][0].id_servicio, 8)

    def test_octubre_excluye_servicios_iniciados_en_cualquier_dia_del_mes(self) -> None:
        """El corte usa el primer día y deja gratuito todo el mes de inicio."""

        for dia_inicio in (1, 15, 25, 31):
            with self.subTest(dia_inicio=dia_inicio):
                db = self._db_con_asignaciones([
                    self._asignacion(15, date(2026, 10, dia_inicio)),
                ])

                respuesta = generar_mensualidades_internet(
                    db,
                    GeneracionMensualidadesInternetCreate(mes=10, anio=2026),
                )

                consulta = next(
                    llamada.args[0]
                    for llamada in db.scalars.call_args_list
                    if "servicio_asignacion_planes.fecha_inicio <" in str(llamada.args[0])
                )
                sql = str(consulta)
                parametros = list(consulta.compile().params.values())
                self.assertIn("servicio_asignacion_planes.fecha_inicio <", sql)
                self.assertIn(date(2026, 10, 1), parametros)
                self.assertEqual(respuesta["generadas"], 0)
                self.assertEqual(respuesta["total_elegibles"], 0)
                db.add_all.assert_not_called()

    def test_noviembre_genera_primera_mensualidad_de_servicio_iniciado_en_octubre(self) -> None:
        """El mes siguiente conserva monto completo y vencimiento configurado."""

        db = self._db_con_asignaciones([
            self._asignacion(15, date(2026, 10, 25)),
        ])

        respuesta = generar_mensualidades_internet(
            db,
            GeneracionMensualidadesInternetCreate(mes=11, anio=2026),
        )

        mensualidad = db.add_all.call_args.args[0][0]
        self.assertEqual(respuesta["periodo"], "2026-11")
        self.assertEqual(respuesta["generadas"], 1)
        self.assertEqual(mensualidad.monto, Decimal("225.50"))
        self.assertEqual(mensualidad.fecha_vencimiento, date(2026, 11, 15))

    def test_enero_genera_primera_mensualidad_de_inicio_en_diciembre(self) -> None:
        """La gratuidad del mes de inicio se conserva al cambiar de año."""

        for dia_inicio in (1, 20, 31):
            with self.subTest(dia_inicio=dia_inicio):
                asignacion = self._asignacion(31, date(2026, 12, dia_inicio))
                db_diciembre = self._db_con_asignaciones([asignacion])

                respuesta_diciembre = generar_mensualidades_internet(
                    db_diciembre,
                    GeneracionMensualidadesInternetCreate(mes=12, anio=2026),
                )

                self.assertEqual(respuesta_diciembre["generadas"], 0)
                db_diciembre.add_all.assert_not_called()

                db = self._db_con_asignaciones([asignacion])

                respuesta = generar_mensualidades_internet(
                    db,
                    GeneracionMensualidadesInternetCreate(mes=1, anio=2027),
                )

                consulta = db.scalars.call_args_list[0].args[0]
                parametros = list(consulta.compile().params.values())
                mensualidad = db.add_all.call_args.args[0][0]
                self.assertIn(date(2027, 1, 1), parametros)
                self.assertEqual(respuesta["periodo"], "2027-01")
                self.assertEqual(respuesta["generadas"], 1)
                self.assertEqual(mensualidad.fecha_vencimiento, date(2027, 1, 31))

    def test_reintento_octubre_reporta_existente_sin_crear_otro_cobro(self) -> None:
        """Repetir el período confirma la obligación existente sin duplicarla."""

        db = self._db_con_asignaciones(
            [self._asignacion(15)],
            existentes=[self._cobro_existente(id_servicio=8, dia=15)],
        )

        respuesta = generar_mensualidades_internet(
            db,
            GeneracionMensualidadesInternetCreate(mes=10, anio=2026),
        )

        self.assertEqual(
            respuesta,
            {
                "periodo": "2026-10",
                "generadas": 0,
                "existentes": 1,
                "total_elegibles": 1,
            },
        )
        db.add_all.assert_not_called()
        db.commit.assert_called_once()

    def test_error_al_confirmar_revierte_todas_las_mensualidades(self) -> None:
        """Un fallo del lote revierte la transacción y no reporta un éxito parcial."""

        db = self._db_con_asignaciones([self._asignacion(15)])
        db.commit.side_effect = RuntimeError("fallo aislado al confirmar")

        with self.assertRaisesRegex(RuntimeError, "fallo aislado al confirmar"):
            generar_mensualidades_internet(
                db,
                GeneracionMensualidadesInternetCreate(mes=10, anio=2026),
            )

        db.add_all.assert_called_once()
        db.rollback.assert_called_once()

    def test_dos_solicitudes_simultaneas_no_crean_duplicados(self) -> None:
        """Simula dos sesiones PostgreSQL que compiten por la misma fila bloqueada."""

        barrera = Barrier(2)
        bloqueo = Lock()
        existentes: list[SimpleNamespace] = []
        asignacion = self._asignacion(15)

        class SesionConcurrente:
            def __init__(self) -> None:
                self.pendientes: list[Cobro] = []
                self.bloqueada = False

            def scalars(self, statement):
                descripcion = statement.column_descriptions[0]
                entidad = descripcion.get("entity")
                if entidad is Cliente:
                    return GeneracionMensualidadesInternetTests._resultado([4])
                if entidad is ServicioAsignacionPlan and descripcion.get("name") == "id_cliente":
                    return GeneracionMensualidadesInternetTests._resultado([4])
                if entidad is ServicioAsignacionPlan:
                    # Simula el FOR UPDATE de la asignación: el segundo hilo
                    # espera hasta que el primero confirme su transacción.
                    barrera.wait(timeout=3)
                    bloqueo.acquire()
                    self.bloqueada = True
                    return GeneracionMensualidadesInternetTests._resultado([asignacion])
                if entidad is Cobro:
                    return GeneracionMensualidadesInternetTests._resultado(list(existentes))
                return GeneracionMensualidadesInternetTests._resultado([])

            def add_all(self, mensualidades) -> None:
                self.pendientes.extend(mensualidades)

            def commit(self) -> None:
                existentes.extend(self.pendientes)
                if self.bloqueada:
                    self.bloqueada = False
                    bloqueo.release()

            def rollback(self) -> None:
                if self.bloqueada:
                    self.bloqueada = False
                    bloqueo.release()

        respuestas: list[dict[str, int | str]] = []

        def ejecutar() -> None:
            respuestas.append(
                generar_mensualidades_internet(
                    SesionConcurrente(),  # type: ignore[arg-type]
                    GeneracionMensualidadesInternetCreate(mes=10, anio=2026),
                )
            )

        hilos = [Thread(target=ejecutar), Thread(target=ejecutar)]
        for hilo in hilos:
            hilo.start()
        for hilo in hilos:
            hilo.join(timeout=5)

        self.assertTrue(all(not hilo.is_alive() for hilo in hilos))
        self.assertEqual(len(respuestas), 2)
        self.assertEqual(sorted(respuesta["generadas"] for respuesta in respuestas), [0, 1])
        self.assertEqual(sorted(respuesta["existentes"] for respuesta in respuestas), [0, 1])
        self.assertEqual([cobro.id_servicio for cobro in existentes], [8])


class CobrosServiceTests(unittest.TestCase):
    """Verifica calculos, filtros y paginacion sin escribir en PostgreSQL."""

    def test_detalle_indica_comprobante_emitido_sin_modificar_el_saldo(self) -> None:
        for emitido in (False, True):
            with self.subTest(emitido=emitido):
                db = MagicMock()
                db.execute.return_value.one_or_none.return_value = SimpleNamespace(
                    Cobro=SimpleNamespace(
                        id_cobro=70, id_cliente=4, origen_financiero="INTERNET",
                        id_instalacion=None, id_servicio=8, periodo="2026-11",
                        fecha_emision=date(2026, 11, 1), fecha_vencimiento=date(2026, 11, 15),
                        monto=Decimal("225.50"), estado="Pagado",
                    ),
                    total_aplicado=Decimal("225.50"), tiene_comprobante=emitido,
                )
                respuesta = get_cobro(db, 70)
                self.assertEqual(respuesta["tiene_comprobante"], emitido)
                self.assertEqual(respuesta["saldo_pendiente"], Decimal("0.00"))
                consulta = str(db.execute.call_args.args[0])
                self.assertIn("EXISTS", consulta)
                self.assertIn("comprobantes_cobro.id_pago = pago_detalles.id_pago", consulta)
                self.assertIn("pago_detalles.id_cobro = cobros.id_cobro", consulta)
                db.add.assert_not_called()
                db.commit.assert_not_called()

    def test_calcula_saldo_con_decimal(self) -> None:
        total_pagado, saldo = calcular_saldo(
            10,
            Decimal("100.00"),
            Decimal("35.25"),
        )

        self.assertEqual(total_pagado, Decimal("35.25"))
        self.assertEqual(saldo, Decimal("64.75"))

    def test_reporta_sobrepago_en_lugar_de_saldo_negativo(self) -> None:
        with self.assertRaises(SaldoCobroInconsistenteError) as context:
            calcular_saldo(10, Decimal("100.00"), Decimal("100.01"))

        self.assertEqual(context.exception.id_cobro, 10)
        self.assertEqual(context.exception.total_pagado, Decimal("100.01"))

    def test_lista_unicamente_metodos_de_pago_activos(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = []

        self.assertEqual(list_metodos_pago_activos(db), [])

        statement = str(db.scalars.call_args.args[0])
        self.assertIn("metodos_pago.estado", statement)
        self.assertIn("metodos_pago.nombre", statement)

    def test_obtiene_detalle_con_saldo_calculado(self) -> None:
        db = MagicMock()
        db.execute.return_value.one_or_none.return_value = SimpleNamespace(
            Cobro=SimpleNamespace(
                id_cobro=4,
                id_cliente=2,
                origen_financiero="INSTALACIONES",
                id_instalacion=9,
                id_servicio=None,
                periodo=None,
                fecha_emision=date(2026, 10, 1),
                fecha_vencimiento=None,
                monto=Decimal("75.00"),
                estado="Pendiente",
            ),
            total_aplicado=Decimal("25.00"),
        )

        response = get_cobro(db, 4)

        self.assertIsNotNone(response)
        self.assertEqual(response["total_pagado"], Decimal("25.00"))
        self.assertEqual(response["saldo_pendiente"], Decimal("50.00"))
        self.assertEqual(response["id_cliente"], 2)
        self.assertEqual(response["origen_financiero"], "INSTALACIONES")
        self.assertEqual(response["id_instalacion"], 9)

    def test_lista_cobros_con_filtros_y_paginacion(self) -> None:
        db = MagicMock()
        sin_inconsistencia = MagicMock()
        sin_inconsistencia.first.return_value = None
        filas = MagicMock()
        filas.all.return_value = [
            SimpleNamespace(
                Cobro=SimpleNamespace(
                    id_cobro=8,
                    id_cliente=3,
                    origen_financiero="INTERNET",
                    id_instalacion=None,
                    id_servicio=None,
                    periodo="2026-10",
                    fecha_emision=date(2026, 10, 1),
                    fecha_vencimiento=date(2026, 10, 15),
                    monto=Decimal("100.00"),
                    estado="Pendiente",
                ),
                total_aplicado=Decimal("20.00"),
                cliente_nombres="Ana",
                cliente_apellidos="Morales",
                cliente_telefono="5555-0314",
                numero_cotizacion="COT-2026-0010",
                id_proforma=5,
                tipo_instalacion="Internet",
            )
        ]
        db.execute.side_effect = [sin_inconsistencia, filas]
        db.scalar.return_value = 1

        response = list_cobros(
            db,
            page=2,
            page_size=5,
            estado="Pendiente",
            periodo="2026-10",
            fecha_desde=date(2026, 10, 1),
            fecha_hasta=date(2026, 10, 31),
        )

        self.assertEqual(response["items"][0]["saldo_pendiente"], Decimal("80.00"))
        self.assertEqual(response["items"][0]["cliente_nombre"], "Ana Morales")
        self.assertEqual(response["items"][0]["numero_cotizacion"], "COT-2026-0010")
        self.assertEqual(response["items"][0]["id_proforma"], 5)
        self.assertEqual(response["page"], 2)
        self.assertEqual(response["page_size"], 5)
        self.assertEqual(response["total_pages"], 1)
        statement = str(db.execute.call_args_list[1].args[0])
        self.assertIn("cobros.estado", statement)
        self.assertIn("cobros.periodo", statement)
        self.assertIn("cobros.fecha_emision", statement)
        self.assertIn("LIMIT", statement)
        self.assertIn("OFFSET", statement)

    def test_lista_pagos_aplicados_por_fk_real(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [7, 1]
        result = MagicMock()
        result.all.return_value = [
            SimpleNamespace(
                PagoDetalle=SimpleNamespace(
                    id_cobro=7,
                    concepto="Mensualidad",
                    monto_aplicado=Decimal("40.00"),
                ),
                Pago=SimpleNamespace(
                    id_pago=3,
                    id_cliente=6,
                    origen_financiero="INSTALACIONES",
                    id_movimiento_caja=12,
                    clave_idempotencia=UUID(
                        "6f51984f-e46b-4428-94a6-41ff3db37852"
                    ),
                    fecha_hora=SimpleNamespace(),
                    monto_total=Decimal("40.00"),
                    id_metodo_pago=2,
                    id_empleado=5,
                    referencia="REF-1",
                    observaciones=None,
                ),
                metodo_pago="Efectivo",
            )
        ]
        db.execute.return_value = result

        response = list_pagos_aplicados(db, 7, page=1, page_size=10)

        self.assertEqual(response["total"], 1)
        self.assertEqual(response["items"][0]["monto_aplicado"], Decimal("40.00"))
        self.assertEqual(response["items"][0]["id_cliente"], 6)
        self.assertEqual(
            response["items"][0]["origen_financiero"], "INSTALACIONES"
        )
        self.assertEqual(response["items"][0]["id_movimiento_caja"], 12)
        self.assertEqual(
            response["items"][0]["clave_idempotencia"],
            UUID("6f51984f-e46b-4428-94a6-41ff3db37852"),
        )
        statement = str(db.execute.call_args.args[0])
        self.assertIn("pago_detalles.id_cobro", statement)
        self.assertIn("JOIN pagos", statement)

    def test_lista_anticipos_por_cliente_y_origen(self) -> None:
        """Calcula el saldo de pagos incluso cuando aun no poseen detalles."""

        db = MagicMock()
        sin_inconsistencia = MagicMock()
        sin_inconsistencia.first.return_value = None
        filas = MagicMock()
        filas.all.return_value = [
            SimpleNamespace(
                Pago=SimpleNamespace(
                    id_pago=31,
                    id_cliente=4,
                    origen_financiero="INSTALACIONES",
                    fecha_hora=datetime(2026, 10, 16, 10, 0),
                    id_metodo_pago=2,
                    monto_total=Decimal("150.00"),
                    referencia="REF-100",
                    observaciones="Anticipo",
                ),
                metodo_pago="Transferencia",
                monto_aplicado=Decimal("100.00"),
            )
        ]
        db.execute.side_effect = [sin_inconsistencia, filas]
        db.scalar.return_value = 1

        response = list_pagos_con_saldo(
            db,
            id_cliente=4,
            origen_financiero="INSTALACIONES",
            page=1,
            page_size=10,
        )

        self.assertEqual(response["total"], 1)
        self.assertEqual(response["items"][0]["monto_aplicado"], Decimal("100.00"))
        self.assertEqual(response["items"][0]["monto_no_aplicado"], Decimal("50.00"))
        statements = " ".join(str(call.args[0]) for call in db.execute.call_args_list)
        self.assertIn("pagos.id_cliente", statements)
        self.assertIn("pagos.origen_financiero", statements)
        self.assertIn("LEFT OUTER JOIN", statements)

    def test_historial_aplica_filtros_y_paginacion(self) -> None:
        db = MagicMock()
        db.scalar.return_value = 0
        db.scalars.return_value.all.return_value = []

        response = list_historial_cobros(
            db,
            page=1,
            page_size=20,
            id_cobro=9,
            resultado="Contactado",
            fecha_desde=date(2026, 10, 1),
            fecha_hasta=date(2026, 10, 31),
        )

        self.assertEqual(response["items"], [])
        statement = str(db.scalars.call_args.args[0])
        self.assertIn("gestiones_cobro.id_cobro", statement)
        self.assertIn("gestiones_cobro.resultado", statement)
        self.assertIn("gestiones_cobro.fecha_hora", statement)


class OrdenesTrabajoCobroServiceTests(unittest.TestCase):
    """Cubre la integracion de pagos de orden sin emitir comprobante PDF."""

    def test_registro_de_orden_exige_cotizacion(self) -> None:
        with self.assertRaises(ValidationError):
            RegistroPagoCreate(
                id_cliente=4,
                origen_financiero="ORDENES_TRABAJO",
                clave_idempotencia=UUID("6f51984f-e46b-4428-94a6-41ff3db37852"),
                id_metodo_pago=2,
                monto_total=Decimal("100.00"),
                tipo_pago="ANTICIPO",
            )

    def test_registro_de_orden_admite_anticipo_y_total_con_dinero(self) -> None:
        for tipo_pago in ("ANTICIPO", "TOTAL"):
            with self.subTest(tipo_pago=tipo_pago):
                data = RegistroPagoCreate(
                    id_cliente=4,
                    origen_financiero="ORDENES_TRABAJO",
                    clave_idempotencia=UUID(
                        "6f51984f-e46b-4428-94a6-41ff3db37852"
                    ),
                    id_metodo_pago=2,
                    monto_total=Decimal("100.00"),
                    tipo_pago=tipo_pago,
                    id_cotizacion=8,
                )

                self.assertEqual(data.tipo_pago, tipo_pago)

    def test_tipo_pago_de_orden_no_se_admite_en_instalaciones(self) -> None:
        with self.assertRaises(ValidationError):
            RegistroPagoCreate(
                id_cliente=4,
                origen_financiero="INSTALACIONES",
                clave_idempotencia=UUID("6f51984f-e46b-4428-94a6-41ff3db37852"),
                id_metodo_pago=2,
                monto_total=Decimal("100.00"),
                tipo_pago="TOTAL",
            )

    def test_operaciones_de_orden_requieren_migracion_009(self) -> None:
        db = MagicMock()
        db.scalar.return_value = False

        with self.assertRaises(MigracionOrdenesTrabajoPendienteError):
            resolver_cotizacion_orden(db, 8, 4)
        with self.assertRaises(MigracionOrdenesTrabajoPendienteError):
            listar_cotizaciones_orden(db, 4)

    def test_enriquecer_cobros_no_consulta_sin_migracion(self) -> None:
        db = MagicMock()
        db.scalar.return_value = False
        items = [{"id_cobro": 50, "origen_financiero": "ORDENES_TRABAJO"}]

        result = enriquecer_cobros_orden(db, items)

        self.assertIs(result, items)
        self.assertNotIn("codigo_orden", result[0])

    def test_lista_orden_completada_mientras_conserva_saldo(self) -> None:
        db = MagicMock()
        cotizacion = SimpleNamespace(
            id_cotizacion=8,
            numero_cotizacion="COT-2026-0008",
            id_cliente=4,
            cliente=SimpleNamespace(nombres="Ana", apellidos="Morales"),
            estado="COMPLETADA",
        )
        orden = SimpleNamespace(
            id_orden=8,
            codigo="OT-2026-0008",
            estado="Completada",
        )
        row = SimpleNamespace(
            Cotizacion=cotizacion,
            Proforma=SimpleNamespace(id_proforma=9),
            OrdenTrabajo=orden,
        )
        resultado_cotizaciones = MagicMock()
        resultado_cotizaciones.unique.return_value.all.return_value = [row]
        resultado_aplicaciones = MagicMock()
        resultado_aplicaciones.all.return_value = [(50, Decimal("100.00"))]
        db.execute.side_effect = [resultado_cotizaciones, resultado_aplicaciones]
        db.scalars.return_value.all.return_value = [
            SimpleNamespace(
                id_cobro=50,
                id_orden_trabajo=8,
                monto=Decimal("300.00"),
            )
        ]

        with (
            patch(
                "app.modules.finanzas.services.cobros_ordenes._requerir_migracion"
            ),
            patch(
                "app.modules.finanzas.services.cobros_ordenes._total_cotizacion",
                return_value=Decimal("300.00"),
            ),
        ):
            response = listar_cotizaciones_orden(db, 4)

        self.assertEqual(len(response), 1)
        self.assertEqual(response[0]["estado_orden"], "Completada")
        self.assertEqual(response[0]["estado_cotizacion"], "COMPLETADA")
        self.assertEqual(response[0]["saldo_pendiente"], Decimal("200.00"))

    def _confirmar_pago_orden(
        self, *, tipo="TOTAL", monto="300.00", estado="ACEPTADA", pagado="0.00", db=None,
    ):
        """Ejercita el registro real con persistencia simulada para cada etapa del pago."""
        db = db if db is not None else MagicMock()
        categoria = SimpleNamespace(id_categoria=5)
        metodo = SimpleNamespace(id_metodo_pago=2, nombre="Efectivo", estado="Activo")
        fecha = datetime(2026, 10, 18, 15, 0)
        db.scalar.side_effect = [None, categoria, metodo, fecha]

        quote = SimpleNamespace(
            id_cliente=4,
            estado=estado,
            fecha_actualizacion=None,
        )
        orden = SimpleNamespace(id_orden=8, id_cliente=4, codigo="OT-2026-0008", estado="En Proceso")
        cobro = SimpleNamespace(
            id_cobro=50,
            id_cliente=4,
            origen_financiero="ORDENES_TRABAJO",
            id_instalacion=None,
            id_orden_trabajo=8,
            monto=Decimal("300.00"),
            estado="Pendiente",
        )

        def asignar_identidad(objeto) -> None:
            if isinstance(objeto, MovimientoCaja):
                objeto.id_movimiento = 21
            elif isinstance(objeto, Pago):
                objeto.id_pago = 31

        db.add.side_effect = asignar_identidad
        data = RegistroPagoCreate(
            id_cliente=4,
            origen_financiero="ORDENES_TRABAJO",
            clave_idempotencia=UUID("6f51984f-e46b-4428-94a6-41ff3db37852"),
            id_metodo_pago=2,
            monto_total=Decimal(monto),
            tipo_pago=tipo,
            id_cotizacion=8,
        )

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_caja"),
            patch(
                "app.modules.finanzas.services.cobros._sesion_abierta",
                return_value=SimpleNamespace(id_sesion=3),
            ),
            patch(
                "app.modules.finanzas.services.cobros.resolver_cotizacion_orden",
                return_value=(
                    quote,
                    SimpleNamespace(id_proforma=2),
                    orden,
                    Decimal("300.00"),
                ),
            ),
            patch(
                "app.modules.finanzas.services.cobros.obtener_o_crear_cobro_orden",
                return_value=cobro,
            ),
            patch(
                "app.modules.finanzas.services.cobros.total_aplicado_cobro",
                return_value=Decimal(pagado),
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_cliente_y_fuente"),
            patch(
                "app.modules.finanzas.services.cobros._bloquear_cobros_pago",
                return_value=([cobro], {50: Decimal(pagado) + Decimal(monto)}),
            ),
            patch(
                "app.modules.finanzas.services.cobros.crear_comprobante_pago"
            ) as comprobante_pdf,
        ):
            response = registrar_pago(db, data, SimpleNamespace(id_empleado=7, estado="Activo"))

        detalles = db.add_all.call_args.args[0]
        self.assertEqual(len(detalles), 1)
        self.assertEqual(detalles[0].id_cobro, 50)
        self.assertEqual(detalles[0].monto_aplicado, Decimal(monto))
        self.assertEqual(quote.estado, "COMPLETADA")
        self.assertEqual(orden.estado, "En Proceso")
        self.assertEqual(response["tipo_pago"], tipo)
        self.assertEqual(response["comprobante"], None)
        comprobante_pdf.assert_not_called()
        movimiento = next(
            call.args[0]
            for call in db.add.call_args_list
            if isinstance(call.args[0], MovimientoCaja)
        )
        self.assertEqual(movimiento.concepto, "Pago de orden OT-2026-0008")
        self.assertEqual(movimiento.origen_financiero, "ORDENES_TRABAJO")
        pago_creado = next(
            call.args[0]
            for call in db.add.call_args_list
            if isinstance(call.args[0], Pago)
        )
        self.assertEqual(pago_creado.tipo_pago, tipo)
        db.commit.assert_called_once()
        db.rollback.assert_not_called()
        return quote, cobro

    def test_pago_de_orden_crea_obligacion_y_no_genera_comprobante(self) -> None:
        self._confirmar_pago_orden()

    def test_primer_pago_parcial_completa_cotizacion_sin_liquidar_deuda(self) -> None:
        for tipo in ("ANTICIPO",):
            with self.subTest(tipo=tipo):
                quote, cobro = self._confirmar_pago_orden(tipo=tipo, monto="100.00")
                self.assertIsNotNone(quote.fecha_actualizacion)
                self.assertEqual(cobro.estado, "Pendiente")
                self.assertEqual(cobro.monto, Decimal("300.00"))

    def test_pagos_posteriores_sobre_completada_conservan_o_liquidan_saldo(self) -> None:
        quote, cobro = self._confirmar_pago_orden(
            tipo="ANTICIPO", monto="50.00", estado="COMPLETADA", pagado="100.00",
        )
        self.assertEqual(cobro.estado, "Pendiente")
        # Un pago posterior no vuelve a fechar la transicion comercial inicial.
        self.assertIsNone(quote.fecha_actualizacion)
        _, cobro = self._confirmar_pago_orden(
            tipo="TOTAL", monto="150.00", estado="COMPLETADA", pagado="150.00",
        )
        self.assertEqual(cobro.estado, "Pagado")

    def test_fallo_de_confirmacion_revierte_pago_y_transicion_comercial(self) -> None:
        db = MagicMock()
        with patch(
            "app.modules.finanzas.services.cobros._pago_confirmado_response",
            side_effect=RuntimeError("Fallo simulado antes del commit"),
        ):
            with self.assertRaises(RuntimeError):
                self._confirmar_pago_orden(tipo="ANTICIPO", monto="100.00", db=db)
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_tipo_pago_de_orden_debe_corresponder_al_saldo(self) -> None:
        casos = (
            ("TOTAL", "100.00"),
            ("ANTICIPO", "300.00"),
        )
        for tipo_pago, monto in casos:
            with self.subTest(tipo_pago=tipo_pago):
                db = MagicMock()
                db.scalar.side_effect = [
                    None,
                    SimpleNamespace(id_categoria=5),
                    SimpleNamespace(id_metodo_pago=2, nombre="Efectivo", estado="Activo"),
                ]
                data = RegistroPagoCreate(
                    id_cliente=4,
                    origen_financiero="ORDENES_TRABAJO",
                    clave_idempotencia=UUID(
                        "6f51984f-e46b-4428-94a6-41ff3db37852"
                    ),
                    id_metodo_pago=2,
                    monto_total=Decimal(monto),
                    tipo_pago=tipo_pago,
                    id_cotizacion=8,
                )
                cobro = SimpleNamespace(
                    id_cobro=50,
                    monto=Decimal("300.00"),
                )

                with (
                    patch(
                        "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
                    ),
                    patch("app.modules.finanzas.services.cobros._bloquear_caja"),
                    patch(
                        "app.modules.finanzas.services.cobros._sesion_abierta",
                        return_value=SimpleNamespace(id_sesion=3),
                    ),
                    patch(
                        "app.modules.finanzas.services.cobros.resolver_cotizacion_orden",
                        return_value=(
                            SimpleNamespace(id_cliente=4),
                            SimpleNamespace(id_proforma=9),
                            SimpleNamespace(id_orden=8, id_cliente=4),
                            Decimal("300.00"),
                        ),
                    ),
                    patch(
                        "app.modules.finanzas.services.cobros.obtener_o_crear_cobro_orden",
                        return_value=cobro,
                    ),
                    patch(
                        "app.modules.finanzas.services.cobros.total_aplicado_cobro",
                        return_value=Decimal("0.00"),
                    ),
                ):
                    with self.assertRaises(TipoPagoOrdenInvalidoError):
                        registrar_pago(db, data, SimpleNamespace(id_empleado=7, estado="Activo"))

                db.add.assert_not_called()
                db.rollback.assert_called_once()

    def test_reintento_de_orden_incluye_tipo_pago_en_idempotencia(self) -> None:
        db = MagicMock()
        db.scalar.return_value = SimpleNamespace(
            id_pago=31,
            id_cliente=4,
            origen_financiero="ORDENES_TRABAJO",
            id_metodo_pago=2,
            id_empleado=7,
            monto_total=Decimal("100.00"),
            tipo_pago="ANTICIPO",
            referencia=None,
            observaciones=None,
        )
        data = RegistroPagoCreate(
            id_cliente=4,
            origen_financiero="ORDENES_TRABAJO",
            clave_idempotencia=UUID("6f51984f-e46b-4428-94a6-41ff3db37852"),
            id_metodo_pago=2,
            monto_total=Decimal("100.00"),
            tipo_pago="TOTAL",
            id_cotizacion=8,
        )

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_caja"),
            patch(
                "app.modules.finanzas.services.cobros._detalles_pago",
                return_value=[],
            ),
        ):
            with self.assertRaises(ClaveIdempotenciaEnConflictoError):
                registrar_pago(db, data, SimpleNamespace(id_empleado=7))

        db.add.assert_not_called()
        db.rollback.assert_called_once()


class RegistroPendientesServiceTests(unittest.TestCase):
    """Pruebas aisladas: la obligación se guarda sin pagos, aplicaciones ni Caja."""

    def test_pendiente_completa_cotizacion_y_conserva_deuda_sin_ingresos(self) -> None:
        for origen in ("ORDENES_TRABAJO", "INSTALACIONES"):
            with self.subTest(origen=origen):
                db = MagicMock()
                cotizacion = SimpleNamespace(id_cotizacion=8, id_cliente=4, estado="ACEPTADA")
                orden = SimpleNamespace(id_orden=12, id_cliente=4, estado="En Proceso")
                db.scalars.return_value.all.return_value = []
                db.execute.return_value.scalar_one.return_value = date(2026, 10, 20)
                fecha_registro = datetime(2026, 10, 20, 12)
                db.scalar.return_value = fecha_registro

                def asignar_id(objeto):
                    objeto.id_cobro = 50

                db.add.side_effect = asignar_id
                respuesta = {
                    "id_cobro": 50, "saldo_pendiente": Decimal("300.00"),
                    "total_pagado": Decimal("0.00"), "estado": "Pendiente",
                }
                data = RegistroPendienteCreate(
                    id_cliente=4, origen_financiero=origen, id_cotizacion=8,
                )
                with (
                    patch("app.modules.finanzas.services.cobros._verificar_migracion_financiera"),
                    patch("app.modules.finanzas.services.cobros.resolver_cotizacion_orden", return_value=(cotizacion, SimpleNamespace(), orden, Decimal("300.00"))),
                    patch("app.modules.finanzas.services.cobros.resolver_cotizacion_instalacion", return_value=(cotizacion, SimpleNamespace(), None, Decimal("300.00"))),
                    patch("app.modules.finanzas.services.cobros.get_cobro", return_value=respuesta),
                    patch("app.modules.finanzas.services.cobros._sesion_abierta") as sesion_caja,
                    patch("app.modules.finanzas.services.cobros.crear_comprobante_pago") as comprobante,
                ):
                    resultado = registrar_obligacion_pendiente(db, data)
                    cobro = db.add.call_args.args[0]
                    self.assertIsInstance(cobro, Cobro)
                    self.assertEqual(cobro.monto, Decimal("300.00"))
                    self.assertEqual(cobro.estado, "Pendiente")
                    self.assertEqual(cotizacion.estado, "COMPLETADA")
                    self.assertEqual(cotizacion.fecha_actualizacion, fecha_registro)
                    self.assertEqual(orden.estado, "En Proceso")
                    self.assertEqual(resultado["saldo_pendiente"], Decimal("300.00"))
                    self.assertEqual(data.monto_total, Decimal("0.00"))
                    # El reintento obtiene la misma obligación, sin duplicarla ni borrar abonos.
                    db.scalars.return_value.all.return_value = [cobro]
                    respuesta.update(total_pagado=Decimal("100.00"), saldo_pendiente=Decimal("200.00"))
                    resultado = registrar_obligacion_pendiente(db, data)
                    self.assertEqual(resultado["saldo_pendiente"], Decimal("200.00"))
                    self.assertEqual(resultado["total_pagado"], Decimal("100.00"))
                    self.assertEqual(cotizacion.fecha_actualizacion, fecha_registro)
                    self.assertEqual(orden.estado, "En Proceso")
                    db.scalar.assert_called_once()
                    db.add.assert_called_once()
                    db.add_all.assert_not_called()
                    sesion_caja.assert_not_called()
                    comprobante.assert_not_called()
                    self.assertEqual(db.commit.call_count, 2)

    def test_contrato_pendiente_no_admite_dinero_metodo_ni_aplicaciones(self) -> None:
        base = dict(id_cliente=4, origen_financiero="ORDENES_TRABAJO", id_cotizacion=8)
        for extra in ({"monto_total": 1}, {"monto_total": -1}, {"id_metodo_pago": 1}, {"aplicaciones": []}):
            with self.subTest(extra=extra), self.assertRaises(ValidationError):
                RegistroPendienteCreate(**base, **extra)
        for origen in ("ORDENES_TRABAJO", "INSTALACIONES"):
            with self.subTest(origen=origen), self.assertRaises(ValidationError):
                RegistroPagoCreate(
                    id_cliente=4, origen_financiero=origen, id_cotizacion=8,
                    clave_idempotencia=UUID("6f51984f-e46b-4428-94a6-41ff3db37852"),
                    id_metodo_pago=2, monto_total=100, tipo_pago="PENDIENTE",
                )

    def test_error_de_fuente_revierte_sin_registrar_dinero(self) -> None:
        db = MagicMock()
        data = RegistroPendienteCreate(id_cliente=4, origen_financiero="ORDENES_TRABAJO", id_cotizacion=8)
        with (
            patch("app.modules.finanzas.services.cobros._verificar_migracion_financiera"),
            patch("app.modules.finanzas.services.cobros.resolver_cotizacion_orden", side_effect=RuntimeError("Fuente inválida simulada")),
        ):
            with self.assertRaises(RuntimeError):
                registrar_obligacion_pendiente(db, data)
        db.add.assert_not_called()
        db.add_all.assert_not_called()
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_fallo_de_commit_revierte_obligacion_y_estado_comercial(self) -> None:
        db = MagicMock()
        cotizacion = SimpleNamespace(estado="ACEPTADA")
        orden = SimpleNamespace(estado="En Proceso")
        db.scalar.return_value = datetime(2026, 10, 20, 12)
        db.commit.side_effect = RuntimeError("Fallo de confirmacion simulado")
        data = RegistroPendienteCreate(id_cliente=4, origen_financiero="ORDENES_TRABAJO", id_cotizacion=8)
        with (
            patch("app.modules.finanzas.services.cobros._verificar_migracion_financiera"),
            patch("app.modules.finanzas.services.cobros.resolver_cotizacion_orden", return_value=(cotizacion, None, orden, Decimal("300.00"))),
            patch("app.modules.finanzas.services.cobros.obtener_o_crear_cobro_orden", return_value=SimpleNamespace(id_cobro=50)),
            patch("app.modules.finanzas.services.cobros.get_cobro", return_value={"saldo_pendiente": Decimal("300.00")}),
        ):
            with self.assertRaises(RuntimeError):
                registrar_obligacion_pendiente(db, data)
        db.rollback.assert_called_once()
        self.assertEqual(orden.estado, "En Proceso")
        db.add.assert_not_called()
        db.add_all.assert_not_called()

    def test_endpoint_pendiente_respeta_el_permiso_del_origen(self) -> None:
        data = RegistroPendienteCreate(id_cliente=4, origen_financiero="ORDENES_TRABAJO", id_cotizacion=8)
        usuario = SimpleNamespace(rol=SimpleNamespace(nombre="Empleado"), modulos=[SimpleNamespace(codigo="pagos_instalaciones", activo=True)])
        with patch("app.modules.finanzas.routers.cobros.registrar_obligacion_pendiente") as registrar:
            with self.assertRaises(HTTPException) as contexto:
                registrar_pendiente(data, usuario, SimpleNamespace(id_empleado=7), MagicMock())
            self.assertEqual(contexto.exception.status_code, 403)
            registrar.assert_not_called()
            usuario.modulos = [SimpleNamespace(codigo="pagos_ordenes_trabajo", activo=True)]
            registrar.return_value = {"id_cobro": 50}
            self.assertEqual(registrar_pendiente(data, usuario, SimpleNamespace(id_empleado=7), MagicMock()), {"id_cobro": 50})
            registrar.assert_called_once()


class RegistroPagosServiceTests(unittest.TestCase):
    """Cubre atomicidad, idempotencia y distribucion de pagos confirmados."""

    CLAVE = UUID("6f51984f-e46b-4428-94a6-41ff3db37852")

    @classmethod
    def _data(
        cls,
        *,
        monto_total: str = "150.00",
        aplicaciones: list[dict] | None = None,
        periodos_internet: list[dict] | None = None,
        origen: str = "INSTALACIONES",
    ) -> RegistroPagoCreate:
        return RegistroPagoCreate(
            id_cliente=4,
            origen_financiero=origen,
            clave_idempotencia=cls.CLAVE,
            id_metodo_pago=2,
            monto_total=Decimal(monto_total),
            referencia="REF-100",
            observaciones="Pago recibido",
            aplicaciones=aplicaciones or [],
            periodos_internet=periodos_internet or [],
        )

    @staticmethod
    def _empleado() -> SimpleNamespace:
        return SimpleNamespace(id_empleado=7, estado="Activo")

    @classmethod
    def _pago_anticipado(cls, monto: str = "150.00") -> SimpleNamespace:
        return SimpleNamespace(
            id_pago=31,
            id_cliente=4,
            origen_financiero="INSTALACIONES",
            id_movimiento_caja=21,
            clave_idempotencia=cls.CLAVE,
            id_metodo_pago=2,
            id_empleado=7,
            id_entrega=None,
            monto_total=Decimal(monto),
            fecha_hora=datetime(2026, 10, 16, 10, 0),
            referencia="REF-100",
            observaciones="Pago recibido",
        )

    def test_administrador_sin_empleado_registra_cobrador_explicito(self) -> None:
        db = MagicMock()
        db.get.return_value = self._empleado()
        categoria = SimpleNamespace(id_categoria=4)
        metodo = SimpleNamespace(id_metodo_pago=2, nombre="Efectivo", estado="Activo")
        fecha = datetime(2026, 10, 16, 10, 0)
        db.scalar.side_effect = [None, categoria, metodo, fecha]
        cobro_completo = SimpleNamespace(id_cobro=8, monto=Decimal("100.00"), estado="Pendiente")
        cobro_parcial = SimpleNamespace(id_cobro=9, monto=Decimal("100.00"), estado="Vencido")

        def asignar_identidad(objeto) -> None:
            if isinstance(objeto, MovimientoCaja):
                objeto.id_movimiento = 21
            elif isinstance(objeto, Pago):
                objeto.id_pago = 31

        db.add.side_effect = asignar_identidad
        data = self._data(
            aplicaciones=[
                {"id_cobro": 9, "monto_aplicado": Decimal("25.00")},
                {"id_cobro": 8, "monto_aplicado": Decimal("100.00")},
            ]
        )

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_caja") as lock_caja,
            patch(
                "app.modules.finanzas.services.cobros._sesion_abierta",
                return_value=SimpleNamespace(id_sesion=3, id_empleado=7),
            ),
            patch(
                "app.modules.finanzas.services.cobros._bloquear_cliente_y_fuente"
            ) as lock_cliente,
            patch(
                "app.modules.finanzas.services.cobros._bloquear_cobros_pago",
                return_value=(
                    [cobro_completo, cobro_parcial],
                    {8: Decimal("100.00"), 9: Decimal("25.00")},
                ),
            ),
            patch(
                "app.modules.finanzas.services.cobros.crear_comprobante_pago",
                return_value=(
                    SimpleNamespace(id_comprobante=1, id_pago=31),
                    MagicMock(),
                    None,
                ),
            ),
            patch(
                "app.modules.finanzas.services.cobros.ticket_response",
                return_value={"numero": "COB-000001"},
            ),
        ):
            response = registrar_pago(db, data, None)

        objetos = [call.args[0] for call in db.add.call_args_list]
        movimientos = [obj for obj in objetos if isinstance(obj, MovimientoCaja)]
        pagos = [obj for obj in objetos if isinstance(obj, Pago)]
        detalles = db.add_all.call_args.args[0]
        self.assertEqual(len(movimientos), 1)
        self.assertEqual(len(pagos), 1)
        self.assertEqual(len(detalles), 2)
        self.assertEqual(movimientos[0].id_sesion, 3)
        self.assertEqual(movimientos[0].id_responsable, 7)
        self.assertEqual(movimientos[0].origen_financiero, "INSTALACIONES")
        self.assertEqual(pagos[0].id_movimiento_caja, 21)
        self.assertEqual(pagos[0].id_empleado, 7)
        self.assertEqual([detalle.id_cobro for detalle in detalles], [8, 9])
        self.assertEqual(cobro_completo.estado, "Pagado")
        self.assertEqual(cobro_parcial.estado, "Vencido")
        self.assertEqual(response["monto_aplicado"], Decimal("125.00"))
        self.assertEqual(response["monto_no_aplicado"], Decimal("25.00"))
        lock_caja.assert_called_once_with(db)
        lock_cliente.assert_called_once_with(db, 4, "INSTALACIONES")
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    def test_reintento_idempotente_reutiliza_pago_sin_movimiento_nuevo(self) -> None:
        db = MagicMock()
        pago = SimpleNamespace(
            id_pago=31,
            id_cliente=4,
            origen_financiero="INSTALACIONES",
            id_movimiento_caja=21,
            clave_idempotencia=self.CLAVE,
            id_metodo_pago=2,
            id_empleado=7,
            id_entrega=None,
            monto_total=Decimal("150.00"),
            fecha_hora=datetime(2026, 10, 16, 10, 0),
            referencia="REF-100",
            observaciones="Pago recibido",
        )
        detalle = SimpleNamespace(
            id_pago=31,
            id_cobro=8,
            id_cliente=4,
            origen_financiero="INSTALACIONES",
            concepto=None,
            monto_aplicado=Decimal("100.00"),
        )
        detalle_posterior = SimpleNamespace(
            id_pago=31,
            id_cobro=9,
            id_cliente=4,
            origen_financiero="INSTALACIONES",
            concepto="Distribucion posterior",
            monto_aplicado=Decimal("25.00"),
        )
        db.scalar.return_value = pago
        data = self._data(
            aplicaciones=[{"id_cobro": 8, "monto_aplicado": Decimal("100.00")}]
        )

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_caja"),
            patch(
                "app.modules.finanzas.services.cobros._detalles_pago",
                return_value=[detalle, detalle_posterior],
            ),
            patch("app.modules.finanzas.services.cobros._sesion_abierta") as sesion,
            patch(
                "app.modules.finanzas.services.cobros.crear_comprobante_pago",
                return_value=(
                    SimpleNamespace(id_comprobante=1, id_pago=31),
                    MagicMock(),
                    None,
                ),
            ),
            patch(
                "app.modules.finanzas.services.cobros.ticket_response",
                return_value={"numero": "COB-000001"},
            ),
        ):
            response = registrar_pago(db, data, self._empleado())

        self.assertEqual(response["id_pago"], 31)
        self.assertEqual(response["id_movimiento_caja"], 21)
        self.assertEqual(response["monto_no_aplicado"], Decimal("25.00"))
        sesion.assert_not_called()
        db.add.assert_not_called()
        db.commit.assert_called_once()

    def test_clave_idempotente_distinta_revierte(self) -> None:
        db = MagicMock()
        pago = SimpleNamespace(
            id_pago=31,
            id_cliente=4,
            origen_financiero="INSTALACIONES",
            id_metodo_pago=2,
            id_empleado=7,
            monto_total=Decimal("100.00"),
            referencia="REF-100",
            observaciones="Pago recibido",
        )
        db.scalar.return_value = pago

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_caja"),
            patch(
                "app.modules.finanzas.services.cobros._detalles_pago",
                return_value=[],
            ),
        ):
            with self.assertRaises(ClaveIdempotenciaEnConflictoError):
                registrar_pago(db, self._data(), self._empleado())

        db.rollback.assert_called_once()
        db.commit.assert_not_called()
        db.add.assert_not_called()

    def test_internet_confirma_un_ingreso_y_aplica_la_mensualidad(self) -> None:
        db = MagicMock()
        categoria = SimpleNamespace(id_categoria=4)
        metodo = SimpleNamespace(id_metodo_pago=2, nombre="Transferencia", estado="Activo")
        fecha = datetime(2026, 11, 15, 10)
        db.scalar.side_effect = [None, categoria, metodo, fecha]

        def asignar_identidad(objeto) -> None:
            if isinstance(objeto, MovimientoCaja):
                objeto.id_movimiento = 21
            elif isinstance(objeto, Pago):
                objeto.id_pago = 31

        db.add.side_effect = asignar_identidad
        data = self._data(
            monto_total="100.00",
            origen="INTERNET",
            aplicaciones=[{"id_cobro": 8, "monto_aplicado": Decimal("100.00")}],
        )
        data = data.model_copy(update={"recepcion_efectivo": None, "id_empleado_receptor": None})
        cobro = SimpleNamespace(id_cobro=8, monto=Decimal("100.00"), estado="Pendiente")
        with (
            patch("app.modules.finanzas.services.cobros._verificar_migracion_financiera"),
            patch("app.modules.finanzas.services.cobros._bloquear_caja"),
            patch("app.modules.finanzas.services.cobros._sesion_abierta", return_value=SimpleNamespace(id_sesion=3)),
            patch("app.modules.finanzas.services.cobros._bloquear_cliente_y_fuente") as lock_cliente,
            patch("app.modules.finanzas.services.cobros._bloquear_cobros_pago", return_value=([cobro], {8: Decimal("100.00")})),
            patch(
                "app.modules.finanzas.services.cobros.crear_comprobante_pago",
                return_value=(
                    SimpleNamespace(id_comprobante=1, id_pago=31),
                    {"numero": "COB-000001"},
                    None,
                ),
            ),
            patch(
                "app.modules.finanzas.services.cobros.ticket_response",
                return_value={"numero": "COB-000001"},
            ),
        ):
            respuesta = registrar_pago(db, data, self._empleado())

        movimiento = next(
            llamada.args[0]
            for llamada in db.add.call_args_list
            if isinstance(llamada.args[0], MovimientoCaja)
        )
        self.assertEqual(movimiento.origen_financiero, "INTERNET")
        self.assertEqual(movimiento.concepto, "Pago de Internet")
        self.assertEqual(respuesta["id_movimiento_caja"], 21)
        self.assertEqual(respuesta["comprobante"], {"numero": "COB-000001"})
        self.assertEqual(cobro.estado, "Pagado")
        lock_cliente.assert_called_once_with(db, 4, "INTERNET")
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    def test_reintento_mixto_compara_solo_los_periodos_proyectados(self) -> None:
        """Un reintento válido no debe confundir la aplicación persistida."""

        pago = SimpleNamespace(
            id_cliente=4,
            origen_financiero="INTERNET",
            id_metodo_pago=2,
            id_empleado=7,
            monto_total=Decimal("425.00"),
            tipo_pago=None,
            referencia="REF-100",
            observaciones="Pago recibido",
        )
        detalles = [
            SimpleNamespace(
                id_cobro=8,
                monto_aplicado=Decimal("200.00"),
                concepto="Cobro 8",
            ),
            SimpleNamespace(
                id_cobro=40,
                monto_aplicado=Decimal("225.00"),
                concepto="Internet 2026-11",
            ),
        ]
        db = MagicMock()
        db.scalars.return_value.all.return_value = [
            SimpleNamespace(
                id_cobro=8,
                id_servicio=8,
                periodo="2026-10",
                origen_financiero="INTERNET",
            ),
            SimpleNamespace(
                id_cobro=40,
                id_servicio=8,
                periodo="2026-11",
                origen_financiero="INTERNET",
            ),
        ]
        data = self._data(
            monto_total="425.00",
            origen="INTERNET",
            aplicaciones=[
                {
                    "id_cobro": 8,
                    "monto_aplicado": Decimal("200.00"),
                    "concepto": "Cobro 8",
                }
            ],
            periodos_internet=[{"id_servicio": 8, "periodo": "2026-11"}],
        )

        self.assertTrue(_reintento_coincide(db, pago, detalles, data, 7))

        distinto = data.model_copy(
            update={
                "periodos_internet": [
                    PeriodoInternetPagoCreate(id_servicio=8, periodo="2026-12")
                ]
            }
        )
        self.assertFalse(_reintento_coincide(db, pago, detalles, distinto, 7))

    def test_prepara_periodos_aplica_saldo_completo_y_exige_total(self) -> None:
        db = MagicMock()
        asignacion = SimpleNamespace(id_asignacion=8)
        nuevo = SimpleNamespace(
            id_cobro=40,
            id_servicio=8,
            periodo="2026-11",
            id_cliente=4,
            monto=Decimal("225.50"),
        )
        db.scalars.return_value.all.return_value = [asignacion]
        db.execute.return_value.all.return_value = []

        with (
            patch(
                "app.modules.finanzas.services.cobros._resolver_mensualidades_internet",
                return_value=([nuevo], []),
            ) as resolver,
            patch(
                "app.modules.finanzas.services.cobros._bloquear_cobros_por_ids",
                return_value=[nuevo],
            ),
        ):
            data = self._data(
                monto_total="225.50",
                origen="INTERNET",
                periodos_internet=[{"id_servicio": 8, "periodo": "2026-11"}],
            )
            preparado = _preparar_periodos_pago(db, data)

        self.assertEqual(preparado.aplicaciones[0].id_cobro, 40)
        self.assertEqual(
            preparado.aplicaciones[0].monto_aplicado,
            Decimal("225.50"),
        )
        resolver.assert_called_once()

        with self.assertRaises(DistribucionPagoIncompatibleError):
            with (
                patch(
                    "app.modules.finanzas.services.cobros._resolver_mensualidades_internet",
                    return_value=([nuevo], []),
                ),
                patch(
                    "app.modules.finanzas.services.cobros._bloquear_cobros_por_ids",
                    return_value=[nuevo],
                ),
            ):
                _preparar_periodos_pago(
                    db,
                    self._data(
                        monto_total="200.00",
                        origen="INTERNET",
                        periodos_internet=[{"id_servicio": 8, "periodo": "2026-11"}],
                    ),
                )

    def test_migracion_pendiente_desactiva_el_registro(self) -> None:
        db = MagicMock()
        with patch(
            "app.modules.finanzas.services.cobros._verificar_migracion_financiera",
            side_effect=MigracionFinancieraPendienteError,
        ):
            with self.assertRaises(MigracionFinancieraPendienteError):
                registrar_pago(db, self._data(), self._empleado())

        db.add.assert_not_called()
        db.rollback.assert_called_once()

    def test_sobrepago_revierte_sin_generar_ingreso(self) -> None:
        db = MagicMock()
        categoria = SimpleNamespace(id_categoria=4)
        metodo = SimpleNamespace(id_metodo_pago=2, nombre="Efectivo", estado="Activo")
        db.scalar.side_effect = [None, categoria, metodo]

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_caja"),
            patch(
                "app.modules.finanzas.services.cobros._sesion_abierta",
                return_value=SimpleNamespace(id_sesion=3),
            ),
            patch(
                "app.modules.finanzas.services.cobros._bloquear_cliente_y_fuente"
            ),
            patch(
                "app.modules.finanzas.services.cobros._bloquear_cobros_pago",
                side_effect=SobrepagoCobroError(
                    8,
                    Decimal("10.00"),
                    Decimal("20.00"),
                ),
            ),
        ):
            with self.assertRaises(SobrepagoCobroError):
                registrar_pago(db, self._data(), self._empleado())

        db.add.assert_not_called()
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_error_despues_del_movimiento_revierte_toda_la_transaccion(self) -> None:
        db = MagicMock()
        categoria = SimpleNamespace(id_categoria=4)
        metodo = SimpleNamespace(id_metodo_pago=2, nombre="Efectivo", estado="Activo")
        fecha = datetime(2026, 10, 16, 10, 0)
        db.scalar.side_effect = [None, categoria, metodo, fecha]

        def asignar_movimiento(objeto) -> None:
            if isinstance(objeto, MovimientoCaja):
                objeto.id_movimiento = 21

        db.add.side_effect = asignar_movimiento
        db.flush.side_effect = [None, RuntimeError("fallo al persistir pago")]

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_caja"),
            patch(
                "app.modules.finanzas.services.cobros._sesion_abierta",
                return_value=SimpleNamespace(id_sesion=3),
            ),
            patch(
                "app.modules.finanzas.services.cobros._bloquear_cliente_y_fuente"
            ),
            patch(
                "app.modules.finanzas.services.cobros._bloquear_cobros_pago",
                return_value=([], {}),
            ),
        ):
            with self.assertRaises(RuntimeError):
                registrar_pago(db, self._data(), self._empleado())

        self.assertTrue(
            any(
                isinstance(call.args[0], MovimientoCaja)
                for call in db.add.call_args_list
            )
        )
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_rechaza_pago_sin_sesion_abierta(self) -> None:
        db = MagicMock()
        db.scalar.return_value = None

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_caja"),
            patch(
                "app.modules.finanzas.services.cobros._sesion_abierta",
                return_value=None,
            ),
        ):
            with self.assertRaises(SesionCajaNoAbiertaError):
                registrar_pago(db, self._data(), self._empleado())

        db.add.assert_not_called()
        db.rollback.assert_called_once()

    def test_rechaza_categoria_automatica_o_metodo_inactivos(self) -> None:
        data = self._data()

        db_categoria = MagicMock()
        db_categoria.scalar.side_effect = [None, None]
        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_caja"),
            patch(
                "app.modules.finanzas.services.cobros._sesion_abierta",
                return_value=SimpleNamespace(id_sesion=3),
            ),
        ):
            with self.assertRaises(CategoriaCajaInvalidaError):
                registrar_pago(db_categoria, data, self._empleado())

        db_metodo = MagicMock()
        db_metodo.scalar.side_effect = [
            None,
            SimpleNamespace(id_categoria=4),
            SimpleNamespace(id_metodo_pago=2, nombre="Efectivo", estado="Inactivo"),
        ]
        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch("app.modules.finanzas.services.cobros._bloquear_caja"),
            patch(
                "app.modules.finanzas.services.cobros._sesion_abierta",
                return_value=SimpleNamespace(id_sesion=3),
            ),
        ):
            with self.assertRaises(MetodoPagoCajaInvalidoError):
                registrar_pago(db_metodo, data, self._empleado())

        db_categoria.rollback.assert_called_once()
        db_metodo.rollback.assert_called_once()

    def test_bloquea_cobros_en_orden_y_detecta_sobrepago(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [
            SimpleNamespace(
                id_cobro=8,
                id_cliente=4,
                origen_financiero="INSTALACIONES",
                id_instalacion=2,
                id_cotizacion=11,
                monto=Decimal("100.00"),
            )
        ]
        db.execute.return_value.all.return_value = [(8, Decimal("90.00"))]
        data = self._data(
            monto_total="20.00",
            aplicaciones=[{"id_cobro": 8, "monto_aplicado": Decimal("20.00")}],
        )

        with self.assertRaises(SobrepagoCobroError):
            _bloquear_cobros_pago(db, data)

        statement = str(db.scalars.call_args.args[0])
        self.assertIn("ORDER BY cobros.id_cobro", statement)
        self.assertIn("FOR UPDATE", statement)

    def test_mensualidad_internet_es_fuente_verificable(self) -> None:
        db = MagicMock()
        mensualidad = SimpleNamespace(
            id_cobro=8,
            id_cliente=4,
            origen_financiero="INTERNET",
            id_servicio=12,
            periodo="2026-11",
            monto=Decimal("100.00"),
        )
        db.scalars.return_value.all.return_value = [mensualidad]
        db.execute.return_value.all.return_value = []
        data = self._data(
            monto_total="100.00",
            origen="INTERNET",
            aplicaciones=[{"id_cobro": 8, "monto_aplicado": Decimal("100.00")}],
        )

        cobros, totales = _bloquear_cobros_pago(db, data)

        self.assertEqual(cobros, [mensualidad])
        self.assertEqual(totales, {8: Decimal("100.00")})

    def test_rechaza_cobro_de_otro_cliente(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [
            SimpleNamespace(
                id_cobro=8,
                id_cliente=99,
                origen_financiero="INSTALACIONES",
                id_instalacion=2,
                id_cotizacion=11,
                monto=Decimal("100.00"),
            )
        ]
        data = self._data(
            monto_total="20.00",
            aplicaciones=[{"id_cobro": 8, "monto_aplicado": Decimal("20.00")}],
        )

        with self.assertRaises(DistribucionPagoIncompatibleError):
            _bloquear_cobros_pago(db, data)

        db.execute.assert_not_called()

    def test_distribuye_anticipo_sin_crear_otro_movimiento(self) -> None:
        db = MagicMock()
        db.scalar.return_value = self._pago_anticipado()
        db.scalars.return_value.all.return_value = [
            SimpleNamespace(
                id_cobro=8,
                id_cliente=4,
                origen_financiero="INSTALACIONES",
                id_instalacion=2,
                id_cotizacion=11,
                monto=Decimal("100.00"),
                estado="Pendiente",
            )
        ]
        db.execute.return_value.all.return_value = []
        data = DistribucionPagoCreate(
            aplicaciones=[
                {"id_cobro": 8, "monto_aplicado": Decimal("100.00")}
            ]
        )

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch(
                "app.modules.finanzas.services.cobros._detalles_pago",
                return_value=[],
            ),
            patch(
                "app.modules.finanzas.services.cobros.crear_comprobante_pago",
                return_value=(
                    SimpleNamespace(id_comprobante=1, id_pago=31),
                    MagicMock(),
                    None,
                ),
            ),
            patch(
                "app.modules.finanzas.services.cobros.ticket_response",
                return_value={"numero": "COB-000001"},
            ),
        ):
            response = distribuir_pago(db, 31, data)

        detalles = db.add_all.call_args.args[0]
        self.assertEqual(len(detalles), 1)
        self.assertIsInstance(detalles[0], PagoDetalle)
        self.assertEqual(detalles[0].id_pago, 31)
        self.assertEqual(response["monto_aplicado"], Decimal("100.00"))
        self.assertEqual(response["monto_no_aplicado"], Decimal("50.00"))
        db.add.assert_not_called()
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    def test_reintento_de_distribucion_no_duplica_detalle(self) -> None:
        db = MagicMock()
        pago = self._pago_anticipado()
        detalle = SimpleNamespace(
            id_pago=31,
            id_cobro=8,
            id_cliente=4,
            origen_financiero="INSTALACIONES",
            concepto=None,
            monto_aplicado=Decimal("100.00"),
        )
        db.scalar.return_value = pago
        db.scalars.return_value.all.return_value = [
            SimpleNamespace(
                id_cobro=8,
                id_cliente=4,
                origen_financiero="INSTALACIONES",
                id_instalacion=2,
                id_cotizacion=11,
                monto=Decimal("100.00"),
                estado="Pagado",
            )
        ]
        data = DistribucionPagoCreate(
            aplicaciones=[
                {"id_cobro": 8, "monto_aplicado": Decimal("100.00")}
            ]
        )

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch(
                "app.modules.finanzas.services.cobros._detalles_pago",
                return_value=[detalle],
            ),
            patch(
                "app.modules.finanzas.services.cobros.crear_comprobante_pago",
                return_value=(
                    SimpleNamespace(id_comprobante=1, id_pago=31),
                    MagicMock(),
                    None,
                ),
            ),
            patch(
                "app.modules.finanzas.services.cobros.ticket_response",
                return_value={"numero": "COB-000001"},
            ),
        ):
            response = distribuir_pago(db, 31, data)

        self.assertEqual(response["monto_no_aplicado"], Decimal("50.00"))
        db.add_all.assert_not_called()
        db.execute.assert_not_called()
        db.commit.assert_called_once()

    def test_distribucion_superior_al_saldo_del_pago_revierte(self) -> None:
        db = MagicMock()
        pago = self._pago_anticipado()
        detalle_previo = SimpleNamespace(
            id_pago=31,
            id_cobro=7,
            id_cliente=4,
            origen_financiero="INSTALACIONES",
            concepto=None,
            monto_aplicado=Decimal("140.00"),
        )
        db.scalar.return_value = pago
        db.scalars.return_value.all.return_value = [
            SimpleNamespace(
                id_cobro=8,
                id_cliente=4,
                origen_financiero="INSTALACIONES",
                id_instalacion=2,
                id_cotizacion=11,
                monto=Decimal("100.00"),
                estado="Pendiente",
            )
        ]
        data = DistribucionPagoCreate(
            aplicaciones=[
                {"id_cobro": 8, "monto_aplicado": Decimal("20.00")}
            ]
        )

        with (
            patch(
                "app.modules.finanzas.services.cobros._verificar_migracion_financiera"
            ),
            patch(
                "app.modules.finanzas.services.cobros._detalles_pago",
                return_value=[detalle_previo],
            ),
        ):
            with self.assertRaises(SaldoPagoInsuficienteError):
                distribuir_pago(db, 31, data)

        db.add_all.assert_not_called()
        db.commit.assert_not_called()
        db.rollback.assert_called_once()


class ComprobantesCobroServiceTests(unittest.TestCase):
    """Cubre numeracion consecutiva, persistencia y PDF de comprobantes."""

    def test_consulta_de_documento_no_emite_ni_repara_el_pdf_original(self) -> None:
        db = MagicMock()
        comprobante = SimpleNamespace(
            id_comprobante=12, id_pago=31, numero="COB-000012",
            fecha_emision=date(2026, 11, 15), archivo_pdf="uploads/comprobantes_cobro/12.pdf",
        )
        pago = SimpleNamespace(id_pago=31)
        ticket = replace(self._ticket(), numero="COB-000012", periodos=("2026-11", "2026-12"))
        with (
            patch("app.modules.finanzas.services.comprobantes._construir_ticket", return_value=ticket),
            patch("app.modules.finanzas.services.comprobantes._guardar_pdf") as guardar,
            patch("app.modules.finanzas.services.comprobantes.crear_comprobante_pago") as emitir,
        ):
            respuesta = consultar_ticket_emitido(db, comprobante, pago)
        self.assertEqual(respuesta["id_comprobante"], 12)
        self.assertEqual(respuesta["periodos"], ["2026-11", "2026-12"])
        guardar.assert_not_called()
        emitir.assert_not_called()
        db.add.assert_not_called()
        db.flush.assert_not_called()
        db.commit.assert_not_called()

    def test_endpoint_documento_respeta_permiso_internet_y_no_escribe(self) -> None:
        for autorizado in (True, False):
            with self.subTest(autorizado=autorizado):
                db = MagicMock()
                comprobante = SimpleNamespace(id_pago=31)
                pago = SimpleNamespace(origen_financiero="INTERNET")
                db.get.side_effect = [comprobante, pago]
                usuario = SimpleNamespace(
                    rol=SimpleNamespace(nombre="Empleado"),
                    modulos=[SimpleNamespace(codigo="pagos_internet", activo=True)] if autorizado else [],
                )
                with patch("app.modules.finanzas.routers.cobros.consultar_ticket_emitido", return_value={"id_comprobante": 12}) as consultar:
                    if autorizado:
                        self.assertEqual(get_comprobante_ticket(12, usuario, db), {"id_comprobante": 12})
                        consultar.assert_called_once_with(db, comprobante, pago)
                    else:
                        with self.assertRaises(HTTPException) as contexto:
                            get_comprobante_ticket(12, usuario, db)
                        self.assertEqual(contexto.exception.status_code, 403)
                        consultar.assert_not_called()
                db.add.assert_not_called()
                db.commit.assert_not_called()

        db = MagicMock()
        db.get.return_value = None
        with self.assertRaises(HTTPException) as contexto:
            get_comprobante_ticket(999, usuario, db)
        self.assertEqual(contexto.exception.status_code, 404)
        operacion = app.openapi()["paths"]["/api/cobros/comprobantes/{id_comprobante}"]["get"]
        self.assertTrue(operacion.get("security"))

    def test_endpoint_copia_termica_respeta_permisos_y_no_escribe(self) -> None:
        """La copia actual reutiliza permisos y no crea ni modifica registros."""

        db = MagicMock()
        comprobante = SimpleNamespace(id_pago=31, numero="COB-000003")
        pago = SimpleNamespace(origen_financiero="INTERNET")
        db.get.side_effect = [comprobante, pago]
        usuario = SimpleNamespace(
            rol=SimpleNamespace(nombre="Empleado"),
            modulos=[SimpleNamespace(codigo="pagos_internet", activo=True)],
        )
        with patch(
            "app.modules.finanzas.routers.cobros.generar_pdf_termico",
            return_value=b"%PDF-1.4 copia",
        ) as generar:
            respuesta = get_comprobante_pdf_termico(12, usuario, db)

        self.assertEqual(respuesta.body, b"%PDF-1.4 copia")
        self.assertEqual(respuesta.media_type, "application/pdf")
        self.assertEqual(respuesta.headers["cache-control"], "no-store")
        self.assertIn("COB-000003-58mm.pdf", respuesta.headers["content-disposition"])
        generar.assert_called_once_with(db, comprobante, pago)
        db.add.assert_not_called()
        db.commit.assert_not_called()
        operacion = app.openapi()["paths"][
            "/api/cobros/comprobantes/{id_comprobante}/pdf-termico"
        ]["get"]
        self.assertTrue(operacion.get("security"))

    def test_pdf_de_58mm_formatea_periodos_y_omite_logo_y_responsable(self) -> None:
        """Verifica el dibujo monocromático sin alterar los períodos reales."""

        from reportlab.pdfgen import canvas as pdf_canvas
        from reportlab.lib.units import mm

        ticket = replace(
            self._ticket(), responsable="Empleado de auditoría",
            empresa_logo_url="/uploads/documentos_comerciales/logo.png",
            nota_fiscal="Comprobante interno sin validez fiscal.",
            periodos=("2027-01", "2026-11"),
            conceptos=(
                ConceptoTicket("Internet 2027-01", "2027-01", Decimal("125.00")),
                ConceptoTicket("Internet 2026-11", "2026-11", Decimal("125.00")),
            ),
        )
        crear_canvas = pdf_canvas.Canvas
        dibujados = []

        def capturar(*args, **kwargs):
            self.assertAlmostEqual(kwargs["pagesize"][0], 58 * mm)
            dibujo = MagicMock(wraps=crear_canvas(*args, **kwargs))
            dibujados.append(dibujo)
            return dibujo

        with tempfile.TemporaryDirectory() as directorio:
            with patch(
                "app.modules.finanzas.services.comprobantes.canvas.Canvas",
                side_effect=capturar,
            ):
                _dibujar_pdf(ticket, Path(directorio) / "ticket.pdf")

        dibujo = dibujados[0]
        textos = [str(llamada.args[2]) for llamada in dibujo.drawString.call_args_list]
        textos += [str(llamada.args[2]) for llamada in dibujo.drawCentredString.call_args_list]
        texto = "\n".join(textos)
        self.assertIn("noviembre de 2026", texto)
        self.assertIn("enero de 2027", texto)
        self.assertLess(texto.index("noviembre de 2026"), texto.index("enero de 2027"))
        self.assertNotIn("2026-11", texto)
        self.assertNotIn("RESPONSABLE", texto)
        self.assertNotIn("Empleado de auditoría", texto)
        self.assertNotIn("Descuento", texto)
        self.assertIn("Comprobante interno sin validez fiscal.", texto)
        dibujo.drawImage.assert_not_called()
        dibujo.showPage.assert_called_once()
        self.assertEqual(ticket.responsable, "Empleado de auditoría")
        self.assertEqual(ticket.periodos, ("2027-01", "2026-11"))

    def test_copia_termica_en_memoria_usa_58mm_sin_guardar_archivo(self) -> None:
        """La copia descargable usa el generador vigente y no persiste nada."""

        from reportlab.pdfgen import canvas as pdf_canvas
        from reportlab.lib.units import mm

        ticket = self._ticket()
        crear_canvas = pdf_canvas.Canvas
        tamanos = []

        def capturar(*args, **kwargs):
            tamanos.append(kwargs["pagesize"])
            return MagicMock(wraps=crear_canvas(*args, **kwargs))

        db = MagicMock()
        comprobante = SimpleNamespace(
            numero="COB-000003",
            archivo_pdf="uploads/comprobantes_cobro/COB-000003.pdf",
        )
        with (
            patch(
                "app.modules.finanzas.services.comprobantes._construir_ticket",
                return_value=ticket,
            ),
            patch(
                "app.modules.finanzas.services.comprobantes.canvas.Canvas",
                side_effect=capturar,
            ),
            patch(
                "app.modules.finanzas.services.comprobantes._guardar_pdf",
            ) as guardar,
        ):
            contenido = generar_pdf_termico(db, comprobante, SimpleNamespace())

        self.assertTrue(contenido.startswith(b"%PDF"))
        self.assertAlmostEqual(tamanos[0][0], 58 * mm)
        guardar.assert_not_called()
        db.add.assert_not_called()
        db.commit.assert_not_called()

    def test_historial_de_cobro_pagado_reutiliza_comprobante_del_pago(self) -> None:
        """La asociación usa PagoDetalle y no depende del estado del cobro."""

        db = MagicMock()
        db.scalar.return_value = 1
        db.execute.return_value.all.return_value = [SimpleNamespace(
            ComprobanteCobro=SimpleNamespace(
                id_comprobante=12, id_pago=31, numero="COB-000012",
                fecha_emision=date(2026, 11, 15), archivo_pdf="uploads/comprobantes_cobro/12.pdf",
            ),
            Pago=SimpleNamespace(
                id_cliente=4, origen_financiero="INTERNET",
                fecha_hora=datetime(2026, 11, 15, 10), monto_total=Decimal("451.00"),
            ),
            Cliente=SimpleNamespace(nombres="Ana", apellidos="Morales"),
            MetodoPago=SimpleNamespace(nombre="Efectivo"),
            Empleado=SimpleNamespace(nombres="Ana", apellidos="Admin"),
        )]
        for id_cobro in (70, 71):
            respuesta = list_comprobantes(
                db, page=1, page_size=50, id_cobro=id_cobro,
                origenes_permitidos=("INTERNET",),
            )
            self.assertEqual(respuesta["items"][0]["id_comprobante"], 12)
            consulta = db.execute.call_args.args[0]
            self.assertIn("pago_detalles.id_cobro", str(consulta))
            self.assertIn(id_cobro, consulta.compile().params.values())
            self.assertNotIn("cobros.estado", str(consulta))

        db.add.assert_not_called()
        db.add_all.assert_not_called()
        db.flush.assert_not_called()
        db.commit.assert_not_called()

    def test_historial_sin_comprobante_no_emite_documentos_historicos(self) -> None:
        db = MagicMock()
        db.scalar.return_value = 0
        db.execute.return_value.all.return_value = []
        with patch("app.modules.finanzas.services.comprobantes.crear_comprobante_pago") as emitir:
            respuesta = list_comprobantes(
                db, page=1, page_size=50, id_cobro=70,
                origenes_permitidos=("INTERNET",),
            )
        self.assertEqual(respuesta["items"], [])
        emitir.assert_not_called()
        db.add.assert_not_called()
        db.commit.assert_not_called()

    def test_descarga_para_impresion_usa_pdf_existente_sin_operaciones_financieras(self) -> None:
        db = MagicMock()
        db.get.return_value = SimpleNamespace(numero="COB-000012", id_pago=31)
        db.scalar.return_value = "INTERNET"
        usuario = SimpleNamespace(rol=SimpleNamespace(nombre="Administrador"))
        with (
            patch("app.modules.finanzas.routers.cobros.ruta_pdf_comprobante", return_value=Path("12.pdf")),
            patch("app.modules.finanzas.services.comprobantes.crear_comprobante_pago") as emitir,
        ):
            respuesta = get_comprobante_pdf(12, usuario, db)
        self.assertEqual(respuesta.media_type, "application/pdf")
        self.assertEqual(respuesta.filename, "COB-000012.pdf")
        emitir.assert_not_called()
        db.add.assert_not_called()
        db.add_all.assert_not_called()
        db.commit.assert_not_called()

    @staticmethod
    def _ticket(numero: str = "COB-000001") -> TicketComprobante:
        return TicketComprobante(
            numero=numero,
            fecha_emision=date(2026, 10, 18),
            fecha_hora=datetime(2026, 10, 18, 15, 0),
            id_pago=31,
            id_cliente=4,
            cliente_nombre="Ana Morales",
            cliente_telefono="5555-0314",
            origen_financiero="INSTALACIONES",
            servicio="Internet",
            periodo="2026-10",
            metodo_pago="Efectivo",
            responsable="Ana Admin",
            subtotal=Decimal("250.00"),
            descuento=Decimal("0.00"),
            total=Decimal("250.00"),
            saldo_a_favor=Decimal("0.00"),
            conceptos=(
                ConceptoTicket("Internet · Instalación #12", "2026-10", Decimal("250.00")),
            ),
            archivo_pdf="uploads/comprobantes_cobro/COB-000001.pdf",
        )

    def test_numeracion_usa_lock_y_continua_desde_el_mayor(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [
            "COB-000001",
            "COB-000007",
            "registro-legado",
        ]

        numero = _siguiente_numero(db)

        self.assertEqual(numero, "COB-000008")
        self.assertIn(
            "pg_advisory_xact_lock",
            str(db.execute.call_args.args[0]),
        )

    def test_genera_pdf_termico_real(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            destino = Path(directorio) / "COB-000001.pdf"
            _dibujar_pdf(self._ticket(), destino)

            contenido = destino.read_bytes()
            self.assertTrue(contenido.startswith(b"%PDF"))
            self.assertGreater(len(contenido), 1000)

    def test_genera_pdf_multiperiodo_con_descuento_y_proximo_pago(self) -> None:
        ticket = replace(
            self._ticket(),
            periodos=("2026-11", "2026-12"),
            proxima_fecha_pago=date(2027, 1, 31),
            empresa_descripcion="Servicios de Internet",
            empresa_direccion="Zona 1",
            empresa_telefono="2222-2222",
            descuento=Decimal("25.00"),
        )
        with tempfile.TemporaryDirectory() as directorio:
            destino = Path(directorio) / "COB-000002.pdf"
            _dibujar_pdf(ticket, destino)
            contenido = destino.read_bytes()

        self.assertTrue(contenido.startswith(b"%PDF"))
        self.assertGreater(len(contenido), 1000)

    def test_ticket_multiperiodo_aumenta_su_altura_sin_crear_otra_pagina(self) -> None:
        """La longitud del rollo crece con cada mensualidad de la misma operación."""

        individual = self._ticket()
        multiple = replace(
            individual,
            periodos=("2026-11", "2026-12", "2027-01"),
            conceptos=(
                ConceptoTicket("Plan Hogar · 20 Mbps", "2026-11", Decimal("225.50")),
                ConceptoTicket("Plan Hogar · 20 Mbps", "2026-12", Decimal("225.50")),
                ConceptoTicket("Plan Hogar · 20 Mbps", "2027-01", Decimal("225.50")),
            ),
            total=Decimal("676.50"),
            subtotal=Decimal("676.50"),
        )

        self.assertGreater(_alto_ticket(multiple), _alto_ticket(individual))

    def test_ticket_multiperiodo_reutiliza_configuracion_y_calcula_proximo_pago(self) -> None:
        pago = SimpleNamespace(
            id_pago=31,
            id_cliente=4,
            origen_financiero="INTERNET",
            id_metodo_pago=2,
            id_empleado=7,
            monto_total=Decimal("451.00"),
            fecha_hora=datetime(2026, 11, 15, 10, 0),
        )
        detalles = [
            SimpleNamespace(id_cobro=40, monto_aplicado=Decimal("225.50")),
            SimpleNamespace(id_cobro=41, monto_aplicado=Decimal("225.50")),
        ]
        cobros = {
            40: SimpleNamespace(
                id_instalacion=None,
                id_servicio=8,
                periodo="2026-11",
                fecha_vencimiento=date(2026, 11, 15),
            ),
            41: SimpleNamespace(
                id_instalacion=None,
                id_servicio=8,
                periodo="2026-12",
                fecha_vencimiento=date(2026, 12, 31),
            ),
        }
        db = MagicMock()
        db.scalars.return_value.all.return_value = detalles
        db.execute.return_value.all.return_value = [(8, "Plan Hogar", "20 Mbps")]

        def obtener(modelo, identificador):
            if identificador == 4:
                return SimpleNamespace(nombres="Ana", apellidos="Morales", telefono="5555-0314")
            if identificador == 2:
                return SimpleNamespace(nombre="Efectivo")
            if identificador == 7:
                return SimpleNamespace(nombres="Ana", apellidos="Admin")
            return cobros[identificador]

        db.get.side_effect = obtener

        with patch(
            "app.modules.finanzas.services.comprobantes.get_active_receipt_configuration",
            return_value={
                "nombre_comercial": "Empresa Configurada",
                "descripcion_empresa": "Internet y soporte",
                "direccion": "Zona 1",
                "telefono": "2222-2222",
                "mensaje_final": "Mensaje configurable",
                "nota_fiscal": "Nota fiscal configurable",
            },
        ):
            ticket = _construir_ticket(
                db,
                pago,
                numero="COB-000010",
                archivo_pdf=None,
            )

        self.assertEqual(ticket.periodos, ("2026-11", "2026-12"))
        self.assertEqual(ticket.servicio, "Plan Hogar · 20 Mbps")
        self.assertTrue(all(concepto.descripcion == ticket.servicio for concepto in ticket.conceptos))
        self.assertEqual(ticket.proxima_fecha_pago, date(2027, 1, 31))
        self.assertEqual(ticket.empresa_nombre, "Empresa Configurada")
        self.assertEqual(ticket.empresa_descripcion, "Internet y soporte")
        self.assertEqual(ticket.empresa_direccion, "Zona 1")
        self.assertEqual(ticket.empresa_telefono, "2222-2222")
        self.assertIsNone(ticket.empresa_logo_url)
        self.assertEqual(ticket.agradecimiento, "Mensaje configurable")
        self.assertEqual(ticket.nota_fiscal, "Nota fiscal configurable")

        with patch(
            "app.modules.finanzas.services.comprobantes.get_active_receipt_configuration",
            return_value={"nombre_comercial": "Empresa", "nota_fiscal": ""},
        ):
            ticket_sin_nota = _construir_ticket(
                db,
                pago,
                numero="COB-000011",
                archivo_pdf=None,
            )

        self.assertEqual(ticket_sin_nota.nota_fiscal, "")

    def test_pdf_sin_nota_fiscal_no_imprime_texto_ni_espacio_extra(self) -> None:
        """Una nota vacía no dibuja la leyenda ni reserva altura adicional."""

        from reportlab.pdfgen import canvas as pdf_canvas
        from reportlab.lib.units import mm

        ticket = replace(self._ticket(), nota_fiscal="")
        assert self._ticket().nota_fiscal
        crear_canvas = pdf_canvas.Canvas
        dibujados = []

        def capturar(*args, **kwargs):
            self.assertAlmostEqual(kwargs["pagesize"][0], 58 * mm)
            dibujo = MagicMock(wraps=crear_canvas(*args, **kwargs))
            dibujados.append(dibujo)
            return dibujo

        with tempfile.TemporaryDirectory() as directorio:
            with patch(
                "app.modules.finanzas.services.comprobantes.canvas.Canvas",
                side_effect=capturar,
            ):
                _dibujar_pdf(ticket, Path(directorio) / "ticket.pdf")

        dibujo = dibujados[0]
        textos = [str(llamada.args[2]) for llamada in dibujo.drawCentredString.call_args_list]
        texto = "\n".join(textos)
        self.assertNotIn("No constituye comprobante fiscal.", texto)
        self.assertLess(_alto_ticket(ticket), _alto_ticket(self._ticket()))

    def test_respuesta_comprobante_expone_periodos_y_textos_preparados(self) -> None:
        ticket = self._ticket()
        respuesta = ticket_response(
            SimpleNamespace(
                id_comprobante=12,
                id_pago=31,
                numero="COB-000001",
                fecha_emision=date(2026, 10, 18),
                archivo_pdf="uploads/comprobantes_cobro/COB-000001.pdf",
            ),
            ticket,
        )

        self.assertEqual(respuesta["periodos"], [])
        self.assertEqual(respuesta["empresa_nombre"], "Multiservicios Tale")
        self.assertEqual(respuesta["agradecimiento"], ticket.agradecimiento)

    def test_crea_comprobante_con_ruta_relativa_y_numero_consecutivo(self) -> None:
        db = MagicMock()
        db.scalar.return_value = None
        db.scalars.return_value.all.return_value = []
        pago = SimpleNamespace(
            id_pago=31,
            id_cliente=4,
            origen_financiero="INSTALACIONES",
            id_metodo_pago=2,
            id_empleado=7,
            monto_total=Decimal("250.00"),
            fecha_hora=datetime(2026, 10, 18, 15, 0),
        )

        with (
            patch(
                "app.modules.finanzas.services.comprobantes._construir_ticket",
                return_value=self._ticket(),
            ),
            patch(
                "app.modules.finanzas.services.comprobantes._guardar_pdf",
                return_value=(
                    "uploads/comprobantes_cobro/COB-000001.pdf",
                    Path("COB-000001.pdf"),
                ),
            ),
        ):
            comprobante, ticket, ruta = crear_comprobante_pago(db, pago)

        self.assertEqual(comprobante.numero, "COB-000001")
        self.assertEqual(
            comprobante.archivo_pdf,
            "uploads/comprobantes_cobro/COB-000001.pdf",
        )
        self.assertEqual(ticket.numero, "COB-000001")
        self.assertIsNotNone(ruta)
        db.add.assert_called_once()
        db.flush.assert_called()

    def test_reutiliza_el_comprobante_del_pago_sin_crear_otro(self) -> None:
        db = MagicMock()
        existente = SimpleNamespace(
            id_comprobante=12,
            id_pago=31,
            numero="COB-000001",
            archivo_pdf="uploads/comprobantes_cobro/COB-000001.pdf",
        )
        db.scalar.return_value = existente
        pago = SimpleNamespace(id_pago=31)

        with (
            patch(
                "app.modules.finanzas.services.comprobantes._construir_ticket",
                return_value=self._ticket(),
            ),
            patch(
                "app.modules.finanzas.services.comprobantes._ruta_pdf_existente",
                return_value=Path("COB-000001.pdf"),
            ),
        ):
            comprobante, ticket, ruta = crear_comprobante_pago(db, pago)

        self.assertIs(comprobante, existente)
        self.assertEqual(ticket.numero, "COB-000001")
        self.assertIsNone(ruta)
        db.add.assert_not_called()
        db.execute.assert_not_called()


class CobrosClientesTests(unittest.TestCase):
    """Verifica que Cobros reutilice Clientes sin exigir su permiso."""

    def test_expone_solo_clientes_activos_sin_filtrar_por_obligaciones(self) -> None:
        activos = [
            SimpleNamespace(id_cliente=4, estado="Activo"),
            SimpleNamespace(id_cliente=6, estado="Activo"),
        ]
        inactivo = SimpleNamespace(id_cliente=7, estado="Inactivo")

        with patch(
            "app.modules.finanzas.routers.cobros.list_clientes",
            return_value=[*activos, inactivo],
        ):
            response = get_clientes_para_cobros(
                current_user=SimpleNamespace(
                    rol=SimpleNamespace(nombre="Administrador"),
                    empleado=None,
                    modulos=[],
                ),
                db=MagicMock(),
            )

        self.assertEqual([cliente.id_cliente for cliente in response], [4, 6])


class CobrosSecurityTests(unittest.TestCase):
    """Cubre JWT y permisos de usuario por categoria de Cobros."""

    def test_registro_pago_exige_jwt_y_permiso_pagos(self) -> None:
        paths = app.openapi()["paths"]
        operation = paths["/api/cobros/pagos"]["post"]
        pendiente = paths["/api/cobros/obligaciones-pendientes"]["post"]
        anticipos = paths["/api/cobros/pagos"]["get"]
        distribution = paths["/api/cobros/pagos/{id_pago}/aplicaciones"]["post"]

        self.assertEqual(operation["security"], [{"OAuth2PasswordBearer": []}])
        self.assertEqual(pendiente["security"], [{"OAuth2PasswordBearer": []}])
        self.assertIn("201", operation["responses"])
        self.assertEqual(anticipos["security"], [{"OAuth2PasswordBearer": []}])
        self.assertIn("200", anticipos["responses"])
        self.assertEqual(distribution["security"], [{"OAuth2PasswordBearer": []}])
        self.assertIn("200", distribution["responses"])

    def test_endpoints_get_exigen_jwt_en_openapi(self) -> None:
        paths = app.openapi()["paths"]
        endpoints = (
            "/api/cobros",
            "/api/cobros/metodos-pago",
            "/api/cobros/saldos-pendientes",
            "/api/cobros/historial",
            "/api/cobros/clientes",
            "/api/cobros/internet/servicios",
            "/api/cobros/ordenes-trabajo/cotizaciones",
            "/api/cobros/comprobantes",
            "/api/cobros/comprobantes/{id_comprobante}/pdf",
            "/api/cobros/{id_cobro}",
            "/api/cobros/{id_cobro}/pagos",
        )

        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                self.assertEqual(
                    paths[endpoint]["get"]["security"],
                    [{"OAuth2PasswordBearer": []}],
                )
                # Mantenimiento agrega el alta administrativa al catálogo, no a los saldos.
                permitidas = {"post"} if endpoint == "/api/cobros/metodos-pago" else set()
                self.assertEqual(set(paths[endpoint]) & {"post", "put", "patch", "delete"}, permitidas)
                if permitidas:
                    self.assertEqual(paths[endpoint]["post"]["security"], [{"OAuth2PasswordBearer": []}])

        actualizacion = paths[
            "/api/cobros/internet/servicios/{id_asignacion}/dia-vencimiento"
        ]
        self.assertEqual(set(actualizacion), {"patch"})
        self.assertEqual(
            actualizacion["patch"]["security"],
            [{"OAuth2PasswordBearer": []}],
        )

    @patch(
        "app.modules.auth.services.auth.decode_access_token",
        side_effect=jwt.InvalidTokenError,
    )
    def test_token_invalido_responde_401(self, _decode) -> None:
        with self.assertRaises(HTTPException) as context:
            get_current_user(MagicMock(), "token-invalido")

        self.assertEqual(context.exception.status_code, 401)

    def test_rol_empleado_sin_permiso_pagos_es_rechazado(self) -> None:
        dependency = require_module_access("pagos")
        empleado = SimpleNamespace(
            rol=SimpleNamespace(nombre="Empleado"),
            modulos=[],
        )

        with self.assertRaises(HTTPException) as context:
            dependency(empleado)

        self.assertEqual(context.exception.status_code, 403)

    def test_tecnico_con_permiso_recibe_acceso_a_cobros(self) -> None:
        tecnico = SimpleNamespace(
            rol=SimpleNamespace(nombre="Empleado"),
            empleado=SimpleNamespace(puesto=SimpleNamespace(nombre="Técnico")),
            modulos=[SimpleNamespace(codigo="pagos_internet", activo=True)],
        )

        self.assertIs(require_cobros_access(tecnico), tecnico)

    def test_empleado_no_tecnico_autorizado_conserva_acceso(self) -> None:
        administrativo = SimpleNamespace(
            rol=SimpleNamespace(nombre="Empleado"),
            empleado=SimpleNamespace(puesto=SimpleNamespace(nombre="Administrativo")),
            modulos=[SimpleNamespace(codigo="pagos_instalaciones", activo=True)],
        )

        self.assertIs(require_cobros_access(administrativo), administrativo)

    def test_administrador_conserva_acceso_a_todas_las_categorias(self) -> None:
        administrador = SimpleNamespace(
            rol=SimpleNamespace(nombre="Administrador"),
            empleado=None,
            modulos=[],
        )

        self.assertEqual(
            _origenes_pago_autorizados(administrador),
            ("INTERNET", "INSTALACIONES", "ORDENES_TRABAJO"),
        )

    def test_empleado_solo_puede_usar_la_categoria_asignada(self) -> None:
        empleado = SimpleNamespace(
            rol=SimpleNamespace(nombre="Empleado"),
            empleado=None,
            modulos=[
                SimpleNamespace(codigo="pagos_instalaciones", activo=True),
            ],
        )

        self.assertEqual(_origenes_pago_autorizados(empleado), ("INSTALACIONES",))
        _requerir_origen_pago(empleado, "INSTALACIONES")
        with self.assertRaises(HTTPException) as context:
            _requerir_origen_pago(empleado, "ORDENES_TRABAJO")
        self.assertEqual(context.exception.status_code, 403)

    def test_cada_permiso_hijo_autoriza_solo_su_categoria(self) -> None:
        permisos = {
            "pagos_internet": "INTERNET",
            "pagos_instalaciones": "INSTALACIONES",
            "pagos_ordenes_trabajo": "ORDENES_TRABAJO",
        }

        for codigo, origen in permisos.items():
            with self.subTest(codigo=codigo):
                empleado = SimpleNamespace(
                    rol=SimpleNamespace(nombre="Empleado"),
                    empleado=SimpleNamespace(puesto=SimpleNamespace(nombre="Técnico")),
                    modulos=[SimpleNamespace(codigo=codigo, activo=True)],
                )

                self.assertEqual(_origenes_pago_autorizados(empleado), (origen,))
                _requerir_origen_pago(empleado, origen)

    def test_permiso_hijo_inactivo_o_ausente_es_rechazado(self) -> None:
        for modulos in (
            [],
            [SimpleNamespace(codigo="pagos_ordenes_trabajo", activo=False)],
        ):
            with self.subTest(modulos=modulos):
                empleado = SimpleNamespace(
                    rol=SimpleNamespace(nombre="Empleado"),
                    empleado=None,
                    modulos=modulos,
                )

                with self.assertRaises(HTTPException) as context:
                    _requerir_origen_pago(empleado, "ORDENES_TRABAJO")
                self.assertEqual(context.exception.status_code, 403)

    def test_confirmar_pago_invoca_registro_solo_con_permiso_correspondiente(self) -> None:
        empleado_activo = SimpleNamespace(id_empleado=7)
        permisos = {
            "pagos_internet": "INTERNET",
            "pagos_instalaciones": "INSTALACIONES",
            "pagos_ordenes_trabajo": "ORDENES_TRABAJO",
        }

        for codigo, origen in permisos.items():
            with self.subTest(codigo=codigo):
                usuario = SimpleNamespace(
                    id=99,
                    rol=SimpleNamespace(nombre="Empleado"),
                    modulos=[SimpleNamespace(codigo=codigo, activo=True)],
                )
                data = SimpleNamespace(origen_financiero=origen)
                esperado = SimpleNamespace(id_pago=31)
                with (
                    patch(
                        "app.modules.finanzas.routers.cobros._empleado_para_confirmar_pago",
                        return_value=empleado_activo,
                    ),
                    patch(
                        "app.modules.finanzas.routers.cobros.registrar_pago",
                        return_value=esperado,
                    ) as registrar,
                ):
                    resultado = confirmar_pago(data, usuario, MagicMock())

                self.assertIs(resultado, esperado)
                registrar.assert_called_once()

        usuario_sin_permiso = SimpleNamespace(
            rol=SimpleNamespace(nombre="Empleado"),
            modulos=[SimpleNamespace(codigo="pagos_internet", activo=True)],
        )
        with patch("app.modules.finanzas.routers.cobros.registrar_pago") as registrar:
            with self.assertRaises(HTTPException) as context:
                confirmar_pago(
                    SimpleNamespace(origen_financiero="INSTALACIONES"),
                    usuario_sin_permiso,
                    MagicMock(),
                )

        self.assertEqual(context.exception.status_code, 403)
        registrar.assert_not_called()

    def test_administrador_sin_empleado_confirma_con_responsable_de_caja(self) -> None:
        usuario = SimpleNamespace(
            id=99,
            rol=SimpleNamespace(nombre="Administrador"),
            empleado=None,
            modulos=[],
        )
        data = SimpleNamespace(origen_financiero="INTERNET")
        esperado = SimpleNamespace(id_pago=31)
        db = MagicMock()

        with patch(
            "app.modules.finanzas.routers.cobros.registrar_pago",
            return_value=esperado,
        ) as registrar:
            resultado = confirmar_pago(data, usuario, db)

        self.assertIs(resultado, esperado)
        registrar.assert_called_once_with(db, data, None, id_usuario_registro=99, puede_recibir_en_caja=False)

    def test_permiso_vencimientos_lista_y_actualiza_servicio(self) -> None:
        usuario = SimpleNamespace(
            rol=SimpleNamespace(nombre="Empleado"),
            modulos=[
                SimpleNamespace(codigo="administrar_vencimientos_internet", activo=True)
            ],
        )
        db = MagicMock()
        asignacion = SimpleNamespace(id_asignacion=8, dia_vencimiento=None)
        actualizada = SimpleNamespace(id_asignacion=8, dia_vencimiento=15)

        with patch(
            "app.modules.finanzas.routers.cobros.list_asignaciones",
            return_value=[asignacion],
        ) as listar:
            self.assertEqual(get_servicios_internet(usuario, db), [asignacion])
        listar.assert_called_once_with(db)

        with (
            patch(
                "app.modules.finanzas.routers.cobros.get_asignacion",
                return_value=asignacion,
            ) as obtener,
            patch(
                "app.modules.finanzas.routers.cobros.update_dia_vencimiento",
                return_value=actualizada,
            ) as actualizar,
        ):
            resultado = actualizar_dia_vencimiento_internet(
                8,
                DiaVencimientoAsignacionUpdate(dia_vencimiento=15),
                usuario,
                db,
            )

        self.assertIs(resultado, actualizada)
        obtener.assert_called_once_with(db, 8)
        actualizar.assert_called_once_with(db, asignacion, 15)

    def test_generacion_mensual_exige_su_permiso_independiente(self) -> None:
        data = GeneracionMensualidadesInternetCreate(mes=10, anio=2026)
        db = MagicMock()
        esperado = {
            "periodo": "2026-10",
            "generadas": 2,
            "existentes": 1,
            "total_elegibles": 3,
        }
        usuario = SimpleNamespace(
            rol=SimpleNamespace(nombre="Empleado"),
            modulos=[
                SimpleNamespace(codigo="generar_mensualidades_internet", activo=True)
            ],
        )
        with patch(
            "app.modules.finanzas.routers.cobros.generar_mensualidades_internet",
            return_value=esperado,
        ) as generar:
            self.assertEqual(
                generar_mensualidades_internet_manual(data, usuario, db),
                esperado,
            )
        generar.assert_called_once_with(db, data)

        usuario_sin_permiso = SimpleNamespace(
            rol=SimpleNamespace(nombre="Empleado"),
            modulos=[SimpleNamespace(codigo="pagos_instalaciones", activo=True)],
        )
        with patch(
            "app.modules.finanzas.routers.cobros.generar_mensualidades_internet"
        ) as generar:
            with self.assertRaises(HTTPException) as context:
                generar_mensualidades_internet_manual(data, usuario_sin_permiso, db)
        self.assertEqual(context.exception.status_code, 403)
        generar.assert_not_called()

    def test_otro_permiso_no_puede_configurar_vencimiento_internet(self) -> None:
        usuario = SimpleNamespace(
            rol=SimpleNamespace(nombre="Empleado"),
            modulos=[SimpleNamespace(codigo="pagos_internet", activo=True)],
        )

        with patch("app.modules.finanzas.routers.cobros.get_asignacion") as obtener:
            with self.assertRaises(HTTPException) as context:
                actualizar_dia_vencimiento_internet(
                    8,
                    DiaVencimientoAsignacionUpdate(dia_vencimiento=15),
                    usuario,
                    MagicMock(),
                )

        self.assertEqual(context.exception.status_code, 403)
        obtener.assert_not_called()

    def test_actualizacion_responde_404_si_el_servicio_no_existe(self) -> None:
        administrador = SimpleNamespace(
            rol=SimpleNamespace(nombre="Administrador"),
            modulos=[],
        )
        with patch(
            "app.modules.finanzas.routers.cobros.get_asignacion",
            return_value=None,
        ):
            with self.assertRaises(HTTPException) as context:
                actualizar_dia_vencimiento_internet(
                    99,
                    DiaVencimientoAsignacionUpdate(dia_vencimiento=31),
                    administrador,
                    MagicMock(),
                )

        self.assertEqual(context.exception.status_code, 404)


class CajaGeneralServiceTests(unittest.TestCase):
    """Cubre transacciones de Caja con sesiones y catalogos aislados."""

    @staticmethod
    def _sesion(saldo: str = "100.00", estado: str = "Abierta") -> SimpleNamespace:
        return SimpleNamespace(
            id_sesion=1,
            id_empleado=7,
            fecha_apertura=datetime(2026, 10, 15, 8, 0),
            fecha_cierre=None,
            saldo_inicial=Decimal(saldo),
            saldo_final=None,
            estado=estado,
        )

    @staticmethod
    def _categoria(
        tipo: str = "Ingreso",
        estado: str = "Activo",
        nombre: str | None = None,
    ) -> SimpleNamespace:
        return SimpleNamespace(
            id_categoria=2,
            nombre=nombre or ("Entrada" if tipo == "Ingreso" else "Salida"),
            tipo=tipo,
            estado=estado,
        )

    @staticmethod
    def _metodo(nombre: str = "Efectivo", estado: str = "Activo") -> SimpleNamespace:
        return SimpleNamespace(
            id_metodo_pago=3,
            nombre=nombre,
            estado=estado,
        )

    @staticmethod
    def _responsable() -> SimpleNamespace:
        return SimpleNamespace(id_empleado=7, nombres="Ana", apellidos="Admin")

    def test_apertura_usa_lock_y_empleado_autenticado(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = []
        db.scalar.side_effect = [datetime(2026, 10, 15, 8, 0), Decimal("0.00")]

        def asignar_id() -> None:
            db.add.call_args.args[0].id_sesion = 11

        db.flush.side_effect = asignar_id

        response = abrir_caja(
            db,
            AperturaCajaCreate(saldo_inicial=Decimal("150.00")),
            id_empleado=7,
        )

        self.assertEqual(response["id_sesion"], 11)
        self.assertEqual(response["id_empleado"], 7)
        self.assertEqual(response["efectivo_disponible"], Decimal("150.00"))
        self.assertIn("pg_advisory_xact_lock", str(db.execute.call_args_list[0].args[0]))
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    def test_rechaza_segunda_apertura_y_revierte_transaccion(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [self._sesion()]

        with self.assertRaises(SesionCajaAbiertaError):
            abrir_caja(db, AperturaCajaCreate(saldo_inicial=Decimal("0.00")), 7)

        db.add.assert_not_called()
        db.rollback.assert_called_once()

    def test_rechaza_movimiento_sin_sesion_abierta(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = []
        data = MovimientoManualCajaCreate(
            tipo="Ingreso",
            id_categoria=2,
            concepto="Aporte",
            monto=Decimal("10.00"),
            id_metodo_pago=3,
        )

        with self.assertRaises(SesionCajaNoAbiertaError):
            registrar_movimiento_manual(db, data, self._responsable())

        self.assertIn("sesiones_caja.estado", str(db.scalars.call_args.args[0]))
        db.rollback.assert_called_once()

    def test_lista_solo_categoria_manual_activa_del_tipo_solicitado(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [self._categoria("Ingreso")]

        response = list_categorias_manuales_activas(db, "Ingreso")

        self.assertEqual(response[0].nombre, "Entrada")
        statement = str(db.scalars.call_args.args[0])
        self.assertIn("categorias_caja.estado", statement)
        self.assertIn("categorias_caja.tipo", statement)
        self.assertIn("categorias_caja.nombre", statement)

    def test_registra_ingreso_efectivo_con_trazabilidad(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [self._sesion()]
        db.scalar.side_effect = [
            self._categoria("Ingreso"),
            self._metodo("Efectivo"),
            None,
            datetime(2026, 10, 15, 9, 0),
        ]

        def asignar_id() -> None:
            db.add.call_args.args[0].id_movimiento = 21

        db.flush.side_effect = asignar_id
        data = MovimientoManualCajaCreate(
            tipo="Ingreso",
            id_categoria=2,
            concepto="Venta mostrador",
            monto=Decimal("25.50"),
            id_metodo_pago=3,
        )

        response = registrar_movimiento_manual(db, data, self._responsable())

        self.assertEqual(response["id_movimiento"], 21)
        self.assertEqual(response["id_responsable"], 7)
        self.assertIsNone(response["origen_financiero"])
        self.assertTrue(response["es_efectivo"])
        self.assertIsNone(response["id_salida_producto"])
        db.commit.assert_called_once()

    def test_rechaza_categoria_que_no_coincide_con_tipo(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [self._sesion()]
        db.scalar.side_effect = [
            self._categoria("Ingreso"),
            self._metodo("Efectivo"),
        ]
        data = MovimientoManualCajaCreate(
            tipo="Egreso",
            id_categoria=2,
            concepto="Compra",
            monto=Decimal("10.00"),
            id_metodo_pago=3,
        )

        with self.assertRaises(CategoriaCajaInvalidaError):
            registrar_movimiento_manual(db, data, self._responsable())

    def test_rechaza_categoria_de_origen_automatico_en_movimiento_manual(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [self._sesion()]
        db.scalar.side_effect = [
            self._categoria("Ingreso", nombre="Servicios de Internet"),
            self._metodo("Efectivo"),
        ]
        data = MovimientoManualCajaCreate(
            tipo="Ingreso",
            id_categoria=2,
            concepto="Cobro sin obligacion",
            monto=Decimal("10.00"),
            id_metodo_pago=3,
        )

        with self.assertRaises(CategoriaCajaInvalidaError):
            registrar_movimiento_manual(db, data, self._responsable())

        db.add.assert_not_called()

    def test_rechaza_categoria_o_metodo_inactivos(self) -> None:
        data = MovimientoManualCajaCreate(
            tipo="Ingreso",
            id_categoria=2,
            concepto="Aporte",
            monto=Decimal("10.00"),
            id_metodo_pago=3,
        )

        db_categoria = MagicMock()
        db_categoria.scalars.return_value.all.return_value = [self._sesion()]
        db_categoria.scalar.side_effect = [
            self._categoria("Ingreso", "Inactivo"),
            self._metodo(),
        ]
        with self.assertRaises(CategoriaCajaInvalidaError):
            registrar_movimiento_manual(db_categoria, data, self._responsable())

        db_metodo = MagicMock()
        db_metodo.scalars.return_value.all.return_value = [self._sesion()]
        db_metodo.scalar.side_effect = [
            self._categoria("Ingreso"),
            self._metodo("Efectivo", "Inactivo"),
        ]
        with self.assertRaises(MetodoPagoCajaInvalidoError):
            registrar_movimiento_manual(db_metodo, data, self._responsable())

    def test_transferencia_exige_referencia_y_no_se_trata_como_efectivo(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [self._sesion()]
        db.scalar.side_effect = [
            self._categoria("Ingreso"),
            self._metodo("Transferencia"),
        ]
        data = MovimientoManualCajaCreate(
            tipo="Ingreso",
            id_categoria=2,
            concepto="Transferencia recibida",
            monto=Decimal("80.00"),
            id_metodo_pago=3,
        )

        with self.assertRaises(ReferenciaMovimientoRequeridaError):
            registrar_movimiento_manual(db, data, self._responsable())

        db.add.assert_not_called()

    def test_egreso_bancario_no_descuenta_efectivo_fisico(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [self._sesion("0.00")]
        db.scalar.side_effect = [
            self._categoria("Egreso"),
            self._metodo("Depósito"),
            None,
            datetime(2026, 10, 15, 10, 0),
        ]

        def asignar_id() -> None:
            db.add.call_args.args[0].id_movimiento = 22

        db.flush.side_effect = asignar_id
        data = MovimientoManualCajaCreate(
            tipo="Egreso",
            id_categoria=2,
            concepto="Pago bancario",
            monto=Decimal("500.00"),
            id_metodo_pago=3,
            referencia="DEP-100",
        )

        response = registrar_movimiento_manual(db, data, self._responsable())

        self.assertFalse(response["es_efectivo"])
        self.assertEqual(db.scalar.call_count, 4)
        db.commit.assert_called_once()

    def test_rechaza_egreso_efectivo_superior_al_disponible(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [self._sesion("50.00")]
        db.scalar.side_effect = [
            self._categoria("Egreso"),
            self._metodo("Efectivo"),
            None,
            Decimal("10.00"),
        ]
        data = MovimientoManualCajaCreate(
            tipo="Egreso",
            id_categoria=2,
            concepto="Compra",
            monto=Decimal("70.00"),
            id_metodo_pago=3,
        )

        with self.assertRaises(FondosCajaInsuficientesError) as context:
            registrar_movimiento_manual(db, data, self._responsable())

        self.assertEqual(context.exception.disponible, Decimal("60.00"))
        db.add.assert_not_called()

    def test_rechaza_reintento_con_huella_ya_confirmada(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = [self._sesion()]
        db.scalar.side_effect = [
            self._categoria("Ingreso"),
            self._metodo("Efectivo"),
            44,
        ]
        data = MovimientoManualCajaCreate(
            tipo="Ingreso",
            id_categoria=2,
            concepto="Aporte",
            monto=Decimal("10.00"),
            id_metodo_pago=3,
        )

        with self.assertRaises(MovimientoCajaDuplicadoError) as context:
            registrar_movimiento_manual(db, data, self._responsable())

        self.assertEqual(context.exception.id_movimiento, 44)
        db.add.assert_not_called()

    def test_historial_aplica_filtros_y_paginacion(self) -> None:
        db = MagicMock()
        db.scalar.return_value = 0
        db.execute.return_value.all.return_value = []

        response = list_movimientos_caja(
            db,
            page=2,
            page_size=10,
            id_sesion=1,
            tipo="Ingreso",
            id_categoria=2,
            id_metodo_pago=3,
            fecha_desde=date(2026, 10, 1),
            fecha_hasta=date(2026, 10, 31),
        )

        self.assertEqual(response["items"], [])
        self.assertEqual(response["page"], 2)
        statement = str(db.execute.call_args.args[0])
        self.assertIn("movimientos_caja.id_sesion", statement)
        self.assertIn("movimientos_caja.tipo", statement)
        self.assertIn("LIMIT", statement)
        self.assertIn("OFFSET", statement)

    def test_historial_devuelve_origen_financiero_persistido(self) -> None:
        """Distingue movimientos automaticos de los movimientos manuales."""

        db = MagicMock()
        db.scalar.return_value = 1
        db.execute.return_value.all.return_value = [
            SimpleNamespace(
                MovimientoCaja=SimpleNamespace(
                    id_movimiento=30,
                    id_sesion=1,
                    id_categoria=4,
                    id_metodo_pago=3,
                    id_responsable=7,
                    tipo="Ingreso",
                    origen_financiero="INSTALACIONES",
                    concepto="Pago de instalacion",
                    monto=Decimal("125.00"),
                    referencia=None,
                    id_salida_producto=None,
                    observaciones=None,
                    fecha_hora=datetime(2026, 10, 15, 11, 0),
                ),
                CategoriaCaja=SimpleNamespace(nombre="Instalaciones"),
                MetodoPago=self._metodo(),
                Empleado=self._responsable(),
            )
        ]

        response = list_movimientos_caja(db, page=1, page_size=10)

        self.assertEqual(
            response["items"][0]["origen_financiero"], "INSTALACIONES"
        )


class CierreCajaGeneralTests(unittest.TestCase):
    """Prueba el cierre con sesiones y transacciones simuladas, sin tocar PostgreSQL."""

    @staticmethod
    def _db_cierre():
        db = MagicMock()
        sesion = CajaGeneralServiceTests._sesion()
        fecha = datetime(2026, 10, 20, 18, 30)
        # La variacion agregada es solo efectivo; el servicio usa su consulta real.
        db.scalar.side_effect = [sesion, 0, 0, Decimal("25.50"), fecha]
        db.scalars.return_value.all.return_value = [sesion]

        def asignar_arqueo():
            db.add.call_args.args[0].id_arqueo = 91

        db.flush.side_effect = asignar_arqueo
        return db, sesion, fecha

    def test_cierre_atomico_con_diferencia_cero_faltante_y_sobrante(self) -> None:
        for contado, diferencia in (("125.50", "0.00"), ("120.00", "-5.50"), ("130.00", "4.50")):
            with self.subTest(contado=contado):
                db, sesion, fecha = self._db_cierre()
                data = CierreCajaCreate(
                    monto_contado=Decimal(contado), monto_sistema=Decimal("125.50"),
                    observaciones="  Conteo revisado  ",
                )
                response = cerrar_caja(db, 1, data, 7)

                self.assertEqual(sesion.estado, "Cerrada")
                self.assertEqual(sesion.id_empleado, 7)
                self.assertEqual(sesion.fecha_cierre, fecha)
                self.assertEqual(sesion.saldo_final, Decimal(contado))
                self.assertEqual(response["arqueo"]["diferencia"], Decimal(diferencia))
                self.assertEqual(response["arqueo"]["monto_sistema"], Decimal("125.50"))
                self.assertEqual(response["arqueo"]["observaciones"], "Conteo revisado")
                self.assertEqual(response["arqueo"]["fecha_hora"], fecha)
                self.assertEqual(response["arqueo"]["id_sesion"], 1)
                # Solo persiste el arqueo: no genera otro ingreso ni altera el historial.
                db.add.assert_called_once()
                self.assertIsInstance(db.add.call_args.args[0], ArqueoCaja)
                db.commit.assert_called_once()
                db.rollback.assert_not_called()
                self.assertEqual(db.mock_calls[0][0], "execute")
                self.assertIn("pg_advisory_xact_lock", str(db.mock_calls[0].args[0]))
                self.assertIn("FOR UPDATE", str(db.scalar.call_args_list[0].args[0]))
                self.assertIn("localtimestamp", str(db.scalar.call_args_list[4].args[0]))

                # El agregado recorre la sesión completa y aplica custodia solo a Internet.
                efectivo = db.scalar.call_args_list[3].args[0].compile()
                sql = str(efectivo)
                self.assertIn("lower(trim(metodos_pago.nombre))", sql)
                self.assertIn("efectivo", efectivo.params.values())
                self.assertIn("Ingreso", efectivo.params.values())
                self.assertIn("Egreso", efectivo.params.values())
                self.assertIn("movimientos_caja.id_sesion", sql)
                self.assertIn("pagos.origen_financiero", sql)
                self.assertIn("INTERNET", efectivo.params.values())
                self.assertNotIn("LIMIT", sql)

    def test_rechaza_otro_empleado_antes_de_calcular_o_escribir(self) -> None:
        db, sesion, _ = self._db_cierre()
        with self.assertRaises(ResponsableCierreInvalidoError):
            cerrar_caja(db, 1, CierreCajaCreate(monto_contado=0, monto_sistema=0), 8)
        self.assertEqual(sesion.estado, "Abierta")
        self.assertEqual(db.scalar.call_count, 1)
        db.add.assert_not_called()
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_sesion_inexistente_no_registra_arqueo(self) -> None:
        db = MagicMock()
        db.scalar.return_value = None
        with self.assertRaises(SesionCajaNoEncontradaError):
            cerrar_caja(db, 999, CierreCajaCreate(monto_contado=0, monto_sistema=0), 7)
        db.add.assert_not_called()
        db.rollback.assert_called_once()

    def test_reintento_no_duplica_arqueo_ni_cierra_una_sesion_nueva(self) -> None:
        db, sesion, _ = self._db_cierre()
        data = CierreCajaCreate(monto_contado=125.5, monto_sistema=125.5)
        cerrar_caja(db, 1, data, 7)
        db.reset_mock()
        db.scalar.side_effect = [sesion]
        db.scalars.return_value.all.return_value = [CajaGeneralServiceTests._sesion()]
        with self.assertRaises(SesionCajaNoAbiertaError):
            cerrar_caja(db, 1, data, 7)
        db.scalars.assert_not_called()
        db.add.assert_not_called()
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_cambio_de_efectivo_exige_revisar_el_formulario_sin_cerrar(self) -> None:
        db, sesion, _ = self._db_cierre()
        with self.assertRaises(EfectivoCierreDesactualizadoError):
            cerrar_caja(db, 1, CierreCajaCreate(monto_contado=100, monto_sistema=100), 7)
        self.assertEqual(sesion.estado, "Abierta")
        self.assertIsNone(sesion.fecha_cierre)
        db.add.assert_not_called()
        db.rollback.assert_called_once()

    def test_fallo_de_flush_o_commit_revierte_la_transaccion(self) -> None:
        for operacion in ("flush", "commit"):
            with self.subTest(operacion=operacion):
                db, _, _ = self._db_cierre()
                getattr(db, operacion).side_effect = RuntimeError("Fallo simulado")
                with self.assertRaises(RuntimeError):
                    cerrar_caja(db, 1, CierreCajaCreate(monto_contado=125.5, monto_sistema=125.5), 7)
                db.rollback.assert_called_once()
                if operacion == "flush":
                    db.commit.assert_not_called()

    def test_sin_sesion_abierta_no_se_admiten_movimientos_posteriores(self) -> None:
        db = MagicMock()
        db.scalars.return_value.all.return_value = []
        with self.assertRaises(SesionCajaNoAbiertaError):
            registrar_movimiento_manual(db, MovimientoManualCajaCreate(
                tipo="Ingreso", id_categoria=2, concepto="No permitido", monto=10, id_metodo_pago=3,
            ), CajaGeneralServiceTests._responsable())
        db.add.assert_not_called()
        db.rollback.assert_called_once()

    def test_contrato_valida_conteo_y_rechaza_identidad_fecha_y_diferencia_del_cliente(self) -> None:
        for contado in (-1, "0.001", "100000000.00", "NaN"):
            with self.subTest(contado=contado), self.assertRaises(ValidationError):
                CierreCajaCreate(monto_contado=contado, monto_sistema=0)
        for campo in ("id_empleado", "fecha_cierre", "estado", "diferencia"):
            with self.subTest(campo=campo), self.assertRaises(ValidationError):
                CierreCajaCreate(monto_contado=0, monto_sistema=0, **{campo: "No permitido"})
        self.assertEqual(CierreCajaCreate(monto_contado=0, monto_sistema=0).monto_contado, Decimal("0"))

    def test_endpoint_toma_responsable_del_usuario_y_traduce_errores(self) -> None:
        usuario = SimpleNamespace(empleado=SimpleNamespace(id_empleado=7))
        data = CierreCajaCreate(monto_contado=0, monto_sistema=0)
        db = MagicMock()
        with patch("app.modules.finanzas.routers.caja.cerrar_caja", return_value={}) as cerrar:
            cerrar_caja_general(data, usuario, 1, db)
        cerrar.assert_called_once_with(db, 1, data, 7)
        for error, codigo in ((ResponsableCierreInvalidoError(), 403), (SesionCajaNoAbiertaError(), 409),
                              (EfectivoCierreDesactualizadoError(), 409), (SesionCajaNoEncontradaError(), 404)):
            with self.subTest(error=type(error).__name__):
                with patch("app.modules.finanzas.routers.caja.cerrar_caja", side_effect=error):
                    with self.assertRaises(HTTPException) as contexto:
                        cerrar_caja_general(data, usuario, 1, db)
                self.assertEqual(contexto.exception.status_code, codigo)


class CajaGeneralSecurityTests(unittest.TestCase):
    """Verifica JWT, permiso caja y rol administrativo obligatorio."""

    @staticmethod
    def _usuario(rol: str) -> SimpleNamespace:
        return SimpleNamespace(
            rol=SimpleNamespace(nombre=rol),
            empleado=SimpleNamespace(
                id_empleado=7,
                estado="Activo",
                puesto=SimpleNamespace(
                    estado="Activo",
                    tiene_funciones_sistema=True,
                ),
            ),
        )

    def test_endpoints_caja_exigen_jwt(self) -> None:
        paths = app.openapi()["paths"]
        operations = (
            ("/api/caja/apertura", "post"),
            ("/api/caja/sesiones/{id_sesion}/cierre", "post"),
            ("/api/caja/sesion-actual", "get"),
            ("/api/caja/categorias", "get"),
            ("/api/caja/metodos-pago", "get"),
            ("/api/caja/movimientos", "post"),
            ("/api/caja/movimientos", "get"),
        )

        for path, method in operations:
            with self.subTest(path=path, method=method):
                self.assertEqual(
                    paths[path][method]["security"],
                    [{"OAuth2PasswordBearer": []}],
                )

    def test_permiso_caja_es_obligatorio(self) -> None:
        dependency = require_module_access("caja")
        usuario = SimpleNamespace(
            rol=SimpleNamespace(nombre="Administrador"),
            modulos=[],
        )

        with self.assertRaises(HTTPException) as context:
            dependency(usuario)

        self.assertEqual(context.exception.status_code, 403)

    def test_empleado_no_puede_operar_caja_aunque_tenga_permiso(self) -> None:
        with self.assertRaises(HTTPException) as context:
            require_caja_administrator(self._usuario("Empleado"))

        self.assertEqual(context.exception.status_code, 403)

    def test_administrador_autorizado_usa_su_empleado_asociado(self) -> None:
        usuario = self._usuario("Administrador")

        self.assertIs(require_caja_administrator(usuario), usuario)


if __name__ == "__main__":
    unittest.main()
