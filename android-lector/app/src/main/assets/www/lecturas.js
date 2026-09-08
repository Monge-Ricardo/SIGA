import { requireAuth, apiFetch } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';
import { syncEngine } from './sync-engine.js';

// Guard de autenticación (Accesible por ADMIN, CAJERO y LECTOR)
const currentUser = requireAuth(['ADMIN', 'CAJERO', 'LECTOR']);
if (currentUser) {
  injectAppLayout('lecturas');
}

let db = null;

async function initIndexedDB() {
  try {
    db = await syncEngine.getDb();
    await seedLecturasIfEmpty();
    return db;
  } catch (err) {
    console.warn('Error inicializando base de datos local:', err);
    return null;
  }
}

async function seedLecturasIfEmpty() {
  if (!db) return;

  const existingSocios = await new Promise((resolve) => {
    try {
      const tx = db.transaction(['socios'], 'readonly');
      const req = tx.objectStore('socios').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });

  const hasDirtyData = existingSocios.some((s) => (s.codigoSocio || '').includes('SOC-TEST') || (s.id || '').includes('SOC-TEST'));
  const needsSeed = existingSocios.length === 0 || hasDirtyData;

  if (!needsSeed) return;

  console.log('[Lecturas] Inicializando padrón oficial...');
  let seedData = null;
  try {
    const resSoc = await apiFetch('/api/v1/socios');
    const resSec = await apiFetch('/api/v1/sectores');
    const resLec = await apiFetch('/api/v1/lecturas?periodoId=2026-08');
    if (resSoc && resSoc.data && resSoc.data.length > 0) {
      seedData = {
        socios: resSoc.data,
        sectores: resSec.data || [],
        lecturas: resLec.data || []
      };
    }
  } catch (e) {
    console.warn('[Lecturas] API no disponible para seed, intentando offline_seed.json');
  }

  if (!seedData) {
    try {
      const res = await fetch('./offline_seed.json');
      if (res.ok) seedData = await res.json();
    } catch (e) {}
  }

  if (seedData) {
    await new Promise((resolve) => {
      const tx = db.transaction(['sectores', 'socios', 'lecturas'], 'readwrite');
      const storeSec = tx.objectStore('sectores');
      const storeSoc = tx.objectStore('socios');
      const storeLec = tx.objectStore('lecturas');

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
        console.log(`[Lecturas] Padrón inicializado: ${seedData.socios?.length || 0} socios.`);
        resolve();
      };
      tx.onerror = () => resolve();
    });
  }
}

