-- ==============================================================================
-- SIGA-COMUNITARIO: ESQUEMA COMPLETO PARA SUPABASE (POSTGRESQL CLOUD)
-- Soporta: Multi-Medidor (1 Socio : N Medidores), Micromedición, Facturación,
-- 3ra Edad Dinámica, Alcantarillado y Contraloría de 3 Columnas.
-- ==============================================================================

-- 1. EXTENSIONES REQUERIDAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 2. TABLAS BASE Y CONFIGURACIÓN
-- ==============================================================================

-- 2.1. USUARIOS Y ROLES DEL SISTEMA
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nombre_completo VARCHAR(150) NOT NULL,
  rol VARCHAR(20) NOT NULL CHECK(rol IN ('ADMIN', 'CAJERO', 'LECTOR', 'AUDITOR')),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.2. SECTORES / BARRIOS / RUTAS
CREATE TABLE IF NOT EXISTS sectores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_sector VARCHAR(20) UNIQUE NOT NULL,
  nombre_sector VARCHAR(100) NOT NULL,
  descripcion TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.3. PARÁMETROS TARIFARIOS COMUNITARIOS
CREATE TABLE IF NOT EXISTS tarifas_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cargo_fijo_normal NUMERIC(10,2) NOT NULL DEFAULT 7.00,
  cargo_fijo_tercera_edad NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  limite_base_m3 NUMERIC(10,2) NOT NULL DEFAULT 30.00,
  costo_excedente_m3 NUMERIC(10,2) NOT NULL DEFAULT 0.10,
  recargo_alcantarillado NUMERIC(10,2) NOT NULL DEFAULT 1.00,
  reparto_normal_padre NUMERIC(10,2) NOT NULL DEFAULT 2.00,
  reparto_normal_operacion NUMERIC(10,2) NOT NULL DEFAULT 4.00,
  reparto_normal_lector NUMERIC(10,2) NOT NULL DEFAULT 0.50,
  reparto_normal_mortuorio NUMERIC(10,2) NOT NULL DEFAULT 0.50,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 3. PADRÓN DE SOCIOS Y ARQUITECTURA MULTI-MEDIDOR (1:N)
-- ==============================================================================

-- 3.1. SOCIOS (Abonados Titulares)
-- La edad y condición de 3ra edad se calculan dinámicamente según fecha_nacimiento.
CREATE TABLE IF NOT EXISTS socios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_socio VARCHAR(30) UNIQUE NOT NULL,
  nombres VARCHAR(100) NOT NULL,
  apellidos VARCHAR(100) NOT NULL,
  cedula_ruc VARCHAR(20) UNIQUE NOT NULL,
  fecha_nacimiento DATE NOT NULL,
  fecha_union DATE NOT NULL DEFAULT CURRENT_DATE,
  telefono VARCHAR(25),
  direccion TEXT NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO' CHECK(estado IN ('ACTIVO', 'SUSPENDIDO', 'CORTADO')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.2. MEDIDORES (Acometidas Físicas: 1 Socio -> 1 o Más Medidores)
CREATE TABLE IF NOT EXISTS medidores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_socio UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  id_sector UUID NOT NULL REFERENCES sectores(id),
  numero_medidor VARCHAR(50) UNIQUE NOT NULL,
  alias VARCHAR(50) DEFAULT 'Casa principal', -- ej: "Casa principal", "Local comercial", "Terreno"
  direccion TEXT,
  tiene_alcantarillado BOOLEAN NOT NULL DEFAULT false, -- Aplica recargo de +$1.00 mensual
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO' CHECK(estado IN ('ACTIVO', 'SUSPENDIDO', 'CORTADO')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medidores_socio ON medidores(id_socio);
CREATE INDEX IF NOT EXISTS idx_medidores_sector ON medidores(id_sector);

-- ==============================================================================
-- 4. MICROMEDICIÓN Y PERIODOS MENSUALES
-- ==============================================================================

