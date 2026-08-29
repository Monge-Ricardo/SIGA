import { requireAuth } from './auth.js';
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

const BASELINE_LECTURAS = {
  'soc-001': 150,
  'soc-002': 210,
  'soc-003': 95,
  'soc-004': 180
};

function initIndexedDB() {
  return new Promise((resolve, reject) => {
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

    request.onerror = (event) => {
      console.error('Error al inicializar IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

async function getAllSocios() {
  return new Promise((resolve) => {
    const tx = db.transaction(['socios'], 'readonly');
    const req = tx.objectStore('socios').getAll();
    req.onsuccess = () => resolve(req.result);
  });
}

async function getAllSectores() {
  return new Promise((resolve) => {
    const tx = db.transaction(['sectores'], 'readonly');
    const req = tx.objectStore('sectores').getAll();
    req.onsuccess = () => resolve(req.result);
  });
}

async function getLecturasPeriodo(periodo) {
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

async function saveLecturaLocal(lecturaData) {
  const start = performance.now();
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

    const mutation = {
      id: 'mut-' + crypto.randomUUID().slice(0, 8),
      entity: 'lecturas',
      entityId: id,
      action: 'UPSERT',
      payload: record,
      localTimestamp: new Date().toLocaleTimeString(),
      status: 'SYNCED'
    };
    queueStore.add(mutation);

    tx.oncomplete = () => {
      const latency = (performance.now() - start).toFixed(1);
      const el = document.querySelector('#perfMeter span');
      if (el) el.textContent = `${latency} ms`;
      resolve(record);
    };

    tx.onerror = (e) => reject(e.target.error);
  });
}

let cachedSocios = [];
let cachedSectores = [];
let cachedLecturas = [];
const rowStateMap = new Map();

async function renderLecturasUI() {
  cachedSocios = await getAllSocios();
  cachedSectores = await getAllSectores();

  populateSectoresDropdown(cachedSectores);

  const periodo = document.getElementById('selectPeriodo').value;
  cachedLecturas = await getLecturasPeriodo(periodo);

  renderTableAndMetrics();
}

function populateSectoresDropdown(sectores) {
  const select = document.getElementById('selectSectorRuta');
  if (select && select.options.length <= 1) {
    sectores.forEach((sec) => {
      const opt = document.createElement('option');
      opt.value = sec.id;
      opt.textContent = `${sec.codigo} - ${sec.nombre}`;
      select.appendChild(opt);
    });
  }
}

function renderTableAndMetrics() {
  const sectorId = document.getElementById('selectSectorRuta').value;
  const busqueda = (document.getElementById('searchSocioLectura').value || '').toLowerCase().trim();
  const periodo = document.getElementById('selectPeriodo').value;

  let sociosRuta = cachedSocios.filter((s) => {
    if (sectorId !== 'TODOS' && s.sectorId !== sectorId) return false;
    if (busqueda) {
      const match =
        s.nombreCompleto.toLowerCase().includes(busqueda) ||
        s.cedulaRuc.toLowerCase().includes(busqueda) ||
        (s.medidorNumero && s.medidorNumero.toLowerCase().includes(busqueda));
      if (!match) return false;
    }
    return true;
  });

  document.getElementById('routeTableCount').textContent = `Mostrando ${sociosRuta.length} medidores en la ruta del sector`;

  let totalTomadas = 0;
  let totalConsumoM3 = 0;
  let totalExcedenteM3 = 0;

  const tbody = document.getElementById('lecturasTableBody');
  tbody.innerHTML = '';

  if (sociosRuta.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: #64748b; padding: 2.5rem;">
          🔍 No se encontraron medidores con los filtros seleccionados.
        </td>
      </tr>
    `;
    updateMetrics(0, 0, 0, 0);
    return;
  }

  sociosRuta.forEach((socio) => {
    const existingLectura = cachedLecturas.find((l) => l.clienteId === socio.id);
    const lecturaAnterior = existingLectura?.lecturaAnterior ?? (BASELINE_LECTURAS[socio.id] || 100);
    const lecturaActual = existingLectura?.lecturaActual ?? '';
    const isTomada = existingLectura && existingLectura.lecturaActual !== undefined;

    if (isTomada) {
      totalTomadas++;
      totalConsumoM3 += (existingLectura.consumoM3 || 0);
      totalExcedenteM3 += (existingLectura.excedenteM3 || 0);
    }

    const tr = document.createElement('tr');
    tr.id = `row-${socio.id}`;

    tr.innerHTML = `
      <td>
        <div class="socio-cell-user">
          <div class="user-avatar-mini">${socio.esTerceraEdad ? '👴' : '👤'}</div>
          <div>
            <div class="user-name">${socio.nombreCompleto}</div>
            <div class="user-code">${socio.codigoSocio} • <span class="badge-code">${socio.medidorNumero || 'MED-AUTO'}</span></div>
          </div>
        </div>
      </td>
      <td><span class="sector-tag">${socio.nombreSector || socio.sectorId}</span></td>
      <td style="text-align: right; font-weight: 700; color: #475569;">
        <span class="lant-val">${lecturaAnterior}</span> m³
      </td>
      <td style="text-align: right;">
        <input
          type="number"
          class="reading-input"
          id="input-lact-${socio.id}"
          data-socio-id="${socio.id}"
          data-lant="${lecturaAnterior}"
          value="${lecturaActual}"
          placeholder="${lecturaAnterior}"
          inputmode="numeric"
        />
        <div class="reading-alert-msg" id="alert-${socio.id}" style="display: none;"></div>
      </td>
      <td style="text-align: right;" id="consumo-cell-${socio.id}">
        ${
          isTomada
            ? `<span class="consumption-pill">${existingLectura.consumoM3} m³</span>`
            : `<span style="color: #94a3b8;">-</span>`
        }
      </td>
      <td style="text-align: right;" id="excedente-cell-${socio.id}">
        ${
          isTomada
            ? existingLectura.excedenteM3 > 0
              ? `<span class="excess-pill">+${existingLectura.excedenteM3} m³ (+$${(existingLectura.excedenteM3 * 0.10).toFixed(2)})</span>`
              : `<span style="color: #64748b;">0 m³ ($0.00)</span>`
            : `<span style="color: #94a3b8;">-</span>`
        }
      </td>
      <td id="status-cell-${socio.id}">
        ${
          isTomada
            ? `<span class="status-badge status-badge-active">✅ Tomada</span>`
            : `<span class="status-badge status-badge-suspended">⏳ Pendiente</span>`
        }
      </td>
      <td style="text-align: right;">
        <button class="btn btn-sm btn-primary btn-save-row" id="btn-save-${socio.id}" data-socio-id="${socio.id}">
          💾 Guardar
        </button>
      </td>
    `;

    const inputLact = tr.querySelector(`#input-lact-${socio.id}`);
    const alertBox = tr.querySelector(`#alert-${socio.id}`);
    const consumoCell = tr.querySelector(`#consumo-cell-${socio.id}`);
    const excedenteCell = tr.querySelector(`#excedente-cell-${socio.id}`);
    const btnSave = tr.querySelector(`#btn-save-${socio.id}`);

    function validateAndCalculate(showAlert = false) {
      const valStr = inputLact.value.trim();
      if (valStr === '') {
        inputLact.classList.remove('reading-input-invalid');
        alertBox.style.display = 'none';
        consumoCell.innerHTML = '<span style="color: #94a3b8;">-</span>';
        excedenteCell.innerHTML = '<span style="color: #94a3b8;">-</span>';
        btnSave.disabled = false;
        rowStateMap.delete(socio.id);
        return;
      }

      const lactNum = parseFloat(valStr);
      if (isNaN(lactNum)) return;

      if (lactNum < lecturaAnterior) {
        inputLact.classList.add('reading-input-invalid');
        alertBox.textContent = `⚠️ La lectura actual ingresada (${lactNum} m³) no puede ser menor que la lectura anterior registrada (${lecturaAnterior} m³).`;
        alertBox.style.display = 'block';
        consumoCell.innerHTML = '<span style="color: #dc2626; font-weight: 700;">Inválido</span>';
        excedenteCell.innerHTML = '<span style="color: #dc2626;">-</span>';
        btnSave.disabled = true;
        rowStateMap.set(socio.id, { valid: false, lactNum, lecturaAnterior });

        if (showAlert) {
          Swal.fire({
            icon: 'warning',
            title: 'Lectura Inconsistente',
            text: `La lectura actual ingresada (${lactNum} m³) no puede ser menor que la lectura anterior registrada (${lecturaAnterior} m³). Verifique el número de medidor o si existió un reinicio del contador.`
          });
        }
      } else {
        inputLact.classList.remove('reading-input-invalid');
        alertBox.style.display = 'none';
        btnSave.disabled = false;

        const consumo = lactNum - lecturaAnterior;
        const excedente = Math.max(0, consumo - 30);
        const valorExcedente = Number((excedente * 0.10).toFixed(2));

        consumoCell.innerHTML = `<span class="consumption-pill">${consumo} m³</span>`;
        if (excedente > 0) {
          excedenteCell.innerHTML = `<span class="excess-pill">+${excedente} m³ (+$${valorExcedente.toFixed(2)})</span>`;
        } else {
          excedenteCell.innerHTML = `<span style="color: #64748b;">0 m³ ($0.00)</span>`;
        }

        rowStateMap.set(socio.id, {
          valid: true,
          clienteId: socio.id,
          periodo,
          lecturaAnterior,
          lecturaActual: lactNum,
          consumoM3: consumo,
          excedenteM3: excedente,
          valorExcedenteUSD: valorExcedente,
          sectorId: socio.sectorId,
          lectorResponsable: currentUser?.nombre || 'Lector',
          fechaLectura: new Date().toISOString()
        });
      }
    }

    inputLact.addEventListener('input', () => validateAndCalculate(false));

    btnSave.addEventListener('click', async () => {
      validateAndCalculate(true);
      const state = rowStateMap.get(socio.id);
      if (!state || !state.valid) {
        Swal.fire({
          icon: 'warning',
          title: 'Lectura Inválida',
          text: `La lectura actual ingresada no puede ser menor que la lectura anterior registrada (${lecturaAnterior} m³).`
        });
        return;
      }

      btnSave.disabled = true;
      btnSave.textContent = 'Guardando...';

      await saveLecturaLocal(state);

      const statusCell = tr.querySelector(`#status-cell-${socio.id}`);
      statusCell.innerHTML = `<span class="status-badge status-badge-active">✅ Tomada</span>`;
      btnSave.textContent = '✓ Guardado';
      btnSave.className = 'btn btn-sm btn-success';

      cachedLecturas = await getLecturasPeriodo(periodo);
      recalcOverallMetrics(sociosRuta);

      Swal.fire({
        icon: 'success',
        title: 'Lectura Guardada',
        text: `Se registró la lectura de ${socio.nombreCompleto} con un consumo de ${state.consumoM3} m³ (${state.excedenteM3 > 0 ? `+${state.excedenteM3} m³ excedente` : 'Consumo base'}).`
      });
    });

    tbody.appendChild(tr);
  });

  updateMetrics(sociosRuta.length, totalTomadas, totalConsumoM3, totalExcedenteM3);
}

function updateMetrics(totalMedidores, tomadas, consumo, excedente) {
  const pendientes = Math.max(0, totalMedidores - tomadas);
  const pct = totalMedidores > 0 ? ((tomadas / totalMedidores) * 100).toFixed(0) : 0;

  document.getElementById('metricTotalMedidores').textContent = totalMedidores;
  document.getElementById('metricLecturasTomadas').textContent = tomadas;
  document.getElementById('metricAvancePct').textContent = `${pct}% de la ruta completado`;
  document.getElementById('metricLecturasPendientes').textContent = pendientes;
  document.getElementById('metricConsumoTotal').textContent = `${consumo} m³`;
  document.getElementById('metricExcedenteTotal').textContent = `${excedente} m³ de excedente ($${(excedente * 0.10).toFixed(2)})`;
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

  for (const [socioId, state] of rowStateMap.entries()) {
    if (state && state.valid) {
      await saveLecturaLocal(state);
      savedCount++;
    }
  }

  if (savedCount === 0) {
    Swal.fire({
      icon: 'info',
      title: 'Sin Cambios',
      text: 'No hay lecturas nuevas modificadas para guardar.'
    });
    return;
  }

  cachedLecturas = await getLecturasPeriodo(periodo);
  renderTableAndMetrics();
  Swal.fire({
    icon: 'success',
    title: 'Lote Guardado',
    text: `Se guardaron exitosamente ${savedCount} lecturas en la base de datos local.`
  });
});

// Cierre de Ciclo Mensual
document.getElementById('btnCierreCiclo')?.addEventListener('click', async () => {
  const periodo = document.getElementById('selectPeriodo').value;

  const result = await Swal.fire({
    icon: 'question',
    title: '¿Cerrar Ciclo Mensual?',
    text: `¿Desea cerrar la facturación del período ${periodo}? Las lecturas actuales pasarán a ser las lecturas anteriores del siguiente período.`,
    showCancelButton: true,
    confirmButtonText: 'Sí, Cerrar Ciclo',
    cancelButtonText: 'Cancelar'
  });

  if (!result.isConfirmed) return;

  const lecturas = await getLecturasPeriodo(periodo);
  if (lecturas.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'Sin Lecturas',
      text: 'No existen lecturas registradas para cerrar en este período.'
    });
    return;
  }

  lecturas.forEach((l) => {
    BASELINE_LECTURAS[l.clienteId] = l.lecturaActual;
  });

  Swal.fire({
    icon: 'success',
    title: 'Ciclo Cerrado',
    text: `El ciclo ${periodo} fue cerrado exitosamente con ${lecturas.length} lecturas consolidadas.`
  });

  renderLecturasUI();
});

// Listeners de filtros
document.getElementById('selectPeriodo')?.addEventListener('change', renderLecturasUI);
document.getElementById('selectSectorRuta')?.addEventListener('change', renderTableAndMetrics);
document.getElementById('searchSocioLectura')?.addEventListener('input', renderTableAndMetrics);

// Inicializar
initIndexedDB().then(renderLecturasUI);
