"""Pruebas aisladas del enlace comercial y ejecucion tecnica de instalaciones.

Las sesiones SQLAlchemy y el almacenamiento de evidencia estan simulados; no
se consulta PostgreSQL ni se guardan instalaciones o imagenes reales.
"""

from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.main import app
from app.modules.instalaciones.models.instalacion import Instalacion
from app.modules.instalaciones.routers.instalaciones import (
    _domain_http_error, get_instalacion_by_id, get_instalaciones, require_instalaciones_operator,
)
from app.modules.instalaciones.schemas.instalacion import InstalacionCreate
from app.modules.instalaciones.services.instalaciones import (
    EstadoInstalacionError, InstalacionNoAsignadaError, UbicacionInvalidaError,
    VisitaInvalidaError, _installation_response, completar_instalacion,
    create_instalacion, iniciar_instalacion, listar_visitas_programables,
)


class FlujoInstalacionesTests(unittest.TestCase):
    def _row(self):
        evaluacion = SimpleNamespace(
            id_evaluacion=31, tecnicos_recomendados=2, condiciones_lugar="Terraza accesible",
            observacion_tecnica="Enlace viable",
            descripcion_trabajo="Instalar enlace en terraza",
            materiales=[SimpleNamespace(id_detalle=1, descripcion="Cable UTP", cantidad=Decimal("20"), unidad="Metro")],
        )
        visita = SimpleNamespace(id_visita=15, id_ubicacion=44, evaluacion=evaluacion,
                                 fecha_programada=date(2026, 10, 20), hora_programada=time(9),
                                 estado="Completada", motivo_visita="Evaluar enlace", indicaciones="Llamar al llegar",
                                 observaciones=None, foto_referencia=None,
                                 empleado=SimpleNamespace(nombres="Ana", apellidos="Lopez"),
                                 id_tipo_instalacion=2, tipo_instalacion=SimpleNamespace(nombre="Internet"))
        return SimpleNamespace(VisitaTecnica=visita, Cotizacion=SimpleNamespace(
            id_cotizacion=8, numero_cotizacion="COT-2026-0008", estado="COMPLETADA"))

    def _installation(self):
        tecnico = SimpleNamespace(id_empleado=7, codigo="EMP-7", nombres="Ana", apellidos="Lopez",
                                  id_puesto=1, puesto=SimpleNamespace(nombre="Tecnico"), estado="Activo")
        return SimpleNamespace(
            id_instalacion=9, id_cliente=4, id_visita=15, id_ubicacion=44,
            estado="Programada", fecha_programada=date(2026, 10, 22), hora_programada=time(9),
            observaciones="Nota administrativa", observaciones_tecnicas=None,
            evidencia_fotografica=None, fecha_finalizacion=None, fecha_registro=datetime(2026, 10, 20),
            cliente=SimpleNamespace(id_cliente=4, nombres="Juan", apellidos="Perez", telefono="55551234",
                                   direccion="Zona 1", municipio=SimpleNamespace(nombre="Guatemala"),
                                   dpi=None, correo="cliente@example.com", referencia="Frente al parque", estado="Activo"),
            visita=self._row().VisitaTecnica, ubicacion=None,
            asignaciones=[SimpleNamespace(id_empleado=7, es_encargado=True, empleado=tecnico)],
        )

    def test_lista_visitas_completadas_del_cliente_con_evaluacion_real(self):
        db = MagicMock()
        db.scalar.return_value = SimpleNamespace(estado="Activo")
        db.execute.return_value.unique.return_value.all.return_value = [self._row()]
        respuesta = listar_visitas_programables(db, 4)
        self.assertEqual(respuesta[0]["id_visita"], 15)
        self.assertEqual(respuesta[0]["id_ubicacion"], 44)
        self.assertEqual(respuesta[0]["descripcion_trabajo"], "Instalar enlace en terraza")
        self.assertEqual(respuesta[0]["materiales"][0]["cantidad"], Decimal("20"))
        consulta = db.execute.call_args.args[0].compile()
        self.assertIn("COMPLETADA", consulta.params.values())
        self.assertIn("Completada", consulta.params.values())
        self.assertIn("EVALUACION", consulta.params.values())
        self.assertIn("visitas_tecnicas.id_cliente", str(consulta))
        self.assertIn("cotizaciones.id_cliente", str(consulta))
        db.commit.assert_not_called()
        db.add.assert_not_called()

    def test_creacion_guarda_visita_ubicacion_y_equipo_sin_operaciones_financieras(self):
        db = MagicMock()
        tecnico = SimpleNamespace(estado="Activo", puesto=SimpleNamespace(estado="Activo", nombre="Tecnico"))
        db.scalar.side_effect = [SimpleNamespace(estado="Activo"), tecnico]
        db.execute.return_value.unique.return_value.one_or_none.return_value = self._row()
        db.get.return_value = SimpleNamespace(id_cliente=4, estado="Activo")
        db.add.side_effect = lambda installation: setattr(installation, "id_instalacion", 9)
        data = InstalacionCreate(id_cliente=4, id_visita=15, id_ubicacion=44,
                                  fecha_programada="2026-10-22", hora_programada="09:00",
                                  tecnicos=[{"id_empleado": 7}])
        with patch("app.modules.instalaciones.services.instalaciones._committed_response", return_value={"estado": "Programada"}):
            respuesta = create_instalacion(db, data)
        installation = db.add.call_args.args[0]
        self.assertIsInstance(installation, Instalacion)
        self.assertEqual((installation.id_visita, installation.id_ubicacion), (15, 44))
        self.assertTrue(installation.asignaciones[0].es_encargado)
        self.assertEqual(respuesta["estado"], "Programada")
        self.assertIn("FOR UPDATE", str(db.execute.call_args.args[0]))
        db.add.assert_called_once()
        db.commit.assert_called_once()

    def test_creacion_rechaza_fuente_no_completada_y_ubicacion_ajena(self):
        for row, ubicacion, error in ((None, 44, VisitaInvalidaError), (self._row(), 99, UbicacionInvalidaError)):
            with self.subTest(ubicacion=ubicacion, error=error):
                db = MagicMock()
                db.scalar.return_value = SimpleNamespace(estado="Activo")
                db.execute.return_value.unique.return_value.one_or_none.return_value = row
                data = InstalacionCreate(id_cliente=4, id_visita=15, id_ubicacion=ubicacion,
                                          fecha_programada="2026-10-22", hora_programada="09:00",
                                          tecnicos=[{"id_empleado": 7}])
                with self.assertRaises(error):
                    create_instalacion(db, data)
                db.add.assert_not_called()
                db.commit.assert_not_called()
                db.rollback.assert_called_once()

    def test_detalle_deriva_descripcion_y_accesorios_de_la_visita(self):
        respuesta = _installation_response(self._installation())
        self.assertEqual(respuesta["visita"]["descripcion_evaluacion"], "Instalar enlace en terraza")
        self.assertEqual(respuesta["visita"]["materiales"][0]["descripcion"], "Cable UTP")
        self.assertEqual(respuesta["cliente"]["correo"], "cliente@example.com")
        self.assertEqual(respuesta["visita"]["id_evaluacion"], 31)
        self.assertEqual(respuesta["visita"]["condiciones_lugar"], "Terraza accesible")
        self.assertEqual(respuesta["visita"]["nombre_tecnico"], "Ana Lopez")

    def test_tecnico_asignado_inicia_y_otro_equipo_recibe_403(self):
        for empleado, autorizado in ((7, True), (8, False), (None, True)):
            with self.subTest(empleado=empleado):
                db = MagicMock()
                installation = self._installation()
                db.scalar.return_value = installation
                with patch("app.modules.instalaciones.services.instalaciones._committed_response", return_value={}):
                    if autorizado:
                        iniciar_instalacion(db, installation, empleado)
                        self.assertEqual(installation.estado, "En Proceso")
                        db.commit.assert_called_once()
                    else:
                        with self.assertRaises(InstalacionNoAsignadaError) as contexto:
                            iniciar_instalacion(db, installation, empleado)
                        self.assertEqual(_domain_http_error(contexto.exception).status_code, 403)
                        self.assertEqual(installation.estado, "Programada")
                        db.commit.assert_not_called()
                db.refresh.assert_called_with(installation, attribute_names=["asignaciones"])

    def test_tecnico_completa_con_evidencia_y_un_reintento_no_la_duplica(self):
        db = MagicMock()
        installation = self._installation()
        installation.estado = "En Proceso"
        db.scalar.return_value = installation
        with (
            patch("app.modules.instalaciones.services.instalaciones.store_image", return_value=("uploads/evidencias_instalacion/9.webp", Path("9.webp"))) as guardar,
            # Construye la respuesta real para verificar la ruta expuesta tras el guardado simulado.
            patch("app.modules.instalaciones.services.instalaciones._committed_response", side_effect=lambda _db, _id: _installation_response(installation)),
        ):
            respuesta = completar_instalacion(db, installation, " Enlace validado ", b"imagen simulada", 7)
            self.assertEqual(respuesta["estado"], "Completada")
            self.assertEqual(installation.evidencia_fotografica, "uploads/evidencias_instalacion/9.webp")
            self.assertEqual(respuesta["evidencia_fotografica"], "/uploads/evidencias_instalacion/9.webp")
            self.assertEqual(installation.observaciones_tecnicas, "Enlace validado")
            self.assertIsNotNone(installation.fecha_finalizacion)
            with self.assertRaises(EstadoInstalacionError):
                completar_instalacion(db, installation, "Reintento", b"imagen simulada", 7)
            guardar.assert_called_once()
            db.commit.assert_called_once()

    def test_cierre_no_asignado_no_guarda_imagen_y_fallo_revierte_archivo(self):
        db = MagicMock()
        installation = self._installation()
        installation.estado = "En Proceso"
        db.scalar.return_value = installation
        with patch("app.modules.instalaciones.services.instalaciones.store_image") as guardar:
            with self.assertRaises(InstalacionNoAsignadaError):
                completar_instalacion(db, installation, "Observaciones", b"imagen", 8)
            guardar.assert_not_called()
        db.commit.side_effect = RuntimeError("Fallo simulado")
        with (
            patch("app.modules.instalaciones.services.instalaciones.store_image", return_value=("uploads/evidencias_instalacion/9.webp", Path("9.webp"))),
            patch("app.modules.instalaciones.services.instalaciones.remove_image_file") as quitar,
        ):
            with self.assertRaises(RuntimeError):
                completar_instalacion(db, installation, "Observaciones", b"imagen", 7)
            quitar.assert_called_once_with(Path("9.webp"))

    def test_operador_exige_identidad_laboral_activa_y_endpoints_conservan_jwt(self):
        usuario = SimpleNamespace(rol=SimpleNamespace(nombre="Empleado"), empleado=None)
        with self.assertRaises(HTTPException):
            require_instalaciones_operator(usuario)
        usuario.empleado = SimpleNamespace(id_empleado=7, estado="Activo", puesto=SimpleNamespace(estado="Activo", tiene_funciones_sistema=True))
        self.assertIs(require_instalaciones_operator(usuario), usuario)
        for ruta, metodo in (("/api/instalaciones/visitas-disponibles", "get"),
                             ("/api/instalaciones/{id_instalacion}", "get"),
                             ("/api/instalaciones/{id_instalacion}/iniciar", "post"),
                             ("/api/instalaciones/{id_instalacion}/completar", "post")):
            self.assertEqual(app.openapi()["paths"][ruta][metodo]["security"], [{"OAuth2PasswordBearer": []}])

    def test_ver_permite_administrador_y_equipo_asignado_incluso_completada(self):
        installation = self._installation()
        installation.estado = "Completada"
        for rol, empleado, permitido in (("Administrador", None, True), ("Empleado", 7, True), ("Empleado", 8, False)):
            with self.subTest(rol=rol, empleado=empleado):
                usuario = SimpleNamespace(rol=SimpleNamespace(nombre=rol), empleado=SimpleNamespace(id_empleado=empleado))
                db = MagicMock()
                db.scalar.return_value = installation
                if permitido:
                    resultado = get_instalacion_by_id(9, usuario, db)
                    self.assertEqual(resultado["estado"], "Completada")
                    self.assertEqual(resultado["cliente"]["nombre"], "Juan Perez")
                else:
                    with self.assertRaises(HTTPException) as contexto:
                        get_instalacion_by_id(9, usuario, db)
                    self.assertEqual(contexto.exception.status_code, 403)
                db.add.assert_not_called()
                db.commit.assert_not_called()
                db.flush.assert_not_called()

    def test_ver_historico_sin_visita_ubicacion_o_evaluacion_no_inventa_datos(self):
        installation = self._installation()
        installation.visita = None
        installation.ubicacion = None
        resultado = _installation_response(installation)
        self.assertIsNone(resultado["visita"])
        self.assertIsNone(resultado["ubicacion"])
        installation.visita = self._row().VisitaTecnica
        installation.visita.evaluacion = None
        resultado = _installation_response(installation)
        self.assertIsNone(resultado["visita"]["id_evaluacion"])
        self.assertEqual(resultado["visita"]["materiales"], [])

    def test_ver_fachada_y_coordenadas_usa_la_propiedad_de_la_instalacion(self):
        installation = self._installation()
        installation.ubicacion = SimpleNamespace(
            id_ubicacion=44, direccion="Terraza", latitud=Decimal("14.63"), longitud=Decimal("-90.5"),
            referencia="Porton azul", observaciones=None, numero_propiedad=2,
            foto_fachada="uploads/ubicaciones_clientes/44.webp", estado="Activo",
        )
        resultado = _installation_response(installation)
        self.assertEqual(resultado["ubicacion"]["foto_fachada"], "/uploads/ubicaciones_clientes/44.webp")
        self.assertEqual(resultado["ubicacion"]["numero_propiedad"], 2)

    def test_listado_tambien_filtra_por_asignacion_para_no_eludir_el_detalle(self):
        usuario = SimpleNamespace(rol=SimpleNamespace(nombre="Empleado"), empleado=SimpleNamespace(id_empleado=7))
        db = MagicMock()
        db.scalars.return_value.unique.return_value.all.return_value = [self._installation()]
        resultado = get_instalaciones(usuario, estado=None, db=db)
        self.assertEqual(len(resultado), 1)
        consulta = db.scalars.call_args.args[0].compile()
        self.assertIn("EXISTS", str(consulta))
        self.assertIn("instalacion_tecnicos.id_empleado", str(consulta))
        self.assertIn(7, consulta.params.values())
        db.commit.assert_not_called()

    def test_detalle_inexistente_y_empleado_inactivo_son_rechazados(self):
        usuario = SimpleNamespace(rol=SimpleNamespace(nombre="Empleado"), empleado=SimpleNamespace(id_empleado=7))
        db = MagicMock()
        db.scalar.return_value = None
        with self.assertRaises(HTTPException) as contexto:
            get_instalacion_by_id(999, usuario, db)
        self.assertEqual(contexto.exception.status_code, 404)
        usuario.empleado.estado = "Inactivo"
        with self.assertRaises(HTTPException) as contexto:
            require_instalaciones_operator(usuario)
        self.assertEqual(contexto.exception.status_code, 403)
