# ==========================================
# COMPILACION DE ANGULAR
# ==========================================
FROM node:22-alpine AS build

WORKDIR /app

# Se instalan primero las dependencias para aprovechar la cache de Docker.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ==========================================
# SERVIDOR WEB DE PRODUCCION
# ==========================================
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html

# La imagen oficial procesa esta plantilla al iniciar, cuando Dokploy ya inyecto el entorno.
ENV NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html
COPY runtime-config.js.template /etc/nginx/templates/runtime-config.js.template

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
