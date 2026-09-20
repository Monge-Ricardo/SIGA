import type { Request, Response } from '../core/http.ts';
import type { SyncBatchRequest, SyncBatchResponse, SyncAck } from '../shared.ts';
import { ConflictResolver } from '../services/conflictResolver.ts';
import { supabaseClient } from '../db/supabase.ts';
import { cloudSyncService } from '../services/cloudSyncService.ts';

export const handlePush = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId, lastSyncTimestamp, mutations } = (req.body || {}) as SyncBatchRequest;

    if (!clientId || !Array.isArray(mutations)) {
      res.status(400).json({ error: 'Formato inválido. Se requiere clientId y array de mutations.' });
      return;
    }

    const acks: SyncAck[] = [];

    // Procesar cada mutación
    for (const mutation of mutations) {
      const resolution = ConflictResolver.resolveLWW(mutation, undefined);
      acks.push(resolution.ack);

      // Si Supabase Cloud está configurado, replicar directamente a la nube
      if (supabaseClient.isEnabled()) {
        const p = ((mutation.payload || (mutation as any).data) || {}) as Record<string, unknown>;
        const entityId = mutation.entityId || (p.id as string);

        if (mutation.entity === 'lecturas') {
          await supabaseClient.syncRecord('lecturas', {
            id: entityId,
            id_socio: p.clienteId || p.idSocio,
            id_medidor: p.idMedidor || null,
            id_periodo: p.periodo || p.idPeriodo || '2026-08',
            lectura_anterior: Number(Number(p.lecturaAnterior || 0).toFixed(2)),
            lectura_actual: Number(Number(p.lecturaActual || 0).toFixed(2)),
            consumo_total: Number(Number(p.consumoM3 || 0).toFixed(2)),
            excedente_m3: Number(Number(p.excedenteM3 || 0).toFixed(2)),
            fecha_lectura: p.updatedAt || new Date().toISOString(),
            id_lector: '00000000-0000-0000-0000-000000000003',
            observaciones: p.observaciones || 'Toma en campo',
            updated_at: new Date().toISOString()
          }).catch(() => {});
        } else if (mutation.entity === 'socios' || mutation.entity === 'clientes') {
          await supabaseClient.syncRecord('socios', {
            id: entityId,
            codigo_socio: p.codigoSocio || p.codigoCliente || p.codigo_socio,
            nombres: p.nombres || '',
            apellidos: p.apellidos || '',
            cedula_ruc: p.cedulaRuc || p.identificacion || p.cedula_ruc || '',
            fecha_nacimiento: p.fechaNacimiento || p.fecha_nacimiento || '1985-01-01',
            fecha_union: p.fechaUnion || p.fecha_union || '2022-01-01',
            telefono: p.telefono || null,
            direccion: p.direccion || 'Comunidad',
            estado: p.estadoServicio || p.estado || 'ACTIVO',
            version: Number(p.version || 1),
            updated_at: new Date().toISOString()
          }).catch(() => {});
        } else if (mutation.entity === 'medidores') {
          await supabaseClient.syncRecord('medidores', {
            id: entityId,
            id_socio: p.idSocio || p.id_socio,
            id_sector: p.idSector || p.id_sector || '11111111-0000-0000-0000-000000000001',
            numero_medidor: p.numeroMedidor || p.numero_medidor || 'MED-00000',
            alias: p.alias || 'Acometida',
            direccion: p.direccion || '',
            tiene_alcantarillado: Boolean(p.tieneAlcantarillado ?? p.tiene_alcantarillado),
            estado: p.estado || 'ACTIVO',
            version: Number(p.version || 1),
            created_at: p.createdAt || new Date().toISOString(),
            updated_at: new Date().toISOString()
          }).catch(() => {});
        } else if (mutation.entity === 'facturas' || mutation.entity === 'cobros') {
          await supabaseClient.syncRecord('facturas', {
            id: entityId,
            numero_factura: p.numeroFactura || p.numero_factura,
            id_socio: p.idSocio || p.id_socio,
            id_medidor: p.idMedidor || p.id_medidor || null,
            id_periodo: p.idPeriodo || p.id_periodo,
            total_mes: Number(p.totalMes ?? p.total_mes ?? p.totalPagar ?? p.total_pagar ?? 0),
            total_pagar: Number(p.totalPagar ?? p.total_pagar ?? p.totalMes ?? p.total_mes ?? 0),
            estado_pago: p.estadoPago || p.estado_pago || 'PAGADO',
            fecha_pago: p.fechaPago || p.fecha_pago || new Date().toISOString(),
            metodo_pago: p.metodoPago || p.metodo_pago || 'EFECTIVO',
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
    if (!supabaseClient.isEnabled()) {
      res.status(200).json({
        success: true,
        serverTimestamp: new Date().toISOString(),
        socios: [],
        sectores: [],
        medidores: [],
        lecturas: [],
        facturas: [],
        periodos: []
      });
      return;
    }

    const [socRes, secRes, medRes, lecRes, facRes, perRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('socios', 'order=nombres.asc'),
      supabaseClient.fetchRecords<Record<string, unknown>>('sectores', 'order=nombre_sector.asc'),
      supabaseClient.fetchRecords<Record<string, unknown>>('medidores', 'order=created_at.asc'),
      supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', 'order=fecha_lectura.desc&limit=500'),
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas', 'order=created_at.desc&limit=500'),
      supabaseClient.fetchRecords<Record<string, unknown>>('periodos', 'order=fecha_inicio.desc')
    ]);

    const periodos = perRes.data || [];
    const periodosMap = new Map(periodos.map((p) => [p.id, p.periodo_codigo]));

    const lecturas = lecRes.data || [];
    const ultimaLecturaPorMedidor = new Map<string, number>();
    lecturas.forEach((l) => {
      const lact = Number(l.lectura_actual || 0);
      const mId = l.id_medidor as string;
      if (mId && !ultimaLecturaPorMedidor.has(mId) && lact > 0) {
        ultimaLecturaPorMedidor.set(mId, lact);
      }
    });

    const medidores = medRes.data || [];
    const socios = socRes.data || [];

    const normalizedSocios = socios.map((s) => ({
      id: s.id,
      codigoSocio: s.codigo_socio,
      nombres: s.nombres,
      apellidos: s.apellidos,
      nombreCompleto: `${s.nombres || ''} ${s.apellidos || ''}`.trim() || s.codigo_socio,
      cedulaRuc: s.cedula_ruc,
      sectorId: s.id_sector,
      medidorNumero: s.medidor_numero,
      tieneAlcantarillado: Boolean(
        s.tiene_alcantarillado || medidores.some((m) => m.id_socio === s.id && Boolean(m.tiene_alcantarillado))
      ),
      medidores: medidores
        .filter((m) => m.id_socio === s.id)
        .map((m) => {
          const uLect = ultimaLecturaPorMedidor.get(m.id as string) || 0;
          return {
            id: m.id,
            idSocio: m.id_socio,
            numeroMedidor: m.numero_medidor,
            alias: m.alias,
            tieneAlcantarillado: Boolean(m.tiene_alcantarillado),
            lecturaAnterior: uLect,
            lecturaInicial: uLect
          };
        }),
      telefono: s.telefono,
      direccion: s.direccion,
      estadoServicio: s.estado || 'ACTIVO',
      updatedAt: s.updated_at
    }));

    const normalizedLecturas = lecturas.map((l) => {
      const periodoCod = periodosMap.get(l.id_periodo) || l.id_periodo;
      return {
        id: l.id,
        idMedidor: l.id_medidor,
        clienteId: l.id_socio,
        idSocio: l.id_socio,
        periodo: periodoCod,
        periodoCodigo: periodoCod,
        idPeriodo: l.id_periodo,
        lecturaAnterior: Number(Number(l.lectura_anterior || 0).toFixed(2)),
        lecturaActual: Number(Number(l.lectura_actual || 0).toFixed(2)),
        consumoM3: Number(Number(l.consumo_total || 0).toFixed(2)),
        excedenteM3: Number(Number(l.excedente_m3 || 0).toFixed(2)),
        observaciones: l.observaciones || '',
        updatedAt: l.updated_at || l.fecha_lectura
      };
    });

    res.status(200).json({
      success: true,
      serverTimestamp: new Date().toISOString(),
      socios: normalizedSocios,
      sectores: (secRes.data || []).map((sec) => ({
        id: sec.id,
        codigo: sec.codigo_sector,
        nombre: sec.nombre_sector
      })),
      medidores: medidores.map((m) => {
        const uLect = ultimaLecturaPorMedidor.get(m.id as string) || 0;
        return {
          id: m.id,
          idSocio: m.id_socio,
          numeroMedidor: m.numero_medidor,
          alias: m.alias,
          tieneAlcantarillado: Boolean(m.tiene_alcantarillado),
          lecturaAnterior: uLect,
          lecturaInicial: uLect
        };
      }),
      lecturas: normalizedLecturas,
      facturas: facRes.data || [],
      periodos: periodos.map((p) => ({
        id: p.id,
        periodoCodigo: p.periodo_codigo,
        nombre: p.nombre,
        fechaInicio: p.fecha_inicio,
        fechaFin: p.fecha_fin,
        estado: p.estado
      }))
    });
  } catch (error) {
    console.error('[SyncController Pull Error]:', error);
    res.status(500).json({ error: 'Error procesando Pull de datos remotos desde Supabase Cloud.' });
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

    for (const mutation of mutations) {
      const resolution = ConflictResolver.resolveLWW(mutation, undefined);
      acks.push(resolution.ack);
    }

    res.status(200).json({
      serverTimestamp: new Date().toISOString(),
      acks,
      incomingUpdates: {
        clientes: [],
        lecturas: [],
        cobros: [],
        movimientos_caja: []
      }
    });
  } catch (error) {
    console.error('[SyncController] Error procesando lote de sincronización:', error);
    res.status(500).json({ error: 'Error interno procesando sincronización.' });
  }
};

/**
 * Obtiene el estado actual de sincronización con Supabase Cloud
 */
export const getSyncStatus = async (_req: Request, res: Response): Promise<void> => {
  try {
    const isSupabaseConfigured = supabaseClient.isEnabled();
    let supabaseStatus: Record<string, unknown> = {
      configured: isSupabaseConfigured,
      url: supabaseClient.getUrl()
    };

    if (isSupabaseConfigured) {
      const [socRes, medRes, lecRes, facRes] = await Promise.all([
        supabaseClient.fetchRecords('socios', 'select=id'),
        supabaseClient.fetchRecords('medidores', 'select=id'),
        supabaseClient.fetchRecords('lecturas', 'select=id'),
        supabaseClient.fetchRecords('facturas', 'select=id')
      ]);

      supabaseStatus = {
        ...supabaseStatus,
        online: !socRes.error,
        sociosCount: socRes.data ? socRes.data.length : 0,
        medidoresCount: medRes.data ? medRes.data.length : 0,
        lecturasCount: lecRes.data ? lecRes.data.length : 0,
        facturasCount: facRes.data ? facRes.data.length : 0,
        error: socRes.error
      };
    }

    res.status(200).json({
      arquitectura: '2-Capas (IndexedDB Local + Supabase Cloud)',
      supabase: supabaseStatus,
      timestamp: new Date().toISOString()
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error consultando estado de sincronización';
    res.status(500).json({ error: msg });
  }
};

export const handleCloudPush = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json({
      success: true,
      message: 'Sincronización directa hacia Supabase Cloud activa.',
      timestamp: new Date().toISOString()
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error en cloud push';
    res.status(500).json({ error: msg });
  }
};

export const syncWithSupabase = async (_req: Request, res: Response): Promise<void> => {
  try {
    if (!supabaseClient.isEnabled()) {
      res.status(400).json({
        error: 'Supabase no está configurado en las variables de entorno.'
      });
      return;
    }

    const testRes = await supabaseClient.fetchRecords('socios', 'select=id&limit=1');
    res.status(200).json({
      success: !testRes.error,
      connected: !testRes.error,
      error: testRes.error,
      timestamp: new Date().toISOString()
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error conectando con Supabase';
    res.status(500).json({ error: msg });
  }
};

/**
 * Proxy transparente hacia Supabase Cloud REST API.
 * Evita cualquier bloqueo de políticas CORS en navegadores locales (localhost:4000).
 */
export const handleSupabaseProxy = async (req: Request, res: Response): Promise<void> => {
  try {
    const targetPath = (req.query.path as string) || '';
    const supabaseUrl = process.env.SUPABASE_URL || 'https://jvnspjnntmkkjqdziodi.supabase.co';
    const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_SuhM7bXhOuatE9kCcbF5Kg_9jGWoO79';

    // Reconstruir parámetros de consulta omitiendo 'path'
    const queryParams = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query || {})) {
      if (k !== 'path') {
        queryParams.set(k, String(v));
      }
    }
    const queryString = queryParams.toString();
    const destinationUrl = `${supabaseUrl}/rest/v1/${targetPath}${queryString ? '?' + queryString : ''}`;

    const headers: Record<string, string> = {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    };

    if (req.headers && req.headers['prefer']) {
      headers['Prefer'] = req.headers['prefer'] as string;
    }

    const fetchOptions: any = {
      method: req.method || 'GET',
      headers
    };

    if (['POST', 'PATCH', 'PUT'].includes((req.method || '').toUpperCase()) && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const cloudRes = await fetch(destinationUrl, fetchOptions);
    const contentType = cloudRes.headers.get('content-type') || 'application/json';
    const textData = await cloudRes.text();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.status(cloudRes.status).send(textData);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error en Supabase Proxy';
    console.error('[SupabaseProxy Error]:', msg);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(502).json({ error: 'Error conectando con Supabase Cloud', details: msg });
  }
};

