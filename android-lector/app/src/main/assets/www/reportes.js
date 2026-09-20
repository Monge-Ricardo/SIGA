/**
 * SIGA-Comunitario • Módulo 5: Reportes, Consultas y Auditoría
 * Generador de Informes de Morosidad, Sectores, Balance de Asamblea y Auditoría (Comunicación Directa Supabase)
 */

import { requireAuth, apiFetch, normalizeSearchText, matchesSearchTokens } from './auth.js';
import { injectAppLayout } from './shared-layout.js';

// Auto-limpieza de bases de datos locales obsoletas (IndexedDB)
if (typeof window !== 'undefined' && window.indexedDB) {
  try {
    window.indexedDB.deleteDatabase('app_agua_db');
    window.indexedDB.deleteDatabase('siga_comunitario_db');
    window.indexedDB.deleteDatabase('sigalector_db');
  } catch (e) {
    console.warn('[Storage] Purge error:', e);
  }
}

// Guard de autenticación (Accesible por ADMIN, CAJERO, AUDITOR)
const currentUser = requireAuth(['ADMIN', 'CAJERO', 'AUDITOR']);
if (currentUser) {
  injectAppLayout('reportes');
}

let morosidadCache = [];
let sectoresCache = [];
let consolidadoCache = null;
let auditoriaCache = [];
let sectoresLista = [];

const FONDO_UI_CONFIG = {
  PADRE_PARROQUIA: { icon: '⛪' },
  OPERACION_MANT: { icon: '🔧' },
  PAGO_LECTOR: { icon: '⏱️' },
  MORTUORIO: { icon: '🕊️' },
  PRO_MEJORAS: { icon: '🏗️' },
  MULTAS_EXTRAS: { icon: '⚖️' },
  ALCANTARILLADO: { icon: '🌊' }
};

/**
 * Carga inicial de sectores para poblar filtros
 */
async function cargarSectoresFiltro() {
  try {
    const res = await apiFetch('/api/v1/sectores');
    sectoresLista = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);
    const select = document.getElementById('filtroSectorMora');
    if (select) {
      const prev = select.value;
      select.innerHTML = '<option value="">Todos los Sectores</option>' +
        sectoresLista.map((s) => `<option value="${s.id}">${s.nombre_sector || s.nombre}</option>`).join('');
      if (prev) select.value = prev;
    }
  } catch (err) {
    console.warn('[Reportes] No se pudo cargar lista de sectores:', err);
  }
}

// ==========================================
// 1. REPORTE DE MOROSIDAD
// ==========================================
async function cargarReporteMorosidad() {
  const tbody = document.getElementById('tbodyMorosidad');
  try {
    const res = await apiFetch('/api/v1/reportes/morosidad');
    const data = res.data || res || {};
    morosidadCache = data.sociosMorosos || data.morosos || [];

    document.getElementById('kpiTotalMorosos').textContent = data.totalMorosos ?? morosidadCache.length;
    document.getElementById('kpiMontoMora').textContent = `$${Number(data.deudaTotalAcumulada || 0).toFixed(2)}`;
    document.getElementById('kpiCasosCorte').textContent = data.casosCorte ?? morosidadCache.filter((s) => (s.mesesAdeudados || 0) >= 3).length;

    renderTablaMorosidad(morosidadCache);
  } catch (err) {
    console.error('[Reportes] Error cargando morosidad:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #dc2626; padding: 2rem;">Error cargando morosidad: ${err.message}</td></tr>`;
    }
  }
}

