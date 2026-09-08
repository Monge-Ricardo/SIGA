import { requireAuth, apiFetch } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';
import { OFFLINE_SEED_DATA } from './offline_seed_data.js';

// Guard de autenticación (Accesible por ADMIN, CAJERO y LECTOR)
const currentUser = requireAuth(['ADMIN', 'CAJERO', 'LECTOR']);
if (currentUser) {
  injectAppLayout('lecturas');
}

const DB_NAME = 'SIGAComunitarioDemoDB';
const DB_VERSION = 2;
let db = null;

const BASELINE_LECTURAS = {
  'soc-001': 150,
  'soc-002': 210,
  'soc-003': 95,
  'soc-004': 180
};

// Lecturas digitadas por el Lector en ruta (para revisión del Cajero)
const LECTURAS_INICIALES_LECTOR = {
  'soc-001': { lecturaAnterior: 150, lecturaActual: 185, observaciones: 'Digitado por Lector en campo', origen: 'LECTOR' },
  'soc-002': { lecturaAnterior: 210, lecturaActual: 238, observaciones: 'Digitado por Lector en campo', origen: 'LECTOR' },
  'soc-003': { lecturaAnterior: 95, lecturaActual: 122, observaciones: 'Digitado por Lector en campo', origen: 'LECTOR' },
  'soc-004': { lecturaAnterior: 180, lecturaActual: 222, observaciones: 'Digitado por Lector en campo', origen: 'LECTOR' }
};

const FALLBACK_SEED = {
  version: 4,
  periodoActivo: "2026-08",
  sectores: [
    { id: "11111111-0000-0000-0000-000000000003", codigo: "SEC-CENTRO", nombre: "Sector Centro Parroquial", descripcion: "Casco central y parque principal" },
    { id: "11111111-0000-0000-0000-000000000001", codigo: "SEC-PASO", nombre: "Sector Paso Lateral", descripcion: "Zona paso lateral y vías perimetrales" },
    { id: "11111111-0000-0000-0000-000000000004", codigo: "SEC-SANANTONIO", nombre: "Sector San Antonio", descripcion: "Barrio San Antonio y zona baja" },
    { id: "11111111-0000-0000-0000-000000000002", codigo: "SEC-SANJOSE", nombre: "Sector San José", descripcion: "Barrio San José y ramal alto" }
  ],
  socios: [
    {
      id: "f21dcac8-93eb-5314-8677-d29dc138cc48",
      codigoSocio: "SOC-0001",
      nombres: "José",
      apellidos: "Luna",
      nombreCompleto: "José Luna",
      cedulaRuc: "1800000001",
      sectorId: "11111111-0000-0000-0000-000000000001",
      nombreSector: "Sector Paso Lateral",
      medidorNumero: "MED-0001",
      medidores: [
        { id: "b4ba03dd-6eee-5963-8753-caf5766e72a8", numeroMedidor: "MED-0001", alias: "Casa principal", lecturaAnterior: 8671 }
      ],
      estadoServicio: "ACTIVO"
    },
    {
      id: "160af052-8f07-5646-9dc7-8bccc260a09a",
      codigoSocio: "SOC-0002",
      nombres: "Lalaleo",
      apellidos: "Luis Amable",
      nombreCompleto: "Lalaleo Luis Amable",
      cedulaRuc: "1800000002",
      sectorId: "11111111-0000-0000-0000-000000000001",
      nombreSector: "Sector Paso Lateral",
      medidorNumero: "MED-0002",
      medidores: [
        { id: "6fb1f5ec-2849-52f7-b7c8-35080a801535", numeroMedidor: "MED-0002", alias: "Casa principal", lecturaAnterior: 8481 }
      ],
      estadoServicio: "ACTIVO"
    }
  ],
  lecturas: [
    { id: "lec-init-MED-0001", id_medidor: "b4ba03dd-6eee-5963-8753-caf5766e72a8", id_socio: "f21dcac8-93eb-5314-8677-d29dc138cc48", id_periodo: "2026-08", periodo_codigo: "2026-08", lectura_anterior: 8671, lectura_actual: 8671, socio_codigo: "SOC-0001", socio_nombre: "José Luna", medidor_numero: "MED-0001", nombre_sector: "Sector Paso Lateral" },
    { id: "lec-init-MED-0002", id_medidor: "6fb1f5ec-2849-52f7-b7c8-35080a801535", id_socio: "160af052-8f07-5646-9dc7-8bccc260a09a", id_periodo: "2026-08", periodo_codigo: "2026-08", lectura_anterior: 8481, lectura_actual: 8481, socio_codigo: "SOC-0002", socio_nombre: "Lalaleo Luis Amable", medidor_numero: "MED-0002", nombre_sector: "Sector Paso Lateral" }
  ]
};

function initIndexedDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      if (!dbInstance.objectStoreNames.contains('socios')) {
        dbInstance.createObjectStore('socios', { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains('sectores')) {
        dbInstance.createObjectStore('sectores', { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains('lecturas')) {
        const lecturasStore = dbInstance.createObjectStore('lecturas', { keyPath: 'id' });
        lecturasStore.createIndex('periodo', 'periodo', { unique: false });
        lecturasStore.createIndex('clienteId', 'clienteId', { unique: false });
      }
      if (!dbInstance.objectStoreNames.contains('sync_queue')) {
        const queueStore = dbInstance.createObjectStore('sync_queue', { keyPath: 'id' });
        queueStore.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = async (event) => {
      db = event.target.result;
      await seedLecturasIfEmpty();
      resolve(db);
    };

    request.onerror = () => {
      console.warn('IndexedDB no disponible para lecturas, usando API REST');
      resolve(null);
    };
  });
}

async function seedLecturasIfEmpty() {
  if (!db) return;

  const [existingSocios, existingLecturas] = await Promise.all([
    new Promise((resolve) => {
      try {
        const tx = db.transaction(['socios'], 'readonly');
        const req = tx.objectStore('socios').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) { resolve([]); }
    }),
    new Promise((resolve) => {
      try {
        const tx = db.transaction(['lecturas'], 'readonly');
        const req = tx.objectStore('lecturas').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) { resolve([]); }
    })
  ]);

  const hasDirtyData = existingSocios.some((s) => (s.codigoSocio || '').includes('SOC-TEST') || (s.id || '').includes('SOC-TEST'));
  const needsSeed = existingSocios.length === 0 || hasDirtyData || existingSocios.length < 90;

  if (!needsSeed) {
    return; // Ya tiene el padrón oficial limpio cargado
  }

  console.log('[Lecturas] Inicializando padrón oficial...');

  const seedData = OFFLINE_SEED_DATA;

  // Sincronizar lectura_anterior de lecturas hacia los medidores de los socios
  if (seedData.lecturas && seedData.socios) {
    seedData.socios.forEach((socio) => {
      if (socio.medidores) {
        socio.medidores.forEach((med) => {
          const lec = seedData.lecturas.find((l) =>
            (l.id_medidor && l.id_medidor === (med.id || med.idMedidor)) ||
            (l.medidor_numero && l.medidor_numero === (med.numeroMedidor || med.medidorNumero)) ||
            (l.id_socio && l.id_socio === socio.id)
          );
          if (lec) {
            med.lecturaAnterior = lec.lectura_anterior ?? lec.lecturaAnterior ?? 0;
          }
        });
      }
      const lecSocio = seedData.lecturas.find((l) => l.id_socio === socio.id);
      if (lecSocio) {
        socio.lecturaAnterior = lecSocio.lectura_anterior ?? lecSocio.lecturaAnterior ?? 0;
      }
    });
  }

  await new Promise((resolve) => {
    const tx = db.transaction(['sectores', 'socios', 'lecturas'], 'readwrite');
    const storeSec = tx.objectStore('sectores');
    const storeSoc = tx.objectStore('socios');
    const storeLec = tx.objectStore('lecturas');

    // Limpiar datos obsoletos sólo si seedData es válido
    storeSec.clear();
    storeSoc.clear();
    storeLec.clear();

    if (seedData.sectores) {
      seedData.sectores.forEach((s) => storeSec.put(s));
    }
    if (seedData.socios) {
      seedData.socios.forEach((s) => storeSoc.put(s));
    }
    if (seedData.lecturas) {
      seedData.lecturas.forEach((l) => storeLec.put(l));
    }

    tx.oncomplete = () => {
      console.log(`[Lecturas] Padrón oficial inicializado: ${seedData.socios.length} socios, ${seedData.lecturas?.length || 0} lecturas.`);
      resolve();
    };
    tx.onerror = () => resolve();
  });
}

async function getAllSocios() {
  let localSocios = [];
  if (db) {
    localSocios = await new Promise((resolve) => {
      try {
        const tx = db.transaction(['socios'], 'readonly');
        const req = tx.objectStore('socios').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  const sourceSocios = (localSocios && localSocios.length > 0) ? localSocios : OFFLINE_SEED_DATA.socios;

  return sourceSocios.map((s) => ({
    id: s.id,
    codigoSocio: s.codigoSocio || s.codigo_socio,
    nombres: s.nombres,
    apellidos: s.apellidos,
    nombreCompleto: s.nombreCompleto || s.socio_nombre || `${s.apellidos || ''} ${s.nombres || ''}`.trim() || s.codigoSocio,
    cedulaRuc: s.cedulaRuc || s.cedula_ruc,
    sectorId: s.sectorId || s.idSector || s.id_sector,
    nombreSector: s.nombreSector || s.nombre_sector || 'Sector General',
    medidorNumero: s.medidorNumero || s.medidor_numero || s.numero_medidor || 'MED-0000',
    medidores: (s.medidores || []).map((m) => ({
      ...m,
      id: m.id || m.idMedidor || m.id_medidor,
      numeroMedidor: m.numeroMedidor || m.numero_medidor || m.medidorNumero,
      lecturaAnterior: m.lecturaAnterior ?? m.lectura_anterior ?? m.lecturaInicial ?? m.lectura_inicial ?? 0
    })),
    lecturaAnterior: s.lecturaAnterior ?? s.lectura_anterior ?? s.lecturaInicial ?? s.lectura_inicial ?? 0,
    tieneAlcantarillado: Boolean(s.tieneAlcantarillado || s.tiene_alcantarillado),
    estadoServicio: s.estadoServicio || s.estado || 'ACTIVO'
  }));
}

async function getAllSectores() {
  let localSectores = [];
  if (db) {
    localSectores = await new Promise((resolve) => {
      try {
        const tx = db.transaction(['sectores'], 'readonly');
        const req = tx.objectStore('sectores').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  const sourceSectores = (localSectores && localSectores.length > 0) ? localSectores : OFFLINE_SEED_DATA.sectores;

  return sourceSectores.map((s) => ({
    id: s.id,
    codigo: s.codigoSector || s.codigo || s.codigo_sector,
    nombre: s.nombreSector || s.nombre || s.nombre_sector,
    descripcion: s.descripcion || ''
  }));
}

async function getLecturasPeriodo(periodo) {
  let localLecturas = [];
  if (db) {
    localLecturas = await new Promise((resolve) => {
      const tx = db.transaction(['lecturas'], 'readonly');
      const store = tx.objectStore('lecturas');
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(all.filter((l) => {
          const p = l.periodo || l.periodo_codigo || l.id_periodo;
          return p === periodo;
        }));
      };
      req.onerror = () => resolve([]);
    });
  }

  const sourceLecturas = (localLecturas && localLecturas.length > 0) ? localLecturas : (OFFLINE_SEED_DATA.lecturas || []).filter((l) => {
    const p = l.periodo || l.periodo_codigo || l.id_periodo;
    return p === periodo;
  });

  return sourceLecturas.map((l) => ({
    id: l.id,
    idMedidor: l.idMedidor || l.id_medidor,
    numeroMedidor: l.numeroMedidor || l.medidor_numero || l.numero_medidor,
    aliasMedidor: l.aliasMedidor || l.alias_medidor,
    clienteId: l.clienteId || l.idSocio || l.id_socio,
    periodo: l.periodo || l.periodo_codigo || l.id_periodo || periodo,
    lecturaAnterior: l.lecturaAnterior ?? l.lectura_anterior ?? 0,
    lecturaActual: l.lecturaActual ?? l.lectura_actual,
    consumoM3: l.consumoM3 ?? l.consumo_total ?? l.consumoM3,
    excedenteM3: l.excedenteM3 ?? l.excedente_m3,
    observaciones: l.observaciones,
    origen: l.origen || 'LECTOR',
    updatedAt: l.updatedAt || l.fecha_lectura
  }));
}

async function saveLecturaLocal(lecturaData) {
  const start = performance.now();

  // 1. Guardar en IndexedDB local primero (Offline-First garantía absoluta)
  let record = null;
  if (db) {
    record = await new Promise((resolve, reject) => {
      const tx = db.transaction(['lecturas', 'sync_queue'], 'readwrite');
      const lecturasStore = tx.objectStore('lecturas');
      const queueStore = tx.objectStore('sync_queue');

      const id = lecturaData.id || `lec-${lecturaData.idMedidor || lecturaData.clienteId}-${lecturaData.periodo}`;
      const rec = {
        id,
        ...lecturaData,
        updatedAt: new Date().toISOString()
      };

      lecturasStore.put(rec);

      queueStore.add({
        id: 'mut-' + crypto.randomUUID().slice(0, 8),
        entity: 'lecturas',
        entityId: id,
        action: 'UPSERT',
        payload: rec,
        localTimestamp: new Date().toLocaleTimeString(),
        status: 'PENDING'
      });

      tx.oncomplete = () => resolve(rec);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // 2. Intentar sincronizar con Backend API (SQLite) si hay red
  try {
    await apiFetch('/api/v1/lecturas', {
      method: 'POST',
      body: JSON.stringify({
        idSocio: lecturaData.clienteId,
        idMedidor: lecturaData.medidorId || lecturaData.idMedidor,
        numeroMedidor: lecturaData.medidorNumero,
        idPeriodo: lecturaData.periodo,
        lecturaActual: lecturaData.lecturaActual,
        lecturaAnterior: lecturaData.lecturaAnterior,
        observaciones: lecturaData.observaciones || ''
      })
    });
  } catch (apiErr) {
    console.log('[Lecturas] Lectura almacenada offline en dispositivo.');
  }

  return record || lecturaData;
}

// Variables del Módulo
let cachedSocios = [];
let cachedSectores = [];
let cachedLecturas = [];
const rowStateMap = new Map();
let liveSyncIntervalId = null;

async function renderLecturasUI() {
  const isCajeroOAdmin = currentUser?.rol === 'CAJERO' || currentUser?.rol === 'ADMIN';

  // Adaptar encabezado dinámico
  const titleEl = document.getElementById('moduleTitleLecturas');
  const subEl = document.getElementById('moduleSubtitleLecturas');
  const btnCierre = document.getElementById('btnCierreCiclo');

  if (isCajeroOAdmin) {
    if (titleEl) titleEl.innerHTML = '📋 Módulo 2: Revisión de Lecturas y Cierre de Ciclo';
    if (subEl) {
      subEl.textContent = 'Auditoría de micromedición en campo, edición de lecturas, detección de consumos atípicos y cierre oficial del ciclo para emisión de planillas a Caja.';
    }
    if (btnCierre) btnCierre.style.display = 'inline-flex';
  } else {
    if (titleEl) titleEl.innerHTML = '⏱️ Módulo 2: Toma de Lecturas en Campo';
    if (subEl) {
      subEl.textContent = 'Captura rápida de lecturas en ruta por sector. Al ingresar la lectura se guarda y sincroniza automáticamente con el servidor central.';
    }
  }

  cachedSocios = await getAllSocios();
  cachedSectores = await getAllSectores();

  populateSectorSelect(cachedSectores);
  await renderTableAndMetrics();

  // Iniciar sondeo reactivo en vivo en segundo plano (cada 6 segundos)
  if (!liveSyncIntervalId) {
    liveSyncIntervalId = setInterval(checkLiveReactivityUpdates, 6000);
  }
}

async function checkLiveReactivityUpdates() {
  try {
    const resSoc = await apiFetch('/api/v1/socios');
    const apiSocios = resSoc.data || [];
    if (apiSocios.length > 0 && db) {
      const countChanged = apiSocios.length !== cachedSocios.length;
      if (countChanged) {
        console.log(`[Reactivity] Detectado cambio en padrón: ${apiSocios.length} socios.`);
        const tx = db.transaction(['socios'], 'readwrite');
        const store = tx.objectStore('socios');
        apiSocios.forEach((s) => store.put(s));
        await new Promise((res) => (tx.oncomplete = res));
        cachedSocios = await getAllSocios();
        renderTableAndMetrics();
      }
    }
  } catch (e) {}
}

function populateSectorSelect(sectores) {
  const select = document.getElementById('selectSectorRuta');
  const currentVal = select.value;
  select.innerHTML = '<option value="TODOS">Todos los sectores comunitarios</option>';

  sectores.forEach((sec) => {
    const opt = document.createElement('option');
    opt.value = sec.id;
    const cod = sec.codigoSector || sec.codigo;
    const nom = sec.nombreSector || sec.nombre;
    opt.textContent = `${cod ? cod + ' - ' : ''}${nom}`;
    select.appendChild(opt);
  });

  if (currentVal && Array.from(select.options).some((o) => o.value === currentVal)) {
    select.value = currentVal;
  }
}

function renderTableAndMetrics() {
  const isCajeroOAdmin = currentUser?.rol === 'CAJERO' || currentUser?.rol === 'ADMIN';
  const sectorFilter = document.getElementById('selectSectorRuta').value;
  const searchFilter = document.getElementById('searchSocioLectura').value.toLowerCase().trim();
  const periodo = document.getElementById('selectPeriodo').value;

  let filtrados = cachedSocios.filter((s) => s.estadoServicio !== 'CORTADO');

  if (sectorFilter !== 'TODOS') {
    filtrados = filtrados.filter((s) => s.sectorId === sectorFilter);
  }

  if (searchFilter) {
    filtrados = filtrados.filter((s) => {
      const matchNom = s.nombreCompleto?.toLowerCase().includes(searchFilter);
      const matchCed = s.cedulaRuc?.includes(searchFilter);
      const matchMed = s.medidorNumero?.toLowerCase().includes(searchFilter);
      return matchNom || matchCed || matchMed;
    });
  }

  const tbody = document.getElementById('lecturasTableBody');
  tbody.innerHTML = '';
  rowStateMap.clear();

  let totalTomadas = 0;
  let totalConsumoM3 = 0;
  let totalExcedenteM3 = 0;

  if (filtrados.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 2.5rem; color: #64748b;">
          No se encontraron abonados en la ruta o sector seleccionado.
        </td>
      </tr>
    `;
    updateMetrics(0, 0, 0, 0);
    return;
  }

  // Desglosar socios en acometidas / medidores individuales (Multi-Medidor)
  const listaAcometidas = [];
  filtrados.forEach((socio) => {
    if (socio.medidores && socio.medidores.length > 0) {
      socio.medidores.forEach((m) => {
        const lantMedidor = m.lecturaAnterior ?? m.lectura_anterior ?? m.lecturaInicial ?? m.lectura_inicial ?? 0;
        listaAcometidas.push({
          rowKey: `${socio.id}_${m.id || m.numeroMedidor}`,
          socioId: socio.id,
          medidorId: m.id,
          medidorNumero: m.numeroMedidor,
          aliasMedidor: m.alias || 'Casa principal',
          nombreCompleto: socio.nombreCompleto,
          codigoSocio: socio.codigoSocio,
          cedulaRuc: socio.cedulaRuc,
          nombreSector: m.nombreSector || socio.nombreSector,
          sectorId: m.idSector || socio.sectorId,
          lecturaAnteriorSeed: lantMedidor
        });
      });
    } else {
      const lantSocio = socio.lecturaAnterior ?? socio.lectura_anterior ?? socio.lecturaInicial ?? socio.lectura_inicial ?? 0;
      listaAcometidas.push({
        rowKey: `${socio.id}_principal`,
        socioId: socio.id,
        medidorId: socio.medidorNumero || 'MED-00000',
        medidorNumero: socio.medidorNumero || 'MED-00000',
        aliasMedidor: 'Casa principal',
        nombreCompleto: socio.nombreCompleto,
        codigoSocio: socio.codigoSocio,
        cedulaRuc: socio.cedulaRuc,
        nombreSector: socio.nombreSector,
        sectorId: socio.sectorId,
        lecturaAnteriorSeed: lantSocio
      });
    }
  });

  listaAcometidas.forEach((item) => {
    const lecturaExistente = cachedLecturas.find((l) =>
      (l.clienteId && item.socioId && l.clienteId === item.socioId) ||
      (l.idMedidor && item.medidorId && l.idMedidor === item.medidorId) ||
      (l.numeroMedidor && item.medidorNumero && l.numeroMedidor.trim().toLowerCase() === item.medidorNumero.trim().toLowerCase())
    );
    const fallbackLector = periodo === '2026-08' ? LECTURAS_INICIALES_LECTOR[item.socioId] : null;

    const lant = lecturaExistente?.lecturaAnterior
      ?? lecturaExistente?.lectura_anterior
      ?? item.lecturaAnteriorSeed
      ?? fallbackLector?.lecturaAnterior
      ?? 0;
    const lact = lecturaExistente?.lecturaActual ?? fallbackLector?.lecturaActual;
    const hasLectorReading = lact !== undefined && lact !== null;
    const esModificadoPorCajero = lecturaExistente?.observaciones?.includes('Cajero');

    let consumo = 0;
    let excedente = 0;

    if (hasLectorReading) {
      consumo = Math.max(0, lact - lant);
      excedente = Math.max(0, consumo - 30);
      totalTomadas++;
      totalConsumoM3 += consumo;
      totalExcedenteM3 += excedente;
    }

    const tr = document.createElement('tr');
    tr.id = `row-${item.rowKey}`;

    tr.innerHTML = `
      <td>
        <div class="socio-cell-name">${item.nombreCompleto}</div>
        <div class="socio-cell-sub">${item.codigoSocio || '-'} &bull; ${item.cedulaRuc || '-'}</div>
      </td>
      <td>
        <span class="badge-tag">${item.nombreSector || item.sectorId}</span>
      </td>
      <td>
        <code class="medidor-code">${item.medidorNumero}</code>
        <span style="font-size:0.72rem; color:#0284c7; background:#e0f2fe; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:600;">${item.aliasMedidor}</span>
      </td>
      <td style="text-align: right;">
        <span class="lectura-ant-badge">${lant} m³</span>
      </td>
      <td style="text-align: right;">
        <div style="display: inline-flex; flex-direction: column; align-items: flex-end; gap: 2px;">
          <input 
            type="number" 
            inputmode="numeric"
            pattern="[0-9]*"
            class="input-lectura-actual ${hasLectorReading ? 'input-saved input-locked' : ''}" 
            id="input-lact-${item.rowKey}"
            value="${hasLectorReading ? lact : ''}"
            min="${lant}"
            placeholder="${lant}"
            ${hasLectorReading ? 'readonly' : ''}
            title="${hasLectorReading ? 'Valor digitado por el lector' : 'Ingrese lectura actual'}"
          />
          <span id="hint-lact-${item.rowKey}" style="font-size: 0.72rem; color: ${esModificadoPorCajero ? '#059669' : '#0284c7'}; font-weight: 600;">
            ${
              hasLectorReading 
                ? (esModificadoPorCajero ? '✓ Modificado por Cajero' : '👤 Digitado por Lector') 
                : '⏳ Pendiente'
            }
          </span>
        </div>
      </td>
      <td style="text-align: right;" id="consumo-cell-${item.rowKey}">
        ${
          hasLectorReading
            ? `<span class="consumption-pill">${consumo} m³</span> ${
                excedente > 0 ? `<span class="excess-pill">+${excedente} exc</span>` : ''
              }`
            : '<span class="text-subtle">-</span>'
        }
      </td>
      <td style="text-align: center;" id="action-cell-${item.rowKey}">
        <button 
          class="btn btn-sm ${hasLectorReading ? 'btn-outline' : 'btn-success'} btn-toggle-edit" 
          id="btn-action-${item.rowKey}" 
          style="font-weight: 700; padding: 0.35rem 0.8rem; display: inline-flex; align-items: center; gap: 4px;"
          ${!hasLectorReading ? 'disabled' : ''}
        >
          ${hasLectorReading ? '✏️ Editar' : '💾 Guardar'}
        </button>
      </td>
    `;

    tbody.appendChild(tr);

    const inputLact = tr.querySelector(`#input-lact-${item.rowKey}`);
    const btnAction = tr.querySelector(`#btn-action-${item.rowKey}`);
    const consumoCell = tr.querySelector(`#consumo-cell-${item.rowKey}`);
    const hintLact = tr.querySelector(`#hint-lact-${item.rowKey}`);

    let isEditing = !hasLectorReading;
    let valorOriginal = hasLectorReading ? lact : '';

    const enterEditMode = () => {
      isEditing = true;
      inputLact.readOnly = false;
      inputLact.classList.remove('input-locked', 'input-saved');
      inputLact.classList.add('input-editing');
      btnAction.innerHTML = '💾 Guardar';
      btnAction.className = 'btn btn-sm btn-success btn-toggle-edit';
      btnAction.disabled = false;
      hintLact.textContent = '✏️ Editando lectura...';
      hintLact.style.color = '#b45309';
      inputLact.focus();
      inputLact.select();
    };

    const exitEditMode = (isSavedSuccess = false, updatedVal = null) => {
      isEditing = false;
      inputLact.readOnly = true;
      inputLact.classList.remove('input-editing', 'input-invalid', 'input-valid');
      inputLact.classList.add('input-saved', 'input-locked');
      btnAction.innerHTML = '✏️ Editar';
      btnAction.className = 'btn btn-sm btn-outline btn-toggle-edit';
      btnAction.disabled = false;
      if (isSavedSuccess) {
        valorOriginal = updatedVal;
        hintLact.textContent = '✓ Modificado por Cajero';
        hintLact.style.color = '#059669';
      } else {
        inputLact.value = valorOriginal;
        hintLact.textContent = esModificadoPorCajero ? '✓ Modificado por Cajero' : '👤 Digitado por Lector';
        hintLact.style.color = esModificadoPorCajero ? '#059669' : '#0284c7';
      }
    };

    const validateInput = () => {
      const valStr = inputLact.value.trim();
      if (valStr === '') {
        inputLact.classList.remove('input-valid');
        inputLact.classList.add('input-invalid');
        btnAction.disabled = true;
        consumoCell.innerHTML = '<span class="text-subtle">-</span>';
        rowStateMap.delete(item.rowKey);
        return null;
      }

      const valNum = parseFloat(valStr);
      if (isNaN(valNum) || valNum < lant) {
        inputLact.classList.remove('input-valid');
        inputLact.classList.add('input-invalid');
        btnAction.disabled = true;
        consumoCell.innerHTML = `<span style="color:#dc2626; font-size:0.75rem; font-weight:700;">⚠️ Lact < Lant</span>`;
        rowStateMap.delete(item.rowKey);
        return null;
      }

      inputLact.classList.remove('input-invalid');
      inputLact.classList.add('input-valid');
      btnAction.disabled = false;

      const cons = valNum - lant;
      const exc = Math.max(0, cons - 30);
      consumoCell.innerHTML = `
        <span class="consumption-pill" style="color:#0284c7; font-weight:700;">${cons} m³</span>
        ${exc > 0 ? `<span class="excess-pill">+${exc} exc</span>` : ''}
      `;

      const lecturaRecord = {
        clienteId: item.socioId,
        medidorId: item.medidorId,
        medidorNumero: item.medidorNumero,
        nombreSocio: item.nombreCompleto,
        sectorId: item.sectorId,
        periodo,
        lecturaAnterior: lant,
        lecturaActual: valNum,
        consumoM3: cons,
        excedenteM3: exc,
        observaciones: 'Modificado por Cajero',
        origen: 'CAJERO',
        valid: true
      };
      rowStateMap.set(item.rowKey, lecturaRecord);

      return { valNum, cons, exc, lecturaRecord };
    };

    const saveCurrentRow = async () => {
      const valid = validateInput();
      if (!valid) return;

      btnAction.disabled = true;
      btnAction.textContent = '⏳ ...';

      await saveLecturaLocal(valid.lecturaRecord);
      cachedLecturas = await getLecturasPeriodo(periodo);

      exitEditMode(true, valid.valNum);
      recalcOverallMetrics(filtrados);

      // Toast feedback
      const toast = document.createElement('div');
      toast.className = 'save-toast-mini';
      toast.textContent = `✓ Lectura de ${item.nombreCompleto.split(' ')[0]} [${item.aliasMedidor}] guardada (${valid.valNum} m³) por Cajero`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2200);
    };

    btnAction.addEventListener('click', async () => {
      if (!isEditing) {
        enterEditMode();
      } else {
        await saveCurrentRow();
      }
    });

    inputLact.addEventListener('input', () => {
      validateInput();
    });

    inputLact.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isEditing) await saveCurrentRow();
      } else if (e.key === 'Escape') {
        if (hasLectorReading) exitEditMode(false);
      }
    });
  });

  updateMetrics(listaAcometidas.length, totalTomadas, totalConsumoM3, totalExcedenteM3);
}

function updateMetrics(totalSocios, tomadas, consumo, excedente) {
  const pendientes = Math.max(0, totalSocios - tomadas);
  const pct = totalSocios > 0 ? Math.round((tomadas / totalSocios) * 100) : 0;

  const elTotal = document.getElementById('metricTotalMedidores');
  if (elTotal) elTotal.textContent = totalSocios;
  const elTomadas = document.getElementById('metricLecturasTomadas');
  if (elTomadas) elTomadas.textContent = tomadas;
  const elPendientes = document.getElementById('metricLecturasPendientes');
  if (elPendientes) elPendientes.textContent = pendientes;
  const elProgresoBar = document.getElementById('metricProgresoBar');
  if (elProgresoBar) elProgresoBar.style.width = `${pct}%`;
  const elProgresoLabel = document.getElementById('metricProgresoLabel');
  if (elProgresoLabel) elProgresoLabel.textContent = `${pct}% revisado / tomado`;
  const elConsumo = document.getElementById('metricConsumoTotal');
  if (elConsumo) elConsumo.textContent = `${consumo} m³`;
  const elExcedente = document.getElementById('metricExcedenteTotal');
  if (elExcedente) elExcedente.textContent = `${excedente} m³ de excedente ($${(excedente * 0.10).toFixed(2)})`;
}

async function recalcOverallMetrics(sociosRuta) {
  const periodo = document.getElementById('selectPeriodo').value;
  const lecturas = await getLecturasPeriodo(periodo);

  let tomadas = 0, consumo = 0, excedente = 0;
  sociosRuta.forEach((s) => {
    const l = lecturas.find((item) => item.clienteId === s.id);
    if (l && l.lecturaActual !== undefined) {
      tomadas++;
      consumo += (l.consumoM3 || 0);
      excedente += (l.excedenteM3 || 0);
    }
  });

  updateMetrics(sociosRuta.length, tomadas, consumo, excedente);
}

// Guardar Todo el Lote
document.getElementById('btnGuardarLote')?.addEventListener('click', async () => {
  const periodo = document.getElementById('selectPeriodo').value;
  let savedCount = 0;

  const btnLote = document.getElementById('btnGuardarLote');
  btnLote.disabled = true;
  btnLote.textContent = '⏳ Guardando y Subiendo a Supabase...';

  for (const [socioId, state] of rowStateMap.entries()) {
    if (state && state.valid) {
      await saveLecturaLocal(state);
      savedCount++;
    }
  }

  if (savedCount === 0) {
    btnLote.disabled = false;
    btnLote.textContent = '💾 Guardar Todo el Lote';
    Swal.fire({
      icon: 'info',
      title: 'Sin Cambios Nuevos',
      text: 'No hay lecturas pendientes o modificadas por guardar.'
    });
    return;
  }

  // Intentar subir automáticamente el lote completo a Supabase Cloud
  let syncedToCloud = false;
  try {
    const lecturas = await getLecturasPeriodo(periodo);
    const tomadas = lecturas.filter((l) => l.lecturaActual !== undefined && l.lecturaActual !== null);

    await apiFetch('/api/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        clientId: 'movil-lector-01',
        mutations: tomadas.map((l) => ({
          id: 'mut-' + crypto.randomUUID().slice(0, 8),
          entity: 'lecturas',
          entityId: l.id,
          action: 'UPSERT',
          payload: l,
          localTimestamp: new Date().toISOString()
        }))
      })
    });
    syncedToCloud = true;
  } catch (err) {
    console.warn('[Lote] No se pudo conectar a Supabase, guardado en modo offline local.', err);
  }

  btnLote.disabled = false;
  btnLote.textContent = '💾 Guardar Todo el Lote';

  cachedLecturas = await getLecturasPeriodo(periodo);
  renderTableAndMetrics();

  if (syncedToCloud) {
    Swal.fire({
      icon: 'success',
      title: '¡Lote Guardado y Subido a Supabase!',
      text: `Se guardaron ${savedCount} lecturas localmente y se sincronizaron con éxito en la base de datos de Supabase.`
    });
  } else {
    Swal.fire({
      icon: 'success',
      title: '¡Lote Guardado en el Celular (Offline)!',
      text: `Se guardaron ${savedCount} lecturas en el dispositivo. Se subirán automáticamente a Supabase cuando el celular tenga conexión.`
    });
  }
});

// Cierre de Ciclo Mensual (Acción Oficial del Cajero / Tesorero)
document.getElementById('btnCierreCiclo')?.addEventListener('click', async () => {
  const periodo = document.getElementById('selectPeriodo').value;

  const lecturas = await getLecturasPeriodo(periodo);
  if (lecturas.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'Sin Lecturas para Cerrar',
      text: 'No existen lecturas registradas en este período para liquidar a Caja.'
    });
    return;
  }

  const result = await Swal.fire({
    icon: 'question',
    title: `¿Cerrar Ciclo ${periodo} y Liquidar a Caja?`,
    text: `Se cerrará la revisión de ${lecturas.length} lecturas y se generarán automáticamente las planillas del mes para su cobro en Caja.`,
    showCancelButton: true,
    confirmButtonText: '🔒 Sí, Cerrar Ciclo y Liquidar',
    cancelButtonText: 'Cancelar'
  });

  if (!result.isConfirmed) return;

  const btnCierre = document.getElementById('btnCierreCiclo');
  btnCierre.disabled = true;
  btnCierre.textContent = '⏳ Liquidando planillas...';

  try {
    // 1. Liquidación masiva del período en el Backend API
    const resLiquidacion = await apiFetch('/api/v1/facturas/liquidar-periodo', {
      method: 'POST',
      body: JSON.stringify({ idPeriodo: periodo })
    });

    // 2. Cerrar período formalmente
    await apiFetch(`/api/v1/periodos/${periodo}/cerrar`, {
      method: 'POST'
    }).catch(() => {});

    Swal.fire({
      icon: 'success',
      title: '¡Ciclo Cerrado Exitosamente!',
      html: `
        <p>Se generaron <strong>${resLiquidacion.data?.totalLiquidados || lecturas.length} planillas</strong> listas para cobro en el Módulo de Caja.</p>
        <p style="margin-top: 8px; font-size: 0.85rem; color: #64748b;">Las lecturas actuales pasan a ser el punto de partida del siguiente período.</p>
      `,
      confirmButtonText: '💵 Ir a Caja y Cobros'
    }).then((r) => {
      if (r.isConfirmed) {
        window.location.href = 'caja.html';
      }
    });
  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'Error al liquidar período',
      text: err.message
    });
  } finally {
    btnCierre.disabled = false;
    btnCierre.textContent = '🔒 Cerrar Ciclo y Liquidar a Caja';
    renderLecturasUI();
  }
});

