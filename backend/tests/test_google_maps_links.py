"""Pruebas de resolución segura para enlaces compartidos de Google Maps."""

import asyncio
import json
import socket
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException

import app.models  # Registra relaciones ORM antes de importar la aplicación.
from app.main import app
from app.modules.auth.services.auth import get_current_user, require_module_access
from app.modules.mapas.routers.ubicaciones_cliente import resolve_google_maps_link_route
from app.modules.mapas.schemas.google_maps_link import GoogleMapsLinkRequest
from app.modules.mapas.services.google_maps_links import (
    MAX_REDIRECTS,
    GoogleMapsCoordinatesNotFoundError,
    GoogleMapsResolutionError,
    GoogleMapsTimeoutError,
    InvalidGoogleMapsUrlError,
    UnsafeGoogleMapsTargetError,
    _request_google_maps_url,
    _resolve_public_addresses,
    resolve_google_maps_link,
)


ENDPOINT_PATH = "/api/ubicaciones-cliente/resolver-enlace-google-maps"
SHORT_LINK = "https://maps.app.goo.gl/aiYZUsrRzUrRnzqWA?g_st=aw"


async def _post_asgi(payload: dict) -> tuple[int, dict]:
    """Ejecuta una solicitud ASGI sin agregar un cliente HTTP de pruebas."""

    body = json.dumps(payload).encode("utf-8")
    request_sent = False
    messages: list[dict] = []

    async def receive() -> dict:
        nonlocal request_sent
        if not request_sent:
            request_sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        messages.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": ENDPOINT_PATH,
        "raw_path": ENDPOINT_PATH.encode("ascii"),
        "query_string": b"",
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("ascii")),
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
        "root_path": "",
    }
    await app(scope, receive, send)

    start = next(message for message in messages if message["type"] == "http.response.start")
    response_body = b"".join(
        message.get("body", b"")
        for message in messages
        if message["type"] == "http.response.body"
    )
    return start["status"], json.loads(response_body or b"{}")


class GoogleMapsLinkServiceTests(unittest.TestCase):
    """Valida extracción y controles SSRF sin efectuar solicitudes externas."""

    @patch("app.modules.mapas.services.google_maps_links._request_google_maps_url")
    def test_resuelve_enlace_corto_valido_simulado(self, request_url) -> None:
        final_url = (
            "https://www.google.com/maps/place/Propiedad/"
            "@14.743296,-91.132924,18z"
        )
        request_url.side_effect = [(302, final_url), (200, None)]

        result = resolve_google_maps_link(SHORT_LINK)

        self.assertEqual(result.latitud, 14.743296)
        self.assertEqual(result.longitud, -91.132924)
        self.assertEqual(request_url.call_count, 2)

    @patch("app.modules.mapas.services.google_maps_links._request_google_maps_url")
    def test_enlace_explicito_no_realiza_solicitud_externa(self, request_url) -> None:
        result = resolve_google_maps_link(
            "https://www.google.com/maps?q=14.6123457,-90.5234568"
        )

        self.assertEqual((result.latitud, result.longitud), (14.6123457, -90.5234568))
        request_url.assert_not_called()

    def test_rechaza_enlaces_invalidos(self) -> None:
        invalid_urls = (
            "http://maps.app.goo.gl/abc",
            "https://usuario:clave@maps.app.goo.gl/abc",
            "https://maps.app.goo.gl:8443/abc",
            "esto-no-es-una-url",
        )

        for invalid_url in invalid_urls:
            with self.subTest(url=invalid_url), self.assertRaises(
                InvalidGoogleMapsUrlError
            ):
                resolve_google_maps_link(invalid_url)

    def test_rechaza_dominios_similares_o_no_autorizados(self) -> None:
        invalid_domains = (
            "https://maps.app.goo.gl.ejemplo.com/abc",
            "https://google.com.ejemplo.com/maps/@14,-90,18z",
            "https://evil.example/maps/@14,-90,18z",
        )

        for invalid_url in invalid_domains:
            with self.subTest(url=invalid_url), self.assertRaises(
                UnsafeGoogleMapsTargetError
            ):
                resolve_google_maps_link(invalid_url)

    @patch("app.modules.mapas.services.google_maps_links.socket.getaddrinfo")
    def test_rechaza_dns_hacia_direccion_privada_o_local(self, getaddrinfo) -> None:
        getaddrinfo.return_value = [
            (
                socket.AF_INET,
                socket.SOCK_STREAM,
                socket.IPPROTO_TCP,
                "",
                ("127.0.0.1", 443),
            )
        ]

        with self.assertRaises(UnsafeGoogleMapsTargetError):
            _resolve_public_addresses("maps.app.goo.gl")

    @patch("app.modules.mapas.services.google_maps_links._request_google_maps_url")
    def test_rechaza_redireccion_hacia_destino_local(self, request_url) -> None:
        request_url.return_value = (302, "https://127.0.0.1/maps/@14,-90,18z")

        with self.assertRaises(UnsafeGoogleMapsTargetError):
            resolve_google_maps_link(SHORT_LINK)

        request_url.assert_called_once_with(SHORT_LINK)

    @patch("app.modules.mapas.services.google_maps_links._request_google_maps_url")
    def test_rechaza_exceso_de_redirecciones(self, request_url) -> None:
        request_url.side_effect = [
            (302, f"https://maps.app.goo.gl/salto-{index}")
            for index in range(MAX_REDIRECTS + 1)
        ]

        with self.assertRaises(GoogleMapsResolutionError):
            resolve_google_maps_link(SHORT_LINK)

        self.assertEqual(request_url.call_count, MAX_REDIRECTS + 1)

    @patch("app.modules.mapas.services.google_maps_links._request_google_maps_url")
    def test_propaga_tiempo_de_espera_agotado(self, request_url) -> None:
        request_url.side_effect = GoogleMapsTimeoutError

        with self.assertRaises(GoogleMapsTimeoutError):
            resolve_google_maps_link(SHORT_LINK)

    @patch("app.modules.mapas.services.google_maps_links._request_google_maps_url")
    def test_rechaza_url_final_sin_coordenadas(self, request_url) -> None:
        request_url.return_value = (200, None)

        with self.assertRaises(GoogleMapsCoordinatesNotFoundError):
            resolve_google_maps_link(SHORT_LINK)

    @patch("app.modules.mapas.services.google_maps_links._request_pinned_https")
    @patch("app.modules.mapas.services.google_maps_links._resolve_public_addresses")
    def test_conecta_con_las_direcciones_dns_previamente_validadas(
        self,
        resolve_addresses,
        request_pinned,
    ) -> None:
        addresses = [
            (
                socket.AF_INET,
                socket.SOCK_STREAM,
                socket.IPPROTO_TCP,
                ("142.250.0.1", 443),
            )
        ]
        resolve_addresses.return_value = addresses
        request_pinned.return_value = (302, "https://www.google.com/maps")

        _request_google_maps_url(SHORT_LINK)

        request_pinned.assert_called_once()
        self.assertIs(request_pinned.call_args.args[1], addresses)


