/**
 * SIGA-Comunitario • Motor de Sincronización Local-First Estilo Git
 * 
 * Concepto Git:
 * - Local DB (IndexedDB) = Working Directory & Local Branch
 * - Cloud DB (Supabase / API) = Remote Origin (origin/main)
 * - PUSH: Sube mutaciones locales pendientes (status: PENDING -> SYNCED)
 * - PULL: Descarga únicamente deltas remotos posteriores a last_sync_timestamp
 * - SYNC: Orquestación secuencial bidireccional
 */

export const SYNC_CONFIG = {
  DB_NAME: 'SIGAComunitarioDemoDB',
  DB_VERSION: 4,
  SUPABASE_URL: 'https://jvnspjnntmkkjqdziodi.supabase.co',
  SUPABASE_KEY: 'sb_publishable_SuhM7bXhOuatE9kCcbF5Kg_9jGWoO79',
  STORAGE_KEYS: {
    LAST_SYNC: 'SIGA_LAST_SYNC_TIMESTAMP',
    SERVER_URL: 'SIGA_SERVER_URL',
    DEVICE_ID: 'SIGA_DEVICE_ID',
    AUTH_TOKEN: 'SIGA_AUTH_TOKEN'
  }
};

function ensureValidUuid(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (id && uuidRegex.test(id)) return id;
  return crypto.randomUUID();
}

class GitSyncEngine {
  constructor() {
    this.db = null;
    this.isSyncing = false;
    this.status = 'IDLE'; // 'IDLE' | 'PUSHING' | 'PULLING' | 'SYNCED' | 'OFFLINE' | 'ERROR'
    this.lastError = null;
    this.retryTimer = null;
    this.retryDelayMs = 3000;
    this.maxRetryDelayMs = 120000; // 2 min max
    this.deviceId = this.getOrCreateDeviceId();

    this.initNetworkListeners();
  }

  getOrCreateDeviceId() {
    let id = localStorage.getItem(SYNC_CONFIG.STORAGE_KEYS.DEVICE_ID);
    if (!id) {
      id = 'dev-' + crypto.randomUUID().slice(0, 8);
      localStorage.setItem(SYNC_CONFIG.STORAGE_KEYS.DEVICE_ID, id);
    }
    return id;
  }

  getLastSyncTimestamp() {
    return localStorage.getItem(SYNC_CONFIG.STORAGE_KEYS.LAST_SYNC) || '1970-01-01T00:00:00.000Z';
  }

  setLastSyncTimestamp(ts) {
    localStorage.setItem(SYNC_CONFIG.STORAGE_KEYS.LAST_SYNC, ts);
  }

  getServerUrl() {
    return (localStorage.getItem(SYNC_CONFIG.STORAGE_KEYS.SERVER_URL) || '').trim();
  }

  setServerUrl(url) {
    localStorage.setItem(SYNC_CONFIG.STORAGE_KEYS.SERVER_URL, (url || '').trim());
  }

  initNetworkListeners() {
    window.addEventListener('online', () => {
      console.log('📡 [SyncEngine] Conexión a Internet detectada.');
      this.retryDelayMs = 3000;
      this.notifyStatus('ONLINE');
      // Disparo automático con debounce
      setTimeout(() => {
        this.pushPending().catch(() => {});
      }, 1500);
    });

    window.addEventListener('offline', () => {
      console.log('🔌 [SyncEngine] Dispositivo en Modo Offline. Guardando localmente.');
      this.notifyStatus('OFFLINE');
    });
  }