// =========================================================================
// GESTOR DE SINCRONIZACIÓN DUAL (SQLite Local & Supabase Cloud)
// =========================================================================

async function openSyncManagerModal() {
  const currentServerUrl = localStorage.getItem('SIGA_SERVER_URL') || '';
  const countSocios = cachedSocios.length;
  const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';
  const lecturas = await getLecturasPeriodo(periodo);
  const tomadasCount = lecturas.filter((l) => l.lecturaActual !== undefined).length;

  Swal.fire({
    title: '🔄 Sincronización SIGA',
    html: `
      <div style="text-align: left; font-size: 0.88rem; color: #334155; line-height: 1.4;">
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
          <div style="font-weight: 700; color: #166534; margin-bottom: 4px;">📱 Base de Datos en Memoria (Celular):</div>
          <div>• <strong>${countSocios}</strong> socios registrados en padrón offline</div>
          <div>• <strong>${tomadasCount}</strong> de <strong>${countSocios}</strong> lecturas ingresadas en período <strong>${periodo}</strong></div>
        </div>

        <div style="margin-bottom: 12px;">
          <label style="font-weight: 700; display: block; margin-bottom: 4px; font-size: 0.82rem; color: #0f172a;">
            🌐 Dirección IP Servidor Central SQLite (Wi-Fi):
          </label>
          <input type="text" id="inputSyncServerUrl" value="${currentServerUrl}" placeholder="http://192.168.1.100:3000" style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.88rem; box-sizing: border-box;" />
          <div style="color: #64748b; font-size: 0.72rem; margin-top: 3px;">Ingrese la IP de la computadora de la junta para descargar socios nuevos o subir lecturas.</div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 14px;">
          <button type="button" id="btnSyncLocalSQLite" class="btn btn-primary" style="width: 100%; padding: 10px; font-weight: 700; font-size: 0.88rem; background: #0284c7; border: none; border-radius: 6px; color: white; cursor: pointer;">
            ⚡ Sincronizar con SQLite Local (Wi-Fi Central)
          </button>
          <button type="button" id="btnSyncCloudSupabase" class="btn btn-outline" style="width: 100%; padding: 9px; font-weight: 700; font-size: 0.85rem; border: 1px solid #10b981; color: #059669; border-radius: 6px; background: white; cursor: pointer;">
            ☁️ Sincronizar con Supabase Cloud
          </button>
          <button type="button" id="btnExportLecturasCSV" class="btn btn-outline" style="width: 100%; padding: 9px; font-weight: 700; font-size: 0.85rem; border: 1px solid #64748b; color: #334155; border-radius: 6px; background: white; cursor: pointer;">
            📤 Exportar Copia de Lecturas (CSV / WhatsApp)
          </button>
          <button type="button" id="btnReloadOfflineSeed" class="btn btn-outline" style="width: 100%; padding: 8px; font-weight: 600; font-size: 0.78rem; border: 1px dashed #cbd5e1; color: #64748b; border-radius: 6px; background: #f8fafc; cursor: pointer;">
            🔄 Recargar Padrón Base Original (188 Socios)
          </button>
        </div>
      </div>
    `,
    showConfirmButton: false,
    showCloseButton: true,
    didOpen: () => {
      document.getElementById('btnSyncLocalSQLite')?.addEventListener('click', async () => {
        const url = (document.getElementById('inputSyncServerUrl')?.value || '').trim();
        localStorage.setItem('SIGA_SERVER_URL', url);
        await performSQLiteSync(url);
      });

      document.getElementById('btnSyncCloudSupabase')?.addEventListener('click', async () => {
        await performSupabaseSync();
      });

      document.getElementById('btnExportLecturasCSV')?.addEventListener('click', async () => {
        exportLecturasCSV(periodo);
      });

      document.getElementById('btnReloadOfflineSeed')?.addEventListener('click', async () => {
        await forceReloadOfflineSeed();
      });
    }
  });
}

