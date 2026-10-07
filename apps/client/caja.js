/**
 * Módulo 3: Caja, Liquidación, Cobros y Cuadre Diario (API-First / Clean Architecture)
 * Cumple con IEEE 830 / SRS: docs/caso_uso_modulo3.md (RF-CAJ-01 al RF-CAJ-12, RNF-CAJ-01 al 05)
 */
import { requireAuth, getCurrentUser, apiFetch, normalizeSearchText, matchesSearchTokens } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';
import { cargarYMostrarComprobante } from './comprobante.js';

// 1. Guard de autenticación (Restringido a ADMIN y CAJERO)
const currentUser = requireAuth(['ADMIN', 'CAJERO']);
if (currentUser) {
  injectAppLayout('caja');
}

// 2. Estado reactivo de la terminal de cobranza
const state = {
  sociosCache: [],
  selectedSocio: null,
  deudasData: null,
  selectedItemsMap: new Map(), // key -> ItemCobroDTO
  recibosList: [],
  masterRecibos: [], // Lista base sin filtrar de la vista activa (HOY o HISTORIAL)
  activeTab: 'HOY',
  cuadreData: null,
  isProcessingPayment: false
};

// 3. Inicialización al cargar el DOM
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await cargarSociosCache();
  await Promise.all([
    cargarPeriodoActivo(),
    cargarContadorHistorial(),
    cargarCuadreYRecibosHoy()
  ]);
  // Autofocus inmediato en la caja de búsqueda (HU-301 Criterio 1)
  setTimeout(() => {
    document.getElementById('inputBuscarSocioCobro')?.focus();
  }, 100);
});

/**
 * Consulta el período activo abierto y actualiza el indicador visual (RF-CAJ-13)
 */
async function cargarPeriodoActivo() {
  const elPeriodo = document.getElementById('periodoActualTag');
  try {
    const res = await apiFetch('/api/v1/caja/periodo-activo');
    if (elPeriodo && res?.periodo) {
      elPeriodo.innerHTML = `💧 Período Activo: <strong>${res.periodo.nombre} (${res.periodo.codigo})</strong>`;
      elPeriodo.className = 'sector-tag';
      elPeriodo.style.background = '#e0f2fe';
      elPeriodo.style.color = '#0369a1';
      elPeriodo.style.fontWeight = '700';
    } else if (elPeriodo) {
      elPeriodo.textContent = 'Período Activo: General';
    }
  } catch (err) {
    console.warn('Error consultando período activo:', err);
    if (elPeriodo) elPeriodo.textContent = 'Período Activo: Septiembre 2026';
  }
}

/**
 * Consulta la cantidad total de facturas pagadas históricas y las precarga
 */
async function cargarContadorHistorial() {
  try {
    const res = await apiFetch('/api/v1/facturas?estadoPago=PAGADO&limit=500');
    if (res && Array.isArray(res.data)) {
      state.historialRecibos = res.data.map((f) => {
        const sCache = (f.id_socio || f.idSocio) ? state.sociosCache.find((s) => s.id === (f.id_socio || f.idSocio)) : null;
        const d = f.fechaPago ? new Date(f.fechaPago) : (f.fecha_pago ? new Date(f.fecha_pago) : null);
        const fechaHoraTxt = d
          ? `${d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false })}`
          : 'Histórico';
        return {
          id: f.id,
          numeroRecibo: f.numeroFactura || f.numero_factura || f.id?.slice(0, 8),
          hora: fechaHoraTxt,
          socio: f.socioNombre || f.socio_nombre || (sCache ? sCache.nombreCompleto : '') || `Socio Comunitario`,
          socioCedula: f.socioCedula || f.socio_cedula || (sCache ? sCache.cedula : '') || '',
          socioCodigo: f.socioCodigo || f.socio_codigo || (sCache ? sCache.codigo : '') || '',
          numeroMedidor: f.numeroMedidor || f.numero_medidor || (sCache ? sCache.medidor : '') || '',
          metodoPago: f.metodoPago || f.metodo_pago || 'EFECTIVO',
          monto: Number(f.montoPagado ?? f.monto_pagado ?? f.totalPagar ?? f.total_pagar ?? f.totalMes ?? 0)
        };
      });

      const countTodos = document.getElementById('countRecibosTodos');
      if (countTodos) countTodos.textContent = String(state.historialRecibos.length);
    }
  } catch (err) {
    console.warn('Error consultando total histórico:', err);
  }
}

/**
 * Carga el catálogo de socios para búsqueda instantánea en ventanilla (RF-CAJ-01, RN-02, HU-301)
 */
async function cargarSociosCache() {
  try {
    const res = await apiFetch('/api/v1/socios');
    if (res && Array.isArray(res.data)) {
      state.sociosCache = res.data.map((s) => {
        const rawId = s.id || s.id_socio || s.socioId;
        const medidores = Array.isArray(s.medidores) ? s.medidores : [];
        const medidoresNums = medidores
          .map((m) => m.numeroMedidor || m.numero_medidor || m.medidorNumero)
          .filter(Boolean);
        if (s.medidorNumero && !medidoresNums.includes(s.medidorNumero)) {
          medidoresNums.push(s.medidorNumero);
        }
        if (s.numeroMedidor && !medidoresNums.includes(s.numeroMedidor)) {
          medidoresNums.push(s.numeroMedidor);
        }

        return {
          ...s,
          id: rawId,
          codigo: s.codigoSocio || s.codigo_socio || s.codigo || 'S/C',
          codigoSocio: s.codigoSocio || s.codigo_socio || s.codigo || 'S/C',
          cedula: s.cedulaRuc || s.cedula_ruc || s.cedula || 'S/N',
          cedulaRuc: s.cedulaRuc || s.cedula_ruc || s.cedula || 'S/N',
          medidoresList: medidoresNums,
          medidor: medidoresNums.join(', ') || 'S/N',
          medidorNumero: medidoresNums[0] || 'S/N',
          numeroMedidor: medidoresNums[0] || 'S/N',
          sector: s.nombreSector || s.nombre_sector || s.sector || 'General',
          nombreSector: s.nombreSector || s.nombre_sector || s.sector || 'General',
          nombreCompleto: s.nombreCompleto || `${s.nombres || ''} ${s.apellidos || ''}`.trim(),
          esTerceraEdad: Boolean(s.esTerceraEdad ?? s.es_tercera_edad),
          es_tercera_edad: Boolean(s.esTerceraEdad ?? s.es_tercera_edad)
        };
      });
    }
  } catch (err) {
    console.error('Error cargando padrón de socios:', err);
  }
}

/**
 * Carga métricas de caja y recibos del día (RF-CAJ-10, RF-CAJ-11, RN-13, HU-310)
 */
async function cargarCuadreYRecibosHoy() {
  try {
    const res = await apiFetch('/api/v1/caja/balance');
    if (res) {
      state.cuadreData = res;
      renderMetricasCaja(res);
      const hoyList = res.recibosDetalle || [];
      state.hoyRecibos = hoyList;

      const tabHoy = document.getElementById('tabRecibosHoy');
      const tabTodos = document.getElementById('tabRecibosTodos');
      const elFechaBadge = document.getElementById('fechaHoyBadge');
      if (elFechaBadge) {
        elFechaBadge.textContent = new Date().toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
      }

      // Si no hay cobros en el turno de hoy pero existen en el historial,
      // mostrar el historial por defecto para que la tabla no aparezca vacía al cajero.
      if (state.activeTab === 'HOY') {
        if (hoyList.length === 0 && (state.historialRecibos?.length > 0 || (res.balanceGeneral?.totalRecibosHistoricos || 0) > 0)) {
          state.activeTab = 'TODOS';
          if (tabHoy && tabTodos) {
            tabTodos.className = 'btn btn-sm btn-primary';
            tabHoy.className = 'btn btn-sm btn-outline-secondary';
          }
          await cargarHistorialTodosRecibos();
          return;
        }
        state.masterRecibos = hoyList;
      } else {
        state.masterRecibos = state.historialRecibos || [];
      }

      const inputFiltrarTabla = document.getElementById('inputBuscarReciboTabla');
      const q = inputFiltrarTabla ? inputFiltrarTabla.value.trim() : '';
      if (q) {
        filtrarTablaRecibos(q);
      } else {
        renderTablaRecibos(state.masterRecibos);
      }
    }
  } catch (err) {
    console.error('Error cargando balance de caja:', err);
  }
}

