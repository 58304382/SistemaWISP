"""Pruebas unitarias de contratos y reglas de Órdenes de Trabajo (sin PostgreSQL)."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock
from unittest.mock import patch as mock_patch

from pydantic import ValidationError
from fastapi import HTTPException

from app.modules.ordenes_trabajo.schemas.orden_trabajo import (
    EquipoOrdenInput,
    EvaluacionMaterialInput,
    EvaluacionOrdenRegistro,
    FinalizacionOrdenRegistro,
    OrdenTrabajoCreate,
    OrdenTrabajoUpdate,
)
from app.modules.ordenes_trabajo.schemas.tipo_trabajo import TipoTrabajoCreate
from app.modules.ordenes_trabajo.services.ordenes_trabajo import (
    EvaluacionEnCotizacionError,
    RequiereAprobacionComercialError,
    TecnicoNoAsignadoError,
    finalizar_orden,
    iniciar_orden,
    registrar_evaluacion,
)


class OrdenTrabajoSchemasTests(unittest.TestCase):
    """Cubre validaciones básicas de entrada sin tocar la base de datos."""

    def test_crear_orden_requiere_titulo_y_descripcion(self) -> None:
        base = {
            "id_cliente": 1,
            "id_tipo_trabajo": 2,
            "id_empleado": 3,
            "titulo": "  ",
            "descripcion": "Revisar equipo",
        }
        with self.assertRaises(ValidationError):
            OrdenTrabajoCreate(**base)

        with self.assertRaises(ValidationError):
            OrdenTrabajoCreate(**{**base, "titulo": "Instalar", "descripcion": "   "})

    def test_crear_orden_acepta_datos_validos_y_fecha_estimada(self) -> None:
        orden = OrdenTrabajoCreate(
            id_cliente=1,
            id_tipo_trabajo=2,
            id_empleado=3,
            titulo="Instalar antena",
            descripcion="Revisar equipo",
            fecha_estimada=date(2026, 12, 1),
        )

        self.assertEqual(orden.fecha_estimada, date(2026, 12, 1))
        self.assertEqual(orden.equipo, [])

    def test_crear_orden_acepta_equipo_requerido(self) -> None:
        orden = OrdenTrabajoCreate(
            id_cliente=1,
            id_tipo_trabajo=2,
            id_empleado=3,
            titulo="Reparar radio",
            descripcion="Falla de energía",
            equipo=[
                EquipoOrdenInput(
                    tipo_equipo="Radio",
                    problema_reportado="No enciende",
                )
            ],
        )

        self.assertEqual(orden.equipo[0].tipo_equipo, "Radio")

    def test_crear_orden_rechaza_equipo_sin_problema(self) -> None:
        with self.assertRaises(ValidationError):
            OrdenTrabajoCreate(
                id_cliente=1,
                id_tipo_trabajo=2,
                id_empleado=3,
                titulo="Reparar radio",
                descripcion="Falla de energía",
                equipo=[EquipoOrdenInput(tipo_equipo="Radio", problema_reportado="  ")],
            )

    def test_actualizacion_no_permite_nulos_obligatorios(self) -> None:
        with self.assertRaises(ValidationError):
            OrdenTrabajoUpdate(id_empleado=None)

    def test_evaluacion_exige_diagnostico_y_trabajo_propuesto(self) -> None:
        with self.assertRaises(ValidationError):
            EvaluacionOrdenRegistro(diagnostico="  ", trabajo_propuesto="Cambiar equipo")

        registro = EvaluacionOrdenRegistro(
            diagnostico="Fuente dañada",
            trabajo_propuesto="Reemplazo",
            observaciones="  Probar señal  ",
        )
        self.assertEqual(registro.observaciones, "Probar señal")

    def test_evaluacion_acepta_materiales_y_rechaza_cantidad_invalida(self) -> None:
        registro = EvaluacionOrdenRegistro(
            diagnostico="Fuente dañada",
            trabajo_propuesto="Reemplazo",
            materiales=[
                EvaluacionMaterialInput(descripcion="Fuente de poder", cantidad=Decimal("1.00"), unidad="unidad"),
            ],
        )
        self.assertEqual(registro.materiales[0].descripcion, "Fuente de poder")

        with self.assertRaises(ValidationError):
            EvaluacionOrdenRegistro(
                diagnostico="D",
                trabajo_propuesto="T",
                materiales=[
                    EvaluacionMaterialInput(descripcion="Material", cantidad=Decimal("0.00")),
                ],
            )

        with self.assertRaises(ValidationError):
            EvaluacionMaterialInput(descripcion="  ", cantidad=Decimal("1.00"))

    def test_finalizacion_exige_campos_obligatorios(self) -> None:
        with self.assertRaises(ValidationError):
            FinalizacionOrdenRegistro(trabajo_realizado="", resultado_solucion="OK")

        registro = FinalizacionOrdenRegistro(
            trabajo_realizado="Cambio de fuente",
            resultado_solucion="Servicio restablecido",
        )
        self.assertEqual(registro.resultado_solucion, "Servicio restablecido")

    def test_tipo_trabajo_exige_nombre(self) -> None:
        with self.assertRaises(ValidationError):
            TipoTrabajoCreate(nombre="   ")

        tipo = TipoTrabajoCreate(nombre=" Reparación ")
        self.assertEqual(tipo.nombre, "Reparación")


class OrdenTrabajoServiceRulesTests(unittest.TestCase):
    """Verifica reglas de asignación y bloqueo comercial sin escribir en PostgreSQL."""

    @staticmethod
    def _db_con_orden(id_empleado: int = 1, estado: str = "En Proceso") -> MagicMock:
        db = MagicMock()
        db.scalar.return_value = SimpleNamespace(id_empleado=id_empleado, estado=estado)
        return db

    @staticmethod
    def _evaluacion(id_evaluacion: int = 5) -> SimpleNamespace:
        return SimpleNamespace(id_evaluacion=id_evaluacion)

    def _finalizacion_data(self) -> FinalizacionOrdenRegistro:
        return FinalizacionOrdenRegistro(
            trabajo_realizado="Cambio de fuente",
            resultado_solucion="Servicio restablecido",
            observaciones_finales="Prueba",
        )

    def test_iniciar_exige_tecnico_responsable(self) -> None:
        db = self._db_con_orden(id_empleado=9, estado="Programada")
        empleado = SimpleNamespace(id_empleado=7)

        with self.assertRaises(TecnicoNoAsignadoError):
            iniciar_orden(db, 1, empleado)

    def test_finalizar_bloqueado_sin_cotizacion_aceptada(self) -> None:
        # La orden tiene evaluación, pero no existe cotización ACEPTADA.
        db = MagicMock()
        db.scalar.side_effect = [
            SimpleNamespace(id_empleado=7, estado="En Proceso"),
            self._evaluacion(5),
            None,
        ]
        empleado = SimpleNamespace(id_empleado=7)

        with self.assertRaises(RequiereAprobacionComercialError):
            finalizar_orden(db, 1, self._finalizacion_data(), empleado)

        db.rollback.assert_called_once()

    def test_finalizar_crea_registro_con_cotizacion_completada_en_cobros(self) -> None:
        # La cotizacion COMPLETADA autoriza la entrega incluso con pendiente Q0.00.
        from datetime import datetime
        from unittest.mock import patch as mock_patch

        from app.modules.ordenes_trabajo.models.orden_trabajo import FinalizacionOrden

        db = MagicMock()
        orden = SimpleNamespace(id_empleado=7, estado="En Proceso")
        cotizacion = SimpleNamespace(estado="COMPLETADA", fecha_actualizacion=None)
        db.scalar.side_effect = [
            orden,
            self._evaluacion(5),
            cotizacion,
            None,  # no existe finalización previa
            datetime(2026, 10, 17, 12, 0, 0),
        ]
        agregados: list[object] = []
        db.add.side_effect = lambda objeto: agregados.append(objeto)

        with mock_patch(
            "app.modules.ordenes_trabajo.services.ordenes_trabajo._commit_orden_response",
            return_value={},
        ):
            finalizar_orden(db, 1, self._finalizacion_data(), SimpleNamespace(id_empleado=7))

        self.assertIsInstance(agregados[0], FinalizacionOrden)
        self.assertEqual(agregados[0].trabajo_realizado, "Cambio de fuente")
        self.assertEqual(agregados[0].resultado_solucion, "Servicio restablecido")
        self.assertEqual(orden.estado, "Completada")
        self.assertEqual(cotizacion.estado, "COMPLETADA")
        self.assertIsNone(cotizacion.fecha_actualizacion)
        db.commit.assert_called_once()
        db.scalars.assert_not_called()

    def test_reintento_de_entrega_no_duplica_ni_sobrescribe_finalizacion(self) -> None:
        # Una entrega ya completada es idempotente y conserva los datos originales.
        from unittest.mock import patch as mock_patch

        db = MagicMock()
        orden = SimpleNamespace(id_empleado=7, estado="Completada")
        cotizacion = SimpleNamespace(estado="COMPLETADA", fecha_actualizacion=None)
        finalizacion_previa = SimpleNamespace(
            id_finalizacion=9,
            id_orden=1,
            trabajo_realizado="Anterior",
            resultado_solucion="Anterior",
        )
        db.scalar.side_effect = [
            orden,
            self._evaluacion(5),
            cotizacion,
            finalizacion_previa,
        ]

        with mock_patch(
            "app.modules.ordenes_trabajo.services.ordenes_trabajo._commit_orden_response",
            return_value={},
        ):
            finalizar_orden(db, 1, self._finalizacion_data(), SimpleNamespace(id_empleado=7))

        self.assertEqual(finalizacion_previa.trabajo_realizado, "Anterior")
        db.add.assert_not_called()
        db.commit.assert_called_once()

    def test_tecnico_finaliza_cotizacion_completada_con_deuda(self) -> None:
        """El registro en Cobros autoriza la entrega sin exigir liquidacion financiera."""
        from datetime import datetime

        db = MagicMock()
        orden = SimpleNamespace(id_empleado=7, estado="En Proceso")
        cotizacion = SimpleNamespace(estado="COMPLETADA", fecha_actualizacion=None)
        db.scalar.side_effect = [orden, self._evaluacion(), cotizacion, None, datetime(2026, 10, 20, 12)]
        with mock_patch(
            "app.modules.ordenes_trabajo.services.ordenes_trabajo._commit_orden_response",
            return_value={"estado": "Completada"},
        ):
            response = finalizar_orden(db, 1, self._finalizacion_data(), SimpleNamespace(id_empleado=7))
        self.assertEqual(response["estado"], "Completada")
        self.assertEqual(orden.estado, "Completada")
        self.assertEqual(cotizacion.estado, "COMPLETADA")
        sql_autorizacion = db.scalar.call_args_list[2].args[0].compile()
        self.assertIn(["ACEPTADA", "COMPLETADA"], sql_autorizacion.params.values())
        db.commit.assert_called_once()

    def test_finalizacion_previa_en_proceso_no_impide_confirmar_entrega(self) -> None:
        db = MagicMock()
        orden = SimpleNamespace(id_empleado=7, estado="En Proceso")
        cotizacion = SimpleNamespace(estado="COMPLETADA")
        previa = SimpleNamespace(trabajo_realizado="Anterior", fecha_hora="Fecha original")
        db.scalar.side_effect = [orden, self._evaluacion(), cotizacion, previa]
        with mock_patch(
            "app.modules.ordenes_trabajo.services.ordenes_trabajo._commit_orden_response",
            return_value={"estado": "Completada"},
        ):
            finalizar_orden(db, 1, self._finalizacion_data(), SimpleNamespace(id_empleado=7))
        self.assertEqual(orden.estado, "Completada")
        self.assertEqual(previa.trabajo_realizado, "Cambio de fuente")
        self.assertEqual(previa.fecha_hora, "Fecha original")
        db.add.assert_not_called()
        db.commit.assert_called_once()

    def test_entrega_requiere_completada_sin_depender_de_pagos(self) -> None:
        for estado in ("ACEPTADA", "GENERADA"):
            with self.subTest(estado=estado):
                db = MagicMock()
                orden = SimpleNamespace(id_empleado=7, estado="En Proceso")
                db.scalar.side_effect = [orden, self._evaluacion(), SimpleNamespace(estado=estado)]
                with self.assertRaises(RequiereAprobacionComercialError):
                    finalizar_orden(db, 1, self._finalizacion_data(), SimpleNamespace(id_empleado=7))
                self.assertEqual(orden.estado, "En Proceso")
                db.add.assert_not_called()
                db.commit.assert_not_called()
                db.rollback.assert_called_once()

    def test_entrega_no_exige_pago_positivo_ni_modifica_la_cotizacion(self) -> None:
        from datetime import datetime
        db = MagicMock()
        orden = SimpleNamespace(id_empleado=7, estado="En Proceso")
        cotizacion = SimpleNamespace(estado="COMPLETADA", fecha_actualizacion="Fecha del registro")
        db.scalar.side_effect = [orden, self._evaluacion(), cotizacion, None, datetime(2026, 10, 20, 12)]
        with mock_patch(
            "app.modules.ordenes_trabajo.services.ordenes_trabajo._commit_orden_response",
            return_value={"estado": "Completada"},
        ):
            resultado = finalizar_orden(db, 1, self._finalizacion_data(), SimpleNamespace(id_empleado=7))
        self.assertEqual(resultado["estado"], "Completada")
        self.assertEqual(cotizacion.fecha_actualizacion, "Fecha del registro")
        db.scalars.assert_not_called()
        for llamada in db.scalar.call_args_list:
            self.assertNotIn("pago_detalles", str(llamada.args[0]))
        db.commit.assert_called_once()

    def test_finalizacion_de_otro_tecnico_se_rechaza(self) -> None:
        db = self._db_con_orden(id_empleado=9, estado="En Proceso")
        with self.assertRaises(TecnicoNoAsignadoError):
            finalizar_orden(db, 1, self._finalizacion_data(), SimpleNamespace(id_empleado=7))
        db.add.assert_not_called()
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_detalle_autoriza_completada_en_la_consulta_comercial(self) -> None:
        from app.modules.ordenes_trabajo.services.ordenes_trabajo import _evaluaciones_aceptadas

        db = MagicMock()
        db.scalars.return_value.all.return_value = [5]
        self.assertEqual(_evaluaciones_aceptadas(db, [1]), {5})
        consulta = db.scalars.call_args.args[0].compile()
        self.assertIn(["ACEPTADA", "COMPLETADA"], consulta.params.values())

    def test_finalizar_valida_estado_antes_del_bloqueo(self) -> None:
        db = self._db_con_orden(id_empleado=7, estado="Programada")
        empleado = SimpleNamespace(id_empleado=7)

        from app.modules.ordenes_trabajo.services.ordenes_trabajo import (
            EstadoOrdenError,
            finalizar_orden,
        )

        with self.assertRaises(EstadoOrdenError):
            finalizar_orden(db, 1, self._finalizacion_data(), empleado)

    def test_continuar_trabajo_exige_cotizacion_aceptada(self) -> None:
        from app.modules.ordenes_trabajo.services.ordenes_trabajo import continuar_trabajo

        db = MagicMock()
        db.scalar.side_effect = [
            SimpleNamespace(id_empleado=7, estado="En Proceso"),
            self._evaluacion(5),
            None,
        ]

        with self.assertRaises(RequiereAprobacionComercialError):
            continuar_trabajo(db, 1, SimpleNamespace(id_empleado=7))

    def test_continuar_trabajo_permitido_con_aceptacion(self) -> None:
        from unittest.mock import patch as mock_patch

        from app.modules.ordenes_trabajo.services.ordenes_trabajo import continuar_trabajo

        db = MagicMock()
        db.scalar.side_effect = [
            SimpleNamespace(id_empleado=7, estado="En Proceso"),
            self._evaluacion(5),
            99,
        ]

        with mock_patch(
            "app.modules.ordenes_trabajo.services.ordenes_trabajo._commit_orden_response",
            return_value={},
        ):
            continuar_trabajo(db, 1, SimpleNamespace(id_empleado=7))

        db.commit.assert_called_once()

    def test_registrar_evaluacion_bloqueada_si_ya_esta_cotizada(self) -> None:
        # La evaluación ya existe y una cotización la referencia (id evaluacion=5).
        orden = SimpleNamespace(id_empleado=7, estado="En Proceso")
        evaluacion = SimpleNamespace(id_evaluacion=5)
        db = MagicMock()
        db.scalar.side_effect = [orden, evaluacion, 99]
        empleado = SimpleNamespace(id_empleado=7)
        data = EvaluacionOrdenRegistro(
            diagnostico="Nuevo diagnóstico",
            trabajo_propuesto="Nuevo trabajo",
        )

        with self.assertRaises(EvaluacionEnCotizacionError):
            registrar_evaluacion(db, 1, data, empleado)

        db.rollback.assert_called_once()

    def test_registrar_evaluacion_aplica_campos_antes_del_flush(self) -> None:
        """Regresión del 409: al crear la evaluación, un flush previo a aplicar los
        campos insertaría diagnostico/trabajo_propuesto NULL (violación NOT NULL)."""

        from unittest.mock import patch as mock_patch

        from app.modules.ordenes_trabajo.models.orden_trabajo import EvaluacionOrden

        db = MagicMock()
        orden = SimpleNamespace(id_empleado=7, estado="En Proceso")
        # Primera consulta: bloquea la orden. Segunda: no existe evaluación previa.
        db.scalar.side_effect = [orden, None]
        agregados: list[object] = []
        estado_en_flush: dict[str, object] = {}

        def capturar_add(objeto: object) -> None:
            agregados.append(objeto)

        def capturar_flush() -> None:
            evaluacion = agregados[0] if agregados else None
            estado_en_flush["diagnostico"] = getattr(evaluacion, "diagnostico", None)
            estado_en_flush["trabajo"] = getattr(evaluacion, "trabajo_propuesto", None)

        db.add.side_effect = capturar_add
        db.flush.side_effect = capturar_flush
        data = EvaluacionOrdenRegistro(
            diagnostico="Fuente dañada",
            trabajo_propuesto="Reemplazo",
        )
        with mock_patch(
            "app.modules.ordenes_trabajo.services.ordenes_trabajo._commit_orden_response",
            return_value={},
        ):
            registrar_evaluacion(db, 1, data, SimpleNamespace(id_empleado=7))

        self.assertIsInstance(agregados[0], EvaluacionOrden)
        self.assertEqual(estado_en_flush["diagnostico"], "Fuente dañada")
        self.assertEqual(estado_en_flush["trabajo"], "Reemplazo")


class OrdenTrabajoDetallePermisosTests(unittest.TestCase):
    """El botón «Ver» de Tareas del Técnico reutiliza el detalle administrativo.

    Verifica que el Administrador conserve el acceso total y que un técnico solo
    lea la orden donde figura asignado, con su identidad laboral activa."""

    @staticmethod
    def _user(role: str, empleado: object | None = None) -> SimpleNamespace:
        return SimpleNamespace(rol=SimpleNamespace(nombre=role), empleado=empleado)

    @staticmethod
    def _empleado(
        id_empleado: int,
        *,
        estado: str = "Activo",
        puesto_estado: str = "Activo",
        tiene_funciones: bool = True,
    ) -> SimpleNamespace:
        return SimpleNamespace(
            id_empleado=id_empleado,
            estado=estado,
            puesto=SimpleNamespace(
                estado=puesto_estado,
                tiene_funciones_sistema=tiene_funciones,
            ),
        )

    def test_administrador_lee_cualquier_orden(self) -> None:
        from app.modules.ordenes_trabajo.routers.ordenes_trabajo import get_orden_by_id

        with mock_patch(
            "app.modules.ordenes_trabajo.routers.ordenes_trabajo.get_orden",
            return_value={"id_empleado": 4},
        ):
            result = get_orden_by_id(
                5, current_user=self._user("Administrador"), db=MagicMock()
            )

        self.assertEqual(result["id_empleado"], 4)

    def test_tecnico_asignado_lee_su_orden(self) -> None:
        from app.modules.ordenes_trabajo.routers.ordenes_trabajo import get_orden_by_id

        with mock_patch(
            "app.modules.ordenes_trabajo.routers.ordenes_trabajo.get_orden",
            return_value={"id_empleado": 4},
        ):
            result = get_orden_by_id(
                5,
                current_user=self._user("Empleado", self._empleado(4)),
                db=MagicMock(),
            )

        self.assertEqual(result["id_empleado"], 4)

    def test_tecnico_no_asignado_recibe_403(self) -> None:
        from app.modules.ordenes_trabajo.routers.ordenes_trabajo import get_orden_by_id

        with mock_patch(
            "app.modules.ordenes_trabajo.routers.ordenes_trabajo.get_orden",
            return_value={"id_empleado": 4},
        ):
            with self.assertRaises(HTTPException) as ctx:
                get_orden_by_id(
                    5,
                    current_user=self._user("Empleado", self._empleado(7)),
                    db=MagicMock(),
                )

        self.assertEqual(ctx.exception.status_code, 403)

    def test_empleado_sin_identidad_laboral_recibe_403(self) -> None:
        from app.modules.ordenes_trabajo.routers.ordenes_trabajo import get_orden_by_id

        with mock_patch(
            "app.modules.ordenes_trabajo.routers.ordenes_trabajo.get_orden",
            return_value={"id_empleado": 4},
        ):
            with self.assertRaises(HTTPException) as ctx:
                get_orden_by_id(
                    5, current_user=self._user("Empleado", None), db=MagicMock()
                )

        self.assertEqual(ctx.exception.status_code, 403)

    def test_orden_inexistente_recibe_404(self) -> None:
        from app.modules.ordenes_trabajo.routers.ordenes_trabajo import get_orden_by_id

        with mock_patch(
            "app.modules.ordenes_trabajo.routers.ordenes_trabajo.get_orden",
            return_value=None,
        ):
            with self.assertRaises(HTTPException) as ctx:
                get_orden_by_id(
                    5, current_user=self._user("Administrador"), db=MagicMock()
                )

        self.assertEqual(ctx.exception.status_code, 404)

    def test_evaluacion_solo_se_consulta_por_el_tecnico_asignado(self) -> None:
        from app.modules.ordenes_trabajo.routers.ordenes_trabajo import get_evaluacion_route

        for empleado_id, codigo in ((4, None), (7, 403)):
            with self.subTest(empleado_id=empleado_id):
                with (
                    mock_patch(
                        "app.modules.ordenes_trabajo.routers.ordenes_trabajo.get_orden_model",
                        return_value=SimpleNamespace(id_empleado=4),
                    ),
                    mock_patch(
                        "app.modules.ordenes_trabajo.routers.ordenes_trabajo.get_evaluacion",
                        return_value={"id_evaluacion": 5},
                    ) as consultar,
                ):
                    if codigo is None:
                        respuesta = get_evaluacion_route(1, self._empleado(empleado_id), MagicMock())
                        self.assertEqual(respuesta["id_evaluacion"], 5)
                        consultar.assert_called_once()
                    else:
                        with self.assertRaises(HTTPException) as contexto:
                            get_evaluacion_route(1, self._empleado(empleado_id), MagicMock())
                        self.assertEqual(contexto.exception.status_code, codigo)
                        consultar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