function renderTablaMorosidad(socios) {
  const tbody = document.getElementById('tbodyMorosidad');
  if (!tbody) return;

  const minMeses = parseInt(document.getElementById('filtroMesesMora')?.value || '0', 10);
  const sectorId = document.getElementById('filtroSectorMora')?.value || '';
  const busqueda = (document.getElementById('buscarMorosoInput')?.value || '').trim();

  let filtrados = socios;
  if (minMeses > 0) {
    filtrados = filtrados.filter((s) => (s.mesesAdeudados ?? s.mesesAtrasados ?? 0) >= minMeses);
  }
  if (sectorId) {
    filtrados = filtrados.filter((s) => s.idSector === sectorId);
  }
  if (busqueda) {
    filtrados = filtrados.filter((s) => {
      const composite = `${s.nombreCompleto || s.nombresCompletos || ''} ${s.cedulaRuc || ''} ${s.codigoSocio || ''} ${s.medidorNumero || ''} ${s.nombreSector || ''}`;
      return matchesSearchTokens(composite, busqueda);
    });
  }

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 2rem; color: #16a34a; font-weight: 600;">✨ ¡Excelente! No existen socios en mora con el filtro seleccionado.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados
    .map((s) => {
      const meses = s.mesesAdeudados ?? s.mesesAtrasados ?? 0;
      const esCorte = meses >= 3;
      const badgeEstado = esCorte
        ? '<span class="badge-status badge-cortado" style="background: #fee2e2; color: #991b1b; padding: 0.25rem 0.6rem; border-radius: 9999px; font-weight: 700; font-size: 0.75rem;">🚨 CORTE INMEDIATO</span>'
        : '<span class="badge-status badge-suspendido" style="background: #fef3c7; color: #92400e; padding: 0.25rem 0.6rem; border-radius: 9999px; font-weight: 700; font-size: 0.75rem;">⚠️ EN MORA</span>';

      const nombreSocio = s.nombreCompleto || s.nombresCompletos || 'Socio';
      const montoDeuda = Number(s.deudaTotal ?? s.deudaTotalPendiente ?? s.totalAdeudado ?? 0);
      const fechaAntigua = s.fechaDeudaMasAntigua;
      const fechaFormateada = fechaAntigua ? fechaAntigua.split('T')[0] : 'Ciclo actual';

      return `
        <tr>
          <td>
            <strong>${nombreSocio}</strong>
            <div style="font-size: 0.75rem; color: #64748b;">${s.codigoSocio || '-'}</div>
          </td>
          <td style="font-size: 0.85rem; font-family: monospace;">${s.cedulaRuc || '-'}</td>
          <td style="font-size: 0.85rem;">${s.nombreSector || '-'}</td>
          <td><code style="background: #f1f5f9; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.78rem;">${s.medidorNumero || 'S/M'}</code></td>
          <td style="text-align: center; font-weight: 800; font-size: 0.95rem; color: ${esCorte ? '#dc2626' : '#f97316'};">
            ${meses} mes(es)
          </td>
          <td style="font-size: 0.8rem; color: #64748b;">${fechaFormateada}</td>
          <td style="text-align: right; font-weight: 800; color: #dc2626; font-size: 1rem;">
            $${montoDeuda.toFixed(2)}
          </td>
          <td style="text-align: center;">${badgeEstado}</td>
          <td style="text-align: center;" class="no-print">
            <button class="btn btn-sm btn-secondary btn-ver-estado-cuenta" data-id="${s.socioId || s.idSocio}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">
              🔍 Ver
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.btn-ver-estado-cuenta').forEach((btn) => {
    btn.addEventListener('click', () => {
      const socioId = btn.getAttribute('data-id');
      abrirModalEstadoCuenta(socioId);
    });
  });
}

// ==========================================
// 2. CONSOLIDADO POR SECTOR
// ==========================================
async function cargarReporteSectores() {
  const tbody = document.getElementById('tbodyPorSector');
  try {
    const res = await apiFetch('/api/v1/reportes/por-sector');
    sectoresCache = res.data || res.sectores || (Array.isArray(res) ? res : []);
    renderTablaSectores(sectoresCache);
  } catch (err) {
    console.error('[Reportes] Error cargando balance por sectores:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #dc2626; padding: 2rem;">Error cargando balance por sectores: ${err.message}</td></tr>`;
    }
  }
}

