/**
 * SIGA-Comunitario • Módulo 5: Reportes, Consultas y Auditoría
 * Generador de Informes de Morosidad, Sectores y Balance para Asamblea General
 */

import { requireAuth, getAuthToken } from './auth.js';
import { injectAppLayout } from './shared-layout.js';

// Guard de autenticación (Accesible por ADMIN y CAJERO)
const currentUser = requireAuth(['ADMIN', 'CAJERO']);
if (currentUser) {
  injectAppLayout('reportes');
}

let morosidadData = [];
let sectoresData = [];
let consolidadoData = null;

async function apiFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Error en la petición (${res.status})`);
  }
  return res.json();
}

async function cargarReporteMorosidad() {
  const tbody = document.getElementById('tbodyMorosidad');
  try {
    const res = await apiFetch('/api/v1/reportes/morosidad');
    const data = res.data || {};
    morosidadData = data.sociosMorosos || [];

    document.getElementById('kpiTotalMorosos').textContent = data.totalMorosos || 0;
    document.getElementById('kpiMontoMora').textContent = `$${Number(data.deudaTotalAcumulada || 0).toFixed(2)}`;

    const casosCorte = morosidadData.filter((s) => s.mesesAdeudados >= 3).length;
    document.getElementById('kpiCasosCorte').textContent = casosCorte;

    renderTablaMorosidad(morosidadData);
  } catch (err) {
    console.error('[Reportes] Error cargando morosidad:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #dc2626;">Error cargando morosidad: ${err.message}</td></tr>`;
    }
  }
}

function renderTablaMorosidad(socios) {
  const tbody = document.getElementById('tbodyMorosidad');
  if (!tbody) return;

  const minMeses = parseInt(document.getElementById('filtroMesesMora')?.value || '0', 10);
  const filtrados = socios.filter((s) => s.mesesAdeudados >= minMeses);

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: #16a34a; font-weight: 600;">✨ ¡Excelente! No existen socios en mora con el filtro seleccionado.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados
    .map((s) => {
      const esCorte = s.mesesAdeudados >= 3;
      const badgeEstado = esCorte
        ? '<span class="badge-status badge-cortado">🚨 CORTE INMEDIATO</span>'
        : '<span class="badge-status badge-suspendido">⚠️ EN MORA</span>';

      return `
        <tr>
          <td>
            <strong>${s.apellidos} ${s.nombres}</strong>
            <div style="font-size: 0.75rem; color: #64748b;">${s.codigoSocio || '-'}</div>
          </td>
          <td>${s.cedulaRuc || '-'}</td>
          <td>${s.nombreSector || '-'}</td>
          <td><code>${s.medidorNumero || '-'}</code></td>
          <td style="text-align: center; font-weight: 800; font-size: 1rem; color: ${esCorte ? '#dc2626' : '#f97316'};">
            ${s.mesesAdeudados} mes(es)
          </td>
          <td style="font-size: 0.8rem; color: #64748b;">${s.fechaDeudaMasAntigua ? s.fechaDeudaMasAntigua.split('T')[0] : 'Período actual'}</td>
          <td style="text-align: right; font-weight: 800; color: #dc2626; font-size: 1rem;">
            $${Number(s.deudaTotalPendiente || 0).toFixed(2)}
          </td>
          <td style="text-align: center;">${badgeEstado}</td>
        </tr>
      `;
    })
    .join('');
}

async function cargarReporteSectores() {
  const tbody = document.getElementById('tbodyPorSector');
  try {
    const res = await apiFetch('/api/v1/reportes/por-sector');
    sectoresData = res.data || [];
    renderTablaSectores(sectoresData);
  } catch (err) {
    console.error('[Reportes] Error cargando sectores:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #dc2626;">Error cargando balance por sectores: ${err.message}</td></tr>`;
    }
  }
}