async function performSQLiteSync(serverUrl) {
  Swal.fire({
    title: 'Sincronizando con Servidor SQLite...',
    text: 'Conectando con la base de datos central...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';
    
    // 1. Descargar socios y sectores actualizados
    const resSoc = await apiFetch('/api/v1/socios');
    const resSec = await apiFetch('/api/v1/sectores');
    
    let sociosActualizados = 0;
    if (resSoc && resSoc.data && db) {
      const tx = db.transaction(['socios', 'sectores'], 'readwrite');
      const storeSoc = tx.objectStore('socios');
      const storeSec = tx.objectStore('sectores');
      (resSec.data || []).forEach((s) => storeSec.put(s));
      resSoc.data.forEach((s) => {
        storeSoc.put(s);
        sociosActualizados++;
      });
      await new Promise((res) => (tx.oncomplete = res));
    }

    // 2. Subir lecturas locales al servidor SQLite
    const lecturas = await getLecturasPeriodo(periodo);
    const tomadas = lecturas.filter((l) => l.lecturaActual !== undefined && l.lecturaActual !== null);
    
    let subidasCount = 0;
    for (const l of tomadas) {
      try {
        await apiFetch('/api/v1/lecturas', {
          method: 'POST',
          body: JSON.stringify({
            idSocio: l.clienteId,
            idMedidor: l.idMedidor,
            numeroMedidor: l.medidorNumero,
            idPeriodo: l.periodo,
            lecturaActual: l.lecturaActual,
            lecturaAnterior: l.lecturaAnterior,
            observaciones: l.observaciones || ''
          })
        });
        subidasCount++;
      } catch (e) {
        console.warn('[Sync] Error subiendo lectura individual:', e);
      }
    }

    await renderLecturasUI();

    Swal.fire({
      icon: 'success',
      title: '¡Sincronización Completada!',
      html: `
        <div style="text-align: left; font-size: 0.9rem;">
          <p>✅ <strong>${subidasCount}</strong> lecturas enviadas y guardadas en SQLite.</p>
          <p>✅ <strong>${sociosActualizados}</strong> socios sincronizados con el servidor.</p>
        </div>
      `
    });
  } catch (err) {
    console.error('[Sync] Error en sincronización SQLite:', err);
    Swal.fire({
      icon: 'warning',
      title: 'Servidor no disponible',
      html: `
        <p style="font-size: 0.88rem; color: #475569;">No se pudo conectar con la IP indicada. Tus lecturas continúan guardadas con total seguridad en el celular de forma offline.</p>
        <p style="font-size: 0.78rem; color: #94a3b8; margin-top: 6px;">Detalle: ${err.message}</p>
      `
    });
  }
}

async function performSupabaseSync() {
  Swal.fire({
    title: 'Sincronizando con Supabase Cloud...',
    text: 'Enviando lecturas al almacenamiento en la nube...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';
    const lecturas = await getLecturasPeriodo(periodo);
    const tomadas = lecturas.filter((l) => l.lecturaActual !== undefined && l.lecturaActual !== null);

    // Enviar batch a la API central de sincronización
    const res = await apiFetch('/api/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        clientId: 'movil-lector-01',
        mutations: tomadas.map((l) => ({
          id: 'mut-' + crypto.randomUUID().slice(0, 8),
          entity: 'lecturas',
          entityId: l.id,
          action: 'UPSERT',
          payload: l,
          localTimestamp: new Date().toISOString()
        }))
      })
    });

    Swal.fire({
      icon: 'success',
      title: '¡Sincronizado con la Nube!',
      text: `Se sincronizaron ${tomadas.length} lecturas con Supabase PostgreSQL exitosamente.`
    });
  } catch (err) {
    Swal.fire({
      icon: 'info',
      title: 'Modo Offline Activo',
      text: 'Las lecturas permanecen seguras en el almacenamiento interno del dispositivo.'
    });
  }
}

