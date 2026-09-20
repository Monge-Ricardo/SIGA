import { requireAuth, apiFetch, normalizeSearchText, matchesSearchTokens } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';
import { syncEngine } from './sync-engine.js';

// Guard de autenticación (Exclusivo ADMIN y CAJERO)
const currentUser = requireAuth(['ADMIN', 'CAJERO']);

if (currentUser) {
  injectAppLayout('socios');
}

let db = null;
const isWebView = typeof window !== 'undefined' && (
  window.location.origin.includes('appassets.androidplatform.net') || 
  window.location.protocol === 'file:'
);

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

// Auto-limpieza de bases de datos locales obsoletas y datos de prueba
if (typeof window !== 'undefined' && window.indexedDB) {
  if (!isWebView) {
    try {
      window.indexedDB.deleteDatabase('app_agua_db');
      window.indexedDB.deleteDatabase('siga_comunitario_db');
      window.indexedDB.deleteDatabase('sigalector_db');
    } catch (e) {
      console.warn('[Storage] Purge error:', e);
    }
  }
  try {
    const purgeReq = window.indexedDB.open('SIGAComunitarioDemoDB');
    purgeReq.onsuccess = (ev) => {
      const idb = ev.target.result;
      if (idb.objectStoreNames.contains('socios')) {
        const tx = idb.transaction(['socios'], 'readwrite');
        const st = tx.objectStore('socios');
        st.delete('25762ce9-b9c6-44cf-8482-46001602c746');
      }
      if (idb.objectStoreNames.contains('medidores')) {
        const tx = idb.transaction(['medidores'], 'readwrite');
        const st = tx.objectStore('medidores');
        const getMeds = st.getAll();
        getMeds.onsuccess = () => {
          (getMeds.result || []).forEach((m) => {
            if (m.idSocio === '25762ce9-b9c6-44cf-8482-46001602c746' || (m.numeroMedidor && String(m.numeroMedidor).includes('TEST-ALC'))) {
              st.delete(m.id);
            }
          });
        };
      }
    };
  } catch (_e) {}
}

if (typeof localStorage !== 'undefined') {
  try {
    const last = localStorage.getItem('siga_last_socio_update');
    if (last && (last.includes('25762ce9-b9c6-44cf-8482-46001602c746') || last.includes('SOC-8301'))) {
      localStorage.removeItem('siga_last_socio_update');
    }
  } catch (_e) {}
}

async function initIndexedDB() {
  if (isWebView) {
    db = await syncEngine.getDb();
    return db;
  }
  return null;
}

function countStore(storeName) {
  if (!db) return Promise.resolve(0);
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
    if (res.data && Array.isArray(res.data) && res.data.length > 0) {
      const list = res.data.map((s) => {
        const edad = calcularEdad(s.fechaNacimiento || s.fecha_nacimiento);
        const esSenior = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
        const tieneAlcant = Boolean(
          s.tieneAlcantarillado || (s.medidores && s.medidores.some((m) => m.tieneAlcantarillado)) || s.tiene_alcantarillado
        );
        const tarifa = calcularTarifaBaseEstimada(esSenior, tieneAlcant);
        const nombreCompleto = s.nombreCompleto || `${s.apellidos || ''} ${s.nombres || ''}`.trim() || `${s.nombres || ''} ${s.apellidos || ''}`.trim();
        return {
          id: s.id,
          codigoSocio: s.codigoSocio || s.codigo_socio,
          nombres: s.nombres,
          apellidos: s.apellidos,
          nombreCompleto,
          cedulaRuc: s.cedulaRuc || s.cedula_ruc,
          fechaNacimiento: s.fechaNacimiento || s.fecha_nacimiento,
          fechaAfiliacion: s.fechaUnion || s.fechaAfiliacion || s.fecha_union || '2024-01-01',
          sectorId: s.idSector || s.sectorId || s.id_sector,
          nombreSector: s.nombreSector || s.nombre_sector || 'Sector Centro',
          direccion: s.direccion,
          telefono: s.telefono,
          medidorNumero: s.medidorNumero || s.medidor_numero,
          medidores: s.medidores || [],
          tieneAlcantarillado: tieneAlcant,
          estadoServicio: s.estadoServicio || s.estado || 'ACTIVO',
          estadoCuenta: s.estadoCuenta || (s.montoTotalAdeudado > 0 ? 'EN_MORA' : 'AL_DIA'),
          mesesAdeudados: Number(s.mesesAdeudados || 0),
          montoTotalAdeudado: Number(s.montoTotalAdeudado || 0),
          edadCalculada: edad,
          esTerceraEdad: esSenior,
          tarifaBaseMensual: tarifa,
          updatedAt: s.updatedAt || s.updated_at || new Date().toISOString()
        };
      });

      if (isWebView && db) {
        try {
          const tx = db.transaction(['socios'], 'readwrite');
          const store = tx.objectStore('socios');
          list.forEach((item) => store.put(item));
        } catch (_txErr) {}
      }

      const latency = (performance.now() - start).toFixed(1);
      const el = document.querySelector('#perfMeter span');
      if (el) el.textContent = `${latency} ms`;
      return list;
    }
  } catch (apiErr) {
    console.error('[Socios] Error al consultar API de socios:', apiErr);
  }

  if (isWebView && db) {
    return new Promise((resolve) => {
      const tx = db.transaction(['socios'], 'readonly');
      const req = tx.objectStore('socios').getAll();
      req.onsuccess = () => {
        const raw = req.result || [];
        const list = raw.map((s) => {
          const edad = calcularEdad(s.fechaNacimiento);
          const esSenior = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
          const tieneAlcant = Boolean(
            s.tieneAlcantarillado || (s.medidores && s.medidores.some((m) => m.tieneAlcantarillado)) || s.tiene_alcantarillado
          );
          const tarifa = calcularTarifaBaseEstimada(esSenior, tieneAlcant);
          const nombreCompleto = s.nombreCompleto || `${s.apellidos || ''} ${s.nombres || ''}`.trim() || `${s.nombres || ''} ${s.apellidos || ''}`.trim();
          return {
            ...s,
            tieneAlcantarillado: tieneAlcant,
            nombreCompleto,
            edadCalculada: edad,
            esTerceraEdad: esSenior,
            tarifaBaseMensual: tarifa
          };
        });
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  }

  return [];
}

async function getAllSectores() {
  try {
    const res = await apiFetch('/api/v1/sectores');
    if (res.data && res.data.length > 0) {
      if (isWebView && db) {
        try {
          const tx = db.transaction(['sectores'], 'readwrite');
          const store = tx.objectStore('sectores');
          res.data.forEach((sec) => {
            store.put({
              id: sec.id,
              codigo: sec.codigoSector || sec.codigo,
              nombre: sec.nombreSector || sec.nombre,
              descripcion: sec.descripcion || ''
            });
          });
        } catch (_e) {}
      }
      return res.data.map((sec) => ({
        id: sec.id,
        codigo: sec.codigoSector || sec.codigo,
        nombre: sec.nombreSector || sec.nombre,
        descripcion: sec.descripcion || ''
      }));
    }
  } catch (err) {
    console.warn('[Socios] Fallback a sectores de IndexedDB:', err);
  }

  if (!db) db = await syncEngine.getDb();
  if (db) {
    return new Promise((resolve) => {
      const tx = db.transaction(['sectores'], 'readonly');
      const req = tx.objectStore('sectores').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }
  return [];
}

async function saveSocioLocal(socioData, isEdit = false) {
  const start = performance.now();
  let serverResult = null;
  // 1. Persistir directamente en el Backend REST API (Supabase Cloud en tiempo real)
  if (isEdit && socioData.id) {
    const res = await apiFetch(`/api/v1/socios/${socioData.id}`, {
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
        lecturaInicial: socioData.lecturaInicial,
        tieneAlcantarillado: socioData.tieneAlcantarillado,
        estado: socioData.estadoServicio,
        medidores: socioData.medidores
      })
    });
    serverResult = res.data;
    if (res.data) {
      socioData = {
        ...socioData,
        ...res.data,
        tieneAlcantarillado: res.data.tieneAlcantarillado !== undefined ? res.data.tieneAlcantarillado : socioData.tieneAlcantarillado,
        medidores: (res.data.medidores && res.data.medidores.length > 0) ? res.data.medidores : socioData.medidores
      };
    }
  } else {
    const res = await apiFetch('/api/v1/socios/inscribir', {
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
        lecturaInicial: socioData.lecturaInicial,
        tieneAlcantarillado: socioData.tieneAlcantarillado,
        estado: socioData.estadoServicio || 'ACTIVO',
        costoAcometida: socioData.costoAcometida || 260.00,
        costoMedidor: socioData.costoMedidor || 35.00,
        costoInstalacion: socioData.costoInstalacion || 40.00,
        metodoPago: socioData.metodoPago || 'EFECTIVO',
        medidores: socioData.medidores
      })
    });
    serverResult = res.data;
    if (res.data?.socio?.id) {
      socioData.id = res.data.socio.id;
      socioData.codigoSocio = res.data.socio.codigoSocio;
      socioData.nombreSector = res.data.socio.nombreSector || socioData.nombreSector;
      socioData.tieneAlcantarillado = res.data.socio.tieneAlcantarillado !== undefined ? res.data.socio.tieneAlcantarillado : socioData.tieneAlcantarillado;
      if (res.data.socio.medidores) socioData.medidores = res.data.socio.medidores;
    } else if (res.data?.id) {
      socioData.id = res.data.id;
      socioData.codigoSocio = res.data.codigoSocio;
      socioData.nombreSector = res.data.nombreSector || socioData.nombreSector;
      socioData.tieneAlcantarillado = res.data.tieneAlcantarillado !== undefined ? res.data.tieneAlcantarillado : socioData.tieneAlcantarillado;
      if (res.data.medidores) socioData.medidores = res.data.medidores;
    }
  }

  // 2. Persistir en IndexedDB local solo si está en la app móvil de lectores en campo
  if (isWebView) {
    if (!db) db = await syncEngine.getDb();
    if (db) {
      const record = {
        ...socioData,
        updatedAt: new Date().toISOString()
      };

      if (!record.id) record.id = 'soc-' + crypto.randomUUID().slice(0, 8);
      if (!isEdit) record.createdAt = new Date().toISOString();

      const tx = db.transaction(['socios'], 'readwrite');
      tx.objectStore('socios').put(record);
      await new Promise((resolve) => {
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });

      await syncEngine.enqueueMutation('socios', record.id, isEdit ? 'UPDATE' : 'CREATE', record);
      syncEngine.pushPending().catch(() => {});
    }
  }

  notifySociosUpdated(socioData.id, socioData);

  const latency = (performance.now() - start).toFixed(1);
  const el = document.querySelector('#perfMeter span');
  if (el) el.textContent = `${latency} ms`;

  return { socio: socioData, ...serverResult };
}

