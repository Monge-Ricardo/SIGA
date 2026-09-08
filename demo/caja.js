import { requireAuth, getCurrentUser, apiFetch } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';

// Guard de autenticación (Accesible por ADMIN y CAJERO)
const currentUser = requireAuth(['ADMIN', 'CAJERO']);
if (currentUser) {
  injectAppLayout('caja');
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

const PERIODO_ACTUAL = '2026-08';

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
        dbInstance.createObjectStore('lecturas', { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains('cobros')) {
        dbInstance.createObjectStore('cobros', { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains('movimientos_caja')) {
        dbInstance.createObjectStore('movimientos_caja', { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains('sync_queue')) {
        dbInstance.createObjectStore('sync_queue', { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = () => {
      console.warn('IndexedDB no disponible, usando modo API directo');
      resolve(null);
    };
  });
}

// Variables del Módulo
let cachedSocios = [];
let cachedLecturas = [];
let selectedSocio = null;
let currentCalculation = null;
let socioMultas = [];
let selectedMultasIds = new Set();
let socioDeudasAnteriores = [];
let selectedDeudasAnterioresIds = new Set();

async function renderCajaUI() {
  const badge = document.getElementById('fechaHoyBadge');
  if (badge) {
    badge.textContent = new Date().toLocaleDateString('es-EC', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  // 1. Cargar Socios desde la API Backend (con fallback local)
  try {
    const res = await apiFetch('/api/v1/socios');
    const sociosApi = res.data || [];
    cachedSocios = sociosApi.map((s) => ({
      id: s.id,
      codigoSocio: s.codigoSocio,
      nombres: s.nombres,
      apellidos: s.apellidos,
      nombreCompleto: `${s.apellidos} ${s.nombres}`.trim() || `${s.nombres || ''} ${s.apellidos || ''}`.trim(),
      cedulaRuc: s.cedulaRuc,
      fechaNacimiento: s.fechaNacimiento,
      sectorId: s.idSector || s.sectorId,
      nombreSector: s.nombreSector || 'Sector General',
      medidorNumero: s.medidorNumero,
      medidores: s.medidores || [],
      tieneAlcantarillado: s.tieneAlcantarillado,
      estadoServicio: s.estado || 'ACTIVO',
      estadoCuenta: s.estadoCuenta || (s.montoTotalAdeudado > 0 ? 'EN_MORA' : 'AL_DIA'),
      mesesAdeudados: s.mesesAdeudados || 0,
      montoTotalAdeudado: Number(s.montoTotalAdeudado || 0)
    }));
  } catch (err) {
    console.warn('[Caja] Usando socios de IndexedDB');
    if (db) {
      cachedSocios = await new Promise((res) => {
        const tx = db.transaction(['socios'], 'readonly');
        const req = tx.objectStore('socios').getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      });
    }
  }

  populateSocioSelect(cachedSocios);
  setupSocioSearch();
  await updateMetricsAndHistory();
}

function populateSocioSelect(socios) {
  const select = document.getElementById('selectSocioCobro');
  if (!select) return;
  select.innerHTML = '<option value="">-- Buscar o seleccionar socio del padrón --</option>';

  const ordenados = [...socios].sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto));

  ordenados.forEach((s) => {
    const isMora = s.estadoCuenta === 'EN_MORA' || s.mesesAdeudados > 0;
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.nombreCompleto} (${s.cedulaRuc}) • ${s.nombreSector} ${isMora ? `⚠️ [MORA: $${s.montoTotalAdeudado.toFixed(2)}]` : '✅ [AL DÍA]'}`;
    select.appendChild(opt);
  });
}

async function updateMetricsAndHistory() {
  let cobros = [];
  let facturasPagadas = [];

  // Intentar cargar cobros y facturas reales del backend
  try {
    const resFacturas = await apiFetch('/api/v1/facturas');
    const allFacturas = resFacturas.data || [];
    // Recibos cobrados o con abonos (montoPagado > 0 o estadoPago === 'PAGADO')
    const facturasConCobro = allFacturas.filter((f) => (f.montoPagado && f.montoPagado > 0) || f.estadoPago === 'PAGADO');
    cobros = facturasConCobro.map((f) => ({
      id: f.id,
      numeroRecibo: f.numeroFactura,
      socioNombre: f.socioNombre,
      socioCedula: f.socioCedula,
      socioSector: f.nombreSector || 'Sector Centro',
      periodo: f.periodoCodigo || PERIODO_ACTUAL,
      consumoM3: f.consumoM3,
      cargoBase: f.valorBase,
      valorExcedenteUSD: f.valorExcedente,
      alcantarilladoUSD: f.valorAlcantarillado,
      multaExtra: f.valorMultas,
      deudaAnteriorCobrada: f.valorDeudaAnterior,
      montoTotal: f.totalPagar,
      montoPagado: f.montoPagado !== undefined ? f.montoPagado : f.totalPagar,
      saldoPendiente: f.saldoPendiente !== undefined ? f.saldoPendiente : 0,
      metodoPago: f.metodoPago || 'EFECTIVO',
      montoRecibido: f.montoPagado !== undefined ? f.montoPagado : f.totalPagar,
      cambioEntregado: 0,
      fechaPago: f.fechaPago || f.updatedAt
    }));
  } catch (err) {
    if (db) {
      cobros = await new Promise((res) => {
        const tx = db.transaction(['cobros'], 'readonly');
        const req = tx.objectStore('cobros').getAll();
        req.onsuccess = () => res((req.result || []).reverse());
        req.onerror = () => res([]);
      });
    }
  }

  // Consultar balance general de fondos desde el Libro Mayor
  let totalRecaudacionAgua = 0;
  let totalEgresos = 0;
  let balanceNeto = 0;

  try {
    const resBalance = await apiFetch('/api/v1/fondos/balance');
    if (resBalance && resBalance.data) {
      totalRecaudacionAgua = Number(resBalance.data.totalIngresos || 0);
      totalEgresos = Number(resBalance.data.totalEgresos || 0);
      balanceNeto = Number(resBalance.data.balanceNeto || 0);
    } else {
      cobros.forEach((c) => {
        totalRecaudacionAgua += (c.montoPagado !== undefined ? c.montoPagado : c.montoTotal);
      });
      balanceNeto = totalRecaudacionAgua - totalEgresos;
    }
  } catch (_e) {
    cobros.forEach((c) => {
      totalRecaudacionAgua += (c.montoPagado !== undefined ? c.montoPagado : c.montoTotal);
    });
    balanceNeto = totalRecaudacionAgua - totalEgresos;
  }

  const elAgua = document.getElementById('metricRecaudacionAgua');
  if (elAgua) elAgua.textContent = `$${totalRecaudacionAgua.toFixed(2)}`;
  const elCount = document.getElementById('metricRecibosCount');
  if (elCount) elCount.textContent = `${cobros.length} recibos cobrados`;
  const elEntradas = document.getElementById('metricTotalEntradas');
  if (elEntradas) elEntradas.textContent = `$${totalRecaudacionAgua.toFixed(2)}`;
  const elSalidas = document.getElementById('metricTotalSalidas');
  if (elSalidas) elSalidas.textContent = `$${totalEgresos.toFixed(2)}`;
  const elGastos = document.getElementById('metricGastosCount');
  if (elGastos) elGastos.textContent = `${totalEgresos > 0 ? 'Egresos activos' : '0 egresos registrados'}`;
  const elBalance = document.getElementById('metricBalanceNeto');
  if (elBalance) elBalance.textContent = `$${balanceNeto.toFixed(2)}`;

  renderRecibosTable(cobros);
}

function renderRecibosTable(cobros) {
  const tbody = document.getElementById('recibosTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (cobros.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: #94a3b8; padding: 2.5rem;">
          No se han emitido recibos en la jornada de hoy.
        </td>
      </tr>
    `;
    return;
  }

  const isUserAdmin = currentUser?.rol === 'ADMIN';

  cobros.slice(0, 10).forEach((c) => {
    const tr = document.createElement('tr');
    const montoDisplay = (c.montoPagado !== undefined ? c.montoPagado : c.montoTotal).toFixed(2);
    const esAbono = c.saldoPendiente !== undefined && c.saldoPendiente > 0;

    tr.innerHTML = `
      <td><span class="badge-code" style="color:#0284c7; font-weight:700;">${c.numeroRecibo}</span></td>
      <td>
        <strong>${c.socioNombre}</strong>
        ${esAbono ? `<div style="font-size:0.75rem; color:#b45309; font-weight:600;">⚠️ Abono parcial (Resta: $${c.saldoPendiente.toFixed(2)})</div>` : ''}
      </td>
      <td style="text-align: right;">
        <strong class="text-accent" style="font-size:1rem;">$${montoDisplay}</strong>
        ${esAbono ? `<div style="font-size:0.72rem; color:#64748b;">de $${c.montoTotal.toFixed(2)}</div>` : ''}
      </td>
      <td><span style="font-size:0.8rem; color:#64748b;">${new Date(c.fechaPago).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn-icon btn-print-row" title="Ver / Imprimir Recibo">🖨️</button>
        ${
          isUserAdmin
            ? `<button class="btn-icon btn-delete-row" title="Eliminar / Anular Factura (ADMIN)" style="color: #ef4444; margin-left: 4px;">🗑️</button>`
            : ''
        }
      </td>
    `;

    tr.querySelector('.btn-print-row')?.addEventListener('click', () => {
      showReceiptModal(c);
    });

    if (isUserAdmin) {
      tr.querySelector('.btn-delete-row')?.addEventListener('click', () => {
        confirmDeleteFactura(c);
      });
    }

    tbody.appendChild(tr);
  });
}

function formatearTipoRubro(tipo) {
  const map = {
    MINGA: 'Minga',
    ASAMBLEA: 'Asamblea',
    RECONEXION: 'Reconexión',
    CUOTA_EXTRA: 'Cuota Extra',
    OTRO: 'Rubro'
  };
  return map[tipo] || tipo || 'Multa';
}

function renderDeudasAnterioresList() {
  const section = document.getElementById('sectionDeudasAnteriores');
  const container = document.getElementById('containerDeudasAnteriores');
  const countEl = document.getElementById('posMesesMora');
  if (!section || !container) return;

  if (socioDeudasAnteriores.length === 0) {
    section.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  section.style.display = 'block';
  if (countEl) countEl.textContent = socioDeudasAnteriores.length;

  container.innerHTML = socioDeudasAnteriores
    .map((d) => {
      const isChecked = selectedDeudasAnterioresIds.has(d.id);
      return `
        <label class="debt-check-item" style="cursor: pointer;">
          <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
            <input type="checkbox" class="chk-deuda-anterior" data-id="${d.id}" ${isChecked ? 'checked' : ''} />
            <div style="font-size: 0.82rem; color: #1e293b;">
              <strong>Período ${d.periodoCodigo || d.idPeriodo || 'Anterior'}</strong>
              <span style="color: #64748b; font-size: 0.74rem;"> &bull; Consumo: ${d.consumoM3 || 0} m³</span>
            </div>
          </div>
          <strong class="debt-amount">$${Number(d.totalMes || d.totalPagar || 0).toFixed(2)}</strong>
        </label>
      `;
    })
    .join('');

  container.querySelectorAll('.chk-deuda-anterior').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) {
        selectedDeudasAnterioresIds.add(id);
      } else {
        selectedDeudasAnterioresIds.delete(id);
      }
      recalcularTotalPOS();
    });
  });
}

function renderMultasList() {
  const container = document.getElementById('containerMultasSocio');
  if (!container) return;

  if (socioMultas.length === 0) {
    container.innerHTML = `
      <div style="font-size: 0.78rem; color: #64748b; padding: 4px 0;">
        ✅ El socio no registra multas pendientes.
      </div>
    `;
    return;
  }

  container.innerHTML = socioMultas
    .map((m) => {
      const isChecked = selectedMultasIds.has(m.id);
      return `
        <div class="multa-card-item">
          <label style="display: flex; align-items: center; gap: 8px; flex: 1; cursor: pointer; margin: 0;">
            <input type="checkbox" class="chk-multa-socio" data-id="${m.id}" ${isChecked ? 'checked' : ''} />
            <div>
              <div style="font-weight: 700; font-size: 0.82rem; color: #0f172a;">
                <span class="badge-multa-tipo">${formatearTipoRubro(m.tipoRubro)}</span>
                ${m.motivo || 'Multa'}
              </div>
              <div style="font-size: 0.72rem; color: #64748b;">
                Fecha: ${new Date(m.createdAt).toLocaleDateString('es-EC')}
              </div>
            </div>
          </label>
          <div style="display: flex; align-items: center; gap: 6px;">
            <strong style="font-size: 0.92rem; color: #b91c1c;">$${Number(m.monto).toFixed(2)}</strong>
            <button type="button" class="btn-icon btn-edit-multa" data-id="${m.id}" title="Editar Multa" style="width: 26px; height: 26px; font-size: 0.75rem;">✏️</button>
            <button type="button" class="btn-icon btn-del-multa" data-id="${m.id}" title="Eliminar Multa" style="width: 26px; height: 26px; font-size: 0.75rem; color: #ef4444;">🗑️</button>
          </div>
        </div>
      `;
    })
    .join('');

  container.querySelectorAll('.chk-multa-socio').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) {
        selectedMultasIds.add(id);
      } else {
        selectedMultasIds.delete(id);
      }
      recalcularTotalPOS();
    });
  });

  container.querySelectorAll('.btn-edit-multa').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const m = socioMultas.find((item) => item.id === id);
      if (m) openMultaModal(m);
    });
  });

  container.querySelectorAll('.btn-del-multa').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const m = socioMultas.find((item) => item.id === id);
      if (m) await confirmDeleteMulta(m);
    });
  });
}

