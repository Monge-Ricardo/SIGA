-- ==============================================================================
-- SIGA-COMUNITARIO: SANEAMIENTO Y DESACOPLAMIENTO DEFINITIVO DE multas_rubros.id_factura
-- Proyecto: App Agua Potable Comunitaria
-- Descripción: 
--   1. Asegura la trazabilidad histórica de cualquier multa que haya tenido id_factura,
--      migrándola hacia la tabla oficial de auditoría: public.rubros_abonos.
--   2. Limpia los valores de multas_rubros.id_factura poniéndolos en NULL.
--   3. (Opcional) Elimina la columna y su constraint para consolidar el diseño limpio.
-- ==============================================================================

-- 1. MIGRACIÓN / BACKFILL DE HISTORIAL A rubros_abonos
-- Si existen multas históricas con id_factura no nulo que no tengan su registro
-- en rubros_abonos, creamos su abono histórico para no perder la trazabilidad de recaudación.
INSERT INTO public.rubros_abonos (
  id,
  id_rubro,
  id_factura,
  monto_abonado,
  saldo_anterior,
  saldo_restante,
  fecha,
  created_at
)
SELECT 
  gen_random_uuid(),
  m.id,
  m.id_factura,
  COALESCE(NULLIF(m.monto_pagado, 0), m.monto),
  m.monto,
  COALESCE(m.saldo_pendiente, 0.00),
  COALESCE(m.created_at, NOW()),
  NOW()
FROM public.multas_rubros m
WHERE m.id_factura IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.rubros_abonos ra 
    WHERE ra.id_rubro = m.id AND ra.id_factura = m.id_factura
  );

-- 2. LIMPIEZA DE ASOCIACIONES OBSOLETAS EN multas_rubros
UPDATE public.multas_rubros
SET id_factura = NULL
WHERE id_factura IS NOT NULL;

-- 3. ELIMINACIÓN DE RESTRICCIÓN Y COLUMNA (OPCIONAL PERO RECOMENDADO)
-- Descomenta las siguientes líneas si deseas borrar la columna físicamente de la tabla:
-- DO $$
-- BEGIN
--   -- Eliminar Foreign Key si existe
--   IF EXISTS (
--     SELECT 1 FROM pg_constraint 
--     WHERE conrelid = 'public.multas_rubros'::regclass 
--       AND conname LIKE '%id_factura%'
--   ) THEN
--     EXECUTE 'ALTER TABLE public.multas_rubros DROP CONSTRAINT ' || (
--       SELECT conname FROM pg_constraint 
--       WHERE conrelid = 'public.multas_rubros'::regclass AND conname LIKE '%id_factura%' LIMIT 1
--     );
--   END IF;
-- 
--   -- Eliminar columna física
--   ALTER TABLE public.multas_rubros DROP COLUMN IF EXISTS id_factura;
-- END $$;

-- 4. NOTIFICAR RECARGA DE ESQUEMA EN POSTGREST (Supabase Table Editor / API)
NOTIFY pgrst, 'reload schema';