/**
 * Actualiza tarjetas de métricas en la parte superior
 */
function renderMetricasCaja(cuadre) {
  const ops = cuadre.resumenOperaciones || {};
  const gen = cuadre.balanceGeneral;

  const elAgua = document.getElementById('metricRecaudacionAgua');
  const elEntradas = document.getElementById('metricTotalEntradas');
  const elEntradasSub = document.getElementById('metricEntradasSub');
  const elSalidas = document.getElementById('metricTotalSalidas');
  const elNeto = document.getElementById('metricBalanceNeto');
  const elRecibosCount = document.getElementById('metricRecibosCount');
  const elGastosCount = document.getElementById('metricGastosCount');

  // Tarjeta 1: Recaudación Agua Hoy (Efectivo cobrado en el turno de hoy)
  if (elAgua) elAgua.textContent = `$${(ops.totalCobrosEfectivo || 0).toFixed(2)}`;
  if (elRecibosCount) elRecibosCount.textContent = `${ops.totalRecibosEmitidos || 0} recibos cobrados hoy`;

  // Tarjetas 2, 3 y 4: Balance Acumulado de Caja
  if (gen) {
    if (elEntradas) elEntradas.textContent = `$${gen.totalRecaudadoHistorico.toFixed(2)}`;
    if (elEntradasSub) elEntradasSub.textContent = `${gen.totalRecibosHistoricos} planillas recaudadas`;
    if (elSalidas) elSalidas.textContent = `$${gen.totalEgresosHistorico.toFixed(2)}`;
    if (elGastosCount) elGastosCount.textContent = `${gen.totalEgresosCount} egresos registrados`;
    if (elNeto) elNeto.textContent = `$${gen.saldoNetoDisponible.toFixed(2)}`;
  } else {
    const totalEntradas = (ops.totalCobrosEfectivo || 0) + (ops.totalCobrosTransferencia || 0);
    if (elEntradas) elEntradas.textContent = `$${totalEntradas.toFixed(2)}`;
    if (elSalidas) elSalidas.textContent = `$${(ops.totalEgresosCajaChica || 0).toFixed(2)}`;
    if (elNeto) elNeto.textContent = `$${(ops.saldoNetoEfectivo || 0).toFixed(2)}`;
    if (elGastosCount) elGastosCount.textContent = `${cuadre.egresosDetalle?.length || 0} egresos registrados`;
  }

  const countHoy = document.getElementById('countRecibosHoy');
  if (countHoy) countHoy.textContent = String(ops.totalRecibosEmitidos || 0);
}

/**
 * Configuración de eventos del DOM
 */
function setupEventListeners() {
  const inputSearch = document.getElementById('inputBuscarSocioCobro');
  const dropdown = document.getElementById('dropdownSugerenciasSocio');

  // Búsqueda en vivo de socios con tolerancia fonética y tildes (RN-02, HU-301)
  if (inputSearch) {
    inputSearch.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (q.length < 2) {
        if (dropdown) dropdown.style.display = 'none';
        return;
      }
      mostrarSugerenciasSocios(q);
    });

    inputSearch.addEventListener('focus', () => {
      if (inputSearch.value.trim().length >= 2) {
        mostrarSugerenciasSocios(inputSearch.value.trim());
      }
    });

    // Enter selecciona la primera coincidencia (HU-301 Criterio 4)
    inputSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const firstMatch = dropdown?.querySelector('.pos-search-item');
        if (firstMatch) {
          const socioId = firstMatch.getAttribute('data-id');
          const socio = state.sociosCache.find((s) => s.id === socioId);
          if (dropdown) dropdown.style.display = 'none';
          if (socio) seleccionarSocioCobro(socio);
        }
      } else if (e.key === 'Escape') {
        if (dropdown) dropdown.style.display = 'none';
      }
    });
  }

  // Cerrar dropdown al hacer click fuera
  document.addEventListener('click', (e) => {
    if (dropdown && !e.target.closest('.pos-search-wrapper')) {
      dropdown.style.display = 'none';
    }
  });

  // Selector de método de pago
  const selectMetodo = document.getElementById('selectMetodoPago');
  if (selectMetodo) {
    selectMetodo.addEventListener('change', () => {
      actualizarCalculoVuelto();
    });
  }

  // Entrada de monto recibido en efectivo
  const inputRecibido = document.getElementById('inputMontoRecibido');
  if (inputRecibido) {
    inputRecibido.addEventListener('input', () => {
      state.cashierEditedRecibido = true;
      actualizarCalculoVuelto();
    });
  }

  // Botón de confirmación de cobro (RF-CAJ-04..07)
  const btnCobrar = document.getElementById('btnEjecutarCobro');
  if (btnCobrar) {
    btnCobrar.addEventListener('click', () => {
      procesarCobroConfirmado();
    });
  }

  // Pestañas de recibos hoy vs todos
  const tabHoy = document.getElementById('tabRecibosHoy');
  const tabTodos = document.getElementById('tabRecibosTodos');
  const inputFiltrarTabla = document.getElementById('inputBuscarReciboTabla');

  if (tabHoy && tabTodos) {
    tabHoy.addEventListener('click', () => {
      state.activeTab = 'HOY';
      tabHoy.className = 'btn btn-sm btn-primary';
      tabTodos.className = 'btn btn-sm btn-outline-secondary';
      if (inputFiltrarTabla) inputFiltrarTabla.value = '';
      cargarCuadreYRecibosHoy();
    });

    tabTodos.addEventListener('click', async () => {
      state.activeTab = 'TODOS';
      tabTodos.className = 'btn btn-sm btn-primary';
      tabHoy.className = 'btn btn-sm btn-outline-secondary';
      if (inputFiltrarTabla) inputFiltrarTabla.value = '';
      await cargarHistorialTodosRecibos();
    });
  }

  // Filtro de tabla de recibos reactivo (HU-310 Criterio 5: reactivo al escribir y al borrar)
  if (inputFiltrarTabla) {
    const handleReactiveFilter = (e) => {
      if (e.key === 'Escape') {
        inputFiltrarTabla.value = '';
        filtrarTablaRecibos('');
        return;
      }
      filtrarTablaRecibos(e.target.value);
    };
    inputFiltrarTabla.addEventListener('input', handleReactiveFilter);
    inputFiltrarTabla.addEventListener('search', handleReactiveFilter);
    inputFiltrarTabla.addEventListener('keyup', handleReactiveFilter);
  }

  // Impresión de cuadre diario (RF-CAJ-11)
  const btnPrintCuadre = document.getElementById('btnPrintCuadreHoy');
  if (btnPrintCuadre) {
    btnPrintCuadre.addEventListener('click', () => {
      abrirModalCuadreDiario();
    });
  }

  const btnPrintModal = document.getElementById('btnPrintCuadreModalBtn');
  if (btnPrintModal) {
    btnPrintModal.addEventListener('click', () => {
      window.print();
    });
  }

  const btnCloseCuadreModal = document.getElementById('btnCloseCuadreModal');
  const btnCloseCuadreBtn = document.getElementById('btnCloseCuadreModalBtn');
  const modalCuadre = document.getElementById('modalCuadreDiarioPrint');
  [btnCloseCuadreModal, btnCloseCuadreBtn].forEach((b) => {
    if (b) b.addEventListener('click', () => {
      if (modalCuadre) modalCuadre.style.display = 'none';
    });
  });

  // Modal de egreso de caja chica (RN-14)
  const btnOpenGasto = document.getElementById('btnOpenGastoModal');
  const modalGasto = document.getElementById('modalGasto');
  const btnCloseGasto = document.getElementById('btnCloseGastoModal');
  const btnCancelGasto = document.getElementById('btnCancelGasto');
  const formGasto = document.getElementById('formGasto');

  if (btnOpenGasto && modalGasto) {
    btnOpenGasto.addEventListener('click', () => {
      modalGasto.style.display = 'flex';
      formGasto?.reset();
    });
  }

  [btnCloseGasto, btnCancelGasto].forEach((b) => {
    if (b) b.addEventListener('click', () => {
      if (modalGasto) modalGasto.style.display = 'none';
    });
  });

  if (formGasto) {
    formGasto.addEventListener('submit', async (e) => {
      e.preventDefault();
      await registrarEgresoCaja();
    });
  }

  // Modal de gestión de multas (RF-CAJ-09, RN-12)
  const btnOpenModalMulta = document.getElementById('btnOpenModalMulta');
  const modalMulta = document.getElementById('modalMulta');
  const btnCloseMulta = document.getElementById('btnCloseMultaModal');
  const btnCancelMulta = document.getElementById('btnCancelMulta');
  const formMulta = document.getElementById('formMulta');

  if (btnOpenModalMulta && modalMulta) {
    btnOpenModalMulta.addEventListener('click', () => {
      abrirModalNuevaMulta();
    });
  }

  [btnCloseMulta, btnCancelMulta].forEach((b) => {
    if (b) b.addEventListener('click', () => {
      if (modalMulta) modalMulta.style.display = 'none';
    });
  });

  if (formMulta) {
    formMulta.addEventListener('submit', async (e) => {
      e.preventDefault();
      await guardarMultaSocio();
    });
  }

  // Modal comprobante
  const btnCloseReciboModal = document.getElementById('btnCloseReciboModal');
  const btnDoneRecibo = document.getElementById('btnDoneRecibo');
  const btnPrintRecibo = document.getElementById('btnPrintReciboBtn');
  const modalRecibo = document.getElementById('modalReciboPrint');

  if (btnPrintRecibo) {
    btnPrintRecibo.addEventListener('click', () => {
      window.print();
    });
  }

  [btnCloseReciboModal, btnDoneRecibo].forEach((b) => {
    if (b) b.addEventListener('click', () => {
      if (modalRecibo) modalRecibo.style.display = 'none';
    });
  });
}

