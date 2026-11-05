"""Pruebas de la proyección de propiedades de instalaciones en Tareas."""

from datetime import date, datetime, time
from decimal import Decimal
from types import SimpleNamespace
import unittest

from app.modules.tareas.services.tareas import (
    _installation_task,
    _order_commercial_fields,
    _order_task,
)


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

    def test_tecnico_asignado_recibe_descripcion_accesorios_y_acciones_sin_ser_admin(self) -> None:
        installation = self._installation(id_ubicacion=None, ubicacion=None)
        installation.visita.evaluacion = SimpleNamespace(
            descripcion_trabajo="Instalar enlace en terraza",
            materiales=[SimpleNamespace(id_detalle=1, descripcion="Cable UTP", cantidad=Decimal("20"), unidad="Metro")],
        )
        task = _installation_task(installation, current_employee_id=7, actions_enabled=False)
        self.assertEqual(task["descripcion"], "Instalar enlace en terraza")
        self.assertEqual(task["materiales"][0]["descripcion"], "Cable UTP")
        self.assertTrue(task["puede_realizar_acciones"])
        self.assertTrue(task["puede_ver"])
        self.assertFalse(task["bloqueada"])
        otro = _installation_task(installation, current_employee_id=8, actions_enabled=False)
        self.assertFalse(otro["puede_realizar_acciones"])
        self.assertTrue(otro["bloqueada"])
        self.assertFalse(otro["puede_ver"])
        installation.estado = "Completada"
        finalizada = _installation_task(installation, current_employee_id=7, actions_enabled=False)
        self.assertFalse(finalizada["puede_realizar_acciones"])
        self.assertTrue(finalizada["puede_ver"])


class TareaOrdenRechazoTests(unittest.TestCase):
    def _order(self):
        return SimpleNamespace(
            id_orden=5,
            id_cliente=3,
            fecha_recepcion=datetime(2026, 10, 5, 9, 30),
            titulo="Reparar fuente",
            estado="En Proceso",
            id_empleado=7,
            cliente=SimpleNamespace(nombres="Juan", apellidos="Perez"),
            tipo_trabajo=SimpleNamespace(nombre="Reparacion"),
            empleado=SimpleNamespace(
                id_empleado=7,
                codigo="EMP-0007",
                nombres="Ana",
                apellidos="Lopez",
            ),
        )

    def test_orden_rechazada_informa_el_rechazo_sin_autorizar_reparacion(self) -> None:
        task = _order_task(
            self._order(),
            current_employee_id=7,
            actions_enabled=False,
            reparacion_autorizada=False,
            trabajo_rechazado=True,
            tiene_evaluacion=True,
            tiene_finalizacion=False,
        )

        self.assertTrue(task["trabajo_rechazado"])
        self.assertFalse(task["reparacion_autorizada"])

    def test_orden_aceptada_autoriza_reparacion_sin_rechazo(self) -> None:
        task = _order_task(
            self._order(),
            current_employee_id=7,
            actions_enabled=False,
            reparacion_autorizada=True,
            trabajo_rechazado=False,
            tiene_evaluacion=True,
            tiene_finalizacion=False,
        )

        self.assertTrue(task["reparacion_autorizada"])
        self.assertFalse(task["trabajo_rechazado"])