function notifySociosUpdated(socioId = null, record = null) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('siga_sync_channel');
      bc.postMessage({ type: 'SOCIO_UPDATED', id: socioId, socio: record, timestamp: Date.now() });
      bc.close();
    }
  } catch (e) {}
  try {
    localStorage.setItem('siga_last_socio_update', JSON.stringify({ id: socioId, socio: record, timestamp: Date.now() }));
  } catch (e) {}
}

if (typeof BroadcastChannel !== 'undefined') {
  try {
    const rxBc = new BroadcastChannel('siga_sync_channel');
    rxBc.onmessage = (ev) => {
      if (ev.data?.type === 'SOCIO_UPDATED') {
        renderUI().catch(() => {});
      }
    };
  } catch (e) {}
}

window.addEventListener('storage', (e) => {
  if (e.key === 'siga_last_socio_update') {
    renderUI().catch(() => {});
  }
});

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

  if (filterSector) {
    filterSector.innerHTML = '<option value="TODOS">Todos los sectores comunitarios</option>';
    sectores.forEach((sec) => {
      const opt = document.createElement('option');
      opt.value = sec.id;
      opt.textContent = `${sec.codigo || sec.codigoSector || ''} - ${sec.nombre || sec.nombreSector || ''}`;
      filterSector.appendChild(opt);
    });
  }

  if (selectSector) {
    selectSector.innerHTML = '';
    sectores.forEach((sec) => {
      const opt = document.createElement('option');
      opt.value = sec.id;
      opt.textContent = `${sec.codigo || sec.codigoSector || ''} - ${sec.nombre || sec.nombreSector || ''}`;
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
  const q = document.getElementById('filterBusqueda')?.value || '';
  const sectorId = document.getElementById('filterSector').value;
  const estadoServicio = document.getElementById('filterEstadoServicio').value;
  const condicion = document.getElementById('filterCondicion').value;
  const cuenta = document.getElementById('filterCuenta').value;

  let filtrados = allSocios.filter((s) => {
    if (q.trim()) {
      const composite = `${s.nombreCompleto || ''} ${s.cedulaRuc || ''} ${s.codigoSocio || ''} ${s.medidorNumero || ''} ${s.nombreSector || ''}`;
      if (!matchesSearchTokens(composite, q)) return false;
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

    const isAdmin = currentUser?.rol === 'ADMIN';

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

let activeEditingSocio = null;

function updateTariffPreview() {
  const fechaNac = inputFechaNac.value;
  const edad = calcularEdad(fechaNac);
  const esSenior = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;

  // Calcular cantidad de medidores con alcantarillado activo
  const cards = document.querySelectorAll('#formMedidoresCardsContainer .form-medidor-card');
  let cantAlcant = 0;
  let totalMeds = cards.length;

  if (cards.length > 0) {
    cards.forEach((c) => {
      const isAlcant = c.querySelector('.card-med-alcantarillado')?.checked;
      const estado = c.querySelector('.card-med-estado')?.value || 'ACTIVO';
      if (isAlcant && estado !== 'CORTADO') cantAlcant++;
    });
  } else {
    cantAlcant = checkAlcantarillado.checked ? 1 : 0;
    totalMeds = 1;
  }

  const tieneAlcant = cantAlcant > 0;
  checkAlcantarillado.checked = tieneAlcant;

  const tarifaBase = esSenior ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
  const recargoAlcant = cantAlcant * TARIFAS_CONFIG.RECARGO_ALCANTARILLADO;
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
      <span>🔹 Alcantarillado: <strong>${
        cantAlcant > 0
          ? `$${recargoAlcant.toFixed(2)} (${cantAlcant} de ${totalMeds} medidor${totalMeds > 1 ? 'es' : ''} con red)`
          : 'No aplica ($0.00)'
      }</strong></span>
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

function createMedidorCardElement(m, index, total) {
  const isPrincipal = index === 0;
  const card = document.createElement('div');
  card.className = 'form-medidor-card';
  card.dataset.medidorId = m.id || `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  card.style.background = '#ffffff';
  card.style.border = `1.5px solid ${isPrincipal ? '#0284c7' : '#cbd5e1'}`;
  card.style.borderRadius = '8px';
  card.style.padding = '12px';
  card.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
  card.style.position = 'relative';

  const estado = m.estado || 'ACTIVO';
  const estadoBadgeBg = estado === 'ACTIVO' ? '#dcfce7' : estado === 'SUSPENDIDO' ? '#fef3c7' : '#fee2e2';
  const estadoBadgeColor = estado === 'ACTIVO' ? '#166534' : estado === 'SUSPENDIDO' ? '#92400e' : '#991b1b';

  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 6px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1rem;">💧</span>
        <strong style="color: #0f172a; font-size: 0.88rem;">Acometida #${index + 1}</strong>
        ${isPrincipal ? '<span style="background: #dbeafe; color: #1d4ed8; font-size: 0.7rem; font-weight: 700; padding: 1px 6px; border-radius: 4px;">PRINCIPAL</span>' : '<span style="background: #f1f5f9; color: #475569; font-size: 0.7rem; font-weight: 600; padding: 1px 6px; border-radius: 4px;">ADICIONAL</span>'}
        <span class="card-med-estado-badge" style="background: ${estadoBadgeBg}; color: ${estadoBadgeColor}; font-size: 0.72rem; font-weight: 700; padding: 1px 6px; border-radius: 4px;">
          ${estado}
        </span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        ${!isPrincipal ? `<button type="button" class="btn-remove-med-card" style="background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; border-radius: 4px; padding: 2px 8px; font-size: 0.72rem; cursor: pointer; font-weight: 600;">🗑️ Quitar</button>` : ''}
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
      <div class="form-group" style="margin-bottom: 0;">
        <label style="font-size: 0.78rem; font-weight: 600; color: #334155;">Número de Medidor *</label>
        <input type="text" class="card-med-numero" value="${m.numeroMedidor || m.numero_medidor || ''}" placeholder="Ej. 1208020362" required style="width: 100%; padding: 6px 10px; border: 1.5px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem; font-weight: 700; color: #0284c7;" />
      </div>

      <div class="form-group" style="margin-bottom: 0;">
        <label style="font-size: 0.78rem; font-weight: 600; color: #334155;">Lectura Inicial (m³) *</label>
        <input type="number" step="0.01" min="0" class="card-med-lectura-inicial" value="${m.lecturaInicial ?? m.lectura_inicial ?? 0}" placeholder="0.00" required style="width: 100%; padding: 6px 10px; border: 1.5px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem; font-weight: 700; color: #0284c7;" />
        <span style="font-size: 0.7rem; color: #64748b;">Lectura física al afiliar / instalar</span>
      </div>

      <div class="form-group" style="margin-bottom: 0;">
        <label style="font-size: 0.78rem; font-weight: 600; color: #334155;">Alias / Identificador</label>
        <input type="text" class="card-med-alias" value="${m.alias || (isPrincipal ? 'Casa principal' : `Acometida #${index + 1}`)}" placeholder="Ej. Casa, Local, Taller" style="width: 100%; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem;" />
      </div>

      <div class="form-group" style="margin-bottom: 0;">
        <label style="font-size: 0.78rem; font-weight: 600; color: #334155;">Estado del Medidor *</label>
        <select class="card-med-estado" style="width: 100%; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem; font-weight: 600; background: white;">
          <option value="ACTIVO" ${estado === 'ACTIVO' ? 'selected' : ''}>🟢 Activo</option>
          <option value="SUSPENDIDO" ${estado === 'SUSPENDIDO' ? 'selected' : ''}>🟡 Suspendido</option>
          <option value="CORTADO" ${estado === 'CORTADO' ? 'selected' : ''}>🔴 Cortado</option>
        </select>
      </div>

      <div class="form-group" style="margin-bottom: 0;">
        <label style="font-size: 0.78rem; font-weight: 600; color: #334155;">Dirección / Referencia Acometida</label>
        <input type="text" class="card-med-direccion" value="${m.direccion || ''}" placeholder="Ej. Predio norte / Calle principal" style="width: 100%; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem;" />
      </div>

      <div class="form-group" style="margin-bottom: 0;">
        <label style="font-size: 0.78rem; font-weight: 600; color: #334155;">Teléfono Específico (Opcional)</label>
        <input type="tel" class="card-med-telefono" value="${m.telefono || ''}" placeholder="Ej. 0991234567" style="width: 100%; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem;" />
      </div>
    </div>

    <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
      <label class="card-med-alcant-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer; background: ${Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado) ? '#dcfce7' : '#f8fafc'}; border: 1px solid ${Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado) ? '#86efac' : '#cbd5e1'}; padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; font-weight: 700; color: ${Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado) ? '#166534' : '#64748b'}; transition: all 0.2s ease;">
        <input type="checkbox" class="card-med-alcantarillado" ${Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado) ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #16a34a; cursor: pointer;" />
        <span>${Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado) ? '🌊 Posee Servicio de Alcantarillado (+$1.00)' : '🚫 Sin Servicio de Alcantarillado ($0.00)'}</span>
      </label>
      <span style="font-size: 0.72rem; color: #94a3b8;">* Tarifa individual para este medidor</span>
    </div>
  `;

  // Listeners reactivos dentro de la tarjeta
  const selectEstado = card.querySelector('.card-med-estado');
  const badgeEstado = card.querySelector('.card-med-estado-badge');
  selectEstado.addEventListener('change', () => {
    const val = selectEstado.value;
    badgeEstado.textContent = val;
    badgeEstado.style.background = val === 'ACTIVO' ? '#dcfce7' : val === 'SUSPENDIDO' ? '#fef3c7' : '#fee2e2';
    badgeEstado.style.color = val === 'ACTIVO' ? '#166534' : val === 'SUSPENDIDO' ? '#92400e' : '#991b1b';
    updateTariffPreview();
  });

  const chkAlcant = card.querySelector('.card-med-alcantarillado');
  const lblAlcant = card.querySelector('.card-med-alcant-label');
  const spanAlcant = lblAlcant.querySelector('span');
  chkAlcant.addEventListener('change', () => {
    const isChecked = chkAlcant.checked;
    spanAlcant.textContent = isChecked ? '🌊 Posee Servicio de Alcantarillado (+$1.00)' : '🚫 Sin Servicio de Alcantarillado ($0.00)';
    lblAlcant.style.background = isChecked ? '#dcfce7' : '#f8fafc';
    lblAlcant.style.borderColor = isChecked ? '#86efac' : '#cbd5e1';
    lblAlcant.style.color = isChecked ? '#166534' : '#64748b';
    updateTariffPreview();
  });

  const btnRemove = card.querySelector('.btn-remove-med-card');
  if (btnRemove) {
    btnRemove.addEventListener('click', () => {
      card.remove();
      refreshMedidoresCardsUI();
      updateTariffPreview();
    });
  }

  return card;
}

function refreshMedidoresCardsUI() {
  const container = document.getElementById('formMedidoresCardsContainer');
  if (!container) return;
  const cards = container.querySelectorAll('.form-medidor-card');
  const count = cards.length;

  const countDisplay = document.getElementById('formMedidoresCountDisplay');
  if (countDisplay) {
    countDisplay.textContent = `${count} medidor${count === 1 ? '' : 'es'}`;
  }

  const badgeHeader = document.getElementById('formModalMedidoresBadge');
  if (badgeHeader) {
    badgeHeader.textContent = `💧 ${count} medidor${count === 1 ? '' : 'es'}`;
    badgeHeader.style.background = count > 0 ? '#e0f2fe' : '#fef3c7';
    badgeHeader.style.color = count > 0 ? '#0369a1' : '#92400e';
  }
}

document.getElementById('btnAddMedidorCard')?.addEventListener('click', () => {
  const container = document.getElementById('formMedidoresCardsContainer');
  if (!container) return;
  const curCards = container.querySelectorAll('.form-medidor-card');
  const newIdx = curCards.length;
  const defaultDir = document.getElementById('inputDireccion')?.value.trim() || '';
  const defaultTel = document.getElementById('inputTelefono')?.value.trim() || '';

  const newCard = createMedidorCardElement(
    {
      id: `temp-${Date.now()}`,
      numeroMedidor: '',
      alias: `Acometida #${newIdx + 1}`,
      estado: 'ACTIVO',
      direccion: defaultDir,
      telefono: defaultTel,
      tieneAlcantarillado: true,
      lecturaInicial: 0
    },
    newIdx,
    newIdx + 1
  );
  container.appendChild(newCard);
  refreshMedidoresCardsUI();
  updateTariffPreview();

  // Foco automático en el nuevo número de medidor
  const inputNum = newCard.querySelector('.card-med-numero');
  if (inputNum) inputNum.focus();
});

function recalcularTotalInscripcionUI() {
  const acometida = 260.00;
  const instalacion = 40.00;
  const medidorInput = document.getElementById('inputCostoMedidor');
  const medidorVal = parseFloat(medidorInput?.value || '0') || 0;
  const total = acometida + medidorVal + instalacion;
  const display = document.getElementById('displayTotalInscripcion');
  if (display) {
    display.textContent = `$${total.toFixed(2)} USD`;
  }
  return total;
}
document.getElementById('inputCostoMedidor')?.addEventListener('input', recalcularTotalInscripcionUI);

function imprimirComprobanteDirecto(titulo, numComprobante, socioNombre, socioCodigo, cedula, items, total, fondoDestino) {
  const win = window.open('', '_blank', 'width=450,height=600');
  if (!win) {
    window.print();
    return;
  }
  const fechaStr = new Date().toLocaleString('es-EC');
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${titulo} - ${numComprobante}</title>
      <style>
        body { font-family: monospace, sans-serif; padding: 20px; color: #000; }
        .ticket { max-width: 380px; margin: 0 auto; border: 1px dashed #666; padding: 16px; }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .line { border-top: 1px dashed #666; margin: 10px 0; }
        .row { display: flex; justify-content: space-between; margin: 4px 0; font-size: 13px; }
        .total { font-size: 16px; font-weight: bold; margin-top: 8px; }
        .footer { font-size: 11px; text-align: center; margin-top: 15px; color: #444; }
      </style>
    </head>
    <body>
      <div class="ticket">
        <div class="center bold" style="font-size: 15px;">JUNTA ADMINISTRADORA DE AGUA POTABLE</div>
        <div class="center" style="font-size: 12px;">Comprobante de Caja Oficial</div>
        <div class="center bold" style="font-size: 13px; margin-top: 6px;">${titulo.toUpperCase()}</div>
        <div class="center bold" style="font-size: 13px;">N°: ${numComprobante}</div>
        <div class="line"></div>
        <div class="row"><span>Fecha:</span><span>${fechaStr}</span></div>
        <div class="row"><span>Socio:</span><span>${socioNombre}</span></div>
        <div class="row"><span>Código:</span><span>${socioCodigo}</span></div>
        <div class="row"><span>Cédula/RUC:</span><span>${cedula}</span></div>
        <div class="line"></div>
        <div class="bold" style="margin-bottom: 6px;">DETALLE DE VALORES:</div>
        ${items.map((it) => `<div class="row"><span>${it.concepto}</span><span>$${Number(it.monto).toFixed(2)}</span></div>`).join('')}
        <div class="line"></div>
        <div class="row total"><span>TOTAL PAGADO:</span><span>$${Number(total).toFixed(2)} USD</span></div>
        <div class="row" style="font-size: 11px; color: #15803d; margin-top: 4px;"><span>Fondo Contable:</span><span>${fondoDestino}</span></div>
        <div class="row" style="font-size: 11px;"><span>Estado:</span><span class="bold">PAGADO (CANCELADO)</span></div>
        <div class="line"></div>
        <div class="footer">
          <div>¡Gracias por su contribución comunitaria!</div>
          <div style="margin-top: 4px;">Documento no válido como crédito tributario</div>
        </div>
      </div>
      <script>
        window.onload = function() { window.print(); }
      </script>
    </body>
    </html>
  `);
  win.document.close();
}

function openFormModal(socio = null) {
  activeEditingSocio = socio;
  const isEdit = !!socio;
  document.getElementById('modalFormTitle').textContent = isEdit ? '✏️ Editar Socio / Abonado' : '➕ Registrar Nuevo Socio';
  document.getElementById('formSocioId').value = socio?.id || '';
  document.getElementById('inputCedula').value = socio?.cedulaRuc || '';
  document.getElementById('inputNombres').value = socio?.nombres || '';
  document.getElementById('inputApellidos').value = socio?.apellidos || '';
  document.getElementById('inputFechaNac').value = socio?.fechaNacimiento || '1985-01-01';
  document.getElementById('inputFechaAfil').value = socio?.fechaAfiliacion || new Date().toISOString().split('T')[0];
  document.getElementById('inputTelefono').value = socio?.telefono || '';
  document.getElementById('inputDireccion').value = socio?.direccion || '';
  document.getElementById('selectSector').value = socio?.sectorId || cachedSectores[0]?.id || '';

  const hiddenMedidor = document.getElementById('inputMedidor');
  if (hiddenMedidor) hiddenMedidor.value = socio?.medidorNumero || '';
  const hiddenEstado = document.getElementById('selectEstado');
  if (hiddenEstado) hiddenEstado.value = socio?.estadoServicio || 'ACTIVO';
  const hiddenAlcant = document.getElementById('checkAlcantarillado');
  if (hiddenAlcant) hiddenAlcant.checked = Boolean(socio?.tieneAlcantarillado ?? socio?.tiene_alcantarillado ?? false);

  const secCobro = document.getElementById('sectionInscripcionCobro');
  if (secCobro) {
    secCobro.style.display = isEdit ? 'none' : 'block';
    if (!isEdit) {
      const inputMed = document.getElementById('inputCostoMedidor');
      if (inputMed) inputMed.value = '35.00';
      const selMetodo = document.getElementById('selectMetodoPagoInscripcion');
      if (selMetodo) selMetodo.value = 'EFECTIVO';
      recalcularTotalInscripcionUI();
    }
  }

  // Renderizar tarjetas de medidores dinámicas
  const containerCards = document.getElementById('formMedidoresCardsContainer');
  if (containerCards) {
    containerCards.innerHTML = '';

    let medidoresToRender = [];
    if (isEdit && socio?.medidores && socio.medidores.length > 0) {
      medidoresToRender = socio.medidores.map((m) => {
        const tieneAlcant = (m.tieneAlcantarillado !== undefined)
          ? Boolean(m.tieneAlcantarillado)
          : (m.tiene_alcantarillado !== undefined)
            ? Boolean(m.tiene_alcantarillado)
            : Boolean(socio?.tieneAlcantarillado ?? socio?.tiene_alcantarillado ?? false);
        return {
          id: m.id,
          numeroMedidor: m.numeroMedidor || m.numero_medidor || '',
          alias: m.alias || 'Casa principal',
          estado: m.estado || socio.estadoServicio || 'ACTIVO',
          direccion: m.direccion || socio.direccion || '',
          telefono: m.telefono || socio.telefono || '',
          tieneAlcantarillado: tieneAlcant,
          lecturaInicial: Number(m.lecturaInicial ?? m.lectura_inicial ?? 0)
        };
      });
    } else if (isEdit && (socio?.medidorNumero || socio?.medidor_numero)) {
      medidoresToRender = [
        {
          id: socio.medidorId || undefined,
          numeroMedidor: socio.medidorNumero || socio.medidor_numero || '',
          alias: 'Casa principal',
          estado: socio.estadoServicio || socio.estado || 'ACTIVO',
          direccion: socio.direccion || '',
          telefono: socio.telefono || '',
          tieneAlcantarillado: Boolean(socio.tieneAlcantarillado ?? socio.tiene_alcantarillado ?? false),
          lecturaInicial: Number(socio.lecturaInicial ?? socio.lectura_inicial ?? 0)
        }
      ];
    } else {
      // Socio nuevo
      medidoresToRender = [
        {
          id: undefined,
          numeroMedidor: '',
          alias: 'Casa principal',
          estado: 'ACTIVO',
          direccion: '',
          telefono: '',
          tieneAlcantarillado: false,
          lecturaInicial: 0
        }
      ];
    }

    medidoresToRender.forEach((m, idx) => {
      const card = createMedidorCardElement(m, idx, medidoresToRender.length);
      containerCards.appendChild(card);
    });

    refreshMedidoresCardsUI();
  }

  // Botón de eliminar en el formulario de edición (Solo ADMIN al editar)
  const btnFormDelete = document.getElementById('btnFormDelete');
  if (btnFormDelete) {
    btnFormDelete.style.display = isEdit && currentUser?.rol === 'ADMIN' ? 'inline-flex' : 'none';
  }

  updateTariffPreview();
  modalForm.style.display = 'flex';
}

function closeFormModal() {
  if (modalForm) {
    modalForm.style.display = 'none';
  }
  const form = document.getElementById('formSocio');
  if (form) form.reset();
  activeEditingSocio = null;
}

function renderMedidoresCardsInModal(meds, socio, containerMedidores) {
  if (!containerMedidores) return;

  containerMedidores.innerHTML = meds
    .map((m) => {
      const numMed = m.numeroMedidor || m.numero_medidor || 'S/N';
      const alcantActivo = (m.tieneAlcantarillado !== undefined)
        ? Boolean(m.tieneAlcantarillado)
        : Boolean(m.tiene_alcantarillado);
      const yaPagado = Boolean(m.yaPagadoMes || m.ya_pagado_mes);
      const debtMonto = Number(m.totalDeuda ?? m.subtotalMes ?? 0);
      const badgeMonto = yaPagado
        ? `<span style="background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.72rem; border: 1px solid #86efac;">✅ Mes Pagado ($0.00)</span>`
        : (debtMonto > 0
            ? `<span style="background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.72rem; border: 1px solid #fca5a5;">💧 Deuda Medidor: $${debtMonto.toFixed(2)}</span>`
            : `<span style="background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 0.72rem;">Sin deuda</span>`);
      
      const consumoInfo = m.consumoActual
        ? `<span style="color: #64748b; font-size: 0.72rem;">Lectura: <strong>${m.consumoActual.lecturaActual ?? 0} m³</strong> (${m.consumoActual.consumoTotalM3 ?? 0} m³ consumo)</span>`
        : '';

      return `
    <div style="display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 8px 10px; border-radius: 6px; border: 1px solid #bae6fd; font-size: 0.8rem; gap: 8px; flex-wrap: wrap;">
      <div style="flex: 1; min-width: 160px;">
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <strong style="color: #0369a1;">${numMed}</strong> 
          <span style="background: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight:600;">${m.alias || 'Casa'}</span>
          ${badgeMonto}
        </div>
        <div style="font-size: 0.72rem; color: #64748b; margin-top: 3px; display: flex; gap: 8px; flex-wrap: wrap;">
          <span>📍 ${m.nombreSector || socio.nombreSector || 'Sector'} &bull; ${m.direccion || socio.direccion || 'Predio'}</span>
          ${consumoInfo ? `<span>&bull; ${consumoInfo}</span>` : ''}
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <select class="select-toggle-medidor-estado" data-medidor-id="${m.id}" data-socio-id="${socio.id}" data-numero-medidor="${numMed}" style="padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; border: 1.5px solid ${m.estado === 'ACTIVO' ? '#86efac' : m.estado === 'SUSPENDIDO' ? '#fde68a' : '#fca5a5'}; background: ${m.estado === 'ACTIVO' ? '#f0fdf4' : m.estado === 'SUSPENDIDO' ? '#fffbeb' : '#fef2f2'}; color: ${m.estado === 'ACTIVO' ? '#166534' : m.estado === 'SUSPENDIDO' ? '#92400e' : '#991b1b'}; cursor: pointer;">
          <option value="ACTIVO" ${m.estado === 'ACTIVO' ? 'selected' : ''}>🟢 Activo</option>
          <option value="SUSPENDIDO" ${m.estado === 'SUSPENDIDO' ? 'selected' : ''}>🟡 Suspendido</option>
          <option value="CORTADO" ${m.estado === 'CORTADO' ? 'selected' : ''}>🔴 Cortado</option>
        </select>
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; background: ${alcantActivo ? '#dcfce7' : '#f8fafc'}; border: 1px solid ${alcantActivo ? '#86efac' : '#cbd5e1'}; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; color: ${alcantActivo ? '#166534' : '#475569'}; transition: all 0.2s ease;">
          <input type="checkbox" class="chk-toggle-medidor-alcant" data-medidor-id="${m.id}" data-socio-id="${socio.id}" data-numero-medidor="${numMed}" ${alcantActivo ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; accent-color: #16a34a;" />
          <span>${alcantActivo ? '🌊 Alcant. SÍ (+$1)' : '🚫 Alcant. NO'}</span>
        </label>
      </div>
    </div>
  `;
    })
    .join('');

  // 1. Listener de Estado de Medidor (100% Offline-First)
  containerMedidores.querySelectorAll('.select-toggle-medidor-estado').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const medId = e.target.dataset.medidorId;
      const socioId = e.target.dataset.socioId;
      const numMed = e.target.dataset.numeroMedidor;
      const newEstado = e.target.value;

      // Feedback visual
      e.target.style.background = newEstado === 'ACTIVO' ? '#f0fdf4' : newEstado === 'SUSPENDIDO' ? '#fffbeb' : '#fef2f2';
      e.target.style.borderColor = newEstado === 'ACTIVO' ? '#86efac' : newEstado === 'SUSPENDIDO' ? '#fde68a' : '#fca5a5';
      e.target.style.color = newEstado === 'ACTIVO' ? '#166534' : newEstado === 'SUSPENDIDO' ? '#92400e' : '#991b1b';

      const targetMed = meds.find((m) => m.id === medId || m.numeroMedidor === numMed);
      if (targetMed) targetMed.estado = newEstado;

      // Recomputar estado general del socio
      let newSocioEstado = newEstado;
      if (meds.length > 0) {
        if (meds.every((m) => m.estado === 'CORTADO')) newSocioEstado = 'CORTADO';
        else if (meds.every((m) => m.estado === 'SUSPENDIDO')) newSocioEstado = 'SUSPENDIDO';
        else if (meds.some((m) => m.estado === 'ACTIVO')) newSocioEstado = 'ACTIVO';
      }
      socio.estadoServicio = newSocioEstado;
      socio.estado = newSocioEstado;

      // Actualizar IndexedDB
      if (db) {
        try {
          const tx = db.transaction(['socios', 'medidores'], 'readwrite');
          const sStore = tx.objectStore('socios');
          const mStore = tx.objectStore('medidores');

          mStore.get(medId).onsuccess = (ev) => {
            const mRecord = ev.target.result || {
              id: medId,
              idSocio: socioId,
              idSector: targetMed?.idSector || socio.sectorId || '11111111-0000-0000-0000-000000000001',
              numeroMedidor: numMed || socio.medidorNumero,
              alias: targetMed?.alias || 'Casa principal',
              direccion: targetMed?.direccion || socio.direccion || '',
              tieneAlcantarillado: targetMed?.tieneAlcantarillado ?? false,
              estado: newEstado
            };
            mRecord.estado = newEstado;
            mRecord.updatedAt = new Date().toISOString();
            mStore.put(mRecord);
          };

          sStore.get(socioId).onsuccess = (ev) => {
            const sRecord = ev.target.result;
            if (sRecord) {
              if (!Array.isArray(sRecord.medidores) || sRecord.medidores.length === 0) {
                sRecord.medidores = [targetMed || { id: medId, numeroMedidor: numMed, estado: newEstado }];
              } else {
                const sm = sRecord.medidores.find((m) => m.id === medId || m.numeroMedidor === numMed);
                if (sm) sm.estado = newEstado;
              }
              sRecord.estadoServicio = newSocioEstado;
              sRecord.estado = newSocioEstado;
              sRecord.updatedAt = new Date().toISOString();
              sStore.put(sRecord);
            }
          };
        } catch (err) {
          console.warn('[Socios] Error actualizando estado en IndexedDB:', err);
        }
      }

      if (!isWebView) {
        // Modo PWA Oficina: Persistencia atómica directa en Supabase Cloud
        try {
          await apiFetch(`/api/v1/medidores/${medId}`, {
            method: 'PUT',
            body: JSON.stringify({ estado: newEstado, numeroMedidor: numMed })
          });
          if (newSocioEstado !== socio.estadoServicio) {
            await updateSocioServicio(socioId, newSocioEstado);
          }
        } catch (apiErr) {
          console.error('[Socios] Error actualizando estado de medidor:', apiErr);
          Swal.fire({
            icon: 'error',
            title: 'Error en Servidor',
            text: apiErr.message || 'No se pudo actualizar el estado del servicio en la base de datos.'
          });
          return;
        }
      } else {
        // Encolar mutaciones en SyncEngine para medidor y socio (modo móvil Lector en campo)
        await syncEngine.enqueueMutation('medidores', medId, 'UPDATE', {
          id: medId,
          idSocio: socioId,
          idSector: targetMed?.idSector || socio.sectorId || '11111111-0000-0000-0000-000000000001',
          numeroMedidor: numMed || socio.medidorNumero,
          alias: targetMed?.alias || 'Casa principal',
          direccion: targetMed?.direccion || socio.direccion || '',
          tieneAlcantarillado: targetMed?.tieneAlcantarillado ?? false,
          estado: newEstado
        });

        await syncEngine.enqueueMutation('socios', socioId, 'UPDATE', {
          id: socioId,
          codigoSocio: socio.codigoSocio,
          nombres: socio.nombres,
          apellidos: socio.apellidos,
          cedulaRuc: socio.cedulaRuc,
          estado: newSocioEstado,
          estadoServicio: newSocioEstado
        });

        syncEngine.pushPending().catch(() => {});
      }

      // Actualizar UI
      const statusBadge = document.getElementById('detailStatusBadge');
      if (statusBadge) {
        statusBadge.textContent = newSocioEstado;
        statusBadge.className = `status-badge ${
          newSocioEstado === 'ACTIVO'
            ? 'status-badge-active'
            : newSocioEstado === 'SUSPENDIDO'
            ? 'status-badge-suspended'
            : 'status-badge-cut'
        }`;
      }

      getAllSocios().then((all) => {
        renderMetrics(all);
        renderSociosTable(all);
      });

      if (typeof Swal !== 'undefined') {
        const toastText = `Medidor ${numMed} ahora está ${newEstado} (Encolado para sincronización)`;
        if (typeof Swal.mixin === 'function') {
          const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2200, timerProgressBar: true });
          Toast.fire({ icon: 'success', title: toastText });
        } else if (typeof Swal.fire === 'function') {
          Swal.fire({ icon: 'success', title: toastText, timer: 2000, showConfirmButton: false });
        }
      }
    });
  });

  // 2. Listener de Alcantarillado por Medidor (100% Offline-First)
  containerMedidores.querySelectorAll('.chk-toggle-medidor-alcant').forEach((chk) => {
    chk.addEventListener('change', async (e) => {
      const medId = e.target.dataset.medidorId;
      const socioId = e.target.dataset.socioId;
      const numMed = e.target.dataset.numeroMedidor;
      const newChecked = e.target.checked;

      const labelSpan = e.target.parentElement.querySelector('span');
      if (labelSpan) {
        labelSpan.textContent = newChecked ? '🌊 Alcant. SÍ (+$1)' : '🚫 Alcant. NO';
        e.target.parentElement.style.background = newChecked ? '#dcfce7' : '#f8fafc';
        e.target.parentElement.style.borderColor = newChecked ? '#86efac' : '#cbd5e1';
        e.target.parentElement.style.color = newChecked ? '#166534' : '#475569';
      }

      const targetMed = meds.find((m) => m.id === medId || (m.numeroMedidor || m.numero_medidor) === numMed);
      if (targetMed) {
        targetMed.tieneAlcantarillado = newChecked;
        targetMed.tiene_alcantarillado = newChecked;
      }

      const hasAnyAlcant = meds.some((m) => Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado) && m.estado !== 'CORTADO');
      socio.tieneAlcantarillado = hasAnyAlcant;
      socio.tiene_alcantarillado = hasAnyAlcant;

      // Actualizar IndexedDB
      if (db) {
        try {
          const tx = db.transaction(['socios', 'medidores'], 'readwrite');
          const sStore = tx.objectStore('socios');
          const mStore = tx.objectStore('medidores');

          mStore.get(medId).onsuccess = (ev) => {
            const mRecord = ev.target.result || {
              id: medId,
              idSocio: socioId,
              idSector: targetMed?.idSector || socio.sectorId || '11111111-0000-0000-0000-000000000001',
              numeroMedidor: numMed || socio.medidorNumero,
              alias: targetMed?.alias || 'Casa principal',
              direccion: targetMed?.direccion || socio.direccion || '',
              tieneAlcantarillado: newChecked,
              estado: targetMed?.estado || 'ACTIVO'
            };
            mRecord.tieneAlcantarillado = newChecked;
            mRecord.updatedAt = new Date().toISOString();
            mStore.put(mRecord);
          };

          sStore.get(socioId).onsuccess = (ev) => {
            const sRecord = ev.target.result;
            if (sRecord) {
              if (!Array.isArray(sRecord.medidores) || sRecord.medidores.length === 0) {
                sRecord.medidores = [targetMed || { id: medId, numeroMedidor: numMed, tieneAlcantarillado: newChecked }];
              } else {
                const sm = sRecord.medidores.find((m) => m.id === medId || m.numeroMedidor === numMed);
                if (sm) sm.tieneAlcantarillado = newChecked;
              }
              sRecord.tieneAlcantarillado = hasAnyAlcant;
              sRecord.updatedAt = new Date().toISOString();
              sStore.put(sRecord);
            }
          };
        } catch (err) {
          console.warn('[Socios] Error actualizando alcantarillado en IndexedDB:', err);
        }
      }

      if (!isWebView) {
        // Modo PWA Oficina: Persistencia directa en base de datos Supabase
        try {
          await apiFetch(`/api/v1/medidores/${medId}`, {
            method: 'PUT',
            body: JSON.stringify({ tieneAlcantarillado: newChecked, numeroMedidor: numMed })
          });
        } catch (apiErr) {
          console.error('[Socios] Error actualizando alcantarillado:', apiErr);
          Swal.fire({
            icon: 'error',
            title: 'Error en Servidor',
            text: apiErr.message || 'No se pudo actualizar el alcantarillado en la base de datos.'
          });
          return;
        }
      } else {
        // Encolar mutaciones en SyncEngine (Modo Móvil Lector)
        await syncEngine.enqueueMutation('medidores', medId, 'UPDATE', {
          id: medId,
          idSocio: socioId,
          idSector: targetMed?.idSector || socio.sectorId || '11111111-0000-0000-0000-000000000001',
          numeroMedidor: numMed || socio.medidorNumero,
          alias: targetMed?.alias || 'Casa principal',
          direccion: targetMed?.direccion || socio.direccion || '',
          tieneAlcantarillado: newChecked,
          estado: targetMed?.estado || 'ACTIVO'
        });

        await syncEngine.enqueueMutation('socios', socioId, 'UPDATE', {
          id: socioId,
          codigoSocio: socio.codigoSocio,
          nombres: socio.nombres,
          apellidos: socio.apellidos,
          cedulaRuc: socio.cedulaRuc,
          tieneAlcantarillado: hasAnyAlcant
        });

        syncEngine.pushPending().catch(() => {});
      }

      // Actualizar desglose tarifario en la ficha
      document.getElementById('detailAlcantarillado').innerHTML = hasAnyAlcant
        ? '<span class="tag-yes">SÍ</span>'
        : '<span class="tag-no">NO</span>';
      const base = socio.esTerceraEdad ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
      const alc = hasAnyAlcant ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0;
      document.getElementById('detailTarifaAlcantMonto').textContent = alc > 0 ? `$${alc.toFixed(2)}` : '$0.00 (No aplica)';
      document.getElementById('detailTarifaTotalMonto').textContent = `$${(base + alc).toFixed(2)} USD`;

      getAllSocios().then((all) => {
        renderMetrics(all);
        renderSociosTable(all);
      });

      if (typeof Swal !== 'undefined') {
        const toastText = newChecked ? 'Alcantarillado activado en medidor (Encolado)' : 'Alcantarillado desactivado (Encolado)';
        if (typeof Swal.mixin === 'function') {
          const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2200, timerProgressBar: true });
          Toast.fire({ icon: 'success', title: toastText });
        } else if (typeof Swal.fire === 'function') {
          Swal.fire({ icon: 'success', title: toastText, timer: 2000, showConfirmButton: false });
        }
      }
    });
  });
}

async function openDetailModal(socio) {
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

  // Cargar lista de acometidas / medidores del socio (Offline-First Real)
  const containerMedidores = document.getElementById('detailMedidoresList');
  if (containerMedidores) {
    let localMeds = (Array.isArray(socio.medidores) && socio.medidores.length > 0) ? [...socio.medidores] : [];

    if (localMeds.length === 0 && isWebView && db) {
      try {
        const tx = db.transaction(['medidores'], 'readonly');
        const mStore = tx.objectStore('medidores');
        const req = mStore.getAll();
        const allMeds = await new Promise((resolve) => {
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });
        localMeds = allMeds.filter((m) => m.idSocio === socio.id || m.id_socio === socio.id);
      } catch (e) {
        console.warn('[Socios] Error buscando medidores en IndexedDB:', e);
      }
    }

    if (localMeds.length === 0) {
      localMeds = [
        {
          id: socio.medidorId || undefined,
          idSocio: socio.id,
          idSector: socio.sectorId || cachedSectores[0]?.id || '11111111-0000-0000-0000-000000000001',
          numeroMedidor: socio.medidorNumero || 'MED-00000',
          alias: 'Casa principal',
          direccion: socio.direccion || '',
          tieneAlcantarillado: Boolean(socio.tieneAlcantarillado),
          estado: socio.estadoServicio || socio.estado || 'ACTIVO'
        }
      ];
    }

    renderMedidoresCardsInModal(localMeds, socio, containerMedidores);

    // Conectar con el endpoint genérico universal (/deudas o /estado-cuenta) para sincronizar cuenta corriente y medidores con montos reales
    apiFetch(`/api/v1/socios/${socio.id}/deudas`)
      .catch(() => apiFetch(`/api/v1/socios/${socio.id}/estado-cuenta`))
      .then((resDeudas) => {
        let dataDeudas = null;
        if (resDeudas?.socio || resDeudas?.medidores) {
          dataDeudas = resDeudas;
        } else if (resDeudas?.data?.socio || resDeudas?.data?.medidores) {
          dataDeudas = resDeudas.data;
        }
        if (!dataDeudas) return;

        const resumen = dataDeudas.resumenGeneral || dataDeudas;
        const totalDeuda = Number(resumen.totalDeuda ?? dataDeudas.montoTotalAdeudado ?? 0);
        const mesesAdeudados = Number(resumen.mesesAdeudados ?? dataDeudas.mesesAdeudados ?? 0);
        const totalDeudaAgua = Number(resumen.totalDeudaAgua ?? 0);
        const deudaAlcant = Number(resumen.deudaAlcantarillado ?? dataDeudas.socio?.deudaAlcantarillado ?? 0);
        const totalMultas = Number(resumen.totalMultas ?? 0);
        const isMoraReal = totalDeuda > 0 || mesesAdeudados > 0;

        // Sincronizar memoria del socio
        socio.montoTotalAdeudado = totalDeuda;
        socio.mesesAdeudados = mesesAdeudados;
        socio.estadoCuenta = isMoraReal ? 'EN_MORA' : 'AL_DIA';

        if (activeSocioDetail && activeSocioDetail.id === socio.id) {
          // Actualizar tarjeta de Cuenta Corriente
          const accountCard = document.getElementById('detailAccountCard');
          if (accountCard) accountCard.className = `account-status-card ${isMoraReal ? 'account-mora' : 'account-ok'}`;
          const accIcon = document.getElementById('detailAccountIcon');
          if (accIcon) accIcon.textContent = isMoraReal ? '⚠️' : '✅';
          const accTitle = document.getElementById('detailAccountTitle');
          if (accTitle) accTitle.textContent = isMoraReal ? 'EN MORA / ATRASADO' : 'AL DÍA CON SUS PAGOS';
          const accSub = document.getElementById('detailAccountSubtitle');
          if (accSub) accSub.textContent = isMoraReal ? `${mesesAdeudados || 1} mes(es) pendiente(s)` : 'Sin valores pendientes de pago';

          const debtInfo = document.getElementById('detailDebtInfo');
          if (debtInfo) {
            if (isMoraReal) {
              debtInfo.style.display = 'block';
              const debtAmt = document.getElementById('detailDebtAmount');
              if (debtAmt) debtAmt.textContent = `$${totalDeuda.toFixed(2)} USD`;
              const debtSince = document.getElementById('detailDebtSince');
              if (debtSince) {
                const items = [];
                if (totalDeudaAgua > 0) items.push(`<span style="background:#fee2e2; color:#991b1b; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.75rem;">💧 Agua: $${totalDeudaAgua.toFixed(2)}</span>`);
                if (totalMultas > 0) items.push(`<span style="background:#fef3c7; color:#92400e; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.75rem;">🔨 Multas: $${totalMultas.toFixed(2)}</span>`);
                if (deudaAlcant > 0) items.push(`<span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.75rem;">🌊 Obra Alcant: $${deudaAlcant.toFixed(2)}</span>`);
                debtSince.innerHTML = `
                  <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 4px;">
                    <div style="font-size: 0.75rem; color: #64748b; font-weight: 600;">Desglose de valores pendientes:</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">${items.join('')}</div>
                    <div style="margin-top: 8px;">
                      <a href="caja.html" class="btn btn-sm btn-primary" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.75rem; padding: 4px 10px; font-weight: 700; text-decoration: none; border-radius: 6px;">
                        💵 Ir a Caja a Cobrar
                      </a>
                    </div>
                  </div>
                `;
              }
            } else {
              debtInfo.style.display = 'none';
            }
          }

          // Medidores con montos actualizados
          if (Array.isArray(dataDeudas.medidores) && dataDeudas.medidores.length > 0) {
            const normalizedMeds = dataDeudas.medidores.map((m) => ({
              ...m,
              id: m.id || m.idMedidor,
              idSocio: m.idSocio || m.id_socio || socio.id,
              idSector: m.idSector || m.id_sector,
              numeroMedidor: m.numeroMedidor || m.numero_medidor || 'S/N',
              numero_medidor: m.numeroMedidor || m.numero_medidor || 'S/N',
              alias: m.alias || 'Casa principal',
              direccion: m.direccion || socio.direccion || '',
              tieneAlcantarillado: Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado),
              tiene_alcantarillado: Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado),
              estado: m.estado || 'ACTIVO',
              consumoActual: m.consumoActual || null,
              totalDeuda: Number(m.totalDeuda ?? 0),
              subtotalMes: Number(m.subtotalMes ?? 0),
              yaPagadoMes: Boolean(m.yaPagadoMes),
              mesesAdeudados: Number(m.mesesAdeudados ?? 0)
            }));
            socio.medidores = normalizedMeds;
            const hasAnyAlcant = normalizedMeds.some((m) => m.tieneAlcantarillado && m.estado !== 'CORTADO');
            socio.tieneAlcantarillado = hasAnyAlcant;
            socio.tiene_alcantarillado = hasAnyAlcant;

            const firstActive = normalizedMeds.find((m) => m.estado !== 'CORTADO') || normalizedMeds[0];
            if (firstActive && firstActive.numeroMedidor) {
              socio.medidorNumero = firstActive.numeroMedidor;
              const medBadge = document.getElementById('detailMedidor');
              if (medBadge) medBadge.innerHTML = `<span class="badge-code">${socio.medidorNumero}</span>`;
            }

            const alcTag = document.getElementById('detailAlcantarillado');
            if (alcTag) alcTag.innerHTML = hasAnyAlcant ? '<span class="tag-yes">SÍ</span>' : '<span class="tag-no">NO</span>';
            const baseMonto = socio.esTerceraEdad ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
            const alcantMonto = hasAnyAlcant ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0;
            const alcEl = document.getElementById('detailTarifaAlcantMonto');
            if (alcEl) alcEl.textContent = alcantMonto > 0 ? `$${alcantMonto.toFixed(2)}` : '$0.00 (No aplica)';
            const totEl = document.getElementById('detailTarifaTotalMonto');
            if (totEl) totEl.textContent = `$${(baseMonto + alcantMonto).toFixed(2)} USD`;

            renderMedidoresCardsInModal(normalizedMeds, socio, containerMedidores);
          }
        }

        // Refrescar tabla del padrón para mantener sincronicidad
        renderSociosTable(cachedSocios);
      })
      .catch((err) => {
        console.warn('[Socios] Error actualizando cuenta y medidores desde API genérica:', err);
      });
  }

  const btnDetailDelete = document.getElementById('btnDetailDelete');
  if (btnDetailDelete) {
    btnDetailDelete.style.display = currentUser?.rol === 'ADMIN' ? 'inline-flex' : 'none';
  }

  modalDetail.style.display = 'flex';
}

