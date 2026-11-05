"""Integración de login, JWT y permisos sin alterar usuarios reales de PostgreSQL."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS
import unittest
from unittest.mock import MagicMock

import jwt
from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_password_hash


class LoginAutorizacionTests(unittest.TestCase):
    catalogos = (
        "/api/tipos-instalacion/todos", "/api/tipos-trabajo", "/api/tickets/categorias/todas",
        "/api/cobros/metodos-pago/todos", "/api/caja/categorias/todas", "/api/empleados/puestos/todos",
    )

    @classmethod
    def setUpClass(cls):
        # Hash real de una credencial sintética; no se consulta ni cambia una contraseña real.
        cls.clave = "clave-sintetica-para-pruebas"
        cls.hash_prueba = get_password_hash(cls.clave)

    def setUp(self):
        self.previos = app.dependency_overrides.copy()
        self.usuario = NS(
            id=901, username="admin_prueba", nombre="Administrador", apellido="Prueba",
            activo=True, rol_id=1, rol=NS(id=1, nombre="Administrador"),
            password_hash=self.hash_prueba, created_at=None, updated_at=None, modulos=[],
            empleado=NS(id_empleado=801, codigo="EMP-PRUEBA", nombres="Administrador", apellidos="Prueba",
                        estado="Activo", puesto=NS(id_puesto=3, nombre="Atención al cliente", estado="Activo", tiene_funciones_sistema=True)),
        )
        self.db = MagicMock()
        self.db.scalar.return_value = self.usuario
        self.db.scalars.return_value.all.return_value = []
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.previos)
        self.db.commit.assert_not_called()

    def _login(self):
        response = self.client.post("/api/auth/login", json={"username": self.usuario.username, "password": self.clave})
        self.assertEqual(response.status_code, 200)
        return {"Authorization": "Bearer " + response.json()["access_token"]}

    def test_login_admin_vinculado_valida_password_jwt_y_me(self):
        headers = self._login()
        response = self.client.get("/api/auth/me", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["rol"]["nombre"], "Administrador")
        self.assertEqual(response.json()["empleado"]["estado"], "Activo")
        self.assertNotIn("password_hash", response.text)
        self.assertNotIn(self.hash_prueba, response.text)

    def test_admin_vinculado_accede_a_los_seis_catalogos_y_usuarios(self):
        headers = self._login()
        for ruta in (*self.catalogos, "/api/usuarios/modulos", "/api/empleados/puestos"):
            with self.subTest(ruta=ruta):
                self.assertEqual(self.client.get(ruta, headers=headers).status_code, 200)

    def test_rol_de_postgresql_prevalece_sobre_un_claim_admin_anterior(self):
        headers = self._login()
        # Simula recarga de una fila cuyo rol cambió, sin modificar la base real.
        self.usuario.rol = NS(id=2, nombre="Empleado")
        self.usuario.rol_id = 2
        for ruta in self.catalogos:
            with self.subTest(ruta=ruta):
                self.assertEqual(self.client.get(ruta, headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/api/auth/me", headers=headers).status_code, 200)

    def test_password_incorrecto_e_inactivo_responden_401_sin_token(self):
        response = self.client.post("/api/auth/login", json={"username": self.usuario.username, "password": "incorrecta"})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("access_token", response.json())
        self.usuario.activo = False
        response = self.client.post("/api/auth/login", json={"username": self.usuario.username, "password": self.clave})
        self.assertEqual(response.status_code, 401)

    def test_token_invalido_o_expirado_responde_401(self):
        expirado = jwt.encode(
            {"sub": "901", "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
            settings.jwt_secret_key, algorithm=settings.jwt_algorithm,
        )
        for token in ("token-invalido", expirado):
            with self.subTest(tipo="expirado" if token == expirado else "invalido"):
                self.assertEqual(self.client.get("/api/auth/me", headers={"Authorization": "Bearer " + token}).status_code, 401)

    def test_usuario_revocado_no_se_autentica_con_un_jwt_vigente(self):
        headers = self._login()
        self.db.scalar.return_value = None
        self.assertEqual(self.client.get("/api/auth/me", headers=headers).status_code, 401)
