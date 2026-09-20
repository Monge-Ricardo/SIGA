-- ==============================================================================
-- SIGA-COMUNITARIO: MIGRACIÓN PARA POTENCIAR RUBROS, MULTAS, ABONOS Y ALCANTARILLADO
-- Proyecto: SIGA-Comunitario (Monge-Ricardo / App Agua)
-- Soporta: Abonos parciales por rubro, trazabilidad transaccional en rubros_abonos,
-- e integración formal de la cartera de alcantarillado.
-- ==============================================================================

-- 1. Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. EVOLUCIÓN DE LA TABLA multas_rubros (Cargo Padre)
-- Eliminar restricciones previas de tipo_rubro y estado si existieran con cualquier nombre
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'public.multas_rubros'::regclass 
          AND contype = 'c' 
          AND pg_get_constraintdef(oid) LIKE '%tipo_rubro%'
    ) LOOP
        EXECUTE 'ALTER TABLE public.multas_rubros DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
    END LOOP;

    FOR r IN (
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'public.multas_rubros'::regclass 
          AND contype = 'c' 
          AND pg_get_constraintdef(oid) LIKE '%estado%'
    ) LOOP
        EXECUTE 'ALTER TABLE public.multas_rubros DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
    END LOOP;
END $$;

-- Ampliar restricción de tipo_rubro para incluir ALCANTARILLADO
ALTER TABLE public.multas_rubros ADD CONSTRAINT multas_rubros_tipo_rubro_check 
  CHECK (tipo_rubro IN ('ALCANTARILLADO', 'MINGA', 'ASAMBLEA', 'RECONEXION', 'CUOTA_EXTRA', 'OTRO'));

-- Agregar columnas de control de saldo y abonos
ALTER TABLE public.multas_rubros ADD COLUMN IF NOT EXISTS monto_pagado NUMERIC(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.multas_rubros ADD COLUMN IF NOT EXISTS saldo_pendiente NUMERIC(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.multas_rubros ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE';
ALTER TABLE public.multas_rubros ADD CONSTRAINT multas_rubros_estado_check 
  CHECK (estado IN ('PENDIENTE', 'PARCIAL', 'PAGADO', 'ANULADO'));

-- Backfill inicial para multas existentes
UPDATE public.multas_rubros
SET 
  monto_pagado = CASE WHEN pagado = true THEN monto ELSE 0.00 END,
  saldo_pendiente = CASE WHEN pagado = true THEN 0.00 ELSE monto END,
  estado = CASE WHEN pagado = true THEN 'PAGADO' ELSE 'PENDIENTE' END
WHERE saldo_pendiente = 0.00 AND monto_pagado = 0.00 AND estado = 'PENDIENTE';

-- 3. CREACIÓN DE LA TABLA DE TRAZABILIDAD: rubros_abonos (Detalle de Abonos por Factura)
CREATE TABLE IF NOT EXISTS public.rubros_abonos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_rubro UUID NOT NULL REFERENCES public.multas_rubros(id) ON DELETE CASCADE,
  id_factura UUID NOT NULL REFERENCES public.facturas(id) ON DELETE CASCADE,
  monto_abonado NUMERIC(10,2) NOT NULL CHECK (monto_abonado > 0),
  saldo_anterior NUMERIC(10,2) NOT NULL,
  saldo_restante NUMERIC(10,2) NOT NULL,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  id_cajero UUID REFERENCES public.usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_rubros_abonos_rubro ON public.rubros_abonos(id_rubro);
CREATE INDEX IF NOT EXISTS idx_rubros_abonos_factura ON public.rubros_abonos(id_factura);

-- Habilitar Row Level Security (RLS) en rubros_abonos
ALTER TABLE public.rubros_abonos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'rubros_abonos' AND policyname = 'Permitir lectura en rubros_abonos'
  ) THEN
    CREATE POLICY "Permitir lectura en rubros_abonos" ON public.rubros_abonos FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'rubros_abonos' AND policyname = 'Permitir modificacion en rubros_abonos'
  ) THEN
    CREATE POLICY "Permitir modificacion en rubros_abonos" ON public.rubros_abonos FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4. MIGRACIÓN FORMAL DE CARTERA DE ALCANTARILLADO A multas_rubros