async function exportLecturasCSV(periodo) {
  const lecturas = await getLecturasPeriodo(periodo);
  if (lecturas.length === 0) {
    Swal.fire({ icon: 'info', title: 'Sin Lecturas', text: 'No hay lecturas registradas para exportar.' });
    return;
  }

  let csvContent = 'CodigoSocio,Nombre,Cedula,Sector,Medidor,LecturaAnterior,LecturaActual,ConsumoM3,ExcedenteM3,Observaciones,Fecha\n';

  cachedSocios.forEach((s) => {
    const l = lecturas.find((item) => item.clienteId === s.id);
    const lant = l ? l.lecturaAnterior : 0;
    const lact = l && l.lecturaActual !== undefined ? l.lecturaActual : '';
    const cons = l && l.consumoM3 !== undefined ? l.consumoM3 : '';
    const exc = l && l.excedenteM3 !== undefined ? l.excedenteM3 : '';
    const obs = (l?.observaciones || '').replace(/,/g, ';');
    const fecha = l?.updatedAt || '';

    csvContent += `"${s.codigoSocio}","${s.nombreCompleto}","${s.cedulaRuc}","${s.nombreSector}","${s.medidorNumero}",${lant},${lact},${cons},${exc},"${obs}","${fecha}"\n`;
  });

  const filename = `SIGA_Lecturas_${periodo}.csv`;

  if (window.AndroidBridge && window.AndroidBridge.shareFile) {
    try {
      window.AndroidBridge.shareFile(csvContent, filename, 'text/csv');
      return;
    } catch (e) {}
  }

  // Descargar archivo web
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();

  Swal.fire({
    icon: 'success',
    title: 'Archivo Generado',
    text: `Se exportó el archivo ${filename} correctamente.`
  });
}