function recalcularTotalPOS() {
  if (!currentCalculation) return;

  let totalMultasSeleccionadas = 0;
  socioMultas.forEach((m) => {
    if (selectedMultasIds.has(m.id)) {
      totalMultasSeleccionadas += Number(m.monto);
    }
  });

  let totalDeudasSeleccionadas = 0;
  socioDeudasAnteriores.forEach((d) => {
    if (selectedDeudasAnterioresIds.has(d.id)) {
      totalDeudasSeleccionadas += Number(d.totalMes || d.totalPagar || 0);
    }
  });

  const totalMes = currentCalculation.totalMes;
  const totalPagar = Number((totalMes + totalMultasSeleccionadas + totalDeudasSeleccionadas).toFixed(2));

  currentCalculation.totalMultasSeleccionadas = totalMultasSeleccionadas;
  currentCalculation.totalDeudasSeleccionadas = totalDeudasSeleccionadas;
  currentCalculation.totalPagar = totalPagar;

  const totalEl = document.getElementById('posTotalPagar');
  if (totalEl) totalEl.textContent = `$${totalPagar.toFixed(2)} USD`;

  updateVuelto();
}

async function displaySocioPlanilla(socio) {
  selectedSocio = socio;

  // Consultar estado de cuenta en vivo desde el Backend API
  let estadoCuentaApi = null;
  try {
    const res = await apiFetch(`/api/v1/socios/${socio.id}/estado-cuenta`);
    estadoCuentaApi = res.data;
  } catch (err) {
    console.warn('[Caja] Usando cálculo local para socio:', err.message);
  }

  // Deudas y multas del socio
  socioDeudasAnteriores = estadoCuentaApi?.facturasPendientes || [];
  socioMultas = estadoCuentaApi?.multasPendientes || [];

  // Marcar todas por defecto para cancelar deuda y estabilizar saldo
  selectedDeudasAnterioresIds = new Set(socioDeudasAnteriores.map((d) => d.id));
  selectedMultasIds = new Set(socioMultas.map((m) => m.id));

  // Base Calculation
  const edad = calcularEdad(socio.fechaNacimiento);
  const es3raEdad = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
  const cargoBase = es3raEdad ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
  const tieneAlcant = socio.tieneAlcantarillado === true;
  const recargoAlcant = tieneAlcant ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0.0;

  const lant = 150;
  const lact = lant + 35; // Consumo estándar
  const consumoM3 = Math.max(0, lact - lant);
  const excedenteM3 = Math.max(0, consumoM3 - TARIFAS_CONFIG.LIMITE_BASE_M3);
  const valorExcedenteUSD = Number((excedenteM3 * TARIFAS_CONFIG.EXCEDENTE_POR_M3).toFixed(2));

  currentCalculation = {
    socioId: socio.id,
    socioNombre: socio.nombreCompleto,
    socioCedula: socio.cedulaRuc,
    socioSector: socio.nombreSector || socio.sectorId,
    medidorNumero: socio.medidorNumero || 'MED-10492',
    esTerceraEdad: es3raEdad,
    tieneAlcantarillado: tieneAlcant,
    lecturaAnterior: lant,
    lecturaActual: lact,
    consumoM3,
    excedenteM3,
    valorExcedenteUSD,
    cargoBase,
    recargoAlcant,
    totalMes: Number((cargoBase + valorExcedenteUSD + recargoAlcant).toFixed(2)),
    totalMultasSeleccionadas: 0,
    totalDeudasSeleccionadas: 0,
    totalPagar: 0
  };

  document.getElementById('socioPlanillaEmpty').style.display = 'none';
  document.getElementById('socioPlanillaDetails').style.display = 'flex';

  // Mini Card
  document.getElementById('posSocioNombre').textContent = currentCalculation.socioNombre;
  document.getElementById('posSocioCedula').textContent = currentCalculation.socioCedula;

  const numMedidores = socio.medidores && socio.medidores.length > 0 ? socio.medidores.length : 1;
  const medidoresStr =
    socio.medidores && socio.medidores.length > 1
      ? `💧 ${numMedidores} medidores (${socio.medidores.map((m) => m.alias || m.numeroMedidor).join(', ')})`
      : `Medidor: ${currentCalculation.medidorNumero}`;

  document.getElementById('posSocioSector').innerHTML = `
    ${currentCalculation.socioSector} &bull; <strong style="color: #0284c7;">${medidoresStr}</strong>
  `;

  document.getElementById('posCategoriaBadge').innerHTML = `
    <span class="age-badge ${currentCalculation.esTerceraEdad ? 'badge-senior' : 'badge-normal'}">
      ${currentCalculation.esTerceraEdad ? '👴 3ra Edad ($5.00)' : '👤 Normal ($7.00)'}
    </span>
  `;

  // Desglose Base
  document.getElementById('posLant').textContent = currentCalculation.lecturaAnterior;
  document.getElementById('posLact').textContent = currentCalculation.lecturaActual;
  document.getElementById('posConsumo').textContent = `${currentCalculation.consumoM3} m³`;

  document.getElementById('posCargoBase').textContent = `$${currentCalculation.cargoBase.toFixed(2)}`;
  document.getElementById('posExcedenteM3').textContent = currentCalculation.excedenteM3;
  document.getElementById('posExcedenteUSD').textContent = `$${currentCalculation.valorExcedenteUSD.toFixed(2)}`;
  document.getElementById('posAlcantarilladoUSD').textContent = currentCalculation.tieneAlcantarillado
    ? `+$${currentCalculation.recargoAlcant.toFixed(2)} (SÍ)`
    : `$0.00 (NO)`;

  renderDeudasAnterioresList();
  renderMultasList();
  recalcularTotalPOS();

  // Reset Monto Recibido
  const inputRecibido = document.getElementById('inputMontoRecibido');
  if (inputRecibido) inputRecibido.value = '';
  updateVuelto();
}

