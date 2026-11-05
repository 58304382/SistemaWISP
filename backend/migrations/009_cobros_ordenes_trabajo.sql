-- ==========================================
-- FASE 3: RELACION ENTRE COBROS Y ORDENES DE TRABAJO
-- ==========================================
-- MIGRACION APLICADA MANUALMENTE (2026-10-18).
-- No crea ni modifica datos financieros; solo la relacion estructural minima.
-- Respaldo previo: backend/backups/sistemawisp_pre_009_20261018_223304.dump.
BEGIN;

-- Una orden solo puede pertenecer a un cliente, requisito para la FK compuesta.
ALTER TABLE ordenes_trabajo
    ADD CONSTRAINT uq_ordenes_trabajo_id_cliente
    UNIQUE (id_orden, id_cliente);

-- Identificador verificable del origen ORDENES_TRABAJO.
ALTER TABLE cobros
    ADD COLUMN id_orden_trabajo INTEGER NULL;

-- Impide asociar un cobro con una orden de otro cliente.
ALTER TABLE cobros
    ADD CONSTRAINT fk_cobros_orden_trabajo_cliente
    FOREIGN KEY (id_orden_trabajo, id_cliente)
    REFERENCES ordenes_trabajo(id_orden, id_cliente)
    ON DELETE RESTRICT;

-- Una sola obligacion financiera por orden.
CREATE UNIQUE INDEX uq_cobros_orden_trabajo
    ON cobros (id_orden_trabajo)
    WHERE id_orden_trabajo IS NOT NULL;

COMMENT ON COLUMN cobros.id_orden_trabajo IS
    'Orden de trabajo que origina la obligacion; NULL para otros origenes.';

COMMIT;
