import { requireAuth, getCurrentUser } from './auth.js';
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

async function getLecturasPeriodo(periodo) {
  return new Promise((resolve) => {
    const tx = db.transaction(['lecturas'], 'readonly');
    const req = tx.objectStore('lecturas').getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      resolve(all.filter((l) => l.periodo === periodo));
    };
    req.onerror = () => resolve([]);
  });
}

async function getAllCobros() {
  return new Promise((resolve) => {
    const tx = db.transaction(['cobros'], 'readonly');
    const req = tx.objectStore('cobros').getAll();
    req.onsuccess = () => resolve((req.result || []).reverse());
    req.onerror = () => resolve([]);
  });
}

async function getAllMovimientosCaja() {
  return new Promise((resolve) => {
    const tx = db.transaction(['movimientos_caja'], 'readonly');
    const req = tx.objectStore('movimientos_caja').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function saveCobroTransaction(cobroRecord, socioActualizado, movimientoCaja) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cobros', 'socios', 'movimientos_caja', 'sync_queue'], 'readwrite');
    tx.objectStore('cobros').add(cobroRecord);
    tx.objectStore('socios').put(socioActualizado);
    tx.objectStore('movimientos_caja').add(movimientoCaja);

    const queueStore = tx.objectStore('sync_queue');
    queueStore.add({
      id: 'mut-' + crypto.randomUUID().slice(0, 8),
      entity: 'cobros',
      entityId: cobroRecord.id,
      action: 'CREATE',
      payload: cobroRecord,
      localTimestamp: new Date().toLocaleTimeString(),
      status: 'SYNCED'
    });

    tx.oncomplete = () => {
      const latency = (performance.now() - start).toFixed(1);
      const el = document.querySelector('#perfMeter span');
      if (el) el.textContent = `${latency} ms`;
      resolve(cobroRecord);
    };

    tx.onerror = (e) => reject(e.target.error);
  });
}

async function saveGastoLocal(gastoRecord) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['movimientos_caja', 'sync_queue'], 'readwrite');
    tx.objectStore('movimientos_caja').add(gastoRecord);
    tx.objectStore('sync_queue').add({
      id: 'mut-' + crypto.randomUUID().slice(0, 8),
      entity: 'movimientos_caja',
      entityId: gastoRecord.id,
      action: 'CREATE',
      payload: gastoRecord,
      localTimestamp: new Date().toLocaleTimeString(),
      status: 'SYNCED'
    });
    tx.oncomplete = () => resolve(gastoRecord);
    tx.onerror = (e) => reject(e.target.error);
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

  cachedSocios = await getAllSocios();
  cachedLecturas = await getLecturasPeriodo(PERIODO_ACTUAL);

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
    opt.textContent = `${s.nombreCompleto} (${s.cedulaRuc}) • ${s.nombreSector || s.sectorId} ${isMora ? '⚠️ [EN MORA]' : '✅ [AL DÍA]'}`;
    select.appendChild(opt);
  });
}

async function updateMetricsAndHistory() {
  const cobros = await getAllCobros();
  const movimientos = await getAllMovimientosCaja();

  let totalRecaudacionAgua = 0;
  let totalEntradas = 0;
  let totalSalidas = 0;
  let gastosCount = 0;

  movimientos.forEach((m) => {
    if (m.tipo === 'ENTRADA') {
      totalEntradas += m.monto;
      if (m.categoria === 'COBRO_AGUA') {
        totalRecaudacionAgua += m.monto;
      }
    } else if (m.tipo === 'SALIDA') {
      totalSalidas += m.monto;
      gastosCount++;
    }
  });

  const balanceNeto = totalEntradas - totalSalidas;

  const elAgua = document.getElementById('metricRecaudacionAgua');
  if (elAgua) elAgua.textContent = `$${totalRecaudacionAgua.toFixed(2)}`;
  const elCount = document.getElementById('metricRecibosCount');
  if (elCount) elCount.textContent = `${cobros.length} recibos cobrados`;
  const elEntradas = document.getElementById('metricTotalEntradas');
  if (elEntradas) elEntradas.textContent = `$${totalEntradas.toFixed(2)}`;
  const elSalidas = document.getElementById('metricTotalSalidas');
  if (elSalidas) elSalidas.textContent = `$${totalSalidas.toFixed(2)}`;
  const elGastos = document.getElementById('metricGastosCount');
  if (elGastos) elGastos.textContent = `${gastosCount} egresos registrados`;
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

function calcularLiquidacionSocio(socio) {
  const edad = calcularEdad(socio.fechaNacimiento);
  const es3raEdad = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
  const cargoBase = es3raEdad ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
  const tieneAlcant = socio.tieneAlcantarillado === true;
  const recargoAlcant = tieneAlcant ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0.00;

  // Buscar lectura del mes actual
  const lectura = cachedLecturas.find((l) => l.clienteId === socio.id);
  const lant = lectura?.lecturaAnterior ?? 150;
  const lact = lectura?.lecturaActual ?? (lant + 45); // Si no se ha tomado lectura, estimar 45m3 para el caso demo
  const consumoM3 = Math.max(0, lact - lant);
  const excedenteM3 = Math.max(0, consumoM3 - TARIFAS_CONFIG.LIMITE_BASE_M3);
  const valorExcedenteUSD = Number((excedenteM3 * TARIFAS_CONFIG.EXCEDENTE_POR_M3).toFixed(2));

  const selectMulta = document.getElementById('selectMultaExtra');
  const multaExtra = parseFloat(selectMulta?.value || '0');
  const deudaAnterior = socio.montoTotalAdeudado || 0;

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
    mesesMora: socio.mesesAdeudados || 0,
    totalMes,
    totalPagar
  };
}

