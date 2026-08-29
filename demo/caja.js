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
    req.onsuccess = () => resolve(req.result.reverse());
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
  document.getElementById('fechaHoyBadge').textContent = new Date().toLocaleDateString('es-EC', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  cachedSocios = await getAllSocios();
  cachedLecturas = await getLecturasPeriodo(PERIODO_ACTUAL);

  populateSocioSelect(cachedSocios);
  await updateMetricsAndHistory();
}

function populateSocioSelect(socios) {
  const select = document.getElementById('selectSocioCobro');
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

  document.getElementById('metricRecaudacionAgua').textContent = `$${totalRecaudacionAgua.toFixed(2)}`;
  document.getElementById('metricRecibosCount').textContent = `${cobros.length} recibos cobrados`;
  document.getElementById('metricTotalEntradas').textContent = `$${totalEntradas.toFixed(2)}`;
  document.getElementById('metricTotalSalidas').textContent = `$${totalSalidas.toFixed(2)}`;
  document.getElementById('metricGastosCount').textContent = `${gastosCount} egresos registrados`;
  document.getElementById('metricBalanceNeto').textContent = `$${balanceNeto.toFixed(2)}`;

  renderRecibosTable(cobros);
}

function renderRecibosTable(cobros) {
  const tbody = document.getElementById('recibosTableBody');
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
  const es3raEdad = socio.esTerceraEdad;
  const cargoBase = es3raEdad ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
  const tieneAlcant = socio.tieneAlcantarillado;
  const recargoAlcant = tieneAlcant ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0;

  // Buscar lectura del mes actual
  const lectura = cachedLecturas.find((l) => l.clienteId === socio.id);
  const lant = lectura?.lecturaAnterior ?? 150;
  const lact = lectura?.lecturaActual ?? (lant + 45); // Si no se ha tomado lectura, estimar 45m3 para el caso demo
  const consumoM3 = Math.max(0, lact - lant);
  const excedenteM3 = Math.max(0, consumoM3 - TARIFAS_CONFIG.LIMITE_BASE_M3);
  const valorExcedenteUSD = Number((excedenteM3 * TARIFAS_CONFIG.EXCEDENTE_POR_M3).toFixed(2));

  const multaExtra = parseFloat((document.getElementById('selectMultaExtra') as HTMLSelectElement)?.value || '0');
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
  const inputRecibido = document.getElementById('inputMontoRecibido') as HTMLInputElement;
  inputRecibido.value = '';
  updateVuelto();
}

function updateVuelto() {
  if (!currentCalculation) return;

  const total = currentCalculation.totalPagar;
  const inputRecibido = document.getElementById('inputMontoRecibido') as HTMLInputElement;
  const displayCambio = document.getElementById('posCambioMonto');
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
  const socioId = (e.target as HTMLSelectElement).value;
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

  const metodoPago = (document.getElementById('selectMetodoPago') as HTMLSelectElement).value;
  const inputRecibido = document.getElementById('inputMontoRecibido') as HTMLInputElement;
  const montoRecibido = parseFloat(inputRecibido.value);

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
    confirmButtonText: 'Sí, Cobrar Planilla',
    cancelButtonText: 'Cancelar'
  });

  if (!confirmRes.isConfirmed) return;

  const cobrosActuales = await getAllCobros();
  const nextNum = cobrosActuales.length + 1;
  const numRecibo = `REC-2026-${String(nextNum).padStart(3, '0')}`;
  const now = new Date().toISOString();

  const cobroRecord = {
    id: 'cobro-' + crypto.randomUUID().slice(0, 8),
    numeroRecibo: numRecibo,
    clienteId: selectedSocio.id,
    socioNombre: currentCalculation.socioNombre,
    socioCedula: currentCalculation.socioCedula,
    socioSector: currentCalculation.socioSector,
    medidorNumero: currentCalculation.medidorNumero,
    periodo: PERIODO_ACTUAL,
    lecturaAnterior: currentCalculation.lecturaAnterior,
    lecturaActual: currentCalculation.lecturaActual,
    consumoM3: currentCalculation.consumoM3,
    excedenteM3: currentCalculation.excedenteM3,
    montoBase: currentCalculation.cargoBase,
    montoExceso: currentCalculation.valorExcedenteUSD,
    montoAlcant: currentCalculation.recargoAlcant,
    montoMultas: currentCalculation.multaExtra,
    montoDeuda: currentCalculation.deudaAnterior,
    montoTotal: currentCalculation.totalPagar,
    metodoPago,
    cajeroResponsable: currentUser?.nombre || 'Cajero',
    fechaPago: now
  };

  const socioActualizado = {
    ...selectedSocio,
    estadoCuenta: 'AL_DIA',
    mesesAdeudados: 0,
    montoTotalAdeudado: 0,
    fechaDeudaAntigua: null,
    updatedAt: now
  };

  const movimientoCaja = {
    id: 'mov-' + crypto.randomUUID().slice(0, 8),
    tipo: 'ENTRADA',
    categoria: 'COBRO_AGUA',
    monto: currentCalculation.totalPagar,
    descripcion: `Cobro planilla agua ${PERIODO_ACTUAL} - ${currentCalculation.socioNombre} (${numRecibo})`,
    fecha: now,
    responsableId: currentUser?.id || 'usr-cajero',
    reciboAguaId: cobroRecord.id
  };

  await saveCobroTransaction(cobroRecord, socioActualizado, movimientoCaja);

  // Actualizar listas en memoria
  cachedSocios = await getAllSocios();
  populateSocioSelect(cachedSocios);

  // Mostrar Comprobante y SweetAlert
  showReceiptModal(cobroRecord);
  await updateMetricsAndHistory();

  // Reset selección
  document.getElementById('selectSocioCobro').value = '';
  document.getElementById('socioPlanillaEmpty').style.display = 'block';
  document.getElementById('socioPlanillaDetails').style.display = 'none';

  Swal.fire({
    icon: 'success',
    title: 'Cobro Registrado',
    text: `Se emitió el comprobante ${numRecibo} por $${cobroRecord.montoTotal.toFixed(2)} USD.`
  });
});

