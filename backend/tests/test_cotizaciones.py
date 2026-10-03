"""Pruebas unitarias de reglas y transacciones de Cotizaciones/Proformas."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import jwt
from fastapi import HTTPException
from pydantic import ValidationError

from app.main import app
from app.models.cotizacion import CotizacionDetalle
from app.schemas.cotizacion import (
    CotizacionDirectaCreate,
    CotizacionEvaluacionCreate,
    CotizacionUpdate,
    DetalleCotizacionDirectaInput,
    DetalleCotizacionInput,
    ProformaResponse,
)
from app.services.auth import get_current_user, require_module_access
from app.services.cotizaciones import (
    CotizacionConflictError,
    DetalleCotizacionError,
    EliminacionCotizacionError,
    EstadoCotizacionError,
    EvaluacionConflictError,
    EvaluacionNoFinalizadaError,
    ProformaConflictError,
    _generar_numero_cotizacion,
    aceptar_cotizacion,
    calcular_totales,
    create_cotizacion_directa,
    create_cotizacion_evaluacion,
    delete_cotizacion,
    generar_cotizacion_evaluacion,
    generar_proforma,
    get_cotizacion,
    list_cotizaciones,
    rechazar_cotizacion,
    update_cotizacion,
)


def detalle_directo(precio: str = "100.00") -> DetalleCotizacionDirectaInput:
    return DetalleCotizacionDirectaInput(
        descripcion="Servicio", cantidad=Decimal("1.00"), unidad="Unidad", precio_unitario=precio
    )


def cotizacion_simple(estado: str, origen: str = "DIRECTA") -> SimpleNamespace:
    return SimpleNamespace(
        id_cotizacion=10,
        estado=estado,
        origen=origen,
        porcentaje_descuento=Decimal("0.00"),
        observaciones=None,
    )


class CotizacionesServiceTests(unittest.TestCase):
    """Cubre reglas sin escribir en la base PostgreSQL real."""

    def test_calculos_con_descuento_cero_y_valido(self) -> None:
        detalles = [
            CotizacionDetalle(
                descripcion="A",
                cantidad=Decimal("2.00"),
                unidad=None,
                precio_unitario=Decimal("50.00"),
            ),
            CotizacionDetalle(
                descripcion="B",
                cantidad=Decimal("1.00"),
                unidad=None,
                precio_unitario=None,
            ),
        ]

        _, subtotal, descuento_cero, total_cero = calcular_totales(
            detalles, Decimal("0.00")
        )
        _, _, descuento, total = calcular_totales(detalles, Decimal("5.00"))

        self.assertEqual(subtotal, Decimal("100.00"))
        self.assertEqual(descuento_cero, Decimal("0.00"))
        self.assertEqual(total_cero, Decimal("100.00"))
        self.assertEqual(descuento, Decimal("5.00"))
        self.assertEqual(total, Decimal("95.00"))

    def test_rechaza_descuento_mayor_a_cien(self) -> None:
        with self.assertRaises(ValidationError):
            CotizacionDirectaCreate(
                id_cliente=1,
                porcentaje_descuento=Decimal("100.01"),
                detalles=[detalle_directo()],
            )

    def test_patch_rechaza_descuento_y_detalles_nulos(self) -> None:
        for payload in ({"porcentaje_descuento": None}, {"detalles": None}):
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                CotizacionUpdate.model_validate(payload)

    def test_numero_anual_usa_lock_y_siguiente_correlativo(self) -> None:
        db = MagicMock()
        db.scalar.return_value = 7

        numero = _generar_numero_cotizacion(db, date(2026, 9, 30))

        self.assertEqual(numero, "COT-2026-0008")
        db.execute.assert_called_once()

    def test_numeros_consecutivos_no_se_repiten(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [None, 1]

        primero = _generar_numero_cotizacion(db, date(2026, 1, 1))
        segundo = _generar_numero_cotizacion(db, date(2026, 1, 1))

        self.assertEqual(primero, "COT-2026-0001")
        self.assertEqual(segundo, "COT-2026-0002")

    @patch("app.services.cotizaciones.get_cotizacion", return_value={"ok": True})
    @patch("app.services.cotizaciones._generar_numero_cotizacion", return_value="COT-2026-0001")
    @patch("app.services.cotizaciones._fecha_oficial", return_value=date(2026, 9, 30))
    def test_crea_directa_generada_y_atomica(self, _fecha, _numero, _get) -> None:
        db = MagicMock()
        db.get.return_value = SimpleNamespace(id_cliente=3, estado="Activo")

        def assign_id() -> None:
            db.add.call_args.args[0].id_cotizacion = 20

        db.flush.side_effect = assign_id
        data = CotizacionDirectaCreate(id_cliente=3, detalles=[detalle_directo()])

        response = create_cotizacion_directa(db, data, creado_por=9)

        cabecera = db.add.call_args.args[0]
        self.assertEqual(cabecera.estado, "GENERADA")
        self.assertEqual(cabecera.origen, "DIRECTA")
        self.assertIsNone(cabecera.id_evaluacion)
        self.assertEqual(cabecera.creado_por, 9)
        self.assertEqual(len(db.add_all.call_args.args[0]), 1)
        db.commit.assert_called_once()
        self.assertEqual(response, {"ok": True})

    @patch("app.services.cotizaciones._generar_numero_cotizacion", return_value="COT-2026-0001")
    @patch("app.services.cotizaciones._fecha_oficial", return_value=date(2026, 9, 30))
    def test_creacion_compuesta_hace_rollback_si_falla_un_detalle(
        self, _fecha, _numero
    ) -> None:
        db = MagicMock()
        db.get.return_value = SimpleNamespace(id_cliente=3, estado="Activo")
        db.flush.side_effect = RuntimeError("fallo")
        data = CotizacionDirectaCreate(id_cliente=3, detalles=[detalle_directo()])

        with self.assertRaises(RuntimeError):
            create_cotizacion_directa(db, data, creado_por=9)

        db.rollback.assert_called_once()
        db.commit.assert_not_called()

    @patch("app.services.cotizaciones.get_cotizacion", return_value={"ok": True})
    @patch("app.services.cotizaciones._generar_numero_cotizacion", return_value="COT-2026-0002")
    @patch("app.services.cotizaciones._fecha_oficial", return_value=date(2026, 9, 30))
    def test_crea_desde_evaluacion_con_cliente_materiales_y_precios_nulos(
        self, _fecha, _numero, _get
    ) -> None:
        db = MagicMock()
        cliente = SimpleNamespace(id_cliente=4, estado="Activo")
        visita = SimpleNamespace(id_cliente=4, cliente=cliente, estado="Completada")
        materiales = [
            SimpleNamespace(
                descripcion="Cable", cantidad=Decimal("25.00"), unidad="Metro"
            )
        ]
        evaluacion = SimpleNamespace(
            id_evaluacion=8, visita=visita, materiales=materiales
        )
        db.scalar.side_effect = [evaluacion, None]

        def assign_id() -> None:
            db.add.call_args.args[0].id_cotizacion = 21

        db.flush.side_effect = assign_id
        data = CotizacionEvaluacionCreate(id_evaluacion=8)

        create_cotizacion_evaluacion(db, data, creado_por=9)

        cabecera = db.add.call_args.args[0]
        detalle = db.add_all.call_args.args[0][0]
        self.assertEqual(cabecera.id_cliente, 4)
        self.assertEqual(cabecera.id_evaluacion, 8)
        self.assertEqual(cabecera.origen, "EVALUACION")
        self.assertEqual(cabecera.estado, "EN PROCESO")
        self.assertEqual(detalle.descripcion, "Cable")
        self.assertEqual(detalle.cantidad, Decimal("25.00"))
        self.assertEqual(detalle.unidad, "Metro")
        self.assertIsNone(detalle.precio_unitario)
        db.commit.assert_called_once()

    @patch("app.services.cotizaciones.get_cotizacion", return_value={"ok": True})
    @patch("app.services.cotizaciones._generar_numero_cotizacion", return_value="COT-2026-0002")
    @patch("app.services.cotizaciones._fecha_oficial", return_value=date(2026, 9, 30))
    def test_crea_desde_evaluacion_sin_confirmar_transaccion_externa(
        self, _fecha, _numero, _get
    ) -> None:
        db = MagicMock()
        visita = SimpleNamespace(
            id_cliente=4,
            cliente=SimpleNamespace(id_cliente=4, estado="Activo"),
            estado="Completada",
        )
        evaluacion = SimpleNamespace(
            id_evaluacion=8,
            visita=visita,
            materiales=[
                SimpleNamespace(
                    descripcion="Cable",
                    cantidad=Decimal("25.00"),
                    unidad="Metro",
                )
            ],
        )
        db.scalar.side_effect = [evaluacion, None]

        def assign_id() -> None:
            db.add.call_args.args[0].id_cotizacion = 21

        db.flush.side_effect = assign_id

        create_cotizacion_evaluacion(
            db,
            CotizacionEvaluacionCreate(id_evaluacion=8),
            creado_por=9,
            gestionar_transaccion=False,
        )

        detalle = db.add_all.call_args.args[0][0]
        self.assertIsNone(detalle.precio_unitario)
        db.commit.assert_not_called()
        db.rollback.assert_not_called()

    def test_exige_evaluacion_finalizada(self) -> None:
        db = MagicMock()
        evaluacion = SimpleNamespace(
            id_evaluacion=8,
            visita=SimpleNamespace(estado="En Proceso"),
            materiales=[],
        )
        db.scalar.side_effect = [evaluacion, None]

        with self.assertRaises(EvaluacionNoFinalizadaError):
            create_cotizacion_evaluacion(
                db, CotizacionEvaluacionCreate(id_evaluacion=8), creado_por=9
            )

        db.rollback.assert_called_once()

    def test_impide_segunda_cotizacion_de_evaluacion(self) -> None:
        db = MagicMock()
        evaluacion = SimpleNamespace(id_evaluacion=8)
        db.scalar.side_effect = [evaluacion, 25]

        with self.assertRaises(EvaluacionConflictError):
            create_cotizacion_evaluacion(
                db, CotizacionEvaluacionCreate(id_evaluacion=8), creado_por=9
            )

        db.rollback.assert_called_once()
        db.commit.assert_not_called()

    def test_conflicto_en_transaccion_externa_delega_el_rollback(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [SimpleNamespace(id_evaluacion=8), 25]

        with self.assertRaises(EvaluacionConflictError):
            create_cotizacion_evaluacion(
                db,
                CotizacionEvaluacionCreate(id_evaluacion=8),
                creado_por=9,
                gestionar_transaccion=False,
            )

        db.rollback.assert_not_called()
        db.commit.assert_not_called()

    @patch("app.services.cotizaciones._cotizacion_response", side_effect=lambda value: value)
    def test_lista_cotizaciones(self, _response) -> None:
        db = MagicMock()
        db.scalars.return_value.unique.return_value.all.return_value = ["A", "B"]
        self.assertEqual(list_cotizaciones(db), ["A", "B"])

    @patch("app.services.cotizaciones.get_cotizacion_model", return_value=None)
    def test_obtiene_cotizacion_inexistente(self, _model) -> None:
        self.assertIsNone(get_cotizacion(MagicMock(), 999))

    @patch("app.services.cotizaciones.get_cotizacion", return_value={"ok": True})
    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_edita_en_proceso_y_generada(self, quote_for_update, _get) -> None:
        for estado in ("EN PROCESO", "GENERADA"):
            with self.subTest(estado=estado):
                db = MagicMock()
                quote_for_update.return_value = cotizacion_simple(estado)
                data = CotizacionUpdate(porcentaje_descuento=Decimal("10.00"))

                update_cotizacion(db, 10, data)

                self.assertEqual(
                    quote_for_update.return_value.porcentaje_descuento,
                    Decimal("10.00"),
                )
                db.commit.assert_called_once()

    @patch("app.services.cotizaciones.get_cotizacion", return_value={"ok": True})
    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_edicion_reemplaza_detalles_y_conserva_fecha_oficial(
        self, quote_for_update, _get
    ) -> None:
        db = MagicMock()
        fecha_original = date(2026, 9, 1)
        quote = cotizacion_simple("GENERADA")
        quote.fecha = fecha_original
        quote_for_update.return_value = quote
        data = CotizacionUpdate(
            detalles=[
                DetalleCotizacionInput(
                    descripcion="Nuevo",
                    cantidad=Decimal("2.00"),
                    unidad="Unidad",
                    precio_unitario=Decimal("25.00"),
                )
            ]
        )

        update_cotizacion(db, 10, data)

        self.assertEqual(quote.fecha, fecha_original)
        self.assertIsNotNone(quote.fecha_actualizacion)
        db.execute.assert_called_once()
        self.assertEqual(db.add_all.call_args.args[0][0].descripcion, "Nuevo")

    @patch("app.services.cotizaciones.get_cotizacion", return_value={"ok": True})
    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_patch_completa_precios_y_conserva_en_proceso(
        self, quote_for_update, _get
    ) -> None:
        db = MagicMock()
        quote = cotizacion_simple("EN PROCESO", "EVALUACION")
        quote_for_update.return_value = quote
        data = CotizacionUpdate(
            detalles=[
                DetalleCotizacionInput(
                    descripcion="Cable",
                    cantidad=Decimal("10.00"),
                    unidad="Metro",
                    precio_unitario=Decimal("2.50"),
                )
            ]
        )

        update_cotizacion(db, 10, data)

        self.assertEqual(quote.estado, "EN PROCESO")
        db.commit.assert_called_once()

    @patch("app.services.cotizaciones.get_cotizacion", return_value={"ok": True})
    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_guardar_nuevamente_no_genera_evaluacion(
        self, quote_for_update, _get
    ) -> None:
        quote = cotizacion_simple("EN PROCESO", "EVALUACION")
        quote_for_update.return_value = quote

        for descuento in ("5.00", "10.00"):
            db = MagicMock()
            update_cotizacion(
                db,
                10,
                CotizacionUpdate(porcentaje_descuento=Decimal(descuento)),
            )
            self.assertEqual(quote.estado, "EN PROCESO")
            db.commit.assert_called_once()

    @patch("app.services.cotizaciones.get_cotizacion", return_value={"ok": True})
    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_genera_evaluacion_completa_explicitamente(
        self, quote_for_update, _get
    ) -> None:
        db = MagicMock()
        quote = cotizacion_simple("EN PROCESO", "EVALUACION")
        quote_for_update.return_value = quote
        db.scalars.return_value.all.return_value = [
            CotizacionDetalle(
                descripcion="Cable",
                cantidad=Decimal("10.00"),
                unidad="Metro",
                precio_unitario=Decimal("2.50"),
            )
        ]

        response = generar_cotizacion_evaluacion(db, 10)

        self.assertEqual(response, {"ok": True})
        self.assertEqual(quote.estado, "GENERADA")
        self.assertIsNotNone(quote.fecha_actualizacion)
        db.commit.assert_called_once()

    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_no_genera_evaluacion_con_precio_pendiente(
        self, quote_for_update
    ) -> None:
        db = MagicMock()
        quote = cotizacion_simple("EN PROCESO", "EVALUACION")
        quote_for_update.return_value = quote
        db.scalars.return_value.all.return_value = [
            CotizacionDetalle(
                descripcion="Cable",
                cantidad=Decimal("10.00"),
                unidad="Metro",
                precio_unitario=None,
            )
        ]

        with self.assertRaises(DetalleCotizacionError):
            generar_cotizacion_evaluacion(db, 10)

        self.assertEqual(quote.estado, "EN PROCESO")
        db.rollback.assert_called_once()
        db.commit.assert_not_called()

    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_no_genera_directa_ni_estados_no_permitidos(
        self, quote_for_update
    ) -> None:
        casos = [
            ("EN PROCESO", "DIRECTA"),
            ("GENERADA", "EVALUACION"),
            ("ACEPTADA", "EVALUACION"),
            ("RECHAZADA", "EVALUACION"),
            ("COMPLETADA", "EVALUACION"),
        ]
        for estado, origen in casos:
            with self.subTest(estado=estado, origen=origen):
                db = MagicMock()
                quote = cotizacion_simple(estado, origen)
                quote_for_update.return_value = quote

                with self.assertRaises(EstadoCotizacionError):
                    generar_cotizacion_evaluacion(db, 10)

                self.assertEqual(quote.estado, estado)
                db.rollback.assert_called_once()
                db.commit.assert_not_called()

    @patch(
        "app.services.cotizaciones._prepare_cotizacion_response",
        side_effect=RuntimeError("fallo"),
    )
    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_generar_evaluacion_hace_rollback_ante_fallo(
        self, quote_for_update, _response
    ) -> None:
        db = MagicMock()
        quote_for_update.return_value = cotizacion_simple(
            "EN PROCESO", "EVALUACION"
        )
        db.scalars.return_value.all.return_value = [
            CotizacionDetalle(
                descripcion="Cable",
                cantidad=Decimal("10.00"),
                unidad="Metro",
                precio_unitario=Decimal("2.50"),
            )
        ]

        with self.assertRaises(RuntimeError):
            generar_cotizacion_evaluacion(db, 10)

        db.rollback.assert_called_once()
        db.commit.assert_not_called()

    @patch("app.services.cotizaciones.get_cotizacion", return_value=None)
    @patch("app.services.cotizaciones._generar_numero_cotizacion", return_value="COT-2026-0001")
    @patch("app.services.cotizaciones._fecha_oficial", return_value=date(2026, 9, 30))
    def test_fallo_de_respuesta_antes_del_commit_hace_rollback(
        self, _fecha, _numero, _get
    ) -> None:
        db = MagicMock()
        db.get.return_value = SimpleNamespace(id_cliente=3, estado="Activo")

        def assign_id() -> None:
            db.add.call_args.args[0].id_cotizacion = 20

        db.flush.side_effect = assign_id
        with self.assertRaises(RuntimeError):
            create_cotizacion_directa(
                db,
                CotizacionDirectaCreate(id_cliente=3, detalles=[detalle_directo()]),
                creado_por=9,
            )

        db.rollback.assert_called_once()
        db.commit.assert_not_called()

    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_bloquea_edicion_de_estados_finales(self, quote_for_update) -> None:
        for estado in ("ACEPTADA", "RECHAZADA", "COMPLETADA"):
            with self.subTest(estado=estado):
                db = MagicMock()
                quote_for_update.return_value = cotizacion_simple(estado)
                with self.assertRaises(EstadoCotizacionError):
                    update_cotizacion(db, 10, CotizacionUpdate())
                db.rollback.assert_called_once()

    @patch("app.services.cotizaciones.get_cotizacion", return_value={"ok": True})
    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_acepta_solo_generada(self, quote_for_update, _get) -> None:
        db = MagicMock()
        quote_for_update.return_value = cotizacion_simple("GENERADA")
        aceptar_cotizacion(db, 10)
        self.assertEqual(quote_for_update.return_value.estado, "ACEPTADA")

        db_invalida = MagicMock()
        quote_for_update.return_value = cotizacion_simple("EN PROCESO")
        with self.assertRaises(EstadoCotizacionError):
            aceptar_cotizacion(db_invalida, 10)
        db_invalida.rollback.assert_called_once()

    @patch("app.services.cotizaciones.get_cotizacion", return_value={"ok": True})
    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_rechaza_solo_desde_estados_permitidos(self, quote_for_update, _get) -> None:
        for estado in ("EN PROCESO", "GENERADA"):
            db = MagicMock()
            quote_for_update.return_value = cotizacion_simple(estado)
            rechazar_cotizacion(db, 10)
            self.assertEqual(quote_for_update.return_value.estado, "RECHAZADA")

        db_invalida = MagicMock()
        quote_for_update.return_value = cotizacion_simple("ACEPTADA")
        with self.assertRaises(EstadoCotizacionError):
            rechazar_cotizacion(db_invalida, 10)

    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_elimina_directa_sin_dependencias(self, quote_for_update) -> None:
        db = MagicMock()
        quote_for_update.return_value = cotizacion_simple("GENERADA")
        db.scalar.return_value = None

        delete_cotizacion(db, 10)

        db.delete.assert_called_once_with(quote_for_update.return_value)
        db.commit.assert_called_once()

    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_bloquea_eliminacion_de_evaluacion(self, quote_for_update) -> None:
        db = MagicMock()
        quote_for_update.return_value = cotizacion_simple("EN PROCESO", "EVALUACION")
        with self.assertRaises(EliminacionCotizacionError):
            delete_cotizacion(db, 10)
        db.rollback.assert_called_once()

    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_bloquea_eliminacion_directa_con_proforma(self, quote_for_update) -> None:
        db = MagicMock()
        quote_for_update.return_value = cotizacion_simple("ACEPTADA")
        db.scalar.return_value = 5
        with self.assertRaises(EliminacionCotizacionError):
            delete_cotizacion(db, 10)
        db.rollback.assert_called_once()

    @patch("app.services.cotizaciones.get_proforma_por_cotizacion", return_value={"ok": True})
    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_genera_proforma_solo_desde_aceptada(self, quote_for_update, _get) -> None:
        db = MagicMock()
        quote_for_update.return_value = cotizacion_simple("ACEPTADA")
        db.scalar.return_value = None

        response = generar_proforma(db, 10)

        self.assertEqual(response, {"ok": True})
        self.assertEqual(db.add.call_args.args[0].id_cotizacion, 10)
        db.commit.assert_called_once()

    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_impide_segunda_proforma_y_estado_incorrecto(self, quote_for_update) -> None:
        db_duplicada = MagicMock()
        quote_for_update.return_value = cotizacion_simple("ACEPTADA")
        db_duplicada.scalar.return_value = 1
        with self.assertRaises(ProformaConflictError):
            generar_proforma(db_duplicada, 10)

        db_estado = MagicMock()
        quote_for_update.return_value = cotizacion_simple("GENERADA")
        with self.assertRaises(EstadoCotizacionError):
            generar_proforma(db_estado, 10)

    @patch("app.services.cotizaciones._cotizacion_for_update")
    def test_generacion_de_proforma_hace_rollback_ante_fallo(
        self, quote_for_update
    ) -> None:
        db = MagicMock()
        quote_for_update.return_value = cotizacion_simple("ACEPTADA")
        db.scalar.return_value = None
        db.commit.side_effect = RuntimeError("fallo")

        with self.assertRaises(RuntimeError):
            generar_proforma(db, 10)

        db.rollback.assert_called_once()

    def test_proforma_no_expone_numero_ni_estado_propios(self) -> None:
        self.assertNotIn("numero_proforma", ProformaResponse.model_fields)
        self.assertNotIn("estado", ProformaResponse.model_fields)


class CotizacionesSecurityTests(unittest.TestCase):
    def test_endpoint_generar_aparece_protegido_en_openapi(self) -> None:
        operation = app.openapi()["paths"][
            "/api/cotizaciones/{id_cotizacion}/generar"
        ]["post"]

        self.assertEqual(operation["security"], [{"OAuth2PasswordBearer": []}])
        self.assertIn("200", operation["responses"])

    def test_permiso_de_modulo_acepta_y_rechaza_usuario(self) -> None:
        dependency = require_module_access("cotizaciones")
        autorizado = SimpleNamespace(
            rol=SimpleNamespace(nombre="Empleado"),
            modulos=[SimpleNamespace(codigo="cotizaciones", activo=True)],
        )
        denegado = SimpleNamespace(
            rol=SimpleNamespace(nombre="Administrador"), modulos=[]
        )

        self.assertIs(dependency(autorizado), autorizado)
        with self.assertRaises(HTTPException) as context:
            dependency(denegado)
        self.assertEqual(context.exception.status_code, 403)

    @patch("app.services.auth.decode_access_token", side_effect=jwt.InvalidTokenError)
    def test_jwt_invalido_produce_401(self, _decode) -> None:
        with self.assertRaises(HTTPException) as context:
            get_current_user(MagicMock(), "token-invalido")
        self.assertEqual(context.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
