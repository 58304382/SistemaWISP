"""Importa todos los modelos para registrar sus relaciones en SQLAlchemy."""

from app.modules.mapas.models.antena import Antena
from app.modules.clientes.models.cliente import Cliente
from app.modules.cotizaciones.models.cotizacion import (
    ConfiguracionDocumentoComercial,
    Cotizacion,
    CotizacionDetalle,
    Proforma,
)
from app.modules.empleados.models.empleado import Empleado
from app.modules.finanzas.models.caja import (
    ArqueoCaja,
    CategoriaCaja,
    EntregaCobrador,
    EntregaPagoDetalle,
    MovimientoCaja,
    SesionCaja,
)
from app.modules.finanzas.models.cobros import (
    Cobro,
    ComprobanteCobro,
    GestionCobro,
    MetodoPago,
    Pago,
    PagoDetalle,
)
from app.modules.finanzas.models.comprobante_configuracion import (
    ConfiguracionComprobante,
)
from app.modules.visitas_tecnicas.models.evaluacion_visita import (
    EvaluacionVisita,
    EvaluacionVisitaMaterial,
)
from app.modules.ordenes_trabajo.models.orden_trabajo import (
    EquipoOrden,
    EvaluacionOrden,
    EvaluacionOrdenMaterial,
    FinalizacionOrden,
    OrdenTrabajo,
)
from app.modules.ordenes_trabajo.models.tipo_trabajo import TipoTrabajo
from app.modules.instalaciones.models.instalacion import Instalacion, InstalacionTecnico
from app.modules.usuarios.models.modulo import Modulo, usuario_modulos
from app.modules.planes.models.plan import Plan
from app.modules.proveedores.models.proveedor import Proveedor
from app.modules.servicios.models.asignacion_plan import ServicioAsignacionPlan
from app.modules.soporte_tecnico.models.ticket import CategoriaTicket, Ticket, TicketHistorial
from app.modules.empleados.models.puesto_empleado import PuestoEmpleado
from app.modules.usuarios.models.rol import Rol
from app.modules.visitas_tecnicas.models.tipo_instalacion import TipoInstalacion
from app.modules.mapas.models.ubicacion import Departamento, Municipio
from app.modules.mapas.models.ubicacion_cliente import UbicacionCliente
from app.modules.usuarios.models.usuario import Usuario
from app.modules.visitas_tecnicas.models.visita_tecnica import VisitaTecnica

__all__ = [
    "Antena",
    "ArqueoCaja",
    "CategoriaCaja",
    "CategoriaTicket",
    "Cliente",
    "Cobro",
    "ComprobanteCobro",
    "ConfiguracionComprobante",
    "ConfiguracionDocumentoComercial",
    "Cotizacion",
    "CotizacionDetalle",
    "Departamento",
    "Empleado",
    "EntregaCobrador",
    "EntregaPagoDetalle",
    "EquipoOrden",
    "EvaluacionOrden",
    "EvaluacionOrdenMaterial",
    "EvaluacionVisita",
    "EvaluacionVisitaMaterial",
    "FinalizacionOrden",
    "Instalacion",
    "InstalacionTecnico",
    "GestionCobro",
    "MetodoPago",
    "Modulo",
    "MovimientoCaja",
    "Municipio",
    "OrdenTrabajo",
    "Plan",
    "Pago",
    "PagoDetalle",
    "Proforma",
    "Proveedor",
    "PuestoEmpleado",
    "Rol",
    "SesionCaja",
    "ServicioAsignacionPlan",
    "TipoInstalacion",
    "TipoTrabajo",
    "Ticket",
    "TicketHistorial",
    "UbicacionCliente",
    "Usuario",
    "VisitaTecnica",
    "usuario_modulos",
]