function closeDetailModal() {
  modalDetail.style.display = 'none';
}

async function confirmDeleteSocio(socio) {
  if (!socio) return;

  if (currentUser?.rol !== 'ADMIN') {
    Swal.fire({
      icon: 'error',
      title: 'Acceso Denegado',
      text: 'Solo los usuarios con rol ADMINISTRADOR tienen autorización para eliminar socios definitivamente del sistema.'
    });
    return;
  }

  const result = await Swal.fire({
    icon: 'warning',
    title: '¿Eliminar socio del padrón?',
    html: `
      <p style="font-size: 1rem; color: #1e293b;">
        ¿Está seguro de eliminar definitivamente a <strong>${socio.nombreCompleto}</strong> (Cédula: <code>${socio.cedulaRuc}</code>)?
      </p>
      <div style="background: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 0.75rem; margin-top: 10px; text-align: left; font-size: 0.85rem; color: #991b1b;">
        <strong>⚠️ Acción destructiva en cascada:</strong>
        <ul style="margin: 4px 0 0 16px; padding: 0;">
          <li>Se eliminarán sus acometidas y medidores.</li>
          <li>Se borrarán sus lecturas históricas.</li>
          <li>Se cancelarán facturas y multas registradas.</li>
        </ul>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Sí, Eliminar Definitivamente',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc2626',
    focusCancel: true
  });

  if (!result.isConfirmed) return;

  try {
    await apiFetch(`/api/v1/socios/${socio.id}`, { method: 'DELETE' });
  } catch (err) {
    console.warn('[Socios] Backend DELETE response:', err.message);
    // Si el socio ya no existía en backend o era un registro local huérfano, procedemos a borrarlo localmente
    if (!err.message || (!err.message.includes('no existe') && !err.message.includes('ya fue eliminado') && !err.message.includes('404'))) {
      Swal.fire({
        icon: 'error',
        title: 'Error al Eliminar',
        text: err.message || 'No fue posible eliminar el socio.'
      });
      return;
    }
  }

  // Eliminar de IndexedDB local solo si estamos en WebView móvil
  if (isWebView && db) {
    try {
      const tx = db.transaction(['socios'], 'readwrite');
      tx.objectStore('socios').delete(socio.id);
    } catch (e) {
      console.warn('[Socios] Error eliminando de IndexedDB:', e);
    }
  }

  notifySociosUpdated(socio.id, null);

  await renderUI();

  Swal.fire({
    icon: 'success',
    title: 'Socio Eliminado',
    text: `El socio ${socio.nombreCompleto} fue eliminado exitosamente del padrón.`
  });
}

async function updateSocioServicio(id, estado) {
  return await apiFetch(`/api/v1/socios/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ estado })
  });
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

  const newMedId = crypto.randomUUID();
  const newMedRecord = {
    id: newMedId,
    idSocio: activeSocioDetail.id,
    idSector,
    numeroMedidor,
    alias: alias || 'Acometida adicional',
    direccion: direccion || activeSocioDetail.direccion || '',
    tieneAlcantarillado,
    estado: 'ACTIVO',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!isWebView) {
    // Modo PWA Oficina: Crear medidor directamente en el servidor
    try {
      const res = await apiFetch(`/api/v1/socios/${activeSocioDetail.id}/medidores`, {
        method: 'POST',
        body: JSON.stringify({ numeroMedidor, alias, idSector, direccion, tieneAlcantarillado })
      });
      if (res.data?.id) {
        newMedRecord.id = res.data.id;
      }
      if (!Array.isArray(activeSocioDetail.medidores)) activeSocioDetail.medidores = [];
      activeSocioDetail.medidores.push(newMedRecord);
      activeSocioDetail.tieneAlcantarillado = activeSocioDetail.medidores.some((m) => m.tieneAlcantarillado && m.estado !== 'CORTADO');
    } catch (err) {
      console.error('[Socios] Error registrando medidor:', err);
      Swal.fire({
        icon: 'error',
        title: 'Error al Registrar Medidor',
        text: err.message || 'No se pudo registrar el medidor en el servidor.'
      });
      return;
    }
  } else {
    // 1. IndexedDB local (modo móvil lector)
    if (db) {
      try {
        const tx = db.transaction(['socios', 'medidores'], 'readwrite');
        tx.objectStore('medidores').put(newMedRecord);
        const sStore = tx.objectStore('socios');
        sStore.get(activeSocioDetail.id).onsuccess = (ev) => {
          const s = ev.target.result;
          if (s) {
            if (!Array.isArray(s.medidores)) s.medidores = [];
            s.medidores.push(newMedRecord);
            s.tieneAlcantarillado = s.medidores.some((m) => m.tieneAlcantarillado && m.estado !== 'CORTADO');
            s.updatedAt = new Date().toISOString();
            sStore.put(s);
          }
        };
      } catch (e) {
        console.warn('[Socios] Error guardando nuevo medidor en IndexedDB:', e);
      }
    }

    // 2. Encolar mutación offline-first
    await syncEngine.enqueueMutation('medidores', newMedId, 'CREATE', newMedRecord);
    syncEngine.pushPending().catch(() => {});
  }

  modalAddMedidor.style.display = 'none';
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      icon: 'success',
      title: 'Medidor Asignado',
      text: `El medidor "${numeroMedidor}" (${alias}) fue registrado exitosamente.`,
      timer: 2000,
      showConfirmButton: false
    });
  }

  // Refrescar modal de detalle y tabla general
  await openDetailModal(activeSocioDetail);
  const socios = await getAllSocios();
  renderMetrics(socios);
  renderSociosTable(socios);
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