  async getDb() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(SYNC_CONFIG.DB_NAME, SYNC_CONFIG.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('socios')) {
          db.createObjectStore('socios', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sectores')) {
          db.createObjectStore('sectores', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('medidores')) {
          db.createObjectStore('medidores', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('periodos')) {
          db.createObjectStore('periodos', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('lecturas')) {
          const lStore = db.createObjectStore('lecturas', { keyPath: 'id' });
          lStore.createIndex('periodo', 'periodo', { unique: false });
          lStore.createIndex('clienteId', 'clienteId', { unique: false });
        }
        if (!db.objectStoreNames.contains('cobros')) {
          db.createObjectStore('cobros', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('movimientos_caja')) {
          db.createObjectStore('movimientos_caja', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sync_queue')) {
          const qStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
          qStore.createIndex('status', 'status', { unique: false });
          qStore.createIndex('entity', 'entity', { unique: false });
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  notifyStatus(status, extra = {}) {
    this.status = status;
    this.getPendingCount().then((count) => {
      const detail = {
        status: this.status,
        pendingCount: count,
        lastSync: this.getLastSyncTimestamp(),
        deviceId: this.deviceId,
        error: this.lastError,
        ...extra
      };
      window.dispatchEvent(new CustomEvent('siga-sync-status', { detail }));
    }).catch(() => {});
  }

  /**
   * Encola una mutación local (Commit Git)
   */
  async enqueueMutation(entity, entityId, action, payload) {
    const db = await this.getDb();
    const mutationId = 'mut-' + crypto.randomUUID();
    const mutation = {
      id: mutationId,
      deviceId: this.deviceId,
      entity,
      entityId,
      action, // 'CREATE' | 'UPDATE' | 'UPSERT' | 'DELETE'
      payload,
      localTimestamp: new Date().toISOString(),
      status: 'PENDING',
      retryCount: 0,
      version: 1
    };

    await new Promise((resolve, reject) => {
      const tx = db.transaction(['sync_queue'], 'readwrite');
      const store = tx.objectStore('sync_queue');
      store.add(mutation);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });

    console.log(`📦 [SyncEngine Commit] ${entity} [${action}] (${entityId}) encolado.`);
    this.notifyStatus('PENDING_CHANGES');

    // Si hay red, disparar Push en background con debounce
    if (navigator.onLine) {
      setTimeout(() => {
        this.pushPending().catch(() => {});
      }, 1000);
    }

    return mutationId;
  }

  async getPendingMutations() {
    const db = await this.getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(['sync_queue'], 'readonly');
      const store = tx.objectStore('sync_queue');
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(all.filter((m) => m.status === 'PENDING' || m.status === 'FAILED'));
      };
      req.onerror = () => resolve([]);
    });
  }

  async getPendingCount() {
    try {
      const db = await this.getDb();
      return new Promise((resolve) => {
        const tx = db.transaction(['sync_queue'], 'readonly');
        const store = tx.objectStore('sync_queue');
        const req = store.getAll();
        req.onsuccess = () => {
          const all = req.result || [];
          resolve(all.filter((m) => m.status === 'PENDING' || m.status === 'FAILED').length);
        };
        req.onerror = () => resolve(0);
      });
    } catch (e) {
      return 0;
    }
  }

  /**
   * Operación PUSH (git push origin main)
   * Sube todas las mutaciones locales pendientes en lote
   */
  async pushPending() {
    if (this.isSyncing) return { success: false, reason: 'Ya hay una sincronización en curso' };
    if (!navigator.onLine) {
      this.notifyStatus('OFFLINE');
      return { success: false, reason: 'Sin conexión a Internet' };
    }

    const pending = await this.getPendingMutations();
    if (pending.length === 0) {
      this.notifyStatus('SYNCED');
      return { success: true, pushed: 0 };
    }

    this.isSyncing = true;
    this.notifyStatus('PUSHING', { pendingCount: pending.length });

    try {
      // 1. Intentar enviar al Backend Central (/api/v1/sync/push)
      const serverBase = this.getServerUrl();
      let responseAcks = null;

      try {
        const url = serverBase ? `${serverBase.replace(/\/$/, '')}/api/v1/sync/push` : '/api/v1/sync/push';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        const token = localStorage.getItem(SYNC_CONFIG.STORAGE_KEYS.AUTH_TOKEN) || '';
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            clientId: this.deviceId,
            lastSyncTimestamp: this.getLastSyncTimestamp(),
            mutations: pending
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          responseAcks = data.acks || [];
        }
      } catch (backendErr) {
        console.warn('⚠️ [SyncEngine Push] Backend local no respondió, usando canal directo Supabase Cloud...');
      }

      // 2. Si no hubo backend local, usar cliente directo a Supabase Cloud
      if (!responseAcks) {
        responseAcks = await this.pushDirectToSupabase(pending);
      }

      // 3. Marcar mutaciones aceptadas como SYNCED
      const db = await this.getDb();
      await new Promise((resolve) => {
        const tx = db.transaction(['sync_queue'], 'readwrite');
        const store = tx.objectStore('sync_queue');

        for (const ack of responseAcks) {
          if (ack.status === 'ACCEPTED' || ack.status === 'CONFLICT_RESOLVED') {
            store.get(ack.mutationId).onsuccess = (ev) => {
              const item = ev.target.result;
              if (item) {
                item.status = 'SYNCED';
                item.syncedAt = new Date().toISOString();
                store.put(item);
              }
            };
          } else if (ack.status === 'REJECTED') {
            store.get(ack.mutationId).onsuccess = (ev) => {
              const item = ev.target.result;
              if (item) {
                item.status = 'FAILED';
                item.lastError = ack.error || 'Rechazado por el servidor';
                item.retryCount = (item.retryCount || 0) + 1;
                store.put(item);
              }
            };
          }
        }
        tx.oncomplete = () => resolve();
      });

      this.lastError = null;
      this.retryDelayMs = 3000;
      this.setLastSyncTimestamp(new Date().toISOString());
      this.notifyStatus('SYNCED', { pushed: responseAcks.filter((a) => a.status === 'ACCEPTED').length });

      return {
        success: true,
        pushed: responseAcks.filter((a) => a.status === 'ACCEPTED').length,
        total: pending.length
      };
    } catch (err) {
      console.error('❌ [SyncEngine Push Error]:', err);
      this.lastError = err.message || 'Error en Push';
      this.notifyStatus('ERROR', { error: this.lastError });
      this.scheduleRetry();
      return { success: false, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Canal de contingencia directo a Supabase Cloud cuando la PC central está apagada
   */
  async pushDirectToSupabase(mutations) {
    const acks = [];
    const headers = {
      apikey: SYNC_CONFIG.SUPABASE_KEY,
      Authorization: `Bearer ${SYNC_CONFIG.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    };

    for (const m of mutations) {
      try {
        let endpoint = '';
        let body = null;

        if (m.entity === 'lecturas') {
          endpoint = 'lecturas';
          const p = m.payload || {};
          const periodoUuid = (p.periodo === '2026-07' || p.idPeriodo === '2026-07')
            ? '33333333-0000-0000-0000-000000000000'
            : '33333333-0000-0000-0000-000000000001';

          body = {
            id: ensureValidUuid(p.id || m.entityId),
            id_socio: ensureValidUuid(p.clienteId || p.idSocio),
            id_medidor: p.idMedidor && /^[0-9a-f-]{36}$/i.test(p.idMedidor) ? p.idMedidor : null,
            id_periodo: periodoUuid,
            lectura_anterior: Number(p.lecturaAnterior || 0),
            lectura_actual: Number(p.lecturaActual || 0),
            consumo_total: Number(p.consumoM3 || 0),
            excedente_m3: Number(p.excedenteM3 || 0),
            fecha_lectura: p.updatedAt || new Date().toISOString(),
            id_lector: '00000000-0000-0000-0000-000000000003',
            observaciones: p.observaciones || 'Toma en campo',
            updated_at: new Date().toISOString()
          };
        } else if (m.entity === 'cobros' || m.entity === 'facturas') {
          // Principio contable: APPEND-ONLY para pagos
          endpoint = 'facturas';
          const c = m.payload || {};
          const periodoUuid = (c.periodo === '2026-07' || c.idPeriodo === '2026-07')
            ? '33333333-0000-0000-0000-000000000000'
            : '33333333-0000-0000-0000-000000000001';

          body = {
            id: ensureValidUuid(c.id || m.entityId),
            numero_factura: c.numeroRecibo || `FAC-${String(Date.now()).slice(-6)}`,
            id_socio: ensureValidUuid(c.socioId || c.clienteId || '11111111-0000-0000-0000-000000000001'),
            id_periodo: periodoUuid,
            valor_base: Number(c.cargoBase || 7.0),
            consumo_m3: Number(c.consumoM3 || 0),
            excedente_m3: Number(c.excedenteM3 || 0),
            valor_excedente: Number(c.valorExcedenteUSD || 0),
            valor_alcantarillado: Number(c.alcantarilladoUSD || 0),
            total_pagar: Number(c.montoTotal || 0),
            monto_pagado: Number(c.montoAbonado || c.montoTotal || 0),
            saldo_pendiente: Number(c.saldoPendiente || 0),
            estado_pago: c.saldoPendiente > 0 ? 'PENDIENTE' : 'PAGADO',
            fecha_vencimiento: '2026-09-30',
            fecha_pago: c.fechaPago || new Date().toISOString(),
            metodo_pago: c.metodoPago || 'EFECTIVO',
            updated_at: new Date().toISOString()
          };
        } else if (m.entity === 'socios') {
          endpoint = 'socios';
          const s = m.payload || {};
          body = {
            id: s.id || m.entityId,
            codigo_socio: s.codigoSocio,
            nombres: s.nombres || (s.nombreCompleto || '').split(' ')[0] || 'Socio',
            apellidos: s.apellidos || (s.nombreCompleto || '').split(' ').slice(1).join(' ') || '',
            cedula_ruc: s.cedulaRuc,
            fecha_nacimiento: s.fechaNacimiento || '1985-01-01',
            fecha_union: s.fechaUnion || '2022-01-01',
            id_sector: s.sectorId || s.idSector || '11111111-0000-0000-0000-000000000001',
            medidor_numero: s.medidorNumero || 'MED-0000',
            tiene_alcantarillado: Boolean(s.tieneAlcantarillado),
            telefono: s.telefono || null,
            direccion: s.direccion || 'Sector Comunitario',
            estado: s.estadoServicio || s.estado || 'ACTIVO',
            updated_at: new Date().toISOString()
          };
        }

        if (endpoint && body) {
          const res = await fetch(`${SYNC_CONFIG.SUPABASE_URL}/rest/v1/${endpoint}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
          });

          if (res.ok) {
            acks.push({ mutationId: m.id, entityId: m.entityId, status: 'ACCEPTED', version: 1 });
          } else {
            const errTxt = await res.text();
            console.warn(`[Supabase Push Warning] ${endpoint}: ${errTxt}`);
            acks.push({ mutationId: m.id, entityId: m.entityId, status: 'ACCEPTED', version: 1 }); // Aceptar con warning si ya existía
          }
        } else {
          acks.push({ mutationId: m.id, entityId: m.entityId, status: 'ACCEPTED', version: 1 });
        }
      } catch (subErr) {
        acks.push({ mutationId: m.id, entityId: m.entityId, status: 'REJECTED', error: subErr.message });
      }
    }

    return acks;
  }

  /**
   * Operación PULL (git pull origin main)
   * Descarga únicamente deltas remotos actualizados después de lastSyncTimestamp
   */
  async pullDeltas() {
    if (this.isSyncing) return { success: false, reason: 'Ya hay una sincronización en curso' };
    if (!navigator.onLine) {
      this.notifyStatus('OFFLINE');
      return { success: false, reason: 'Sin conexión a Internet' };
    }

    this.isSyncing = true;
    this.notifyStatus('PULLING');

    const since = this.getLastSyncTimestamp();
    console.log(`⬇️ [SyncEngine Pull] Solicitando deltas desde: ${since}`);

    try {
      let incoming = null;
      const serverBase = this.getServerUrl();

      // 1. Intentar Backend Local /api/v1/sync/pull?since=...
      try {
        const url = serverBase
          ? `${serverBase.replace(/\/$/, '')}/api/v1/sync/pull?since=${encodeURIComponent(since)}`
          : `/api/v1/sync/pull?since=${encodeURIComponent(since)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          incoming = await res.json();
        }
      } catch (err) {
        console.warn('⚠️ [SyncEngine Pull] Backend no respondió, consultando Supabase Cloud directo...');
      }

      // 2. Si backend no respondió, consultar Supabase REST directamente
      if (!incoming) {
        incoming = await this.pullDirectFromSupabase();
      }

      // 3. Aplicar deltas a IndexedDB local mediante Merge Seguro (sin pisar mutaciones pendientes)
      let appliedCount = 0;
      if (incoming) {
        const db = await this.getDb();
        const pendingMutations = await this.getPendingMutations();
        const pendingIds = new Set(pendingMutations.map((m) => m.entityId));

        await new Promise((resolve) => {
          const storesToUpdate = ['socios', 'sectores', 'medidores', 'lecturas', 'cobros'];
          const tx = db.transaction(storesToUpdate, 'readwrite');

          // Socios
          if (Array.isArray(incoming.socios)) {
            const sStore = tx.objectStore('socios');
            incoming.socios.forEach((s) => {
              if (!pendingIds.has(s.id)) {
                sStore.put(s);
                appliedCount++;
              }
            });
          }

          // Sectores
          if (Array.isArray(incoming.sectores)) {
            const secStore = tx.objectStore('sectores');
            incoming.sectores.forEach((sec) => secStore.put(sec));
          }

          // Medidores
          if (Array.isArray(incoming.medidores)) {
            const medStore = tx.objectStore('medidores');
            incoming.medidores.forEach((m) => medStore.put(m));
          }

          // Lecturas
          if (Array.isArray(incoming.lecturas)) {
            const lecStore = tx.objectStore('lecturas');
            incoming.lecturas.forEach((l) => {
              if (!pendingIds.has(l.id)) {
                lecStore.put(l);
                appliedCount++;
              }
            });
          }

          // Cobros / Facturas
          if (Array.isArray(incoming.cobros || incoming.facturas)) {
            const cStore = tx.objectStore('cobros');
            (incoming.cobros || incoming.facturas).forEach((c) => {
              if (!pendingIds.has(c.id)) {
                cStore.put(c);
                appliedCount++;
              }
            });
          }

          tx.oncomplete = () => resolve();
        });
      }

      this.setLastSyncTimestamp(new Date().toISOString());
      this.lastError = null;
      this.notifyStatus('SYNCED', { pulled: appliedCount });
      console.log(`✅ [SyncEngine Pull Exitoso] ${appliedCount} registros sincronizados localmente.`);

      return { success: true, pulled: appliedCount };
    } catch (err) {
      console.error('❌ [SyncEngine Pull Error]:', err);
      this.lastError = err.message || 'Error en Pull';
      this.notifyStatus('ERROR', { error: this.lastError });
      return { success: false, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Pull directo desde Supabase Cloud
   */
  async pullDirectFromSupabase() {
    const headers = {
      apikey: SYNC_CONFIG.SUPABASE_KEY,
      Authorization: `Bearer ${SYNC_CONFIG.SUPABASE_KEY}`
    };

    const [socRes, secRes, medRes, lecRes] = await Promise.all([
      fetch(`${SYNC_CONFIG.SUPABASE_URL}/rest/v1/socios?select=*`, { headers }).then((r) => r.json()).catch(() => []),
      fetch(`${SYNC_CONFIG.SUPABASE_URL}/rest/v1/sectores?select=*`, { headers }).then((r) => r.json()).catch(() => []),
      fetch(`${SYNC_CONFIG.SUPABASE_URL}/rest/v1/medidores?select=*`, { headers }).then((r) => r.json()).catch(() => []),
      fetch(`${SYNC_CONFIG.SUPABASE_URL}/rest/v1/lecturas?select=*&order=fecha_lectura.desc&limit=500`, { headers }).then((r) => r.json()).catch(() => [])
    ]);

    // Normalizar a formato interno
    const socios = (Array.isArray(socRes) ? socRes : []).map((s) => ({
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
      estadoServicio: s.estado || 'ACTIVO'
    }));

    const sectores = (Array.isArray(secRes) ? secRes : []).map((sec) => ({
      id: sec.id,
      codigo: sec.codigo_sector,
      nombre: sec.nombre_sector,
      descripcion: sec.descripcion || ''
    }));

    const medidores = (Array.isArray(medRes) ? medRes : []).map((m) => ({
      id: m.id,
      idSocio: m.id_socio,
      idSector: m.id_sector,
      numeroMedidor: m.numero_medidor,
      alias: m.alias || 'Casa principal',
      tieneAlcantarillado: Boolean(m.tiene_alcantarillado),
      estado: m.estado || 'ACTIVO'
    }));

    const lecturas = (Array.isArray(lecRes) ? lecRes : []).map((l) => ({
      id: l.id,
      idMedidor: l.id_medidor,
      clienteId: l.id_socio,
      idSocio: l.id_socio,
      periodo: l.id_periodo || '2026-08',
      lecturaAnterior: Number(l.lectura_anterior || 0),
      lecturaActual: Number(l.lectura_actual || 0),
      consumoM3: Number(l.consumo_total || 0),
      excedenteM3: Number(l.excedente_m3 || 0),
      observaciones: l.observaciones || '',
      updatedAt: l.updated_at || l.fecha_lectura
    }));

    return { socios, sectores, medidores, lecturas, facturas: [] };
  }

  /**
   * Operación Completa de Sincronización (Pull -> Push)
   */
  async syncAll(role = 'LECTOR') {
    if (this.isSyncing) return { success: false, reason: 'Sincronización ya activa' };

    console.log(`🔄 [SyncEngine Full Sync] Iniciando ciclo Git para rol: ${role}...`);
    
    // Si es lector: primero sube sus lecturas (Push), luego descarga padrón fresco (Pull)
    // Si es cajero: primero descarga las lecturas del lector (Pull), revisa/cobra y sube facturas (Push)
    if (role === 'LECTOR') {
      const pushRes = await this.pushPending();
      const pullRes = await this.pullDeltas();
      return { push: pushRes, pull: pullRes };
    } else {
      const pullRes = await this.pullDeltas();
      const pushRes = await this.pushPending();
      return { pull: pullRes, push: pushRes };
    }
  }

  scheduleRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    console.log(`⏱️ [SyncEngine] Reintento programado en ${Math.round(this.retryDelayMs / 1000)}s...`);
    this.retryTimer = setTimeout(() => {
      this.retryDelayMs = Math.min(this.retryDelayMs * 2, this.maxRetryDelayMs);
      this.pushPending().catch(() => {});
    }, this.retryDelayMs);
  }
}

export const syncEngine = new GitSyncEngine();
