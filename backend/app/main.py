# ==========================================
# IMPORTS Y ROUTERS DE LA API
# ==========================================
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.routes.antenas import router as antenas_router
from app.routes.auth import router as auth_router
from app.routes.clientes import router as clientes_router
from app.routes.cotizaciones import proformas_router, router as cotizaciones_router
from app.routes.empleados import router as empleados_router
from app.routes.instalaciones import router as instalaciones_router
from app.routes.planes import router as planes_router
from app.routes.tareas import router as tareas_router
from app.routes.tipos_instalacion import router as tipos_instalacion_router
from app.routes.ubicaciones_cliente import router as ubicaciones_cliente_router
from app.routes.usuarios import router as usuarios_router
from app.routes.visitas_tecnicas import router as visitas_tecnicas_router


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
app.include_router(clientes_router)
app.include_router(cotizaciones_router)
app.include_router(empleados_router)
app.include_router(instalaciones_router)
app.include_router(planes_router)
app.include_router(proformas_router)
app.include_router(tareas_router)
app.include_router(tipos_instalacion_router)
app.include_router(ubicaciones_cliente_router)
app.include_router(usuarios_router)
app.include_router(visitas_tecnicas_router)


@app.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}