document.getElementById('btnDetailDelete')?.addEventListener('click', () => {
  if (activeSocioDetail) {
    const toDelete = activeSocioDetail;
    closeDetailModal();
    confirmDeleteSocio(toDelete);
  }
});

document.getElementById('btnFormDelete')?.addEventListener('click', () => {
  if (activeEditingSocio) {
    const toDelete = activeEditingSocio;
    closeFormModal();
    confirmDeleteSocio(toDelete);
  }
});

async function handleStatusChange(status) {
  if (!activeSocioDetail) return;

  // REQUISITO 2: Si la cuenta está cortada y pasa a activo, cobrar $20.00 de reconexión
  const isCurrentlyCortado = activeSocioDetail.estadoServicio === 'CORTADO' ||
    activeSocioDetail.estado === 'CORTADO' ||
    (Array.isArray(activeSocioDetail.medidores) && activeSocioDetail.medidores.some((m) => m.estado === 'CORTADO'));

  if (status === 'ACTIVO' && isCurrentlyCortado) {
    const { value: formValues } = await Swal.fire({
      icon: 'warning',
      title: 'Reconexión de Servicio de Agua',
      html: `
        <div style="text-align: left; font-size: 0.9rem;">
          <p>El socio <strong>${activeSocioDetail.nombreCompleto}</strong> tiene el servicio en estado <strong>CORTADO</strong>.</p>
          <div style="background: #fef2f2; border: 1.5px solid #fca5a5; border-radius: 8px; padding: 12px; margin: 10px 0;">
            <div style="color: #991b1b; font-weight: 700; font-size: 0.95rem;">Tasa de Reconexión Obligatoria: $20.00 USD</div>
            <div style="color: #7f1d1d; font-size: 0.8rem; margin-top: 2px;">Destino: 100% al Fondo de Operación y Mantenimiento</div>
          </div>
          <label style="font-size: 0.85rem; font-weight: 600; display: block; margin-top: 8px;">Método de Pago:</label>
          <select id="swalMetodoPagoReconexion" class="swal2-input" style="width: 100%; margin: 4px 0 10px 0; height: 40px; font-size: 0.9rem;">
            <option value="EFECTIVO">💵 Efectivo</option>
            <option value="TRANSFERENCIA">🏦 Transferencia Bancaria</option>
          </select>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '💳 Cobrar $20.00 y Reactivar',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => {
        const metodo = document.getElementById('swalMetodoPagoReconexion')?.value || 'EFECTIVO';
        return { metodoPago: metodo, montoReconexion: 20.00 };
      }
    });

    if (!formValues) return;

    try {
      const recRes = await apiFetch(`/api/v1/socios/${activeSocioDetail.id}/reconectar`, {
        method: 'POST',
        body: JSON.stringify({
          montoReconexion: formValues.montoReconexion,
          metodoPago: formValues.metodoPago
        })
      });

      activeSocioDetail.estadoServicio = 'ACTIVO';
      activeSocioDetail.estado = 'ACTIVO';
      if (Array.isArray(activeSocioDetail.medidores)) {
        activeSocioDetail.medidores.forEach((m) => { m.estado = 'ACTIVO'; });
      }

      notifySociosUpdated(activeSocioDetail.id, activeSocioDetail);
      closeDetailModal();
      await renderUI();

      const recFactura = recRes?.data?.recibo;
      await Swal.fire({
        icon: 'success',
        title: '¡Servicio Reconectado!',
        html: `
          <div style="text-align: left; font-size: 0.9rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px;">
            <div><strong>Comprobante Oficial:</strong> #${recFactura?.numero_factura || 'REC-REC'}</div>
            <div><strong>Socio:</strong> ${activeSocioDetail.nombreCompleto}</div>
            <div><strong>Tasa Cobrada:</strong> $20.00 USD</div>
            <div><strong>Fondo Contable:</strong> Fondo Operación y Mantenimiento</div>
            <div style="margin-top: 6px; color: #166534; font-weight: 700;">Estado reactivado a ACTIVO exitosamente.</div>
          </div>
        `,
        confirmButtonText: '🖨️ Imprimir Comprobante',
        showCancelButton: true,
        cancelButtonText: 'Cerrar'
      }).then((swalRes) => {
        if (swalRes.isConfirmed && recFactura) {
          imprimirComprobanteDirecto(
            'Comprobante de Reconexión',
            recFactura.numero_factura,
            activeSocioDetail.nombreCompleto,
            activeSocioDetail.codigoSocio,
            activeSocioDetail.cedulaRuc,
            [{ concepto: 'Tasa de Reconexión de Servicio de Agua', monto: 20.00 }],
            20.00,
            'Fondo Operación y Mantenimiento'
          );
        }
      });
      return;
    } catch (err) {
      console.error('[Socios] Error reconectando socio:', err);
      Swal.fire({
        icon: 'error',
        title: 'Error al Reconectar',
        text: err.message || 'No se pudo procesar el cobro de reconexión.'
      });
      return;
    }
  }

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

    // 1. Actualizar en memoria activa
    activeSocioDetail.estadoServicio = status;
    activeSocioDetail.estado = status;
    if (Array.isArray(activeSocioDetail.medidores)) {
      activeSocioDetail.medidores.forEach((m) => {
        m.estado = status;
      });
    }

    // 2. Actualizar en IndexedDB
    if (db) {
      try {
        const tx = db.transaction(['socios', 'medidores'], 'readwrite');
        const sStore = tx.objectStore('socios');
        const mStore = tx.objectStore('medidores');
        sStore.get(activeSocioDetail.id).onsuccess = (ev) => {
          const s = ev.target.result;
          if (s) {
            s.estado = status;
            s.estadoServicio = status;
            if (Array.isArray(s.medidores)) {
              s.medidores.forEach((m) => { m.estado = status; });
            }
            s.updatedAt = new Date().toISOString();
            sStore.put(s);
          }
        };
        if (Array.isArray(activeSocioDetail.medidores)) {
          for (const m of activeSocioDetail.medidores) {
            if (m.id) {
              mStore.get(m.id).onsuccess = (ev) => {
                const rec = ev.target.result;
                if (rec) {
                  rec.estado = status;
                  rec.updatedAt = new Date().toISOString();
                  mStore.put(rec);
                }
              };
            }
          }
        }
      } catch (e) {
        console.warn('[Socios] Error actualizando estado en IndexedDB:', e);
      }
    }

    if (!isWebView) {
      // Modo PWA Oficina: Actualizar estado directamente en el servidor
      try {
        await updateSocioServicio(activeSocioDetail.id, status);
      } catch (err) {
        console.error('[Socios] Error actualizando estado socio:', err);
        Swal.fire({
          icon: 'error',
          title: 'Error al Actualizar Estado',
          text: err.message || 'No se pudo actualizar el estado en el servidor.'
        });
        return;
      }
    } else {
      // 3. Encolar mutaciones offline-first para socio y cada uno de sus medidores (modo móvil Lector)
      await syncEngine.enqueueMutation('socios', activeSocioDetail.id, 'UPDATE', {
        id: activeSocioDetail.id,
        codigoSocio: activeSocioDetail.codigoSocio,
        nombres: activeSocioDetail.nombres,
        apellidos: activeSocioDetail.apellidos,
        cedulaRuc: activeSocioDetail.cedulaRuc,
        estado: status,
        estadoServicio: status
      });
      if (Array.isArray(activeSocioDetail.medidores)) {
        for (const m of activeSocioDetail.medidores) {
          if (m.id) {
            await syncEngine.enqueueMutation('medidores', m.id, 'UPDATE', {
              id: m.id,
              idSocio: activeSocioDetail.id,
              idSector: m.idSector || activeSocioDetail.sectorId,
              numeroMedidor: m.numeroMedidor,
              alias: m.alias || 'Casa principal',
              direccion: m.direccion || activeSocioDetail.direccion,
              tieneAlcantarillado: Boolean(m.tieneAlcantarillado),
              estado: status
            });
          }
        }
      }
      syncEngine.pushPending().catch(() => {});
    }

    notifySociosUpdated(activeSocioDetail.id, activeSocioDetail);

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
  const direccion = document.getElementById('inputDireccion')?.value.trim() || '';
  const telefono = document.getElementById('inputTelefono')?.value.trim() || '';
  const fechaAfiliacion = document.getElementById('inputFechaAfil')?.value || new Date().toISOString().split('T')[0];
  let existing = activeEditingSocio;
  if (isEdit && !existing && db) {
    existing = await new Promise((resolve) => {
      const tx = db.transaction(['socios'], 'readonly');
      const req = tx.objectStore('socios').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }
  // 1. Extraer todas las acometidas/medidores editados en el formulario
  const medCards = document.querySelectorAll('#formMedidoresCardsContainer .form-medidor-card');
  const medidores = [];

  medCards.forEach((card, idx) => {
    const rawId = card.dataset.medidorId || '';
    const medId = (rawId && !rawId.startsWith('temp-')) ? rawId : undefined;
    const num = card.querySelector('.card-med-numero')?.value.trim() || '';
    const alias = card.querySelector('.card-med-alias')?.value.trim() || (idx === 0 ? 'Casa principal' : `Acometida #${idx + 1}`);
    const estado = card.querySelector('.card-med-estado')?.value || 'ACTIVO';
    const dir = card.querySelector('.card-med-direccion')?.value.trim() || direccion;
    const tel = card.querySelector('.card-med-telefono')?.value.trim() || telefono;
    const tieneAlcant = card.querySelector('.card-med-alcantarillado')?.checked ?? false;
    const lecturaInicial = parseFloat(card.querySelector('.card-med-lectura-inicial')?.value || '0') || 0;

    if (num) {
      medidores.push({
        id: medId,
        idSocio: id || undefined,
        idSector: sectorId,
        numeroMedidor: num,
        alias,
        estado,
        direccion: dir,
        telefono: tel,
        tieneAlcantarillado: tieneAlcant,
        lecturaInicial,
        lectura_inicial: lecturaInicial
      });
    }
  });

  // Fallback de seguridad si no se ingresaron acometidas
  if (medidores.length === 0) {
    medidores.push({
      numeroMedidor: `MED-${Math.floor(10000 + Math.random() * 90000)}`,
      alias: 'Casa principal',
      estado: 'ACTIVO',
      direccion,
      telefono,
      tieneAlcantarillado: true,
      lecturaInicial: 0,
      lectura_inicial: 0
    });
  }

  const primaryMed = medidores[0];
  const tieneAlcantarillado = medidores.some((m) => m.tieneAlcantarillado && m.estado !== 'CORTADO');

  let estadoServicio = 'ACTIVO';
  if (medidores.every((m) => m.estado === 'CORTADO')) estadoServicio = 'CORTADO';
  else if (medidores.every((m) => m.estado === 'SUSPENDIDO')) estadoServicio = 'SUSPENDIDO';
  else if (medidores.some((m) => m.estado === 'ACTIVO')) estadoServicio = 'ACTIVO';

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
    medidorNumero: primaryMed.numeroMedidor,
    lecturaInicial: primaryMed.lecturaInicial || 0,
    medidores,
    tieneAlcantarillado,
    estadoServicio,
    estadoCuenta: existing?.estadoCuenta || 'AL_DIA',
    mesesAdeudados: existing?.mesesAdeudados || 0,
    montoTotalAdeudado: existing?.montoTotalAdeudado || 0,
    fechaDeudaAntigua: existing?.fechaDeudaAntigua
  };

  const costoAcometida = 260.00;
  const costoMedidor = parseFloat(document.getElementById('inputCostoMedidor')?.value || '35.00') || 35.00;
  const costoInstalacion = 40.00;
  const metodoPago = document.getElementById('selectMetodoPagoInscripcion')?.value || 'EFECTIVO';

  if (!isEdit) {
    socioData.costoAcometida = costoAcometida;
    socioData.costoMedidor = costoMedidor;
    socioData.costoInstalacion = costoInstalacion;
    socioData.metodoPago = metodoPago;
  }

  const btnSubmit = document.querySelector('#formSocio button[type="submit"]');
  const originalText = btnSubmit ? btnSubmit.textContent : 'Guardar';
  try {
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Guardando en servidor central...';
    }

    const saveResult = await saveSocioLocal(socioData, isEdit);
    closeFormModal();
    await renderUI();

    if (!isEdit) {
      const recibo = saveResult?.recibo;
      const totalCobrado = (costoAcometida + costoMedidor + costoInstalacion).toFixed(2);
      await Swal.fire({
        icon: 'success',
        title: '¡Socio Inscrito y Cobro Registrado!',
        html: `
          <div style="text-align: left; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; font-size: 0.9rem;">
            <div style="font-weight: 700; color: #15803d; margin-bottom: 6px;">Comprobante Oficial #${recibo?.numero_factura || 'REC-INS'}</div>
            <div><strong>Socio:</strong> ${socioData.nombreCompleto} (${socioData.codigoSocio})</div>
            <div><strong>Acometida:</strong> $${costoAcometida.toFixed(2)} USD</div>
            <div><strong>Medidor:</strong> $${costoMedidor.toFixed(2)} USD</div>
            <div><strong>Instalación:</strong> $${costoInstalacion.toFixed(2)} USD</div>
            <hr style="margin: 8px 0; border: none; border-top: 1px dashed #86efac;" />
            <div style="font-size: 1.05rem; font-weight: 800; color: #166534;">Total Recaudado: $${totalCobrado} USD</div>
            <div style="font-size: 0.75rem; color: #15803d; margin-top: 4px;">Acreditado a: Fondo Operación y Mantenimiento</div>
          </div>
        `,
        confirmButtonText: '🖨️ Imprimir Comprobante',
        showCancelButton: true,
        cancelButtonText: 'Cerrar'
      }).then((swalRes) => {
        if (swalRes.isConfirmed && recibo) {
          imprimirComprobanteDirecto(
            'Comprobante de Inscripción y Acometida',
            recibo.numero_factura,
            socioData.nombreCompleto,
            socioData.codigoSocio,
            socioData.cedulaRuc,
            [
              { concepto: 'Derecho de Acometida', monto: costoAcometida },
              { concepto: 'Costo del Medidor', monto: costoMedidor },
              { concepto: 'Costo de Instalación', monto: costoInstalacion }
            ],
            costoAcometida + costoMedidor + costoInstalacion,
            'Fondo Operación y Mantenimiento'
          );
        }
      });
    } else {
      Swal.fire({
        icon: 'success',
        title: 'Socio Actualizado',
        text: `Los datos de ${socioData.nombreCompleto} fueron guardados y sincronizados exitosamente con el servidor central.`
      });
    }
  } catch (err) {
    console.error('[Socios] Error al guardar socio:', err);
    Swal.fire({
      icon: 'error',
      title: 'Error al Registrar Socio',
      text: err.message || 'No fue posible guardar el socio en el servidor.'
    });
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.textContent = originalText;
    }
  }
});

// Filtros reactivos
['filterBusqueda', 'filterSector', 'filterEstadoServicio', 'filterCondicion', 'filterCuenta'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => getAllSocios().then(renderSociosTable));
});

// Inicializar al cargar
if (isWebView) {
  initIndexedDB().then(renderUI);
} else {
  renderUI();
}
