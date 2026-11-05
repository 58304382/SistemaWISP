# ==========================================
# IMPORTS Y ROUTERS DE LA API
# ==========================================
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import app.models  # Registra todas las relaciones ORM antes de cargar los routers.
from app.core.config import settings
from app.modules.mapas.routers.antenas import router as antenas_router
from app.modules.auth.routers.auth import router as auth_router
from app.modules.clientes.routers.clientes import router as clientes_router
from app.modules.cotizaciones.routers.cotizaciones import (
    proformas_router,
    router as cotizaciones_router,
)
from app.modules.dashboard.routers.dashboard import router as dashboard_router
from app.modules.empleados.routers.empleados import router as empleados_router
from app.modules.finanzas.routers.caja import router as caja_router
from app.modules.finanzas.routers.cobros import router as cobros_router
from app.modules.instalaciones.routers.instalaciones import router as instalaciones_router
from app.modules.ordenes_trabajo.routers.ordenes_trabajo import (
    router as ordenes_trabajo_router,
)
from app.modules.ordenes_trabajo.routers.tipos_trabajo import router as tipos_trabajo_router
from app.modules.planes.routers.planes import router as planes_router
from app.modules.proveedores.routers.proveedores import router as proveedores_router
from app.modules.servicios.routers.asignaciones_planes import (
    router as asignaciones_planes_router,
)
from app.modules.tareas.routers.tareas import router as tareas_router
from app.modules.soporte_tecnico.routers.tickets import router as tickets_router
from app.modules.visitas_tecnicas.routers.tipos_instalacion import (
    router as tipos_instalacion_router,
)
from app.modules.mapas.routers.ubicaciones_cliente import router as ubicaciones_cliente_router
from app.modules.usuarios.routers.usuarios import router as usuarios_router
from app.modules.visitas_tecnicas.routers.visitas_tecnicas import router as visitas_tecnicas_router


# ==========================================
# ORIGENES LOCALES DEL FRONTEND
# ==========================================
cors_origins = list(
    dict.fromkeys(
        [
            *settings.cors_origins_list,
            "http://localhost:4200",
            "http://127.0.0.1:4200",
        ]
    )
)


app = FastAPI(title="SistemaWISP API", version="1.0.0")

uploads_directory = Path(__file__).resolve().parents[1] / "uploads"
(uploads_directory / "empleados").mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_directory), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# REGISTRO DE ROUTERS
# ==========================================
app.include_router(auth_router)
app.include_router(antenas_router)
app.include_router(asignaciones_planes_router)
app.include_router(caja_router)
app.include_router(clientes_router)
app.include_router(cobros_router)
app.include_router(cotizaciones_router)
app.include_router(dashboard_router)
app.include_router(empleados_router)
app.include_router(instalaciones_router)
app.include_router(ordenes_trabajo_router)
app.include_router(planes_router)
app.include_router(proformas_router)
app.include_router(proveedores_router)
app.include_router(tareas_router)
# Soporte conserva el permiso tickets y no incorpora ejecución técnica desde Tareas.
app.include_router(tickets_router)
app.include_router(tipos_instalacion_router)
app.include_router(tipos_trabajo_router)
app.include_router(ubicaciones_cliente_router)
app.include_router(usuarios_router)
app.include_router(visitas_tecnicas_router)


@app.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}
