# SistemaWISP — Instrucciones para Agentes

## 1. OBJETIVO DE ESTE ARCHIVO

Este archivo contiene las reglas permanentes que todo agente de desarrollo
debe respetar al trabajar en SistemaWISP.

Antes de modificar código, base de datos, configuración o estructura del
proyecto, leer y respetar estas instrucciones.

REGLA PRINCIPAL:

- Analizar primero.
- Reutilizar lo existente.
- No inventar estructuras.
- Modificar únicamente lo solicitado.
- No realizar tareas adicionales.
- Preservar funcionalidades existentes.
- Reportar cualquier problema fuera del alcance y esperar autorización.

---

## 2. ARQUITECTURA REAL DEL PROYECTO

SistemaWISP utiliza:

- Frontend: Angular
- Backend: Python + FastAPI
- ORM: SQLAlchemy
- Base de datos: PostgreSQL
- Autenticación: JWT
- API REST
- Roles del sistema: Administrador y Empleado

`frontend/` y `backend/` son aplicaciones independientes.

No existe un package.json ni un task runner general en la raíz.

NO cambiar esta arquitectura sin autorización explícita.

NO introducir tecnologías alternativas innecesarias.

---

## 3. ESTRUCTURA DEL FRONTEND

La aplicación Angular está ubicada en:

`frontend/`

Bootstrap:

`frontend/src/main.ts`

Rutas:

`frontend/src/app/app.routes.ts`

Código compartido de API, autenticación, modelos y servicios:

`frontend/src/app/core/`

Funcionalidades principales:

`frontend/src/app/features/`

Mantener la arquitectura Angular existente.

Antes de crear un nuevo componente, servicio, modelo o ruta, comprobar si
ya existe una implementación reutilizable.

NO duplicar componentes, servicios ni rutas existentes.

---

## 4. ESTRUCTURA DEL BACKEND

La aplicación FastAPI está ubicada en:

`backend/`

Punto de entrada:

`backend/app/main.py`

Mantener la separación existente:

`backend/app/models/`
- Representación ORM de PostgreSQL.

`backend/app/schemas/`
- Validación de entrada y salida.

`backend/app/services/`
- Lógica de negocio y acceso a datos.

`backend/app/routes/`
- Endpoints HTTP.

`backend/app/core/`
- Configuración, seguridad y funciones compartidas.

`backend/migrations/`
- Migraciones SQL del proyecto.

No trasladar lógica entre capas innecesariamente.

Antes de modificar una funcionalidad backend revisar, cuando corresponda:

1. model
2. schema
3. service
4. route
5. relaciones
6. validaciones
7. permisos
8. pruebas relacionadas

---

## 5. CONTROL ESTRICTO DEL ALCANCE

ESTA ES UNA REGLA CRÍTICA.

Trabajar ÚNICAMENTE en la tarea solicitada.

NO realizar automáticamente:

- refactorizaciones adicionales;
- optimizaciones no solicitadas;
- rediseños;
- cambios de nombres;
- reorganizaciones;
- correcciones de otros módulos;
- nuevas funcionalidades;
- cambios de arquitectura;
- cambios de base de datos;
- limpieza general del proyecto.

Si durante una tarea se detecta un problema fuera del alcance:

1. NO corregirlo.
2. Reportarlo.
3. Explicar brevemente su impacto.
4. Esperar autorización.

No aprovechar una tarea pequeña para modificar otras partes del sistema.

---

## 6. SEPARACIÓN FRONTEND / BACKEND / BASE DE DATOS

Tratar cada capa como una responsabilidad independiente.

### Tarea exclusivamente de frontend

Modificar únicamente los archivos Angular necesarios.

NO modificar:

- FastAPI;
- SQLAlchemy;
- PostgreSQL;
- migraciones.

### Tarea exclusivamente de backend

Modificar únicamente los archivos FastAPI necesarios.

NO modificar:

- diseño Angular;
- componentes frontend;
- PostgreSQL;
- migraciones;

salvo autorización explícita.

### Tarea exclusivamente de base de datos

Trabajar únicamente sobre el diseño o scripts solicitados.

