"""Contratos Pydantic de Órdenes de Trabajo, equipo y procesos técnicos."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# Los estados replican el flujo de Visitas Técnicas e Instalaciones; el catálogo
# de PostgreSQL no aplica un CHECK, por lo que la restricción vive en el servicio.
EstadoOrden = Literal["Programada", "En Proceso", "Completada"]


class EquipoOrdenInput(BaseModel):
    """Equipo físico recibido con la orden; los textos opcionales se normalizan."""

    model_config = ConfigDict(extra="forbid")

    tipo_equipo: str = Field(min_length=1, max_length=80)
    marca: str | None = Field(default=None, max_length=80)
    modelo: str | None = Field(default=None, max_length=100)
    numero_serie: str | None = Field(default=None, max_length=100)
    problema_reportado: str = Field(min_length=1)
    accesorios_recibidos: str | None = None
    estado_recepcion: str | None = None
    observaciones: str | None = None

    @field_validator("tipo_equipo", "problema_reportado")
    @classmethod
    def texto_requerido_no_vacio(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El valor no puede estar vacío")
        return value

    @field_validator(
        "marca",
        "modelo",
        "numero_serie",
        "accesorios_recibidos",
        "estado_recepcion",
        "observaciones",
    )
    @classmethod
    def texto_opcional_normalizado(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class OrdenTrabajoCreate(BaseModel):
    """Alta de orden; código, fecha de recepción, estado y autor se derivan."""

    model_config = ConfigDict(extra="forbid")

    id_cliente: int = Field(gt=0)
    id_tipo_trabajo: int = Field(gt=0)
    id_empleado: int = Field(gt=0)
    titulo: str = Field(min_length=1, max_length=150)
    descripcion: str = Field(min_length=1)
    fecha_estimada: date | None = None
    equipo: list[EquipoOrdenInput] = Field(default_factory=list, max_length=20)

    @field_validator("titulo", "descripcion")
    @classmethod
    def texto_requerido_no_vacio(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El campo no puede estar vacío")
        return value


class OrdenTrabajoUpdate(BaseModel):
    """Edición permitida únicamente mientras la orden esté Programada."""

    model_config = ConfigDict(extra="forbid")

    id_cliente: int | None = Field(default=None, gt=0)
    id_tipo_trabajo: int | None = Field(default=None, gt=0)
    id_empleado: int | None = Field(default=None, gt=0)
    titulo: str | None = Field(default=None, min_length=1, max_length=150)
    descripcion: str | None = Field(default=None, min_length=1)
    fecha_estimada: date | None = None
    equipo: list[EquipoOrdenInput] | None = Field(default=None, max_length=20)

    @model_validator(mode="before")
    @classmethod
    def campos_requeridos_no_nulos(cls, data: object) -> object:
        # Los campos son opcionales para PATCH, pero no pueden anularse cuando el
        # cliente decide enviarlos porque las reglas de la orden los requieren.
        if isinstance(data, dict):
            requeridos = {
                "id_cliente",
                "id_tipo_trabajo",
                "id_empleado",
                "titulo",
                "descripcion",
            }
            if any(data.get(campo) is None for campo in requeridos & data.keys()):
                raise ValueError("Los campos obligatorios no pueden ser nulos")
        return data

    @field_validator("titulo", "descripcion")
    @classmethod
    def texto_opcional_no_vacio(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("El campo no puede quedar vacío")
        return value


class EvaluacionMaterialInput(BaseModel):
    """Material o repuesto requerido en la evaluación técnica de una orden."""

    model_config = ConfigDict(extra="forbid")

    descripcion: str = Field(min_length=1, max_length=200)
    cantidad: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    unidad: str | None = Field(default=None, max_length=30)

    @field_validator("descripcion")
    @classmethod
    def descripcion_no_vacia(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("La descripción no puede estar vacía")
        return value

    @field_validator("unidad")
    @classmethod
    def unidad_normalizada(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class EvaluacionOrdenRegistro(BaseModel):
    """Diagnóstico, trabajo propuesto, materiales y observaciones de la evaluación."""

    model_config = ConfigDict(extra="forbid")

    diagnostico: str = Field(min_length=1)
    trabajo_propuesto: str = Field(min_length=1)
    observaciones: str | None = None
    materiales: list[EvaluacionMaterialInput] = Field(default_factory=list, max_length=50)

    @field_validator("diagnostico", "trabajo_propuesto")
    @classmethod
    def texto_no_vacio(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El campo no puede estar vacío")
        return value

    @field_validator("observaciones")
    @classmethod
    def observaciones_normalizadas(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class EvaluacionOrdenUpdate(BaseModel):
    """Actualización parcial de una evaluación ya registrada."""

    model_config = ConfigDict(extra="forbid")

    diagnostico: str | None = Field(default=None, min_length=1)
    trabajo_propuesto: str | None = Field(default=None, min_length=1)
    observaciones: str | None = None
    materiales: list[EvaluacionMaterialInput] | None = Field(default=None, max_length=50)

    @field_validator("diagnostico", "trabajo_propuesto")
    @classmethod
    def texto_opcional_no_vacio(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("El campo no puede quedar vacío")
        return value

    @field_validator("observaciones")
    @classmethod
    def observaciones_normalizadas(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class FinalizacionOrdenRegistro(BaseModel):
    """Datos del cierre técnico; su persistencia queda bloqueada hasta contar con
    aprobación comercial real (regla de negocio vigente)."""

    model_config = ConfigDict(extra="forbid")

    trabajo_realizado: str = Field(min_length=1)
    resultado_solucion: str = Field(min_length=1)
    observaciones_finales: str | None = None
    evidencia_ruta: str | None = Field(default=None, max_length=500)

    @field_validator("trabajo_realizado", "resultado_solucion")
    @classmethod
    def texto_no_vacio(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El campo no puede estar vacío")
        return value


class EquipoOrdenResponse(BaseModel):
    id_equipo: int
    id_orden: int
    tipo_equipo: str
    marca: str | None
    modelo: str | None
    numero_serie: str | None
    problema_reportado: str
    accesorios_recibidos: str | None
    estado_recepcion: str | None
    observaciones: str | None


class EvaluacionMaterialResponse(BaseModel):
    id_detalle: int
    id_evaluacion: int
    descripcion: str
    cantidad: Decimal
    unidad: str | None


class EvaluacionOrdenResponse(BaseModel):
    id_evaluacion: int
    id_orden: int
    fecha_evaluacion: datetime
    diagnostico: str
    trabajo_propuesto: str
    observaciones: str | None
    materiales: list[EvaluacionMaterialResponse]


class FinalizacionOrdenResponse(BaseModel):
    id_finalizacion: int
    id_orden: int
    trabajo_realizado: str
    resultado_solucion: str
    observaciones_finales: str | None
    fecha_hora: datetime
    evidencia_ruta: str | None


class OrdenTrabajoResponse(BaseModel):
    """Respuesta enriquecida de la orden con sus procesos asociados."""

    id_orden: int
    codigo: str
    id_cliente: int
    nombre_cliente: str
    id_tipo_trabajo: int
    nombre_tipo_trabajo: str
    id_empleado: int
    nombre_tecnico: str
    titulo: str
    descripcion: str
    fecha_recepcion: datetime
    fecha_estimada: date | None
    estado: EstadoOrden
    fecha_inicio: datetime | None
    equipo: list[EquipoOrdenResponse]
    evaluacion: EvaluacionOrdenResponse | None
    finalizacion: FinalizacionOrdenResponse | None
    puede_editar: bool
    puede_eliminar: bool
    # La aceptación comercial real (cotización ACEPTADA) habilita la reparación
    # y por tanto las acciones de continuar trabajo y trabajo terminado.
    reparacion_autorizada: bool = False
    # La cotización de la orden fue RECHAZADA: el técnico ve «Trabajo rechazado»
    # y la reparación permanece bloqueada hasta una nueva aceptación comercial.
    trabajo_rechazado: bool = False
    # Bandera informativa: la finalización permanece bloqueada mientras no exista
    # una aprobación comercial real que respalde la reparación. El servicio la
    # deriva de reparacion_autorizada; el default solo cubre respuestas parciales.
    aprobacion_comercial_pendiente: bool = True