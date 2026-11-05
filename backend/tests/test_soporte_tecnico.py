"""Pruebas HTTP/ORM con SQLite en memoria y FK activas: jamás escriben en PostgreSQL.

El esquema de producción se inspeccionó en modo de solo lectura antes de mapearlo.
Esta base efímera permite verificar persistencia, auditoría y rollback sin datos reales.
"""

from datetime import date
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from PIL import Image

from app.main import app
from app.core.database import Base, get_db
from app.modules.auth.services.auth import get_current_user
from app.modules.clientes.models.cliente import Cliente
from app.modules.empleados.models.empleado import Empleado
from app.modules.empleados.models.puesto_empleado import PuestoEmpleado
from app.modules.mapas.models.ubicacion import Departamento, Municipio
from app.modules.soporte_tecnico.models.ticket import CategoriaTicket, Ticket, TicketHistorial
from app.modules.tareas.services.tareas import _support_task, list_tareas
from app.modules.tareas.schemas.tarea import TareaResponse
from app.services.image_uploads import ImageStorageError
from app.modules.usuarios.models.rol import Rol
from app.modules.usuarios.models.usuario import Usuario


class SoporteTecnicoTests(unittest.TestCase):
    """Ejercita contratos reales y consultas SQLAlchemy sin simular las operaciones CRUD."""

    def setUp(self):
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        event.listen(self.engine, "connect", lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"))
        tables = ["roles", "modulos", "usuarios", "usuario_modulos", "departamentos", "municipios",
                  "clientes", "puestos_empleado", "empleados", "categorias_ticket", "tickets", "ticket_historial"]
        Base.metadata.create_all(self.engine, tables=[Base.metadata.tables[name] for name in tables])
        self.db = Session(self.engine, autoflush=False)
        self.db.add_all([
            Rol(id=1, nombre="Empleado"),
            Departamento(id_departamento=1, nombre="Departamento de prueba", estado="Activo"),
            PuestoEmpleado(id_puesto=1, nombre="Técnico", estado="Activo", tiene_funciones_sistema=True),
            PuestoEmpleado(id_puesto=2, nombre="Administración", estado="Activo"),
            PuestoEmpleado(id_puesto=3, nombre="Tecnico", estado="Inactivo"),
            CategoriaTicket(id_categoria=1, nombre="Servicio de Internet", estado="Activo"),
            CategoriaTicket(id_categoria=2, nombre="Cámaras", estado="Activo"),
            CategoriaTicket(id_categoria=3, nombre="Categoría inactiva", estado="Inactivo"),
        ])
        self.db.flush()
        self.db.add(Municipio(id_municipio=1, id_departamento=1, nombre="Municipio de prueba", estado="Activo"))
        self.db.add(Usuario(id=1, nombre="Usuario", apellido="Prueba", username="soporte_test", password_hash="no-es-una-credencial", rol_id=1, activo=True))
        self.db.flush()
        self.db.add_all([
            Cliente(id_cliente=1, id_municipio=1, nombres="Cliente", apellidos="Prueba", telefono="55550000", direccion="Dirección de prueba", estado="Activo"),
            Cliente(id_cliente=2, id_municipio=1, nombres="Cliente", apellidos="Inactivo", telefono="55550001", direccion="Dirección de prueba", estado="Inactivo"),
        ])
        for identifier, puesto, estado in [(1, 1, "Activo"), (2, 1, "Inactivo"), (3, 2, "Activo"), (4, 3, "Activo")]:
            self.db.add(Empleado(id_empleado=identifier, id_puesto=puesto, id_municipio=1,
                                 codigo=f"EMP-{identifier}", nombres="Empleado", apellidos=f"Prueba {identifier}",
                                 tipo_documento="DPI", numero_documento=f"test-{identifier}",
                                 telefono_principal="55551111", direccion="Dirección de prueba",
                                 fecha_ingreso=date(2026, 1, 1), estado=estado))
        self.db.commit()
        self.user = SimpleNamespace(id=1, rol=SimpleNamespace(nombre="Empleado"), empleado=None,
                                    modulos=[SimpleNamespace(codigo="tickets", activo=True)])
        self.previous_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)
        self.payload = {"id_cliente": 1, "id_categoria": 1, "id_tecnico": 1, "canal": "Llamada",
                        "asunto": " Enlace intermitente ", "descripcion": " Revisar conexión ", "observaciones": " Llamar antes "}

    def tearDown(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.previous_overrides)
        self.client.close()
        self.db.close()
        self.engine.dispose()

    def crear(self):
        response = self.client.post("/api/tickets", json=self.payload)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_registro_consulta_edicion_e_historial_persistidos(self):
        created = self.crear()
        self.assertEqual(created["codigo"], "TKT-000001")
        self.assertEqual(created["estado"], "Programada")
        self.assertEqual(created["id_tecnico"], 1)
        self.assertEqual(created["asunto"], "Enlace intermitente")
        self.assertEqual(created["telefono_cliente"], "55550000")
        self.assertEqual(created["historial"][0]["accion"], "Creación")
        self.assertEqual(created["historial"][0]["id_usuario"], self.user.id)
        self.assertIsNotNone(self.db.get(Ticket, created["id_ticket"]))
        updated = self.client.put("/api/tickets/1", json={**self.payload, "asunto": "Nuevo asunto", "id_categoria": 2, "canal": "Presencial"})
        self.assertEqual(updated.status_code, 200, updated.text)
        detail = self.client.get("/api/tickets/1").json()
        self.assertEqual(detail["asunto"], "Nuevo asunto")
        self.assertEqual(detail["categoria"], "Cámaras")
        self.assertEqual(detail["canal"], "Presencial")
        self.assertEqual(detail["id_tecnico"], 1)
        self.assertEqual(len(detail["historial"]), 2)
        self.assertEqual(detail["historial"][1]["accion"], "Edición")
        self.assertIn("asunto", detail["historial"][1]["observacion"])
        self.assertNotIn("password_hash", str(detail))

    def test_elimina_programada_e_historial_sin_huerfanos(self):
        self.crear()
        self.assertEqual(self.client.delete("/api/tickets/1").status_code, 204)
        self.db.expire_all()
        self.assertIsNone(self.db.get(Ticket, 1))
        self.assertEqual(self.db.scalar(select(func.count()).select_from(TicketHistorial)), 0)
        self.assertEqual(self.client.get("/api/tickets/1").status_code, 404)

    def test_estados_no_programados_solo_permiten_consulta(self):
        self.crear()
        for estado in ["En Proceso", "Completada"]:
            with self.subTest(estado=estado):
                ticket = self.db.get(Ticket, 1)
                ticket.estado = estado
                self.db.commit()
                self.assertEqual(self.client.get("/api/tickets/1").status_code, 200)
                self.assertEqual(self.client.put("/api/tickets/1", json=self.payload).status_code, 409)
                self.assertEqual(self.client.delete("/api/tickets/1").status_code, 409)
                self.assertEqual(self.db.scalar(select(func.count()).select_from(TicketHistorial)), 1)

    def test_catalogos_filtran_clientes_categorias_y_tecnicos_reales(self):
        self.assertEqual([row["id_cliente"] for row in self.client.get("/api/tickets/clientes").json()], [1])
        self.assertEqual({row["id_categoria"] for row in self.client.get("/api/tickets/categorias").json()}, {1, 2})
        tecnicos = self.client.get("/api/tickets/tecnicos").json()
        self.assertEqual([row["id_empleado"] for row in tecnicos], [1])
        self.assertNotIn("numero_documento", tecnicos[0])

    def test_rechaza_relaciones_inexistentes_inactivas_y_puesto_no_tecnico(self):
        for field, value in [("id_cliente", 2), ("id_cliente", 99), ("id_categoria", 3), ("id_categoria", 99),
                             ("id_tecnico", 2), ("id_tecnico", 3), ("id_tecnico", 4), ("id_tecnico", 99)]:
            with self.subTest(field=field, value=value):
                response = self.client.post("/api/tickets", json={**self.payload, field: value})
                self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Ticket)), 0)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(TicketHistorial)), 0)

    def test_valida_campos_y_rechaza_estado_codigo_autor_y_evidencia(self):
        for invalid in [{"estado": "Completada"}, {"id_ticket": 15}, {"codigo": "MANUAL"}, {"id_usuario": 9},
                        {"evidencia_foto_ruta": "archivo.webp"}, {"canal": "WhatsApp"}, {"asunto": "  "},
                        {"descripcion": " "}, {"asunto": "a" * 201}, {"id_tecnico": None}]:
            with self.subTest(invalid=invalid):
                self.assertEqual(self.client.post("/api/tickets", json={**self.payload, **invalid}).status_code, 422)

    def test_filtros_y_busqueda_literal(self):
        self.crear()
        for params, expected in [({"buscar": "TKT-000001"}, 1), ({"buscar": "Cliente Prueba"}, 1),
                                 ({"buscar": "intermitente"}, 1), ({"estado": "Programada", "id_categoria": 1, "id_tecnico": 1}, 1),
                                 ({"estado": "Completada"}, 0), ({"id_categoria": 2}, 0), ({"id_tecnico": 2}, 0),
                                 ({"buscar": "%"}, 0), ({"buscar": "' OR 1=1 --"}, 0)]:
            with self.subTest(params=params):
                response = self.client.get("/api/tickets", params=params)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(len(response.json()), expected)
        self.assertEqual(self.client.get("/api/tickets", params={"estado": "Inventado"}).status_code, 422)

    def test_permiso_tickets_en_todas_las_rutas_incluso_administrador_sin_asignacion(self):
        for rol in ["Empleado", "Administrador"]:
            self.user.rol.nombre = rol
            for modulos in [[], [SimpleNamespace(codigo="tickets", activo=False)], [SimpleNamespace(codigo="clientes", activo=True)]]:
                self.user.modulos = modulos
                for method, path in [("GET", ""), ("GET", "/categorias"), ("GET", "/tecnicos"), ("GET", "/clientes"),
                                     ("GET", "/1"), ("POST", ""), ("PUT", "/1"), ("DELETE", "/1")]:
                    with self.subTest(rol=rol, method=method, path=path):
                        response = self.client.request(method, "/api/tickets" + path, json=self.payload if method in {"POST", "PUT"} else None)
                        self.assertEqual(response.status_code, 403, response.text)

    def test_sin_autenticacion_y_ids_invalidos(self):
        app.dependency_overrides.pop(get_current_user)
        self.assertEqual(self.client.get("/api/tickets").status_code, 401)
        app.dependency_overrides[get_current_user] = lambda: self.user
        for path in ["/0", "/-1"]:
            self.assertEqual(self.client.get("/api/tickets" + path).status_code, 422)
        self.assertEqual(self.client.get("/api/tickets/999").status_code, 404)

    def test_fallo_al_confirmar_revierte_creacion_e_historial(self):
        with patch.object(self.db, "commit", side_effect=IntegrityError("commit", {}, Exception("Fallo aislado"))):
            response = self.client.post("/api/tickets", json=self.payload)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Ticket)), 0)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(TicketHistorial)), 0)

    def test_fallo_al_eliminar_revierte_borrado_del_historial(self):
        self.crear()
        with patch.object(self.db, "commit", side_effect=IntegrityError("commit", {}, Exception("Fallo aislado"))):
            response = self.client.delete("/api/tickets/1")
        self.assertEqual(response.status_code, 409)
        self.db.expire_all()
        self.assertIsNotNone(self.db.get(Ticket, 1))
        self.assertEqual(self.db.scalar(select(func.count()).select_from(TicketHistorial)), 1)

    def autenticar_tecnico(self, identifier=1):
        """Identidad de sesión de prueba con acceso a Tareas, sin conceder administración de tickets."""
        self.user.empleado = self.db.get(Empleado, identifier)
        self.user.modulos = [SimpleNamespace(codigo="clientes", activo=True)]

    def imagen(self):
        """Genera una imagen válida exclusivamente en memoria para probar decodificación real."""
        content = BytesIO()
        Image.new("RGB", (3, 3), "blue").save(content, format="PNG")
        return content.getvalue()

    def finalizar(self, content=None, data=None):
        """Invoca el multipart real; la escritura física se sustituye en las pruebas que finalizan."""
        return self.client.post("/api/tickets/1/finalizar", data=data or {
            "trabajo_realizado": " Reparar conexión ", "resultado_solucion": " Servicio restablecido ",
            "observaciones": " Verificado con el cliente ",
        }, files={"evidencia": ("evidencia.png", self.imagen() if content is None else content, "image/png")})

    def test_tecnico_inicia_finaliza_y_ambos_modulos_consultan_mismo_informe(self):
        self.crear()
        self.autenticar_tecnico()
        started = self.client.post("/api/tickets/1/iniciar")
        self.assertEqual(started.status_code, 200, started.text)
        self.assertEqual(started.json()["estado"], "En Proceso")
        self.assertIsNotNone(started.json()["fecha_inicio"])
        self.assertEqual(started.json()["historial"][-1]["accion"], "Inicio de soporte")
        ruta = "uploads/soporte_tecnico/ticket_1_uuid.webp"
        with patch("app.modules.soporte_tecnico.services.tickets.store_image", return_value=(ruta, Path("no-se-escribe.webp"))) as store:
            completed = self.finalizar()
        self.assertEqual(completed.status_code, 200, completed.text)
        detalle = completed.json()
        self.assertEqual(detalle["estado"], "Completada")
        self.assertIsNotNone(detalle["fecha_resolucion"])
        informe = detalle["historial"][-1]
        self.assertEqual(informe["trabajo_realizado"], "Reparar conexión")
        self.assertEqual(informe["resultado_solucion"], "Servicio restablecido")
        self.assertEqual(informe["observacion"], "Verificado con el cliente")
        self.assertEqual(informe["id_usuario"], self.user.id)
        self.assertEqual(informe["evidencia_foto_ruta"], ruta)
        normalizada, directorio, prefijo, identifier = store.call_args.args
        self.assertEqual((directorio, prefijo, identifier), ("soporte_tecnico", "ticket", 1))
        self.assertEqual(Image.open(BytesIO(normalizada)).format, "WEBP")
        self.assertEqual(self.client.get("/api/tickets/1").json(), detalle)
        self.user.modulos = [SimpleNamespace(codigo="tickets", activo=True)]
        self.assertEqual(self.client.get("/api/tickets/1").json(), detalle)
        self.assertEqual(self.client.put("/api/tickets/1", json=self.payload).status_code, 409)
        self.assertEqual(self.client.delete("/api/tickets/1").status_code, 409)

    def test_inicio_bloquea_administracion_y_reintento_no_duplica_historial(self):
        self.crear(); self.autenticar_tecnico()
        self.assertEqual(self.client.post("/api/tickets/1/iniciar").status_code, 200)
        self.assertEqual(self.client.post("/api/tickets/1/iniciar").status_code, 409)
        self.user.modulos.append(SimpleNamespace(codigo="tickets", activo=True))
        self.assertEqual(self.client.put("/api/tickets/1", json=self.payload).status_code, 409)
        self.assertEqual(self.client.delete("/api/tickets/1").status_code, 409)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(TicketHistorial)), 2)

    def test_asignacion_y_puesto_se_exigen_incluso_al_administrador(self):
        self.crear()
        for identifier in [2, 3, 4]:
            self.autenticar_tecnico(identifier)
            self.user.rol.nombre = "Administrador"
            self.assertEqual(self.client.post("/api/tickets/1/iniciar").status_code, 403)
            self.assertEqual(self.finalizar().status_code, 403)
        # Otro técnico activo no puede operar ni leer un ticket ajeno desde Tareas.
        self.autenticar_tecnico(1)
        ticket = self.db.get(Ticket, 1); ticket.id_tecnico = 2; self.db.commit()
        self.assertEqual(self.client.post("/api/tickets/1/iniciar").status_code, 403)
        self.assertEqual(self.finalizar().status_code, 403)
        self.assertEqual(self.client.get("/api/tickets/1").status_code, 404)
        self.assertEqual(self.client.get("/api/tickets").status_code, 403)
        self.assertEqual(self.db.get(Ticket, 1).estado, "Programada")

    def test_requiere_identidad_laboral_permiso_y_puesto_habilitado(self):
        self.crear()
        self.assertEqual(self.client.post("/api/tickets/1/iniciar").status_code, 403)
        self.autenticar_tecnico(); self.user.empleado.puesto.tiene_funciones_sistema = False; self.db.commit()
        self.assertEqual(self.client.post("/api/tickets/1/iniciar").status_code, 403)

    def test_rechaza_falta_de_foto_imagen_corrupta_tamano_e_informe_vacio(self):
        self.crear(); self.autenticar_tecnico(); self.client.post("/api/tickets/1/iniciar")
        with patch("app.modules.soporte_tecnico.services.tickets.store_image") as store:
            response = self.client.post("/api/tickets/1/finalizar", data={"trabajo_realizado": "Trabajo", "resultado_solucion": "Resultado"})
            self.assertEqual(response.status_code, 422)
            for content in [b"", b"archivo que no es imagen", self.imagen()[:20]]:
                self.assertEqual(self.finalizar(content).status_code, 400)
            self.assertEqual(self.finalizar(b"x" * (5 * 1024 * 1024 + 1)).status_code, 413)
            for campo in ["trabajo_realizado", "resultado_solucion"]:
                data = {"trabajo_realizado": "Trabajo", "resultado_solucion": "Resultado", campo: "   "}
                self.assertEqual(self.finalizar(data=data).status_code, 422)
            store.assert_not_called()
        self.assertEqual(self.db.get(Ticket, 1).estado, "En Proceso")
        self.assertEqual(self.db.scalar(select(func.count()).select_from(TicketHistorial)), 2)

    def test_no_finaliza_programada_ni_duplica_cierre_y_foto(self):
        self.crear(); self.autenticar_tecnico()
        with patch("app.modules.soporte_tecnico.services.tickets.store_image", return_value=("uploads/soporte_tecnico/unica.webp", Path("unica.webp"))) as store:
            self.assertEqual(self.finalizar().status_code, 409)
            store.assert_not_called()
            self.client.post("/api/tickets/1/iniciar")
            self.assertEqual(self.finalizar().status_code, 200)
            self.assertEqual(self.finalizar().status_code, 409)
            self.assertEqual(self.client.post("/api/tickets/1/iniciar").status_code, 409)
            store.assert_called_once()
        self.assertEqual(self.db.scalar(select(func.count()).select_from(TicketHistorial)), 3)

    def test_rollback_del_cierre_retira_solo_archivo_nuevo_y_conserva_en_proceso(self):
        self.crear(); self.autenticar_tecnico(); self.client.post("/api/tickets/1/iniciar")
        with (
            patch("app.modules.soporte_tecnico.services.tickets.store_image", return_value=("uploads/soporte_tecnico/nueva.webp", Path("nueva.webp"))),
            patch("app.modules.soporte_tecnico.services.tickets.remove_image_file") as remove,
            patch.object(self.db, "commit", side_effect=IntegrityError("commit", {}, Exception("Fallo aislado"))),
        ):
            self.assertEqual(self.finalizar().status_code, 409)
            remove.assert_called_once_with(Path("nueva.webp"))
        self.assertEqual(self.db.get(Ticket, 1).estado, "En Proceso")
        self.assertIsNone(self.db.get(Ticket, 1).fecha_resolucion)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(TicketHistorial)), 2)

    def test_fallo_de_almacenamiento_no_finaliza(self):
        self.crear(); self.autenticar_tecnico(); self.client.post("/api/tickets/1/iniciar")
        with patch("app.modules.soporte_tecnico.services.tickets.store_image", side_effect=ImageStorageError):
            self.assertEqual(self.finalizar().status_code, 409)
        self.assertEqual(self.db.get(Ticket, 1).estado, "En Proceso")

    def test_proyeccion_unificada_filtra_fk_asignada_y_conserva_completados(self):
        self.crear(); self.autenticar_tecnico()
        ticket = self.db.get(Ticket, 1); ticket.estado = "Completada"; self.db.commit()
        proyectada = _support_task(ticket, current_employee_id=1)
        self.assertEqual(TareaResponse.model_validate(proyectada).tipo, "Soporte Técnico")
        self.assertFalse(proyectada["puede_realizar_acciones"])
        self.assertTrue(proyectada["puede_ver"])
        self.assertFalse(_support_task(ticket, current_employee_id=2)["puede_ver"])
        db = MagicMock()
        def respuesta(rows):
            result = MagicMock(); result.unique.return_value.all.return_value = rows; return result
        db.scalars.side_effect = [respuesta([]), respuesta([]), respuesta([]), respuesta([ticket])]
        tareas = list_tareas(db, self.user.empleado)
        self.assertEqual(tareas, [proyectada])
        query = db.scalars.call_args.args[0].compile()
        self.assertIn("tickets.id_tecnico", str(query))
        self.assertIn(1, query.params.values())


if __name__ == "__main__":
    unittest.main()
