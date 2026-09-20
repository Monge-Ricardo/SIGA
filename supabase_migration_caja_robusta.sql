-- ==============================================================================
-- SIGA-COMUNITARIO: MIGRACIÓN ROBUSTA PARA CAJA Y SUPABASE CLOUD
-- Soporta: Deuda Histórica de Alcantarillado, Políticas RLS en Multas,
-- y Consultas Genéricas para Cualquier Socio.
-- ==============================================================================

-- 1. Agregar columna deuda_alcantarillado y tiene_alcantarillado a socios
ALTER TABLE socios ADD COLUMN IF NOT EXISTS deuda_alcantarillado NUMERIC(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE socios ADD COLUMN IF NOT EXISTS tiene_alcantarillado BOOLEAN NOT NULL DEFAULT false;

-- 2. Propagar bandera tiene_alcantarillado desde los medidores existentes
UPDATE socios s
SET tiene_alcantarillado = true
FROM medidores m
WHERE m.id_socio = s.id AND m.tiene_alcantarillado = true;

-- 3. Cargar deudas históricas de alcantarillado registradas en deuda_alcantarillado.xlsx
UPDATE socios SET deuda_alcantarillado = 96.00, tiene_alcantarillado = true WHERE id = 'cdac9ac3-d826-5532-80c8-833385bd5341'; -- Marianita De Jesus Moreta Flores (SOC-0052)
UPDATE socios SET deuda_alcantarillado = 96.00, tiene_alcantarillado = true WHERE id = 'ec22d49d-af84-57d1-afc0-016078769aaa'; -- Ángel Anchundia (SOC-0057)
UPDATE socios SET deuda_alcantarillado = 92.00, tiene_alcantarillado = true WHERE id = '74abf7f8-b3a8-559f-b948-bc861da3d310'; -- Enrique Anchundia (SOC-0058)
UPDATE socios SET deuda_alcantarillado = 96.00, tiene_alcantarillado = true WHERE id = '36c7869b-b087-50cf-9c25-854b31e5174e'; -- Gonzalo Lalaleo Moreta (SOC-0056)
UPDATE socios SET deuda_alcantarillado = 18.00, tiene_alcantarillado = true WHERE id = '0fdce6e8-a9c6-5e38-9945-9ddd35a67d67'; -- David Flores (SOC-0054)
UPDATE socios SET deuda_alcantarillado = 96.00, tiene_alcantarillado = true WHERE id = 'a24c63ef-dee5-5434-9924-c2eeba6c6592'; -- Lida Flores (SOC-0055)
UPDATE socios SET deuda_alcantarillado = 18.00, tiene_alcantarillado = true WHERE id = '03945980-1d3f-5c39-a7d9-1184091fd7e2'; -- Álvaro Morales (SOC-0050)
UPDATE socios SET deuda_alcantarillado = 18.00, tiene_alcantarillado = true WHERE id = '43f054b8-50bd-5567-93a1-0244165a5bcd'; -- Lourdes Flores (SOC-0064)
UPDATE socios SET deuda_alcantarillado = 18.00, tiene_alcantarillado = true WHERE id = 'e91672d7-51ef-5233-b958-b13da1c6e748'; -- Fernando Masaquiza (SOC-0060)
UPDATE socios SET deuda_alcantarillado = 96.00, tiene_alcantarillado = true WHERE id = 'efa63ead-0eda-5bdf-b4e0-5a3c6d0a2ad9'; -- Miño Moreta Elsa Maribel (SOC-0053)

-- 4. Habilitar políticas de seguridad RLS en multas_rubros para permitir acceso público/autenticado
ALTER TABLE multas_rubros ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'multas_rubros' AND policyname = 'Permitir lectura general multas'
  ) THEN
    CREATE POLICY "Permitir lectura general multas" ON multas_rubros FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'multas_rubros' AND policyname = 'Permitir operaciones multas'
  ) THEN
    CREATE POLICY "Permitir operaciones multas" ON multas_rubros FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5. Asegurar políticas RLS para socios (lectura y actualización)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'socios' AND policyname = 'Permitir modificacion socios'
  ) THEN
    CREATE POLICY "Permitir modificacion socios" ON socios FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 6. Recargar caché del esquema PostgREST en Supabase
NOTIFY pgrst, 'reload schema';