async function getAllSocios() {
  // 1. Intentar siempre obtener los datos frescos de la API
  try {
    const res = await apiFetch('/api/v1/socios');
    const apiSocios = res.data || [];
    if (apiSocios.length > 0) {
      if (db) {
        const txWrite = db.transaction(['socios'], 'readwrite');
        const store = txWrite.objectStore('socios');
        apiSocios.forEach((s) => store.put(s));
      }
      return normalizeSociosList(apiSocios);
    }
  } catch (err) {
    console.log('[Lecturas] Modo offline activo para socios, consultando IndexedDB local');
  }

  // 2. Fallback a IndexedDB local
  if (db) {
    const localSocios = await new Promise((resolve) => {
      try {
        const tx = db.transaction(['socios'], 'readonly');
        const req = tx.objectStore('socios').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });

    if (localSocios && localSocios.length > 0) {
      return normalizeSociosList(localSocios);
    }
  }

  return [];
}

function normalizeSociosList(rawList) {
  return rawList.map((s) => ({
    id: s.id,
    codigoSocio: s.codigoSocio || s.codigo_socio,
    nombres: s.nombres,
    apellidos: s.apellidos,
    nombreCompleto: s.nombreCompleto || `${s.nombres || ''} ${s.apellidos || ''}`.trim() || s.codigoSocio,
    cedulaRuc: s.cedulaRuc || s.cedula_ruc,
    sectorId: s.idSector || s.sectorId || s.id_sector,
    nombreSector: s.nombreSector || s.nombre_sector || 'Sector General',
    medidorNumero: s.medidorNumero || s.medidor_numero || 'MED-0000',
    medidores: (s.medidores || []).map((m) => ({
      id: m.id || m.idMedidor,
      idMedidor: m.id || m.idMedidor,
      idSocio: m.idSocio || m.id_socio || s.id,
      idSector: m.idSector || m.id_sector,
      numeroMedidor: m.numeroMedidor || m.numero_medidor || m.medidorNumero,
      medidorNumero: m.numeroMedidor || m.numero_medidor || m.medidorNumero,
      alias: m.alias || 'Casa principal',
      aliasMedidor: m.alias || 'Casa principal',
      lecturaInicial: Number(m.lecturaInicial ?? m.lectura_inicial ?? m.lecturaAnterior ?? m.lectura_anterior ?? 0),
      lecturaAnterior: Number(m.lecturaAnterior ?? m.lectura_anterior ?? m.lecturaInicial ?? m.lectura_inicial ?? 0),
      deudaPendiente: Number(m.deudaPendiente ?? m.deuda_pendiente ?? 0),
      mesesAdeudados: Number(m.mesesAdeudados ?? m.meses_adeudados ?? 0),
      tieneAlcantarillado: Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado),
      estado: m.estado || 'ACTIVO'
    })),
    tieneAlcantarillado: Boolean(s.tieneAlcantarillado ?? s.tiene_alcantarillado),
    estadoServicio: s.estadoServicio || s.estado || 'ACTIVO'
  }));
}

