"""Resolución restringida de enlaces de Google Maps sin persistencia."""

from __future__ import annotations

import http.client
import ipaddress
import re
import socket
import ssl
from decimal import Decimal
from urllib.parse import SplitResult, parse_qs, unquote, urljoin, urlsplit, urlunsplit

from app.modules.mapas.schemas.google_maps_link import GoogleMapsCoordinatesResponse


ALLOWED_GOOGLE_MAPS_HOSTS = frozenset(
    {
        "google.com",
        "maps.app.goo.gl",
        "maps.google.com",
        "www.google.com",
    }
)
REDIRECT_STATUS_CODES = frozenset({301, 302, 303, 307, 308})
MAX_REDIRECTS = 5
MAX_DNS_ADDRESSES = 16
CONNECTION_TIMEOUT_SECONDS = 3.0
RESPONSE_TIMEOUT_SECONDS = 5.0
MAX_URL_LENGTH = 2048
COORDINATE_PARAMETERS = ("q", "query", "ll", "destination", "daddr")
COORDINATE_PAIR_PATTERN = re.compile(
    r"^([+-]?\d{1,3}(?:\.\d+)?)\s*,\s*([+-]?\d{1,3}(?:\.\d+)?)$"
)
PATH_COORDINATE_PATTERN = re.compile(
    r"/@([+-]?\d{1,3}(?:\.\d+)?),([+-]?\d{1,3}(?:\.\d+)?)(?:,|/|$)"
)
DATA_COORDINATE_PATTERN = re.compile(
    r"!3d([+-]?\d{1,3}(?:\.\d+)?)!4d([+-]?\d{1,3}(?:\.\d+)?)(?:!|&|$)"
)


class GoogleMapsLinkError(Exception):
    """Error controlado durante la validación o resolución del enlace."""


class InvalidGoogleMapsUrlError(GoogleMapsLinkError):
    """El enlace no cumple el formato HTTPS permitido."""


class UnsafeGoogleMapsTargetError(GoogleMapsLinkError):
    """El destino podría permitir una solicitud SSRF."""


class GoogleMapsResolutionError(GoogleMapsLinkError):
    """La cadena de redirecciones no pudo resolverse de forma segura."""


class GoogleMapsTimeoutError(GoogleMapsResolutionError):
    """Google Maps no respondió dentro de los tiempos máximos."""


class GoogleMapsCoordinatesNotFoundError(GoogleMapsLinkError):
    """La URL final no contiene coordenadas explícitas."""


def _validate_google_maps_url(url: str) -> tuple[str, SplitResult]:
    """Valida esquema, autoridad, puerto y ruta antes de usar una URL."""

    normalized_url = url.strip()
    if not normalized_url or len(normalized_url) > MAX_URL_LENGTH:
        raise InvalidGoogleMapsUrlError

    try:
        parsed = urlsplit(normalized_url)
        port = parsed.port
    except ValueError as error:
        raise InvalidGoogleMapsUrlError from error

    hostname = (parsed.hostname or "").lower().rstrip(".")
    if (
        parsed.scheme.lower() != "https"
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
    ):
        raise InvalidGoogleMapsUrlError
    if hostname not in ALLOWED_GOOGLE_MAPS_HOSTS:
        raise UnsafeGoogleMapsTargetError

    path = parsed.path or "/"
    if hostname in {"google.com", "www.google.com"} and not (
        path == "/maps" or path.startswith("/maps/")
    ):
        raise UnsafeGoogleMapsTargetError

    # Se reconstruye sin credenciales y con el host normalizado para comparar ciclos.
    normalized_netloc = hostname if port is None else f"{hostname}:{port}"
    normalized_url = urlunsplit(
        ("https", normalized_netloc, path, parsed.query, parsed.fragment)
    )
    return normalized_url, urlsplit(normalized_url)