/**
 * Renderiza el menú desplegable de coincidencias de socios (RF-CAJ-01, HU-301)
 * Criterio 3: Muestra una lista desplegable con: Código, Nombre Completo, Cédula, Sector y Medidor.
 */
function mostrarSugerenciasSocios(query) {
  const dropdown = document.getElementById('dropdownSugerenciasSocio');
  if (!dropdown) return;

  const qNorm = normalizeSearchText(query);
  const matches = state.sociosCache.filter((s) => {
    const nombre = s.nombreCompleto || `${s.nombres || ''} ${s.apellidos || ''}`;
    const cedula = s.cedula || s.cedulaRuc || s.cedula_ruc || '';
    const medidoresStr = Array.isArray(s.medidoresList) && s.medidoresList.length > 0
      ? s.medidoresList.join(' ')
      : (s.medidor || s.numeroMedidor || '');
    const codigo = s.codigo || s.codigoSocio || s.codigo_socio || '';
    const sector = s.sector || s.nombreSector || s.nombre_sector || '';
    return (
      matchesSearchTokens(nombre, qNorm) ||
      normalizeSearchText(cedula).includes(qNorm) ||
      normalizeSearchText(medidoresStr).includes(qNorm) ||
      normalizeSearchText(codigo).includes(qNorm) ||
      normalizeSearchText(sector).includes(qNorm)
    );
  }).slice(0, 8);

  if (matches.length === 0) {
    dropdown.innerHTML = `<div style="padding: 0.75rem; color: #64748b; font-size: 0.85rem; text-align: center;">No se encontraron socios con "${query}".</div>`;
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = matches.map((s) => {
    const codigo = s.codigo || s.codigoSocio || s.codigo_socio || 'S/C';
    const nombre = s.nombreCompleto || `${s.nombres || ''} ${s.apellidos || ''}`.trim();
    const cedula = s.cedula || s.cedulaRuc || s.cedula_ruc || 'S/N';
    const sector = s.sector || s.nombreSector || s.nombre_sector || 'General';
    const medidoresTxt = Array.isArray(s.medidoresList) && s.medidoresList.length > 0
      ? s.medidoresList.join(', ')
      : (s.medidor || s.numeroMedidor || 'S/N');
    const badgeMedidores = Array.isArray(s.medidoresList) && s.medidoresList.length > 1
      ? `<span class="badge" style="background: #e0f2fe; color: #0369a1; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">${s.medidoresList.length} Medidores</span>`
      : '';

    return `
      <div class="pos-search-item" data-id="${s.id}" style="padding: 0.65rem 0.85rem; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: background 0.15s ease;">
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 0.45rem; margin-bottom: 3px;">
            <span class="badge-code" style="font-weight: 700; background: #e0e7ff; color: #3730a3; font-size: 0.78rem;">${codigo}</span>
            <strong style="color: #0f172a; font-size: 0.92rem;">${nombre}</strong>
            ${badgeMedidores}
          </div>
          <div style="font-size: 0.75rem; color: #64748b; display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: center;">
            <span>Cédula: <strong class="badge-code" style="color: #1e293b;">${cedula}</strong></span>
            <span>•</span>
            <span>Medidor(es): <strong style="color: #0369a1;">${medidoresTxt}</strong></span>
          </div>
        </div>
        <div style="margin-left: 0.5rem;">
          <span class="sector-tag" style="font-size: 0.75rem;">${sector}</span>
        </div>
      </div>
    `;
  }).join('');

  dropdown.style.display = 'block';

  dropdown.querySelectorAll('.pos-search-item').forEach((item) => {
    item.addEventListener('click', () => {
      const socioId = item.getAttribute('data-id');
      const socio = state.sociosCache.find((s) => s.id === socioId);
      dropdown.style.display = 'none';
      if (socio) seleccionarSocioCobro(socio);
    });
  });
}

/**
 * Actualiza la tarjeta visual del socio en la terminal (HU-301)
 */
function actualizarTarjetaSocio(s) {
  if (!s) return;
  const elCodigo = document.getElementById('posSocioCodigo');
  const elNombre = document.getElementById('posSocioNombre');
  const elCedula = document.getElementById('posSocioCedula');
  const elSector = document.getElementById('posSocioSector');
  const elMedidor = document.getElementById('posSocioMedidor');
  const elBadgeCat = document.getElementById('posCategoriaBadge');

  const codigo = s.codigo || s.codigoSocio || s.codigo_socio || 'S/C';
  const nombre = s.nombreCompleto || `${s.nombres || ''} ${s.apellidos || ''}`.trim();
  const cedula = s.cedula || s.cedulaRuc || s.cedula_ruc || 'S/N';
  const sector = s.sector || s.nombreSector || s.nombre_sector || 'General';
  
  let medidor = 'S/N';
  if (Array.isArray(s.medidoresList) && s.medidoresList.length > 0) {
    medidor = s.medidoresList.join(', ');
  } else if (Array.isArray(s.medidores) && s.medidores.length > 0) {
    medidor = s.medidores.map((m) => m.numeroMedidor || m.numero_medidor || m.medidorNumero || m).filter(Boolean).join(', ');
  } else {
    medidor = s.medidor || s.numeroMedidor || s.numero_medidor || s.medidorNumero || 'S/N';
  }
  
  const esTercera = Boolean(s.esTerceraEdad ?? s.es_tercera_edad);

  if (elCodigo) elCodigo.textContent = codigo;
  if (elNombre) elNombre.textContent = nombre;
  if (elCedula) elCedula.textContent = cedula;
  if (elSector) elSector.textContent = sector;
  if (elMedidor) elMedidor.textContent = medidor;

  if (elBadgeCat) {
    elBadgeCat.innerHTML = esTercera
      ? '<span class="badge badge-warning" style="font-weight: 800; background: #fef3c7; color: #92400e; padding: 4px 8px; border-radius: 6px;">👴 Tercera Edad ($5.00)</span>'
      : '<span class="badge badge-info" style="font-weight: 800; background: #e0f2fe; color: #0369a1; padding: 4px 8px; border-radius: 6px;">👤 Normal ($7.00)</span>';
  }
}

/**
 * Selecciona un socio y consulta sus valores adeudados vía API (RF-CAJ-02, HU-301)
 */
async function seleccionarSocioCobro(socio) {
  if (!socio) return;
  const sId = socio.id || socio.id_socio || socio.socioId;
  state.selectedSocio = { ...socio, id: sId };
  const inputSearch = document.getElementById('inputBuscarSocioCobro');
  if (inputSearch) {
    inputSearch.value = `${socio.nombres || ''} ${socio.apellidos || ''}`.trim() || socio.nombreCompleto || socio.codigo || '';
  }

  const containerDetails = document.getElementById('socioPlanillaDetails');
  const emptyState = document.getElementById('socioPlanillaEmpty');
  if (containerDetails) containerDetails.style.display = 'flex';
  if (emptyState) emptyState.style.display = 'none';

  // Mostrar datos completos del socio de inmediato
  actualizarTarjetaSocio(state.selectedSocio);

  // Consultar deudas desde el backend limpio
  await cargarDeudasSocio(sId);
}

/**
 * Consulta deudas del socio vía GET /api/v1/caja/socios/:id/deudas
 */
async function cargarDeudasSocio(socioId) {
  try {
    const res = await apiFetch(`/api/v1/caja/socios/${encodeURIComponent(socioId)}/deudas`);
    if (!res || !res.socio) {
      throw new Error(res?.error || 'Error al obtener deudas del socio');
    }

    state.deudasData = res;
    state.selectedItemsMap.clear();
    state.cashierEditedRecibido = false;

    // Refrescar con los datos canónicos confirmados por el backend asegurando el ID
    if (res.socio) {
      const canonicalId = res.socio.id || socioId;
      state.selectedSocio = {
        ...(state.selectedSocio || {}),
        ...res.socio,
        id: canonicalId
      };
      actualizarTarjetaSocio(state.selectedSocio);
    }

    renderDesgloseRubros(res.rubrosPendientes || []);
    actualizarTotalSeleccionado();
  } catch (err) {
    console.error('Error cargando deudas:', err);
    Swal.fire({
      icon: 'error',
      title: 'Error de Consulta',
      text: err.message || 'No se pudieron consultar las deudas del socio.'
    });
  }
}

/**
 * Renderiza los rubros pendientes con casillas de verificación granulares (RF-CAJ-02, RF-CAJ-03)
 */
function renderDesgloseRubros(rubros) {
  const containerMedidores = document.getElementById('containerMedidoresPOS');
  const sectionAlcantarillado = document.getElementById('sectionDeudaAlcantarillado');
  const containerAlcantarillado = document.getElementById('containerDeudaAlcantarillado');
  const sectionAnteriores = document.getElementById('sectionDeudasAnteriores');
  const containerAnteriores = document.getElementById('containerDeudasAnteriores');
  const posMesesMora = document.getElementById('posMesesMora');
  const containerMultas = document.getElementById('containerMultasSocio');

  if (containerMedidores) containerMedidores.innerHTML = '';
  if (containerAlcantarillado) containerAlcantarillado.innerHTML = '';
  if (containerAnteriores) containerAnteriores.innerHTML = '';
  if (containerMultas) containerMultas.innerHTML = '';

  const activos = rubros.filter((r) => r.tipo === 'AGUA_PERIODO_ACTIVO');
  const alcantarillados = rubros.filter((r) => r.tipo === 'ALCANTARILLADO');
  const anteriores = rubros.filter((r) => r.tipo === 'AGUA_PERIODO_ANTERIOR' || r.tipo === 'DEUDA_HISTORICA_CORTE');
  const multas = rubros.filter((r) => r.tipo === 'MULTA_COMUNITARIA');

  // 1. Consumo Activo
  if (activos.length > 0) {
    activos.forEach((item) => {
      const key = `${item.tipo}_${item.idReferencia}`;
      state.selectedItemsMap.set(key, {
        tipo: item.tipo,
        idReferencia: item.idReferencia,
        montoACobrar: item.saldoPendiente,
        descripcion: item.concepto
      });

      const det = item.detallesAgua || {};
      const card = document.createElement('div');
      card.className = 'pos-item-card';
      card.style.cssText = 'border: 1.5px solid #0284c7; border-radius: 8px; padding: 0.75rem; background: #f0f9ff; margin-bottom: 8px;';
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap;">
          <label style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #0369a1; cursor: pointer; margin: 0; flex: 1; min-width: 180px;">
            <input type="checkbox" checked class="checkbox-rubro" data-key="${key}" style="transform: scale(1.2);" />
            <span>${item.concepto}</span>
          </label>
          <div style="display: flex; align-items: center; gap: 8px; background: #ffffff; padding: 4px 8px; border-radius: 6px; border: 1px solid #bae6fd;">
            <span style="font-size: 0.75rem; color: #64748b;">Saldo: <strong>$${item.saldoPendiente.toFixed(2)}</strong></span>
            <div style="display: flex; align-items: center; gap: 3px;">
              <span style="font-size: 0.8rem; font-weight: 700; color: #0284c7;">Abono: $</span>
              <input 
                type="number" 
                class="input-abono-rubro" 
                data-key="${key}" 
                data-max="${item.saldoPendiente}" 
                min="0.01" 
                max="${item.saldoPendiente}" 
                step="0.01" 
                value="${item.saldoPendiente.toFixed(2)}"
                style="width: 75px; padding: 2px 4px; font-weight: 700; font-size: 0.9rem; text-align: right; border: 1px solid #0284c7; border-radius: 4px; background: #f8fafc;"
                title="Monto a abonar para este rubro (máximo $${item.saldoPendiente.toFixed(2)})"
              />
            </div>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; font-size: 0.78rem; color: #475569; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #bae6fd;">
          <div>Lect. Ant: <strong>${det.lecturaAnterior ?? 'N/A'}</strong></div>
          <div>Lect. Act: <strong>${det.lecturaActual ?? 'N/A'}</strong></div>
          <div>Consumo: <strong>${det.consumoM3 ?? 0} m³</strong></div>
          <div>Base (30m³): <strong>$${(det.valorBase ?? 0).toFixed(2)}</strong></div>
          <div>Excedente: <strong>$${(det.valorExcedente ?? 0).toFixed(2)}</strong></div>
          <div>Alcantarillado: <strong>$${(det.valorAlcantarillado ?? 0).toFixed(2)}</strong></div>
        </div>
      `;
      containerMedidores.appendChild(card);
    });
  } else {
    containerMedidores.innerHTML = `
      <div style="padding: 0.75rem; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; font-size: 0.85rem; color: #64748b; text-align: center;">
        No hay planillas de agua pendientes para el período actual.
      </div>
    `;
  }

  // 2. Alcantarillado independiente
  if (alcantarillados.length > 0) {
    if (sectionAlcantarillado) sectionAlcantarillado.style.display = 'block';
    alcantarillados.forEach((item) => {
      const key = `${item.tipo}_${item.idReferencia}`;
      state.selectedItemsMap.set(key, {
        tipo: item.tipo,
        idReferencia: item.idReferencia,
        montoACobrar: item.saldoPendiente,
        descripcion: item.concepto
      });

      const row = document.createElement('div');
      row.className = 'pos-item-card';
      row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: #e0f2fe; border: 1px solid #bae6fd; border-radius: 6px; margin-bottom: 4px; gap: 8px; flex-wrap: wrap;';
      row.innerHTML = `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #0369a1; margin: 0; cursor: pointer; flex: 1; min-width: 160px;">
          <input type="checkbox" checked class="checkbox-rubro" data-key="${key}" style="transform: scale(1.15);" />
          <span>${item.concepto}</span>
        </label>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 0.75rem; color: #64748b;">Saldo: <strong>$${item.saldoPendiente.toFixed(2)}</strong></span>
          <div style="display: flex; align-items: center; gap: 3px;">
            <span style="font-size: 0.8rem; font-weight: 700; color: #0284c7;">Abono: $</span>
            <input 
              type="number" 
              class="input-abono-rubro" 
              data-key="${key}" 
              data-max="${item.saldoPendiente}" 
              min="0.01" 
              max="${item.saldoPendiente}" 
              step="0.01" 
              value="${item.saldoPendiente.toFixed(2)}"
              style="width: 75px; padding: 2px 4px; font-weight: 700; font-size: 0.85rem; text-align: right; border: 1px solid #0284c7; border-radius: 4px; background: #ffffff;"
              title="Monto a abonar para este rubro (máximo $${item.saldoPendiente.toFixed(2)})"
            />
          </div>
        </div>
      `;
      containerAlcantarillado.appendChild(row);
    });
  } else if (sectionAlcantarillado) {
    sectionAlcantarillado.style.display = 'none';
  }

  // 3. Deudas Anteriores
  if (anteriores.length > 0) {
    if (sectionAnteriores) sectionAnteriores.style.display = 'block';
    if (posMesesMora) posMesesMora.textContent = String(anteriores.length);

    anteriores.forEach((item) => {
      const key = `${item.tipo}_${item.idReferencia}`;
      state.selectedItemsMap.set(key, {
        tipo: item.tipo,
        idReferencia: item.idReferencia,
        montoACobrar: item.saldoPendiente,
        descripcion: item.concepto
      });

      const row = document.createElement('div');
      row.className = 'pos-item-card';
      row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: #fef2f2; border: 1px solid #fee2e2; border-radius: 6px; margin-bottom: 4px; gap: 8px; flex-wrap: wrap;';
      row.innerHTML = `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #991b1b; margin: 0; cursor: pointer; flex: 1; min-width: 160px;">
          <input type="checkbox" checked class="checkbox-rubro" data-key="${key}" style="transform: scale(1.15);" />
          <span>${item.concepto}</span>
        </label>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 0.75rem; color: #991b1b;">Saldo: <strong>$${item.saldoPendiente.toFixed(2)}</strong></span>
          <div style="display: flex; align-items: center; gap: 3px;">
            <span style="font-size: 0.8rem; font-weight: 700; color: #b91c1c;">Abono: $</span>
            <input 
              type="number" 
              class="input-abono-rubro" 
              data-key="${key}" 
              data-max="${item.saldoPendiente}" 
              min="0.01" 
              max="${item.saldoPendiente}" 
              step="0.01" 
              value="${item.saldoPendiente.toFixed(2)}"
              style="width: 75px; padding: 2px 4px; font-weight: 700; font-size: 0.85rem; text-align: right; border: 1px solid #b91c1c; border-radius: 4px; background: #ffffff;"
              title="Monto a abonar para este rubro (máximo $${item.saldoPendiente.toFixed(2)})"
            />
          </div>
        </div>
      `;
      containerAnteriores.appendChild(row);
    });
  } else if (sectionAnteriores) {
    sectionAnteriores.style.display = 'none';
  }

  // 4. Multas y Rubros
  if (multas.length > 0) {
    multas.forEach((item) => {
      const key = `${item.tipo}_${item.idReferencia}`;
      state.selectedItemsMap.set(key, {
        tipo: item.tipo,
        idReferencia: item.idReferencia,
        montoACobrar: item.saldoPendiente,
        descripcion: item.concepto
      });

      const row = document.createElement('div');
      row.className = 'pos-item-card';
      row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 4px; gap: 8px; flex-wrap: wrap;';
      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 160px;">
          <input type="checkbox" checked class="checkbox-rubro" data-key="${key}" style="transform: scale(1.15);" />
          <div style="font-size: 0.85rem; font-weight: 700; color: #0f172a;">${item.concepto}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 0.75rem; color: #64748b;">Saldo: <strong>$${item.saldoPendiente.toFixed(2)}</strong></span>
          <div style="display: flex; align-items: center; gap: 3px;">
            <span style="font-size: 0.8rem; font-weight: 700; color: #0284c7;">Abono: $</span>
            <input 
              type="number" 
              class="input-abono-rubro" 
              data-key="${key}" 
              data-max="${item.saldoPendiente}" 
              min="0.01" 
              max="${item.saldoPendiente}" 
              step="0.01" 
              value="${item.saldoPendiente.toFixed(2)}"
              style="width: 75px; padding: 2px 4px; font-weight: 700; font-size: 0.85rem; text-align: right; border: 1px solid #0284c7; border-radius: 4px; background: #ffffff;"
              title="Monto a abonar para este rubro (máximo $${item.saldoPendiente.toFixed(2)})"
            />
          </div>
          <button type="button" class="btn btn-sm btn-outline-primary btn-edit-multa" data-id="${item.idReferencia}" title="Modificar multa" style="padding: 2px 6px; font-size: 0.72rem;">✏️</button>
          <button type="button" class="btn btn-sm btn-outline-danger btn-delete-multa" data-id="${item.idReferencia}" title="Eliminar multa" style="padding: 2px 6px; font-size: 0.72rem;">🗑️</button>
        </div>
      `;
      containerMultas.appendChild(row);
    });

    containerMultas.querySelectorAll('.btn-edit-multa').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mId = btn.getAttribute('data-id');
        const item = multas.find((m) => m.idReferencia === mId);
        if (item) {
          abrirModalEditarMulta(item);
        }
      });
    });

    containerMultas.querySelectorAll('.btn-delete-multa').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mId = btn.getAttribute('data-id');
        await eliminarMulta(mId);
      });
    });
  } else {
    containerMultas.innerHTML = `
      <div style="padding: 0.5rem; font-size: 0.8rem; color: #64748b; text-align: center;">
        No existen multas pendientes registradas para este socio.
      </div>
    `;
  }

  // Configurar listeners de los checkboxes para habilitar/deshabilitar input y actualizar mapa (RF-CAJ-03)
  document.querySelectorAll('.checkbox-rubro').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const k = e.target.getAttribute('data-key');
      const item = state.deudasData?.rubrosPendientes?.find((r) => `${r.tipo}_${r.idReferencia}` === k);
      const inputAbono = document.querySelector(`.input-abono-rubro[data-key="${k}"]`);

      if (e.target.checked && item) {
        if (inputAbono) {
          inputAbono.disabled = false;
          inputAbono.style.opacity = '1';
        }
        const valAbono = inputAbono ? (parseFloat(inputAbono.value) || item.saldoPendiente) : item.saldoPendiente;
        state.selectedItemsMap.set(k, {
          tipo: item.tipo,
          idReferencia: item.idReferencia,
          montoACobrar: Math.min(item.saldoPendiente, Math.max(0.01, valAbono)),
          descripcion: item.concepto
        });
      } else {
        if (inputAbono) {
          inputAbono.disabled = true;
          inputAbono.style.opacity = '0.4';
        }
        state.selectedItemsMap.delete(k);
      }
      actualizarTotalSeleccionado();
    });
  });

  // Configurar listeners de los inputs individuales de abono por rubro (RF-CAJ-03)
  document.querySelectorAll('.input-abono-rubro').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const k = e.target.getAttribute('data-key');
      const max = parseFloat(e.target.getAttribute('data-max')) || 0;
      let val = parseFloat(e.target.value);

      if (!isNaN(val) && val > max) {
        val = max;
        e.target.value = max.toFixed(2);
      }

      if (state.selectedItemsMap.has(k)) {
        const itemObj = state.selectedItemsMap.get(k);
        itemObj.montoACobrar = isNaN(val) ? 0 : Math.round(val * 100) / 100;
      }
      actualizarTotalSeleccionado();
    });

    inp.addEventListener('blur', (e) => {
      const k = e.target.getAttribute('data-key');
      const max = parseFloat(e.target.getAttribute('data-max')) || 0;
      let val = parseFloat(e.target.value);

      if (isNaN(val) || val <= 0) {
        val = max;
        e.target.value = max.toFixed(2);
      } else if (val > max) {
        val = max;
        e.target.value = max.toFixed(2);
      } else {
        e.target.value = val.toFixed(2);
      }

      if (state.selectedItemsMap.has(k)) {
        const itemObj = state.selectedItemsMap.get(k);
        itemObj.montoACobrar = Math.round(val * 100) / 100;
      }
      actualizarTotalSeleccionado();
    });
  });
}

