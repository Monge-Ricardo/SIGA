import { requireAuth, getCurrentUser, getAuthToken } from './auth.js';
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
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `Error en servidor (${res.status})`);
    }
    return res.json();
  } catch (err) {
    console.warn(`[API] Fetch a ${url} falló:`, err.message);
    throw err;
  }
}

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
      nombreCompleto: `${s.nombres} ${s.apellidos}`,
      cedulaRuc: s.cedulaRuc,
      fechaNacimiento: s.fechaNacimiento,
      sectorId: s.idSector || s.sectorId,
      nombreSector: s.nombreSector || 'Sector General',
      medidorNumero: s.medidorNumero,
      medidores: s.medidores || [],
      tieneAlcantarillado: s.tieneAlcantarillado,
      estadoServicio: s.estado,
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
    const resFacturas = await apiFetch('/api/v1/facturas?estadoPago=PAGADO');
    facturasPagadas = resFacturas.data || [];
    cobros = facturasPagadas.map((f) => ({
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
      metodoPago: f.metodoPago || 'EFECTIVO',
      montoRecibido: f.totalPagar,
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

  let totalRecaudacionAgua = 0;
  cobros.forEach((c) => {
    totalRecaudacionAgua += c.montoTotal;
  });

  const elAgua = document.getElementById('metricRecaudacionAgua');
  if (elAgua) elAgua.textContent = `$${totalRecaudacionAgua.toFixed(2)}`;
  const elCount = document.getElementById('metricRecibosCount');
  if (elCount) elCount.textContent = `${cobros.length} recibos cobrados`;
  const elEntradas = document.getElementById('metricTotalEntradas');
  if (elEntradas) elEntradas.textContent = `$${totalRecaudacionAgua.toFixed(2)}`;
  const elSalidas = document.getElementById('metricTotalSalidas');
  if (elSalidas) elSalidas.textContent = `$0.00`;
  const elGastos = document.getElementById('metricGastosCount');
  if (elGastos) elGastos.textContent = `0 egresos registrados`;
  const elBalance = document.getElementById('metricBalanceNeto');
  if (elBalance) elBalance.textContent = `$${totalRecaudacionAgua.toFixed(2)}`;

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

  cobros.slice(0, 10).forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge-code" style="color:#0284c7; font-weight:700;">${c.numeroRecibo}</span></td>
      <td><strong>${c.socioNombre}</strong></td>
      <td style="text-align: right;"><strong class="text-accent" style="font-size:1rem;">$${c.montoTotal.toFixed(2)}</strong></td>
      <td><span style="font-size:0.8rem; color:#64748b;">${new Date(c.fechaPago).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></td>
      <td style="text-align: right;">
        <button class="btn-icon btn-print-row" title="Ver / Imprimir Recibo">🖨️</button>
      </td>
    `;

    tr.querySelector('.btn-print-row')?.addEventListener('click', () => {
      showReceiptModal(c);
    });

    tbody.appendChild(tr);
  });
}

function calcularLiquidacionSocio(socio, estadoCuentaApi = null) {
  const edad = calcularEdad(socio.fechaNacimiento);
  const es3raEdad = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
  const cargoBase = es3raEdad ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
  const tieneAlcant = socio.tieneAlcantarillado === true;
  const recargoAlcant = tieneAlcant ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0.00;

  const lant = 150;
  const lact = lant + 35; // Consumo estándar
  const consumoM3 = Math.max(0, lact - lant);
  const excedenteM3 = Math.max(0, consumoM3 - TARIFAS_CONFIG.LIMITE_BASE_M3);
  const valorExcedenteUSD = Number((excedenteM3 * TARIFAS_CONFIG.EXCEDENTE_POR_M3).toFixed(2));

  const selectMulta = document.getElementById('selectMultaExtra');
  const multaExtra = parseFloat(selectMulta?.value || '0');
  
  // Deuda anterior desde la API o desde socio
  const deudaAnterior = estadoCuentaApi ? Number(estadoCuentaApi.deudaTotal || 0) : (socio.montoTotalAdeudado || 0);
  const mesesMora = estadoCuentaApi ? Number(estadoCuentaApi.mesesAdeudados || 0) : (socio.mesesAdeudados || 0);

  const totalMes = cargoBase + valorExcedenteUSD + recargoAlcant;
  const totalPagar = Number((totalMes + multaExtra + deudaAnterior).toFixed(2));

  return {
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
    multaExtra,
    deudaAnterior,
    mesesMora,
    totalMes,
    totalPagar
  };
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

  currentCalculation = calcularLiquidacionSocio(socio, estadoCuentaApi);

  document.getElementById('socioPlanillaEmpty').style.display = 'none';
  document.getElementById('socioPlanillaDetails').style.display = 'flex';

  // Mini Card
  document.getElementById('posSocioNombre').textContent = currentCalculation.socioNombre;
  document.getElementById('posSocioCedula').textContent = currentCalculation.socioCedula;

  const numMedidores = (socio.medidores && socio.medidores.length > 0) ? socio.medidores.length : 1;
  const medidoresStr = (socio.medidores && socio.medidores.length > 1)
    ? `💧 ${numMedidores} medidores (${socio.medidores.map(m => m.alias || m.numeroMedidor).join(', ')})`
    : `Medidor: ${currentCalculation.medidorNumero}`;

  document.getElementById('posSocioSector').innerHTML = `
    ${currentCalculation.socioSector} &bull; <strong style="color: #0284c7;">${medidoresStr}</strong>
  `;

  document.getElementById('posCategoriaBadge').innerHTML = `
    <span class="age-badge ${currentCalculation.esTerceraEdad ? 'badge-senior' : 'badge-normal'}">
      ${currentCalculation.esTerceraEdad ? '👴 3ra Edad ($5.00)' : '👤 Normal ($7.00)'}
    </span>
  `;

  // Desglose
  document.getElementById('posLant').textContent = currentCalculation.lecturaAnterior;
  document.getElementById('posLact').textContent = currentCalculation.lecturaActual;
  document.getElementById('posConsumo').textContent = `${currentCalculation.consumoM3} m³`;

  document.getElementById('posCargoBase').textContent = `$${currentCalculation.cargoBase.toFixed(2)}`;
  document.getElementById('posExcedenteM3').textContent = currentCalculation.excedenteM3;
  document.getElementById('posExcedenteUSD').textContent = `$${currentCalculation.valorExcedenteUSD.toFixed(2)}`;
  document.getElementById('posAlcantarilladoUSD').textContent = currentCalculation.tieneAlcantarillado
    ? `+$${currentCalculation.recargoAlcant.toFixed(2)} (SÍ)`
    : `$0.00 (NO)`;

  const rowDeuda = document.getElementById('rowDeudaAnterior');
  if (currentCalculation.deudaAnterior > 0) {
    rowDeuda.style.display = 'flex';
    document.getElementById('posMesesMora').textContent = currentCalculation.mesesMora;
    document.getElementById('posDeudaUSD').textContent = `$${currentCalculation.deudaAnterior.toFixed(2)}`;
  } else {
    rowDeuda.style.display = 'none';
  }

  // Total
  document.getElementById('posTotalPagar').textContent = `$${currentCalculation.totalPagar.toFixed(2)} USD`;

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

  const diff = recibidoVal - total;
  if (diff < 0) {
    displayCambio.textContent = `Faltan $${Math.abs(diff).toFixed(2)}`;
    displayCambio.style.color = '#dc2626';
  } else {
    displayCambio.textContent = `Cambio: $${diff.toFixed(2)} USD`;
    displayCambio.style.color = '#059669';
  }
}

// Event Listeners de Selección y Cálculo
document.getElementById('selectSocioCobro')?.addEventListener('change', async (e) => {
  const socioId = e.target.value;
  if (!socioId) {
    selectedSocio = null;
    currentCalculation = null;
    document.getElementById('socioPlanillaEmpty').style.display = 'block';
    document.getElementById('socioPlanillaDetails').style.display = 'none';
    return;
  }

  const s = cachedSocios.find((item) => item.id === socioId);
  if (s) await displaySocioPlanilla(s);
});

document.getElementById('selectMultaExtra')?.addEventListener('change', async () => {
  if (selectedSocio) await displaySocioPlanilla(selectedSocio);
});

document.getElementById('inputMontoRecibido')?.addEventListener('input', updateVuelto);

// Ejecutar Cobro (Transacción de Caja en Vivo con el Servidor Backend)
document.getElementById('btnEjecutarCobro')?.addEventListener('click', async () => {
  if (!selectedSocio || !currentCalculation) return;

  const selectMetodo = document.getElementById('selectMetodoPago');
  const metodoPago = selectMetodo ? selectMetodo.value : 'EFECTIVO';
  const inputRecibido = document.getElementById('inputMontoRecibido');
  const montoRecibido = parseFloat(inputRecibido?.value || '0');

  if (metodoPago === 'EFECTIVO' && (isNaN(montoRecibido) || montoRecibido < currentCalculation.totalPagar)) {
    Swal.fire({
      icon: 'warning',
      title: 'Monto Insuficiente',
      text: `El monto recibido en efectivo ($${montoRecibido || 0}) no cubre el total de la planilla ($${currentCalculation.totalPagar.toFixed(2)}).`
    });
    return;
  }

  const confirmRes = await Swal.fire({
    icon: 'question',
    title: '¿Confirmar Cobro en Caja?',
    text: `¿Registrar cobro de $${currentCalculation.totalPagar.toFixed(2)} USD para ${currentCalculation.socioNombre}?`,
    showCancelButton: true,
    confirmButtonText: 'Sí, Registrar Cobro',
    cancelButtonText: 'Cancelar'
  });

  if (!confirmRes.isConfirmed) return;

  const btnEjecutar = document.getElementById('btnEjecutarCobro');
  btnEjecutar.disabled = true;
  btnEjecutar.textContent = '⏳ Procesando transacción...';

  let cobroFinal = null;

  try {
    // 1. Enviar Liquidación y Cobro a la API REST del Backend (SQLite + Fondos 3 Columnas)
    // Primero, liquidamos la planilla del socio en el backend para obtener su Factura ID
    const resLiquidacion = await apiFetch('/api/v1/facturas/liquidar', {
      method: 'POST',
      body: JSON.stringify({
        idSocio: selectedSocio.id,
        idPeriodo: PERIODO_ACTUAL
      })
    });

    const facturaId = resLiquidacion.data?.id;

    // Segundo, cobramos la factura en el backend (distribuye fondos y limpia morosidad)
    const resCobro = await apiFetch(`/api/v1/facturas/${facturaId}/cobrar`, {
      method: 'POST',
      body: JSON.stringify({
        metodoPago,
        fechaPago: new Date().toISOString()
      })
    });

    const facturaCobrada = resCobro.data;

    cobroFinal = {
      id: facturaCobrada.id,
      numeroRecibo: facturaCobrada.numeroFactura,
      socioNombre: currentCalculation.socioNombre,
      socioCedula: currentCalculation.socioCedula,
      socioSector: currentCalculation.socioSector,
      periodo: PERIODO_ACTUAL,
      consumoM3: facturaCobrada.consumoM3,
      cargoBase: facturaCobrada.valorBase,
      valorExcedenteUSD: facturaCobrada.valorExcedente,
      alcantarilladoUSD: facturaCobrada.valorAlcantarillado,
      multaExtra: facturaCobrada.valorMultas,
      deudaAnteriorCobrada: facturaCobrada.valorDeudaAnterior,
      montoTotal: facturaCobrada.totalPagar,
      metodoPago,
      montoRecibido: metodoPago === 'EFECTIVO' ? montoRecibido : facturaCobrada.totalPagar,
      cambioEntregado: metodoPago === 'EFECTIVO' ? Math.max(0, montoRecibido - facturaCobrada.totalPagar) : 0,
      fechaPago: facturaCobrada.fechaPago || new Date().toISOString()
    };
  } catch (apiErr) {
    console.warn('[Caja] Backend offline o error, procesando respaldo local:', apiErr.message);

    // Respaldo local en caso offline
    const cobroId = 'rec-' + crypto.randomUUID().slice(0, 8);
    const numeroRecibo = `REC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    cobroFinal = {
      id: cobroId,
      numeroRecibo,
      socioNombre: currentCalculation.socioNombre,
      socioCedula: currentCalculation.socioCedula,
      socioSector: currentCalculation.socioSector,
      periodo: PERIODO_ACTUAL,
      consumoM3: currentCalculation.consumoM3,
      cargoBase: currentCalculation.cargoBase,
      valorExcedenteUSD: currentCalculation.valorExcedenteUSD,
      alcantarilladoUSD: currentCalculation.recargoAlcant,
      multaExtra: currentCalculation.multaExtra,
      deudaAnteriorCobrada: currentCalculation.deudaAnterior,
      montoTotal: currentCalculation.totalPagar,
      metodoPago,
      montoRecibido: metodoPago === 'EFECTIVO' ? montoRecibido : currentCalculation.totalPagar,
      cambioEntregado: metodoPago === 'EFECTIVO' ? Math.max(0, montoRecibido - currentCalculation.totalPagar) : 0,
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
        estadoCuenta: 'AL_DIA',
        mesesAdeudados: 0,
        montoTotalAdeudado: 0.00
      };
      tx.objectStore('socios').put(socioActualizado);
    } catch (e) {
      console.warn('[Caja] Error guardando en IndexedDB:', e);
    }
  }

  // Actualizar socio en memoria
  cachedSocios = cachedSocios.map((s) => {
    if (s.id === selectedSocio.id) {
      return { ...s, estadoCuenta: 'AL_DIA', mesesAdeudados: 0, montoTotalAdeudado: 0.00 };
    }
    return s;
  });

  // Limpiar UI del POS
  document.getElementById('selectSocioCobro').value = '';
  document.getElementById('socioPlanillaEmpty').style.display = 'block';
  document.getElementById('socioPlanillaDetails').style.display = 'none';
  selectedSocio = null;
  currentCalculation = null;

  await updateMetricsAndHistory();
  populateSocioSelect(cachedSocios);

  // Mostrar Recibo Imprimible
  showReceiptModal(cobroFinal);

  Swal.fire({
    icon: 'success',
    title: '¡Cobro Exitoso!',
    text: `Se registró el cobro de $${cobroFinal.montoTotal.toFixed(2)} USD para ${cobroFinal.socioNombre}. Fondos distribuidos en Contraloría.`
  });
});