function renderTablaSectores(sectores) {
  const tbody = document.getElementById('tbodyPorSector');
  if (!tbody) return;

  if (sectores.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: #64748b;">No hay sectores registrados en la base de datos.</td></tr>`;
    return;
  }

  tbody.innerHTML = sectores
    .map((sec) => {
      const facturado = Number(sec.totalFacturado ?? (Number(sec.totalCobrado || 0) + Number(sec.totalEnMora || 0)));
      const cobrado = Number(sec.totalCobrado ?? sec.totalRecaudado ?? 0);
      const mora = Number(sec.totalEnMora ?? sec.totalPendienteMora ?? 0);
      const consumo = Number(sec.consumoTotalM3 || 0);

      return `
        <tr>
          <td>
            <strong>${sec.nombreSector}</strong>
            <div style="font-size: 0.75rem; color: #64748b;">Código: ${sec.codigoSector || '-'}</div>
          </td>
          <td style="text-align: center; font-weight: 700;">${sec.totalSocios}</td>
          <td style="text-align: center; font-weight: 600;">${sec.totalMedidores || sec.totalSocios}</td>
          <td style="text-align: right; font-weight: 600;">${consumo.toFixed(2)} m³</td>
          <td style="text-align: right; font-weight: 700;">$${facturado.toFixed(2)}</td>
          <td style="text-align: right; font-weight: 800; color: #16a34a;">$${cobrado.toFixed(2)}</td>
          <td style="text-align: right; font-weight: 800; color: #dc2626;">$${mora.toFixed(2)}</td>
        </tr>
      `;
    })
    .join('');
}

// ==========================================
// 3. INFORME GENERAL DE GESTIÓN (ASAMBLEA)
// ==========================================
async function cargarReporteGestion() {
  try {
    const res = await apiFetch('/api/v1/reportes/consolidado');
    consolidadoCache = res.data || res || {};
    renderInformeGestion(consolidadoCache);
  } catch (err) {
    console.error('[Reportes] Error cargando consolidado de gestión:', err);
  }
}