/**
 * Calcula el gran total de los rubros marcados en tiempo real (RF-CAJ-03, RN-06)
 */
function actualizarTotalSeleccionado() {
  let total = 0;
  for (const item of state.selectedItemsMap.values()) {
    total += Number(item.montoACobrar || 0);
  }
  total = Math.round(total * 100) / 100;

  const elTotal = document.getElementById('posTotalPagar');
  if (elTotal) {
    elTotal.textContent = `$${total.toFixed(2)}`;
  }

  // Actualizar campo monto recibido con valor exacto por defecto si el cajero no ha digitado manualmente
  const inputRecibido = document.getElementById('inputMontoRecibido');
  if (inputRecibido && !state.cashierEditedRecibido) {
    inputRecibido.value = total > 0 ? total.toFixed(2) : '';
  }

  actualizarCalculoVuelto();
}

/**
 * Calcula en vivo el vuelto o cambio según el método de pago seleccionado (RF-CAJ-07, RN-06)
 */
function actualizarCalculoVuelto() {
  const selectMetodo = document.getElementById('selectMetodoPago');
  const inputRecibido = document.getElementById('inputMontoRecibido');
  const elCambio = document.getElementById('posCambioMonto');
  const btnCobrar = document.getElementById('btnEjecutarCobro');
  const groupEfectivo = document.getElementById('groupEfectivoRecibido');

  const metodo = selectMetodo ? selectMetodo.value : 'EFECTIVO';
  let total = 0;
  for (const item of state.selectedItemsMap.values()) {
    total += Number(item.montoACobrar || 0);
  }
  total = Math.round(total * 100) / 100;

  if (metodo === 'TRANSFERENCIA') {
    if (groupEfectivo) groupEfectivo.style.display = 'none';
    if (elCambio) elCambio.textContent = '$0.00 USD';
    if (btnCobrar) btnCobrar.disabled = total <= 0;
    return;
  }

  if (groupEfectivo) groupEfectivo.style.display = 'block';

  const recibido = Number(inputRecibido?.value || 0);
  const cambio = Math.round((recibido - total) * 100) / 100;

  if (cambio < 0) {
    if (elCambio) {
      elCambio.textContent = `Faltan $${Math.abs(cambio).toFixed(2)}`;
      elCambio.style.color = '#ef4444';
    }
    if (btnCobrar) btnCobrar.disabled = true;
  } else {
    if (elCambio) {
      elCambio.textContent = `$${cambio.toFixed(2)} USD`;
      elCambio.style.color = '#16a34a';
    }
    if (btnCobrar) btnCobrar.disabled = total <= 0;
  }
}

