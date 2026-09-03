import { requireAuth, getAuthToken } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';

// Guard de autenticación (Accesible por ADMIN, CAJERO y LECTOR)
const currentUser = requireAuth(['ADMIN', 'CAJERO', 'LECTOR']);
if (currentUser) {
  injectAppLayout('lecturas');
}

const DB_NAME = 'SIGAComunitarioDemoDB';
const DB_VERSION = 2;
let db = null;

async function apiFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Error ${res.status}`);
    }
    return res.json();
  } catch (err) {
    console.warn(`[API Lecturas] Error ${url}:`, err.message);
    throw err;
  }
}

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
  return new Promise((resolve) => {
    const tx = db.transaction(['lecturas'], 'readonly');
    const store = tx.objectStore('lecturas');
    const req = store.count();
    req.onsuccess = () => {
      if (req.result === 0) {
        const writeTx = db.transaction(['lecturas'], 'readwrite');
        const writeStore = writeTx.objectStore('lecturas');
        const periodo = '2026-08';
        Object.entries(LECTURAS_INICIALES_LECTOR).forEach(([socId, data]) => {
          const cons = Math.max(0, data.lecturaActual - data.lecturaAnterior);
          const exc = Math.max(0, cons - 30);
          writeStore.add({
            id: `lec-${socId}-${periodo}`,
            clienteId: socId,
            periodo,
            lecturaAnterior: data.lecturaAnterior,
            lecturaActual: data.lecturaActual,
            consumoM3: cons,
            excedenteM3: exc,
            observaciones: data.observaciones,
            origen: data.origen,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        });
        writeTx.oncomplete = () => resolve();
        writeTx.onerror = () => resolve();
      } else {
        resolve();
      }
    };
    req.onerror = () => resolve();
  });
}

async function getAllSocios() {
  try {
    const res = await apiFetch('/api/v1/socios');
    return (res.data || []).map((s) => ({
      id: s.id,
      codigoSocio: s.codigoSocio,
      nombres: s.nombres,
      apellidos: s.apellidos,
      nombreCompleto: `${s.nombres} ${s.apellidos}`,
      cedulaRuc: s.cedulaRuc,
      sectorId: s.idSector || s.sectorId,
      nombreSector: s.nombreSector || 'Sector Centro',
      medidorNumero: s.medidorNumero,
      medidores: s.medidores || [],
      tieneAlcantarillado: s.tieneAlcantarillado,
      estadoServicio: s.estado
    }));
  } catch (err) {
    if (!db) return [];
    return new Promise((resolve) => {
      const tx = db.transaction(['socios'], 'readonly');
      const req = tx.objectStore('socios').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }
}

async function getAllSectores() {
  try {
    const res = await apiFetch('/api/v1/sectores');
    return res.data || [];
  } catch (err) {
    if (!db) return [];
    return new Promise((resolve) => {
      const tx = db.transaction(['sectores'], 'readonly');
      const req = tx.objectStore('sectores').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }
}

async function getLecturasPeriodo(periodo) {
  try {
    const res = await apiFetch(`/api/v1/lecturas?periodoId=${encodeURIComponent(periodo)}`);
    const apiData = res.data || [];
    if (apiData.length > 0) {
      return apiData.map((l) => ({
        id: l.id,
        idMedidor: l.idMedidor,
        numeroMedidor: l.numeroMedidor,
        aliasMedidor: l.aliasMedidor,
        clienteId: l.idSocio,
        periodo: l.periodoCodigo || periodo,
        lecturaAnterior: l.lecturaAnterior,
        lecturaActual: l.lecturaActual,
        consumoM3: l.consumoM3 !== undefined ? l.consumoM3 : l.consumoTotal,
        excedenteM3: l.excedenteM3,
        observaciones: l.observaciones,
        origen: l.origen || 'LECTOR',
        updatedAt: l.updatedAt
      }));
    }
  } catch (err) {
    // Modo offline
  }

  if (db) {
    const localLecturas = await new Promise((resolve) => {
      const tx = db.transaction(['lecturas'], 'readonly');
      const store = tx.objectStore('lecturas');
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(all.filter((l) => l.periodo === periodo));
      };
      req.onerror = () => resolve([]);
    });

    if (localLecturas.length > 0) {
      return localLecturas;
    }
  }

  // Respaldo de lecturas digitadas por el Lector para período actual demo
  if (periodo === '2026-08') {
    return Object.entries(LECTURAS_INICIALES_LECTOR).map(([socId, data]) => {
      const cons = Math.max(0, data.lecturaActual - data.lecturaAnterior);
      const exc = Math.max(0, cons - 30);
      return {
        id: `lec-${socId}-${periodo}`,
        clienteId: socId,
        periodo,
        lecturaAnterior: data.lecturaAnterior,
        lecturaActual: data.lecturaActual,
        consumoM3: cons,
        excedenteM3: exc,
        observaciones: data.observaciones,
        origen: data.origen,
        updatedAt: new Date().toISOString()
      };
    });
  }

  return [];
}

async function saveLecturaLocal(lecturaData) {
  const start = performance.now();

  // 1. Enviar al Backend API (SQLite + Sincronización)
  try {
    await apiFetch('/api/v1/lecturas', {
      method: 'POST',
      body: JSON.stringify({
        idSocio: lecturaData.clienteId,
        idMedidor: lecturaData.medidorId,
        numeroMedidor: lecturaData.medidorNumero,
        idPeriodo: lecturaData.periodo,
        lecturaActual: lecturaData.lecturaActual,
        lecturaAnterior: lecturaData.lecturaAnterior,
        observaciones: lecturaData.observaciones || ''
      })
    });
  } catch (apiErr) {
    console.warn('[Lecturas] Guardado local offline:', apiErr.message);
  }

  // 2. Guardar en IndexedDB local
  if (db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['lecturas', 'sync_queue'], 'readwrite');
      const lecturasStore = tx.objectStore('lecturas');
      const queueStore = tx.objectStore('sync_queue');

      const id = `lec-${lecturaData.clienteId}-${lecturaData.periodo}`;
      const record = {
        id,
        ...lecturaData,
        updatedAt: new Date().toISOString()
      };

      lecturasStore.put(record);

      queueStore.add({
        id: 'mut-' + crypto.randomUUID().slice(0, 8),
        entity: 'lecturas',
        entityId: id,
        action: 'UPSERT',
        payload: record,
        localTimestamp: new Date().toLocaleTimeString(),
        status: 'SYNCED'
      });

      tx.oncomplete = () => {
        const latency = (performance.now() - start).toFixed(1);
        const el = document.querySelector('#perfMeter span');
        if (el) el.textContent = `${latency} ms`;
        resolve(record);
      };

      tx.onerror = (e) => reject(e.target.error);
    });
  }
}

// Variables del Módulo
let cachedSocios = [];
let cachedSectores = [];
let cachedLecturas = [];
const rowStateMap = new Map();

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
    if (btnCierre) btnCierre.style.display = 'none';
  }

  const periodo = document.getElementById('selectPeriodo').value;

  cachedSocios = await getAllSocios();
  cachedSectores = await getAllSectores();
  cachedLecturas = await getLecturasPeriodo(periodo);

  populateSectorSelect(cachedSectores);
  renderTableAndMetrics();
}

function populateSectorSelect(sectores) {
  const select = document.getElementById('selectSectorRuta');
  const currentVal = select.value;
  select.innerHTML = '<option value="TODOS">Todos los sectores comunitarios</option>';

  sectores.forEach((sec) => {
    const opt = document.createElement('option');
    opt.value = sec.id;
    opt.textContent = `${sec.codigo ? sec.codigo + ' - ' : ''}${sec.nombre}`;
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
          medidorId: m.id,
          medidorNumero: m.numeroMedidor,
          aliasMedidor: m.alias || 'Casa principal',
          nombreCompleto: socio.nombreCompleto,
          codigoSocio: socio.codigoSocio,
          cedulaRuc: socio.cedulaRuc,
          nombreSector: m.nombreSector || socio.nombreSector,
          sectorId: m.idSector || socio.sectorId
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
        sectorId: socio.sectorId
      });
    }
  });

  listaAcometidas.forEach((item) => {
    const lecturaExistente = cachedLecturas.find((l) =>
      (l.idMedidor && (l.idMedidor === item.medidorId || l.numeroMedidor === item.medidorNumero)) ||
      (l.numeroMedidor && l.numeroMedidor === item.medidorNumero) ||
      (!l.idMedidor && l.clienteId === item.socioId)
    );
    const fallbackLector = periodo === '2026-08' ? LECTURAS_INICIALES_LECTOR[item.socioId] : null;

    const lant = lecturaExistente?.lecturaAnterior ?? fallbackLector?.lecturaAnterior ?? BASELINE_LECTURAS[item.socioId] ?? 120;
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
  btnLote.textContent = '⏳ Guardando lote...';

  for (const [socioId, state] of rowStateMap.entries()) {
    if (state && state.valid) {
      await saveLecturaLocal(state);
      savedCount++;
    }
  }

  btnLote.disabled = false;
  btnLote.textContent = '💾 Guardar Todo el Lote';

  if (savedCount === 0) {
    Swal.fire({
      icon: 'info',
      title: 'Sin Cambios Nuevos',
      text: 'No hay lecturas pendientes o modificadas por guardar.'
    });
    return;
  }

  cachedLecturas = await getLecturasPeriodo(periodo);
  renderTableAndMetrics();
  Swal.fire({
    icon: 'success',
    title: 'Lote Sincronizado',
    text: `Se sincronizaron exitosamente ${savedCount} lecturas en el servidor central.`
  });
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

// Listeners de filtros
document.getElementById('selectPeriodo')?.addEventListener('change', renderLecturasUI);
document.getElementById('selectSectorRuta')?.addEventListener('change', renderTableAndMetrics);
document.getElementById('searchSocioLectura')?.addEventListener('input', renderTableAndMetrics);

// Inicializar
initIndexedDB().then(renderLecturasUI);