-- Registra los 10 socios que poseen saldo inicial de obra de saneamiento
INSERT INTO public.multas_rubros (id, id_socio, id_periodo, tipo_rubro, monto, monto_pagado, saldo_pendiente, estado, motivo, pagado, created_at)
VALUES
  ('a1111111-0000-0000-0000-000000000001', 'cdac9ac3-d826-5532-80c8-833385bd5341', '33333333-0000-0000-0000-000000000000', 'ALCANTARILLADO', 96.00, 0.00, 96.00, 'PENDIENTE', 'Aporte obra red de alcantarillado sanitario', false, '2026-07-31T23:59:59.000Z'),
  ('a1111111-0000-0000-0000-000000000002', 'ec22d49d-af84-57d1-afc0-016078769aaa', '33333333-0000-0000-0000-000000000000', 'ALCANTARILLADO', 96.00, 0.00, 96.00, 'PENDIENTE', 'Aporte obra red de alcantarillado sanitario', false, '2026-07-31T23:59:59.000Z'),
  ('a1111111-0000-0000-0000-000000000003', '74abf7f8-b3a8-559f-b948-bc861da3d310', '33333333-0000-0000-0000-000000000000', 'ALCANTARILLADO', 92.00, 0.00, 92.00, 'PENDIENTE', 'Aporte obra red de alcantarillado sanitario', false, '2026-07-31T23:59:59.000Z'),
  ('a1111111-0000-0000-0000-000000000004', '36c7869b-b087-50cf-9c25-854b31e5174e', '33333333-0000-0000-0000-000000000000', 'ALCANTARILLADO', 96.00, 0.00, 96.00, 'PENDIENTE', 'Aporte obra red de alcantarillado sanitario', false, '2026-07-31T23:59:59.000Z'),
  ('a1111111-0000-0000-0000-000000000005', '0fdce6e8-a9c6-5e38-9945-9ddd35a67d67', '33333333-0000-0000-0000-000000000000', 'ALCANTARILLADO', 18.00, 0.00, 18.00, 'PENDIENTE', 'Aporte obra red de alcantarillado sanitario', false, '2026-07-31T23:59:59.000Z'),
  ('a1111111-0000-0000-0000-000000000006', 'a24c63ef-dee5-5434-9924-c2eeba6c6592', '33333333-0000-0000-0000-000000000000', 'ALCANTARILLADO', 96.00, 0.00, 96.00, 'PENDIENTE', 'Aporte obra red de alcantarillado sanitario', false, '2026-07-31T23:59:59.000Z'),
  ('a1111111-0000-0000-0000-000000000007', '03945980-1d3f-5c39-a7d9-1184091fd7e2', '33333333-0000-0000-0000-000000000000', 'ALCANTARILLADO', 18.00, 6.00, 12.00, 'PARCIAL', 'Aporte obra red de alcantarillado sanitario', false, '2026-07-31T23:59:59.000Z'),
  ('a1111111-0000-0000-0000-000000000008', '43f054b8-50bd-5567-93a1-0244165a5bcd', '33333333-0000-0000-0000-000000000000', 'ALCANTARILLADO', 18.00, 18.00, 0.00, 'PAGADO', 'Aporte obra red de alcantarillado sanitario', true, '2026-07-31T23:59:59.000Z'),
  ('a1111111-0000-0000-0000-000000000009', 'e91672d7-51ef-5233-b958-b13da1c6e748', '33333333-0000-0000-0000-000000000000', 'ALCANTARILLADO', 18.00, 0.00, 18.00, 'PENDIENTE', 'Aporte obra red de alcantarillado sanitario', false, '2026-07-31T23:59:59.000Z'),
  ('a1111111-0000-0000-0000-000000000010', 'efa63ead-0eda-5bdf-b4e0-5a3c6d0a2ad9', '33333333-0000-0000-0000-000000000000', 'ALCANTARILLADO', 96.00, 0.00, 96.00, 'PENDIENTE', 'Aporte obra red de alcantarillado sanitario', false, '2026-07-31T23:59:59.000Z')
ON CONFLICT (id) DO UPDATE SET
  monto_pagado = EXCLUDED.monto_pagado,
  saldo_pendiente = EXCLUDED.saldo_pendiente,
  estado = EXCLUDED.estado,
  pagado = EXCLUDED.pagado;

-- 5. REGISTRO HISTÓRICO DE ABONOS EN rubros_abonos
-- Abono de Lourdes Flores ($18.00 en factura REC-892696)
INSERT INTO public.rubros_abonos (id, id_rubro, id_factura, monto_abonado, saldo_anterior, saldo_restante, fecha)
VALUES (
  'b1111111-0000-0000-0000-000000000001',
  'a1111111-0000-0000-0000-000000000008',
  '83cbaca6-f2e1-451f-b199-60df1d3c7503',
  18.00,
  18.00,
  0.00,
  '2026-09-13T13:24:52.696+00:00'
) ON CONFLICT (id) DO NOTHING;

-- Abono de Álvaro Morales ($6.00 en factura REC-548063)
INSERT INTO public.rubros_abonos (id, id_rubro, id_factura, monto_abonado, saldo_anterior, saldo_restante, fecha)
VALUES (
  'b1111111-0000-0000-0000-000000000002',
  'a1111111-0000-0000-0000-000000000007',
  'e6c89c3a-9774-4762-8fe6-71203bd37908',
  6.00,
  18.00,
  12.00,
  '2026-09-13T15:49:23.203+00:00'
) ON CONFLICT (id) DO NOTHING;

-- 6. SINCRONIZAR COLUMNA TRANSICIONAL socios.deuda_alcantarillado
UPDATE public.socios SET deuda_alcantarillado = 0.00 WHERE id = '43f054b8-50bd-5567-93a1-0244165a5bcd'; -- Lourdes Flores
UPDATE public.socios SET deuda_alcantarillado = 12.00 WHERE id = '03945980-1d3f-5c39-a7d9-1184091fd7e2'; -- Álvaro Morales

-- 7. NOTIFICAR RECARGA DE ESQUEMA EN POSTGREST (TABLE EDITOR SUPABASE)
NOTIFY pgrst, 'reload schema';
