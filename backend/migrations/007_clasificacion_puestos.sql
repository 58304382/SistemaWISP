-- CLASIFICACION LABORAL DE PUESTOS PARA FUNCIONES EN SISTEMAWISP
BEGIN;

-- Esta bandera describe si el puesto puede requerir funciones dentro del
-- sistema. No concede acceso ni reemplaza roles, modulos o asignaciones.
ALTER TABLE puestos_empleado
    ADD COLUMN IF NOT EXISTS tiene_funciones_sistema BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO puestos_empleado (
    nombre,
    descripcion,
    estado,
    tiene_funciones_sistema
)
VALUES
    ('Gerente Administrativo', 'Puesto de gerencia administrativa', 'Activo', TRUE),
    ('Secretaria', 'Puesto de secretaria', 'Activo', FALSE),
    ('Conserje', 'Puesto de conserjeria', 'Activo', FALSE)
ON CONFLICT (nombre) DO NOTHING;

UPDATE puestos_empleado
SET tiene_funciones_sistema = nombre IN (
    'Gerente Administrativo',
    'Administrativo',
    'Técnico',
    'Atención al cliente'
)
WHERE nombre IN (
    'Gerente Administrativo',
    'Administrativo',
    'Técnico',
    'Atención al cliente',
    'Secretaria',
    'Conserje'
);

COMMENT ON COLUMN puestos_empleado.tiene_funciones_sistema IS
    'Indica si el puesto puede requerir funciones en SistemaWISP; no otorga permisos.';

-- La vinculacion es opcional de forma permanente: hay empleados cuyos puestos
-- no requieren una cuenta de acceso a SistemaWISP.
COMMENT ON COLUMN empleados.id_usuario IS
    'Cuenta opcional y unica del empleado; NULL es valido si no utiliza SistemaWISP.';

COMMIT;