NO modificar automáticamente frontend o backend.

Si una modificación de base de datos requiere posteriormente cambios en
backend/frontend, reportarlos antes de realizarlos.

### Tarea de integración

Solo modificar varias capas cuando el usuario solicite explícitamente una
funcionalidad que requiera integración completa.

---

## 7. POSTGRESQL ES LA BASE DE DATOS REAL

SistemaWISP utiliza PostgreSQL.

Nunca inventar:

- tablas;
- columnas;
- llaves primarias;
- llaves foráneas;
- relaciones;
- constraints;
- estados;
- catálogos;
- valores iniciales;
- tipos de datos.

Antes de implementar una funcionalidad dependiente de datos:

1. Revisar las migraciones existentes.
2. Revisar los modelos SQLAlchemy existentes.
3. Revisar las relaciones existentes.
4. Identificar los nombres reales de columnas y FK.
5. Reutilizar la estructura actual.

Si no es posible determinar una estructura real:

NO inventarla.

Reportar qué información falta y esperar instrucciones.

---

## 8. FRONTEND NO DEFINE AUTOMÁTICAMENTE LA BASE DE DATOS

Un campo visible en la interfaz NO implica automáticamente que deba
crearse una nueva columna.

Un campo existente en PostgreSQL tampoco tiene que mostrarse
obligatoriamente en la interfaz.

La base de datos puede contener información interna necesaria para:

- relaciones;
- estados;
- auditoría;
- filtros;
- seguridad;
- catálogos;
- reglas de negocio.

No eliminar campos únicamente porque no aparecen visualmente.

Antes de eliminar un campo verificar su uso en:

- PostgreSQL;
- relaciones;
- models;
- schemas;
- services;
- routes;
- frontend;
- pruebas.

---

## 9. CAMBIOS DE BASE DE DATOS

Nunca modificar el esquema PostgreSQL sin autorización explícita.

NO ejecutar automáticamente:

- CREATE TABLE;
- ALTER TABLE;
- DROP TABLE;
- DROP COLUMN;
- RENAME COLUMN;
- nuevas FK;
- eliminación de FK;
- cambios destructivos;
- migraciones.

Si se considera necesario modificar PostgreSQL:

1. Identificar el problema.
2. Identificar tabla/campo/relación.
3. Explicar el cambio propuesto.
4. Identificar posibles impactos.
5. Esperar autorización.

Nunca utilizar `CASCADE` automáticamente para solucionar problemas de
integridad referencial.

---

## 10. MIGRACIONES

Las migraciones SQL se encuentran en:

`backend/migrations/`

No asumir que Alembic está configurado.

No inventar comandos de migración.

Antes de crear una nueva migración:

- revisar las existentes;
- respetar la numeración;
- comprobar que la estructura no exista;
- evitar duplicaciones;
- considerar datos existentes;
- preservar integridad referencial.

No modificar migraciones históricas ya establecidas, salvo que el usuario
indique explícitamente que se está limpiando/reconstruyendo una estructura
de desarrollo todavía no consolidada.

Nunca realizar este tipo de cambio silenciosamente.

---

## 11. REGLAS DEL BACKEND

Mantener FastAPI + SQLAlchemy.

Seguir el flujo:

Route
→ Schema
→ Service
→ Model
→ PostgreSQL

Mantener lógica de negocio principalmente en services cuando la
arquitectura existente así lo establezca.

No duplicar consultas existentes.

No crear endpoints nuevos si uno existente puede reutilizarse
correctamente.

No cambiar contratos de API existentes sin revisar su impacto en Angular.

Validar correctamente:

- existencia de registros;
- estados;
- relaciones;
- permisos;
- datos obligatorios;
- reglas de negocio.

---

## 12. REGLAS DEL FRONTEND ANGULAR

Mantener la arquitectura Angular existente.

Los componentes deben conservar, cuando corresponda:

- standalone components;
- ChangeDetectionStrategy.OnPush;
- signals;
- TypeScript estricto;
- templates estrictos.

NO introducir:

- React;
- Vite;
- otro framework frontend;
- otra arquitectura innecesaria.

No duplicar componentes existentes.

