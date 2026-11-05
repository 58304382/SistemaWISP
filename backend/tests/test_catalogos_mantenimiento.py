"""Protecciones de los seis catálogos sin escribir en la base PostgreSQL real."""

from types import SimpleNamespace as NS
import unittest
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.core.database import get_db
from app.modules.auth.services.auth import get_current_user
from app.modules.finanzas.schemas.caja import CategoriaCajaCreate, CategoriaCajaUpdate
from app.modules.finanzas.schemas.cobros import MetodoPagoCreate, MetodoPagoUpdate
from app.modules.finanzas.services.catalogos import (
    CatalogoFinancieroError, guardar_categoria, guardar_metodo,
)
from app.modules.empleados.schemas.puesto import PuestoWrite
from app.modules.empleados.services.puestos import PuestoError, guardar_puesto
from app.modules.soporte_tecnico.schemas.categoria import CategoriaTicketWrite
from app.modules.soporte_tecnico.services.categorias import CategoriaError, guardar_categoria as guardar_ticket
from app.modules.ordenes_trabajo.schemas.tipo_trabajo import TipoTrabajoUpdate
from app.modules.ordenes_trabajo.services.tipos_trabajo import TipoTrabajoEnUsoError, delete_tipo_trabajo
from app.modules.visitas_tecnicas.schemas.tipo_instalacion import TipoInstalacionUpdate


class CatalogosFinancierosTests(unittest.TestCase):
    def test_efectivo_no_se_renombra_ni_desactiva(self):
        for values in ({"nombre": "Caja física"}, {"estado": "Inactivo"}):
            with self.subTest(values=values):
                db = MagicMock()
                metodo = NS(id_metodo_pago=1, nombre="Efectivo", estado="Activo", descripcion=None)
                db.scalar.side_effect = [metodo, None]
                with self.assertRaises(CatalogoFinancieroError):
                    guardar_metodo(db, MetodoPagoUpdate(**values), 1)
                self.assertEqual(metodo.nombre, "Efectivo")
                self.assertEqual(metodo.estado, "Activo")
                db.commit.assert_not_called()

    def test_efectivo_permite_editar_descripcion(self):
        db = MagicMock()
        metodo = NS(id_metodo_pago=1, nombre="Efectivo", estado="Activo", descripcion=None)
        db.scalar.side_effect = [metodo, None]
        guardar_metodo(db, MetodoPagoUpdate(descripcion=" Moneda local "), 1)
        self.assertEqual(metodo.descripcion, "Moneda local")
        db.commit.assert_called_once()

    def test_metodo_utilizado_no_se_desactiva(self):
        db = MagicMock()
        db.scalar.side_effect = [NS(id_metodo_pago=2, nombre="Transferencia", estado="Activo"), None, 5, None]
        with self.assertRaises(CatalogoFinancieroError):
            guardar_metodo(db, MetodoPagoUpdate(estado="Inactivo"), 2)
        db.commit.assert_not_called()

    def test_metodo_duplicado_no_se_crea(self):
        db = MagicMock()
        db.scalar.return_value = 1
        with self.assertRaises(CatalogoFinancieroError):
            guardar_metodo(db, MetodoPagoCreate(nombre=" efectivo ", estado="Activo"))
        db.add.assert_not_called()

    def test_metodo_nuevo_y_no_referenciado_se_crea(self):
        db = MagicMock()
        db.scalar.return_value = None
        metodo = guardar_metodo(db, MetodoPagoCreate(nombre="Tarjeta", descripcion=" POS ", estado="Activo"))
        self.assertEqual((metodo.nombre, metodo.descripcion), ("Tarjeta", "POS"))
        db.commit.assert_called_once()

    def test_categoria_automatica_preserva_nombre_tipo_estado_y_origen(self):
        for values in ({"nombre": "Otro"}, {"tipo": "Egreso"}, {"estado": "Inactivo"}, {"origen_financiero": None}):
            with self.subTest(values=values):
                db = MagicMock()
                categoria = NS(id_categoria=4, nombre="Instalaciones", tipo="Ingreso", estado="Activo", origen_financiero="INSTALACIONES")
                db.scalar.side_effect = [categoria, None]
                with self.assertRaises(CatalogoFinancieroError):
                    guardar_categoria(db, CategoriaCajaUpdate(**values), 4)
                db.commit.assert_not_called()
                self.assertEqual(categoria.origen_financiero, "INSTALACIONES")

    def test_categoria_automatica_permite_descripcion(self):
        db = MagicMock()
        categoria = NS(id_categoria=4, nombre="Instalaciones", tipo="Ingreso", estado="Activo", origen_financiero="INSTALACIONES")
        db.scalar.side_effect = [categoria, None]
        guardar_categoria(db, CategoriaCajaUpdate(descripcion="Ingreso automático"), 4)
        self.assertEqual(categoria.descripcion, "Ingreso automático")
        db.commit.assert_called_once()

    def test_no_se_puede_crear_otro_origen_automatico(self):
        db = MagicMock()
        db.scalar.return_value = None
        with self.assertRaises(CatalogoFinancieroError):
            guardar_categoria(db, CategoriaCajaCreate(nombre="Internet duplicado", tipo="Ingreso", estado="Activo", origen_financiero="INTERNET"))
        db.add.assert_not_called()

    def test_entrada_y_salida_no_se_reclasifican(self):
        db = MagicMock()
        db.scalar.side_effect = [NS(id_categoria=1, nombre="Entrada", tipo="Ingreso", estado="Activo", origen_financiero=None), None]
        with self.assertRaises(CatalogoFinancieroError):
            guardar_categoria(db, CategoriaCajaUpdate(tipo="Egreso"), 1)
        db.commit.assert_not_called()

    def test_categoria_con_movimientos_no_se_desactiva(self):
        db = MagicMock()
        db.scalar.side_effect = [NS(id_categoria=7, nombre="Gastos", tipo="Egreso", estado="Activo", origen_financiero=None), None, 8]
        with self.assertRaises(CatalogoFinancieroError):
            guardar_categoria(db, CategoriaCajaUpdate(estado="Inactivo"), 7)
        db.commit.assert_not_called()

    def test_categoria_no_referenciada_se_crea_manual(self):
        db = MagicMock()
        db.scalar.return_value = None
        categoria = guardar_categoria(db, CategoriaCajaCreate(nombre="Materiales", tipo="Egreso", estado="Activo"))
        self.assertIsNone(categoria.origen_financiero)
        self.assertEqual(categoria.tipo, "Egreso")
        db.commit.assert_called_once()