function renderInformeGestion(data) {
  const fechaEl = document.getElementById('informeFechaEmision');
  if (fechaEl) {
    const f = data.fechaEmision || new Date().toISOString().split('T')[0];
    fechaEl.textContent = `Fecha de Emisión: ${f}`;
  }

  document.getElementById('gestionTotalSocios').textContent = data.totalSocios || 0;
  document.getElementById('gestionTotalIngresos').textContent = `$${Number(data.totalIngresos || 0).toFixed(2)}`;
  document.getElementById('gestionTotalEgresos').textContent = `$${Number(data.totalEgresos || 0).toFixed(2)}`;
  document.getElementById('gestionSaldoNeto').textContent = `$${Number(data.saldoNeto || 0).toFixed(2)}`;

  const rubrosBox = document.getElementById('desgloseRubrosBox');
  if (rubrosBox && data.desgloseIngresos) {
    rubrosBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding: 0.4rem 0;">
        <span>Tarifa Base Agua Potable ($7 / $5):</span>
        <strong style="color: #0f172a;">$${Number(data.desgloseIngresos.baseAgua || 0).toFixed(2)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding: 0.4rem 0;">
        <span>Excedentes de Consumo (>30 m³):</span>
        <strong style="color: #0f172a;">$${Number(data.desgloseIngresos.excedentes || 0).toFixed(2)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding: 0.4rem 0;">
        <span>Servicio de Alcantarillado ($1.00):</span>
        <strong style="color: #0f172a;">$${Number(data.desgloseIngresos.alcantarillado || 0).toFixed(2)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 0.4rem 0;">
        <span>Multas Comunitarias y Mingas:</span>
        <strong style="color: #0f172a;">$${Number(data.desgloseIngresos.multas || 0).toFixed(2)}</strong>
      </div>
    `;
  }

  const fondosBox = document.getElementById('desgloseFondosBox');
  if (fondosBox && data.fondos) {
    fondosBox.innerHTML = data.fondos
      .map((f) => {
        const ui = FONDO_UI_CONFIG[f.codigo] || { icon: '🏛️' };
        const sal = Number(f.saldo || 0);
        return `
          <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding: 0.4rem 0;">
            <span>${ui.icon} ${f.nombre}:</span>
            <strong style="color: ${sal >= 0 ? '#16a34a' : '#dc2626'};">$${sal.toFixed(2)}</strong>
          </div>
        `;
      })
      .join('');
  }
}

// ==========================================
// 4. AUDITORÍA DE TRANSACCIONES
// ==========================================
async function cargarReporteAuditoria() {
  const tbody = document.getElementById('tbodyAuditoria');
  try {
    const res = await apiFetch('/api/v1/reportes/auditoria');
    auditoriaCache = res.data || [];
    renderTablaAuditoria(auditoriaCache);
  } catch (err) {
    console.error('[Reportes] Error cargando auditoría:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #dc2626; padding: 2rem;">Error cargando auditoría: ${err.message}</td></tr>`;
    }
  }
}

function renderTablaAuditoria(logs) {
  const tbody = document.getElementById('tbodyAuditoria');
  if (!tbody) return;

  const tipo = document.getElementById('auditTipoSelect')?.value || '';
  const fDesde = document.getElementById('auditFechaDesde')?.value || '';
  const fHasta = document.getElementById('auditFechaHasta')?.value || '';
  const busqueda = (document.getElementById('auditBuscarInput')?.value || '').trim();

  let filtrados = logs;
  if (tipo) {
    filtrados = filtrados.filter((l) => l.tipo === tipo);
  }
  if (fDesde) {
    filtrados = filtrados.filter((l) => String(l.fecha) >= fDesde);
  }
  if (fHasta) {
    filtrados = filtrados.filter((l) => String(l.fecha) <= fHasta);
  }
  if (busqueda) {
    filtrados = filtrados.filter((l) => {
      const composite = `${l.concepto || ''} ${l.numeroComprobante || ''} ${l.socioBeneficiario || ''} ${l.nombreFondo || ''} ${l.responsable || ''}`;
      return matchesSearchTokens(composite, busqueda);
    });
  }

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: #64748b;">No se encontraron registros de auditoría con los filtros aplicados.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados
    .map((l) => {
      const fecha = l.fecha ? new Date(l.fecha).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : '-';
      const esIngreso = l.tipo === 'INGRESO';
      const ui = FONDO_UI_CONFIG[l.codigoFondo] || { icon: '🏛️' };
      const montoStr = esIngreso ? `+$${Number(l.monto || 0).toFixed(2)}` : `-$${Number(l.monto || 0).toFixed(2)}`;
      const montoColor = esIngreso ? '#16a34a' : '#dc2626';

      return `
        <tr>
          <td style="font-size: 0.8rem; color: #64748b; white-space: nowrap;">${fecha}</td>
          <td style="text-align: center;">
            <span style="background: ${esIngreso ? '#dcfce7' : '#fee2e2'}; color: ${esIngreso ? '#15803d' : '#b91c1c'}; padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700;">
              ${l.tipo}
            </span>
          </td>
          <td>
            <div style="font-weight: 600; font-size: 0.82rem; display: flex; align-items: center; gap: 0.35rem;">
              <span>${ui.icon}</span> <span>${l.nombreFondo}</span>
            </div>
          </td>
          <td style="font-size: 0.85rem; color: #1e293b;">${l.concepto}</td>
          <td><code style="background: #f1f5f9; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.78rem;">${l.numeroComprobante}</code></td>
          <td style="text-align: right; font-weight: 800; font-size: 0.9rem; color: ${montoColor};">${montoStr}</td>
          <td style="font-size: 0.82rem; font-weight: 500;">${l.socioBeneficiario}</td>
          <td style="font-size: 0.78rem; color: #64748b;">${l.responsable}</td>
        </tr>
      `;
    })
    .join('');
}

// ==========================================
// 5. MODAL DE ESTADO DE CUENTA DETALLADO
// ==========================================
async function abrirModalEstadoCuenta(socioId) {
  const modal = document.getElementById('modalEstadoCuenta');
  const container = document.getElementById('estadoCuentaDetalleContainer');
  if (!modal || !container) return;

  container.innerHTML = '<div style="text-align: center; color: #64748b; padding: 2rem;">Cargando estado de cuenta desde Supabase...</div>';
  modal.style.display = 'flex';

  try {
    const res = await apiFetch(`/api/v1/reportes/socio/${socioId}`);
    const data = res.data || res;
    const { socio, resumenFinanciero, facturas, lecturas, medidores } = data;

    container.innerHTML = `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem;">
          <h4 style="margin: 0; font-size: 1.1rem; color: #0f172a;">${socio.nombreCompleto}</h4>
          <span style="font-size: 0.8rem; background: #e0f2fe; color: #0369a1; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">
            Código: ${socio.codigoSocio || 'S/N'}
          </span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.5rem; font-size: 0.82rem; color: #475569;">
          <div>Cédula: <strong>${socio.cedulaRuc || '-'}</strong></div>
          <div>Teléfono: <strong>${socio.telefono || '-'}</strong></div>
          <div>Medidor(es): <strong>${medidores.map(m => m.numero_medidor).join(', ') || 'S/M'}</strong></div>
          <div>Tercera Edad: <strong>${socio.esTerceraEdad ? 'Sí (Tarifa $5)' : 'No (Tarifa $7)'}</strong></div>
        </div>
      </div>

      <div class="kpi-cards-grid" style="margin-bottom: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));">
        <div class="kpi-card" style="padding: 0.85rem;">
          <div class="kpi-label" style="font-size: 0.72rem;">Total Facturado</div>
          <div class="kpi-value" style="font-size: 1.2rem;">$${Number(resumenFinanciero.totalFacturado || 0).toFixed(2)}</div>
        </div>
        <div class="kpi-card" style="padding: 0.85rem;">
          <div class="kpi-label" style="font-size: 0.72rem;">Total Pagado</div>
          <div class="kpi-value" style="font-size: 1.2rem; color: #16a34a;">$${Number(resumenFinanciero.totalPagado || 0).toFixed(2)}</div>
        </div>
        <div class="kpi-card" style="padding: 0.85rem;">
          <div class="kpi-label" style="font-size: 0.72rem;">Deuda Pendiente</div>
          <div class="kpi-value" style="font-size: 1.2rem; color: #dc2626;">$${Number(resumenFinanciero.totalPendiente || 0).toFixed(2)}</div>
        </div>
      </div>

      <h4 style="font-size: 0.95rem; font-weight: 700; color: #0f172a; margin: 1rem 0 0.5rem 0;">Historial de Facturas</h4>
      <div class="table-responsive" style="max-height: 250px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px;">
        <table class="table" style="font-size: 0.82rem; margin: 0;">
          <thead>
            <tr>
              <th>N° Factura</th>
              <th>Emisión</th>
              <th style="text-align: right;">Consumo</th>
              <th style="text-align: right;">Total</th>
              <th style="text-align: center;">Estado</th>
              <th>Fecha Pago</th>
            </tr>
          </thead>
          <tbody>
            ${facturas.length === 0 ? '<tr><td colspan="6" style="text-align:center; padding:1rem;">No registra facturas</td></tr>' : 
              facturas.map(f => {
                const esPagado = f.estado_pago === 'PAGADO';
                const fPago = f.fecha_pago ? f.fecha_pago.split('T')[0] : '-';
                return `
                  <tr>
                    <td><code>${f.numero_factura || f.id.slice(0,8)}</code></td>
                    <td>${(f.fecha_emision || f.created_at || '').split('T')[0]}</td>
                    <td style="text-align: right;">${Number(f.consumo_total_m3 || f.consumo_m3 || 0).toFixed(1)} m³</td>
                    <td style="text-align: right; font-weight: 700;">$${Number(f.total_pagar || 0).toFixed(2)}</td>
                    <td style="text-align: center;">
                      <span style="background: ${esPagado ? '#dcfce7' : '#fee2e2'}; color: ${esPagado ? '#15803d' : '#b91c1c'}; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 700; font-size: 0.72rem;">
                        ${f.estado_pago}
                      </span>
                    </td>
                    <td>${fPago}</td>
                  </tr>
                `;
              }).join('')
            }
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="text-align: center; color: #dc2626; padding: 2rem;">Error cargando estado de cuenta: ${err.message}</div>`;
  }
}

function cerrarModalEstadoCuenta() {
  const modal = document.getElementById('modalEstadoCuenta');
  if (modal) modal.style.display = 'none';
}

// ==========================================
// 6. CONFIGURACIÓN DE EVENTOS
// ==========================================
function setupEventos() {
  // Pestañas
  const tabButtons = document.querySelectorAll('.report-tab-btn');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.getAttribute('data-tab');
      document.getElementById('tabContentMorosidad').style.display = tab === 'morosidad' ? 'block' : 'none';
      document.getElementById('tabContentSectores').style.display = tab === 'sectores' ? 'block' : 'none';
      document.getElementById('tabContentGestion').style.display = tab === 'gestion' ? 'block' : 'none';
      document.getElementById('tabContentAuditoria').style.display = tab === 'auditoria' ? 'block' : 'none';

      // Carga bajo demanda si la pestaña no se ha cargado aún
      if (tab === 'sectores' && sectoresCache.length === 0) cargarReporteSectores();
      if (tab === 'gestion' && !consolidadoCache) cargarReporteGestion();
      if (tab === 'auditoria' && auditoriaCache.length === 0) cargarReporteAuditoria();
    });
  });

  // Filtros de Morosidad
  document.getElementById('filtroMesesMora')?.addEventListener('change', () => renderTablaMorosidad(morosidadCache));
  document.getElementById('filtroSectorMora')?.addEventListener('change', () => renderTablaMorosidad(morosidadCache));
  document.getElementById('buscarMorosoInput')?.addEventListener('input', () => renderTablaMorosidad(morosidadCache));

  // Filtros de Auditoría
  document.getElementById('auditTipoSelect')?.addEventListener('change', () => renderTablaAuditoria(auditoriaCache));
  document.getElementById('auditFechaDesde')?.addEventListener('change', () => renderTablaAuditoria(auditoriaCache));
  document.getElementById('auditFechaHasta')?.addEventListener('change', () => renderTablaAuditoria(auditoriaCache));
  document.getElementById('auditBuscarInput')?.addEventListener('input', () => renderTablaAuditoria(auditoriaCache));

  // Modal Estado de Cuenta
  document.getElementById('btnCerrarModalEstadoCuenta')?.addEventListener('click', cerrarModalEstadoCuenta);
  document.getElementById('btnCerrarModalEstadoCuentaBtn')?.addEventListener('click', cerrarModalEstadoCuenta);

  // Botón Actualizar
  const btnRefrescar = document.getElementById('btnRefrescarReportes');
  btnRefrescar?.addEventListener('click', async () => {
    btnRefrescar.disabled = true;
    btnRefrescar.textContent = '⏳ Cargando...';
    await Promise.all([
      cargarSectoresFiltro(),
      cargarReporteMorosidad(),
      cargarReporteSectores(),
      cargarReporteGestion(),
      cargarReporteAuditoria()
    ]);
    btnRefrescar.disabled = false;
    btnRefrescar.textContent = '🔄 Actualizar Datos';
  });

  // Botón Imprimir
  document.getElementById('btnImprimirReporte')?.addEventListener('click', () => {
    window.print();
  });
}

async function initReportes() {
  setupEventos();
  await Promise.all([cargarSectoresFiltro(), cargarReporteMorosidad()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReportes);
} else {
  initReportes();
}