// Modal Recibo
function showReceiptModal(cobro) {
  document.getElementById('reciboNumTxt').textContent = cobro.numeroRecibo;
  document.getElementById('reciboFechaTxt').textContent = new Date(cobro.fechaPago).toLocaleString('es-EC');
  document.getElementById('reciboSocioTxt').textContent = cobro.socioNombre;
  document.getElementById('reciboCedulaTxt').textContent = cobro.socioCedula;
  document.getElementById('reciboSectorMedidorTxt').textContent = `${cobro.socioSector} • ${cobro.medidorNumero}`;
  document.getElementById('reciboPeriodoTxt').textContent = cobro.periodo;

  document.getElementById('reciboLecturasTxt').textContent = `${cobro.lecturaAnterior} / ${cobro.lecturaActual} m³`;
  document.getElementById('reciboConsumoTxt').textContent = `${cobro.consumoM3} m³`;

  document.getElementById('reciboBaseTxt').textContent = `$${cobro.montoBase.toFixed(2)}`;
  document.getElementById('reciboExcedenteTxt').textContent = `$${cobro.montoExceso.toFixed(2)}`;
  document.getElementById('reciboAlcantTxt').textContent = cobro.montoAlcant > 0 ? `+$${cobro.montoAlcant.toFixed(2)}` : '$0.00';

  const rowMultas = document.getElementById('reciboMultaRow');
  if (cobro.montoMultas > 0) {
    rowMultas.style.display = 'flex';
    document.getElementById('reciboMultasTxt').textContent = `+$${cobro.montoMultas.toFixed(2)}`;
  } else {
    rowMultas.style.display = 'none';
  }

  const rowDeuda = document.getElementById('reciboDeudaRow');
  if (cobro.montoDeuda > 0) {
    rowDeuda.style.display = 'flex';
    document.getElementById('reciboDeudaTxt').textContent = `+$${cobro.montoDeuda.toFixed(2)}`;
  } else {
    rowDeuda.style.display = 'none';
  }

  document.getElementById('reciboTotalTxt').textContent = `$${cobro.montoTotal.toFixed(2)} USD`;
  document.getElementById('reciboMetodoTxt').textContent = cobro.metodoPago;
  document.getElementById('reciboCajeroTxt').textContent = cobro.cajeroResponsable;

  document.getElementById('modalReciboPrint').style.display = 'flex';
}

document.getElementById('btnCloseReciboModal')?.addEventListener('click', () => {
  document.getElementById('modalReciboPrint').style.display = 'none';
});

document.getElementById('btnDoneRecibo')?.addEventListener('click', () => {
  document.getElementById('modalReciboPrint').style.display = 'none';
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

  const categoria = (document.getElementById('selectCategoriaGasto') as HTMLSelectElement).value;
  const monto = parseFloat((document.getElementById('inputMontoGasto') as HTMLInputElement).value);
  const descripcion = (document.getElementById('inputDescGasto') as HTMLInputElement).value.trim();
  const comprobante = (document.getElementById('inputComprobanteGasto') as HTMLInputElement).value.trim();

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
  (document.getElementById('formGasto') as HTMLFormElement).reset();

  await updateMetricsAndHistory();

  Swal.fire({
    icon: 'success',
    title: 'Egreso Registrado',
    text: `Se registró la salida de $${monto.toFixed(2)} USD correctamente.`
  });
});

// Inicializar
initIndexedDB().then(renderCajaUI);