async function getAllSectores() {
  try {
    const res = await apiFetch('/api/v1/sectores');
    const sectores = res.data || [];
    if (sectores.length > 0 && db) {
      const txWrite = db.transaction(['sectores'], 'readwrite');
      const store = txWrite.objectStore('sectores');
      sectores.forEach((sec) => store.put(sec));
    }
    return sectores.map((s) => ({
      id: s.id,
      codigo: s.codigoSector || s.codigo || s.codigo_sector,
      nombre: s.nombreSector || s.nombre || s.nombre_sector,
      descripcion: s.descripcion || ''
    }));
  } catch (err) {}

  if (db) {
    const localSectores = await new Promise((resolve) => {
      try {
        const tx = db.transaction(['sectores'], 'readonly');
        const req = tx.objectStore('sectores').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });

    if (localSectores.length > 0) {
      return localSectores.map((s) => ({
        id: s.id,
        codigo: s.codigoSector || s.codigo || s.codigo_sector,
        nombre: s.nombreSector || s.nombre || s.nombre_sector,
        descripcion: s.descripcion || ''
      }));
    }
  }

  return [];
}

async function getLecturasPeriodo(periodo) {
  // 1. Priorizar consulta en vivo a la API REST (SQLite / Supabase)
  try {
    const res = await apiFetch(`/api/v1/lecturas?periodoId=${encodeURIComponent(periodo)}`);
    const apiData = res.data || [];
    if (apiData.length > 0) {
      const normalized = apiData.map((l) => ({
        id: l.id,
        idMedidor: l.idMedidor || l.id_medidor,
        numeroMedidor: l.numeroMedidor || l.numero_medidor || l.medidorNumero,
        aliasMedidor: l.aliasMedidor || l.alias_medidor || l.alias || 'Casa principal',
        clienteId: l.idSocio || l.id_socio || l.clienteId,
        idSocio: l.idSocio || l.id_socio || l.clienteId,
        periodo: l.periodoCodigo || l.periodo_codigo || l.periodo || l.idPeriodo || l.id_periodo || periodo,
        lecturaAnterior: Number(l.lecturaAnterior ?? l.lectura_anterior ?? 0),
        lecturaActual: (l.lecturaActual !== undefined && l.lecturaActual !== null)
          ? Number(l.lecturaActual)
          : ((l.lectura_actual !== undefined && l.lectura_actual !== null) ? Number(l.lectura_actual) : undefined),
        consumoM3: Number(l.consumoM3 ?? l.consumoTotal ?? l.consumo_total ?? 0),
        excedenteM3: Number(l.excedenteM3 ?? l.excedente_m3 ?? 0),
        observaciones: l.observaciones || '',
        origen: l.origen || 'LECTOR',
        updatedAt: l.updatedAt || l.updated_at || new Date().toISOString()
      }));

      // Cachear en IndexedDB
      if (db) {
        const tx = db.transaction(['lecturas'], 'readwrite');
        const store = tx.objectStore('lecturas');
        normalized.forEach((lec) => store.put(lec));
      }

      return normalized;
    }
  } catch (err) {
    console.log('[Lecturas] Modo offline activo para lecturas, consultando IndexedDB');
  }

  // 2. Fallback a IndexedDB local
  if (db) {
    const localLecturas = await new Promise((resolve) => {
      const tx = db.transaction(['lecturas'], 'readonly');
      const store = tx.objectStore('lecturas');
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(all.filter((l) =>
          l.periodo === periodo ||
          l.periodo_codigo === periodo ||
          l.id_periodo === periodo ||
          l.idPeriodo === periodo ||
          (periodo === '2026-08' && (!l.periodo || l.periodo === '2026-08'))
        ));
      };
      req.onerror = () => resolve([]);
    });

    if (localLecturas.length > 0) {
      return localLecturas.map((l) => ({
        id: l.id,
        idMedidor: l.idMedidor || l.id_medidor,
        numeroMedidor: l.numeroMedidor || l.numero_medidor || l.medidorNumero,
        aliasMedidor: l.aliasMedidor || l.alias_medidor || l.alias || 'Casa principal',
        clienteId: l.idSocio || l.id_socio || l.clienteId,
        idSocio: l.idSocio || l.id_socio || l.clienteId,
        periodo: l.periodo || l.periodo_codigo || periodo,
        lecturaAnterior: Number(l.lecturaAnterior ?? l.lectura_anterior ?? 0),
        lecturaActual: (l.lecturaActual !== undefined && l.lecturaActual !== null)
          ? Number(l.lecturaActual)
          : ((l.lectura_actual !== undefined && l.lectura_actual !== null) ? Number(l.lectura_actual) : undefined),
        consumoM3: Number(l.consumoM3 ?? l.consumoTotal ?? l.consumo_total ?? 0),
        excedenteM3: Number(l.excedenteM3 ?? l.excedente_m3 ?? 0),
        observaciones: l.observaciones || '',
        origen: l.origen || 'LECTOR',
        updatedAt: l.updatedAt || l.updated_at
      }));
    }
  }

  return [];
}

async function saveLecturaLocal(lecturaData) {
  const start = performance.now();

  const id = lecturaData.id || `lec-${lecturaData.idMedidor || lecturaData.clienteId}-${lecturaData.periodo}`;
  const rec = {
    id,
    idMedidor: lecturaData.idMedidor,
    numeroMedidor: lecturaData.medidorNumero,
    clienteId: lecturaData.clienteId,
    idSocio: lecturaData.clienteId,
    periodo: lecturaData.periodo,
    lecturaAnterior: Number(lecturaData.lecturaAnterior),
    lecturaActual: Number(lecturaData.lecturaActual),
    consumoM3: Number(lecturaData.consumoM3),
    excedenteM3: Number(lecturaData.excedenteM3),
    observaciones: lecturaData.observaciones || (currentUser?.rol === 'CAJERO' ? 'Modificado por Cajero' : 'Toma de lectura en campo'),
    origen: lecturaData.origen || (currentUser?.rol === 'CAJERO' ? 'CAJERO' : 'LECTOR'),
    updatedAt: new Date().toISOString()
  };

  // 1. Guardar en IndexedDB local (Garantía offline inmediata <20 ms)
  if (db) {
    try {
      const tx = db.transaction(['lecturas'], 'readwrite');
      tx.objectStore('lecturas').put(rec);
    } catch (e) {
      console.warn('[Lecturas] Error guardando en IndexedDB:', e);
    }
  }

  // 2. Registrar en cola outbox Git (Commit local) y disparar Push si hay red
  await syncEngine.enqueueMutation('lecturas', id, 'UPSERT', rec);

  return rec;
}

