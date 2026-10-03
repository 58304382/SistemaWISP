-- FASE 1: RELACION 1:1 ENTRE EMPLEADOS Y USUARIOS
BEGIN;

-- "Administrador" es un rol del sistema. El puesto laboral equivalente se
-- denomina "Administrativo" y conserva su identificador y sus referencias.
DO $$
DECLARE
    puesto_anterior_id INTEGER;
    puesto_nuevo_id INTEGER;
BEGIN
    SELECT id_puesto
    INTO puesto_anterior_id
    FROM puestos_empleado
    WHERE nombre = 'Administrador';

    SELECT id_puesto
    INTO puesto_nuevo_id
    FROM puestos_empleado
    WHERE nombre = 'Administrativo';

    IF puesto_anterior_id IS NOT NULL AND puesto_nuevo_id IS NOT NULL THEN
        RAISE EXCEPTION
            'Existen simultaneamente los puestos Administrador y Administrativo';
    ELSIF puesto_anterior_id IS NOT NULL THEN
        UPDATE puestos_empleado
        SET nombre = 'Administrativo'
        WHERE id_puesto = puesto_anterior_id;
    ELSIF puesto_nuevo_id IS NULL THEN
        RAISE EXCEPTION
            'No existe el puesto Administrador que debe renombrarse';
    END IF;
END $$;

-- La FK se ubica en empleados porque todo empleado debera tener una cuenta.
-- Permanece nullable durante la fase de vinculacion manual de datos existentes.
ALTER TABLE empleados
    ADD COLUMN IF NOT EXISTS id_usuario INTEGER NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'empleados'::regclass
          AND conname = 'fk_empleados_usuario'
    ) THEN
        ALTER TABLE empleados
            ADD CONSTRAINT fk_empleados_usuario
            FOREIGN KEY (id_usuario)
            REFERENCES usuarios(id)
            ON DELETE RESTRICT;
    END IF;
END $$;

-- PostgreSQL permite multiples NULL, pero impide reutilizar un usuario una vez
-- que una asociacion haya sido confirmada manualmente.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'empleados'::regclass
          AND conname = 'uq_empleados_id_usuario'
    ) THEN
        ALTER TABLE empleados
            ADD CONSTRAINT uq_empleados_id_usuario UNIQUE (id_usuario);
    END IF;
END $$;

COMMENT ON COLUMN empleados.id_usuario IS
    'Cuenta unica del empleado; nullable temporalmente hasta completar la vinculacion manual.';

COMMIT;
