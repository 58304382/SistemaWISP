# Imagen base solicitada para el despliegue del backend.
FROM python:3.14-slim

# Evita archivos temporales de Python y conserva los logs sin búfer.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Instala primero las dependencias para aprovechar la caché de construcción.
COPY requirements.txt ./
RUN python -m pip install --upgrade pip \
    && python -m pip install -r requirements.txt

# Ejecuta la API sin privilegios y deja uploads listo para un volumen persistente.
RUN groupadd --gid 10001 sistemawisp \
    && useradd --uid 10001 --gid sistemawisp --no-create-home --shell /usr/sbin/nologin sistemawisp \
    && mkdir -p /app/uploads \
    && chown sistemawisp:sistemawisp /app/uploads

COPY app ./app

USER sistemawisp

EXPOSE 8000

# Conserva el punto de entrada actual de FastAPI y escucha fuera del contenedor.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