-- 4.1. PERIODOS MENSUALES (Ciclos YYYY-MM)
CREATE TABLE IF NOT EXISTS periodos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  periodo_codigo VARCHAR(7) UNIQUE NOT NULL, -- ej: '2026-08'
  nombre VARCHAR(50) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTO' CHECK(estado IN ('ABIERTO', 'CERRADO', 'FACTURADO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4.2. LECTURAS POR MEDIDOR (Capturadas por el Lector en Campo)
CREATE TABLE IF NOT EXISTS lecturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_medidor UUID NOT NULL REFERENCES medidores(id) ON DELETE CASCADE,
  id_socio UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  id_periodo UUID NOT NULL REFERENCES periodos(id),
  lectura_anterior NUMERIC(10,2) NOT NULL,
  lectura_actual NUMERIC(10,2) NOT NULL,
  consumo_total NUMERIC(10,2) NOT NULL,
  excedente_m3 NUMERIC(10,2) NOT NULL,
  fecha_lectura TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  id_lector UUID NOT NULL REFERENCES usuarios(id),
  observaciones TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_medidor_periodo_lectura UNIQUE (id_medidor, id_periodo)
);

CREATE INDEX IF NOT EXISTS idx_lecturas_medidor ON lecturas(id_medidor);
CREATE INDEX IF NOT EXISTS idx_lecturas_socio ON lecturas(id_socio);
CREATE INDEX IF NOT EXISTS idx_lecturas_periodo ON lecturas(id_periodo);

-- ==============================================================================
-- 5. FACTURACIÓN Y CAJA / COBROS
-- ==============================================================================

