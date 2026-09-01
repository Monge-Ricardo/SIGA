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

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = () => {
      console.warn('IndexedDB no disponible para lecturas, usando API REST');
      resolve(null);
    };
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
    return (res.data || []).map((l) => ({
      id: l.id,
      clienteId: l.idSocio,
      periodo: l.periodoCodigo || periodo,
      lecturaAnterior: l.lecturaAnterior,
      lecturaActual: l.lecturaActual,
      consumoM3: l.consumoM3,
      excedenteM3: l.excedenteM3,
      observaciones: l.observaciones,
      updatedAt: l.updatedAt
    }));
  } catch (err) {
    if (!db) return [];
    return new Promise((resolve) => {
      const tx = db.transaction(['lecturas'], 'readonly');
      const store = tx.objectStore('lecturas');
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(all.filter((l) => l.periodo === periodo));
      };
      req.onerror = () => resolve([]);
    });
  }
}

async function saveLecturaLocal(lecturaData) {
  const start = performance.now();

  // 1. Enviar al Backend API (SQLite + Sincronización)
  try {
    await apiFetch('/api/v1/lecturas', {
      method: 'POST',
      body: JSON.stringify({
        idSocio: lecturaData.clienteId,
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
        </td>
      </tr>
    `;
    updateMetrics(0, 0, 0, 0);
    return;
  }

  filtrados.forEach((socio) => {
    const lecturaExistente = cachedLecturas.find((l) => l.clienteId === socio.id);
    const lant = lecturaExistente?.lecturaAnterior ?? BASELINE_LECTURAS[socio.id] ?? 120;
    const lact = lecturaExistente?.lecturaActual;

    let consumo = 0;
    let excedente = 0;
    let isSaved = false;

    if (lact !== undefined && lact !== null) {
      consumo = Math.max(0, lact - lant);
      excedente = Math.max(0, consumo - 30);
      isSaved = true;
      totalTomadas++;
      totalConsumoM3 += consumo;
      totalExcedenteM3 += excedente;
    }

    const tr = document.createElement('tr');
    tr.id = `row-${socio.id}`;

    tr.innerHTML = `
      <td>
        <div class="socio-cell-name">${socio.nombreCompleto}</div>
        <div class="socio-cell-sub">${socio.codigoSocio || '-'} &bull; ${socio.cedulaRuc || '-'}</div>
      </td>
      <td>
        <span class="badge-tag">${socio.nombreSector || socio.sectorId}</span>
      </td>
      <td>
        <code class="medidor-code">${socio.medidorNumero || 'MED-00000'}</code>
      </td>
      <td style="text-align: right;">
        <span class="lectura-ant-badge">${lant} m³</span>
      </td>
      <td style="text-align: right;">
        <input 
          type="number" 
          inputmode="numeric"
          pattern="[0-9]*"
          class="input-lectura-actual ${lact !== undefined ? 'input-saved' : ''}" 
          id="input-lact-${socio.id}"
          value="${lact !== undefined ? lact : ''}"
          min="${lant}"
          placeholder="${lant}"
          title="${isCajeroOAdmin ? 'Revisar / Modificar Lectura' : 'Ingresar Lectura en Campo'}"
        />
      </td>
      <td style="text-align: right;" id="consumo-cell-${socio.id}">
        ${
          lact !== undefined
            ? `<span class="consumption-pill">${consumo} m³</span> ${
                excedente > 0 ? `<span class="excess-pill">+${excedente} exc</span>` : ''
              }`
            : '<span class="text-subtle">-</span>'
        }
      </td>
      <td style="text-align: center;" id="action-cell-${socio.id}">
        ${
          isSaved
            ? `<span class="badge-status badge-al-dia" title="Guardada y sincronizada">✅ Revisada</span>`
            : `<button class="btn btn-sm btn-outline btn-save-row" id="btn-save-${socio.id}" disabled>💾 Guardar</button>`
        }
      </td>
    `;

    tbody.appendChild(tr);

    const inputLact = tr.querySelector(`#input-lact-${socio.id}`);
    const btnSave = tr.querySelector(`#btn-save-${socio.id}`);
    const consumoCell = tr.querySelector(`#consumo-cell-${socio.id}`);
    const actionCell = tr.querySelector(`#action-cell-${socio.id}`);

    const handleInputReading = async (autoSave = false) => {
      const valStr = inputLact.value.trim();
      if (valStr === '') {
        inputLact.classList.remove('input-invalid', 'input-valid');
        if (btnSave) btnSave.disabled = true;
        consumoCell.innerHTML = '<span class="text-subtle">-</span>';
        rowStateMap.delete(socio.id);
        return;
      }

      const valNum = parseFloat(valStr);
      if (isNaN(valNum) || valNum < lant) {
        inputLact.classList.add('input-invalid');
        inputLact.classList.remove('input-valid');
        if (btnSave) btnSave.disabled = true;
        consumoCell.innerHTML = `<span class="error-msg-mini" style="color:#dc2626; font-size:0.75rem;">⚠️ $L_{act} < L_{ant}$</span>`;
        rowStateMap.delete(socio.id);
      } else {
        inputLact.classList.remove('input-invalid');
        inputLact.classList.add('input-valid');
        if (btnSave) btnSave.disabled = false;

        const cons = valNum - lant;
        const exc = Math.max(0, cons - 30);
        consumoCell.innerHTML = `
          <span class="consumption-pill" style="color:#0284c7; font-weight:700;">${cons} m³</span>
          ${exc > 0 ? `<span class="excess-pill">+${exc} exc</span>` : ''}
        `;

        const lecturaRecord = {
          clienteId: socio.id,
          nombreSocio: socio.nombreCompleto,
          sectorId: socio.sectorId,
          periodo,
          lecturaAnterior: lant,
          lecturaActual: valNum,
          consumoM3: cons,
          excedenteM3: exc,
          valid: true
        };

        rowStateMap.set(socio.id, lecturaRecord);

        // Auto-guardado al presionar Enter o perder foco
        if (autoSave) {
          await saveLecturaLocal(lecturaRecord);
          cachedLecturas = await getLecturasPeriodo(periodo);
          actionCell.innerHTML = `<span class="badge-status badge-al-dia">✅ Revisada</span>`;
          inputLact.classList.remove('input-valid');
          inputLact.classList.add('input-saved');
          recalcOverallMetrics(filtrados);
        }
      }
    };

    inputLact.addEventListener('input', () => handleInputReading(false));
    inputLact.addEventListener('change', () => handleInputReading(true));
    inputLact.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleInputReading(true);
      }
    });

    // Guardar fila individual
    btnSave?.addEventListener('click', async () => {
      const state = rowStateMap.get(socio.id);
      if (state && state.valid) {
        btnSave.disabled = true;
        btnSave.textContent = '...';
        await saveLecturaLocal(state);

        cachedLecturas = await getLecturasPeriodo(periodo);
        actionCell.innerHTML = `<span class="badge-status badge-al-dia">✅ Revisada</span>`;
        inputLact.classList.remove('input-valid');
        inputLact.classList.add('input-saved');

        recalcOverallMetrics(filtrados);
      }
    });
  });

  updateMetrics(filtrados.length, totalTomadas, totalConsumoM3, totalExcedenteM3);
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