// Variables del Módulo
let cachedSocios = [];
let cachedSectores = [];
let cachedLecturas = [];
const rowStateMap = new Map();
let liveSyncIntervalId = null;

async function renderLecturasUI() {
  const isCajeroOAdmin = currentUser?.rol === 'CAJERO' || currentUser?.rol === 'ADMIN';

  const titleEl = document.getElementById('moduleTitleLecturas');
  const subEl = document.getElementById('moduleSubtitleLecturas');
  const btnCierre = document.getElementById('btnCierreCiclo');
  const btnPull = document.getElementById('btnPullLector');
  const btnPush = document.getElementById('btnPushLector');

  if (isCajeroOAdmin) {
    if (titleEl) titleEl.innerHTML = '📋 Módulo 2: Revisión de Lecturas y Cierre de Ciclo';
    if (subEl) {
      subEl.textContent = 'Auditoría de micromedición en campo, edición de lecturas, detección de consumos y cierre oficial del ciclo para emisión de planillas a Caja.';
    }
    if (btnCierre) btnCierre.style.display = 'inline-flex';
    if (btnPull) btnPull.style.display = 'inline-flex';
    if (btnPush) btnPush.style.display = 'none';
  } else {
    if (titleEl) titleEl.innerHTML = '⏱️ Módulo 2: Toma de Lecturas en Campo';
    if (subEl) {
      subEl.textContent = 'Captura rápida de lecturas en ruta por sector. Al ingresar la lectura se guarda y sincroniza automáticamente con el servidor central.';
    }
    if (btnCierre) btnCierre.style.display = 'none';
    if (btnPull) btnPull.style.display = 'none';
    if (btnPush) btnPush.style.display = 'inline-flex';
  }

  const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';

  // Cargar datos en paralelo
  const [socios, sectores, lecturas] = await Promise.all([
    getAllSocios(),
    getAllSectores(),
    getLecturasPeriodo(periodo)
  ]);

  cachedSocios = socios;
  cachedSectores = sectores;
  cachedLecturas = lecturas;

  populateSectorSelect(cachedSectores);
  await renderTableAndMetrics();

  // Iniciar sondeo reactivo en vivo en segundo plano (cada 8 segundos)
  if (!liveSyncIntervalId) {
    liveSyncIntervalId = setInterval(checkLiveReactivityUpdates, 8000);
  }
}

async function checkLiveReactivityUpdates() {
  try {
    const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';
    const [resSoc, resLec] = await Promise.all([
      apiFetch('/api/v1/socios'),
      apiFetch(`/api/v1/lecturas?periodoId=${encodeURIComponent(periodo)}`)
    ]);

    const apiSocios = resSoc.data || [];
    const apiLecturas = resLec.data || [];

    let needsRerender = false;

    if (apiSocios.length > 0 && apiSocios.length !== cachedSocios.length) {
      console.log(`[Reactivity] Cambio en padrón detectado: ${apiSocios.length} socios.`);
      cachedSocios = normalizeSociosList(apiSocios);
      needsRerender = true;
    }

    if (apiLecturas.length > 0) {
      cachedLecturas = apiLecturas.map((l) => ({
        id: l.id,
        idMedidor: l.idMedidor || l.id_medidor,
        numeroMedidor: l.numeroMedidor || l.numero_medidor || l.medidorNumero,
        aliasMedidor: l.aliasMedidor || l.alias_medidor || l.alias || 'Casa principal',
        clienteId: l.idSocio || l.id_socio || l.clienteId,
        idSocio: l.idSocio || l.id_socio || l.clienteId,
        periodo: l.periodoCodigo || l.periodo_codigo || periodo,
        lecturaAnterior: Number(l.lecturaAnterior ?? l.lectura_anterior ?? 0),
        lecturaActual: (l.lecturaActual !== undefined && l.lecturaActual !== null)
          ? Number(l.lecturaActual)
          : ((l.lectura_actual !== undefined && l.lectura_actual !== null) ? Number(l.lectura_actual) : undefined),
        consumoM3: Number(l.consumoM3 ?? l.consumoTotal ?? l.consumo_total ?? 0),
        excedenteM3: Number(l.excedenteM3 ?? l.excedente_m3 ?? 0),
        observaciones: l.observaciones || '',
        origen: l.origen || 'LECTOR',
        updatedAt: l.updatedAt || l.updated_at
      }));
    }

    if (needsRerender) {
      renderTableAndMetrics();
    }
  } catch (e) {}
}