-- 5.1. MULTAS Y RUBROS EXTRAORDINARIOS (Mingas, Asambleas, Reconexiones)
CREATE TABLE IF NOT EXISTS multas_rubros (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_socio UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  id_periodo UUID REFERENCES periodos(id),
  tipo_rubro VARCHAR(50) NOT NULL CHECK(tipo_rubro IN ('MINGA', 'ASAMBLEA', 'RECONEXION', 'CUOTA_EXTRA', 'OTRO')),
  monto NUMERIC(10,2) NOT NULL,
  motivo TEXT NOT NULL,
  pagado BOOLEAN NOT NULL DEFAULT false,
  id_factura UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5.2. FACTURAS / LIQUIDACIONES (Generadas por Medidor y Socio)
CREATE TABLE IF NOT EXISTS facturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero_factura VARCHAR(30) UNIQUE NOT NULL,
  id_socio UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  id_medidor UUID REFERENCES medidores(id) ON DELETE SET NULL,
  id_periodo UUID NOT NULL REFERENCES periodos(id),
  id_lectura UUID REFERENCES lecturas(id) ON DELETE SET NULL,
  es_tercera_edad BOOLEAN NOT NULL DEFAULT false,
  valor_base NUMERIC(10,2) NOT NULL, -- $7.00 Normal o $5.00 Tercera Edad
  consumo_m3 NUMERIC(10,2) NOT NULL,
  excedente_m3 NUMERIC(10,2) NOT NULL,
  valor_excedente NUMERIC(10,2) NOT NULL, -- Excedente m3 * $0.10
  valor_alcantarillado NUMERIC(10,2) NOT NULL, -- $1.00 si acometida posee alcantarillado
  valor_multas NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  valor_deuda_anterior NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  total_mes NUMERIC(10,2) NOT NULL,
  total_pagar NUMERIC(10,2) NOT NULL,
  estado_pago VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK(estado_pago IN ('PENDIENTE', 'PAGADO', 'ANULADO')),
  fecha_vencimiento DATE NOT NULL,
  fecha_pago TIMESTAMPTZ,
  metodo_pago VARCHAR(30) CHECK(metodo_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'MOVIL')),
  id_cajero UUID REFERENCES usuarios(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facturas_socio_estado ON facturas(id_socio, estado_pago);
CREATE INDEX IF NOT EXISTS idx_facturas_medidor ON facturas(id_medidor);
CREATE INDEX IF NOT EXISTS idx_facturas_periodo ON facturas(id_periodo);

-- ==============================================================================
-- 6. CONTRALORÍA Y LIBRO MAYOR (3 COLUMNAS: INGRESOS, EGRESOS, SALDO)
-- ==============================================================================

-- 6.1. CATÁLOGO DE LOS 7 FONDOS COMUNITARIOS
CREATE TABLE IF NOT EXISTS fondos_catalogo (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo VARCHAR(30) UNIQUE NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- 6.2. MOVIMIENTOS CONTABLES (Libro Mayor Estricto de 3 Columnas)
CREATE TABLE IF NOT EXISTS fondos_movimientos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_fondo UUID NOT NULL REFERENCES fondos_catalogo(id),
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concepto VARCHAR(255) NOT NULL,
  tipo VARCHAR(10) NOT NULL CHECK(tipo IN ('INGRESO', 'EGRESO')),
  ingreso NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  egreso NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  saldo NUMERIC(10,2) NOT NULL,
  id_factura UUID REFERENCES facturas(id),
  numero_comprobante VARCHAR(50), -- Soporte de egreso físico
  id_responsable UUID NOT NULL REFERENCES usuarios(id),
  beneficiario VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fondos_mov_fondo_fecha ON fondos_movimientos(id_fondo, fecha);

-- ==============================================================================
-- 7. VISTAS SQL PARA CONSULTAS RÁPIDAS
-- ==============================================================================

-- 7.1. Vista de Socios con información agregada de Medidores
CREATE OR REPLACE VIEW vista_socios_medidores AS
SELECT 
  s.id AS socio_id,
  s.codigo_socio,
  (s.nombres || ' ' || s.apellidos) AS nombre_completo,
  s.cedula_ruc,
  s.fecha_nacimiento,
  EXTRACT(YEAR FROM age(CURRENT_DATE, s.fecha_nacimiento))::INT AS edad_calculada,
  (EXTRACT(YEAR FROM age(CURRENT_DATE, s.fecha_nacimiento)) >= 65) AS es_tercera_edad,
  s.estado AS estado_socio,
  COUNT(m.id) AS total_medidores,
  COALESCE(
    JSON_AGG(
      JSON_BUILD_OBJECT(
        'medidor_id', m.id,
        'numero_medidor', m.numero_medidor,
        'alias', m.alias,
        'id_sector', m.id_sector,
        'tiene_alcantarillado', m.tiene_alcantarillado,
        'estado', m.estado
      )
    ) FILTER (WHERE m.id IS NOT NULL), '[]'::JSON
  ) AS medidores_detalle
FROM socios s
LEFT JOIN medidores m ON s.id = m.id_socio
GROUP BY s.id, s.codigo_socio, s.nombres, s.apellidos, s.cedula_ruc, s.fecha_nacimiento, s.estado;

-- 7.2. Vista del Libro Mayor Consolidado de 3 Columnas
CREATE OR REPLACE VIEW vista_libro_mayor_3columnas AS
SELECT 
  f.codigo AS codigo_fondo,
  f.nombre AS nombre_fondo,
  m.fecha,
  m.concepto,
  m.tipo,
  m.ingreso AS "Ingresos (+)",
  m.egreso AS "Egresos (-)",
  m.saldo AS "Saldo Acumulado (=)",
  m.numero_comprobante,
  m.beneficiario
FROM fondos_movimientos m
JOIN fondos_catalogo f ON m.id_fondo = f.id
ORDER BY m.fecha ASC;

-- ==============================================================================
-- 8. DATOS SEMILLA INICIALES (SEED DATA)
-- ==============================================================================

-- 8.1. Usuarios predeterminados (Claves cifradas compatibles con Auth local)
INSERT INTO usuarios (id, username, password_hash, nombre_completo, rol, activo)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'admin', 'pbkdf2:admin', 'Carlos Morales (Administrador)', 'ADMIN', true),
  ('00000000-0000-0000-0000-000000000002', 'cajero', 'pbkdf2:cajero', 'Gladys Guamán (Tesorera / Cajera)', 'CAJERO', true),
  ('00000000-0000-0000-0000-000000000003', 'lector', 'pbkdf2:lector', 'Manuel Tacuri (Lector de Campo)', 'LECTOR', true)
ON CONFLICT (username) DO NOTHING;

-- 8.2. Sectores Comunitarios
INSERT INTO sectores (id, codigo_sector, nombre_sector, descripcion)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'SEC-01', 'Sector Centro', 'Zona central de la parroquia y parque principal'),
  ('11111111-1111-1111-1111-111111111112', 'SEC-02', 'Sector Norte', 'Barrios altos y ramal norte'),
  ('11111111-1111-1111-1111-111111111113', 'SEC-03', 'Sector Sur', 'Zona baja y rivera del río')