No modificar rutas funcionales fuera del alcance.

---

## 13. IDENTIDAD VISUAL

Mantener la identidad visual ya implementada en SistemaWISP.

Antes de diseñar una pantalla nueva revisar componentes existentes.

Conservar, cuando corresponda:

- colores;
- tipografía;
- botones;
- tablas;
- modales;
- iconografía;
- bordes redondeados;
- espaciado;
- sombras suaves;
- estructura visual;
- comportamiento responsive.

No rediseñar módulos que ya funcionan durante tareas no relacionadas.

---

## 14. REGLA PRINCIPAL DE DISEÑO HORIZONTAL

Los formularios y modales de SistemaWISP deben priorizar un diseño
horizontal en escritorio.

### Escritorio

- modal ancho;
- aprovechar el ancho disponible;
- distribuir campos en filas y columnas;
- evitar scroll vertical innecesario;
- mantener alineación y jerarquía visual.

### Tablet

- reorganizar columnas según el espacio disponible;
- conservar legibilidad.

### Móvil

- apilar campos verticalmente;
- mantener controles utilizables.

No sacrificar usabilidad únicamente para mantener horizontalidad.

---

## 15. EMPLEADOS, PUESTOS Y TÉCNICOS

No crear una tabla `tecnicos` únicamente para representar empleados
técnicos.

Un técnico es un empleado cuyo puesto corresponde al puesto técnico.

Utilizar la relación real existente entre:

`puestos_empleado`
y
`empleados`

Cuando una funcionalidad necesite técnicos:

1. consultar empleados;
2. utilizar la relación con puestos;
3. filtrar por el puesto técnico real;
4. filtrar empleados activos cuando corresponda.

No hardcodear nombres de empleados.

No inventar `id_tecnico` si la estructura real utiliza `id_empleado`.

Si Instalaciones utiliza un empleado como técnico asignado, guardar la FK
real del empleado según la estructura existente.

---

## 16. USUARIOS Y EMPLEADOS SON CONCEPTOS DIFERENTES

No confundir:

`usuarios`
con
`empleados`

Usuarios representa acceso al sistema.

Empleados representa personal de la empresa.

No asumir que todos los empleados necesitan usuario.

No asumir que todos los usuarios representan empleados.

Mantener las relaciones reales existentes.

---

## 17. AUTENTICACIÓN Y SEGURIDAD

SistemaWISP utiliza JWT.

Preservar:

- validación de tokens;
- expiración;
- autenticación;
- autorización;
- roles;
- permisos por módulo;
- guards;
- interceptor HTTP;
- seguridad de contraseñas.

No debilitar controles existentes.

El interceptor de autenticación debe respetar la exclusión existente para
el login.

No enviar Authorization al endpoint de login si la implementación actual
lo excluye intencionalmente.

No exponer:

- contraseñas;
- password hashes;
- JWT;
- secretos;
- DATABASE_URL;
- claves privadas;
- variables sensibles.

---

## 18. ROLES Y PERMISOS

Roles principales:

- Administrador
- Empleado

Respetar las reglas de permisos existentes.

El rol Administrador posee privilegios administrativos según las reglas
implementadas.

No modificar automáticamente permisos durante tareas de otros módulos.

Preservar el catálogo de módulos y las asignaciones existentes.

No recrear el módulo Usuarios.

---

## 19. ARCHIVOS E IMÁGENES

Seguir el patrón existente para archivos.

Cuando la arquitectura actual almacena imágenes físicamente:

- guardar el archivo en su directorio correspondiente;
- guardar únicamente la ruta relativa en PostgreSQL.

No almacenar BLOB/BYTEA si el diseño actual utiliza rutas.

No subir archivos de usuario al repositorio Git.

Antes de reemplazar una imagen existente, preservar el comportamiento
seguro definido por el módulo.

---

## 20. DOCUMENTACIÓN DEL CÓDIGO

Todo código NUEVO o MODIFICADO dentro del alcance debe documentarse en
español.

Usar comentarios claros por secciones.

### Python

```python
# ==========================================
# VALIDACIÓN DEL EMPLEADO
# ==========================================