class GoogleMapsLinkEndpointTests(unittest.TestCase):
    """Verifica contrato HTTP, autenticación, permiso y ausencia de persistencia."""

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_solicitud_sin_autenticacion_responde_401(self) -> None:
        status_code, response = asyncio.run(_post_asgi({"enlace": SHORT_LINK}))

        self.assertEqual(status_code, 401)
        self.assertEqual(response["detail"], "Not authenticated")

    def test_usuario_sin_permiso_mapas_responde_403(self) -> None:
        user = SimpleNamespace(
            rol=SimpleNamespace(nombre="Empleado"),
            modulos=[],
        )
        app.dependency_overrides[get_current_user] = lambda: user

        status_code, response = asyncio.run(_post_asgi({"enlace": SHORT_LINK}))

        self.assertEqual(status_code, 403)
        self.assertEqual(
            response["detail"],
            "No tienes permisos para acceder a este módulo",
        )

    def test_endpoint_declara_jwt_y_permiso_mapas(self) -> None:
        operation = app.openapi()["paths"][ENDPOINT_PATH]["post"]
        self.assertEqual(operation["security"], [{"OAuth2PasswordBearer": []}])

        dependency = require_module_access("mapas")
        without_access = SimpleNamespace(
            rol=SimpleNamespace(nombre="Administrador"),
            modulos=[],
        )
        with self.assertRaises(HTTPException) as context:
            dependency(without_access)
        self.assertEqual(context.exception.status_code, 403)

    @patch("app.modules.mapas.routers.ubicaciones_cliente.resolve_google_maps_link")
    def test_endpoint_exitoso_no_recibe_sesion_ni_guarda_datos(self, resolver) -> None:
        resolver.return_value = {"latitud": 14.743296, "longitud": -91.132924}
        user = SimpleNamespace(
            rol=SimpleNamespace(nombre="Administrador"),
            modulos=[SimpleNamespace(codigo="mapas", activo=True)],
        )

        result = resolve_google_maps_link_route(
            GoogleMapsLinkRequest(enlace=SHORT_LINK),
            user,
        )

        self.assertEqual(result["latitud"], 14.743296)
        resolver.assert_called_once_with(SHORT_LINK)

    @patch("app.modules.mapas.routers.ubicaciones_cliente.resolve_google_maps_link")
    def test_endpoint_traduce_timeout_y_falta_de_coordenadas(self, resolver) -> None:
        user = SimpleNamespace()
        cases = (
            (GoogleMapsTimeoutError(), 504),
            (GoogleMapsCoordinatesNotFoundError(), 422),
        )

        for error, expected_status in cases:
            with self.subTest(status=expected_status):
                resolver.side_effect = error
                with self.assertRaises(HTTPException) as context:
                    resolve_google_maps_link_route(
                        GoogleMapsLinkRequest(enlace=SHORT_LINK),
                        user,
                    )
                self.assertEqual(context.exception.status_code, expected_status)


if __name__ == "__main__":
    unittest.main()