/**
 * Procesa la liquidación transaccional atómica en el backend (RF-CAJ-04..07, RNF-CAJ-01, 02, 05)
 */
async function procesarCobroConfirmado() {
  if (state.isProcessingPayment) return;
  const socioId = state.selectedSocio?.id || state.selectedSocio?.id_socio || state.deudasData?.socio?.id;
  if (!state.selectedSocio || !socioId) {
    Swal.fire('Atención', 'Seleccione primero a un socio válido para cobrar.', 'warning');
    return;
  }

  const items = Array.from(state.selectedItemsMap.values());
  if (items.length === 0) {
    Swal.fire('Atención', 'Debe marcar al menos un rubro para liquidar.', 'warning');
    return;
  }

  const selectMetodo = document.getElementById('selectMetodoPago');
  const inputRecibido = document.getElementById('inputMontoRecibido');
  const btnCobrar = document.getElementById('btnEjecutarCobro');

  const metodoPago = selectMetodo ? selectMetodo.value : 'EFECTIVO';
  const total = items.reduce((acc, it) => acc + it.montoACobrar, 0);

  let montoRecibido = Number(inputRecibido?.value || total);
  let referenciaBancaria = undefined;

  if (metodoPago === 'TRANSFERENCIA') {
    const { value: ref, isConfirmed } = await Swal.fire({
      title: 'Transferencia Bancaria',
      input: 'text',
      inputLabel: 'Ingrese el número de comprobante o referencia bancaria *',
      inputPlaceholder: 'Ej. BANCO-PICHINCHA-98231',
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      inputValidator: (val) => {
        if (!val || !val.trim()) return 'El número de referencia bancaria es obligatorio.';
      }
    });

    if (!isConfirmed) return;
    referenciaBancaria = ref.trim();
    montoRecibido = total;
  } else {
    if (montoRecibido < total) {
      Swal.fire('Efectivo Insuficiente', `El total a cobrar es $${total.toFixed(2)}, pero se ingresaron $${montoRecibido.toFixed(2)}.`, 'error');
      return;
    }
  }

  // Bloqueo de idempotencia (RNF-CAJ-05)
  state.isProcessingPayment = true;
  if (btnCobrar) {
    btnCobrar.disabled = true;
    btnCobrar.textContent = '⏳ Procesando transacción...';
  }

  try {
    const payload = {
      idSocio: socioId,
      id_socio: socioId,
      idCajero: currentUser?.id || '00000000-0000-0000-0000-000000000002',
      metodoPago,
      montoTotalRecibido: montoRecibido,
      referenciaBancaria,
      items
    };

    const res = await apiFetch('/api/v1/caja/cobros', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!res || !res.success) {
      throw new Error(res?.error || 'No se pudo registrar el cobro en el servidor.');
    }

    // Cobro exitoso: actualizar vistas
    await Swal.fire({
      icon: 'success',
      title: '¡Cobro Exitoso!',
      html: `
        <div style="font-size: 0.95rem; text-align: left; padding: 0.5rem;">
          <p><strong>N° Recibo:</strong> <span class="badge-code">${res.numeroRecibo}</span></p>
          <p><strong>Total Liquidado:</strong> $${res.totalCobrado.toFixed(2)}</p>
          <p><strong>Recibido:</strong> $${res.montoRecibido.toFixed(2)}</p>
          <p><strong>Vuelto / Cambio:</strong> <strong style="color: #16a34a;">$${res.cambioVuelto.toFixed(2)} USD</strong></p>
        </div>
      `,
      confirmButtonText: 'Ver e Imprimir Comprobante',
      confirmButtonColor: '#0284c7'
    });

    // Abrir comprobante oficial de pago (RF-CAJ-08, RNF-CAJ-04)
    const comprobanteId = res.numeroRecibo || res.facturaId || res.transaccionId;
    if (comprobanteId) {
      const itemsConSaldos = (res.rubrosLiquidados && res.rubrosLiquidados.length > 0)
        ? res.rubrosLiquidados
        : items.map((it) => {
            const valTot = Number((it.montoOriginal ?? it.saldoPendiente ?? it.montoACobrar).toFixed(2));
            const aCob = Number(it.montoACobrar.toFixed(2));
            const sRest = Math.max(0, Number((valTot - aCob).toFixed(2)));
            return {
              tipo: it.tipo,
              idReferencia: it.idReferencia,
              descripcion: it.descripcion,
              valorTotal: valTot,
              aPagarCobrado: aCob,
              saldoRestante: sRest
            };
          });

      const fallbackData = {
        ...res,
        id: comprobanteId,
        numeroRecibo: res.numeroRecibo || comprobanteId,
        numeroFactura: res.numeroRecibo || comprobanteId,
        socioNombre: res.socio?.nombreCompleto || state.selectedSocio?.nombresCompleto || '',
        socioCedula: res.socio?.cedulaRuc || state.selectedSocio?.cedula_ruc || '',
        codigoSocio: res.socio?.codigoSocio || state.selectedSocio?.codigo_socio || '',
        montoTotal: res.totalCobrado,
        montoPagado: res.totalCobrado,
        saldoPendiente: res.saldoPendienteRestanteTotal,
        metodoPago: res.metodoPago,
        cajeroNombre: currentUser?.nombre || 'Caja Central',
        items: itemsConSaldos,
        rubrosLiquidados: itemsConSaldos
      };
      cargarYMostrarComprobante(comprobanteId, fallbackData);
    }

    // Refrescar caja y deudas del socio
    await Promise.all([
      cargarCuadreYRecibosHoy(),
      cargarDeudasSocio(socioId)
    ]);
  } catch (err) {
    console.error('Error procesando cobro:', err);
    Swal.fire({
      icon: 'error',
      title: 'Error de Cobro',
      text: err.message || 'Ocurrió un error al liquidar el pago.'
    });
  } finally {
    state.isProcessingPayment = false;
    if (btnCobrar) {
      btnCobrar.disabled = false;
      btnCobrar.textContent = '✓ Confirmar Pago y Emitir Recibo';
    }
  }
}

