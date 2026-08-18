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
    -- 'admin' ve y usa todo, sin excepción. 'personal' arranca con acceso a
    -- todos los módulos también — se le restringe puntualmente marcando
    -- filas en usuario_modulos_restringidos, nunca al revés (no hace falta
    -- habilitar módulo por módulo a un usuario nuevo).
    rol           VARCHAR(10)  NOT NULL DEFAULT 'personal' CHECK (rol IN ('admin', 'personal')),
    creado_en     TIMESTAMP    NOT NULL DEFAULT now()
);

-- Módulos bloqueados para un usuario 'personal' puntual (ver Usuario.rol
-- arriba). Una fila acá = ese módulo NO está disponible para ese usuario.
-- Sin filas = acceso a todo. No tiene efecto sobre usuarios 'admin'.
CREATE TABLE usuario_modulos_restringidos (
    usuario_id  INTEGER     NOT NULL REFERENCES usuarios(id),
    modulo      VARCHAR(30) NOT NULL,
    PRIMARY KEY (usuario_id, modulo)
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
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Cargos de tinta (Laminación, FLaminación, Superficie) que aparecen como
    -- "material" en el Excel OC-MP pero no son materia prima física: se
    -- registran en Crear OT para no perder el dato, pero no se entregan ni
    -- se devuelven en planta, así que Registrar Entrega/Devolución los
    -- excluyen de la lista de pedidos.
    es_tinta    BOOLEAN      NOT NULL DEFAULT FALSE
);

-- Ajustes editables desde la app (no desde .env), como la ruta del Excel
-- "OC-MP" que el jefe de área puede mover de carpeta por accidente.
CREATE TABLE configuracion (
    clave   VARCHAR(50) PRIMARY KEY,
    valor   TEXT
);

-- ============================================================
-- Órdenes de trabajo
-- ============================================================

-- El cliente y el diseño son únicos por OT (una OT es un solo pedido de un
-- solo cliente para un solo diseño, aunque pase por varios procesos).
--
-- Las columnas desde fecha_seguimiento_mp hasta precio_total_pedido_usd son
-- el equivalente 1:1 de las columnas comerciales de la hoja "oc mp" del
-- Excel OC-MP (ver app/services/excel_oc_mp.py) — viven a nivel de OT
-- completa, igual que cliente/diseño, porque son datos de la orden entera,
-- no de un proceso en particular.
CREATE TABLE ordenes_trabajo (
    id                          SERIAL PRIMARY KEY,
    numero_ot                   VARCHAR(30) NOT NULL UNIQUE,
    cliente                     VARCHAR(150),
    diseno                      VARCHAR(150),
    fecha_creacion              TIMESTAMP   NOT NULL DEFAULT now(),
    activo                      BOOLEAN     NOT NULL DEFAULT TRUE,

    fecha_seguimiento_mp        DATE,
    alm                         VARCHAR(20),
    so                          VARCHAR(20),
    tipo_trabajo                VARCHAR(20),
    indicador                   VARCHAR(20),
    status_entrega_mp           VARCHAR(50),
    vendedor                    VARCHAR(100),
    ciudad                      VARCHAR(100),
    fecha_pedido                DATE,
    fecha_entrega               DATE,
    descripcion_producto        VARCHAR(255),
    codigo_producto             VARCHAR(50),
    total_ot                    NUMERIC(12,2),
    entrega_mes                 NUMERIC(12,2),
    medida                      VARCHAR(20),
    equivalencia_kg             NUMERIC(12,2),
    pu_usd                      NUMERIC(12,2),
    pt_usd                      NUMERIC(12,2),
    factura_clises              VARCHAR(10),
    precio_clise_usd            NUMERIC(12,2),
    precio_total_pedido_usd     NUMERIC(12,2),

    -- Escritura hacia el Excel OC-MP (ver app/services/excel_oc_mp.py,
    -- escribir_oc_mp): TRUE por default a propósito — cubre tanto las OTs
    -- creadas antes de este feature como las importadas desde Excel
    -- (guardar_desde_excel), que ya están ahí por definición y nunca
    -- disparan una escritura. Solo se pone FALSE cuando guardar_detalle crea
    -- una OT nueva y el intento de escritura falla (archivo bloqueado, más
    -- de 6 materiales, etc.) — ahí excel_sync_error guarda el motivo para
    -- mostrarlo y permitir reintentar a mano.
    sincronizado_excel           BOOLEAN     NOT NULL DEFAULT TRUE,
    excel_sync_error             TEXT
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
    estado_sid_id       INTEGER   NOT NULL REFERENCES estados_sid(id),  -- estado del SID de la ENTREGA
    -- El SID de la devolución es independiente del de la entrega (son dos
    -- trámites distintos ante el mismo pedido) — por eso va aparte, no
    -- reutiliza estados_sid.
    sid_devolucion_completado BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en           TIMESTAMP NOT NULL DEFAULT now(),

    -- el proceso_id debe coincidir con el del paso de OT elegido
    FOREIGN KEY (ot_proceso_id, proceso_id) REFERENCES ot_procesos(id, proceso_id),

    -- cualquier material activo del catálogo puede pedirse en cualquier proceso
    -- (confirmado por planta: ej. Extrusión admite cualquier materia prima,
    -- no tiene sentido restringir por proceso)

    UNIQUE (ot_proceso_id, material_id)  -- un solo pedido por material dentro del mismo paso
);

-- Material importado desde el Excel OC-MP que todavía no tiene proceso ni
-- máquina asignados (la hoja "oc mp" no los maneja). Queda "pendiente" hasta
-- que alguien lo completa en Registrar Entrega (ver ordenes_controller.
-- promover_pendiente), momento en el que se crea el ot_procesos/ot_materiales
-- real y esta fila se borra.
CREATE TABLE ot_materiales_pendientes (
    id                  SERIAL PRIMARY KEY,
    ot_id               INTEGER   NOT NULL REFERENCES ordenes_trabajo(id),
    codigo_mp           VARCHAR(50) NOT NULL,     -- tal cual viene del Excel
    material_id         INTEGER   REFERENCES materiales(id),  -- NULL si el código no calza con el catálogo
    cantidad_requerida  NUMERIC(10,2),
    creado_en           TIMESTAMP NOT NULL DEFAULT now()
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
    ot.cliente,
    ot.diseno,
    p.nombre                    AS proceso,
    mq.nombre                   AS maquina,
    mat.codigo_mp,
    mat.descripcion,
    mat.unidad,
    mat.es_tinta,
    es.nombre                   AS estado_sid,
    om.sid_devolucion_completado,
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
