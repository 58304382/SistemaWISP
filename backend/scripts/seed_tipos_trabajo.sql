-- ==========================================
-- SEMILLA DEL CATALOGO DE TIPOS DE TRABAJO (ORIGENES DE TRABAJO)
-- ==========================================
-- Referencia de ejecucion MANUAL: NO se aplica desde la aplicacion y no debe
-- confundirse con una migracion de esquema. Sirve para poblar la tabla
-- tipos_trabajo cuando los registros activos no existan aun.
--
-- La tabla no posee una restriccion UNIQUE sobre nombre, por lo que se evitan
-- duplicados comparando el nombre normalizado antes de insertar.

BEGIN;

INSERT INTO public.tipos_trabajo (nombre, descripcion, estado)
SELECT v.nombre, v.descripcion, 'Activo'
FROM (
    VALUES
        ('Reparación de computadora', 'Servicio técnico de computadoras de escritorio y portátiles'),
        ('Reparación de teléfono', 'Servicio técnico de teléfonos y dispositivos móviles'),
        ('Instalación de cámaras', 'Instalación de cámaras de seguridad y videovigilancia'),
        ('Otro', 'Otros trabajos no clasificados en el catálogo')
) AS v (nombre, descripcion)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.tipos_trabajo t
    WHERE lower(trim(t.nombre)) = lower(trim(v.nombre))
);

COMMIT;