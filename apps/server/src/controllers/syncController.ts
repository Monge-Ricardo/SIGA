import type { Request, Response } from '../core/http.ts';
import type { SyncBatchRequest, SyncBatchResponse, SyncAck } from '../shared.ts';
import { ConflictResolver } from '../services/conflictResolver.ts';
import { socioService } from '../services/socioService.ts';
import { lecturaService } from '../services/lecturaService.ts';
import { facturacionService } from '../services/facturacionService.ts';
import { fondosService } from '../services/fondosService.ts';
import { sqliteDb } from '../db/sqlite.ts';
import { supabaseClient } from '../db/supabase.ts';

export const handlePush = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId, lastSyncTimestamp, mutations } = (req.body || {}) as SyncBatchRequest;

    if (!clientId || !Array.isArray(mutations)) {
      res.status(400).json({ error: 'Formato inválido. Se requiere clientId y array de mutations.' });
      return;
    }

    const acks: SyncAck[] = [];

    // Procesar cada mutación con el resolver de conflictos
    for (const mutation of mutations) {
      const resolution = ConflictResolver.resolveLWW(mutation, undefined);
      acks.push(resolution.ack);

      // Si Supabase Cloud está configurado, replicar también a la nube
      if (supabaseClient.isEnabled() && mutation.payload) {
        const p = mutation.payload as Record<string, unknown>;
        if (mutation.entity === 'lecturas') {
          await supabaseClient.syncRecord('lecturas', {
            id: mutation.entityId,
            id_socio: p.clienteId || p.idSocio,
            id_medidor: p.idMedidor || null,
            id_periodo: p.periodo || p.idPeriodo || '2026-08',
            lectura_anterior: Number(p.lecturaAnterior || 0),
            lectura_actual: Number(p.lecturaActual || 0),
            consumo_total: Number(p.consumoM3 || 0),
            excedente_m3: Number(p.excedenteM3 || 0),
            fecha_lectura: p.updatedAt || new Date().toISOString(),
            id_lector: 'usr-lector',
            observaciones: p.observaciones || 'Toma en campo',
            updated_at: new Date().toISOString()
          }).catch(() => {});
        } else if (mutation.entity === 'socios' || mutation.entity === 'clientes') {
          await supabaseClient.syncRecord('socios', {
            id: mutation.entityId,
            codigo_socio: p.codigoSocio || p.codigoCliente,
            nombres: p.nombres,
            apellidos: p.apellidos,
            cedula_ruc: p.cedulaRuc || p.identificacion,
            id_sector: p.sectorId || p.idSector || '11111111-0000-0000-0000-000000000001',
            direccion: p.direccion || 'Comunidad',
            estado: p.estadoServicio || 'ACTIVO',
            updated_at: new Date().toISOString()
          }).catch(() => {});
        }
      }
    }

    res.status(200).json({
      success: true,
      serverTimestamp: new Date().toISOString(),
      acks,
      pushedCount: acks.filter((a) => a.status === 'ACCEPTED').length
    });
  } catch (error) {
    console.error('[SyncController Push Error]:', error);
    res.status(500).json({ error: 'Error procesando Push de mutaciones.' });
  }
};

export const handlePull = async (req: Request, res: Response): Promise<void> => {
  try {
    const since = req.query.since || '1970-01-01T00:00:00.000Z';
    const db = sqliteDb.getRawDb();

    // Obtener socios creados o actualizados después de 'since' (o todos si since es inicio)
    const socios = since === '1970-01-01T00:00:00.000Z'
      ? db.prepare('SELECT * FROM socios').all()
      : db.prepare('SELECT * FROM socios WHERE updated_at >= ?').all(since);

    const sectores = db.prepare('SELECT * FROM sectores').all();
    const medidores = db.prepare('SELECT * FROM medidores').all();

    const lecturas = since === '1970-01-01T00:00:00.000Z'
      ? db.prepare('SELECT * FROM lecturas ORDER BY fecha_lectura DESC LIMIT 500').all()
      : db.prepare('SELECT * FROM lecturas WHERE updated_at >= ?').all(since);

    const facturas = since === '1970-01-01T00:00:00.000Z'
      ? db.prepare('SELECT * FROM facturas ORDER BY created_at DESC LIMIT 500').all()
      : db.prepare('SELECT * FROM facturas WHERE updated_at >= ?').all(since);

    // Normalizar a formato interno de la PWA
    const normalizedSocios = (socios as any[]).map((s) => ({
      id: s.id,
      codigoSocio: s.codigo_socio,
      nombres: s.nombres,
      apellidos: s.apellidos,
      nombreCompleto: `${s.nombres || ''} ${s.apellidos || ''}`.trim() || s.codigo_socio,
      cedulaRuc: s.cedula_ruc,
      sectorId: s.id_sector,
      medidorNumero: s.medidor_numero,
      tieneAlcantarillado: Boolean(s.tiene_alcantarillado),
      telefono: s.telefono,
      direccion: s.direccion,
      estadoServicio: s.estado || 'ACTIVO',
      updatedAt: s.updated_at
    }));

    const normalizedLecturas = (lecturas as any[]).map((l) => ({
      id: l.id,
      idMedidor: l.id_medidor,
      clienteId: l.id_socio,
      idSocio: l.id_socio,
      periodo: l.id_periodo,
      lecturaAnterior: Number(l.lectura_anterior || 0),
      lecturaActual: Number(l.lectura_actual || 0),
      consumoM3: Number(l.consumo_total || 0),
      excedenteM3: Number(l.excedente_m3 || 0),
      observaciones: l.observaciones || '',
      updatedAt: l.updated_at || l.fecha_lectura
    }));

    res.status(200).json({
      success: true,
      serverTimestamp: new Date().toISOString(),
      socios: normalizedSocios,
      sectores: sectores.map((sec: any) => ({ id: sec.id, codigo: sec.codigo_sector, nombre: sec.nombre_sector })),
      medidores: medidores.map((m: any) => ({ id: m.id, idSocio: m.id_socio, numeroMedidor: m.numero_medidor, alias: m.alias })),
      lecturas: normalizedLecturas,
      facturas: facturas
    });
  } catch (error) {
    console.error('[SyncController Pull Error]:', error);
    res.status(500).json({ error: 'Error procesando Pull de datos remotos.' });
  }
};

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