class TareaOrdenTrabajoAdicionalTests(unittest.TestCase):
    """Estado comercial derivado de la cotización y la Proforma (sin columnas)."""

    def _order(self, finalizacion=None):
        return SimpleNamespace(
            evaluacion=SimpleNamespace(id_evaluacion=34),
            finalizacion=finalizacion,
        )

    def _cotizacion(self, *, estado: str, tiene_proforma: bool, id_cotizacion: int = 9):
        return SimpleNamespace(
            id_cotizacion=id_cotizacion,
            estado=estado,
            proforma=None if not tiene_proforma else SimpleNamespace(id_proforma=1),
        )

    def test_aceptada_autoriza_sin_marcas_de_adicional(self) -> None:
        campos = _order_commercial_fields(
            self._order(),
            {34: self._cotizacion(estado="ACEPTADA", tiene_proforma=False)},
        )

        self.assertTrue(campos["reparacion_autorizada"])
        self.assertFalse(campos["trabajo_rechazado"])
        self.assertFalse(campos["trabajo_adicional_en_revision"])
        self.assertFalse(campos["trabajo_adicional_rechazado"])
        self.assertEqual(campos["id_cotizacion"], 9)

    def test_rechazo_sin_proforma_bloquea_reparacion(self) -> None:
        campos = _order_commercial_fields(
            self._order(),
            {34: self._cotizacion(estado="RECHAZADA", tiene_proforma=False)},
        )

        self.assertFalse(campos["reparacion_autorizada"])
        self.assertTrue(campos["trabajo_rechazado"])

    def test_completada_autoriza_finalizacion_sin_depender_de_proforma(self) -> None:
        """Registrar en Cobros habilita la entrega sin exigir deuda cero ni dinero recibido."""
        campos = _order_commercial_fields(
            self._order(),
            {34: self._cotizacion(estado="COMPLETADA", tiene_proforma=False)},
        )
        self.assertTrue(campos["reparacion_autorizada"])
        self.assertFalse(campos["trabajo_rechazado"])
        self.assertFalse(campos["trabajo_adicional_en_revision"])
        self.assertTrue(campos["finalizacion_autorizada"])

    def test_completada_por_pendiente_cero_autoriza_entrega(self) -> None:
        campos = _order_commercial_fields(
            self._order(),
            {34: self._cotizacion(estado="COMPLETADA", tiene_proforma=True)},
        )
        self.assertTrue(campos["finalizacion_autorizada"])

    def test_aceptada_sin_registro_completado_no_autoriza_entrega(self) -> None:
        campos = _order_commercial_fields(
            self._order(),
            {34: self._cotizacion(estado="ACEPTADA", tiene_proforma=True)},
        )
        self.assertFalse(campos["finalizacion_autorizada"])

    def test_proforma_conserva_autorizacion_al_agregar_trabajo(self) -> None:
        campos = _order_commercial_fields(
            self._order(),
            {34: self._cotizacion(estado="EN PROCESO", tiene_proforma=True)},
        )

        self.assertTrue(campos["reparacion_autorizada"])
        self.assertFalse(campos["trabajo_rechazado"])
        self.assertTrue(campos["trabajo_adicional_en_revision"])

    def test_rechazo_con_proforma_solo_marca_el_adicional(self) -> None:
        campos = _order_commercial_fields(
            self._order(),
            {34: self._cotizacion(estado="RECHAZADA", tiene_proforma=True)},
        )

        self.assertTrue(campos["reparacion_autorizada"])
        self.assertFalse(campos["trabajo_rechazado"])
        self.assertTrue(campos["trabajo_adicional_rechazado"])

    def test_sin_cotizacion_no_inventa_marcas(self) -> None:
        campos = _order_commercial_fields(self._order(), {})

        self.assertFalse(campos["reparacion_autorizada"])
        self.assertFalse(campos["trabajo_rechazado"])
        self.assertIsNone(campos["id_cotizacion"])

    def test_order_task_expone_id_cotizacion_y_flags(self) -> None:
        order = SimpleNamespace(
            id_orden=5,
            id_cliente=3,
            fecha_recepcion=datetime(2026, 10, 5, 9, 30),
            titulo="Reparar fuente",
            estado="En Proceso",
            id_empleado=7,
            cliente=SimpleNamespace(nombres="Juan", apellidos="Perez"),
            tipo_trabajo=SimpleNamespace(nombre="Reparacion"),
            empleado=SimpleNamespace(
                id_empleado=7,
                codigo="EMP-0007",
                nombres="Ana",
                apellidos="Lopez",
            ),
            evaluacion=SimpleNamespace(id_evaluacion=34),
            finalizacion=None,
        )
        campos = _order_commercial_fields(
            order,
            {34: self._cotizacion(estado="EN PROCESO", tiene_proforma=True)},
        )

        task = _order_task(
            order,
            current_employee_id=7,
            actions_enabled=True,
            **campos,
        )

        self.assertEqual(task["id_cotizacion"], 9)
        self.assertTrue(task["trabajo_adicional_en_revision"])

        # La entrega sigue disponible con una finalizacion tecnica previa,
        # pero solo para el responsable y mientras la orden permanezca abierta.
        for empleado, estado, habilitada in ((7, "En Proceso", True), (8, "En Proceso", False), (7, "Completada", False)):
            with self.subTest(empleado=empleado, estado=estado):
                order.estado = estado
                campos = _order_commercial_fields(
                    order, {34: self._cotizacion(estado="COMPLETADA", tiene_proforma=True)},
                )
                campos["tiene_finalizacion"] = True
                task = _order_task(order, current_employee_id=empleado, actions_enabled=True, **campos)
                self.assertEqual(task["puede_finalizar_orden"], habilitada)


if __name__ == "__main__":
    unittest.main()
