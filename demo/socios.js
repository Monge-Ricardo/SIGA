import { requireAuth, getAuthToken } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';

// Guard de autenticación (ADMIN, CAJERO y LECTOR para consulta de rutas)
const currentUser = requireAuth(['ADMIN', 'CAJERO', 'LECTOR']);

if (currentUser) {
  injectAppLayout('socios');
  if (currentUser.rol === 'LECTOR') {
    const btnNew = document.getElementById('btnOpenCreateSocio');
    if (btnNew) btnNew.style.display = 'none';
  }
}

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
    console.warn(`[API Socios] Error ${url}:`, err.message);
    throw err;
  }
}

const DB_NAME = 'SIGAComunitarioDemoDB';
const DB_VERSION = 2;
let db = null;

const TARIFAS_CONFIG = {
  BASE_NORMAL: 7.00,
  BASE_TERCERA_EDAD: 5.00,
  RECARGO_ALCANTARILLADO: 1.00,
  EXCEDENTE_POR_M3: 0.10,
  LIMITE_BASE_M3: 30,
  EDAD_TERCERA_EDAD: 65
};

const SECTORES_INICIALES = [
  { id: 'sec-01', codigo: 'SEC-01', nombre: 'Sector Centro', descripcion: 'Zona urbana central' },
  { id: 'sec-02', codigo: 'SEC-02', nombre: 'Sector Loma Alta', descripcion: 'Zona alta con bombeo secundario' },
  { id: 'sec-03', codigo: 'SEC-03', nombre: 'Sector El Carmen', descripcion: 'Zona residencial' },
  { id: 'sec-04', codigo: 'SEC-04', nombre: 'Sector Río Blanco', descripcion: 'Zona baja ribereña' },
  { id: 'sec-05', codigo: 'SEC-05', nombre: 'Sector San José', descripcion: 'Zona rural extendida' }
];

