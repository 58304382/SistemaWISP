-- FASE 2.3: INTEGRIDAD FINANCIERA Y RELACIONES DE PAGOS
-- BORRADOR: revisar junto con los cambios de modelos y servicios antes de ejecutar.
--
-- ORDEN SEGURO DE ACTUALIZACION, NO EJECUTADO POR ESTE ARCHIVO:
-- 1. Respaldar PostgreSQL y verificar que existan las tablas financieras legado.
-- 2. Detener el backend y bloquear escrituras financieras durante la ventana.
-- 3. Verificar tablas financieras vacias y catalogos requeridos.
-- 4. Ejecutar esta migracion completa dentro de su transaccion.
-- 5. Desplegar el backend compatible y validar consultas antes de reabrir trafico.
--
-- Esta migracion amplia tablas existentes: no elimina ni recrea tablas o catalogos.
-- Conserva sus filas y solo asigna origen a las tres categorias automaticas conocidas.
BEGIN;

-- La estructura actual no permite inferir cliente, origen, idempotencia ni
-- movimiento de Caja para registros financieros existentes. La migracion se
-- detiene antes de alterar datos si la base deja de estar vacia.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cobros)
       OR EXISTS (SELECT 1 FROM pagos)
       OR EXISTS (SELECT 1 FROM pago_detalles)
       OR EXISTS (SELECT 1 FROM comprobantes_cobro)
       OR EXISTS (SELECT 1 FROM gestiones_cobro)
       OR EXISTS (SELECT 1 FROM sesiones_caja)
       OR EXISTS (SELECT 1 FROM movimientos_caja)
       OR EXISTS (SELECT 1 FROM entregas_cobradores)
       OR EXISTS (SELECT 1 FROM arqueos_caja) THEN
        RAISE EXCEPTION
            'La migracion 008 requiere un plan explicito de backfill para datos financieros existentes';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM categorias_caja
        WHERE nombre IN (
            'Servicios de Internet',
            'Instalaciones',
            'Órdenes de trabajo'
        )
    ) <> 3 THEN
        RAISE EXCEPTION
            'No estan disponibles exactamente las tres categorias automaticas requeridas';
    END IF;

END $$;

-- ==========================================
-- CATALOGOS Y ORIGEN FINANCIERO
-- ==========================================
-- El codigo de origen no reemplaza la FK hacia la entidad que genera el cobro.
-- Solo Instalaciones posee actualmente una tabla verificable. Las FK de
-- Internet y Ordenes de Trabajo deben agregarse cuando existan esos modulos.
ALTER TABLE categorias_caja
    ADD COLUMN origen_financiero TEXT NULL;

UPDATE categorias_caja
SET origen_financiero = CASE nombre
    WHEN 'Servicios de Internet' THEN 'INTERNET'
    WHEN 'Instalaciones' THEN 'INSTALACIONES'
    WHEN 'Órdenes de trabajo' THEN 'ORDENES_TRABAJO'
END
WHERE nombre IN (
    'Servicios de Internet',
    'Instalaciones',
    'Órdenes de trabajo'
);

ALTER TABLE categorias_caja
    ADD CONSTRAINT uq_categorias_caja_id_origen
        UNIQUE (id_categoria, origen_financiero);

-- Un origen automatico identifica una sola categoria y permite que FastAPI
-- resuelva de forma determinista el ingreso de Caja correspondiente al pago.
CREATE UNIQUE INDEX uq_categorias_caja_origen_automatico
    ON categorias_caja (origen_financiero)
    WHERE origen_financiero IS NOT NULL;

-- ==========================================
-- PROPIEDAD Y ORIGEN DE LAS OBLIGACIONES
-- ==========================================
ALTER TABLE cobros
    ADD COLUMN id_cliente INTEGER NOT NULL,
    ADD COLUMN origen_financiero TEXT NOT NULL,
    ADD COLUMN id_instalacion INTEGER NULL;

ALTER TABLE instalaciones
    ADD CONSTRAINT uq_instalaciones_id_cliente
        UNIQUE (id_instalacion, id_cliente);

