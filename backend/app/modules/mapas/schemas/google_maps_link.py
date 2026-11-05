"""Contratos para resolver enlaces compartidos de Google Maps."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


LatitudGoogleMaps = Annotated[float, Field(ge=-90, le=90)]
LongitudGoogleMaps = Annotated[float, Field(ge=-180, le=180)]


class GoogleMapsLinkRequest(BaseModel):
    """Limita el enlace recibido antes de iniciar cualquier acceso de red."""

    model_config = ConfigDict(extra="forbid")

    enlace: str = Field(min_length=1, max_length=2048)


class GoogleMapsCoordinatesResponse(BaseModel):
    """Representa un par de coordenadas explícitas y validado."""

    latitud: LatitudGoogleMaps
    longitud: LongitudGoogleMaps