const SOCIOS_INICIALES = [
  {
    id: 'soc-001',
    codigoSocio: 'SEC-01-001',
    nombres: 'José Alberto',
    apellidos: 'Luna Morales',
    nombreCompleto: 'José Alberto Luna Morales',
    cedulaRuc: '0923456781',
    fechaNacimiento: '1984-05-14', // 42 años -> Normal ($7.00)
    fechaAfiliacion: '2018-03-10',
    sectorId: 'sec-01',
    nombreSector: 'Sector Centro',
    direccion: 'Calle Principal y Av. Central #102',
    telefono: '0991234567',
    medidorNumero: 'MED-10492',
    tieneAlcantarillado: true, // +$1.00 -> Base $8.00
    estadoServicio: 'ACTIVO',
    estadoCuenta: 'EN_MORA',
    mesesAdeudados: 2,
    montoTotalAdeudado: 16.00,
    fechaDeudaAntigua: '2026-06-01',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'soc-002',
    codigoSocio: 'SEC-01-002',
    nombres: 'Rosa María',
    apellidos: 'Gómez Zambrano',
    nombreCompleto: 'Rosa María Gómez Zambrano',
    cedulaRuc: '0912345678',
    fechaNacimiento: '1954-11-20', // 71 años -> 3ra Edad ($5.00)
    fechaAfiliacion: '2015-01-15',
    sectorId: 'sec-01',
    nombreSector: 'Sector Centro',
    direccion: 'Av. Las Palmas #45',
    telefono: '0987654321',
    medidorNumero: 'MED-10493',
    tieneAlcantarillado: true, // +$1.00 -> Base $6.00
    estadoServicio: 'ACTIVO',
    estadoCuenta: 'AL_DIA',
    mesesAdeudados: 0,
    montoTotalAdeudado: 0.00,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'soc-003',
    codigoSocio: 'SEC-02-015',
    nombres: 'Carlos Manuel',
    apellidos: 'Vera Benítez',
    nombreCompleto: 'Carlos Manuel Vera Benítez',
    cedulaRuc: '1723456789',
    fechaNacimiento: '1990-08-10', // 36 años -> Normal ($7.00)
    fechaAfiliacion: '2021-06-20',
    sectorId: 'sec-02',
    nombreSector: 'Sector Loma Alta',
    direccion: 'Loma Alta s/n',
    telefono: '0978901234',
    medidorNumero: 'MED-20114',
    tieneAlcantarillado: false, // $0.00 -> Base $7.00
    estadoServicio: 'ACTIVO',
    estadoCuenta: 'AL_DIA',
    mesesAdeudados: 0,
    montoTotalAdeudado: 0.00,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'soc-004',
    codigoSocio: 'SEC-03-008',
    nombres: 'Manuel Antonio',
    apellidos: 'Mendoza Castillo',
    nombreCompleto: 'Manuel Antonio Mendoza Castillo',
    cedulaRuc: '0908765432',
    fechaNacimiento: '1950-02-18', // 76 años -> 3ra Edad ($5.00)
    fechaAfiliacion: '2012-09-05',
    sectorId: 'sec-03',
    nombreSector: 'Sector El Carmen',
    direccion: 'Barrio El Carmen, Manzana D',
    telefono: '0965432109',
    medidorNumero: 'MED-30045',
    tieneAlcantarillado: false, // $0.00 -> Base $5.00
    estadoServicio: 'SUSPENDIDO',
    estadoCuenta: 'EN_MORA',
    mesesAdeudados: 4,
    montoTotalAdeudado: 20.00,
    fechaDeudaAntigua: '2026-04-01',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      if (!dbInstance.objectStoreNames.contains('socios')) {
        const store = dbInstance.createObjectStore('socios', { keyPath: 'id' });
        store.createIndex('cedulaRuc', 'cedulaRuc', { unique: false });
        store.createIndex('sectorId', 'sectorId', { unique: false });
      }
      if (!dbInstance.objectStoreNames.contains('sectores')) {
        dbInstance.createObjectStore('sectores', { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains('lecturas')) {
        const lecturasStore = dbInstance.createObjectStore('lecturas', { keyPath: 'id' });
        lecturasStore.createIndex('periodo_sector', ['periodo', 'sectorId'], { unique: false });
      }
      if (!dbInstance.objectStoreNames.contains('sync_queue')) {
        const queueStore = dbInstance.createObjectStore('sync_queue', { keyPath: 'id' });
        queueStore.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = async (event) => {
      db = event.target.result;
      await seedDatabaseIfEmpty();
      resolve(db);
    };

    request.onerror = (event) => {
      console.error('Error al inicializar IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

async function seedDatabaseIfEmpty() {
  const sectoresCount = await countStore('sectores');
  if (sectoresCount === 0) {
    const tx = db.transaction(['sectores'], 'readwrite');
    const store = tx.objectStore('sectores');
    SECTORES_INICIALES.forEach((sec) => store.add(sec));
  }

  const sociosCount = await countStore('socios');
  if (sociosCount === 0) {
    const tx = db.transaction(['socios'], 'readwrite');
    const store = tx.objectStore('socios');
    SOCIOS_INICIALES.forEach((soc) => store.add(soc));
  }
}

function countStore(storeName) {
  return new Promise((resolve) => {
    const tx = db.transaction([storeName], 'readonly');
    const req = tx.objectStore(storeName).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(0);
  });
}

function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return 0;
  const hoy = new Date();
  const fechaNac = new Date(fechaNacimiento);
  if (isNaN(fechaNac.getTime())) return 0;

  let edad = hoy.getFullYear() - fechaNac.getFullYear();
  const mesActual = hoy.getMonth();
  const mesNac = fechaNac.getMonth();

  if (mesActual < mesNac || (mesActual === mesNac && hoy.getDate() < fechaNac.getDate())) {
    edad--;
  }
  return Math.max(0, edad);
}

function esTerceraEdad(fechaNacimiento) {
  return calcularEdad(fechaNacimiento) >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
}

function calcularTarifaBaseEstimada(es3raEdadFlag, tieneAlcantFlag) {
  const base = es3raEdadFlag ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
  const alcant = tieneAlcantFlag ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0;
  return Number((base + alcant).toFixed(2));
}

async function getAllSocios() {
  const start = performance.now();
  // Sincronizar desde Backend REST API
  try {
    const res = await apiFetch('/api/v1/socios');
    if (res.data && res.data.length > 0) {
      const tx = db.transaction(['socios'], 'readwrite');
      const store = tx.objectStore('socios');
      res.data.forEach((s) => {
        const item = {
          id: s.id,
          codigoSocio: s.codigoSocio,
          nombres: s.nombres,
          apellidos: s.apellidos,
          nombreCompleto: `${s.nombres} ${s.apellidos}`,
          cedulaRuc: s.cedulaRuc,
          fechaNacimiento: s.fechaNacimiento,
          fechaAfiliacion: s.fechaUnion || s.fechaAfiliacion || '2024-01-01',
          sectorId: s.idSector || s.sectorId,
          nombreSector: s.nombreSector || 'Sector Centro',
          direccion: s.direccion,
          telefono: s.telefono,
          medidorNumero: s.medidorNumero,
          medidores: s.medidores || [],
          tieneAlcantarillado: s.tieneAlcantarillado,
          estadoServicio: s.estado || 'ACTIVO',
          estadoCuenta: s.estadoCuenta || (s.montoTotalAdeudado > 0 ? 'EN_MORA' : 'AL_DIA'),
          mesesAdeudados: s.mesesAdeudados || 0,
          montoTotalAdeudado: s.montoTotalAdeudado || 0,
          updatedAt: s.updatedAt || new Date().toISOString()
        };
        store.put(item);
      });
    }
  } catch (apiErr) {
    // Si offline, usamos IndexedDB local
  }

  return new Promise((resolve) => {
    const tx = db.transaction(['socios'], 'readonly');
    const req = tx.objectStore('socios').getAll();
    req.onsuccess = () => {
      const list = req.result.map((s) => {
        const edad = calcularEdad(s.fechaNacimiento);
        const esSenior = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
        const tarifa = calcularTarifaBaseEstimada(esSenior, s.tieneAlcantarillado);
        return {
          ...s,
          edadCalculada: edad,
          esTerceraEdad: esSenior,
          tarifaBaseMensual: tarifa
        };
      });
      const latency = (performance.now() - start).toFixed(1);
      const el = document.querySelector('#perfMeter span');
      if (el) el.textContent = `${latency} ms`;
      resolve(list);
    };
  });
}

async function getAllSectores() {
  return new Promise((resolve) => {
    const tx = db.transaction(['sectores'], 'readonly');
    const req = tx.objectStore('sectores').getAll();
    req.onsuccess = () => resolve(req.result);
  });
}

async function saveSocioLocal(socioData, isEdit = false) {
  const start = performance.now();

  // 1. Intentar persistir en el Backend REST API
  try {
    if (isEdit && socioData.id) {
      await apiFetch(`/api/v1/socios/${socioData.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          nombres: socioData.nombres,
          apellidos: socioData.apellidos,
          cedulaRuc: socioData.cedulaRuc,
          fechaNacimiento: socioData.fechaNacimiento,
          fechaAfiliacion: socioData.fechaAfiliacion,
          idSector: socioData.sectorId,
          direccion: socioData.direccion,
          telefono: socioData.telefono,
          medidorNumero: socioData.medidorNumero,
          tieneAlcantarillado: socioData.tieneAlcantarillado,
          estado: socioData.estadoServicio
        })
      });
    } else {
      const res = await apiFetch('/api/v1/socios', {
        method: 'POST',
        body: JSON.stringify({
          nombres: socioData.nombres,
          apellidos: socioData.apellidos,
          cedulaRuc: socioData.cedulaRuc,
          fechaNacimiento: socioData.fechaNacimiento,
          fechaAfiliacion: socioData.fechaAfiliacion,
          idSector: socioData.sectorId,
          direccion: socioData.direccion,
          telefono: socioData.telefono,
          medidorNumero: socioData.medidorNumero,
          tieneAlcantarillado: socioData.tieneAlcantarillado,
          estado: socioData.estadoServicio || 'ACTIVO'
        })
      });
      if (res.data?.id) {
        socioData.id = res.data.id;
        socioData.codigoSocio = res.data.codigoSocio;
      }
    }
  } catch (apiErr) {
    console.warn('[Socios] Fallback local para guardar socio:', apiErr.message);
  }

  // 2. Persistir en IndexedDB local
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['socios', 'sync_queue'], 'readwrite');
    const sociosStore = tx.objectStore('socios');
    const queueStore = tx.objectStore('sync_queue');

    const record = {
      ...socioData,
      updatedAt: new Date().toISOString()
    };

    if (isEdit) {
      sociosStore.put(record);
    } else {
      if (!record.id) record.id = 'soc-' + crypto.randomUUID().slice(0, 8);
      record.createdAt = new Date().toISOString();
      sociosStore.add(record);
    }

    const mutation = {
      id: 'mut-' + crypto.randomUUID().slice(0, 8),
      entity: 'socios',
      entityId: record.id,
      action: isEdit ? 'UPDATE' : 'CREATE',
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

async function updateSocioServicio(id, nuevoEstado) {
  const socio = await getSocioById(id);
  if (socio) {
    socio.estadoServicio = nuevoEstado;
    await saveSocioLocal(socio, true);
  }
}

async function getSocioById(id) {
  return new Promise((resolve) => {
    const tx = db.transaction(['socios'], 'readonly');
    const req = tx.objectStore('socios').get(id);
    req.onsuccess = () => resolve(req.result);
  });
}

let cachedSectores = [];
let activeSocioDetail = null;

async function renderUI() {
  cachedSectores = await getAllSectores();
  populateSectoresDropdowns(cachedSectores);

  const socios = await getAllSocios();
  renderMetrics(socios);
  renderSociosTable(socios);
}

function populateSectoresDropdowns(sectores) {
  const filterSector = document.getElementById('filterSector');
  const selectSector = document.getElementById('selectSector');

  if (filterSector && filterSector.options.length <= 1) {
    sectores.forEach((sec) => {
      const opt = document.createElement('option');
      opt.value = sec.id;
      opt.textContent = `${sec.codigo} - ${sec.nombre}`;
      filterSector.appendChild(opt);
    });
  }

  if (selectSector && selectSector.options.length === 0) {
    sectores.forEach((sec) => {
      const opt = document.createElement('option');
      opt.value = sec.id;
      opt.textContent = `${sec.codigo} - ${sec.nombre}`;
      selectSector.appendChild(opt);
    });
  }
}

function renderMetrics(socios) {
  let activos = 0, suspendidos = 0, senior = 0, alcant = 0, mora = 0, carteraTotal = 0;

  socios.forEach((s) => {
    if (s.estadoServicio === 'ACTIVO') activos++;
    if (s.estadoServicio === 'SUSPENDIDO') suspendidos++;
    if (s.esTerceraEdad) senior++;
    if (s.tieneAlcantarillado) alcant++;
    if (s.estadoCuenta === 'EN_MORA' || s.mesesAdeudados > 0) {
      mora++;
      carteraTotal += (s.montoTotalAdeudado || 0);
    }
  });

  document.getElementById('metricTotalSocios').textContent = socios.length;
  document.getElementById('metricActivosSub').textContent = `${activos} activos | ${suspendidos} susp.`;
  document.getElementById('metricTerceraEdad').textContent = senior;
  document.getElementById('metricAlcantarillado').textContent = alcant;
  document.getElementById('metricEnMora').textContent = mora;
  document.getElementById('metricCarteraTotal').textContent = `$${carteraTotal.toFixed(2)} pendiente`;
}

function renderSociosTable(allSocios) {
  const q = (document.getElementById('filterBusqueda').value || '').toLowerCase().trim();
  const sectorId = document.getElementById('filterSector').value;
  const estadoServicio = document.getElementById('filterEstadoServicio').value;
  const condicion = document.getElementById('filterCondicion').value;
  const cuenta = document.getElementById('filterCuenta').value;

  let filtrados = allSocios.filter((s) => {
    if (q) {
      const match =
        s.nombreCompleto.toLowerCase().includes(q) ||
        s.cedulaRuc.toLowerCase().includes(q) ||
        s.codigoSocio.toLowerCase().includes(q) ||
        (s.medidorNumero && s.medidorNumero.toLowerCase().includes(q));
      if (!match) return false;
    }
    if (sectorId !== 'TODOS' && s.sectorId !== sectorId) return false;
    if (estadoServicio !== 'TODOS' && s.estadoServicio !== estadoServicio) return false;
    if (condicion === 'SENIOR' && !s.esTerceraEdad) return false;
    if (condicion === 'NORMAL' && s.esTerceraEdad) return false;
    if (cuenta === 'AL_DIA' && (s.estadoCuenta === 'EN_MORA' || s.mesesAdeudados > 0)) return false;
    if (cuenta === 'EN_MORA' && !(s.estadoCuenta === 'EN_MORA' || s.mesesAdeudados > 0)) return false;

    return true;
  });

  document.getElementById('tableCountLabel').textContent = `Mostrando ${filtrados.length} de ${allSocios.length} socios registrados`;

  const tbody = document.getElementById('sociosTableBody');
  tbody.innerHTML = '';

  if (filtrados.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: #64748b; padding: 2.5rem;">
          🔍 No se encontraron socios con los filtros aplicados.
        </td>
      </tr>
    `;
    return;
  }

  filtrados.forEach((socio) => {
    const tr = document.createElement('tr');
    const isMora = socio.estadoCuenta === 'EN_MORA' || socio.mesesAdeudados > 0;
    const statusClass =
      socio.estadoServicio === 'ACTIVO'
        ? 'status-badge-active'
        : socio.estadoServicio === 'SUSPENDIDO'
        ? 'status-badge-suspended'
        : 'status-badge-cut';

    const medidoresCount = (socio.medidores && socio.medidores.length > 0) ? socio.medidores.length : (socio.medidorNumero ? 1 : 0);
    const medidorBadge = medidoresCount > 1
      ? `<span class="badge-tag" style="background:#e0f2fe; color:#0369a1; font-weight:700;">💧 ${medidoresCount} medidores</span>`
      : `<code style="font-size:0.75rem; background:#f1f5f9; padding:2px 4px; border-radius:4px;">${socio.medidorNumero || '-'}</code>`;

    // Se mantiene ÚNICAMENTE el botón de Ver Ficha (eliminando redundancia de editar)
    tr.innerHTML = `
      <td>
        <div class="socio-cell-user">
          <div class="user-avatar-mini">${socio.esTerceraEdad ? '👴' : '👤'}</div>
          <div>
            <div class="user-name">${socio.nombreCompleto}</div>
            <div class="user-code">${socio.codigoSocio} &bull; ${medidorBadge}</div>
          </div>
        </div>
      </td>
      <td><span class="badge-code">${socio.cedulaRuc}</span></td>
      <td>
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span class="age-badge ${socio.esTerceraEdad ? 'badge-senior' : 'badge-normal'}">
            ${socio.esTerceraEdad ? '👴 3ra Edad ($5)' : '👤 Normal ($7)'}
          </span>
          <span style="font-size: 0.75rem; color: #64748b;">${socio.edadCalculada} años</span>
        </div>
      </td>
      <td><span class="sector-tag">${socio.nombreSector || socio.sectorId}</span></td>
      <td>${socio.tieneAlcantarillado ? '<span class="tag-yes">SÍ</span>' : '<span class="tag-no">NO</span>'}</td>
      <td>
        <strong class="text-accent">$${socio.tarifaBaseMensual.toFixed(2)}</strong><span style="font-size:0.75rem;color:#64748b;">/mes</span>
        ${
          socio.tieneAlcantarillado
            ? '<div style="font-size: 0.7rem; color: #0284c7; margin-top: 1px;">(Incluye $1.00 alcantarillado)</div>'
            : '<div style="font-size: 0.7rem; color: #64748b; margin-top: 1px;">(Solo tarifa de agua)</div>'
        }
      </td>
      <td>
        ${
          isMora
            ? `<span class="badge-mora">⚠️ ${socio.mesesAdeudados}m ($${socio.montoTotalAdeudado.toFixed(2)})</span>`
            : `<span class="badge-ok">✅ Al Día</span>`
        }
      </td>
      <td><span class="status-badge ${statusClass}">${socio.estadoServicio}</span></td>
      <td style="text-align: right;">
        <div class="action-buttons-group">
          <button class="btn-icon btn-view" title="Ver Ficha del Socio" style="width: auto; padding: 0.25rem 0.6rem; gap: 4px; font-size: 0.82rem; font-weight: 600;">
            👁️ Ver Ficha
          </button>
        </div>
      </td>
    `;

    tr.querySelector('.btn-view').addEventListener('click', () => openDetailModal(socio));

    tbody.appendChild(tr);
  });
}

// Modales
const modalForm = document.getElementById('modalSocioForm');
const modalDetail = document.getElementById('modalSocioDetail');
const inputFechaNac = document.getElementById('inputFechaNac');
const checkAlcantarillado = document.getElementById('checkAlcantarillado');
const tariffPreviewCard = document.getElementById('tariffPreviewCard');
const inputCedula = document.getElementById('inputCedula');
const cedulaValidationMsg = document.getElementById('cedulaValidationMsg');

function updateTariffPreview() {
  const fechaNac = inputFechaNac.value;
  const edad = calcularEdad(fechaNac);
  const esSenior = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
  const tieneAlcant = checkAlcantarillado.checked;
  const tarifaBase = esSenior ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
  const recargoAlcant = tieneAlcant ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0;
  const total = (tarifaBase + recargoAlcant).toFixed(2);

  tariffPreviewCard.innerHTML = `
    <div class="tariff-preview-header">
      <div class="age-badge ${esSenior ? 'badge-senior' : 'badge-normal'}">
        ${esSenior ? '👴 TERCERA EDAD (Subsidio Aplicado)' : '👤 CATEGORÍA NORMAL'}
        <span style="font-weight: 400; opacity: 0.9;">(${edad} años)</span>
      </div>
      <div class="tariff-total">
        <span class="total-label">Tarifa Base Fija Estimada:</span>
        <span class="total-amount">$${total} USD / mes</span>
      </div>
    </div>
    <div class="tariff-preview-details">
      <span>🔹 Cuota Base ($30 m³): <strong>$${tarifaBase.toFixed(2)}</strong></span>
      <span>🔹 Alcantarillado: <strong>${tieneAlcant ? '$' + TARIFAS_CONFIG.RECARGO_ALCANTARILLADO.toFixed(2) + ' (en valores a cobrar)' : 'No aplica ($0.00)'}</strong></span>
      <span style="color: #64748b; font-size: 0.8rem;">* Excedente >30 m³ se factura a $0.10/m³ adicional.</span>
    </div>
  `;
}

inputFechaNac.addEventListener('input', updateTariffPreview);
checkAlcantarillado.addEventListener('change', updateTariffPreview);

inputCedula.addEventListener('input', () => {
  const val = inputCedula.value.trim();
  if (val.length === 10) {
    cedulaValidationMsg.textContent = '✓ Cédula válida (10 dígitos)';
    cedulaValidationMsg.style.color = '#059669';
  } else {
    cedulaValidationMsg.textContent = `${val.length}/10 dígitos`;
    cedulaValidationMsg.style.color = '#64748b';
  }
});

function openFormModal(socio = null) {
  const isEdit = !!socio;
  document.getElementById('modalFormTitle').textContent = isEdit ? '✏️ Editar Socio / Abonado' : '➕ Registrar Nuevo Socio';
  document.getElementById('formSocioId').value = socio?.id || '';
  document.getElementById('inputCedula').value = socio?.cedulaRuc || '';
  document.getElementById('inputNombres').value = socio?.nombres || '';
  document.getElementById('inputApellidos').value = socio?.apellidos || '';
  document.getElementById('inputFechaNac').value = socio?.fechaNacimiento || '1985-01-01';
  document.getElementById('inputFechaAfil').value = socio?.fechaAfiliacion || new Date().toISOString().split('T')[0];
  document.getElementById('inputMedidor').value = socio?.medidorNumero || '';
  document.getElementById('inputTelefono').value = socio?.telefono || '';
  document.getElementById('inputDireccion').value = socio?.direccion || '';
  document.getElementById('selectSector').value = socio?.sectorId || cachedSectores[0]?.id || '';
  document.getElementById('selectEstado').value = socio?.estadoServicio || 'ACTIVO';
  document.getElementById('checkAlcantarillado').checked = socio?.tieneAlcantarillado ?? true;

  updateTariffPreview();
  modalForm.style.display = 'flex';
}

function closeFormModal() {
  modalForm.style.display = 'none';
}

function openDetailModal(socio) {
  activeSocioDetail = socio;
  document.getElementById('detailAvatar').textContent = socio.esTerceraEdad ? '👴' : '👤';
  document.getElementById('detailNombre').textContent = socio.nombreCompleto;
  document.getElementById('detailCodigo').textContent = socio.codigoSocio;
  document.getElementById('detailCedula').textContent = socio.cedulaRuc;

  const statusBadge = document.getElementById('detailStatusBadge');
  statusBadge.textContent = socio.estadoServicio;
  statusBadge.className = `status-badge ${
    socio.estadoServicio === 'ACTIVO'
      ? 'status-badge-active'
      : socio.estadoServicio === 'SUSPENDIDO'
      ? 'status-badge-suspended'
      : 'status-badge-cut'
  }`;

  document.getElementById('detailCategoriaBadge').innerHTML = `
    <span class="age-badge ${socio.esTerceraEdad ? 'badge-senior' : 'badge-normal'}">
      ${socio.esTerceraEdad ? '👴 Tercera Edad ($5.00)' : '👤 Normal ($7.00)'}
    </span>
  `;
  document.getElementById('detailEdad').innerHTML = `<strong>${socio.edadCalculada} años</strong> (${socio.fechaNacimiento})`;
  document.getElementById('detailSector').innerHTML = `<strong>${socio.nombreSector || socio.sectorId}</strong>`;
  document.getElementById('detailMedidor').innerHTML = `<span class="badge-code">${socio.medidorNumero || 'Sin medidor'}</span>`;
  document.getElementById('detailAlcantarillado').innerHTML = socio.tieneAlcantarillado ? '<span class="tag-yes">SÍ</span>' : '<span class="tag-no">NO</span>';
  document.getElementById('detailAfiliacion').textContent = socio.fechaAfiliacion || 'No registrada';
  document.getElementById('detailTelefono').textContent = socio.telefono || 'No registrado';
  document.getElementById('detailDireccion').textContent = socio.direccion || 'Sin dirección especificada';

  // Cuenta Corriente
  const isMora = socio.estadoCuenta === 'EN_MORA' || socio.mesesAdeudados > 0;
  const accountCard = document.getElementById('detailAccountCard');
  accountCard.className = `account-status-card ${isMora ? 'account-mora' : 'account-ok'}`;
  document.getElementById('detailAccountIcon').textContent = isMora ? '⚠️' : '✅';
  document.getElementById('detailAccountTitle').textContent = isMora ? 'EN MORA / ATRASADO' : 'AL DÍA CON SUS PAGOS';
  document.getElementById('detailAccountSubtitle').textContent = isMora ? `${socio.mesesAdeudados} mes(es) pendiente(s)` : 'Sin valores pendientes';

  const debtInfo = document.getElementById('detailDebtInfo');
  if (isMora) {
    debtInfo.style.display = 'block';
    document.getElementById('detailDebtAmount').textContent = `$${socio.montoTotalAdeudado.toFixed(2)} USD`;
    document.getElementById('detailDebtSince').textContent = `Desde: ${socio.fechaDeudaAntigua || 'Período anterior'}`;
  } else {
    debtInfo.style.display = 'none';
  }

  const baseMonto = socio.esTerceraEdad ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
  const alcantMonto = socio.tieneAlcantarillado ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0;
  document.getElementById('detailTarifaBaseMonto').textContent = `$${baseMonto.toFixed(2)}`;
  document.getElementById('detailTarifaAlcantMonto').textContent = alcantMonto > 0 ? `$${alcantMonto.toFixed(2)}` : '$0.00 (No aplica)';
  document.getElementById('detailTarifaTotalMonto').textContent = `$${(baseMonto + alcantMonto).toFixed(2)} USD`;

  // Cargar lista de acometidas / medidores del socio
  const containerMedidores = document.getElementById('detailMedidoresList');
  if (containerMedidores) {
    containerMedidores.innerHTML = '<span style="font-size: 0.8rem; color: #64748b;">Cargando acometidas...</span>';
    try {
      const res = await apiFetch(`/api/v1/socios/${socio.id}/medidores`);
      const meds = res.data || [];
      if (meds.length === 0) {
        containerMedidores.innerHTML = `
          <div style="font-size: 0.8rem; color: #0369a1; background: #fff; padding: 6px 10px; border-radius: 6px; border: 1px solid #bae6fd;">
            <strong>${socio.medidorNumero || 'MED-00000'}</strong> &bull; Casa principal
          </div>
        `;
      } else {
        containerMedidores.innerHTML = meds
          .map(
            (m) => `
          <div style="display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 6px 10px; border-radius: 6px; border: 1px solid #bae6fd; font-size: 0.8rem;">
            <div>
              <strong style="color: #0369a1;">${m.numeroMedidor}</strong> 
              <span style="background: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; margin-left: 4px; font-weight:600;">${m.alias || 'Casa'}</span>
              <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">
                📍 ${m.nombreSector || socio.nombreSector || 'Sector'} &bull; ${m.direccion || socio.direccion || 'Predio'}
              </div>
            </div>
            <div style="text-align: right;">
              <span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: ${m.tieneAlcantarillado ? '#dcfce7' : '#f1f5f9'}; color: ${m.tieneAlcantarillado ? '#166534' : '#64748b'}; font-weight: 600;">
                ${m.tieneAlcantarillado ? 'Alcant. SÍ' : 'Alcant. NO'}
              </span>
            </div>
          </div>
        `
          )
          .join('');
      }
    } catch {
      containerMedidores.innerHTML = `
        <div style="font-size: 0.8rem; color: #0369a1;">
          ${socio.medidorNumero || 'MED-00000'} (Casa principal)
        </div>
      `;
    }
  }

  modalDetail.style.display = 'flex';
}

function closeDetailModal() {
  modalDetail.style.display = 'none';
}

// Modal Agregar Medidor
const modalAddMedidor = document.getElementById('modalAddMedidor');
document.getElementById('btnOpenAddMedidor')?.addEventListener('click', () => {
  if (!activeSocioDetail) return;
  const selectSec = document.getElementById('selectAddMedidorSector');
  if (selectSec) {
    selectSec.innerHTML = cachedSectores.map((s) => `<option value="${s.id}">${s.codigo} - ${s.nombre}</option>`).join('');
    selectSec.value = activeSocioDetail.sectorId || cachedSectores[0]?.id || '';
  }
  document.getElementById('inputAddMedidorNumero').value = '';
  document.getElementById('inputAddMedidorAlias').value = 'Acometida adicional';
  document.getElementById('inputAddMedidorDireccion').value = activeSocioDetail.direccion || '';
  document.getElementById('checkAddMedidorAlcantarillado').checked = activeSocioDetail.tieneAlcantarillado;
  modalAddMedidor.style.display = 'flex';
});

document.getElementById('btnCloseAddMedidorModal')?.addEventListener('click', () => {
  modalAddMedidor.style.display = 'none';
});
document.getElementById('btnCancelAddMedidor')?.addEventListener('click', () => {
  modalAddMedidor.style.display = 'none';
});

document.getElementById('formAddMedidor')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeSocioDetail) return;
  const numeroMedidor = document.getElementById('inputAddMedidorNumero').value.trim();
  const alias = document.getElementById('inputAddMedidorAlias').value.trim();
  const idSector = document.getElementById('selectAddMedidorSector').value;
  const direccion = document.getElementById('inputAddMedidorDireccion').value.trim();
  const tieneAlcantarillado = document.getElementById('checkAddMedidorAlcantarillado').checked;

  try {
    await apiFetch(`/api/v1/socios/${activeSocioDetail.id}/medidores`, {
      method: 'POST',
      body: JSON.stringify({ numeroMedidor, alias, idSector, direccion, tieneAlcantarillado })
    });
    modalAddMedidor.style.display = 'none';
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'success',
        title: 'Medidor Asignado',
        text: `El medidor "${numeroMedidor}" (${alias}) fue asignado exitosamente.`,
        timer: 2000,
        showConfirmButton: false
      });
    }
    // Refrescar modal de detalle y tabla general
    await openDetailModal(activeSocioDetail);
    const socios = await getAllSocios();
    renderMetrics(socios);
    renderSociosTable(socios);
  } catch (err) {
    if (typeof Swal !== 'undefined') {
      Swal.fire('Error al asignar medidor', err.message, 'error');
    } else {
      alert(`Error al asignar medidor: ${err.message}`);
    }
  }
});

document.getElementById('btnOpenCreateSocio')?.addEventListener('click', () => openFormModal());
document.getElementById('btnCloseFormModal')?.addEventListener('click', closeFormModal);
document.getElementById('btnCancelFormModal')?.addEventListener('click', closeFormModal);
document.getElementById('btnCloseDetailModal')?.addEventListener('click', closeDetailModal);
document.getElementById('btnDetailClose')?.addEventListener('click', closeDetailModal);

document.getElementById('btnDetailEdit')?.addEventListener('click', () => {
  closeDetailModal();
  if (activeSocioDetail) openFormModal(activeSocioDetail);
});

async function handleStatusChange(status) {
  if (activeSocioDetail) {
    const confirmRes = await Swal.fire({
      icon: 'question',
      title: '¿Cambiar Estado del Servicio?',
      text: `¿Está seguro de cambiar el estado operativo de ${activeSocioDetail.nombreCompleto} a "${status}"?`,
      showCancelButton: true,
      confirmButtonText: 'Sí, Cambiar Estado',
      cancelButtonText: 'Cancelar'
    });

    if (!confirmRes.isConfirmed) return;

    await updateSocioServicio(activeSocioDetail.id, status);
    activeSocioDetail.estadoServicio = status;
    closeDetailModal();
    renderUI();

    Swal.fire({
      icon: 'success',
      title: 'Estado Actualizado',
      text: `El socio ahora se encuentra en estado "${status}".`
    });
  }
}

document.getElementById('btnDetailSetActivo')?.addEventListener('click', () => handleStatusChange('ACTIVO'));
document.getElementById('btnDetailSetSuspendido')?.addEventListener('click', () => handleStatusChange('SUSPENDIDO'));
document.getElementById('btnDetailSetCortado')?.addEventListener('click', () => handleStatusChange('CORTADO'));

// Form Submit
document.getElementById('formSocio')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('formSocioId').value;
  const isEdit = !!id;
  const cedulaRuc = document.getElementById('inputCedula').value.trim();
  const nombres = document.getElementById('inputNombres').value.trim();
  const apellidos = document.getElementById('inputApellidos').value.trim();
  const fechaNacimiento = document.getElementById('inputFechaNac').value;
  const sectorId = document.getElementById('selectSector').value;
  const sector = cachedSectores.find((s) => s.id === sectorId);
  const medidorNumero = document.getElementById('inputMedidor').value.trim();
  const telefono = document.getElementById('inputTelefono').value.trim();
  const direccion = document.getElementById('inputDireccion').value.trim();
  const fechaAfiliacion = document.getElementById('inputFechaAfil').value;
  const estadoServicio = document.getElementById('selectEstado').value;
  const tieneAlcantarillado = document.getElementById('checkAlcantarillado').checked;

  let existing = null;
  if (isEdit) {
    existing = await getSocioById(id);
  }

  const socioData = {
    id: id || undefined,
    codigoSocio: existing?.codigoSocio || `${sector?.codigo || 'SEC'}-${Math.floor(100 + Math.random() * 900)}`,
    nombres,
    apellidos,
    nombreCompleto: `${nombres} ${apellidos}`,
    cedulaRuc,
    fechaNacimiento,
    fechaAfiliacion,
    sectorId,
    nombreSector: sector?.nombre,
    direccion,
    telefono,
    medidorNumero: medidorNumero || `MED-${Math.floor(10000 + Math.random() * 90000)}`,
    tieneAlcantarillado,
    estadoServicio,
    estadoCuenta: existing?.estadoCuenta || 'AL_DIA',
    mesesAdeudados: existing?.mesesAdeudados || 0,
    montoTotalAdeudado: existing?.montoTotalAdeudado || 0,
    fechaDeudaAntigua: existing?.fechaDeudaAntigua
  };

  await saveSocioLocal(socioData, isEdit);
  closeFormModal();
  renderUI();

  Swal.fire({
    icon: 'success',
    title: isEdit ? 'Socio Actualizado' : 'Socio Registrado',
    text: `Los datos de ${socioData.nombreCompleto} fueron guardados exitosamente en IndexedDB.`
  });
});

// Filtros reactivos
['filterBusqueda', 'filterSector', 'filterEstadoServicio', 'filterCondicion', 'filterCuenta'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => getAllSocios().then(renderSociosTable));
});

// Inicializar al cargar
initIndexedDB().then(renderUI);
