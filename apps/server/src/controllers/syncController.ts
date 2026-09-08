import type { Request, Response } from '../core/http.ts';
import type { SyncBatchRequest, SyncBatchResponse, SyncAck } from '../shared.ts';
import { ConflictResolver } from '../services/conflictResolver.ts';
import { socioService } from '../services/socioService.ts';
import { lecturaService } from '../services/lecturaService.ts';
import { facturacionService } from '../services/facturacionService.ts';
import { fondosService } from '../services/fondosService.ts';
import { sqliteDb } from '../db/sqlite.ts';
import { supabaseClient } from '../db/supabase.ts';

export const handleBatchSync = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId, lastSyncTimestamp, mutations } = (req.body || {}) as SyncBatchRequest;

    if (!clientId || !Array.isArray(mutations)) {
      res.status(400).json({ error: 'Formato de sincronización inválido. Se requiere clientId y array de mutations.' });
      return;
    }

    const acks: SyncAck[] = [];

    // 1. Procesar cada mutación entrante mediante ConflictResolver (LWW)
    for (const mutation of mutations) {
      const resolution = ConflictResolver.resolveLWW(mutation, undefined);
      acks.push(resolution.ack);
    }

    // 2. Extraer deltas/actualizaciones generadas en el servidor
    const socios = socioService.getSocios();
    const lecturas = lecturaService.getLecturas();
    const facturas = facturacionService.getFacturas();
    const movimientos = fondosService.getLibroMayor();

    const response: SyncBatchResponse = {
      serverTimestamp: new Date().toISOString(),
      acks,
      incomingUpdates: {
        clientes: socios,
        lecturas: lecturas,
        cobros: facturas,
        movimientos_caja: movimientos
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('[SyncController] Error procesando lote de sincronización:', error);
    res.status(500).json({ error: 'Error interno procesando sincronización.' });
  }
};

/**
 * Obtiene el estado actual de sincronización entre SQLite Local y Supabase Cloud
 */