function populateSectorSelect(sectores) {
  const select = document.getElementById('selectSectorRuta');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="TODOS">Todos los sectores comunitarios</option>';

  sectores.forEach((sec) => {
    const opt = document.createElement('option');
    opt.value = sec.id;
    const cod = sec.codigo || sec.codigoSector;
    const nom = sec.nombre || sec.nombreSector;
    opt.textContent = `${cod ? cod + ' - ' : ''}${nom}`;
    select.appendChild(opt);
  });

  if (currentVal && Array.from(select.options).some((o) => o.value === currentVal)) {
    select.value = currentVal;
  }
}

function renderTableAndMetrics() {
  const isCajeroOAdmin = currentUser?.rol === 'CAJERO' || currentUser?.rol === 'ADMIN';
  const sectorFilter = document.getElementById('selectSectorRuta')?.value || 'TODOS';
  const searchFilter = (document.getElementById('searchSocioLectura')?.value || '').toLowerCase().trim();
  const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';

  let filtrados = cachedSocios.filter((s) => s.estadoServicio !== 'CORTADO');

  if (sectorFilter !== 'TODOS') {
    filtrados = filtrados.filter((s) => s.sectorId === sectorFilter);
  }

  if (searchFilter) {
    filtrados = filtrados.filter((s) => {
      const matchNom = (s.nombreCompleto || '').toLowerCase().includes(searchFilter);
      const matchCed = (s.cedulaRuc || '').includes(searchFilter);
      const matchMed = (s.medidorNumero || '').toLowerCase().includes(searchFilter);
      return matchNom || matchCed || matchMed;
    });
  }

  const tbody = document.getElementById('lecturasTableBody');
  if (!tbody) return;
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
        listaAcometidas.push({
          rowKey: `${socio.id}_${m.id || m.numeroMedidor}`,
          socioId: socio.id,
          medidorId: m.id || m.idMedidor,
          medidorNumero: m.numeroMedidor || m.medidorNumero,
          aliasMedidor: m.alias || m.aliasMedidor || 'Casa principal',
          nombreCompleto: socio.nombreCompleto,
          codigoSocio: socio.codigoSocio,
          cedulaRuc: socio.cedulaRuc,
          nombreSector: m.nombreSector || socio.nombreSector,
          sectorId: m.idSector || socio.sectorId,
          lecturaAnterior: Number(m.lecturaAnterior ?? m.lecturaInicial ?? 0),
          lecturaInicial: Number(m.lecturaInicial ?? m.lecturaAnterior ?? 0)
        });
      });
    } else {
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
        lecturaAnterior: 0,
        lecturaInicial: 0
      });
    }
  });

  listaAcometidas.forEach((item) => {
    const lecturaExistente = cachedLecturas.find((l) =>
      (l.idMedidor && l.idMedidor === item.medidorId) ||
      (l.numeroMedidor && l.numeroMedidor === item.medidorNumero) ||
      (l.clienteId && l.clienteId === item.socioId && !l.idMedidor)
    );

    // Lectura anterior real: se toma de la base del medidor o de la lectura registrada
    const lant = Number(lecturaExistente?.lecturaAnterior ?? item.lecturaAnterior ?? item.lecturaInicial ?? 0);
    const lactRaw = lecturaExistente?.lecturaActual;
    const hasLectorReading = lactRaw !== undefined && lactRaw !== null && (lecturaExistente?.observaciones !== 'Alta inicial de socio' || lactRaw > 0);
    const lact = hasLectorReading ? Number(lactRaw) : undefined;
    const esModificadoPorCajero = lecturaExistente?.observaciones?.includes('Cajero');

    let consumo = 0;
    let excedente = 0;

    if (hasLectorReading && lact !== undefined) {
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
            title="${hasLectorReading ? 'Lectura guardada' : 'Ingrese lectura actual del medidor'}"
          />
          <span id="hint-lact-${item.rowKey}" style="font-size: 0.72rem; color: ${esModificadoPorCajero ? '#059669' : hasLectorReading ? '#0284c7' : '#94a3b8'}; font-weight: 600;">
            ${
              hasLectorReading 
                ? (esModificadoPorCajero ? '✓ Modificado por Cajero' : '✓ Digitado en Campo') 
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
        hintLact.textContent = isCajeroOAdmin ? '✓ Modificado por Cajero' : '✓ Digitado en Campo';
        hintLact.style.color = '#059669';
      } else {
        inputLact.value = valorOriginal !== '' && valorOriginal !== undefined ? valorOriginal : '';
        hintLact.textContent = hasLectorReading ? (esModificadoPorCajero ? '✓ Modificado por Cajero' : '✓ Digitado en Campo') : '⏳ Pendiente';
        hintLact.style.color = hasLectorReading ? '#0284c7' : '#94a3b8';
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

      const cons = Number((valNum - lant).toFixed(2));
      const exc = Number(Math.max(0, cons - 30).toFixed(2));
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
        observaciones: isCajeroOAdmin ? 'Modificado por Cajero' : 'Toma de lectura en campo',
        origen: isCajeroOAdmin ? 'CAJERO' : 'LECTOR',
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
      toast.textContent = `✓ Lectura de ${item.nombreCompleto.split(' ')[0]} guardada (${valid.valNum} m³) y sincronizada`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2500);
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
  if (elConsumo) elConsumo.textContent = `${consumo.toFixed(1)} m³`;
  const elExcedente = document.getElementById('metricExcedenteTotal');
  if (elExcedente) elExcedente.textContent = `${excedente.toFixed(1)} m³ de excedente ($${(excedente * 0.10).toFixed(2)})`;
}

async function recalcOverallMetrics(sociosRuta) {
  const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';
  const lecturas = await getLecturasPeriodo(periodo);

  let tomadas = 0, consumo = 0, excedente = 0;
  sociosRuta.forEach((s) => {
    const l = lecturas.find((item) => item.clienteId === s.id || item.idSocio === s.id);
    if (l && l.lecturaActual !== undefined && l.lecturaActual > 0) {
      tomadas++;
      consumo += (l.consumoM3 || 0);
      excedente += (l.excedenteM3 || 0);
    }
  });

  const totalAcometidas = sociosRuta.reduce((acc, s) => acc + (s.medidores?.length || 1), 0);
  updateMetrics(totalAcometidas, tomadas, consumo, excedente);
}

// Cierre de Ciclo
document.getElementById('btnCierreCiclo')?.addEventListener('click', async () => {
  const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';
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
    const resLiquidacion = await apiFetch('/api/v1/facturas/liquidar-periodo', {
      method: 'POST',
      body: JSON.stringify({ idPeriodo: periodo })
    });

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

// Sincronización Git-Like (Local-First Push/Pull)
async function executePush() {
  Swal.fire({
    title: '⬆️ Subiendo Cambios (Push)...',
    text: 'Enviando lecturas registradas a la Nube...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const res = await syncEngine.pushPending();
  if (res.success) {
    Swal.fire({
      icon: 'success',
      title: '¡Push Exitoso!',
      html: `<p>Se subieron <strong>${res.pushed || 0}</strong> cambios a la nube sin errores.</p>`
    });
  } else {
    Swal.fire({
      icon: 'warning',
      title: 'Aviso de Sincronización',
      text: res.reason || res.error || 'No se pudo conectar. Las lecturas permanecen seguras en el celular.'
    });
  }
  await renderLecturasUI();
}

async function executePull() {
  Swal.fire({
    title: '⬇️ Descargando Datos (Pull)...',
    text: 'Consultando socios, medidores y lecturas del servidor...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const res = await syncEngine.pullDeltas();
  if (res.success) {
    await renderLecturasUI();
    Swal.fire({
      icon: 'success',
      title: '¡Pull Exitoso!',
      html: `<p>Se descargaron y actualizaron <strong>${res.pulled || 0}</strong> registros en este dispositivo.</p>`
    });
  } else {
    Swal.fire({
      icon: 'warning',
      title: 'Aviso de Sincronización',
      text: res.error || 'No se pudo consultar el servidor remoto.'
    });
  }
}

async function executeFullSync() {
  Swal.fire({
    title: '🔄 Sincronizando Todo...',
    text: 'Ejecutando ciclo Pull + Push con la nube...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const res = await syncEngine.syncAll(currentUser?.rol || 'LECTOR');
  await renderLecturasUI();
  Swal.fire({
    icon: 'success',
    title: '¡Sincronización Completa!',
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <p>✅ <strong>${cachedSocios.length}</strong> Socios al día.</p>
        <p>✅ <strong>${cachedLecturas.length}</strong> Lecturas sincronizadas en tiempo real.</p>
      </div>
    `
  });
}

async function openSyncManagerModal() {
  const pendingCount = await syncEngine.getPendingCount();
  const lastSync = syncEngine.getLastSyncTimestamp();
  const serverUrl = syncEngine.getServerUrl();
  const isOnline = navigator.onLine;

  Swal.fire({
    title: '🔄 Centro Git de Sincronización',
    html: `
      <div style="text-align: left; font-size: 0.88rem; color: #334155; line-height: 1.4;">
        <div style="background: ${isOnline ? '#f0fdf4' : '#fff7ed'}; border: 1px solid ${isOnline ? '#bbf7d0' : '#fed7aa'}; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <strong style="color: ${isOnline ? '#166534' : '#9a3412'}; font-size: 0.95rem;">
              ${isOnline ? '🟢 En línea (Conectado)' : '🔌 Modo Fuera de Línea (Offline)'}
            </strong>
            <span style="font-size: 0.75rem; color: #64748b;">ID: <code>${syncEngine.deviceId}</code></span>
          </div>
          <div>• <strong>${pendingCount}</strong> mutaciones locales pendientes por subir (Push).</div>
          <div>• Último Sync: <span style="font-family: monospace;">${lastSync !== '1970-01-01T00:00:00.000Z' ? new Date(lastSync).toLocaleTimeString() : 'Nunca'}</span></div>
          <div>• Servidor Remoto: <strong>Supabase Cloud</strong> (${syncEngine.getServerUrl() ? 'Servidor Local Activo' : 'Nube Principal'})</div>
        </div>

        <div style="margin-bottom: 12px;">
          <label style="font-size: 0.78rem; font-weight: 700; color: #475569; display: block; margin-bottom: 4px;">
            ⚙️ Servidor Local IP/URL (Opcional - dejar vacío para Supabase directo):
          </label>
          <input 
            type="text" 
            id="inputModalServerUrl" 
            value="${serverUrl}" 
            placeholder="ej: http://192.168.1.100:4000"
            style="width: 100%; padding: 6px 10px; font-size: 0.8rem; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box;"
          />
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
          <button type="button" id="btnModalPush" class="btn btn-primary" style="width: 100%; padding: 9px; font-weight: 700; font-size: 0.88rem; background: #0284c7; border: none; border-radius: 6px; color: white; cursor: pointer;">
            ⬆️ Subir Mis Lecturas de Campo (Push)
          </button>
          <button type="button" id="btnModalPull" class="btn" style="width: 100%; padding: 9px; font-weight: 700; font-size: 0.88rem; border: 1px solid #059669; color: #065f46; background: #ecfdf5; border-radius: 6px; cursor: pointer;">
            ⬇️ Descargar Padrón y Cambios de la Nube (Pull)
          </button>
          <button type="button" id="btnModalFullSync" class="btn btn-outline" style="width: 100%; padding: 8px; font-weight: 700; font-size: 0.82rem; border: 1px solid #64748b; color: #334155; border-radius: 6px; background: white; cursor: pointer;">
            🔄 Sincronización Completa Bidireccional
          </button>
          <button type="button" id="btnExportLecturasCSV" class="btn btn-outline" style="width: 100%; padding: 8px; font-weight: 700; font-size: 0.82rem; border: 1px solid #cbd5e1; color: #64748b; border-radius: 6px; background: #f8fafc; cursor: pointer;">
            📤 Exportar Reporte de Lecturas (CSV)
          </button>
        </div>
      </div>
    `,
    showConfirmButton: false,
    showCloseButton: true,
    didOpen: () => {
      const inputUrl = document.getElementById('inputModalServerUrl');
      inputUrl?.addEventListener('change', () => {
        syncEngine.setServerUrl(inputUrl.value.trim());
      });

      document.getElementById('btnModalPush')?.addEventListener('click', async () => {
        await executePush();
      });

      document.getElementById('btnModalPull')?.addEventListener('click', async () => {
        await executePull();
      });

      document.getElementById('btnModalFullSync')?.addEventListener('click', async () => {
        await executeFullSync();
      });

      document.getElementById('btnExportLecturasCSV')?.addEventListener('click', async () => {
        const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';
        exportLecturasCSV(periodo);
      });
    }
  });
}

async function exportLecturasCSV(periodo) {
  const lecturas = await getLecturasPeriodo(periodo);
  if (lecturas.length === 0) {
    Swal.fire({ icon: 'info', title: 'Sin Lecturas', text: 'No hay lecturas registradas para exportar.' });
    return;
  }

  let csvContent = 'CodigoSocio,Nombre,Cedula,Sector,Medidor,LecturaAnterior,LecturaActual,ConsumoM3,ExcedenteM3,Observaciones,Fecha\n';

  cachedSocios.forEach((s) => {
    const l = lecturas.find((item) => item.clienteId === s.id || item.idSocio === s.id);
    const lant = l ? l.lecturaAnterior : 0;
    const lact = l && l.lecturaActual !== undefined ? l.lecturaActual : '';
    const cons = l && l.consumoM3 !== undefined ? l.consumoM3 : '';
    const exc = l && l.excedenteM3 !== undefined ? l.excedenteM3 : '';
    const obs = (l?.observaciones || '').replace(/,/g, ';');
    const fecha = l?.updatedAt || '';

    csvContent += `"${s.codigoSocio}","${s.nombreCompleto}","${s.cedulaRuc}","${s.nombreSector}","${s.medidorNumero}",${lant},${lact},${cons},${exc},"${obs}","${fecha}"\n`;
  });

  const filename = `SIGA_Lecturas_${periodo}.csv`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();

  Swal.fire({
    icon: 'success',
    title: 'Archivo Generado',
    text: `Se descargó el archivo ${filename} correctamente.`
  });
}

// Listeners de filtros y acciones
document.getElementById('selectPeriodo')?.addEventListener('change', async () => {
  const periodo = document.getElementById('selectPeriodo').value;
  cachedLecturas = await getLecturasPeriodo(periodo);
  renderTableAndMetrics();
});

document.getElementById('selectSectorRuta')?.addEventListener('change', renderTableAndMetrics);
document.getElementById('searchSocioLectura')?.addEventListener('input', renderTableAndMetrics);
document.getElementById('btnSyncModal')?.addEventListener('click', openSyncManagerModal);
document.getElementById('btnPullLector')?.addEventListener('click', executePull);
document.getElementById('btnPushLector')?.addEventListener('click', executePush);

// Inicializar PWA
initIndexedDB().then(renderLecturasUI);
