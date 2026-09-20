/**
 * SIGA-Comunitario • Motor de Sincronización Local-First Estilo Git
 * 
 * Arquitectura Pura:
 * - Local DB (IndexedDB) = Working Directory & Local Branch en cada dispositivo (Móvil / PC)
 * - Cloud DB (Supabase PostgreSQL REST API) = Remote Origin (origin/main)
 * - PUSH: Sube mutaciones locales pendientes directamente a Supabase Cloud
 * - PULL: Descarga padrón, lecturas, períodos y facturas desde Supabase Cloud a IndexedDB
 * - CIERRE DE CICLO: Liquida planillas, cierra período, abre nuevo período y moviliza lecturas en Supabase
 * - COBROS: Actualiza cuentas corrientes y estados de pago en Supabase e IndexedDB
 */

export const SYNC_CONFIG = {
  DB_NAME: 'SIGAComunitarioDemoDB',
  DB_VERSION: 6,
  SUPABASE_URL: 'https://jvnspjnntmkkjqdziodi.supabase.co',
  SUPABASE_KEY: 'sb_publishable_SuhM7bXhOuatE9kCcbF5Kg_9jGWoO79',
  STORAGE_KEYS: {
    LAST_SYNC: 'SIGA_LAST_SYNC_TIMESTAMP',
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
    this.isSimulatedOffline = false;

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
    return localStorage.getItem('SIGA_SERVER_URL') || SYNC_CONFIG.SUPABASE_URL;
  }

  setServerUrl(url) {
    if (url) {
      localStorage.setItem('SIGA_SERVER_URL', url);
    } else {
      localStorage.removeItem('SIGA_SERVER_URL');
    }
  }

  initNetworkListeners() {
    window.addEventListener('online', () => {
      console.log('📡 [SyncEngine] Conexión a Internet detectada.');
      this.retryDelayMs = 3000;
      this.notifyStatus('ONLINE');
      // Disparo automático con debounce al volver internet
      setTimeout(() => {
        this.pushPending().catch(() => {});
      }, 1500);
    });

    window.addEventListener('offline', () => {
      console.log('🔌 [SyncEngine] Dispositivo en Modo Offline. Operando con IndexedDB local.');
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
        if (!db.objectStoreNames.contains('multas_rubros')) {
          const mulStore = db.createObjectStore('multas_rubros', { keyPath: 'id' });
          mulStore.createIndex('idSocio', 'idSocio', { unique: false });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        try {
          await this.ensureDataSeeded();
          await this.purgeTestRecords();
        } catch (seedErr) {
          console.warn('[SyncEngine] Aviso al sembrar datos iniciales:', seedErr);
        }
        resolve(this.db);
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  async ensureDataSeeded() {
    if (!this.db) return;
    if (this._seedingPromise) return this._seedingPromise;

    this._seedingPromise = (async () => {
      const sociosCount = await new Promise((resolve) => {
        try {
          const tx = this.db.transaction(['socios'], 'readonly');
          const req = tx.objectStore('socios').count();
          req.onsuccess = () => resolve(req.result || 0);
          req.onerror = () => resolve(0);
        } catch (e) {
          resolve(0);
        }
      });

      if (sociosCount > 0) {
        // Verificar si multas_rubros requiere re-siembra incremental
        if (this.db.objectStoreNames.contains('multas_rubros')) {
          try {
            const multasCount = await new Promise((res) => {
              const tx = this.db.transaction(['multas_rubros'], 'readonly');
              const req = tx.objectStore('multas_rubros').count();
              req.onsuccess = () => res(req.result || 0);
              req.onerror = () => res(0);
            });
            if (multasCount === 0) {
              console.log('🌱 [SyncEngine] Sembrando almacén multas_rubros incrementalmente...');
              const res = await fetch('./offline_seed.json');
              if (res.ok) {
                const freshSeed = await res.json();
                if (Array.isArray(freshSeed.multas_rubros) && freshSeed.multas_rubros.length > 0) {
                  await new Promise((resolve) => {
                    const tx = this.db.transaction(['multas_rubros', 'socios'], 'readwrite');
                    const mulStore = tx.objectStore('multas_rubros');
                    const sStore = tx.objectStore('socios');
                    freshSeed.multas_rubros.forEach((m) => mulStore.put(m));
                    if (Array.isArray(freshSeed.socios)) {
                      freshSeed.socios.forEach((s) => {
                        if (Array.isArray(s.multas) && s.multas.length > 0) {
                          sStore.put(s);
                        }
                      });
                    }
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => resolve();
                  });
                  console.log(`✅ [SyncEngine] ${freshSeed.multas_rubros.length} multas sembradas incrementalmente.`);
                }
              }
            }
          } catch (mErr) {
            console.warn('[SyncEngine] Error verificando multas_rubros:', mErr);
          }
        }
        return;
      }

      console.log('🌱 [SyncEngine] Base local sin socios. Inicializando padrón...');

      let seedData = null;

      // 1. Si hay conexión a Internet, cargar DIRECTAMENTE desde la nube para datos 100% frescos
      if (navigator.onLine) {
        try {
          const cloudData = await this.pullDirectFromSupabase();
          if (cloudData && Array.isArray(cloudData.socios) && cloudData.socios.length > 0) {
            seedData = cloudData;
            console.log(`📡 [SyncEngine] Padrón inicial cargado directamente desde Supabase Cloud (${seedData.socios.length} socios).`);
          }
        } catch (e) {
          console.warn('[SyncEngine] No se pudo conectar a la nube para carga inicial, recurriendo a respaldo:', e);
        }
      }

      // 2. Si falló la nube o estamos offline, cargar respaldo local offline_seed.json
      if (!seedData) {
        try {
          const res = await fetch('./offline_seed.json');
          if (res.ok) {
            seedData = await res.json();
          }
        } catch (e) {
          console.warn('[SyncEngine] Fallback offline_seed.json local no disponible:', e);
        }
      }

      if (seedData) {
        await new Promise((resolve) => {
          const stores = ['socios', 'sectores', 'medidores', 'lecturas', 'periodos'];
          if (this.db.objectStoreNames.contains('multas_rubros')) {
            stores.push('multas_rubros');
          }
          const tx = this.db.transaction(stores, 'readwrite');
          const sStore = tx.objectStore('socios');
          const secStore = tx.objectStore('sectores');
          const mStore = tx.objectStore('medidores');
          const lStore = tx.objectStore('lecturas');
          const pStore = tx.objectStore('periodos');
          const mulStore = this.db.objectStoreNames.contains('multas_rubros') ? tx.objectStore('multas_rubros') : null;

          if (Array.isArray(seedData.sectores)) {
            seedData.sectores.forEach((sec) => secStore.put(sec));
          }

          if (Array.isArray(seedData.socios)) {
            seedData.socios.forEach((s) => {
              sStore.put(s);
              if (Array.isArray(s.medidores)) {
                s.medidores.forEach((m) => mStore.put(m));
              }
              if (mulStore && Array.isArray(s.multas)) {
                s.multas.forEach((mul) => mulStore.put(mul));
              }
            });
          }

          if (Array.isArray(seedData.medidores)) {
            seedData.medidores.forEach((m) => mStore.put(m));
          }

          if (mulStore && Array.isArray(seedData.multas_rubros)) {
            seedData.multas_rubros.forEach((mul) => mulStore.put(mul));
          }

          if (Array.isArray(seedData.lecturas)) {
            seedData.lecturas.forEach((l) => lStore.put(l));
          }

          if (Array.isArray(seedData.periodos)) {
            seedData.periodos.forEach((p) => pStore.put(p));
          } else {
            // Períodos predeterminados
            pStore.put({ id: '33333333-0000-0000-0000-000000000000', periodoCodigo: '2026-07', nombre: 'Período Julio 2026', estado: 'CERRADO' });
            pStore.put({ id: '33333333-0000-0000-0000-000000000001', periodoCodigo: '2026-08', nombre: 'Período Agosto 2026', estado: 'ABIERTO' });
          }

          tx.oncomplete = () => {
            console.log(`✅ [SyncEngine] Padrón comunitario precargado exitosamente (${seedData.socios?.length || 0} socios).`);
            resolve();
          };
          tx.onerror = () => resolve();
        });
      }
    })();

    return this._seedingPromise;
  }

  async purgeTestRecords() {
    if (!this.db) return;
    try {
      if (this.db.objectStoreNames.contains('cobros')) {
        const tx = this.db.transaction(['cobros'], 'readwrite');
        const store = tx.objectStore('cobros');
        store.delete('217175d9-8813-47d1-ac06-ac054dffcbd3');
        const req = store.getAll();
        req.onsuccess = () => {
          (req.result || []).forEach((c) => {
            const num = String(c.numeroRecibo || c.numeroFactura || c.id || '');
            if (num.includes('238832') || c.id === '217175d9-8813-47d1-ac06-ac054dffcbd3') {
              store.delete(c.id);
              console.log('[SyncEngine] Cobro de prueba purgado:', c.id, num);
            }
          });
        };
      }
    } catch (e) {}

    try {
      if (this.db.objectStoreNames.contains('mutations_queue')) {
        const txMut = this.db.transaction(['mutations_queue'], 'readwrite');
        const storeMut = txMut.objectStore('mutations_queue');
        const reqMut = storeMut.getAll();
        reqMut.onsuccess = () => {
          (reqMut.result || []).forEach((m) => {
            if (
              m.entityId === '217175d9-8813-47d1-ac06-ac054dffcbd3' ||
              JSON.stringify(m).includes('238832')
            ) {
              storeMut.delete(m.id);
              console.log('[SyncEngine] Mutación de prueba purgada de mutations_queue:', m.id);
            }
          });
        };
      }
    } catch (e) {}

    try {
      if (this.db.objectStoreNames.contains('sync_queue')) {
        const txSync = this.db.transaction(['sync_queue'], 'readwrite');
        const storeSync = txSync.objectStore('sync_queue');
        const reqSync = storeSync.getAll();
        reqSync.onsuccess = () => {
          (reqSync.result || []).forEach((s) => {
            if (
              s.entityId === '217175d9-8813-47d1-ac06-ac054dffcbd3' ||
              JSON.stringify(s).includes('238832')
            ) {
              storeSync.delete(s.id);
            }
          });
        };
      }
    } catch (e) {}
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
    if (navigator.onLine && !this.isSimulatedOffline) {
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
   * Resuelve el UUID del período dinámicamente desde IndexedDB o Supabase Cloud
   */
  async resolvePeriodoUuid(periodoCodigoOrId) {
    if (periodoCodigoOrId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(periodoCodigoOrId)) {
      return periodoCodigoOrId;
    }

    // 1. Buscar en IndexedDB local
    try {
      const db = await this.getDb();
      const periodos = await new Promise((res) => {
        const tx = db.transaction(['periodos'], 'readonly');
        const req = tx.objectStore('periodos').getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      });

      if (periodoCodigoOrId) {
        const match = periodos.find(
          (p) => p.periodoCodigo === periodoCodigoOrId || p.periodo_codigo === periodoCodigoOrId || p.id === periodoCodigoOrId
        );
        if (match && match.id && /^[0-9a-f-]{36}$/i.test(match.id)) {
          return match.id;
        }
      }

      const abierto = periodos.find((p) => p.estado === 'ABIERTO');
      if (abierto && abierto.id && /^[0-9a-f-]{36}$/i.test(abierto.id)) {
        return abierto.id;
      }
    } catch {}

    // 2. Consultar directamente a Supabase Cloud
    try {
      if (periodoCodigoOrId) {
        const res = await this.fetchSupabase(
          `periodos?periodo_codigo=eq.${encodeURIComponent(periodoCodigoOrId)}&select=id`
        );
        if (res.ok) {
          const rows = await res.json();
          if (rows && rows.length > 0 && rows[0].id) {
            return rows[0].id;
          }
        }
      }

      const resAbierto = await this.fetchSupabase('periodos?estado=eq.ABIERTO&select=id&limit=1');
      if (resAbierto.ok) {
        const rows = await resAbierto.json();
        if (rows && rows.length > 0 && rows[0].id) {
          return rows[0].id;
        }
      }
    } catch {}

    return null;
  }

  /**
   * Resuelve el UUID del socio dinámicamente desde IndexedDB o Supabase Cloud
   */
  async resolveSocioUuid(socioIdOrCode, idMedidor = null) {
    if (socioIdOrCode && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(socioIdOrCode)) {
      return socioIdOrCode;
    }

    // 1. Buscar en IndexedDB
    try {
      const db = await this.getDb();
      const socios = await new Promise((res) => {
        const tx = db.transaction(['socios'], 'readonly');
        const req = tx.objectStore('socios').getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      });

      if (socioIdOrCode) {
        const cleanTarget = String(socioIdOrCode).trim().toLowerCase();
        const match = socios.find((s) =>
          s.id === socioIdOrCode ||
          String(s.codigoSocio || s.codigo_socio || '').trim().toLowerCase() === cleanTarget ||
          String(s.cedulaRuc || s.cedula_ruc || '').trim().toLowerCase() === cleanTarget
        );
        if (match && match.id && /^[0-9a-f-]{36}$/i.test(match.id)) {
          return match.id;
        }
      }

      if (idMedidor) {
        const medidores = await new Promise((res) => {
          const tx = db.transaction(['medidores'], 'readonly');
          const req = tx.objectStore('medidores').getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => res([]);
        });
        const mMatch = medidores.find((m) => m.id === idMedidor || m.idMedidor === idMedidor);
        if (mMatch && (mMatch.idSocio || mMatch.id_socio) && /^[0-9a-f-]{36}$/i.test(mMatch.idSocio || mMatch.id_socio)) {
          return mMatch.idSocio || mMatch.id_socio;
        }
      }
    } catch {}

    // 2. Consultar directamente a Supabase Cloud
    try {
      if (socioIdOrCode) {
        const res = await this.fetchSupabase(
          `socios?or=(codigo_socio.eq.${encodeURIComponent(socioIdOrCode)},cedula_ruc.eq.${encodeURIComponent(socioIdOrCode)})&select=id`
        );
        if (res.ok) {
          const rows = await res.json();
          if (rows && rows.length > 0 && rows[0].id) {
            return rows[0].id;
          }
        }
      }

      if (idMedidor) {
        const resM = await this.fetchSupabase(`medidores?id=eq.${encodeURIComponent(idMedidor)}&select=id_socio`);
        if (resM.ok) {
          const rows = await resM.json();
          if (rows && rows.length > 0 && rows[0].id_socio) {
            return rows[0].id_socio;
          }
        }
      }
    } catch {}

    return null;
  }

  /**
   * Resuelve el UUID del lector dinámicamente desde el contexto o Supabase Cloud
   */
  async resolveLectorUuid(idLectorOrUser = null) {
    if (idLectorOrUser && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idLectorOrUser)) {
      return idLectorOrUser;
    }

    try {
      const storedUserRaw = localStorage.getItem('SIGA_USER') || localStorage.getItem('currentUser');
      if (storedUserRaw) {
        const u = JSON.parse(storedUserRaw);
        const uId = u.id || u.id_usuario || u.uuid;
        if (uId && /^[0-9a-f-]{36}$/i.test(uId)) {
          return uId;
        }
      }
    } catch {}

    try {
      const res = await this.fetchSupabase('usuarios?rol=in.(LECTOR,ADMIN,CAJERO)&select=id&limit=1');
      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0 && rows[0].id) {
          return rows[0].id;
        }
      }
    } catch {}

    return null;
  }

  /**
   * Resuelve el UUID del medidor dinámicamente desde IndexedDB o Supabase Cloud
   */
  async resolveMedidorUuid(socioId, numeroMedidor) {
    if (numeroMedidor && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(numeroMedidor)) {
      return numeroMedidor;
    }

    try {
      const db = await this.getDb();
      const medidores = await new Promise((res) => {
        const tx = db.transaction(['medidores'], 'readonly');
        const req = tx.objectStore('medidores').getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      });

      if (numeroMedidor) {
        const cleanTarget = String(numeroMedidor).trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const byNum = medidores.find((m) => {
          const num = m.numeroMedidor || m.numero_medidor || m.id;
          if (!num) return false;
          return String(num).trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === cleanTarget;
        });
        if (byNum && byNum.id && /^[0-9a-f-]{36}$/i.test(byNum.id)) {
          return byNum.id;
        }
      }

      if (socioId) {
        const bySocio = medidores.filter((m) => {
          const sId = m.idSocio || m.id_socio;
          return sId && String(sId).toLowerCase() === String(socioId).toLowerCase();
        });
        if (bySocio.length > 0 && bySocio[0].id && /^[0-9a-f-]{36}$/i.test(bySocio[0].id)) {
          return bySocio[0].id;
        }
      }
    } catch {}

    // Consultar directamente en Supabase Cloud
    try {
      let query = '';
      if (numeroMedidor) {
        query = `numero_medidor=eq.${encodeURIComponent(numeroMedidor)}`;
      } else if (socioId && /^[0-9a-f-]{36}$/i.test(socioId)) {
        query = `id_socio=eq.${encodeURIComponent(socioId)}`;
      }
      if (query) {
        const res = await this.fetchSupabase(`medidores?${query}&select=id`);
        if (res.ok) {
          const rows = await res.json();
          if (rows && rows.length > 0 && rows[0].id) {
            return rows[0].id;
          }
        }
      }
    } catch {}

    return null;
  }

  /**
   * Operación PUSH (git push origin main)
   * Sube todas las mutaciones locales pendientes directamente a Supabase Cloud
   */
  async pushPending(force = false) {
    const now = Date.now();
    if (this.isSyncing && !force) {
      if (this._syncStartedAt && (now - this._syncStartedAt > 15000)) {
        console.warn('⚠️ [SyncEngine] Sync lock timeout (>15s). Liberando bloqueo automáticamente.');
        this.isSyncing = false;
      } else {
        return { success: false, reason: 'Ya hay una sincronización en curso' };
      }
    }

    if (!navigator.onLine || this.isSimulatedOffline) {
      this.notifyStatus('OFFLINE');
      return { success: false, reason: 'Sin conexión a Internet' };
    }

    const pending = await this.getPendingMutations();
    if (pending.length === 0) {
      this.notifyStatus('SYNCED');
      return { success: true, pushed: 0, total: 0, rejected: 0 };
    }

    this.isSyncing = true;
    this._syncStartedAt = now;
    this.notifyStatus('PUSHING', { pendingCount: pending.length });

    try {
      console.log(`⬆️ [SyncEngine Push] Iniciando subida de ${pending.length} mutaciones pendientes a Supabase Cloud...`);
      const responseAcks = await this.pushDirectToSupabase(pending);

      const db = await this.getDb();
      const pendingMap = new Map(pending.map((m) => [m.id, m]));

      await new Promise((resolve) => {
        const tx = db.transaction(['sync_queue'], 'readwrite');
        const store = tx.objectStore('sync_queue');

        for (const ack of responseAcks) {
          const item = pendingMap.get(ack.mutationId);
          if (item) {
            if (ack.status === 'ACCEPTED' || ack.status === 'CONFLICT_RESOLVED') {
              item.status = 'SYNCED';
              item.syncedAt = new Date().toISOString();
              item.lastError = null;
              store.put(item);
            } else if (ack.status === 'REJECTED') {
              item.retryCount = (item.retryCount || 0) + 1;
              item.lastError = ack.error || 'Rechazado por Supabase';
              if (item.retryCount >= 5) {
                console.warn(`⚠️ [SyncEngine] Mutación ${item.id} desestimada tras 5 reintentos: ${item.lastError}`);
                item.status = 'CANCELLED';
              } else {
                item.status = 'FAILED';
              }
              store.put(item);
            }
          }
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });

      this.lastError = null;
      this.retryDelayMs = 3000;
      this.setLastSyncTimestamp(new Date().toISOString());

      const pushedCount = responseAcks.filter((a) => a.status === 'ACCEPTED' || a.status === 'CONFLICT_RESOLVED').length;
      const rejectedCount = pending.length - pushedCount;

      console.log(`🏁 [SyncEngine Push Terminado] ${pushedCount} subidos con éxito, ${rejectedCount} con observaciones.`);
      this.notifyStatus(rejectedCount === 0 ? 'SYNCED' : 'PENDING_CHANGES', { pushed: pushedCount, pendingCount: rejectedCount });

      return {
        success: pushedCount > 0 || pending.length === 0,
        pushed: pushedCount,
        rejected: rejectedCount,
        total: pending.length,
        acks: responseAcks
      };
    } catch (err) {
      console.error('❌ [SyncEngine Push Error]:', err);
      this.lastError = err.message || 'Error en Push';
      this.notifyStatus('ERROR', { error: this.lastError });
      this.scheduleRetry();
      return { success: false, error: err.message };
    } finally {
      this.isSyncing = false;
      this._syncStartedAt = 0;
    }
  }

  /**
   * Canal directo a Supabase Cloud con resolución correcta de on_conflict y claves foráneas
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
          endpoint = 'lecturas?on_conflict=id_medidor,id_periodo';
          const p = m.payload || {};

          const periodoUuid = await this.resolvePeriodoUuid(p.periodo || p.idPeriodo || p.periodoCodigo);

          let idMedidor = p.idMedidor || p.id_medidor;
          if (!idMedidor || !/^[0-9a-f-]{36}$/i.test(idMedidor)) {
            idMedidor = await this.resolveMedidorUuid(p.clienteId || p.idSocio, p.numeroMedidor || p.medidorNumero);
          }

          if (!idMedidor) {
            console.warn(`[Supabase Push] id_medidor UUID no encontrado para lectura de socio ${p.clienteId || p.idSocio}`);
            acks.push({ mutationId: m.id, entityId: m.entityId, status: 'REJECTED', error: 'id_medidor no encontrado' });
            continue;
          }

          let idSocio = await this.resolveSocioUuid(p.clienteId || p.idSocio, idMedidor);
          if (!idSocio) {
            console.warn(`[Supabase Push] id_socio UUID no encontrado para medidor ${idMedidor}`);
            acks.push({ mutationId: m.id, entityId: m.entityId, status: 'REJECTED', error: 'id_socio no encontrado' });
            continue;
          }

          let idLector = await this.resolveLectorUuid(p.idLector || p.id_lector);
          if (!idLector) {
            console.warn(`[Supabase Push] id_lector UUID no encontrado para la lectura`);
            acks.push({ mutationId: m.id, entityId: m.entityId, status: 'REJECTED', error: 'id_lector no encontrado' });
            continue;
          }

          if (!periodoUuid) {
            console.warn(`[Supabase Push] id_periodo UUID no encontrado para la lectura`);
            acks.push({ mutationId: m.id, entityId: m.entityId, status: 'REJECTED', error: 'id_periodo no encontrado' });
            continue;
          }

          const isSN = Boolean((p.numeroMedidor || p.medidorNumero || '').toUpperCase().includes('SN'));
          const lant = isSN ? 0 : Number(Number(p.lecturaAnterior || 0).toFixed(3));
          const lact = isSN ? 0 : Number(Number(p.lecturaActual || 0).toFixed(3));
          const consumo = isSN ? 0 : Number(Number(p.consumoM3 !== undefined ? p.consumoM3 : Math.max(0, lact - lant)).toFixed(3));
          const excedente = isSN ? 0 : Number(Number(p.excedenteM3 !== undefined ? p.excedenteM3 : Math.max(0, consumo - 30)).toFixed(3));

          body = {
            id: ensureValidUuid(p.uuid || p.id || m.entityId),
            id_socio: idSocio,
            id_medidor: idMedidor,
            id_periodo: periodoUuid,
            lectura_anterior: lant,
            lectura_actual: lact,
            consumo_total: consumo,
            excedente_m3: excedente,
            fecha_lectura: p.updatedAt || new Date().toISOString(),
            id_lector: idLector,
            observaciones: isSN ? 'Sin medidor - Tarifa fija' : (p.observaciones || 'Toma en campo'),
            updated_at: new Date().toISOString()
          };
        } else if (m.entity === 'cobros' || m.entity === 'facturas') {
          endpoint = 'facturas?on_conflict=numero_factura';
          const c = m.payload || {};
          const periodoUuid = await this.resolvePeriodoUuid(c.periodo || c.idPeriodo);

          // Resolver UUID de socio asegurando integridad referencial con Supabase
          let idSocio = c.socioId || c.clienteId || c.idSocio;
          if (!idSocio || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idSocio)) {
            try {
              const db = await this.getDb();
              const socios = await new Promise((res) => {
                const tx = db.transaction(['socios'], 'readonly');
                const req = tx.objectStore('socios').getAll();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => res([]);
              });
              const found = socios.find((s) =>
                (c.codigoSocio && (s.codigoSocio === c.codigoSocio || s.codigo_socio === c.codigoSocio)) ||
                (c.socioCedula && (s.cedulaRuc === c.socioCedula || s.cedula_ruc === c.socioCedula)) ||
                (c.socioNombre && (s.nombreCompleto === c.socioNombre || `${s.nombres} ${s.apellidos}` === c.socioNombre))
              );
              if (found) idSocio = found.id;
            } catch {}
          }

          if (!idSocio || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idSocio)) {
            try {
              let query = '';
              if (c.codigoSocio) query = `codigo_socio=eq.${encodeURIComponent(c.codigoSocio)}`;
              else if (c.socioCedula) query = `cedula_ruc=eq.${encodeURIComponent(c.socioCedula)}`;
              if (query) {
                const rSoc = await this.fetchSupabase(`socios?${query}&select=id`);
                if (rSoc.ok) {
                  const arr = await rSoc.json();
                  if (Array.isArray(arr) && arr.length > 0) idSocio = arr[0].id;
                }
              }
            } catch {}
          }

          const valorBase = Number(Number(c.cargoBase || c.valorBase || 7.0).toFixed(2));
          const consumoM3 = Number(Number(c.consumoM3 || 0).toFixed(2));
          const excedenteM3 = Number(Number(c.excedenteM3 || 0).toFixed(2));
          const valorExcedente = Number(Number(c.valorExcedenteUSD || c.valorExcedente || 0).toFixed(2));
          const valorAlcant = Number(Number(c.alcantarilladoUSD || c.valorAlcantarillado || 0).toFixed(2));
          const valorMultas = Number(Number(c.multaExtra || c.valorMultas || c.valor_multas || 0).toFixed(2));
          const valorDeudaAnt = Number(Number(c.deudaAnteriorCobrada || c.valorDeudaAnterior || c.valor_deuda_anterior || 0).toFixed(2));

          const totalMes = Number(
            (c.totalMes !== undefined && c.totalMes !== null
              ? c.totalMes
              : (valorBase + valorExcedente + valorAlcant)
            ).toFixed(2)
          );
          const totalPagar = Number(
            (c.montoTotal !== undefined && c.montoTotal !== null
              ? c.montoTotal
              : (c.totalPagar !== undefined ? c.totalPagar : (totalMes + valorMultas + valorDeudaAnt))
            ).toFixed(2)
          );

          let metodoPago = String(c.metodoPago || 'EFECTIVO').toUpperCase();
          if (!['EFECTIVO', 'TRANSFERENCIA', 'MOVIL'].includes(metodoPago)) {
            metodoPago = 'EFECTIVO';
          }

          let estadoPago = c.estadoPago || (Number(c.saldoPendiente || 0) > 0 ? 'PENDIENTE' : 'PAGADO');
          if (!['PENDIENTE', 'PAGADO', 'ANULADO'].includes(estadoPago)) {
            estadoPago = 'PAGADO';
          }

          body = {
            id: ensureValidUuid(c.id || m.entityId),
            numero_factura: c.numeroRecibo || c.numeroFactura || `FAC-${String(Date.now()).slice(-6)}`,
            id_socio: ensureValidUuid(idSocio),
            id_periodo: periodoUuid,
            es_tercera_edad: Boolean(c.esTerceraEdad || c.es_tercera_edad || valorBase === 5.0),
            valor_base: valorBase,
            consumo_m3: consumoM3,
            excedente_m3: excedenteM3,
            valor_excedente: valorExcedente,
            valor_alcantarillado: valorAlcant,
            valor_multas: valorMultas,
            valor_deuda_anterior: valorDeudaAnt,
            total_mes: totalMes,
            total_pagar: totalPagar,
            estado_pago: estadoPago,
            fecha_vencimiento: c.fechaVencimiento || '2026-09-30',
            fecha_pago: c.fechaPago || new Date().toISOString(),
            metodo_pago: metodoPago,
            updated_at: new Date().toISOString()
          };

          // Verificar si ya existe en Supabase por ID o por número de factura
          const targetId = c.id || m.entityId;
          const numFac = c.numeroFactura || c.numeroRecibo;
          let existingRow = null;
          try {
            if (targetId) {
              const r1 = await this.fetchSupabase(`facturas?id=eq.${encodeURIComponent(targetId)}&select=id,numero_factura`);
              if (r1.ok) {
                const arr1 = await r1.json();
                if (Array.isArray(arr1) && arr1.length > 0) existingRow = arr1[0];
              }
            }
            if (!existingRow && numFac) {
              const r2 = await this.fetchSupabase(`facturas?numero_factura=eq.${encodeURIComponent(numFac)}&select=id,numero_factura`);
              if (r2.ok) {
                const arr2 = await r2.json();
                if (Array.isArray(arr2) && arr2.length > 0) existingRow = arr2[0];
              }
            }
          } catch {}

          if (existingRow) {
            // Ya existe en Supabase: actualizar estado de pago (PATCH)
            const patchPayload = {
              estado_pago: estadoPago,
              fecha_pago: c.fechaPago || new Date().toISOString(),
              metodo_pago: metodoPago,
              updated_at: new Date().toISOString()
            };
            if (c.totalPagar !== undefined) {
              patchPayload.total_pagar = totalPagar;
            }
            const patchRes = await this.fetchSupabase(`facturas?id=eq.${encodeURIComponent(existingRow.id)}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify(patchPayload)
            });

            if (patchRes.ok) {
              // Sincronizar multas cobradas a Supabase si aplica
              if (Array.isArray(c.multasCobradasIds) && c.multasCobradasIds.length > 0) {
                for (const mId of c.multasCobradasIds) {
                  await this.fetchSupabase(`multas_rubros?id=eq.${encodeURIComponent(mId)}`, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({ pagado: true, id_factura: existingRow.id })
                  }).catch(() => {});
                }
              }
              // Reducir deuda_alcantarillado en socios en Supabase si aplica
              if (Number(c.deudaAlcantarilladoCobrada || 0) > 0 && (c.socioId || c.idSocio)) {
                const sId = c.socioId || c.idSocio;
                try {
                  const sRes = await this.fetchSupabase(`socios?id=eq.${encodeURIComponent(sId)}&select=deuda_alcantarillado`);
                  if (sRes.ok) {
                    const sData = await sRes.json();
                    if (sData && sData.length > 0) {
                      const curDebt = Number(sData[0].deuda_alcantarillado || 0);
                      const remDebt = Math.max(0, Number((curDebt - Number(c.deudaAlcantarilladoCobrada)).toFixed(2)));
                      await this.fetchSupabase(`socios?id=eq.${encodeURIComponent(sId)}`, {
                        method: 'PATCH',
                        headers,
                        body: JSON.stringify({ deuda_alcantarillado: remDebt })
                      }).catch(() => {});
                    }
                  }
                } catch {}
              }
              acks.push({ mutationId: m.id, entityId: m.entityId, status: 'ACCEPTED', version: 1 });
            } else {
              const errTxt = await patchRes.text();
              console.error(`❌ [Supabase Push Error] PATCH facturas: ${errTxt}`);
              acks.push({ mutationId: m.id, entityId: m.entityId, status: 'REJECTED', error: errTxt });
            }
            continue;
          }
        } else if (m.entity === 'movimientos_caja') {
          endpoint = 'fondos_movimientos?on_conflict=id';
          const mov = m.payload || {};
          const isEgreso = String(mov.tipo || '').toUpperCase() === 'EGRESO';
          const montoNum = Number(Number(mov.monto || 0).toFixed(2));
          body = {
            id: ensureValidUuid(mov.id || m.entityId),
            id_fondo: '22222222-2222-2222-2222-222222220002', // Fondo Operación y Mantenimiento
            fecha: mov.fecha || new Date().toISOString(),
            concepto: mov.descripcion || mov.concepto || 'Movimiento de egreso en caja',
            tipo: isEgreso ? 'EGRESO' : 'INGRESO',
            ingreso: isEgreso ? 0.00 : montoNum,
            egreso: isEgreso ? montoNum : 0.00,
            saldo: montoNum,
            numero_comprobante: mov.comprobante || null,
            id_responsable: '00000000-0000-0000-0000-000000000002',
            beneficiario: mov.beneficiario || 'Proveedor General'
          };
        } else if (m.entity === 'socios') {
          endpoint = 'socios?on_conflict=id';
          const s = m.payload || {};
          body = {
            id: s.id || m.entityId,
            codigo_socio: s.codigoSocio || s.codigo_socio,
            nombres: s.nombres || (s.nombreCompleto || '').split(' ')[0] || 'Socio',
            apellidos: s.apellidos || (s.nombreCompleto || '').split(' ').slice(1).join(' ') || '',
            cedula_ruc: s.cedulaRuc || s.cedula_ruc,
            fecha_nacimiento: s.fechaNacimiento || '1985-01-01',
            fecha_union: s.fechaUnion || '2022-01-01',
            telefono: s.telefono || null,
            direccion: s.direccion || 'Sector Comunitario',
            estado: s.estadoServicio || s.estado || 'ACTIVO',
            updated_at: new Date().toISOString()
          };
        } else if (m.entity === 'medidores') {
          endpoint = 'medidores?on_conflict=id';
          const med = m.payload || {};
          body = {
            id: med.id || m.entityId,
            id_socio: med.idSocio || med.id_socio,
            id_sector: med.idSector || med.id_sector || '11111111-0000-0000-0000-000000000001',
            numero_medidor: med.numeroMedidor || med.numero_medidor || 'MED-00000',
            alias: med.alias || 'Casa principal',
            direccion: med.direccion || '',
            tiene_alcantarillado: Boolean(med.tieneAlcantarillado ?? med.tiene_alcantarillado),
            estado: med.estado || 'ACTIVO',
            updated_at: new Date().toISOString()
          };
        }

        if (endpoint && body) {
          const res = await this.fetchSupabase(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
          });

          if (res.ok) {
            // Si es cobro nuevo con multas, actualizar multas en Supabase
            if ((m.entity === 'cobros' || m.entity === 'facturas') && Array.isArray(m.payload?.multasCobradasIds) && m.payload.multasCobradasIds.length > 0) {
              for (const mId of m.payload.multasCobradasIds) {
                await this.fetchSupabase(`multas_rubros?id=eq.${encodeURIComponent(mId)}`, {
                  method: 'PATCH',
                  headers,
                  body: JSON.stringify({ pagado: true, id_factura: body.id })
                }).catch(() => {});
              }
            }
            // Reducir deuda_alcantarillado en socios en Supabase si aplica
            if (Number(m.payload?.deudaAlcantarilladoCobrada || 0) > 0 && (m.payload?.socioId || m.payload?.idSocio)) {
              const sId = m.payload.socioId || m.payload.idSocio;
              try {
                const sRes = await this.fetchSupabase(`socios?id=eq.${encodeURIComponent(sId)}&select=deuda_alcantarillado`);
                if (sRes.ok) {
                  const sData = await sRes.json();
                  if (sData && sData.length > 0) {
                    const curDebt = Number(sData[0].deuda_alcantarillado || 0);
                    const remDebt = Math.max(0, Number((curDebt - Number(m.payload.deudaAlcantarilladoCobrada)).toFixed(2)));
                    await this.fetchSupabase(`socios?id=eq.${encodeURIComponent(sId)}`, {
                      method: 'PATCH',
                      headers,
                      body: JSON.stringify({ deuda_alcantarillado: remDebt })
                    }).catch(() => {});
                  }
                }
              } catch {}
            }
            acks.push({ mutationId: m.id, entityId: m.entityId, status: 'ACCEPTED', version: 1 });
          } else {
            const errTxt = await res.text();
            console.error(`❌ [Supabase Push Error] ${endpoint}: ${errTxt}`);
            acks.push({ mutationId: m.id, entityId: m.entityId, status: 'REJECTED', error: errTxt });
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
   * Descarga todos los deltas actualizados directamente desde Supabase Cloud a IndexedDB
   */
  async pullDeltas() {
    if (this.isSyncing) return { success: false, reason: 'Ya hay una sincronización en curso' };
    if (!navigator.onLine || this.isSimulatedOffline) {
      this.notifyStatus('OFFLINE');
      return { success: false, reason: 'Sin conexión a Internet' };
    }

    this.isSyncing = true;
    this.notifyStatus('PULLING');

    console.log(`⬇️ [SyncEngine Pull] Solicitando datos frescos directamente a Supabase Cloud...`);

    try {
      const incoming = await this.pullDirectFromSupabase();
      let appliedCount = 0;

      if (incoming) {
        const db = await this.getDb();
        const pendingMutations = await this.getPendingMutations();
        const pendingIds = new Set(pendingMutations.map((m) => m.entityId));

        await new Promise((resolve) => {
          const storesToUpdate = ['socios', 'sectores', 'medidores', 'lecturas', 'cobros', 'periodos', 'multas_rubros'];
          const tx = db.transaction(storesToUpdate, 'readwrite');

          // Socios (Purga eliminados en nube y actualiza vigentes)
          if (Array.isArray(incoming.socios)) {
            const sStore = tx.objectStore('socios');
            const incomingSocioIds = new Set(incoming.socios.map((s) => s.id));

            // Eliminar socios locales que ya no existen en la base de datos central
            const getSociosReq = sStore.getAll();
            getSociosReq.onsuccess = () => {
              const localList = getSociosReq.result || [];
              localList.forEach((ls) => {
                if (!incomingSocioIds.has(ls.id) && !pendingIds.has(ls.id)) {
                  console.log(`🗑️ [SyncEngine] Purgando socio eliminado en la nube: ${ls.nombreCompleto || ls.id}`);
                  sStore.delete(ls.id);
                }
              });
            };

            incoming.socios.forEach((s) => {
              if (!pendingIds.has(s.id)) {
                if (s.deudaAlcantarillado === undefined) {
                  const getReq = sStore.get(s.id);
                  getReq.onsuccess = () => {
                    const local = getReq.result;
                    if (local && local.deudaAlcantarillado !== undefined) {
                      s.deudaAlcantarillado = Number(local.deudaAlcantarillado || 0);
                      if (local.tieneAlcantarillado) s.tieneAlcantarillado = true;
                    } else {
                      s.deudaAlcantarillado = 0;
                    }
                    sStore.put(s);
                  };
                } else {
                  sStore.put(s);
                }
                appliedCount++;
              }
            });
          }

          // Sectores (Purga eliminados y actualiza vigentes)
          if (Array.isArray(incoming.sectores)) {
            const secStore = tx.objectStore('sectores');
            const incomingSecIds = new Set(incoming.sectores.map((sec) => sec.id));
            const getSecReq = secStore.getAll();
            getSecReq.onsuccess = () => {
              const localSecs = getSecReq.result || [];
              localSecs.forEach((lsec) => {
                if (!incomingSecIds.has(lsec.id)) {
                  secStore.delete(lsec.id);
                }
              });
            };
            incoming.sectores.forEach((sec) => secStore.put(sec));
          }

          // Medidores (Purga medidores eliminados y actualiza vigentes)
          if (Array.isArray(incoming.medidores)) {
            const medStore = tx.objectStore('medidores');
            const incomingMedIds = new Set(incoming.medidores.map((m) => m.id));
            const getMedsReq = medStore.getAll();
            getMedsReq.onsuccess = () => {
              const localMeds = getMedsReq.result || [];
              localMeds.forEach((lm) => {
                if (!incomingMedIds.has(lm.id) && !pendingIds.has(lm.id)) {
                  console.log(`🗑️ [SyncEngine] Purgando medidor eliminado en la nube: ${lm.numeroMedidor || lm.id}`);
                  medStore.delete(lm.id);
                }
              });
            };
            incoming.medidores.forEach((m) => medStore.put(m));
          }

          // Lecturas
          if (Array.isArray(incoming.lecturas)) {
            const lecStore = tx.objectStore('lecturas');
            incoming.lecturas.forEach((l) => {
              if (l.idMedidor && l.periodo) {
                try { lecStore.delete(`lec-${l.idMedidor}-${l.periodo}`); } catch (e) {}
              }
              if (l.clienteId && l.periodo) {
                try { lecStore.delete(`lec-${l.clienteId}-${l.periodo}`); } catch (e) {}
              }
              if (!pendingIds.has(l.id)) {
                lecStore.put(l);
                appliedCount++;
              }
            });
          }

          // Periodos
          if (Array.isArray(incoming.periodos)) {
            const pStore = tx.objectStore('periodos');
            incoming.periodos.forEach((p) => {
              pStore.put(p);
              appliedCount++;
            });
          }

          // Facturas / Cobros
          if (Array.isArray(incoming.facturas)) {
            const cStore = tx.objectStore('cobros');
            const reqAllCobros = cStore.getAll();
            reqAllCobros.onsuccess = () => {
              const localCobros = reqAllCobros.result || [];
              const numToLocalId = new Map();
              localCobros.forEach((item) => {
                const numKey = String(item.numeroRecibo || item.numeroFactura || item.numero_factura || item.id || '').trim().toUpperCase();
                if (numKey) numToLocalId.set(numKey, item.id);
                // Purgar cobros de prueba
                if (
                  numKey === 'REC-471445' ||
                  numKey === 'FAC-202608-08066' ||
                  item.id === 'a5c952f2-d4e6-415b-bf55-0ce12f575675' ||
                  item.id === '42f85f08-d65e-4eb5-804d-e5dc98b2788d' ||
                  numKey.includes('65455') ||
                  numKey.includes('238832') ||
                  item.id === '4a38b025-5ea6-4c5f-9562-0f86081a7551' ||
                  item.id === '217175d9-8813-47d1-ac06-ac054dffcbd3'
                ) {
                  cStore.delete(item.id);
                }
              });

              incoming.facturas.forEach((c) => {
                const fNum = String(c.numero_factura || c.numeroFactura || c.numeroRecibo || c.id || '').trim().toUpperCase();
                if (
                  fNum === 'REC-471445' ||
                  fNum === 'FAC-202608-08066' ||
                  c.id === 'a5c952f2-d4e6-415b-bf55-0ce12f575675' ||
                  c.id === '42f85f08-d65e-4eb5-804d-e5dc98b2788d' ||
                  fNum.includes('65455') ||
                  fNum.includes('238832') ||
                  c.id === '4a38b025-5ea6-4c5f-9562-0f86081a7551' ||
                  c.id === '217175d9-8813-47d1-ac06-ac054dffcbd3'
                ) {
                  return;
                }

                if (!pendingIds.has(c.id)) {
                  const localId = numToLocalId.get(fNum);
                  if (localId && localId !== c.id) {
                    cStore.delete(localId);
                  }
                  cStore.put(c);
                  appliedCount++;
                }
              });
            };
          }

          // Multas Rubros
          if (Array.isArray(incoming.multas_rubros) && db.objectStoreNames.contains('multas_rubros')) {
            const mStore = tx.objectStore('multas_rubros');
            incoming.multas_rubros.forEach((m) => {
              if (!pendingIds.has(m.id)) {
                mStore.put(m);
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
      console.log(`✅ [SyncEngine Pull Exitoso] ${appliedCount} registros sincronizados en IndexedDB.`);

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
   * Ejecuta peticiones hacia Supabase Cloud conmutando automáticamente
   * a través del proxy local (/api/v1/sync/proxy) si estamos en localhost,
   * garantizando 0 problemas de CORS en cualquier navegador.
   */
  async fetchSupabase(endpoint, options = {}) {
    const isLocalHttp = typeof window !== 'undefined' &&
      window.location.protocol.startsWith('http') &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port === '4000');

    if (isLocalHttp) {
      const [pathPart, queryPart] = endpoint.split('?');
      const proxyUrl = `/api/v1/sync/proxy?path=${encodeURIComponent(pathPart)}${queryPart ? '&' + queryPart : ''}`;
      try {
        const res = await fetch(proxyUrl, options);
        if (res.ok || res.status < 500) {
          return res;
        }
      } catch (err) {
        console.warn('[SyncEngine] Proxy local no disponible, intentando acceso directo a Supabase:', err);
      }
    }

    const headers = {
      apikey: SYNC_CONFIG.SUPABASE_KEY,
      Authorization: `Bearer ${SYNC_CONFIG.SUPABASE_KEY}`,
      ...(options.headers || {})
    };

    return fetch(`${SYNC_CONFIG.SUPABASE_URL}/rest/v1/${endpoint}`, {
      ...options,
      headers
    });
  }

  /**
   * Pull directo desde Supabase Cloud REST API
   */
  async pullDirectFromSupabase() {
    const [socRes, secRes, medRes, lecRes, perRes, facRes, mulRes] = await Promise.all([
      this.fetchSupabase('socios?select=*').then((r) => r.json()).catch(() => []),
      this.fetchSupabase('sectores?select=*').then((r) => r.json()).catch(() => []),
      this.fetchSupabase('medidores?select=*').then((r) => r.json()).catch(() => []),
      this.fetchSupabase('lecturas?select=*&order=fecha_lectura.desc&limit=1000').then((r) => r.json()).catch(() => []),
      this.fetchSupabase('periodos?select=*&order=fecha_inicio.asc').then((r) => r.json()).catch(() => []),
      this.fetchSupabase('facturas?select=*&order=created_at.desc&limit=500').then((r) => r.json()).catch(() => []),
      this.fetchSupabase('multas_rubros?select=*').then((r) => r.json()).catch(() => [])
    ]);

    // Mapear períodos de Supabase
    const periodosList = Array.isArray(perRes)
      ? perRes.map((p) => ({
          id: p.id,
          periodoCodigo: p.periodo_codigo,
          nombre: p.nombre,
          fechaInicio: p.fecha_inicio,
          fechaFin: p.fecha_fin,
          estado: p.estado
        }))
      : [];
    const periodosMap = new Map(periodosList.map((p) => [p.id, p.periodoCodigo]));

    // Indexar lecturas estrictamente por id_medidor (nunca por id_socio para no contaminar multi-medidores)
    const lecturasRaw = Array.isArray(lecRes) ? lecRes : [];
    const ultimaLecturaPorMedidor = new Map();
    lecturasRaw.forEach((l) => {
      const lact = Number(l.lectura_actual || 0);
      if (l.id_medidor && !ultimaLecturaPorMedidor.has(l.id_medidor) && lact > 0) {
        ultimaLecturaPorMedidor.set(l.id_medidor, lact);
      }
    });

    const medidoresRaw = Array.isArray(medRes) ? medRes : [];
    const medidoresBySocio = new Map();
    medidoresRaw.forEach((m) => {
      const socioId = m.id_socio;
      if (!medidoresBySocio.has(socioId)) medidoresBySocio.set(socioId, []);
      const isSN = Boolean((m.numero_medidor || '').toUpperCase().includes('SN'));
      let uLect = 0;
      if (!isSN) {
        uLect = ultimaLecturaPorMedidor.get(m.id) ?? Number(m.lectura_inicial ?? m.lectura_anterior ?? 0);
      }
      medidoresBySocio.get(socioId).push({
        id: m.id,
        idMedidor: m.id,
        idSocio: m.id_socio,
        idSector: m.id_sector,
        numeroMedidor: m.numero_medidor,
        medidorNumero: m.numero_medidor,
        alias: m.alias || 'Casa principal',
        aliasMedidor: m.alias || 'Casa principal',
        direccion: m.direccion || '',
        tieneAlcantarillado: Boolean(m.tiene_alcantarillado),
        estado: m.estado || 'ACTIVO',
        lecturaAnterior: uLect,
        lecturaInicial: uLect,
        updatedAt: m.updated_at
      });
    });

    // Normalizar socios
    const socios = (Array.isArray(socRes) ? socRes : []).map((s) => {
      const socioMeds = medidoresBySocio.get(s.id) || [];
      const primaryMed = socioMeds[0];
      const hasAlcant = socioMeds.some((m) => Boolean(m.tieneAlcantarillado));
      return {
        id: s.id,
        codigoSocio: s.codigo_socio,
        nombres: s.nombres,
        apellidos: s.apellidos,
        nombreCompleto: `${s.nombres || ''} ${s.apellidos || ''}`.trim() || s.codigo_socio,
        cedulaRuc: s.cedula_ruc,
        fechaNacimiento: s.fecha_nacimiento || '1985-01-01',
        fechaAfiliacion: s.fecha_union || '2022-01-01',
        sectorId: primaryMed ? primaryMed.idSector : (s.id_sector || ''),
        medidorNumero: primaryMed ? primaryMed.numeroMedidor : (s.medidor_numero || ''),
        medidores: socioMeds,
        tieneAlcantarillado: hasAlcant || Boolean(s.tiene_alcantarillado),
        deudaAlcantarillado: (s.deuda_alcantarillado !== undefined && s.deuda_alcantarillado !== null)
          ? Number(s.deuda_alcantarillado)
          : undefined,
        telefono: s.telefono,
        direccion: s.direccion,
        estadoServicio: s.estado || 'ACTIVO',
        updatedAt: s.updated_at
      };
    });

    const sectores = (Array.isArray(secRes) ? secRes : []).map((sec) => ({
      id: sec.id,
      codigo: sec.codigo_sector,
      nombre: sec.nombre_sector,
      descripcion: sec.descripcion || ''
    }));

    const medidores = medidoresRaw.map((m) => {
      const isSN = Boolean((m.numero_medidor || '').toUpperCase().includes('SN'));
      let uLect = 0;
      if (!isSN) {
        uLect = ultimaLecturaPorMedidor.get(m.id) ?? Number(m.lectura_inicial ?? m.lectura_anterior ?? 0);
      }
      return {
        id: m.id,
        idMedidor: m.id,
        idSocio: m.id_socio,
        idSector: m.id_sector,
        numeroMedidor: m.numero_medidor,
        alias: m.alias || 'Casa principal',
        tieneAlcantarillado: Boolean(m.tiene_alcantarillado),
        estado: m.estado || 'ACTIVO',
        lecturaAnterior: uLect,
        lecturaInicial: uLect,
        updatedAt: m.updated_at
      };
    });

    const lecturas = lecturasRaw.map((l) => {
      const medidorObj = medidoresRaw.find((m) => m.id === l.id_medidor);
      const isSN = Boolean((medidorObj?.numero_medidor || '').toUpperCase().includes('SN'));
      const lant = isSN ? 0 : Number(Number(l.lectura_anterior || 0).toFixed(3));
      const lact = isSN ? 0 : Number(Number(l.lectura_actual || 0).toFixed(3));
      const cons = isSN ? 0 : Number(Number(l.consumo_total || 0).toFixed(3));
      const exc = isSN ? 0 : Number(Number(l.excedente_m3 || 0).toFixed(3));
      const resolvedPeriodo = periodosMap.get(l.id_periodo) || l.id_periodo;
      return {
        id: l.id,
        idMedidor: l.id_medidor,
        numeroMedidor: medidorObj?.numero_medidor || '',
        clienteId: l.id_socio,
        idSocio: l.id_socio,
        periodo: resolvedPeriodo,
        periodoCodigo: resolvedPeriodo,
        idPeriodo: l.id_periodo,
        lecturaAnterior: lant,
        lecturaActual: lact,
        consumoM3: cons,
        excedenteM3: exc,
        observaciones: isSN ? 'Sin medidor - Tarifa fija' : (l.observaciones || ''),
        updatedAt: l.updated_at || l.fecha_lectura
      };
    });

    const facturas = (Array.isArray(facRes) ? facRes : []).map((f) => ({
      id: f.id,
      numeroRecibo: f.numero_factura,
      numeroFactura: f.numero_factura,
      socioId: f.id_socio,
      idSocio: f.id_socio,
      idPeriodo: f.id_periodo,
      periodo: periodosMap.get(f.id_periodo) || f.id_periodo,
      periodoCodigo: periodosMap.get(f.id_periodo) || f.id_periodo,
      cargoBase: Number(f.valor_base || 7.0),
      consumoM3: Number(f.consumo_m3 || 0),
      excedenteM3: Number(f.excedente_m3 || 0),
      valorExcedenteUSD: Number(f.valor_excedente || 0),
      alcantarilladoUSD: Number(f.valor_alcantarillado || 0),
      montoTotal: Number(f.total_pagar || 0),
      totalPagar: Number(f.total_pagar || 0),
      montoPagado: Number(f.monto_pagado || 0),
      saldoPendiente: Number(f.saldo_pendiente !== undefined ? f.saldo_pendiente : f.total_pagar),
      estadoPago: f.estado_pago || 'PENDIENTE',
      fechaPago: f.fecha_pago,
      fechaVencimiento: f.fecha_vencimiento,
      metodoPago: f.metodo_pago || 'EFECTIVO',
      updatedAt: f.updated_at || f.created_at
    }));

    const multasRubros = (Array.isArray(mulRes) ? mulRes : []).map((m) => ({
      id: m.id,
      idSocio: m.id_socio,
      idPeriodo: m.id_periodo,
      tipoRubro: m.tipo_rubro,
      monto: Number(m.monto || 0),
      motivo: m.motivo,
      pagado: Boolean(m.pagado),
      idFactura: m.id_factura || null,
      createdAt: m.created_at
    }));

    return { socios, sectores, medidores, lecturas, periodos: periodosList, facturas, multas_rubros: multasRubros };
  }

  /**
   * Operación Completa de Sincronización (Pull -> Push)
   */
  async syncAll(role = 'LECTOR') {
    if (this.isSyncing) return { success: false, reason: 'Sincronización ya activa' };

    console.log(`🔄 [SyncEngine Full Sync] Iniciando ciclo Git con Supabase Cloud para rol: ${role}...`);
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

  /**
   * CIERRE DE CICLO OFICIAL Y LIQUIDACIÓN EN SUPABASE CLOUD
   * 1. Calcula y emite planillas a facturas para todos los socios activos según su consumo de Agosto.
   * 2. Pasa el período actual a CERRADO.
   * 3. Crea o abre el siguiente período (ej: 2026-09) como ABIERTO.
   * 4. Moviliza las lecturas: L_act de Agosto pasa a L_ant de Septiembre con consumo 0.
   * 5. Refresca automáticamente IndexedDB local.
   */
  async cerrarCicloSupabase(periodoCodigo = '2026-08') {
    const headers = {
      apikey: SYNC_CONFIG.SUPABASE_KEY,
      Authorization: `Bearer ${SYNC_CONFIG.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    };

    console.log(`🔒 [SyncEngine Cierre Ciclo] Iniciando liquidación y cierre para período: ${periodoCodigo}...`);

    // 1. Obtener datos actuales de Supabase
    const [periodosRes, sociosRes, medidoresRes, lecturasRes] = await Promise.all([
      this.fetchSupabase('periodos?select=*').then((r) => r.json()),
      this.fetchSupabase('socios?select=*&estado=eq.ACTIVO').then((r) => r.json()),
      this.fetchSupabase('medidores?select=*&estado=eq.ACTIVO').then((r) => r.json()),
      this.fetchSupabase('lecturas?select=*&order=fecha_lectura.desc&limit=1000').then((r) => r.json())
    ]);

    const periodos = Array.isArray(periodosRes) ? periodosRes : [];
    const periodoActual = periodos.find((p) => p.periodo_codigo === periodoCodigo || p.id === periodoCodigo) ||
      periodos.find((p) => p.estado === 'ABIERTO');

    if (!periodoActual) {
      throw new Error(`Período ${periodoCodigo} no encontrado en Supabase Cloud.`);
    }

    const periodoActualId = periodoActual.id;
    const actualPeriodoCodigo = periodoActual.periodo_codigo;
    const now = new Date().toISOString();

    // 2. Liquidar Facturas para todos los socios activos en base a las lecturas del período
    const lecturasActualPeriodo = (Array.isArray(lecturasRes) ? lecturasRes : []).filter((l) => l.id_periodo === periodoActualId);
    const lecturasPorSocio = new Map();
    const lecturasPorMedidor = new Map();
    lecturasActualPeriodo.forEach((l) => {
      if (l.id_socio) lecturasPorSocio.set(l.id_socio, l);
      if (l.id_medidor) lecturasPorMedidor.set(l.id_medidor, l);
    });

    const socios = Array.isArray(sociosRes) ? sociosRes : [];
    const medidores = Array.isArray(medidoresRes) ? medidoresRes : [];

    const facturasPayload = [];
    let count = 0;

    for (const s of socios) {
      count++;
      let esTerceraEdad = false;
      if (s.fecha_nacimiento) {
        const birth = new Date(s.fecha_nacimiento);
        const age = new Date().getFullYear() - birth.getFullYear();
        if (age >= 65) esTerceraEdad = true;
      }
      const valorBase = esTerceraEdad ? 5.00 : 7.00;

      const socioMeds = medidores.filter((m) => m.id_socio === s.id);
      let consumoM3 = 0;
      const primaryMed = socioMeds[0];
      let primaryLec = null;

      for (const m of socioMeds) {
        const isSN = Boolean((m.numero_medidor || '').toUpperCase().includes('SN'));
        if (isSN) continue; // Medidor SN: tarifa fija, no acumula consumo m³

        const lec = lecturasPorMedidor.get(m.id) || (socioMeds.length === 1 ? lecturasPorSocio.get(s.id) : null);
        if (lec) {
          consumoM3 += Number(lec.consumo_total || 0);
          if (!primaryLec) primaryLec = lec;
        }
      }

      const excedenteM3 = Number(Math.max(0, consumoM3 - 30).toFixed(2));
      const valorExcedente = Number((excedenteM3 * 0.10).toFixed(2));
      const tieneAlcant = socioMeds.some((m) => Boolean(m.tiene_alcantarillado)) || Boolean(s.tiene_alcantarillado);
      const valorAlcant = tieneAlcant ? 1.00 : 0.00;
      const totalMes = Number((valorBase + valorExcedente + valorAlcant).toFixed(2));
      const totalPagar = totalMes;

      const numFactura = `FAC-${actualPeriodoCodigo.replace('-', '')}-${String(count).padStart(4, '0')}`;
      const fechaVenc = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      facturasPayload.push({
        id: crypto.randomUUID(),
        numero_factura: numFactura,
        id_socio: s.id,
        id_medidor: primaryMed ? primaryMed.id : null,
        id_periodo: periodoActualId,
        id_lectura: primaryLec ? primaryLec.id : null,
        es_tercera_edad: esTerceraEdad,
        valor_base: valorBase,
        consumo_m3: consumoM3,
        excedente_m3: excedenteM3,
        valor_excedente: valorExcedente,
        valor_alcantarillado: valorAlcant,
        valor_multas: 0,
        valor_deuda_anterior: 0,
        total_mes: totalMes,
        total_pagar: totalPagar,
        estado_pago: 'PENDIENTE',
        fecha_vencimiento: fechaVenc,
        version: 1,
        created_at: now,
        updated_at: now
      });
    }

    // Guardar facturas en Supabase
    if (facturasPayload.length > 0) {
      const facRes = await this.fetchSupabase('facturas?on_conflict=numero_factura', {
        method: 'POST',
        headers,
        body: JSON.stringify(facturasPayload)
      });
      if (!facRes.ok) {
        console.warn('Aviso guardando facturas en Supabase:', await facRes.text());
      }
    }

    // 3. Marcar período actual como CERRADO en Supabase
    await this.fetchSupabase(`periodos?id=eq.${periodoActualId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ estado: 'CERRADO' })
    });

    // 4. Calcular y habilitar nuevo período (ej: 2026-08 -> 2026-09)
    const [yyyy, mm] = actualPeriodoCodigo.split('-').map(Number);
    const nextDate = new Date(yyyy, mm, 1);
    const nextYear = nextDate.getFullYear();
    const nextMonth = String(nextDate.getMonth() + 1).padStart(2, '0');
    const nextPeriodoCodigo = `${nextYear}-${nextMonth}`;
    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    const nextNombre = `Período ${monthNames[nextDate.getMonth()]} ${nextYear}`;
    const lastDay = new Date(nextYear, nextDate.getMonth() + 1, 0).getDate();
    const nextFechaInicio = `${nextPeriodoCodigo}-01`;
    const nextFechaFin = `${nextPeriodoCodigo}-${String(lastDay).padStart(2, '0')}`;

    let nextPeriodo = periodos.find((p) => p.periodo_codigo === nextPeriodoCodigo);
    let nextPeriodoId = nextPeriodo?.id;

    if (nextPeriodo) {
      await this.fetchSupabase(`periodos?id=eq.${nextPeriodo.id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ estado: 'ABIERTO' })
      });
    } else {
      nextPeriodoId = crypto.randomUUID();
      nextPeriodo = {
        id: nextPeriodoId,
        periodo_codigo: nextPeriodoCodigo,
        nombre: nextNombre,
        fecha_inicio: nextFechaInicio,
        fecha_fin: nextFechaFin,
        estado: 'ABIERTO',
        created_at: now
      };
      await this.fetchSupabase('periodos', {
        method: 'POST',
        headers,
        body: JSON.stringify(nextPeriodo)
      });
    }

    // 5. Movilizar lecturas en Supabase para el nuevo período
    // La lectura actual de Agosto pasa a ser la lectura anterior de Septiembre
    const lecturasMovilizadas = [];
    for (const m of medidores) {
      const isSN = Boolean((m.numero_medidor || '').toUpperCase().includes('SN'));
      const isJuanGuerrero = Boolean(m.numero_medidor === '1208020366' || m.id_socio === '414e4833-a1f6-5207-b882-9a425d2301b3');

      // Buscar lectura correspondiente al medidor individual (sin cruce de multi-medidor)
      const lecAnterior = lecturasPorMedidor.get(m.id) || (medidores.filter((x) => x.id_socio === m.id_socio).length === 1 ? lecturasPorSocio.get(m.id_socio) : null);

      let nuevaLant = lecAnterior ? Number(lecAnterior.lectura_actual || 0) : 0;

      if (isSN) {
        nuevaLant = 0;
      } else if (isJuanGuerrero && nextPeriodoCodigo === '2026-09') {
        // Juan Guerrero comenzará el período 2026-09 con lectura anterior 2397
        nuevaLant = 2397;
      }

      lecturasMovilizadas.push({
        id: crypto.randomUUID(),
        id_medidor: m.id,
        id_socio: m.id_socio,
        id_periodo: nextPeriodoId,
        lectura_anterior: nuevaLant,
        lectura_actual: nuevaLant,
        consumo_total: 0,
        excedente_m3: 0,
        fecha_lectura: `${nextFechaInicio}T08:00:00.000Z`,
        id_lector: '00000000-0000-0000-0000-000000000003',
        observaciones: isSN ? 'Sin medidor - Tarifa fija' : `Punto de partida ciclo ${nextPeriodoCodigo}`,
        version: 1,
        created_at: now,
        updated_at: now
      });
    }

    if (lecturasMovilizadas.length > 0) {
      await this.fetchSupabase('lecturas?on_conflict=id_medidor,id_periodo', {
        method: 'POST',
        headers,
        body: JSON.stringify(lecturasMovilizadas)
      });
    }

    // 6. Refrescar datos en IndexedDB local
    await this.pullDeltas();

    console.log(`🎉 [SyncEngine Cierre Ciclo] Ciclo ${actualPeriodoCodigo} cerrado con éxito. Período ${nextPeriodoCodigo} abierto.`);

    return {
      success: true,
      periodoCerrado: actualPeriodoCodigo,
      nuevoPeriodo: nextPeriodoCodigo,
      totalFacturasLiquidadas: facturasPayload.length,
      totalLecturasMovilizadas: lecturasMovilizadas.length
    };
  }

  /**
   * Registra cobro de factura directamente en Supabase e IndexedDB
   */
  async cobrarFacturaSupabase(facturaId, data = {}) {
    const headers = {
      apikey: SYNC_CONFIG.SUPABASE_KEY,
      Authorization: `Bearer ${SYNC_CONFIG.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    };

    const montoCobrado = Number(data.montoCobrado || 0);
    const fechaPago = data.fechaPago || new Date().toISOString();
    const metodoPago = data.metodoPago || 'EFECTIVO';

    const res = await this.fetchSupabase(`facturas?id=eq.${encodeURIComponent(facturaId)}`);
    const rows = res.ok ? await res.json() : [];
    if (!rows || rows.length === 0) throw new Error('Factura no encontrada en la nube.');

    const fac = rows[0];
    const totalPagar = Number(fac.total_pagar || 0);
    const montoPrevio = Number(fac.monto_pagado || 0);
    const nuevoMontoPagado = Number((montoPrevio + (montoCobrado > 0 ? montoCobrado : totalPagar)).toFixed(2));
    const nuevoSaldoPendiente = Math.max(0, Number((totalPagar - nuevoMontoPagado).toFixed(2)));
    const esPagadoCompleto = nuevoSaldoPendiente <= 0.001;

    const updatePayload = {
      estado_pago: esPagadoCompleto ? 'PAGADO' : 'PENDIENTE',
      fecha_pago: fechaPago,
      metodo_pago: metodoPago,
      updated_at: new Date().toISOString()
    };

    const patchRes = await this.fetchSupabase(`facturas?id=eq.${encodeURIComponent(facturaId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(updatePayload)
    });

    if (!patchRes.ok) {
      throw new Error(`Error actualizando pago en Supabase: ${await patchRes.text()}`);
    }

    // Actualizar IndexedDB
    try {
      const db = await this.getDb();
      const tx = db.transaction(['cobros'], 'readwrite');
      tx.objectStore('cobros').put({
        ...fac,
        ...updatePayload,
        monto_pagado: nuevoMontoPagado,
        saldo_pendiente: nuevoSaldoPendiente,
        id: facturaId
      });
    } catch {}

    return {
      success: true,
      facturaId,
      montoPagado: nuevoMontoPagado,
      saldoPendiente: nuevoSaldoPendiente,
      estadoPago: esPagadoCompleto ? 'PAGADO' : 'PENDIENTE'
    };
  }

  /**
   * Elimina y revierte una factura directamente en Supabase Cloud
   */
  async deleteFacturaSupabase(idOrNumber) {
    if (!idOrNumber) return { success: false, error: 'ID o número requerido' };

    let canonicalId = null;
    let factura = null;

    try {
      // 1. Buscar por ID (si es UUID) o por numero_factura
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(idOrNumber || '').trim());
      if (isUUID) {
        const r1 = await this.fetchSupabase(`facturas?id=eq.${encodeURIComponent(idOrNumber)}&select=*`);
        if (r1.ok) {
          const arr1 = await r1.json();
          if (Array.isArray(arr1) && arr1.length > 0) factura = arr1[0];
        }
      }

      if (!factura) {
        const r2 = await this.fetchSupabase(`facturas?numero_factura=eq.${encodeURIComponent(idOrNumber)}&select=*`);
        if (r2.ok) {
          const arr2 = await r2.json();
          if (Array.isArray(arr2) && arr2.length > 0) factura = arr2[0];
        }
      }

      if (factura) {
        canonicalId = factura.id;
        const numFac = factura.numero_factura;

        // Revertir multas asociadas
        if (canonicalId) {
          await this.fetchSupabase(`multas_rubros?id_factura=eq.${encodeURIComponent(canonicalId)}`, {
            method: 'PATCH',
            body: { pagado: false, id_factura: null }
          });
        }

        // Revertir fondos_movimientos
        if (canonicalId) {
          await this.fetchSupabase(`fondos_movimientos?id_factura=eq.${encodeURIComponent(canonicalId)}`, {
            method: 'DELETE'
          });
        }
        if (numFac) {
          await this.fetchSupabase(`fondos_movimientos?numero_comprobante=eq.${encodeURIComponent(numFac)}`, {
            method: 'DELETE'
          });
        }

        // Eliminar factura de Supabase Cloud
        await this.fetchSupabase(`facturas?id=eq.${encodeURIComponent(canonicalId)}`, {
          method: 'DELETE'
        });

        return {
          success: true,
          factura
        };
      }

      // Si no se encontró el objeto completo pero hay ID, intentar DELETE directo
      await this.fetchSupabase(`facturas?id=eq.${encodeURIComponent(idOrNumber)}`, {
        method: 'DELETE'
      });
      return { success: true };
    } catch (err) {
      console.warn('[SyncEngine] Error eliminando factura en Supabase:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Obtiene estado de cuenta de un socio directamente de Supabase Cloud
   */
  async getEstadoCuentaSupabase(socioId) {
    const [facRes, mulRes] = await Promise.all([
      this.fetchSupabase(`facturas?id_socio=eq.${encodeURIComponent(socioId)}&order=created_at.desc`).then((r) => r.json()).catch(() => []),
      this.fetchSupabase(`multas_rubros?id_socio=eq.${encodeURIComponent(socioId)}&pagado=eq.false`).then((r) => r.json()).catch(() => [])
    ]);

    const facturas = Array.isArray(facRes) ? facRes : [];
    const multas = Array.isArray(mulRes) ? mulRes : [];

    const facturasPendientes = facturas.filter((f) => f.estado_pago === 'PENDIENTE' || Number(f.saldo_pendiente || 0) > 0);
    const totalFacturas = facturasPendientes.reduce((acc, f) => acc + Number(f.saldo_pendiente !== undefined ? f.saldo_pendiente : f.total_pagar), 0);
    let multasPendientes = multas.map((m) => ({
      id: m.id,
      tipoRubro: m.tipo_rubro || m.tipoRubro,
      monto: Number(m.monto || 0),
      motivo: m.motivo,
      createdAt: m.created_at || m.createdAt
    }));

    // Si Supabase no devolvió multas, consultar almacén local IndexedDB
    if (multasPendientes.length === 0) {
      try {
        const db = await this.getDb();
        if (db.objectStoreNames.contains('multas_rubros')) {
          const localMuls = await new Promise((res) => {
            const tx = db.transaction(['multas_rubros'], 'readonly');
            const req = tx.objectStore('multas_rubros').getAll();
            req.onsuccess = () => {
              const all = req.result || [];
              res(all.filter((m) => (m.idSocio === socioId || m.id_socio === socioId) && !m.pagado));
            };
            req.onerror = () => res([]);
          });
          if (localMuls.length > 0) {
            multasPendientes = localMuls.map((m) => ({
              id: m.id,
              tipoRubro: m.tipoRubro || m.tipo_rubro,
              monto: Number(m.monto || 0),
              motivo: m.motivo,
              createdAt: m.createdAt || m.created_at
            }));
          }
        }
      } catch (e) {}
    }

    const totalMultasFinal = multasPendientes.reduce((acc, m) => acc + Number(m.monto || 0), 0);

    return {
      socioId,
      facturasPendientes: facturasPendientes.map((f) => ({
        id: f.id,
        numeroFactura: f.numero_factura,
        idPeriodo: f.id_periodo,
        consumoM3: Number(f.consumo_m3 || 0),
        totalMes: Number(f.total_mes || f.total_pagar || 0),
        totalPagar: Number(f.total_pagar || 0),
        montoPagado: Number(f.monto_pagado || 0),
        saldoPendiente: Number(f.saldo_pendiente !== undefined ? f.saldo_pendiente : f.total_pagar),
        estadoPago: f.estado_pago,
        fechaVencimiento: f.fecha_vencimiento
      })),
      multasPendientes,
      deudaTotalPendiente: Number((totalFacturas + totalMultasFinal).toFixed(2)),
      mesesAdeudados: facturasPendientes.length,
      alDia: facturasPendientes.length === 0 && multasPendientes.length === 0
    };
  }

  scheduleRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    console.log(`⏱️ [SyncEngine] Reintento de push programado en ${Math.round(this.retryDelayMs / 1000)}s...`);
    this.retryTimer = setTimeout(() => {
      this.retryDelayMs = Math.min(this.retryDelayMs * 2, this.maxRetryDelayMs);
      this.pushPending().catch(() => {});
    }, this.retryDelayMs);
  }
}

export const syncEngine = new GitSyncEngine();
if (typeof window !== 'undefined') {
  window.sigaSyncEngine = syncEngine;
  window.syncEngine = syncEngine;
}
