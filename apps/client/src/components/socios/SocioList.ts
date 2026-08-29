import {
  socioService,
  type SocioFiltros,
  type EstadisticasSocios
} from '../../services/socioService.ts';
import { createSocioFormModal } from './SocioFormModal.ts';
import { createSocioDetailModal } from './SocioDetailModal.ts';
import type { SocioAgua, Sector } from '@app-agua/shared';

export function createSocioList(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'socio-module-container';

  let currentSectores: Sector[] = [];
  let filtros: SocioFiltros = {
    busqueda: '',
    sectorId: 'TODOS',
    estadoServicio: 'TODOS',
    esTerceraEdad: 'TODOS',
    estadoCuenta: 'TODOS'
  };

  // Header & Controls
  container.innerHTML = `
    <!-- Top Action Bar -->
    <div class="module-header">
      <div>
        <h2 class="module-title">👥 Módulo 1: Padrón de Socios y Consumidores</h2>
        <p class="module-subtitle">
          Administración de abonados, cálculo dinámico de 3ra Edad ($5.00), alcantarillado ($1.00) y control de morosidad.
        </p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" id="btnNuevoSocio">
          ➕ Registrar Nuevo Socio
        </button>
      </div>
    </div>

    <!-- Metrics Cards -->
    <div class="metrics-grid" id="sociosMetricsGrid">
      <div class="metric-card">
        <div class="metric-label">Total Padrón</div>
        <div class="metric-value text-blue" id="metricTotalSocios">0</div>
        <div class="metric-sub" id="metricActivosSub">0 activos</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">3ra Edad (Tarifa $5.00)</div>
        <div class="metric-value text-purple" id="metricTerceraEdad">0</div>
        <div class="metric-sub">Subsidio comunitario</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Con Alcantarillado (+1$)</div>
        <div class="metric-value text-cyan" id="metricAlcantarillado">0</div>
        <div class="metric-sub">Red de saneamiento</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Socios en Mora</div>
        <div class="metric-value text-red" id="metricEnMora">0</div>
        <div class="metric-sub" id="metricCarteraTotal">$0.00 pendiente</div>
      </div>
    </div>

    <!-- Search & Filter Controls -->
    <div class="filter-card">
      <div class="filter-row">
        <div class="filter-group search-flex">
          <label for="filterBusqueda">Buscar Socio / Cédula / Medidor</label>
          <div class="search-input-wrapper">
            <span class="search-icon">🔍</span>
            <input
              type="text"
              id="filterBusqueda"
              placeholder="Escribe nombre, apellido, cédula o número de medidor..."
              autocomplete="off"
            />
          </div>
        </div>

        <div class="filter-group">
          <label for="filterSector">Sector / Barrio</label>
          <select id="filterSector">
            <option value="TODOS">Todos los sectores</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="filterEstadoServicio">Estado Servicio</label>
          <select id="filterEstadoServicio">
            <option value="TODOS">Todos los estados</option>
            <option value="ACTIVO">🟢 Activo</option>
            <option value="SUSPENDIDO">🟡 Suspendido</option>
            <option value="CORTADO">🔴 Cortado</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="filterCondicion">Categoría / Edad</label>
          <select id="filterCondicion">
            <option value="TODOS">Todas las edades</option>
            <option value="SENIOR">👴 Tercera Edad (≥65)</option>
            <option value="NORMAL">👤 Normal (<65)</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="filterCuenta">Cuenta Corriente</label>
          <select id="filterCuenta">
            <option value="TODOS">Todos los estados</option>
            <option value="AL_DIA">✅ Al Día</option>
            <option value="EN_MORA">⚠️ En Mora</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Table Container -->
    <div class="table-container-card">
      <div class="table-header-info">
        <span id="tableCountLabel">Cargando socios...</span>
        <span class="table-perf-indicator">⚡ Respuesta IndexedDB: <strong id="queryPerfMs">0 ms</strong></span>
      </div>
      <div class="table-responsive">
        <table class="data-table" id="sociosTable">
          <thead>
            <tr>
              <th>Socio / Titular</th>
              <th>Cédula / RUC</th>
              <th>Edad / Categoría</th>
              <th>Sector</th>
              <th>Alcantarillado</th>
              <th>Tarifa Base</th>
              <th>Cuenta Corriente</th>
              <th>Estado</th>
              <th style="text-align: right;">Acciones</th>
            </tr>
          </thead>
          <tbody id="sociosTableBody">
            <!-- Renderizado dinámico -->
          </tbody>
        </table>
      </div>
    </div>
  `;

  const sociosMetricsGrid = container.querySelector('#sociosMetricsGrid') as HTMLElement;
  const filterBusqueda = container.querySelector('#filterBusqueda') as HTMLInputElement;
  const filterSector = container.querySelector('#filterSector') as HTMLSelectElement;
  const filterEstadoServicio = container.querySelector('#filterEstadoServicio') as HTMLSelectElement;
  const filterCondicion = container.querySelector('#filterCondicion') as HTMLSelectElement;
  const filterCuenta = container.querySelector('#filterCuenta') as HTMLSelectElement;
  const sociosTableBody = container.querySelector('#sociosTableBody') as HTMLElement;
  const tableCountLabel = container.querySelector('#tableCountLabel') as HTMLElement;
  const queryPerfMs = container.querySelector('#queryPerfMs') as HTMLElement;
  const btnNuevoSocio = container.querySelector('#btnNuevoSocio') as HTMLButtonElement;

  async function cargarDatos() {
    const t0 = performance.now();
    currentSectores = await socioService.getSectores();

    // Actualizar selector de sectores si está vacío
    if (filterSector.options.length <= 1) {
      currentSectores.forEach((sec) => {
        const opt = document.createElement('option');
        opt.value = sec.id;
        opt.textContent = `${sec.codigo} - ${sec.nombre}`;
        filterSector.appendChild(opt);
      });
    }

    // Actualizar Estadísticas
    const stats: EstadisticasSocios = await socioService.getEstadisticas();
    (container.querySelector('#metricTotalSocios') as HTMLElement).textContent = stats.total.toString();
    (container.querySelector('#metricActivosSub') as HTMLElement).textContent = `${stats.activos} activos | ${stats.suspendidos} susp.`;
    (container.querySelector('#metricTerceraEdad') as HTMLElement).textContent = stats.terceraEdad.toString();
    (container.querySelector('#metricAlcantarillado') as HTMLElement).textContent = stats.conAlcantarillado.toString();
    (container.querySelector('#metricEnMora') as HTMLElement).textContent = stats.enMora.toString();
    (container.querySelector('#metricCarteraTotal') as HTMLElement).textContent = `$${stats.montoTotalCarteraVencida.toFixed(2)} pendiente`;

    // Obtener socios filtrados
    const socios = await socioService.getSocios(filtros);
    const t1 = performance.now();
    queryPerfMs.textContent = `${(t1 - t0).toFixed(1)} ms`;
    tableCountLabel.textContent = `Mostrando ${socios.length} de ${stats.total} socios registrados`;

    renderTabla(socios);
  }

  function renderTabla(socios: SocioAgua[]) {
    if (socios.length === 0) {
      sociosTableBody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-state-cell">
            <div class="empty-state-box">
              <span style="font-size: 2rem;">🔍</span>
              <p style="font-size: 1rem; color: #94a3b8; margin: 8px 0;">No se encontraron socios con los filtros seleccionados.</p>
              <button class="btn btn-sm btn-secondary" id="btnLimpiarFiltros">Limpiar Filtros</button>
            </div>
          </td>
        </tr>
      `;
      sociosTableBody.querySelector('#btnLimpiarFiltros')?.addEventListener('click', () => {
        filterBusqueda.value = '';
        filterSector.value = 'TODOS';
        filterEstadoServicio.value = 'TODOS';
        filterCondicion.value = 'TODOS';
        filterCuenta.value = 'TODOS';
        filtros = { busqueda: '', sectorId: 'TODOS', estadoServicio: 'TODOS', esTerceraEdad: 'TODOS', estadoCuenta: 'TODOS' };
        cargarDatos();
      });
      return;
    }

    sociosTableBody.innerHTML = '';
    socios.forEach((socio) => {
      const tr = document.createElement('tr');

      const isMora = socio.estadoCuenta === 'EN_MORA' || socio.mesesAdeudados > 0;
      const statusBadgeClass =
        socio.estadoServicio === 'ACTIVO'
          ? 'status-badge-active'
          : socio.estadoServicio === 'SUSPENDIDO'
          ? 'status-badge-suspended'
          : 'status-badge-cut';

      tr.innerHTML = `
        <td>
          <div class="socio-cell-user">
            <div class="user-avatar-mini">${socio.esTerceraEdad ? '👴' : '👤'}</div>
            <div>
              <div class="user-name">${socio.nombreCompleto}</div>
              <div class="user-code">${socio.codigoSocio} ${socio.medidorNumero ? `• ${socio.medidorNumero}` : ''}</div>
            </div>
          </div>
        </td>
        <td>
          <span class="badge-code">${socio.cedulaRuc}</span>
        </td>
        <td>
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span class="age-badge ${socio.esTerceraEdad ? 'badge-senior' : 'badge-normal'}">
              ${socio.esTerceraEdad ? '👴 3ra Edad ($5)' : '👤 Normal ($7)'}
            </span>
            <span style="font-size: 0.75rem; color: #94a3b8;">${socio.edadCalculada} años</span>
          </div>
        </td>
        <td>
          <span class="sector-tag">${socio.nombreSector || socio.sectorId}</span>
        </td>
        <td>
          ${socio.tieneAlcantarillado ? '<span class="tag-yes">+$1.00 SÍ</span>' : '<span class="tag-no">NO</span>'}
        </td>
        <td>
          <strong class="text-accent">$${socio.tarifaBaseMensual.toFixed(2)}</strong>
          <span style="font-size: 0.75rem; color: #94a3b8;">/mes</span>
        </td>
        <td>
          ${
            isMora
              ? `<span class="badge-mora">⚠️ ${socio.mesesAdeudados}m ($${socio.montoTotalAdeudado?.toFixed(2) || '0.00'})</span>`
              : `<span class="badge-ok">✅ Al Día</span>`
          }
        </td>
        <td>
          <span class="status-badge ${statusBadgeClass}">${socio.estadoServicio}</span>
        </td>
        <td style="text-align: right;">
          <div class="action-buttons-group">
            <button class="btn-icon btn-action-view" title="Ver Ficha Completa" style="width: auto; padding: 0.25rem 0.65rem; gap: 4px; font-size: 0.82rem; font-weight: 600;" data-id="${socio.id}">
              👁️ Ver Ficha
            </button>
          </div>
        </td>
      `;

      // Evento de botón
      tr.querySelector('.btn-action-view')?.addEventListener('click', () => {
        abrirFichaDetalle(socio);
      });

      sociosTableBody.appendChild(tr);
    });
  }

  function abrirFormularioNuevo() {
    const modal = createSocioFormModal({
      sectores: currentSectores,
      onSave: () => cargarDatos(),
      onClose: () => {}
    });
    document.body.appendChild(modal);
  }

  function abrirFormularioEditar(socio: SocioAgua) {
    const modal = createSocioFormModal({
      socioToEdit: socio,
      sectores: currentSectores,
      onSave: () => cargarDatos(),
      onClose: () => {}
    });
    document.body.appendChild(modal);
  }

  function abrirFichaDetalle(socio: SocioAgua) {
    const modal = createSocioDetailModal({
      socio,
      onEdit: (s) => abrirFormularioEditar(s),
      onStatusChange: () => cargarDatos(),
      onClose: () => {}
    });
    document.body.appendChild(modal);
  }

  // Listeners de filtros
  filterBusqueda.addEventListener('input', () => {
    filtros.busqueda = filterBusqueda.value;
    cargarDatos();
  });

  filterSector.addEventListener('change', () => {
    filtros.sectorId = filterSector.value;
    cargarDatos();
  });

  filterEstadoServicio.addEventListener('change', () => {
    filtros.estadoServicio = filterEstadoServicio.value as any;
    cargarDatos();
  });

  filterCondicion.addEventListener('change', () => {
    const val = filterCondicion.value;
    filtros.esTerceraEdad = val === 'SENIOR' ? true : val === 'NORMAL' ? false : 'TODOS';
    cargarDatos();
  });

  filterCuenta.addEventListener('change', () => {
    filtros.estadoCuenta = filterCuenta.value as any;
    cargarDatos();
  });

  btnNuevoSocio.addEventListener('click', abrirFormularioNuevo);

  // Carga inicial
  cargarDatos();

  return container;
}
