"""Rutas protegidas del modulo de instalaciones."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status

from app.core.database import get_db
from app.modules.usuarios.models.usuario import Usuario
from app.modules.instalaciones.schemas.instalacion import (
    EncargadoUpdate,
    EquipoTecnicoUpdate,
    EstadoInstalacion,
    InstalacionCreate,
    InstalacionResponse,
    InstalacionUpdate,
    TecnicoInstalacionResponse,
    VisitaProgramableResponse,
)
from app.modules.instalaciones.schemas.reporte import (
    PeriodoReporteInstalaciones,
    ReporteInstalacionesResponse,
)
from app.modules.auth.services.auth import get_current_employee, require_active_system_employee, require_module_access
from app.modules.finanzas.services.cobros import CobroInstalacionInconsistenteError
from app.services.image_uploads import (
    ImagePathError,
    ImageStorageError,
    ImageTooLargeError,
    InvalidImageError,
    read_image,
)
from app.modules.instalaciones.services.instalaciones import (
    ClienteInactivoError,
    ClienteNotFoundError,
    EmpleadoInactivoError,
    EmpleadoNotFoundError,
    EmpleadoSinPuestoTecnicoError,
    EstadoInstalacionError,
    InstalacionConflictError,
    InstalacionNoAsignadaError,
    TecnicoNoAsignadoError,
    UbicacionInvalidaError,
    UbicacionNotFoundError,
    VisitaInvalidaError,
    VisitaNotFoundError,
    completar_instalacion,
    create_instalacion,
    delete_instalacion,
    get_instalacion,
    get_instalacion_model,
    iniciar_instalacion,
    list_instalaciones,
    list_tecnicos_activos,
    listar_visitas_programables,
    replace_tecnicos,
    set_encargado,
    update_instalacion,
)
from app.modules.instalaciones.services.reportes import generar_reporte_instalaciones


router = APIRouter(prefix="/api/instalaciones", tags=["instalaciones"])

InstalacionesUser = Annotated[Usuario, Depends(require_module_access("clientes"))]


def require_instalaciones_administrator(current_user: InstalacionesUser) -> Usuario:
    # La administracion de instalaciones conserva su restriccion por rol.
    if current_user.rol.nombre != "Administrador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere el rol Administrador",
        )
    return current_user


InstalacionesAdministrator = Annotated[
    Usuario, Depends(require_instalaciones_administrator)
]


def require_instalaciones_operator(current_user: InstalacionesUser) -> Usuario:
    """Conserva Administrador y admite la identidad laboral activa del tecnico.

    El servicio valida la asignacion tras bloquear la instalacion; nunca acepta
    un id_empleado proporcionado por Angular.
    """

    if current_user.rol.nombre != "Administrador":
        require_active_system_employee(get_current_employee(current_user))
    return current_user


InstalacionesOperator = Annotated[Usuario, Depends(require_instalaciones_operator)]


def _installation_or_404(db, id_instalacion: int):
    installation = get_instalacion_model(db, id_instalacion)
    if installation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Instalacion no encontrada",
        )
    return installation


def _domain_http_error(error: Exception) -> HTTPException:
    if isinstance(error, ClienteNotFoundError):
        return HTTPException(status_code=404, detail="Cliente no encontrado")
    if isinstance(error, ClienteInactivoError):
        return HTTPException(status_code=400, detail="El cliente debe estar activo")
    if isinstance(error, VisitaNotFoundError):
        return HTTPException(status_code=404, detail="Visita tecnica no encontrada")
    if isinstance(error, VisitaInvalidaError):
        return HTTPException(
            status_code=400,
            detail="La visita debe pertenecer al cliente, estar Completada y tener cotizacion COMPLETADA",
        )
    if isinstance(error, UbicacionNotFoundError):
        return HTTPException(status_code=404, detail="Ubicacion del cliente no encontrada")
    if isinstance(error, UbicacionInvalidaError):
        return HTTPException(
            status_code=400,
            detail="La ubicacion debe pertenecer al cliente y estar Activa",
        )
    if isinstance(error, EmpleadoNotFoundError):
        return HTTPException(status_code=404, detail="Empleado no encontrado")
    if isinstance(error, EmpleadoInactivoError):
        return HTTPException(status_code=400, detail="El empleado debe estar activo")
    if isinstance(error, EmpleadoSinPuestoTecnicoError):
        return HTTPException(
            status_code=400,
            detail="El empleado debe tener un puesto activo de Tecnico",
        )
    if isinstance(error, InstalacionNoAsignadaError):
        return HTTPException(status_code=403, detail="La instalacion esta asignada a otro equipo tecnico")
    if isinstance(error, TecnicoNoAsignadoError):
        return HTTPException(
            status_code=400, detail="El encargado debe pertenecer al equipo asignado"
        )
    if isinstance(error, EstadoInstalacionError):
        return HTTPException(
            status_code=409,
            detail="El estado actual de la instalacion no permite esta operacion",
        )
    if isinstance(error, InstalacionConflictError):
        return HTTPException(
            status_code=409,
            detail="La instalacion tiene dependencias o datos asignados en conflicto",
        )
    if isinstance(error, CobroInstalacionInconsistenteError):
        return HTTPException(
            status_code=409,
            detail="La instalacion ya posee un cobro incompatible",
        )
    raise error


def _image_http_error(error: Exception) -> HTTPException:
    if isinstance(error, ImageTooLargeError):
        return HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="La evidencia excede el tamano permitido",
        )
    if isinstance(error, InvalidImageError):
        return HTTPException(status_code=400, detail="La evidencia no es una imagen valida")
    if isinstance(error, (ImageStorageError, ImagePathError)):
        return HTTPException(status_code=409, detail="No se pudo almacenar la evidencia")
    raise error


DOMAIN_ERRORS = (
    ClienteNotFoundError,
    ClienteInactivoError,
    VisitaNotFoundError,
    VisitaInvalidaError,
    UbicacionNotFoundError,
    UbicacionInvalidaError,
    EmpleadoNotFoundError,
    EmpleadoInactivoError,
    EmpleadoSinPuestoTecnicoError,
    TecnicoNoAsignadoError,
    EstadoInstalacionError,
    InstalacionConflictError,
    InstalacionNoAsignadaError,
    CobroInstalacionInconsistenteError,
)
IMAGE_ERRORS = (ImageTooLargeError, InvalidImageError, ImageStorageError, ImagePathError)


@router.get("/tecnicos", response_model=list[TecnicoInstalacionResponse])
def get_tecnicos(
    current_user: InstalacionesUser,
    db=Depends(get_db),
) -> list[TecnicoInstalacionResponse]:
    return list_tecnicos_activos(db)


@router.get("", response_model=list[InstalacionResponse])
def get_instalaciones(
    current_user: InstalacionesOperator,
    estado: EstadoInstalacion | None = Query(default=None),
    db=Depends(get_db),
) -> list[InstalacionResponse]:
    # Evita eludir la autorizacion del detalle consultando el listado enriquecido.
    return list_instalaciones(db, estado, id_empleado=(
        None if current_user.rol.nombre == "Administrador" else current_user.empleado.id_empleado
    ))


@router.get("/visitas-disponibles", response_model=list[VisitaProgramableResponse])
def get_visitas_disponibles(
    administrator: InstalacionesAdministrator,
    id_cliente: int = Query(..., gt=0),
    db=Depends(get_db),
) -> list[VisitaProgramableResponse]:
    """Expone el contexto tecnico/comercial bajo el permiso actual de Instalaciones."""

    try:
        return listar_visitas_programables(db, id_cliente)
    except DOMAIN_ERRORS as error:
        raise _domain_http_error(error) from None


@router.get("/reporte", response_model=ReporteInstalacionesResponse)
def get_reporte_instalaciones(
    administrator: InstalacionesAdministrator,
    periodo: PeriodoReporteInstalaciones = Query(...),
    fecha: date = Query(...),
    db=Depends(get_db),
) -> ReporteInstalacionesResponse:
    """Genera la vista administrativa sin crear archivos ni modificar datos."""

    nombre = f"{administrator.nombre} {administrator.apellido}".strip()
    usuario = f"{nombre} ({administrator.username})"
    return generar_reporte_instalaciones(db, periodo, fecha, usuario)


@router.get("/{id_instalacion}", response_model=InstalacionResponse)
def get_instalacion_by_id(
    id_instalacion: int,
    current_user: InstalacionesOperator,
    db=Depends(get_db),
) -> InstalacionResponse:
    """Lectura autorizada, independiente de que se pueda iniciar o completar la instalacion."""
    installation = get_instalacion(db, id_instalacion)
    if installation is None:
        raise HTTPException(status_code=404, detail="Instalacion no encontrada")
    if current_user.rol.nombre != "Administrador" and not any(
        tecnico["id_empleado"] == current_user.empleado.id_empleado
        for tecnico in installation["tecnicos"]
    ):
        raise _domain_http_error(InstalacionNoAsignadaError())
    return installation


@router.post("", response_model=InstalacionResponse, status_code=status.HTTP_201_CREATED)
def create_instalacion_route(
    data: InstalacionCreate,
    administrator: InstalacionesAdministrator,
    db=Depends(get_db),
) -> InstalacionResponse:
    try:
        return create_instalacion(db, data)
    except DOMAIN_ERRORS as error:
        db.rollback()
        raise _domain_http_error(error) from None


@router.patch("/{id_instalacion}", response_model=InstalacionResponse)
def update_instalacion_route(
    id_instalacion: int,
    data: InstalacionUpdate,
    administrator: InstalacionesAdministrator,
    db=Depends(get_db),
) -> InstalacionResponse:
    installation = _installation_or_404(db, id_instalacion)
    try:
        return update_instalacion(db, installation, data)
    except DOMAIN_ERRORS as error:
        db.rollback()
        raise _domain_http_error(error) from None


@router.put("/{id_instalacion}/tecnicos", response_model=InstalacionResponse)
def replace_tecnicos_route(
    id_instalacion: int,
    data: EquipoTecnicoUpdate,
    administrator: InstalacionesAdministrator,
    db=Depends(get_db),
) -> InstalacionResponse:
    installation = _installation_or_404(db, id_instalacion)
    try:
        return replace_tecnicos(db, installation, data)
    except DOMAIN_ERRORS as error:
        db.rollback()
        raise _domain_http_error(error) from None


@router.patch("/{id_instalacion}/encargado", response_model=InstalacionResponse)
def set_encargado_route(
    id_instalacion: int,
    data: EncargadoUpdate,
    administrator: InstalacionesAdministrator,
    db=Depends(get_db),
) -> InstalacionResponse:
    installation = _installation_or_404(db, id_instalacion)
    try:
        return set_encargado(db, installation, data.id_empleado)
    except DOMAIN_ERRORS as error:
        db.rollback()
        raise _domain_http_error(error) from None


@router.post("/{id_instalacion}/iniciar", response_model=InstalacionResponse)
def iniciar_instalacion_route(
    id_instalacion: int,
    current_user: InstalacionesOperator,
    db=Depends(get_db),
) -> InstalacionResponse:
    installation = _installation_or_404(db, id_instalacion)
    try:
        return iniciar_instalacion(
            db, installation,
            None if current_user.rol.nombre == "Administrador" else current_user.empleado.id_empleado,
        )
    except DOMAIN_ERRORS as error:
        db.rollback()
        raise _domain_http_error(error) from None


@router.post("/{id_instalacion}/completar", response_model=InstalacionResponse)
async def completar_instalacion_route(
    id_instalacion: int,
    observaciones_tecnicas: Annotated[str, Form(min_length=1)],
    evidencia: Annotated[UploadFile, File(...)],
    current_user: InstalacionesOperator,
    db=Depends(get_db),
) -> InstalacionResponse:
    installation = _installation_or_404(db, id_instalacion)
    try:
        image_content = await read_image(evidencia)
        return completar_instalacion(
            db, installation, observaciones_tecnicas, image_content,
            None if current_user.rol.nombre == "Administrador" else current_user.empleado.id_empleado,
        )
    except DOMAIN_ERRORS as error:
        db.rollback()
        raise _domain_http_error(error) from None
    except IMAGE_ERRORS as error:
        db.rollback()
        raise _image_http_error(error) from None
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(error)) from None


@router.delete("/{id_instalacion}", response_model=InstalacionResponse)
def delete_instalacion_route(
    id_instalacion: int,
    administrator: InstalacionesAdministrator,
    db=Depends(get_db),
) -> InstalacionResponse:
    installation = _installation_or_404(db, id_instalacion)
    try:
        return delete_instalacion(db, installation)
    except DOMAIN_ERRORS as error:
        db.rollback()
        raise _domain_http_error(error) from None
