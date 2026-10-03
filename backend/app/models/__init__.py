"""Importa todos los modelos para registrar sus relaciones en SQLAlchemy."""

from app.models.antena import Antena
from app.models.cliente import Cliente
from app.models.cotizacion import Cotizacion, CotizacionDetalle, Proforma
from app.models.empleado import Empleado
from app.models.evaluacion_visita import EvaluacionVisita, EvaluacionVisitaMaterial
from app.models.instalacion import Instalacion, InstalacionTecnico
from app.models.modulo import Modulo, usuario_modulos
from app.models.plan import Plan
from app.models.puesto_empleado import PuestoEmpleado
from app.models.rol import Rol
from app.models.tipo_instalacion import TipoInstalacion
from app.models.ubicacion import Departamento, Municipio
from app.models.ubicacion_cliente import UbicacionCliente
from app.models.usuario import Usuario
from app.models.visita_tecnica import VisitaTecnica

__all__ = [
    "Antena",
    "Cliente",
    "Cotizacion",
    "CotizacionDetalle",
    "Departamento",
    "Empleado",
    "EvaluacionVisita",
    "EvaluacionVisitaMaterial",
    "Instalacion",
    "InstalacionTecnico",
    "Modulo",
    "Municipio",
    "Plan",
    "Proforma",
    "PuestoEmpleado",
    "Rol",
    "TipoInstalacion",
    "UbicacionCliente",
    "Usuario",
    "VisitaTecnica",
    "usuario_modulos",
]