class PuestosYCategoriasTests(unittest.TestCase):
    def _puesto(self, nombre="Administrativo", funciones=True):
        return NS(id_puesto=2, nombre=nombre, estado="Activo", tiene_funciones_sistema=funciones)

    def test_tecnico_preserva_identidad_estado_y_funciones(self):
        for values in ({"nombre": "Técnico nuevo"}, {"estado": "Inactivo"}, {"tiene_funciones_sistema": False}):
            with self.subTest(values=values):
                db = MagicMock()
                puesto = self._puesto("Técnico")
                db.scalar.return_value = puesto
                db.scalars.return_value.all.return_value = [puesto]
                data = {"nombre": "Técnico", "estado": "Activo", "tiene_funciones_sistema": True, **values}
                with self.assertRaises(PuestoError):
                    guardar_puesto(db, PuestoWrite(**data), 2)
                db.commit.assert_not_called()

    def test_puesto_no_pierde_funciones_si_tiene_usuarios(self):
        db = MagicMock()
        puesto = self._puesto()
        db.scalars.return_value.all.return_value = [puesto]
        db.scalar.side_effect = [puesto, 8]
        with self.assertRaises(PuestoError):
            guardar_puesto(db, PuestoWrite(nombre=puesto.nombre, tiene_funciones_sistema=False), 2)
        db.commit.assert_not_called()

    def test_puesto_con_empleados_activos_no_se_desactiva(self):
        db = MagicMock()
        puesto = self._puesto()
        db.scalars.return_value.all.return_value = [puesto]
        db.scalar.side_effect = [puesto, 8]
        with self.assertRaises(PuestoError):
            guardar_puesto(db, PuestoWrite(nombre=puesto.nombre, estado="Inactivo", tiene_funciones_sistema=True), 2)
        db.commit.assert_not_called()

    def test_puesto_nuevo_respeta_bandera_de_funciones(self):
        db = MagicMock()
        db.scalars.return_value.all.return_value = []
        puesto = guardar_puesto(db, PuestoWrite(nombre="Almacén", tiene_funciones_sistema=False))
        self.assertFalse(puesto.tiene_funciones_sistema)
        db.commit.assert_called_once()

    def test_categoria_ticket_con_trabajos_en_curso_no_se_desactiva(self):
        db = MagicMock()
        categoria = NS(id_categoria=1, nombre="Internet", estado="Activo")
        db.scalar.side_effect = [categoria, None, 3]
        with self.assertRaises(CategoriaError):
            guardar_ticket(db, CategoriaTicketWrite(nombre="Internet", estado="Inactivo"), 1)
        self.assertEqual(categoria.estado, "Activo")
        db.commit.assert_not_called()

    def test_categoria_ticket_sin_trabajos_se_desactiva_logicamente(self):
        db = MagicMock()
        categoria = NS(id_categoria=1, nombre="Internet", estado="Activo")
        db.scalar.side_effect = [categoria, None, None]
        guardar_ticket(db, CategoriaTicketWrite(nombre="Internet", estado="Inactivo"), 1)
        self.assertEqual(categoria.estado, "Inactivo")
        db.delete.assert_not_called()
        db.commit.assert_called_once()

    def test_delete_legado_tipo_trabajo_no_elude_validacion_de_referencias(self):
        db = MagicMock()
        db.scalar.return_value = 4
        with self.assertRaises(TipoTrabajoEnUsoError):
            delete_tipo_trabajo(db, NS(id_tipo_trabajo=1, nombre="Reparación", estado="Activo"))
        db.delete.assert_not_called()
        db.commit.assert_not_called()

    def test_patch_no_admite_borrar_campos_obligatorios(self):
        for schema in (TipoInstalacionUpdate, TipoTrabajoUpdate):
            for campo in ("nombre", "estado"):
                with self.subTest(schema=schema, campo=campo), self.assertRaises(ValidationError):
                    schema(**{campo: None})


