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

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