/**
 * Renderiza la tabla de recibos emitidos hoy o en el historial
 */
function renderTablaRecibos(recibos) {
  state.recibosList = recibos || [];
  const tbody = document.getElementById('recibosTableBody');
  const txtResumen = document.getElementById('txtResumenRecibos');
  const txtMonto = document.getElementById('txtMontoResumenRecibos');
  if (!tbody) return;

  if (recibos.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: #94a3b8; padding: 2rem;">
          No se encontraron comprobantes en esta vista.
        </td>
      </tr>
    `;
    if (txtResumen) txtResumen.innerHTML = 'Recibos: <strong>0</strong>';
    if (txtMonto) txtMonto.innerHTML = 'Total Recaudado: <strong>$0.00 USD</strong>';
    return;
  }

  let totalRecaudado = 0;
  tbody.innerHTML = recibos.map((r) => {
    totalRecaudado += Number(r.monto || 0);
    const esAdmin = currentUser?.rol === 'ADMIN';
    const recId = r.id || r.numeroRecibo;

    return `
      <tr data-recibo="${r.numeroRecibo}">
        <td><strong class="badge-code">${r.numeroRecibo}</strong></td>
        <td>
          <div style="font-weight: 600; color: #0f172a;">${r.socio || 'Socio Comunitario'}</div>
          ${(r.socioCedula || r.numeroMedidor || r.socioCodigo) ? `
            <div style="font-size: 0.73rem; color: #64748b; margin-top: 2px;">
              ${r.socioCodigo ? `<span class="badge-code" style="font-size: 0.7rem; padding: 1px 4px; background: #e0e7ff; color: #3730a3;">${r.socioCodigo}</span> ` : ''}
              ${r.socioCedula ? `C.I: ${r.socioCedula}` : ''} 
              ${r.numeroMedidor ? `• Med: <strong>${r.numeroMedidor}</strong>` : ''}
            </div>
          ` : ''}
        </td>
        <td style="text-align: right; font-weight: 700; color: #0284c7;">$${Number(r.monto || 0).toFixed(2)}</td>
        <td style="font-size: 0.82rem; color: #64748b; white-space: nowrap;">${r.fechaHora || r.hora || ''}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-sm btn-outline-secondary btn-ver-recibo" data-id="${recId}" data-num="${r.numeroRecibo}" title="Ver o reimprimir comprobante">
            👁️ Ver
          </button>
          ${esAdmin ? `
            <button class="btn btn-sm btn-outline-danger btn-anular-recibo" data-id="${recId}" data-num="${r.numeroRecibo}" title="Anular comprobante (ADMIN)">
              🗑️
            </button>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');

  if (txtResumen) txtResumen.innerHTML = `Recibos: <strong>${recibos.length}</strong>`;
  if (txtMonto) txtMonto.innerHTML = `Total Recaudado: <strong style="color: #0284c7;">$${totalRecaudado.toFixed(2)} USD</strong>`;

  // Listeners de ver y anular
  tbody.querySelectorAll('.btn-ver-recibo').forEach((btn) => {
    btn.addEventListener('click', () => {
      const recId = btn.getAttribute('data-id') || btn.getAttribute('data-num');
      cargarYMostrarComprobante(recId);
    });
  });

  tbody.querySelectorAll('.btn-anular-recibo').forEach((btn) => {
    btn.addEventListener('click', () => {
      const recId = btn.getAttribute('data-id') || btn.getAttribute('data-num');
      solicitarAnulacionRecibo(recId);
    });
  });
}

/**
 * Filtra dinámicamente la tabla de recibos de forma reactiva (HU-310: Criterio 5)
 * Al escribir muestra coincidencias; al borrar restaura todos los registros.
 */
function filtrarTablaRecibos(query) {
  let master = state.masterRecibos || [];
  if (!query || !query.trim()) {
    renderTablaRecibos(master);
    return;
  }
  // Si en la vista activa no hay registros pero hay historial disponible, buscar en historial
  if (master.length === 0 && Array.isArray(state.historialRecibos) && state.historialRecibos.length > 0) {
    master = state.historialRecibos;
  }

  const qNorm = normalizeSearchText(query.trim());
  const filtrados = master.filter((r) => {
    const num = normalizeSearchText(r.numeroRecibo || '');
    const socio = normalizeSearchText(r.socio || '');
    const cedula = normalizeSearchText(r.socioCedula || '');
    const codigo = normalizeSearchText(r.socioCodigo || '');
    const medidor = normalizeSearchText(r.numeroMedidor || '');
    const fecha = normalizeSearchText(r.hora || '');
    return (
      num.includes(qNorm) ||
      matchesSearchTokens(r.socio || '', qNorm) ||
      cedula.includes(qNorm) ||
      codigo.includes(qNorm) ||
      medidor.includes(qNorm) ||
      fecha.includes(qNorm)
    );
  });
  renderTablaRecibos(filtrados);
}

/**
 * Carga el historial completo de facturas pagadas (Pestaña Historial, HU-310)
 */
async function cargarHistorialTodosRecibos() {
  try {
    // Si ya los tenemos en memoria, renderizamos de inmediato para que no haya latencia
    if (Array.isArray(state.historialRecibos) && state.historialRecibos.length > 0) {
      state.masterRecibos = state.historialRecibos;
      const inputFiltrarTabla = document.getElementById('inputBuscarReciboTabla');
      const q = inputFiltrarTabla ? inputFiltrarTabla.value.trim() : '';
      if (q) {
        filtrarTablaRecibos(q);
      } else {
        renderTablaRecibos(state.historialRecibos);
      }
    }

    const res = await apiFetch('/api/v1/caja/cuadre-diario?fecha=TODOS');
    if (res && Array.isArray(res.recibosDetalle)) {
      const mapeados = res.recibosDetalle;

      state.historialRecibos = mapeados;
      const countTodos = document.getElementById('countRecibosTodos');
      if (countTodos) countTodos.textContent = String(mapeados.length);

      if (state.activeTab === 'TODOS') {
        state.masterRecibos = mapeados;
        const inputFiltrarTabla = document.getElementById('inputBuscarReciboTabla');
        const q = inputFiltrarTabla ? inputFiltrarTabla.value.trim() : '';
        if (q) {
          filtrarTablaRecibos(q);
        } else {
          renderTablaRecibos(mapeados);
        }
      }
    }
  } catch (err) {
    console.error('Error cargando historial de recibos:', err);
  }
}

/**
 * Anulación de comprobante de cobro (RF-CAJ-12, RN-15, RN-16)
 */
async function solicitarAnulacionRecibo(reciboId) {
  if (currentUser?.rol !== 'ADMIN') {
    Swal.fire('Acceso Restringido', 'Solo los usuarios con rol de Administrador pueden anular comprobantes.', 'error');
    return;
  }

  const { value: motivo, isConfirmed } = await Swal.fire({
    title: `¿Anular Comprobante #${reciboId}?`,
    text: 'Esta acción revertirá los asientos contables de fondos y restablecerá la deuda original del socio.',
    input: 'text',
    inputLabel: 'Justificación / Motivo de la Anulación *',
    inputPlaceholder: 'Ej. Error en valor digitado o cobro duplicado',
    showCancelButton: true,
    confirmButtonText: 'Sí, Anular Definitivamente',
    confirmButtonColor: '#ef4444',
    cancelButtonText: 'Cancelar',
    inputValidator: (val) => {
      if (!val || !val.trim()) return 'Debe ingresar un motivo obligatorio.';
    }
  });

  if (!isConfirmed) return;

  const motivoLimpio = (typeof motivo === 'string' && motivo.trim()) ? motivo.trim() : 'Anulación autorizada por Administrador';

  try {
    const res = await apiFetch(`/api/v1/caja/facturas/${encodeURIComponent(reciboId)}/anular`, {
      method: 'POST',
      body: { motivo: motivoLimpio }
    });

    if (!res || !res.success) {
      throw new Error(res?.error || 'No se pudo anular la factura.');
    }

    Swal.fire('Anulada', res.mensaje || 'Comprobante anulado y saldo restablecido.', 'success');

    await cargarCuadreYRecibosHoy();
    if (state.activeTab === 'TODOS') {
      await cargarHistorialTodosRecibos();
    }
    if (state.selectedSocio) {
      await cargarDeudasSocio(state.selectedSocio.id);
    }
  } catch (err) {
    console.error('Error anulando factura:', err);
    Swal.fire('Error', err.message || 'No se pudo completar la anulación.', 'error');
  }
}