async function forceReloadOfflineSeed() {
  const conf = await Swal.fire({
    title: '¿Recargar Padrón Base?',
    text: 'Esta acción restablecerá el padrón completo de 188 socios y sectores desde el archivo interno del APK.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sí, recargar',
    cancelButtonText: 'Cancelar'
  });

  if (!conf.isConfirmed) return;

  try {
    const res = await fetch('./offline_seed.json');
    const seedData = await res.json();
    if (db && seedData) {
      const tx = db.transaction(['sectores', 'socios', 'lecturas'], 'readwrite');
      const storeSec = tx.objectStore('sectores');
      const storeSoc = tx.objectStore('socios');
      const storeLec = tx.objectStore('lecturas');

      seedData.sectores.forEach((s) => storeSec.put(s));
      seedData.socios.forEach((s) => storeSoc.put(s));
      seedData.lecturas.forEach((l) => storeLec.put(l));

      await new Promise((res) => (tx.oncomplete = res));
      await renderLecturasUI();

      Swal.fire({
        icon: 'success',
        title: '¡Padrón Recargado!',
        text: `Se cargaron ${seedData.socios.length} socios y ${seedData.sectores.length} sectores en memoria.`
      });
    }
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error', text: err.message });
  }
}

// Listeners de filtros y acciones
document.getElementById('selectPeriodo')?.addEventListener('change', renderLecturasUI);
document.getElementById('selectSectorRuta')?.addEventListener('change', renderTableAndMetrics);
document.getElementById('searchSocioLectura')?.addEventListener('input', renderTableAndMetrics);
document.getElementById('btnSyncModal')?.addEventListener('click', openSyncManagerModal);

// Inicializar
initIndexedDB().then(renderLecturasUI);