function renderTablaSectores(sectores) {
  const tbody = document.getElementById('tbodyPorSector');
  if (!tbody) return;

  if (sectores.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: #64748b;">No hay datos de sectores registrados.</td></tr>`;
    return;
  }

  tbody.innerHTML = sectores
    .map((sec) => `
      <tr>
        <td>
          <strong>${sec.nombreSector}</strong>
          <div style="font-size: 0.75rem; color: #64748b;">Código: ${sec.codigoSector || '-'}</div>
        </td>
        <td style="text-align: center; font-weight: 700;">${sec.totalSocios}</td>
        <td style="text-align: right; font-weight: 600;">${Number(sec.consumoTotalM3 || 0).toFixed(1)} m³</td>
        <td style="text-align: right; font-weight: 700;">$${Number(sec.totalFacturado || 0).toFixed(2)}</td>
        <td style="text-align: right; font-weight: 800; color: #16a34a;">$${Number(sec.totalCobrado || 0).toFixed(2)}</td>
        <td style="text-align: right; font-weight: 800; color: #dc2626;">$${Number(sec.totalEnMora || 0).toFixed(2)}</td>
      </tr>
    `)
    .join('');
}

async function cargarReporteGestion() {
  try {
    const res = await apiFetch('/api/v1/reportes/consolidado');
    consolidadoData = res.data || {};
    renderInformeGestion(consolidadoData);
  } catch (err) {
    console.error('[Reportes] Error cargando informe de gestión:', err);
  }
}

function renderInformeGestion(data) {
  document.getElementById('gestionTotalSocios').textContent = data.totalSocios || 0;
  document.getElementById('gestionTotalIngresos').textContent = `$${Number(data.totalIngresos || 0).toFixed(2)}`;
  document.getElementById('gestionTotalEgresos').textContent = `$${Number(data.totalEgresos || 0).toFixed(2)}`;
  document.getElementById('gestionSaldoNeto').textContent = `$${Number(data.saldoNeto || 0).toFixed(2)}`;

  const rubrosBox = document.getElementById('desgloseRubrosBox');
  if (rubrosBox && data.desgloseIngresos) {
    rubrosBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding: 0.35rem 0;">
        <span>Tarifa Base Agua ($7 / $5):</span>
        <strong>$${Number(data.desgloseIngresos.baseAgua || 0).toFixed(2)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding: 0.35rem 0;">
        <span>Excedentes de Consumo (>30 m³):</span>
        <strong>$${Number(data.desgloseIngresos.excedentes || 0).toFixed(2)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding: 0.35rem 0;">
        <span>Servicio de Alcantarillado ($1.00):</span>
        <strong>$${Number(data.desgloseIngresos.alcantarillado || 0).toFixed(2)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 0.35rem 0;">
        <span>Multas (Mingas, Asambleas, etc.):</span>
        <strong>$${Number(data.desgloseIngresos.multas || 0).toFixed(2)}</strong>
      </div>
    `;
  }

  const fondosBox = document.getElementById('desgloseFondosBox');
  if (fondosBox && data.fondos) {
    fondosBox.innerHTML = data.fondos
      .map((f) => `
        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding: 0.35rem 0;">
          <span>${f.nombre}:</span>
          <strong style="color: ${f.saldo >= 0 ? '#0f172a' : '#dc2626'};">$${Number(f.saldo || 0).toFixed(2)}</strong>
        </div>
      `)
      .join('');
  }
}

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
    });
  });

  // Filtro de meses mora
  document.getElementById('filtroMesesMora')?.addEventListener('change', () => {
    renderTablaMorosidad(morosidadData);
  });

  // Botón Actualizar
  const btnRefrescar = document.getElementById('btnRefrescarReportes');
  btnRefrescar?.addEventListener('click', async () => {
    btnRefrescar.disabled = true;
    btnRefrescar.textContent = '⏳ Cargando...';
    await Promise.all([cargarReporteMorosidad(), cargarReporteSectores(), cargarReporteGestion()]);
    btnRefrescar.disabled = false;
    btnRefrescar.textContent = '🔄 Actualizar Datos';
  });

  // Botón Imprimir
  document.getElementById('btnImprimirReporte')?.addEventListener('click', () => {
    window.print();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  setupEventos();
  await Promise.all([cargarReporteMorosidad(), cargarReporteSectores(), cargarReporteGestion()]);
});