/**
 * Abre el informe de Cuadre Diario con firmas de responsabilidad (RF-CAJ-11)
 */
function abrirModalCuadreDiario() {
  const modal = document.getElementById('modalCuadreDiarioPrint');
  if (!modal) return;

  const data = state.cuadreData;
  if (!data) return;

  const fechaEl = document.getElementById('cuadreFechaTxt');
  const cajeroEl = document.getElementById('cuadreCajeroTxt');
  const totalRecibosEl = document.getElementById('cuadreTotalRecibosTxt');
  const totalRecaudadoEl = document.getElementById('cuadreTotalRecaudadoTxt');
  const tbody = document.getElementById('cuadreTableBody');
  const footerTotal = document.getElementById('cuadreFooterTotal');
  const firmaCajero = document.getElementById('cuadreFirmaCajero');

  const esVistaTodos = state.activeTab === 'TODOS';
  const recibos = esVistaTodos ? (state.masterRecibos || state.historialRecibos || []) : (data.recibosDetalle || state.hoyRecibos || []);
  const totalRecaudado = recibos.reduce((sum, r) => sum + Number(r.monto || 0), 0);
  const totalRecibosCount = recibos.length;

  const fechaHoy = new Date().toLocaleDateString('es-EC', { year: 'numeric', month: 'long', day: 'numeric' });
  if (fechaEl) fechaEl.textContent = esVistaTodos ? 'Histórico General Consolidado' : fechaHoy;
  if (cajeroEl) cajeroEl.textContent = currentUser?.nombreCompleto || 'Cajero de Turno';
  if (firmaCajero) firmaCajero.textContent = currentUser?.nombreCompleto || 'Cajero Responsable';

  if (totalRecibosEl) totalRecibosEl.textContent = String(totalRecibosCount);
  if (totalRecaudadoEl) totalRecaudadoEl.textContent = `$${totalRecaudado.toFixed(2)} USD`;
  if (footerTotal) footerTotal.textContent = `$${totalRecaudado.toFixed(2)} USD`;

  if (tbody) {
    if (recibos.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 1.5rem; color: #94a3b8;">No hay recibos cobrados.</td></tr>`;
    } else {
      tbody.innerHTML = recibos.map((r) => `
        <tr>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1;"><strong>${r.numeroRecibo}</strong></td>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1; white-space: nowrap;">${r.fechaHora || r.hora || ''}</td>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1;">${r.socio || 'Socio'}</td>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1;">${r.socioCedula || '-'}</td>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1;">${r.numeroMedidor || '-'}</td>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center;">${r.metodoPago || 'EFECTIVO'}</td>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: 700;">$${Number(r.monto || 0).toFixed(2)}</td>
        </tr>
      `).join('');
    }
  }

  modal.style.display = 'flex';
}