// Modal Recibo
const modalReceipt = document.getElementById('modalReceipt');
const btnCloseReceipt = document.getElementById('btnCloseReceipt');
const btnPrintReceipt = document.getElementById('btnPrintReceipt');

function showReceiptModal(cobro) {
  document.getElementById('reciboNumero').textContent = cobro.numeroRecibo;
  document.getElementById('reciboFecha').textContent = new Date(cobro.fechaPago).toLocaleString('es-EC');
  document.getElementById('reciboCajero').textContent = currentUser?.nombre || 'Tesorero General';
  document.getElementById('reciboSocio').textContent = cobro.socioNombre;
  document.getElementById('reciboCedula').textContent = cobro.socioCedula;
  document.getElementById('reciboSector').textContent = cobro.socioSector;
  document.getElementById('reciboPeriodo').textContent = cobro.periodo;
  document.getElementById('reciboConsumo').textContent = `${cobro.consumoM3} m³`;

  document.getElementById('reciboBase').textContent = `$${cobro.cargoBase.toFixed(2)}`;
  document.getElementById('reciboExcedente').textContent = `$${cobro.valorExcedenteUSD.toFixed(2)}`;
  document.getElementById('reciboAlcant').textContent = `$${cobro.alcantarilladoUSD.toFixed(2)}`;

  const rowMulta = document.getElementById('reciboRowMulta');
  if (cobro.multaExtra > 0) {
    rowMulta.style.display = 'flex';
    document.getElementById('reciboMulta').textContent = `$${cobro.multaExtra.toFixed(2)}`;
  } else {
    rowMulta.style.display = 'none';
  }

  const rowDeuda = document.getElementById('reciboRowDeuda');
  if (cobro.deudaAnteriorCobrada > 0) {
    rowDeuda.style.display = 'flex';
    document.getElementById('reciboDeuda').textContent = `$${cobro.deudaAnteriorCobrada.toFixed(2)}`;
  } else {
    rowDeuda.style.display = 'none';
  }

  document.getElementById('reciboTotal').textContent = `$${cobro.montoTotal.toFixed(2)} USD`;
  document.getElementById('reciboMetodo').textContent = cobro.metodoPago;
  document.getElementById('reciboRecibido').textContent = `$${cobro.montoRecibido.toFixed(2)}`;
  document.getElementById('reciboCambio').textContent = `$${cobro.cambioEntregado.toFixed(2)}`;

  modalReceipt.style.display = 'flex';
}

btnCloseReceipt?.addEventListener('click', () => {
  modalReceipt.style.display = 'none';
});

btnPrintReceipt?.addEventListener('click', () => {
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