function updateVuelto() {
  if (!currentCalculation) return;

  const total = currentCalculation.totalPagar;
  const inputRecibido = document.getElementById('inputMontoRecibido');
  const displayCambio = document.getElementById('posCambioMonto');
  if (!inputRecibido || !displayCambio) return;
  const recibidoVal = parseFloat(inputRecibido.value);

  if (isNaN(recibidoVal) || recibidoVal === 0) {
    displayCambio.textContent = '$0.00 USD';
    displayCambio.style.color = '#64748b';
    return;
  }

  const diff = Number((recibidoVal - total).toFixed(2));
  if (diff < 0) {
    const falta = Math.abs(diff);
    displayCambio.innerHTML = `<span>Abono: <strong>$${recibidoVal.toFixed(2)}</strong></span> &bull; <span style="color: #dc2626; font-weight: 800;">Queda debiendo: $${falta.toFixed(2)} USD</span>`;
    displayCambio.style.color = '#b45309';
  } else {
    displayCambio.textContent = `Cambio: $${diff.toFixed(2)} USD`;
    displayCambio.style.color = '#059669';
  }
}

// Event Listeners de Selección y Cálculo
document.getElementById('selectSocioCobro')?.addEventListener('change', async (e) => {
  const socioId = e.target.value;
  const inputSearch = document.getElementById('inputBuscarSocioCobro');
  if (!socioId) {
    selectedSocio = null;
    currentCalculation = null;
    if (inputSearch) inputSearch.value = '';
    document.getElementById('socioPlanillaEmpty').style.display = 'block';
    document.getElementById('socioPlanillaDetails').style.display = 'none';
    return;
  }

  const s = cachedSocios.find((item) => item.id === socioId);
  if (s) {
    if (inputSearch) inputSearch.value = s.nombreCompleto;
    await displaySocioPlanilla(s);
  }
});