ALTER TABLE cobros
    ADD CONSTRAINT fk_cobros_cliente
        FOREIGN KEY (id_cliente)
        REFERENCES clientes(id_cliente)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_cobros_instalacion_cliente
        FOREIGN KEY (id_instalacion, id_cliente)
        REFERENCES instalaciones(id_instalacion, id_cliente)
        ON DELETE RESTRICT,
    ADD CONSTRAINT uq_cobros_id_cliente_origen
        UNIQUE (id_cobro, id_cliente, origen_financiero);

CREATE INDEX ix_cobros_cliente_fecha
    ON cobros (id_cliente, fecha_emision DESC);

CREATE INDEX ix_cobros_origen_estado
    ON cobros (origen_financiero, estado);

CREATE INDEX ix_cobros_instalacion
    ON cobros (id_instalacion)
    WHERE id_instalacion IS NOT NULL;

COMMENT ON COLUMN cobros.id_servicio IS
    'Campo legado sin FK; no debe considerarse relacion verificable hasta implementar Servicios de Internet.';

COMMENT ON COLUMN cobros.origen_financiero IS
    'Origen estable de la obligacion; la entidad fuente debe validarse mediante una FK especifica.';

-- ==========================================
-- MOVIMIENTOS AUTOMATICOS DE PAGOS
-- ==========================================
-- NULL identifica movimientos manuales u otros movimientos sin origen de
-- cobro. Un valor no NULL identifica un ingreso automatico financiero.
ALTER TABLE movimientos_caja
    ADD COLUMN origen_financiero TEXT NULL;

ALTER TABLE movimientos_caja
    ADD CONSTRAINT fk_movimientos_categoria_origen
        FOREIGN KEY (id_categoria, origen_financiero)
        REFERENCES categorias_caja(id_categoria, origen_financiero)
        ON DELETE RESTRICT,
    ADD CONSTRAINT uq_movimientos_pago_integridad
        UNIQUE (
            id_movimiento,
            id_metodo_pago,
            monto,
            origen_financiero
        );

CREATE INDEX ix_movimientos_caja_sesion_fecha
    ON movimientos_caja (id_sesion, fecha_hora DESC);

CREATE INDEX ix_movimientos_caja_categoria
    ON movimientos_caja (id_categoria);

CREATE INDEX ix_movimientos_caja_metodo
    ON movimientos_caja (id_metodo_pago)
    WHERE id_metodo_pago IS NOT NULL;

-- ==========================================
-- PAGOS, CLIENTE, ORIGEN E IDEMPOTENCIA
-- ==========================================
ALTER TABLE pagos
    ADD COLUMN id_cliente INTEGER NOT NULL,
    ADD COLUMN origen_financiero TEXT NOT NULL,
    ADD COLUMN id_movimiento_caja INTEGER NOT NULL,
    ADD COLUMN clave_idempotencia UUID NOT NULL;

ALTER TABLE pagos
    ADD CONSTRAINT fk_pagos_cliente
        FOREIGN KEY (id_cliente)
        REFERENCES clientes(id_cliente)
        ON DELETE RESTRICT,
    ADD CONSTRAINT uq_pagos_clave_idempotencia
        UNIQUE (clave_idempotencia),
    ADD CONSTRAINT uq_pagos_movimiento_caja
        UNIQUE (id_movimiento_caja),
    ADD CONSTRAINT uq_pagos_id_cliente_origen
        UNIQUE (id_pago, id_cliente, origen_financiero),
    ADD CONSTRAINT uq_pagos_id_empleado
        UNIQUE (id_pago, id_empleado),
    ADD CONSTRAINT fk_pagos_movimiento_integridad
        FOREIGN KEY (
            id_movimiento_caja,
            id_metodo_pago,
            monto_total,
            origen_financiero
        )
        REFERENCES movimientos_caja (
            id_movimiento,
            id_metodo_pago,
            monto,
            origen_financiero
        )
        ON DELETE RESTRICT;

CREATE INDEX ix_pagos_cliente_fecha
    ON pagos (id_cliente, fecha_hora DESC);

COMMENT ON COLUMN pagos.id_movimiento_caja IS
    'Unico ingreso automatico de Caja generado por la confirmacion del pago.';