/**
 * Registra egreso menor de caja chica (RN-14)
 */
async function registrarEgresoCaja() {
  const montoInput = document.getElementById('inputMontoGasto');
  const descInput = document.getElementById('inputDescGasto');
  const compInput = document.getElementById('inputComprobanteGasto');
  const modalGasto = document.getElementById('modalGasto');

  const monto = Number(montoInput?.value || 0);
  const motivo = descInput?.value?.trim() || '';
  const comprobante = compInput?.value?.trim() || '';

  if (monto <= 0) {
    Swal.fire('Error', 'Ingrese un monto mayor a cero.', 'error');
    return;
  }
  if (!motivo) {
    Swal.fire('Error', 'Debe especificar el motivo del egreso.', 'error');
    return;
  }

  try {
    const res = await apiFetch('/api/v1/caja/egresos', {
      method: 'POST',
      body: {
        monto,
        motivo,
        beneficiario: currentUser?.nombreCompleto || 'Responsable',
        comprobanteRespaldo: comprobante
      }
    });

    if (!res || !res.success) {
      throw new Error(res?.error || 'Error al registrar egreso.');
    }

    if (modalGasto) modalGasto.style.display = 'none';
    Swal.fire('Registrado', `Egreso de $${monto.toFixed(2)} registrado correctamente.`, 'success');
    await cargarCuadreYRecibosHoy();
  } catch (err) {
    console.error('Error registrando egreso:', err);
    Swal.fire('Error', err.message || 'No se pudo guardar el egreso.', 'error');
  }
}

/**
 * Abre modal para registrar nueva multa (RF-CAJ-09, RN-12)
 */
function abrirModalNuevaMulta() {
  if (!state.selectedSocio) {
    Swal.fire('Atención', 'Seleccione un socio antes de registrar una multa.', 'warning');
    return;
  }

  const modal = document.getElementById('modalMulta');
  const form = document.getElementById('formMulta');
  const title = document.getElementById('modalMultaTitle');
  const inputId = document.getElementById('inputMultaId');
  const selectTipo = document.getElementById('selectTipoRubroMulta');
  const inputMonto = document.getElementById('inputMontoMulta');

  if (form) form.reset();
  if (inputId) inputId.value = '';
  if (title) title.textContent = '⚖️ Registrar Multa / Rubro';

  // Al cambiar el tipo de multa sugerir monto
  if (selectTipo && inputMonto) {
    selectTipo.onchange = () => {
      const opt = selectTipo.options[selectTipo.selectedIndex];
      const sugerido = opt.getAttribute('data-monto');
      if (sugerido) inputMonto.value = sugerido;
    };
    selectTipo.dispatchEvent(new Event('change'));
  }

  if (modal) modal.style.display = 'flex';
}

/**
 * Abre modal para modificar una multa comunitaria existente (RF-CAJ-09)
 */
function abrirModalEditarMulta(item) {
  const modal = document.getElementById('modalMulta');
  const title = document.getElementById('modalMultaTitle');
  const inputId = document.getElementById('inputMultaId');
  const selectTipo = document.getElementById('selectTipoRubroMulta');
  const inputMotivo = document.getElementById('inputMotivoMulta');
  const inputMonto = document.getElementById('inputMontoMulta');

  if (title) title.textContent = '✏️ Modificar Multa / Rubro';
  if (inputId) inputId.value = item.idReferencia;
  if (inputMotivo) inputMotivo.value = item.concepto || '';
  if (inputMonto) inputMonto.value = Number(item.saldoPendiente || 0).toFixed(2);
  if (selectTipo) {
    const tipos = ['MINGA', 'ASAMBLEA', 'RECONEXION', 'CUOTA_EXTRA', 'OTRO'];
    selectTipo.value = tipos.includes(item.subtipo) ? item.subtipo : 'OTRO';
    selectTipo.onchange = null;
  }

  if (modal) modal.style.display = 'flex';
}

/**
 * Guarda o actualiza multa comunitaria (RF-CAJ-09, RN-12)
 */
async function guardarMultaSocio() {
  const modal = document.getElementById('modalMulta');
  const inputId = document.getElementById('inputMultaId');
  const selectTipo = document.getElementById('selectTipoRubroMulta');
  const inputMotivo = document.getElementById('inputMotivoMulta');
  const inputMonto = document.getElementById('inputMontoMulta');

  const multaId = inputId?.value;
  const tipo = selectTipo?.value || 'OTRO';
  const motivo = inputMotivo?.value?.trim() || '';
  const monto = Number(inputMonto?.value || 0);

  if (monto <= 0) {
    Swal.fire('Error', 'El valor de la multa debe ser mayor a cero.', 'error');
    return;
  }
  if (!motivo) {
    Swal.fire('Error', 'Ingrese una descripción para la multa.', 'error');
    return;
  }

  try {
    const sId = state.selectedSocio?.id || state.selectedSocio?.id_socio || state.deudasData?.socio?.id;
    if (!sId) {
      throw new Error('Seleccione primero un socio.');
    }

    const payload = {
      idSocio: sId,
      id_socio: sId,
      tipoRubro: tipo,
      tipo_rubro: tipo,
      motivo: motivo,
      descripcion: motivo,
      monto
    };

    let res;
    if (multaId) {
      res = await apiFetch(`/api/v1/multas/${encodeURIComponent(multaId)}`, {
        method: 'PUT',
        body: payload
      });
    } else {
      res = await apiFetch('/api/v1/multas', {
        method: 'POST',
        body: payload
      });
    }

    if (modal) modal.style.display = 'none';
    Swal.fire('Éxito', multaId ? 'Multa modificada correctamente.' : 'Multa registrada correctamente.', 'success');
    await cargarDeudasSocio(sId);
  } catch (err) {
    console.error('Error guardando multa:', err);
    Swal.fire('Error', err.message || 'No se pudo guardar la multa.', 'error');
  }
}

/**
 * Elimina una multa comunitaria no cobrada
 */
async function eliminarMulta(multaId) {
  const { isConfirmed } = await Swal.fire({
    title: '¿Eliminar Multa?',
    text: 'Esta sanción será removida de la ficha del socio.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, eliminar',
    confirmButtonColor: '#ef4444',
    cancelButtonText: 'Cancelar'
  });

  if (!isConfirmed) return;

  try {
    const sId = state.selectedSocio?.id || state.selectedSocio?.id_socio || state.deudasData?.socio?.id;
    const res = await apiFetch(`/api/v1/multas/${encodeURIComponent(multaId)}`, {
      method: 'DELETE'
    });

    if (res && res.error) {
      throw new Error(res.error);
    }

    Swal.fire('Eliminada', 'La multa ha sido removida.', 'success');
    if (sId) await cargarDeudasSocio(sId);
  } catch (err) {
    console.error('Error eliminando multa:', err);
    Swal.fire('Error', err.message || 'No se pudo eliminar la multa.', 'error');
  }
}