function displaySocioPlanilla(socio) {
  selectedSocio = socio;
  currentCalculation = calcularLiquidacionSocio(socio);

  document.getElementById('socioPlanillaEmpty').style.display = 'none';
  document.getElementById('socioPlanillaDetails').style.display = 'flex';

  // Mini Card
  document.getElementById('posSocioNombre').textContent = currentCalculation.socioNombre;
  document.getElementById('posSocioCedula').textContent = currentCalculation.socioCedula;
  document.getElementById('posSocioSector').textContent = currentCalculation.socioSector;

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
document.getElementById('selectSocioCobro')?.addEventListener('change', (e) => {
  const socioId = e.target.value;
  if (!socioId) {
    selectedSocio = null;
    currentCalculation = null;
    document.getElementById('socioPlanillaEmpty').style.display = 'block';
    document.getElementById('socioPlanillaDetails').style.display = 'none';
    return;
  }

  const s = cachedSocios.find((item) => item.id === socioId);
  if (s) displaySocioPlanilla(s);
});

document.getElementById('selectMultaExtra')?.addEventListener('change', () => {
  if (selectedSocio) displaySocioPlanilla(selectedSocio);
});

document.getElementById('inputMontoRecibido')?.addEventListener('input', updateVuelto);

// Ejecutar Cobro
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

  const cobroId = 'rec-' + crypto.randomUUID().slice(0, 8);
  const numeroRecibo = `REC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const cobroRecord = {
    id: cobroId,
    numeroRecibo,
    socioId: currentCalculation.socioId,
    socioNombre: currentCalculation.socioNombre,
    socioCedula: currentCalculation.socioCedula,
    socioSector: currentCalculation.socioSector,
    periodo: PERIODO_ACTUAL,
    consumoM3: currentCalculation.consumoM3,
    cargoBase: currentCalculation.cargoBase,
    excedenteM3: currentCalculation.excedenteM3,
    valorExcedenteUSD: currentCalculation.valorExcedenteUSD,
    alcantarilladoUSD: currentCalculation.recargoAlcant,
    multaExtra: currentCalculation.multaExtra,
    deudaAnteriorCobrada: currentCalculation.deudaAnterior,
    montoTotal: currentCalculation.totalPagar,
    metodoPago,
    montoRecibido: metodoPago === 'EFECTIVO' ? montoRecibido : currentCalculation.totalPagar,
    cambioEntregado: metodoPago === 'EFECTIVO' ? Math.max(0, montoRecibido - currentCalculation.totalPagar) : 0,
    fechaPago: new Date().toISOString(),
    cajeroId: currentUser?.id || 'usr-cajero'
  };

  const socioActualizado = {
    ...selectedSocio,
    estadoCuenta: 'AL_DIA',
    mesesAdeudados: 0,
    montoTotalAdeudado: 0.00,
    fechaDeudaAntigua: null,
    updatedAt: new Date().toISOString()
  };

  const movimientoCaja = {
    id: 'mov-' + crypto.randomUUID().slice(0, 8),
    tipo: 'ENTRADA',
    categoria: 'COBRO_AGUA',
    monto: currentCalculation.totalPagar,
    descripcion: `Cobro planilla agua potable ${PERIODO_ACTUAL} - Socio: ${currentCalculation.socioNombre} (${numeroRecibo})`,
    reciboId: cobroId,
    fecha: new Date().toISOString(),
    responsableId: currentUser?.id || 'usr-cajero'
  };

  await saveCobroTransaction(cobroRecord, socioActualizado, movimientoCaja);

  // Actualizar cache local
  cachedSocios = cachedSocios.map((s) => (s.id === socioActualizado.id ? socioActualizado : s));

  // Limpiar UI
  document.getElementById('selectSocioCobro').value = '';
  document.getElementById('socioPlanillaEmpty').style.display = 'block';
  document.getElementById('socioPlanillaDetails').style.display = 'none';
  selectedSocio = null;
  currentCalculation = null;

  await updateMetricsAndHistory();
  populateSocioSelect(cachedSocios);

  // Mostrar Recibo Imprimible
  showReceiptModal(cobroRecord);
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

  const gastoRecord = {
    id: 'gasto-' + crypto.randomUUID().slice(0, 8),
    tipo: 'SALIDA',
    categoria,
    monto,
    descripcion,
    comprobanteNumero: comprobante || undefined,
    fecha: new Date().toISOString(),
    responsableId: currentUser?.id || 'usr-cajero'
  };

  await saveGastoLocal(gastoRecord);
  modalGasto.style.display = 'none';
  const formGasto = document.getElementById('formGasto');
  if (formGasto) formGasto.reset();

  await updateMetricsAndHistory();

  Swal.fire({
    icon: 'success',
    title: 'Egreso Registrado',
    text: `Se registró la salida de $${monto.toFixed(2)} USD correctamente.`
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