export const getSyncStatus = async (_req: Request, res: Response): Promise<void> => {
  try {
    const db = sqliteDb.getRawDb();
    const localSocios = (db.prepare('SELECT count(*) as c FROM socios').get() as { c: number }).c;
    const localMedidores = (db.prepare('SELECT count(*) as c FROM medidores').get() as { c: number }).c;
    const localLecturas = (db.prepare('SELECT count(*) as c FROM lecturas').get() as { c: number }).c;
    const localFacturas = (db.prepare('SELECT count(*) as c FROM facturas').get() as { c: number }).c;

    const isSupabaseConfigured = supabaseClient.isEnabled();
    let supabaseStatus: Record<string, unknown> = {
      configured: isSupabaseConfigured,
      url: supabaseClient.getUrl()
    };

    if (isSupabaseConfigured) {
      const [socRes, medRes, lecRes] = await Promise.all([
        supabaseClient.fetchRecords('socios', 'select=id'),
        supabaseClient.fetchRecords('medidores', 'select=id'),
        supabaseClient.fetchRecords('lecturas', 'select=id')
      ]);

      supabaseStatus = {
        ...supabaseStatus,
        online: !socRes.error,
        sociosCount: socRes.data ? socRes.data.length : 0,
        medidoresCount: medRes.data ? medRes.data.length : 0,
        lecturasCount: lecRes.data ? lecRes.data.length : 0,
        error: socRes.error
      };
    }

    res.status(200).json({
      local: {
        sociosCount: localSocios,
        medidoresCount: localMedidores,
        lecturasCount: localLecturas,
        facturasCount: localFacturas
      },
      supabase: supabaseStatus,
      timestamp: new Date().toISOString()
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error consultando estado de sincronización';
    res.status(500).json({ error: msg });
  }
};

/**
 * Ejecuta una sincronización bidireccional completa SQLite <-> Supabase
 */
export const syncWithSupabase = async (_req: Request, res: Response): Promise<void> => {
  try {
    if (!supabaseClient.isEnabled()) {
      res.status(400).json({
        error: 'Supabase no está configurado en las variables de entorno (SUPABASE_URL / SUPABASE_SECRET_KEY).'
      });
      return;
    }

    const db = sqliteDb.getRawDb();
    let pushedSocios = 0;
    let pushedMedidores = 0;
    let pushedLecturas = 0;
    let pulledSocios = 0;
    let pulledMedidores = 0;
    const errors: string[] = [];

    // 1. PUSH: Local SQLite -> Supabase Cloud
    const localSocios = db.prepare('SELECT * FROM socios').all() as Record<string, unknown>[];
    for (const s of localSocios) {
      const syncRes = await supabaseClient.syncRecord('socios', s);
      if (syncRes.success) pushedSocios++;
      else if (syncRes.error) errors.push(`Socio ${s.id}: ${syncRes.error}`);
    }

    const localMedidores = db.prepare('SELECT * FROM medidores').all() as Record<string, unknown>[];
    for (const m of localMedidores) {
      const syncRes = await supabaseClient.syncRecord('medidores', m);
      if (syncRes.success) pushedMedidores++;
      else if (syncRes.error) errors.push(`Medidor ${m.id}: ${syncRes.error}`);
    }

    const localLecturas = db.prepare('SELECT * FROM lecturas').all() as Record<string, unknown>[];
    for (const l of localLecturas) {
      const syncRes = await supabaseClient.syncRecord('lecturas', l);
      if (syncRes.success) pushedLecturas++;
      else if (syncRes.error) errors.push(`Lectura ${l.id}: ${syncRes.error}`);
    }

    // 2. PULL: Supabase Cloud -> Local SQLite (Traer socios y medidores creados en Supabase)
    const remoteSociosRes = await supabaseClient.fetchRecords<Record<string, unknown>>('socios');
    if (remoteSociosRes.data) {
      for (const remoteS of remoteSociosRes.data) {
        const exists = db.prepare('SELECT id FROM socios WHERE id = ?').get(remoteS.id as string);
        if (!exists) {
          db.prepare(`
            INSERT INTO socios (
              id, codigo_socio, nombres, apellidos, cedula_ruc, fecha_nacimiento,
              fecha_union, id_sector, medidor_numero, tiene_alcantarillado,
              telefono, direccion, estado, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            remoteS.id,
            remoteS.codigo_socio || `SOC-${String(Date.now()).slice(-4)}`,
            remoteS.nombres,
            remoteS.apellidos,
            remoteS.cedula_ruc,
            remoteS.fecha_nacimiento || '1985-01-01',
            remoteS.fecha_union || new Date().toISOString().split('T')[0],
            remoteS.id_sector || '11111111-0000-0000-0000-000000000001',
            remoteS.medidor_numero || 'S/N',
            remoteS.tiene_alcantarillado ? 1 : 0,
            remoteS.telefono || null,
            remoteS.direccion || 'Comunidad',
            remoteS.estado || 'ACTIVO',
            remoteS.version || 1,
            remoteS.created_at || new Date().toISOString(),
            remoteS.updated_at || new Date().toISOString()
          );
          pulledSocios++;
        }
      }
    }

    const remoteMedidoresRes = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores');
    if (remoteMedidoresRes.data) {
      for (const remoteM of remoteMedidoresRes.data) {
        const exists = db.prepare('SELECT id FROM medidores WHERE id = ?').get(remoteM.id as string);
        if (!exists) {
          db.prepare(`
            INSERT INTO medidores (
              id, id_socio, id_sector, numero_medidor, alias,
              direccion, tiene_alcantarillado, estado, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            remoteM.id,
            remoteM.id_socio,
            remoteM.id_sector || '11111111-0000-0000-0000-000000000001',
            remoteM.numero_medidor,
            remoteM.alias || 'Casa principal',
            remoteM.direccion || 'Comunidad',
            remoteM.tiene_alcantarillado ? 1 : 0,
            remoteM.estado || 'ACTIVO',
            remoteM.version || 1,
            remoteM.created_at || new Date().toISOString(),
            remoteM.updated_at || new Date().toISOString()
          );
          pulledMedidores++;
        }
      }
    }

    res.status(200).json({
      success: true,
      summary: {
        pushedSocios,
        pushedMedidores,
        pushedLecturas,
        pulledSocios,
        pulledMedidores,
        errorsCount: errors.length,
        errors: errors.slice(0, 5)
      },
      timestamp: new Date().toISOString()
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error durante sincronización Supabase';
    console.error('[SyncController] Error:', msg);
    res.status(500).json({ error: msg });
  }
};