function setupSocioSearch() {
  const inputSearch = document.getElementById('inputBuscarSocioCobro');
  const dropdown = document.getElementById('dropdownSugerenciasSocio');
  const selectSocio = document.getElementById('selectSocioCobro');
  if (!inputSearch || !dropdown) return;

  inputSearch.addEventListener('input', (e) => {
    const term = e.target.value.trim().toLowerCase();
    if (!term) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      return;
    }

    const matches = cachedSocios
      .filter((s) => {
        return (
          s.nombreCompleto.toLowerCase().includes(term) ||
          s.cedulaRuc.toLowerCase().includes(term) ||
          (s.codigoSocio && s.codigoSocio.toLowerCase().includes(term)) ||
          (s.medidorNumero && s.medidorNumero.toLowerCase().includes(term)) ||
          (s.medidores && s.medidores.some((m) => m.numeroMedidor?.toLowerCase().includes(term) || m.alias?.toLowerCase().includes(term))) ||
          (s.nombreSector && s.nombreSector.toLowerCase().includes(term))
        );
      })
      .slice(0, 8);

    if (matches.length === 0) {
      dropdown.innerHTML = `
        <div style="padding: 0.85rem; color: #64748b; font-size: 0.85rem; text-align: center;">
          🔍 No se encontraron socios para "<strong>${term}</strong>"
        </div>
      `;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = matches
      .map((s) => {
        const isMora = s.estadoCuenta === 'EN_MORA' || s.mesesAdeudados > 0;
        return `
          <div class="search-suggestion-item" data-id="${s.id}">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
              <div>
                <strong style="color: #0f172a; font-size: 0.9rem;">${s.nombreCompleto}</strong>
                <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">
                  Cédula: <code>${s.cedulaRuc}</code> &bull; Sector: <span class="sector-tag" style="font-size:0.7rem;">${s.nombreSector}</span> &bull; Medidor: <code>${s.medidorNumero}</code>
                </div>
              </div>
              <div>
                ${
                  isMora
                    ? `<span class="badge-mora" style="font-size:0.72rem;">⚠️ Mora ($${s.montoTotalAdeudado.toFixed(2)})</span>`
                    : `<span class="badge-ok" style="font-size:0.72rem;">✅ Al Día</span>`
                }
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    dropdown.querySelectorAll('.search-suggestion-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const id = item.dataset.id;
        const s = cachedSocios.find((x) => x.id === id);
        if (s) {
          inputSearch.value = s.nombreCompleto;
          if (selectSocio) selectSocio.value = s.id;
          dropdown.style.display = 'none';
          await displaySocioPlanilla(s);
        }
      });
    });

    dropdown.style.display = 'block';
  });

  document.addEventListener('click', (e) => {
    if (!inputSearch.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  inputSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });
}

// Modal Multa Eventos y Métodos
function openMultaModal(multa = null) {
  if (!selectedSocio) {
    Swal.fire({
      icon: 'warning',
      title: 'Seleccione un socio',
      text: 'Debe buscar o seleccionar un socio del padrón antes de registrar una multa.'
    });
    return;
  }

  const modal = document.getElementById('modalMulta');
  const titleEl = document.getElementById('modalMultaTitle');
  const idInput = document.getElementById('inputMultaId');
  const tipoSelect = document.getElementById('selectTipoRubroMulta');
  const motivoInput = document.getElementById('inputMotivoMulta');
  const montoInput = document.getElementById('inputMontoMulta');

  if (!modal) return;

  if (multa) {
    titleEl.textContent = `✏️ Editar Multa para ${selectedSocio.nombreCompleto}`;
    idInput.value = multa.id;
    tipoSelect.value = multa.tipoRubro || 'OTRO';
    motivoInput.value = multa.motivo || '';
    montoInput.value = Number(multa.monto).toFixed(2);
  } else {
    titleEl.textContent = `⚖️ Registrar Multa para ${selectedSocio.nombreCompleto}`;
    idInput.value = '';
    tipoSelect.value = 'MINGA';
    motivoInput.value = '';
    montoInput.value = '3.00';
  }

  modal.style.display = 'flex';
}

async function confirmDeleteMulta(multa) {
  const confirm = await Swal.fire({
    icon: 'question',
    title: '¿Eliminar Multa / Rubro?',
    text: `¿Desea eliminar la multa "${multa.motivo}" por $${Number(multa.monto).toFixed(2)}?`,
    showCancelButton: true,
    confirmButtonText: 'Sí, Eliminar',
    cancelButtonText: 'Cancelar'
  });

  if (!confirm.isConfirmed) return;

  try {
    await apiFetch(`/api/v1/multas/${multa.id}`, { method: 'DELETE' });
    selectedMultasIds.delete(multa.id);
    await refreshSocioEstadoCuenta();
    Swal.fire({
      icon: 'success',
      title: 'Multa Eliminada',
      text: 'La multa fue eliminada correctamente.',
      timer: 1500,
      showConfirmButton: false
    });
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error', text: err.message });
  }
}

async function refreshSocioEstadoCuenta() {
  if (!selectedSocio) return;
  try {
    const res = await apiFetch(`/api/v1/socios/${selectedSocio.id}/estado-cuenta`);
    const estado = res.data;
    socioDeudasAnteriores = estado?.facturasPendientes || [];
    socioMultas = estado?.multasPendientes || [];

    renderDeudasAnterioresList();
    renderMultasList();
    recalcularTotalPOS();
  } catch (err) {
    console.warn('[Caja] Error actualizando estado de cuenta:', err);
  }
}

document.getElementById('btnOpenModalMulta')?.addEventListener('click', () => {
  openMultaModal();
});

document.getElementById('btnCloseMultaModal')?.addEventListener('click', () => {
  const m = document.getElementById('modalMulta');
  if (m) m.style.display = 'none';
});

document.getElementById('btnCancelMulta')?.addEventListener('click', () => {
  const m = document.getElementById('modalMulta');
  if (m) m.style.display = 'none';
});

document.getElementById('selectTipoRubroMulta')?.addEventListener('change', (e) => {
  const selOpt = e.target.selectedOptions[0];
  const suggested = selOpt ? selOpt.dataset.monto : '';
  const montoInput = document.getElementById('inputMontoMulta');
  if (suggested && montoInput) {
    montoInput.value = parseFloat(suggested).toFixed(2);
  }
});

document.getElementById('formMulta')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const idMulta = document.getElementById('inputMultaId')?.value;
  const tipoRubro = document.getElementById('selectTipoRubroMulta')?.value || 'OTRO';
  const motivo = document.getElementById('inputMotivoMulta')?.value.trim();
  const monto = parseFloat(document.getElementById('inputMontoMulta')?.value || '0');

  if (!motivo || isNaN(monto) || monto <= 0) {
    Swal.fire({ icon: 'warning', title: 'Datos incompletos', text: 'Ingrese un motivo y monto válidos.' });
    return;
  }

  const btnSave = document.getElementById('btnSaveMulta');
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.textContent = 'Guardando...';
  }

  try {
    if (idMulta) {
      await apiFetch(`/api/v1/multas/${idMulta}`, {
        method: 'PUT',
        body: JSON.stringify({ tipoRubro, motivo, monto })
      });
      selectedMultasIds.add(idMulta);
    } else {
      const res = await apiFetch('/api/v1/multas', {
        method: 'POST',
        body: JSON.stringify({
          idSocio: selectedSocio.id,
          tipoRubro,
          motivo,
          monto,
          idPeriodo: PERIODO_ACTUAL
        })
      });
      if (res.data?.id) {
        selectedMultasIds.add(res.data.id);
      }
    }

    const modal = document.getElementById('modalMulta');
    if (modal) modal.style.display = 'none';

    await refreshSocioEstadoCuenta();

    Swal.fire({
      icon: 'success',
      title: '¡Multa Guardada!',
      text: 'La multa ha sido registrada y agregada a la liquidación.',
      timer: 1500,
      showConfirmButton: false
    });
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error', text: err.message });
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.textContent = '💾 Guardar Multa';
    }
  }
});

/**
 * Restringe un campo numérico/monetario para:
 * 1. Bloquear comas (,), caracteres exponenciales (e, E), signos (+, -) y caracteres no numéricos.
 * 2. Permitir únicamente un solo punto decimal (.)
 * 3. Limitar a un máximo de 2 decimales (ej. 34.80 y bloquear 38.8000000).
 * 4. Sanitizar automáticamente pegado (paste) o autocompletado.
 */
function restrictDecimalInput(input, maxDecimals = 2, onChangeCallback = null) {
  if (!input) return;

  // 1. Interceptar pulsaciones de teclas
  input.addEventListener('keydown', (e) => {
    // Permitir teclas de navegación y control del sistema
    const allowedControls = [
      'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Home', 'End'
    ];
    if (allowedControls.includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    // Bloquear explícitamente comas, signos + / - y notación exponencial
    if (e.key === ',' || e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
      e.preventDefault();
      return;
    }

    // Permitir punto decimal solo si aún no existe uno
    if (e.key === '.') {
      if (input.value.includes('.')) {
        e.preventDefault();
      }
      return;
    }

    // Bloquear cualquier carácter que no sea un dígito 0-9
    if (!/^\d$/.test(e.key)) {
      e.preventDefault();
      return;
    }

    // Si ya existe un punto decimal, verificar la cantidad de decimales actuales
    const val = input.value;
    const dotIndex = val.indexOf('.');
    if (dotIndex !== -1) {
      try {
        const selStart = input.selectionStart;
        const selEnd = input.selectionEnd;
        // Si el cursor está en la parte decimal y no está reemplazando una selección
        if (selStart !== null && selStart > dotIndex && selStart === selEnd) {
          const decs = val.slice(dotIndex + 1);
          if (decs.length >= maxDecimals) {
            e.preventDefault();
            return;
          }
        }
      } catch (_) {
        // En navegadores donde input[type="number"] no expone selectionStart, el listener 'input' truncará al instante
      }
    }
  });

  // 2. Sanitizar en tiempo real en cada cambio/entrada/pegado
  const sanitizeValue = () => {
    let val = input.value;
    if (!val && val !== '0') {
      if (typeof onChangeCallback === 'function') onChangeCallback();
      return;
    }

    // Reemplazar cualquier coma por punto si se coló
    let cleaned = val.replace(/,/g, '.');

    // Mantener solo un punto decimal
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      cleaned = parts[0] + '.' + parts.slice(1).join('');
    }

    // Limitar parte decimal a maxDecimals
    const splitParts = cleaned.split('.');
    if (splitParts[1] && splitParts[1].length > maxDecimals) {
      cleaned = `${splitParts[0]}.${splitParts[1].slice(0, maxDecimals)}`;
    }

    if (input.value !== cleaned) {
      input.value = cleaned;
    }

    if (typeof onChangeCallback === 'function') {
      onChangeCallback();
    }
  };

  input.addEventListener('input', sanitizeValue);
  input.addEventListener('paste', () => {
    setTimeout(sanitizeValue, 0);
  });
  input.addEventListener('change', sanitizeValue);
  input.addEventListener('blur', () => {
    if (input.value && input.value.endsWith('.')) {
      input.value = input.value.slice(0, -1);
      if (typeof onChangeCallback === 'function') onChangeCallback();
    }
  });
}

// Aplicar restricción de 2 decimales y sin comas a los inputs monetarios de Caja
restrictDecimalInput(document.getElementById('inputMontoRecibido'), 2, updateVuelto);
restrictDecimalInput(document.getElementById('inputMontoMulta'), 2);
restrictDecimalInput(document.getElementById('inputMontoGasto'), 2);

// Ejecutar Cobro (Transacción de Caja en Vivo con el Servidor Backend)
document.getElementById('btnEjecutarCobro')?.addEventListener('click', async () => {
  if (!selectedSocio || !currentCalculation) return;

  const selectMetodo = document.getElementById('selectMetodoPago');
  const metodoPago = selectMetodo ? selectMetodo.value : 'EFECTIVO';
  const inputRecibido = document.getElementById('inputMontoRecibido');
  const montoRecibido = parseFloat(inputRecibido?.value || '0');

  if (metodoPago === 'EFECTIVO' && (isNaN(montoRecibido) || montoRecibido <= 0)) {
    Swal.fire({
      icon: 'warning',
      title: 'Monto Requerido',
      text: 'Por favor ingrese el monto recibido en efectivo (pago total o abono parcial).'
    });
    return;
  }

  const totalPagar = currentCalculation.totalPagar;
  const esAbonoParcial = metodoPago === 'EFECTIVO' && montoRecibido < totalPagar;
  const saldoPendiente = esAbonoParcial ? Number((totalPagar - montoRecibido).toFixed(2)) : 0;
  const montoEfectivoCobrado = esAbonoParcial ? montoRecibido : (metodoPago === 'EFECTIVO' ? Math.min(montoRecibido, totalPagar) : totalPagar);

  let confirmRes;
  if (esAbonoParcial) {
    confirmRes = await Swal.fire({
      icon: 'question',
      title: '¿Registrar Abono / Pago Parcial?',
      html: `
        <div style="text-align: left; font-size: 0.95rem; color: #334155; line-height: 1.5;">
          <p style="margin-bottom: 0.6rem;">El socio <strong>${currentCalculation.socioNombre}</strong> pagará un <strong>abono parcial</strong>:</p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.8rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Total Planilla:</span>
              <strong>$${totalPagar.toFixed(2)} USD</strong>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #059669; font-weight: 700;">
              <span>Monto Abonado Hoy:</span>
              <span>+$${montoRecibido.toFixed(2)} USD</span>
            </div>
            <hr style="border: 0; border-top: 1px dashed #cbd5e1; margin: 6px 0;" />
            <div style="display: flex; justify-content: space-between; color: #dc2626; font-weight: 800; font-size: 1.05rem;">
              <span>Saldo que queda debiendo:</span>
              <span>$${saldoPendiente.toFixed(2)} USD</span>
            </div>
          </div>
          <p style="font-size: 0.82rem; color: #64748b; margin: 0;">
            ℹ️ El saldo restante de <strong>$${saldoPendiente.toFixed(2)} USD</strong> quedará cargado a la cuenta del socio para su próxima liquidación.
          </p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonColor: '#0284c7',
      cancelButtonColor: '#64748b',
      confirmButtonText: '✓ Sí, Registrar Abono',
      cancelButtonText: 'Cancelar'
    });
  } else {
    const cambio = metodoPago === 'EFECTIVO' ? Math.max(0, montoRecibido - totalPagar) : 0;
    confirmRes = await Swal.fire({
      icon: 'question',
      title: '¿Confirmar Cobro en Caja?',
      html: `
        <div>
          <p>¿Registrar cobro total de <strong>$${totalPagar.toFixed(2)} USD</strong> para <strong>${currentCalculation.socioNombre}</strong>?</p>
          ${cambio > 0 ? `<p style="color: #059669; font-weight: 700; margin-top: 6px;">💵 Cambio a entregar al socio: $${cambio.toFixed(2)} USD</p>` : ''}
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Sí, Registrar Cobro',
      cancelButtonText: 'Cancelar'
    });
  }

  if (!confirmRes.isConfirmed) return;

  const btnEjecutar = document.getElementById('btnEjecutarCobro');
  btnEjecutar.disabled = true;
  btnEjecutar.textContent = '⏳ Procesando transacción...';

  let cobroFinal = null;

  try {
    // 1. Enviar Liquidación con multasIds y deudasAnterioresIds seleccionadas
    const resLiquidacion = await apiFetch('/api/v1/facturas/liquidar', {
      method: 'POST',
      body: JSON.stringify({
        idSocio: selectedSocio.id,
        idPeriodo: PERIODO_ACTUAL,
        multasIds: Array.from(selectedMultasIds),
        deudasAnterioresIds: Array.from(selectedDeudasAnterioresIds)
      })
    });

    const facturaId = resLiquidacion.data?.id;

    // 2. Cobrar factura en el backend (distribuye fondos, cobra multas y salda deudas anteriores seleccionadas)
    const resCobro = await apiFetch(`/api/v1/facturas/${facturaId}/cobrar`, {
      method: 'POST',
      body: JSON.stringify({
        metodoPago,
        fechaPago: new Date().toISOString(),
        multasIds: Array.from(selectedMultasIds),
        deudasAnterioresIds: Array.from(selectedDeudasAnterioresIds),
        montoCobrado: montoEfectivoCobrado
      })
    });

    const facturaCobrada = resCobro.data;

    cobroFinal = {
      id: facturaCobrada.id,
      numeroRecibo: facturaCobrada.numeroFactura,
      codigoSocio: selectedSocio.codigoSocio,
      socioNombre: currentCalculation.socioNombre,
      socioCedula: currentCalculation.socioCedula,
      socioSector: currentCalculation.socioSector,
      medidorNumero: currentCalculation.medidorNumero,
      periodo: PERIODO_ACTUAL,
      lecturaAnterior: currentCalculation.lecturaAnterior,
      lecturaActual: currentCalculation.lecturaActual,
      consumoM3: facturaCobrada.consumoM3,
      cargoBase: facturaCobrada.valorBase,
      valorExcedenteUSD: facturaCobrada.valorExcedente,
      alcantarilladoUSD: facturaCobrada.valorAlcantarillado,
      multaExtra: facturaCobrada.valorMultas,
      deudaAnteriorCobrada: facturaCobrada.valorDeudaAnterior,
      montoTotal: facturaCobrada.totalPagar,
      montoAbonado: montoEfectivoCobrado,
      saldoPendiente: facturaCobrada.saldoPendiente !== undefined ? facturaCobrada.saldoPendiente : saldoPendiente,
      esAbono: esAbonoParcial,
      metodoPago,
      montoRecibido: metodoPago === 'EFECTIVO' ? montoRecibido : facturaCobrada.totalPagar,
      cambioEntregado: metodoPago === 'EFECTIVO' ? Math.max(0, montoRecibido - totalPagar) : 0,
      fechaPago: facturaCobrada.fechaPago || new Date().toISOString()
    };
  } catch (apiErr) {
    console.warn('[Caja] Backend offline o error, procesando respaldo local:', apiErr.message);

    // Respaldo local en caso offline
    const cobroId = 'rec-' + crypto.randomUUID().slice(0, 8);
    const numeroRecibo = `00${Math.floor(1000 + Math.random() * 9000)}`;

    cobroFinal = {
      id: cobroId,
      numeroRecibo,
      codigoSocio: selectedSocio.codigoSocio,
      socioNombre: currentCalculation.socioNombre,
      socioCedula: currentCalculation.socioCedula,
      socioSector: currentCalculation.socioSector,
      medidorNumero: currentCalculation.medidorNumero,
      periodo: PERIODO_ACTUAL,
      lecturaAnterior: currentCalculation.lecturaAnterior,
      lecturaActual: currentCalculation.lecturaActual,
      consumoM3: currentCalculation.consumoM3,
      cargoBase: currentCalculation.cargoBase,
      valorExcedenteUSD: currentCalculation.valorExcedenteUSD,
      alcantarilladoUSD: currentCalculation.recargoAlcant,
      multaExtra: currentCalculation.multaExtra,
      deudaAnteriorCobrada: currentCalculation.deudaAnterior,
      montoTotal: currentCalculation.totalPagar,
      montoAbonado: montoEfectivoCobrado,
      saldoPendiente,
      esAbono: esAbonoParcial,
      metodoPago,
      montoRecibido: metodoPago === 'EFECTIVO' ? montoRecibido : currentCalculation.totalPagar,
      cambioEntregado: metodoPago === 'EFECTIVO' ? Math.max(0, montoRecibido - totalPagar) : 0,
      fechaPago: new Date().toISOString()
    };
  } finally {
    btnEjecutar.disabled = false;
    btnEjecutar.textContent = '✅ Cobrar y Emitir Recibo';
  }

  // Guardar en IndexedDB local
  if (db && cobroFinal) {
    try {
      const tx = db.transaction(['cobros', 'socios'], 'readwrite');
      tx.objectStore('cobros').add(cobroFinal);
      const socioActualizado = {
        ...selectedSocio,
        estadoCuenta: cobroFinal.saldoPendiente > 0 ? 'EN_MORA' : 'AL_DIA',
        mesesAdeudados: cobroFinal.saldoPendiente > 0 ? 1 : 0,
        montoTotalAdeudado: cobroFinal.saldoPendiente
      };
      tx.objectStore('socios').put(socioActualizado);
    } catch (e) {
      console.warn('[Caja] Error guardando en IndexedDB:', e);
    }
  }

  // Actualizar socio en memoria
  cachedSocios = cachedSocios.map((s) => {
    if (s.id === selectedSocio.id) {
      return {
        ...s,
        estadoCuenta: cobroFinal.saldoPendiente > 0 ? 'EN_MORA' : 'AL_DIA',
        mesesAdeudados: cobroFinal.saldoPendiente > 0 ? 1 : 0,
        montoTotalAdeudado: cobroFinal.saldoPendiente
      };
    }
    return s;
  });

  // Limpiar UI del POS
  const inputSearch = document.getElementById('inputBuscarSocioCobro');
  if (inputSearch) inputSearch.value = '';
  document.getElementById('selectSocioCobro').value = '';
  document.getElementById('socioPlanillaEmpty').style.display = 'block';
  document.getElementById('socioPlanillaDetails').style.display = 'none';
  selectedSocio = null;
  currentCalculation = null;

  await updateMetricsAndHistory();
  populateSocioSelect(cachedSocios);

  // Mostrar Recibo Imprimible Pishilata
  showReceiptModal(cobroFinal);

  if (cobroFinal.esAbono) {
    Swal.fire({
      icon: 'info',
      title: '¡Abono Parcial Registrado!',
      html: `Se registró el abono de <strong>$${cobroFinal.montoAbonado.toFixed(2)} USD</strong> para ${cobroFinal.socioNombre}.<br>Saldo restante por cobrar: <strong style="color: #dc2626;">$${cobroFinal.saldoPendiente.toFixed(2)} USD</strong>.`
    });
  } else {
    Swal.fire({
      icon: 'success',
      title: '¡Cobro Exitoso!',
      text: `Se registró el cobro de $${cobroFinal.montoTotal.toFixed(2)} USD para ${cobroFinal.socioNombre}. Fondos distribuidos en Contraloría.`
    });
  }
});

// Modal Recibo Formato Físico Pishilata - Tungurahua
function showReceiptModal(cobro) {
  const modal = document.getElementById('modalReciboPrint');
  if (!modal) return;

  const fechaCobro = new Date(cobro.fechaPago || Date.now());
  const nombresMeses = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre'
  ];
  const mesIndex = fechaCobro.getMonth();
  const mesNombre = nombresMeses[mesIndex];
  const anioStr = String(fechaCobro.getFullYear());
  const anioDigito = anioStr.slice(-1);

  // Cuenta No y Número correlativo
  const cuentaNoEl = document.getElementById('reciboCuentaNo');
  if (cuentaNoEl) {
    cuentaNoEl.textContent =
      cobro.codigoSocio || (cobro.socioCedula ? `SOC-${cobro.socioCedula.slice(-5)}` : 'SOC-00102');
  }

  const numEl = document.getElementById('reciboNumero');
  if (numEl) {
    let numStr = String(cobro.numeroRecibo || '001316');
    if (numStr.startsWith('REC-')) numStr = numStr.replace(/^REC-[\d]+-?/, '');
    numEl.textContent = numStr.padStart(6, '0');
  }

  // Datos del Abonado
  const socioEl = document.getElementById('reciboSocio');
  if (socioEl) socioEl.textContent = (cobro.socioNombre || '').toUpperCase();

  const medidorEl = document.getElementById('reciboMedidor');
  if (medidorEl) medidorEl.textContent = cobro.medidorNumero || 'MED-10492';

  const sectorEl = document.getElementById('reciboSector');
  if (sectorEl) sectorEl.textContent = cobro.socioSector || 'Sector Centro';

  const fechaCanceladoEl = document.getElementById('reciboFechaCancelado');
  if (fechaCanceladoEl) {
    fechaCanceladoEl.textContent = `${fechaCobro.getDate()} de ${mesNombre} del ${anioStr}`;
  }

  const mesCorrEl = document.getElementById('reciboMesCorrespondiente');
  if (mesCorrEl) mesCorrEl.textContent = mesNombre;

  const anioDigitoEl = document.getElementById('reciboAnioDigito');
  if (anioDigitoEl) anioDigitoEl.textContent = anioDigito;

  // Fechas de consumo y vencimiento
  const diaDesdeEl = document.getElementById('reciboDiaDesde');
  if (diaDesdeEl) diaDesdeEl.textContent = '01';
  const mesDesdeEl = document.getElementById('reciboMesDesde');
  if (mesDesdeEl) mesDesdeEl.textContent = mesNombre;
  const diaHastaEl = document.getElementById('reciboDiaHasta');
  if (diaHastaEl) diaHastaEl.textContent = String(new Date(fechaCobro.getFullYear(), fechaCobro.getMonth() + 1, 0).getDate());
  const mesHastaEl = document.getElementById('reciboMesHasta');
  if (mesHastaEl) mesHastaEl.textContent = mesNombre;

  const vencimientoEl = document.getElementById('reciboVencimiento');
  if (vencimientoEl) {
    const fechaVenc = new Date(fechaCobro);
    fechaVenc.setDate(fechaVenc.getDate() + 15);
    vencimientoEl.textContent = `${fechaVenc.getDate()} de ${nombresMeses[fechaVenc.getMonth()]} del ${fechaVenc.getFullYear()}`;
  }

  // Tabla Cuadriculada (5 Bloques)
  const lact = cobro.lecturaActual ?? (cobro.consumoM3 ? 150 + cobro.consumoM3 : 185);
  const lant = cobro.lecturaAnterior ?? 150;
  const consumo = cobro.consumoM3 ?? Math.max(0, lact - lant);
  const basico = 30;
  const excedenteM3 = Math.max(0, consumo - basico);

  const cargoFijo = cobro.cargoBase ?? 7.0;
  const valorExcedente = cobro.valorExcedenteUSD ?? Number((excedenteM3 * 0.1).toFixed(2));
  const totalTarifa = cargoFijo + valorExcedente;
  const otros = (cobro.alcantarilladoUSD || 0) + (cobro.multaExtra || 0);
  const totalMes = totalTarifa + otros;
  const deudaAnterior = cobro.deudaAnteriorCobrada || 0;
  const totalFinal = cobro.montoTotal ?? totalMes + deudaAnterior;

  const tblLact = document.getElementById('reciboTblLact');
  if (tblLact) tblLact.textContent = lact;
  const tblLant = document.getElementById('reciboTblLant');
  if (tblLant) tblLant.textContent = lant;
  const tblConsumo = document.getElementById('reciboTblConsumo');
  if (tblConsumo) tblConsumo.textContent = consumo;
  const tblBasico = document.getElementById('reciboTblBasico');
  if (tblBasico) tblBasico.textContent = basico;
  const tblExcedenteM3 = document.getElementById('reciboTblExcedenteM3');
  if (tblExcedenteM3) tblExcedenteM3.textContent = excedenteM3;
  const tblCargoFijo = document.getElementById('reciboTblCargoFijo');
  if (tblCargoFijo) tblCargoFijo.textContent = `$${cargoFijo.toFixed(2)}`;
  const tblValorExcedente = document.getElementById('reciboTblValorExcedente');
  if (tblValorExcedente) tblValorExcedente.textContent = `$${valorExcedente.toFixed(2)}`;
  const tblTotalTarifa = document.getElementById('reciboTblTotalTarifa');
  if (tblTotalTarifa) tblTotalTarifa.textContent = `$${totalTarifa.toFixed(2)}`;
  const tblOtros = document.getElementById('reciboTblOtros');
  if (tblOtros) tblOtros.textContent = `$${otros.toFixed(2)}`;
  const tblTotalMes = document.getElementById('reciboTblTotalMes');
  if (tblTotalMes) tblTotalMes.textContent = `$${totalMes.toFixed(2)}`;
  const tblDeudaAnterior = document.getElementById('reciboTblDeudaAnterior');
  if (tblDeudaAnterior) tblDeudaAnterior.textContent = `$${deudaAnterior.toFixed(2)}`;
  const tblDeudaTotal = document.getElementById('reciboTblDeudaTotal');
  if (tblDeudaTotal) tblDeudaTotal.textContent = `$${totalFinal.toFixed(2)}`;

  // Total e info cajero
  const totalFinalEl = document.getElementById('reciboTotalFinal');
  if (totalFinalEl) totalFinalEl.textContent = `$${totalFinal.toFixed(2)}`;

  // Mostrar detalle de abono si aplica
  const abonoInfoEl = document.getElementById('reciboAbonoInfo');
  const abonoMontoEl = document.getElementById('reciboMontoAbonado');
  const saldoPendEl = document.getElementById('reciboSaldoPendiente');
  const stampTextEl = document.getElementById('reciboStampText');

  const esAbono = (cobro.saldoPendiente !== undefined && cobro.saldoPendiente > 0) || cobro.esAbono;
  if (esAbono && abonoInfoEl) {
    abonoInfoEl.style.display = 'block';
    if (abonoMontoEl) abonoMontoEl.textContent = `$${(cobro.montoAbonado || cobro.montoRecibido || 0).toFixed(2)}`;
    if (saldoPendEl) saldoPendEl.textContent = `$${cobro.saldoPendiente.toFixed(2)}`;
    if (stampTextEl) stampTextEl.textContent = 'ABONO REGISTRADO';
  } else {
    if (abonoInfoEl) abonoInfoEl.style.display = 'none';
    if (stampTextEl) stampTextEl.textContent = 'CANCELADO';
  }

  const cajeroEl = document.getElementById('reciboCajeroTxt');
  if (cajeroEl) {
    cajeroEl.textContent =
      currentUser?.nombre_completo || currentUser?.nombre || 'Gladys Guamán (Tesorera)';
  }

  const metodoEl = document.getElementById('reciboMetodoTxt');
  if (metodoEl) metodoEl.textContent = cobro.metodoPago || 'EFECTIVO';

  const stampFechaEl = document.getElementById('reciboStampFecha');
  if (stampFechaEl) {
    stampFechaEl.textContent = `${fechaCobro.getDate()}-${mesNombre.slice(0, 3).toUpperCase()}-${anioStr}`;
  }

  // Botón de eliminación exclusivo de ADMIN en el modal
  const btnDelModal = document.getElementById('btnDeleteFacturaModal');
  if (btnDelModal) {
    if (currentUser?.rol === 'ADMIN') {
      btnDelModal.style.display = 'inline-flex';
      btnDelModal.onclick = () => confirmDeleteFactura(cobro);
    } else {
      btnDelModal.style.display = 'none';
      btnDelModal.onclick = null;
    }
  }

  modal.style.display = 'flex';
}

async function confirmDeleteFactura(cobro) {
  if (currentUser?.rol !== 'ADMIN') {
    Swal.fire({
      icon: 'error',
      title: 'Acceso Denegado',
      text: 'Solo los usuarios con rol Administrador (ADMIN) pueden eliminar o anular facturas.'
    });
    return;
  }

  const confirm = await Swal.fire({
    icon: 'warning',
    title: `¿Eliminar Factura #${cobro.numeroRecibo}?`,
    html: `
      <div style="text-align: left; font-size: 0.92rem; color: #334155; line-height: 1.5;">
        <p style="margin-bottom: 0.6rem;">Esta acción eliminará el comprobante <strong>#${cobro.numeroRecibo}</strong> de <strong>${cobro.socioNombre}</strong> por <strong>$${cobro.montoTotal.toFixed(2)} USD</strong> y realizará las siguientes reversiones automáticas:</p>
        <ul style="padding-left: 1.2rem; margin-bottom: 0.8rem;">
          <li><strong>Reversión Contable:</strong> Se cancelarán todos los asientos en el Libro Mayor (3 Columnas), restaurando los fondos de <em>Operación</em>, <em>Parroquia</em>, <em>Lector</em>, <em>Mortuorio</em>, etc.</li>
          <li><strong>Restablecimiento de Deuda:</strong> El socio volverá a su estado en mora con su saldo pendiente por pagar.</li>
          <li><strong>Multas:</strong> Las multas cobradas volverán a estar impagas en el sistema.</li>
        </ul>
        <p style="color: #b91c1c; font-weight: 700; margin: 0;">⚠️ Esta acción es irreversible.</p>
      </div>
    `,
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    cancelButtonColor: '#64748b',
    confirmButtonText: '🗑️ Sí, Eliminar y Revertir Fondos',
    cancelButtonText: 'Cancelar'
  });

  if (!confirm.isConfirmed) return;

  Swal.fire({
    title: 'Revirtiendo y eliminando factura...',
    text: 'Ajustando libro mayor y cuentas de socios...',
    allowOutsideClick: false,
    didOpen: () => {
      Swal.showLoading();
    }
  });

  try {
    // 1. Llamar al endpoint backend DELETE /api/v1/facturas/:id
    const res = await apiFetch(`/api/v1/facturas/${cobro.id}`, {
      method: 'DELETE'
    });

    // 2. Eliminar de IndexedDB local si existe
    if (db) {
      try {
        const tx = db.transaction(['cobros'], 'readwrite');
        tx.objectStore('cobros').delete(cobro.id);
      } catch (e) {
        console.warn('[Caja] Error borrando de IndexedDB:', e);
      }
    }

    // 3. Cerrar modal de recibo si estaba abierto
    const modalRecibo = document.getElementById('modalReciboPrint');
    if (modalRecibo) modalRecibo.style.display = 'none';

    // 4. Refrescar datos en vivo de la vista de caja
    await renderCajaUI();

    Swal.fire({
      icon: 'success',
      title: '¡Factura Eliminada y Fondos Revertidos!',
      text: res.message || `La factura #${cobro.numeroRecibo} fue eliminada y los balances contables fueron restaurados exitosamente.`
    });
  } catch (err) {
    console.error('[Caja] Error eliminando factura:', err);
    Swal.fire({
      icon: 'error',
      title: 'Error al Eliminar Factura',
      text: err.message || 'No se pudo eliminar la factura en el servidor.'
    });
  }
}

document.getElementById('btnCloseReciboModal')?.addEventListener('click', () => {
  const m = document.getElementById('modalReciboPrint');
  if (m) m.style.display = 'none';
});

document.getElementById('btnDoneRecibo')?.addEventListener('click', () => {
  const m = document.getElementById('modalReciboPrint');
  if (m) m.style.display = 'none';
});

document.getElementById('btnPrintReciboBtn')?.addEventListener('click', () => {
  window.print();
});

// Modal Gasto / Egreso
const modalGasto = document.getElementById('modalGasto');
document.getElementById('btnOpenGastoModal')?.addEventListener('click', () => {
  modalGasto.style.display = 'flex';
});

document.getElementById('btnCloseGastoModal')?.addEventListener('click', () => {
  modalGasto.style.display = 'none';
});

document.getElementById('btnCancelGasto')?.addEventListener('click', () => {
  modalGasto.style.display = 'none';
});

document.getElementById('formGasto')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const selectCat = document.getElementById('selectCategoriaGasto');
  const categoria = selectCat ? selectCat.value : 'OTROS';
  const inputMonto = document.getElementById('inputMontoGasto');
  const monto = parseFloat(inputMonto?.value || '0');
  const inputDesc = document.getElementById('inputDescGasto');
  const descripcion = inputDesc ? inputDesc.value.trim() : '';
  const inputComp = document.getElementById('inputComprobanteGasto');
  const comprobante = inputComp ? inputComp.value.trim() : '';

  if (isNaN(monto) || monto <= 0 || !descripcion) {
    Swal.fire({ icon: 'warning', title: 'Datos Incompletos', text: 'Ingrese un monto y detalle válidos.' });
    return;
  }

  try {
    // Registrar Egreso en el Backend API (Libro Mayor 3 Columnas)
    await apiFetch('/api/v1/fondos/egresos', {
      method: 'POST',
      body: JSON.stringify({
        idFondo: 'fondo-operacion',
        monto,
        descripcion,
        comprobanteSoporte: comprobante || undefined,
        beneficiario: 'Proveedor General'
      })
    });
  } catch (err) {
    console.warn('[Caja] Error registrando egreso en backend:', err.message);
  }

  modalGasto.style.display = 'none';
  const formGasto = document.getElementById('formGasto');
  if (formGasto) formGasto.reset();

  await updateMetricsAndHistory();

  Swal.fire({
    icon: 'success',
    title: 'Egreso Registrado',
    text: `Se registró la salida de $${monto.toFixed(2)} USD correctamente en el Libro Mayor.`
  });
});

function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return 0;
  const hoy = new Date();
  const nac = new Date(fechaNacimiento);
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) {
    edad--;
  }
  return edad;
}

// Inicializar
initIndexedDB().then(renderCajaUI);
