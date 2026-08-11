-- Sistema de Control de Materia Prima - ZEPOL Ltda.
-- Esquema PostgreSQL (Fase 0)

-- ============================================================
-- Catálogos base
-- ============================================================

CREATE TABLE usuarios (
    id            SERIAL PRIMARY KEY,
    inicial       VARCHAR(5)   NOT NULL UNIQUE,   -- ER, EB, BO, CE
    nombre        VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255),                   -- se define al implementar login (Fase 1)
    activo        BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en     TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE procesos (
    id      SERIAL PRIMARY KEY,
    nombre  VARCHAR(50) NOT NULL UNIQUE,           -- Impresión, Laminación, Extrusión, Refilado, Confección
    activo  BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE TABLE maquinas (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(50) NOT NULL,              -- F4, FS-1500, NORD, CHINA...
    proceso_id  INTEGER     NOT NULL REFERENCES procesos(id),
    activo      BOOLEAN     NOT NULL DEFAULT TRUE,
    UNIQUE (nombre, proceso_id),
    -- (id, proceso_id) queda disponible como llave única para que otras tablas
    -- puedan referenciar "esta máquina Y su proceso" en una sola FK compuesta.
    UNIQUE (id, proceso_id)
);

CREATE TABLE estados_sid (
    id      SERIAL PRIMARY KEY,
    nombre  VARCHAR(20) NOT NULL UNIQUE            -- PENDIENTE, REGISTRADO, CORREGIR, CORREGIDO, ANULADO
);

CREATE TABLE materiales (
    id          SERIAL PRIMARY KEY,
    codigo_mp   VARCHAR(50)  NOT NULL UNIQUE,       -- LDPE-1, BOPP20630...
    descripcion VARCHAR(255),
    unidad      VARCHAR(10)  NOT NULL,              -- kg, mts, unid... fija por material, nunca se pregunta al usuario
    activo      BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ============================================================
-- Órdenes de trabajo
-- ============================================================

CREATE TABLE ordenes_trabajo (
    id              SERIAL PRIMARY KEY,
    numero_ot       VARCHAR(30) NOT NULL UNIQUE,
    cliente         VARCHAR(150),
    diseno          VARCHAR(150),
    fecha_creacion  TIMESTAMP   NOT NULL DEFAULT now(),
    activo          BOOLEAN     NOT NULL DEFAULT TRUE
);

-- Un "paso" de la OT: la OT 2121 puede pasar por Laminación en la máquina NORD.
-- Bajo ese mismo paso pueden pedirse varios materiales distintos (ver ot_materiales).
CREATE TABLE ot_procesos (
    id          SERIAL PRIMARY KEY,
    ot_id       INTEGER   NOT NULL REFERENCES ordenes_trabajo(id),
    proceso_id  INTEGER   NOT NULL,
    maquina_id  INTEGER   NOT NULL,
    creado_en   TIMESTAMP NOT NULL DEFAULT now(),

    -- fuerza que la máquina elegida pertenezca realmente al proceso elegido
    -- (ej. no se puede registrar Confección con la máquina F4)
    FOREIGN KEY (maquina_id, proceso_id) REFERENCES maquinas(id, proceso_id),

    UNIQUE (ot_id, proceso_id, maquina_id),
    UNIQUE (id, proceso_id)  -- disponible para la FK compuesta de ot_materiales
);

-- El "pedido" real: dentro de un paso de OT, cada material solicitado tiene su
-- propia cantidad requerida (ej. OT 2121 en Laminación pide 500kg de PA15520
-- Y por separado 200kg de PA15V). Las entregas y devoluciones cuelgan de aquí,
-- no de ot_procesos, porque el material -y su unidad- se fija en este nivel.
CREATE TABLE ot_materiales (
    id                  SERIAL PRIMARY KEY,
    ot_proceso_id       INTEGER   NOT NULL,
    proceso_id          INTEGER   NOT NULL,   -- denormalizado a propósito, ver FKs abajo
    material_id         INTEGER   NOT NULL REFERENCES materiales(id),
    cantidad_requerida  NUMERIC(10,2),
    estado_sid_id       INTEGER   NOT NULL REFERENCES estados_sid(id),
    creado_en           TIMESTAMP NOT NULL DEFAULT now(),

    -- el proceso_id debe coincidir con el del paso de OT elegido
    FOREIGN KEY (ot_proceso_id, proceso_id) REFERENCES ot_procesos(id, proceso_id),

    -- cualquier material activo del catálogo puede pedirse en cualquier proceso
    -- (confirmado por planta: ej. Extrusión admite cualquier materia prima,
    -- no tiene sentido restringir por proceso)

    UNIQUE (ot_proceso_id, material_id)  -- un solo pedido por material dentro del mismo paso
);

-- ============================================================
-- Movimientos: entregas y devoluciones
-- ============================================================

-- Una entrega es una entrega PARCIAL o total contra un pedido (ot_materiales).
-- Varias entregas en fechas distintas pueden apuntar al mismo pedido
-- (ej. hoy 200kg, mañana el resto de 300kg).
CREATE TABLE entregas (
    id             SERIAL PRIMARY KEY,
    ot_material_id INTEGER   NOT NULL REFERENCES ot_materiales(id),
    usuario_id     INTEGER   NOT NULL REFERENCES usuarios(id),
    fecha          DATE      NOT NULL,
    hora           TIME      NOT NULL DEFAULT current_time,
    creado_en      TIMESTAMP NOT NULL DEFAULT now()
);

-- Peso/cantidad por bobina de una entrega. Sin columna de unidad: la unidad
-- siempre es la del material (materiales.unidad), así se elimina de raíz
-- el riesgo de "entregué en kg pero alguien cargó en mts".
CREATE TABLE entrega_bobinas (
    id          SERIAL PRIMARY KEY,
    entrega_id  INTEGER       NOT NULL REFERENCES entregas(id) ON DELETE CASCADE,
    numero      INTEGER       NOT NULL,
    cantidad    NUMERIC(10,3) NOT NULL CHECK (cantidad > 0),
    UNIQUE (entrega_id, numero)
);

-- La devolución cuelga del PEDIDO (ot_materiales), no de una entrega puntual:
-- una vez que el material está en planta ya no se distingue de qué entrega
-- parcial vino, así que "cuánto se devuelve de PA15520 en esta OT" se valida
-- contra el total entregado de ese material, no de un envío específico.
CREATE TABLE devoluciones (
    id             SERIAL PRIMARY KEY,
    ot_material_id INTEGER   NOT NULL REFERENCES ot_materiales(id),
    usuario_id     INTEGER   NOT NULL REFERENCES usuarios(id),
    fecha          DATE      NOT NULL,
    hora           TIME      NOT NULL DEFAULT current_time,
    creado_en      TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE devolucion_bobinas (
    id             SERIAL PRIMARY KEY,
    devolucion_id  INTEGER       NOT NULL REFERENCES devoluciones(id) ON DELETE CASCADE,
    numero         INTEGER       NOT NULL,
    cantidad       NUMERIC(10,3) NOT NULL CHECK (cantidad > 0),
    UNIQUE (devolucion_id, numero)
);

-- ============================================================
-- Vista de consumo neto por pedido (material dentro de una OT+proceso)
-- ============================================================

CREATE VIEW vista_consumo AS
SELECT
    om.id                       AS ot_material_id,
    ot.numero_ot,
    p.nombre                    AS proceso,
    mq.nombre                   AS maquina,
    mat.codigo_mp,
    mat.unidad,
    es.nombre                   AS estado_sid,
    om.cantidad_requerida,
    COALESCE(ent_tot.total, 0)  AS total_entregado,
    COALESCE(dev_tot.total, 0)  AS total_devuelto,
    COALESCE(ent_tot.total, 0) - COALESCE(dev_tot.total, 0) AS consumo_neto
FROM ot_materiales om
JOIN ot_procesos otp    ON otp.id = om.ot_proceso_id
JOIN ordenes_trabajo ot ON ot.id = otp.ot_id
JOIN procesos p         ON p.id = om.proceso_id
JOIN maquinas mq        ON mq.id = otp.maquina_id
JOIN materiales mat     ON mat.id = om.material_id
JOIN estados_sid es     ON es.id = om.estado_sid_id
LEFT JOIN (
    SELECT e.ot_material_id, SUM(eb.cantidad) AS total
    FROM entregas e
    JOIN entrega_bobinas eb ON eb.entrega_id = e.id
    GROUP BY e.ot_material_id
) ent_tot ON ent_tot.ot_material_id = om.id
LEFT JOIN (
    SELECT d.ot_material_id, SUM(db.cantidad) AS total
    FROM devoluciones d
    JOIN devolucion_bobinas db ON db.devolucion_id = d.id
    GROUP BY d.ot_material_id
) dev_tot ON dev_tot.ot_material_id = om.id;