ON CONFLICT (codigo_sector) DO NOTHING;

-- 8.3. Matriz Tarifaria Comunitaria
INSERT INTO tarifas_config (
  cargo_fijo_normal, cargo_fijo_tercera_edad, limite_base_m3, 
  costo_excedente_m3, recargo_alcantarillado,
  reparto_normal_padre, reparto_normal_operacion, reparto_normal_lector, reparto_normal_mortuorio
)
VALUES (7.00, 5.00, 30.00, 0.10, 1.00, 2.00, 4.00, 0.50, 0.50)
ON CONFLICT DO NOTHING;

-- 8.4. Catálogo de los 7 Fondos Comunitarios
INSERT INTO fondos_catalogo (id, codigo, nombre, descripcion)
VALUES
  ('22222222-2222-2222-2222-222222220001', 'PADRE_PARROQUIA', 'Fondo Parroquial (Entrega al Padre)', '$2.00 recaudados de cada tarifa base normal'),
  ('22222222-2222-2222-2222-222222220002', 'OPERACION_MANT', 'Fondo Operación y Mantenimiento', '$4.00 base + 100% de excedentes de consumo'),
  ('22222222-2222-2222-2222-222222220003', 'PAGO_LECTOR', 'Fondo Pago a Lectores', '$0.50 mensual por toma de micromedición'),
  ('22222222-2222-2222-2222-222222220004', 'MORTUORIO', 'Fondo Mortuorio Solidario', '$0.50 de auxilio funerario comunitario'),
  ('22222222-2222-2222-2222-222222220005', 'PRO_MEJORAS', 'Fondo Pro-Mejoras e Infraestructura', 'Fondo de reserva comunitaria'),
  ('22222222-2222-2222-2222-222222220006', 'MULTAS_EXTRAS', 'Fondo Multas y Mingas', 'Recaudaciones por inasistencias y sanciones'),
  ('22222222-2222-2222-2222-222222220007', 'ALCANTARILLADO', 'Fondo Alcantarillado Comunitario', '$1.00 mensual para mantenimiento de red de saneamiento')
ON CONFLICT (codigo) DO NOTHING;

-- ==============================================================================
-- 9. POLÍTICAS DE SEGURIDAD (ROW LEVEL SECURITY - RLS) EN SUPABASE
-- ==============================================================================
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE sectores ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarifas_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE socios ENABLE ROW LEVEL SECURITY;
ALTER TABLE medidores ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodos ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE multas_rubros ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE fondos_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE fondos_movimientos ENABLE ROW LEVEL SECURITY;

-- Políticas para permitir operaciones desde la API central autenticada o servicio
CREATE POLICY "Permitir lectura general autenticada" ON usuarios FOR SELECT USING (true);
CREATE POLICY "Permitir lectura general sectores" ON sectores FOR SELECT USING (true);
CREATE POLICY "Permitir lectura general tarifas" ON tarifas_config FOR SELECT USING (true);
CREATE POLICY "Permitir lectura general socios" ON socios FOR SELECT USING (true);
CREATE POLICY "Permitir escritura socios" ON socios FOR ALL USING (true);
CREATE POLICY "Permitir lectura general medidores" ON medidores FOR SELECT USING (true);
CREATE POLICY "Permitir escritura medidores" ON medidores FOR ALL USING (true);
CREATE POLICY "Permitir lectura periodos" ON periodos FOR SELECT USING (true);
CREATE POLICY "Permitir operaciones lecturas" ON lecturas FOR ALL USING (true);
CREATE POLICY "Permitir operaciones facturas" ON facturas FOR ALL USING (true);
CREATE POLICY "Permitir operaciones fondos" ON fondos_movimientos FOR ALL USING (true);
CREATE POLICY "Permitir lectura catalogo fondos" ON fondos_catalogo FOR SELECT USING (true);