class CatalogosPermisosTests(unittest.TestCase):
    """Comprueba autorización real HTTP, no solo presencia de JWT en OpenAPI."""

    rutas = (
        ("/api/tipos-instalacion/todos", "/api/tipos-instalacion", "/api/tipos-instalacion/1"),
        ("/api/tipos-trabajo", "/api/tipos-trabajo", "/api/tipos-trabajo/1"),
        ("/api/tickets/categorias/todas", "/api/tickets/categorias", "/api/tickets/categorias/1"),
        ("/api/cobros/metodos-pago/todos", "/api/cobros/metodos-pago", "/api/cobros/metodos-pago/1"),
        ("/api/caja/categorias/todas", "/api/caja/categorias", "/api/caja/categorias/1"),
        ("/api/empleados/puestos/todos", "/api/empleados/puestos", "/api/empleados/puestos/1"),
    )

    def setUp(self):
        self.previos = app.dependency_overrides.copy()
        self.db = MagicMock()
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.previos)

    def test_sin_jwt_rechaza_lecturas_y_escrituras(self):
        for listado, crear, editar in self.rutas:
            for metodo, ruta in (("get", listado), ("post", crear), ("patch", editar)):
                with self.subTest(ruta=ruta, metodo=metodo):
                    response = getattr(self.client, metodo)(ruta)
                    self.assertEqual(response.status_code, 401)
        self.db.commit.assert_not_called()

    def test_empleado_no_admin_no_puede_administrar_ningun_catalogo(self):
        app.dependency_overrides[get_current_user] = lambda: NS(rol=NS(nombre="Empleado"))
        for listado, crear, editar in self.rutas:
            for metodo, ruta in (("get", listado), ("post", crear), ("patch", editar)):
                with self.subTest(ruta=ruta, metodo=metodo):
                    response = getattr(self.client, metodo)(ruta)
                    self.assertEqual(response.status_code, 403)
        self.db.commit.assert_not_called()