def _resolve_public_addresses(hostname: str) -> list[tuple[int, int, int, tuple]]:
    """Resuelve A/AAAA y rechaza el host si cualquiera de sus IP no es pública."""

    try:
        records = socket.getaddrinfo(
            hostname,
            443,
            family=socket.AF_UNSPEC,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
    except socket.gaierror as error:
        raise GoogleMapsResolutionError from error

    addresses: list[tuple[int, int, int, tuple]] = []
    seen: set[tuple[int, str]] = set()
    for family, socket_type, protocol, _canonical_name, socket_address in records:
        raw_address = str(socket_address[0]).split("%", maxsplit=1)[0]
        try:
            address = ipaddress.ip_address(raw_address)
        except ValueError as error:
            raise UnsafeGoogleMapsTargetError from error
        if not address.is_global:
            raise UnsafeGoogleMapsTargetError

        key = (family, raw_address)
        if key not in seen:
            seen.add(key)
            addresses.append((family, socket_type, protocol, socket_address))

    if not addresses or len(addresses) > MAX_DNS_ADDRESSES:
        raise GoogleMapsResolutionError
    return addresses


def _request_pinned_https(
    parsed: SplitResult,
    addresses: list[tuple[int, int, int, tuple]],
) -> tuple[int, str | None]:
    """Consulta solo cabeceras útiles mediante una IP ya validada y fijada."""

    hostname = parsed.hostname
    if hostname is None:
        raise InvalidGoogleMapsUrlError

    request_target = urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
    last_error: OSError | ssl.SSLError | None = None
    for family, socket_type, protocol, socket_address in addresses:
        raw_socket = socket.socket(family, socket_type, protocol)
        tls_socket: ssl.SSLSocket | None = None
        connection: http.client.HTTPSConnection | None = None
        response: http.client.HTTPResponse | None = None
        try:
            raw_socket.settimeout(CONNECTION_TIMEOUT_SECONDS)
            raw_socket.connect(socket_address)
            context = ssl.create_default_context()
            tls_socket = context.wrap_socket(raw_socket, server_hostname=hostname)
            tls_socket.settimeout(RESPONSE_TIMEOUT_SECONDS)

            connection = http.client.HTTPSConnection(
                hostname,
                port=443,
                timeout=RESPONSE_TIMEOUT_SECONDS,
                context=context,
            )
            connection.sock = tls_socket
            connection.request(
                "GET",
                request_target,
                headers={
                    "Accept": "text/html",
                    "Connection": "close",
                    "Range": "bytes=0-0",
                    "User-Agent": "SistemaWISP/1.0",
                },
            )
            response = connection.getresponse()
            # El cuerpo no se lee: las coordenadas deben provenir únicamente de URLs.
            return response.status, response.getheader("Location")
        except (TimeoutError, socket.timeout) as error:
            last_error = error
        except (OSError, ssl.SSLError) as error:
            last_error = error
        finally:
            if response is not None:
                response.close()
            if connection is not None:
                connection.close()
            elif tls_socket is not None:
                tls_socket.close()
            else:
                raw_socket.close()

    if isinstance(last_error, (TimeoutError, socket.timeout)):
        raise GoogleMapsTimeoutError from last_error
    raise GoogleMapsResolutionError from last_error


def _request_google_maps_url(url: str) -> tuple[int, str | None]:
    """Valida DNS y evita una segunda resolución al abrir la conexión HTTPS."""

    _normalized_url, parsed = _validate_google_maps_url(url)
    hostname = parsed.hostname
    if hostname is None:
        raise InvalidGoogleMapsUrlError
    addresses = _resolve_public_addresses(hostname)
    return _request_pinned_https(parsed, addresses)


def _coordinate_response(latitude: str, longitude: str) -> GoogleMapsCoordinatesResponse:
    """Convierte y valida rangos sin aproximar ni inventar valores."""

    latitude_value = Decimal(latitude)
    longitude_value = Decimal(longitude)
    if not (Decimal("-90") <= latitude_value <= Decimal("90")):
        raise InvalidGoogleMapsUrlError
    if not (Decimal("-180") <= longitude_value <= Decimal("180")):
        raise InvalidGoogleMapsUrlError
    return GoogleMapsCoordinatesResponse(
        latitud=float(latitude_value),
        longitud=float(longitude_value),
    )


def _extract_explicit_coordinates(url: str) -> GoogleMapsCoordinatesResponse | None:
    """Extrae únicamente pares explícitos de parámetros o rutas conocidas."""

    parsed = urlsplit(url)
    parameters = parse_qs(parsed.query, keep_blank_values=False)
    for parameter in COORDINATE_PARAMETERS:
        for value in parameters.get(parameter, []):
            match = COORDINATE_PAIR_PATTERN.fullmatch(value.strip())
            if match:
                return _coordinate_response(match.group(1), match.group(2))

    decoded_url = unquote(url)
    match = PATH_COORDINATE_PATTERN.search(decoded_url)
    if match is None:
        match = DATA_COORDINATE_PATTERN.search(decoded_url)
    if match is None:
        return None
    return _coordinate_response(match.group(1), match.group(2))


def resolve_google_maps_link(url: str) -> GoogleMapsCoordinatesResponse:
    """Sigue una cantidad acotada de redirecciones y devuelve coordenadas finales."""

    current_url, _parsed = _validate_google_maps_url(url)
    coordinates = _extract_explicit_coordinates(current_url)
    if coordinates is not None:
        return coordinates

    visited = {current_url}
    for redirect_count in range(MAX_REDIRECTS + 1):
        response_status, location = _request_google_maps_url(current_url)
        if response_status in REDIRECT_STATUS_CODES:
            if redirect_count >= MAX_REDIRECTS or not location:
                raise GoogleMapsResolutionError

            next_url, _parsed = _validate_google_maps_url(urljoin(current_url, location))
            if next_url in visited:
                raise GoogleMapsResolutionError
            visited.add(next_url)
            current_url = next_url
            continue

        if not 200 <= response_status < 300:
            raise GoogleMapsResolutionError

        coordinates = _extract_explicit_coordinates(current_url)
        if coordinates is None:
            raise GoogleMapsCoordinatesNotFoundError
        return coordinates

    raise GoogleMapsResolutionError
