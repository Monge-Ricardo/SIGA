-- ==============================================================================
-- MIGRACIÓN SUPABASE: TABLA MEDIDORES Y ARQUITECTURA MULTI-MEDIDOR
-- Proyecto: SIGA-Comunitario (Monge-Ricardo's Project)
-- ==============================================================================

-- 1. Habilitar extensión de UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Crear tabla medidores (1 Socio : N Medidores / Acometidas)
CREATE TABLE IF NOT EXISTS medidores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_socio UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  id_sector UUID NOT NULL REFERENCES sectores(id),
  numero_medidor VARCHAR(50) UNIQUE NOT NULL,
  alias VARCHAR(50) DEFAULT 'Casa principal',
  direccion TEXT,
  tiene_alcantarillado BOOLEAN NOT NULL DEFAULT false,
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO' CHECK(estado IN ('ACTIVO', 'SUSPENDIDO', 'CORTADO')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de optimización para medidores
CREATE INDEX IF NOT EXISTS idx_pg_medidores_socio ON medidores(id_socio);
CREATE INDEX IF NOT EXISTS idx_pg_medidores_sector ON medidores(id_sector);

-- 3. Si ya existen socios con medidor registrado, migrarlos automáticamente a la tabla medidores
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'socios' AND column_name = 'medidor_numero'
  ) THEN
    INSERT INTO medidores (id_socio, id_sector, numero_medidor, alias, direccion, tiene_alcantarillado)
    SELECT 
      s.id,
      s.id_sector,
      s.medidor_numero,
      'Casa principal',
      s.direccion,
      COALESCE(s.tiene_alcantarillado, false)
    FROM socios s
    WHERE s.medidor_numero IS NOT NULL AND s.medidor_numero <> ''
    ON CONFLICT (numero_medidor) DO NOTHING;
  END IF;
END $$;

-- 4. Adaptar tabla lecturas para vincular id_medidor
ALTER TABLE lecturas ADD COLUMN IF NOT EXISTS id_medidor UUID REFERENCES medidores(id);

-- Enlazar lecturas existentes al medidor del socio
UPDATE lecturas l
SET id_medidor = m.id
FROM medidores m
WHERE l.id_medidor IS NULL AND m.id_socio = l.id_socio;

-- Eliminar la antigua restricción de unicidad por socio (permitiendo múltiples medidores por socio)
ALTER TABLE lecturas DROP CONSTRAINT IF EXISTS uq_socio_periodo_lectura;
ALTER TABLE lecturas DROP CONSTRAINT IF EXISTS lecturas_id_socio_id_periodo_key;

-- Aplicar la nueva restricción de unicidad por medidor y período
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_medidor_periodo_lectura'
  ) THEN
    ALTER TABLE lecturas ADD CONSTRAINT uq_medidor_periodo_lectura UNIQUE (id_medidor, id_periodo);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pg_lecturas_medidor ON lecturas(id_medidor);

-- 5. Adaptar tabla facturas para vincular id_medidor
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS id_medidor UUID REFERENCES medidores(id);

-- Enlazar facturas existentes al medidor
UPDATE facturas f
SET id_medidor = m.id
FROM medidores m
WHERE f.id_medidor IS NULL AND m.id_socio = f.id_socio;

CREATE INDEX IF NOT EXISTS idx_pg_facturas_medidor ON facturas(id_medidor);

-- 6. Políticas RLS (Row Level Security) para medidores
ALTER TABLE medidores ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'medidores' AND policyname = 'Permitir lectura publica o autenticada en medidores'
  ) THEN
    CREATE POLICY "Permitir lectura publica o autenticada en medidores"
      ON medidores FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'medidores' AND policyname = 'Permitir modificacion en medidores'
  ) THEN
    CREATE POLICY "Permitir modificacion en medidores"
      ON medidores FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 7. Notificar a PostgREST para recargar el esquema en el Table Editor
NOTIFY pgrst, 'reload schema';