COMMENT ON COLUMN pagos.clave_idempotencia IS
    'UUID obligatorio suministrado por la operacion cliente para reutilizar el resultado de un reintento.';

COMMENT ON COLUMN pagos.id_entrega IS
    'Relacion legado conservada; FastAPI usa entrega_pago_detalles para distribuciones parciales o multiples.';

-- ==========================================
-- APLICACIONES DEL PAGO
-- ==========================================
-- id_cliente y origen_financiero se derivan del pago en el servicio. Las FK
-- compuestas impiden aplicar el pago a obligaciones de otro cliente u origen.
ALTER TABLE pago_detalles
    ADD COLUMN id_cliente INTEGER NOT NULL,
    ADD COLUMN origen_financiero TEXT NOT NULL;

ALTER TABLE pago_detalles
    ADD CONSTRAINT fk_pago_detalles_pago_propietario
        FOREIGN KEY (id_pago, id_cliente, origen_financiero)
        REFERENCES pagos(id_pago, id_cliente, origen_financiero)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_pago_detalles_cobro_propietario
        FOREIGN KEY (id_cobro, id_cliente, origen_financiero)
        REFERENCES cobros(id_cobro, id_cliente, origen_financiero)
        ON DELETE RESTRICT;

CREATE INDEX ix_pago_detalles_cobro_propietario
    ON pago_detalles (id_cobro, id_cliente, origen_financiero);

-- Las sumas aplicadas al pago y al cobro son agregados entre varias filas y no
-- pueden protegerse con CHECK. El servicio transaccional debe bloquear primero
-- el pago y los cobros, en orden estable, y validar ambas sumas antes del commit.

-- ==========================================
-- ENTREGAS PARCIALES Y MULTIPLES
-- ==========================================
ALTER TABLE entregas_cobradores
    ADD CONSTRAINT uq_entregas_id_empleado
        UNIQUE (id_entrega, id_empleado);

CREATE TABLE entrega_pago_detalles (
    id_entrega INTEGER NOT NULL,
    id_pago INTEGER NOT NULL,
    id_empleado INTEGER NOT NULL,
    monto_entregado NUMERIC(10, 2) NOT NULL,
    CONSTRAINT pk_entrega_pago_detalles
        PRIMARY KEY (id_entrega, id_pago),
    CONSTRAINT fk_entrega_pago_detalles_entrega
        FOREIGN KEY (id_entrega, id_empleado)
        REFERENCES entregas_cobradores(id_entrega, id_empleado)
        ON DELETE RESTRICT,
    CONSTRAINT fk_entrega_pago_detalles_pago
        FOREIGN KEY (id_pago, id_empleado)
        REFERENCES pagos(id_pago, id_empleado)
        ON DELETE RESTRICT
);

CREATE INDEX ix_entrega_pago_detalles_pago
    ON entrega_pago_detalles (id_pago);

COMMENT ON TABLE entrega_pago_detalles IS
    'Distribuye entregas fisicas parciales o multiples sin generar nuevos ingresos financieros.';

-- Las sumas por pago y entrega requieren validacion bajo bloqueo en el servicio:
-- no deben superar pagos.monto_total ni entregas_cobradores.monto_entregado.

-- ==========================================
-- REGLAS DE NEGOCIO EN FASTAPI
-- ==========================================
-- Estas reglas corresponden a FastAPI: catalogos, origenes permitidos, estados,
-- montos, fechas, sesion unica abierta, cierre, arqueos y entregas. Los flujos
-- aun no habilitados deben validarlas antes de exponer escrituras; PostgreSQL
-- conserva aqui solo estructura e integridad referencial.

-- ==========================================
-- DEPENDENCIAS PENDIENTES
-- ==========================================
-- No se crean FK para INTERNET ni ORDENES_TRABAJO porque sus tablas no existen.
-- Una migracion posterior debe agregar sus identificadores a cobros, sus FK
-- compuestas con id_cliente y una restriccion que exija exactamente una entidad
-- fuente por obligacion. Hasta entonces, el servicio no debe confirmar cobros
-- de esos origenes como si tuvieran una fuente verificable.

COMMIT;
