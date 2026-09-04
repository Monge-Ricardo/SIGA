import { lecturaService } from '../../services/lecturaService.ts';
import { socioService } from '../../services/socioService.ts';
import { authService } from '../../services/auth.ts';
import type { SocioAgua, Sector, LecturaMedidor } from '@app-agua/shared';

const BASELINE_LECTURAS: Record<string, number> = {
  'soc-001': 150,
  'soc-002': 210,
  'soc-003': 95,
  'soc-004': 180
};

const LECTURAS_INICIALES_LECTOR: Record<string, { lecturaAnterior: number; lecturaActual: number; observaciones: string }> = {
  'soc-001': { lecturaAnterior: 150, lecturaActual: 185, observaciones: 'Digitado por Lector en campo' },
  'soc-002': { lecturaAnterior: 210, lecturaActual: 238, observaciones: 'Digitado por Lector en campo' },
  'soc-003': { lecturaAnterior: 95, lecturaActual: 122, observaciones: 'Digitado por Lector en campo' },
  'soc-004': { lecturaAnterior: 180, lecturaActual: 222, observaciones: 'Digitado por Lector en campo' }
};

export function createLecturaList(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'lectura-module-container';

  let currentSectores: Sector[] = [];
  let currentSocios: SocioAgua[] = [];
  let currentLecturas: LecturaMedidor[] = [];
  let currentPeriodo = '2026-08';
  let currentSectorId = 'TODOS';
  let busquedaTexto = '';

  const rowStateMap = new Map<string, any>();

  container.innerHTML = `
    <!-- Top Action Bar -->
    <div class="module-header">
      <div>
        <h2 class="module-title">⏱️ Módulo 2: Micromedición y Toma de Lecturas</h2>
        <p class="module-subtitle">
          Captura rápida de lecturas en campo por sector, validación Lact ≥ Lant, cálculo automático de consumo y excedente (&gt;30m³).
        </p>
      </div>
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <button class="btn btn-secondary" id="btnCierreCicloApp">
          🔒 Cerrar Ciclo Mensual
        </button>
        <button class="btn btn-success" id="btnGuardarLoteApp">
          💾 Guardar Todo el Lote
        </button>
      </div>
    </div>

    <!-- Metrics Grid -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Medidores en Ruta</div>
        <div class="metric-value text-blue" id="metricTotalMedidoresApp">0</div>
        <div class="metric-sub" id="metricSectorSubApp">Ruta general</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Lecturas Tomadas</div>
        <div class="metric-value text-green" id="metricLecturasTomadasApp">0</div>
        <div class="metric-sub" id="metricAvancePctApp">0% completado</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Lecturas Pendientes</div>
        <div class="metric-value text-red" id="metricLecturasPendientesApp">0</div>
        <div class="metric-sub">Por registrar en campo</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Consumo Total Mes</div>
        <div class="metric-value text-accent" id="metricConsumoTotalApp">0 m³</div>
        <div class="metric-sub" id="metricExcedenteTotalApp">0 m³ de excedente</div>
      </div>
    </div>

    <!-- Route Controls Card -->
    <div class="filter-card">
      <div class="filter-row">
        <div class="filter-group">
          <label for="selectPeriodoApp">📅 Período de Facturación</label>
          <select id="selectPeriodoApp" style="font-weight: 700;">
            <option value="2026-08" selected>2026-08 (Agosto 2026 - Actual)</option>
            <option value="2026-07">2026-07 (Julio 2026)</option>
            <option value="2026-06">2026-06 (Junio 2026)</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="selectSectorRutaApp">📍 Sector / Ruta del Lector</label>
          <select id="selectSectorRutaApp">
            <option value="TODOS">Todos los sectores comunitarios</option>
          </select>
        </div>

        <div class="filter-group search-flex">
          <label for="searchSocioLecturaApp">🔍 Filtrar por Nombre, Cédula o Medidor</label>
          <div class="search-input-wrapper">
            <span class="search-icon">🔍</span>
            <input
              type="text"
              id="searchSocioLecturaApp"
              placeholder="Buscar en la ruta..."
              autocomplete="off"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Route Table -->
    <div class="table-container-card">
      <div class="table-header-info">
        <span id="routeTableCountApp">Cargando medidores de la ruta...</span>
        <span class="table-perf-indicator">⚡ Regla: Base fija 30 m³ • Excedente $0.10/m³</span>
      </div>
      <div class="table-responsive">
        <table class="data-table" id="lecturasTableApp">
          <thead>
            <tr>
              <th>Abonado / Medidor</th>
              <th>Sector</th>
              <th style="text-align: right;">Lectura Anterior (L<sub>ant</sub>)</th>
              <th style="text-align: right; min-width: 140px;">Lectura Actual (L<sub>act</sub>)</th>
              <th style="text-align: right;">Consumo (C<sub>m</sub>)</th>
              <th style="text-align: right;">Excedente (&gt;30m³)</th>
              <th>Estado</th>
              <th style="text-align: right;">Acción</th>
            </tr>
          </thead>
          <tbody id="lecturasTableBodyApp">
            <!-- Renderizado dinámico -->
          </tbody>
        </table>
      </div>
    </div>
  `;

  const selectPeriodoApp = container.querySelector('#selectPeriodoApp') as HTMLSelectElement;
  const selectSectorRutaApp = container.querySelector('#selectSectorRutaApp') as HTMLSelectElement;
  const searchSocioLecturaApp = container.querySelector('#searchSocioLecturaApp') as HTMLInputElement;
  const lecturasTableBodyApp = container.querySelector('#lecturasTableBodyApp') as HTMLElement;
  const routeTableCountApp = container.querySelector('#routeTableCountApp') as HTMLElement;

  async function cargarDatos() {
    currentSectores = await socioService.getSectores();
    currentSocios = await socioService.getSocios();
    currentLecturas = await lecturaService.getLecturasPorPeriodo(currentPeriodo);

    // Poblar selector de sectores
    if (selectSectorRutaApp.options.length <= 1) {
      currentSectores.forEach((sec) => {
        const opt = document.createElement('option');
        opt.value = sec.id;
        opt.textContent = `${sec.codigo} - ${sec.nombre}`;
        selectSectorRutaApp.appendChild(opt);
      });
    }

    renderTabla();
  }

  function renderTabla() {
    let sociosRuta = currentSocios.filter((s) => {
      if (currentSectorId !== 'TODOS' && s.sectorId !== currentSectorId) return false;
      if (busquedaTexto) {
        const match =
          s.nombreCompleto.toLowerCase().includes(busquedaTexto) ||
          s.cedulaRuc.toLowerCase().includes(busquedaTexto) ||
          (s.medidorNumero && s.medidorNumero.toLowerCase().includes(busquedaTexto));
        if (!match) return false;
      }
      return true;
    });

    routeTableCountApp.textContent = `Mostrando ${sociosRuta.length} medidores en la ruta del sector`;

    let totalTomadas = 0;
    let totalConsumoM3 = 0;
    let totalExcedenteM3 = 0;

    lecturasTableBodyApp.innerHTML = '';

    if (sociosRuta.length === 0) {
      lecturasTableBodyApp.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: #64748b; padding: 2.5rem;">
            🔍 No se encontraron medidores con los filtros seleccionados.
          </td>
        </tr>
      `;
      actualizarMetricas(0, 0, 0, 0);
      return;
    }

    sociosRuta.forEach((socio) => {
      const existingLectura = currentLecturas.find((l) => l.clienteId === socio.id);
      const fallbackLector = currentPeriodo === '2026-08' ? LECTURAS_INICIALES_LECTOR[socio.id] : undefined;

      const lecturaAnterior = existingLectura?.lecturaAnterior ?? fallbackLector?.lecturaAnterior ?? (BASELINE_LECTURAS[socio.id] || 100);
      const lecturaActual = existingLectura?.lecturaActual ?? fallbackLector?.lecturaActual;
      const isTomada = lecturaActual !== undefined && lecturaActual !== null;
      const esModificado = existingLectura?.observaciones?.includes('Cajero');

      let consumo = 0;
      let excedente = 0;

      if (isTomada) {
        consumo = Math.max(0, lecturaActual - lecturaAnterior);
        excedente = Math.max(0, consumo - 30);
        totalTomadas++;
        totalConsumoM3 += consumo;
        totalExcedenteM3 += excedente;
      }

      const tr = document.createElement('tr');
      tr.id = `app-row-${socio.id}`;

      tr.innerHTML = `
        <td>
          <div class="socio-cell-user">
            <div class="user-avatar-mini">${socio.esTerceraEdad ? '👴' : '👤'}</div>
            <div>
              <div class="user-name">${socio.nombreCompleto}</div>
              <div class="user-code">${socio.codigoSocio} • <span class="badge-code">${socio.medidorNumero || 'MED-AUTO'}</span></div>
            </div>
          </div>
        </td>
        <td><span class="sector-tag">${socio.nombreSector || socio.sectorId}</span></td>
        <td style="text-align: right; font-weight: 700; color: #475569;">
          <span>${lecturaAnterior}</span> m³
        </td>
        <td style="text-align: right;">
          <div style="display: inline-flex; flex-direction: column; align-items: flex-end; gap: 2px;">
            <input
              type="number"
              class="reading-input ${isTomada ? 'input-saved' : ''}"
              id="app-lact-${socio.id}"
              value="${isTomada ? lecturaActual : ''}"
              placeholder="${lecturaAnterior}"
              min="${lecturaAnterior}"
              ${isTomada ? 'readonly' : ''}
              style="width: 105px; text-align: right; font-weight: 800;"
            />
            <span id="app-hint-${socio.id}" style="font-size: 0.72rem; color: ${esModificado ? '#059669' : '#0284c7'}; font-weight: 600;">
              ${isTomada ? (esModificado ? '✓ Modificado por Cajero' : '👤 Digitado por Lector') : '⏳ Pendiente'}
            </span>
          </div>
          <div class="reading-alert-msg" id="app-alert-${socio.id}" style="display: none;"></div>
        </td>
        <td style="text-align: right;" id="app-consumo-cell-${socio.id}">
          ${
            isTomada
              ? `<span class="consumption-pill">${consumo} m³</span>`
              : `<span style="color: #94a3b8;">-</span>`
          }
        </td>
        <td style="text-align: right;" id="app-excedente-cell-${socio.id}">
          ${
            isTomada
              ? excedente > 0
                ? `<span class="excess-pill">+${excedente} m³ (+$${(excedente * 0.10).toFixed(2)})</span>`
                : `<span style="color: #64748b;">0 m³ ($0.00)</span>`
              : `<span style="color: #94a3b8;">-</span>`
          }
        </td>
        <td id="app-status-cell-${socio.id}">
          ${
            isTomada
              ? `<span class="status-badge status-badge-active">✅ Tomada</span>`
              : `<span class="status-badge status-badge-suspended">⏳ Pendiente</span>`
          }
        </td>
        <td style="text-align: right;">
          <button class="btn btn-sm ${isTomada ? 'btn-outline' : 'btn-primary'}" id="app-btn-action-${socio.id}" style="min-width: 85px;">
            ${isTomada ? '✏️ Editar' : '💾 Guardar'}
          </button>
        </td>
      `;

      const inputLact = tr.querySelector(`#app-lact-${socio.id}`) as HTMLInputElement;
      const alertBox = tr.querySelector(`#app-alert-${socio.id}`) as HTMLElement;
      const consumoCell = tr.querySelector(`#app-consumo-cell-${socio.id}`) as HTMLElement;
      const excedenteCell = tr.querySelector(`#app-excedente-cell-${socio.id}`) as HTMLElement;
      const hintEl = tr.querySelector(`#app-hint-${socio.id}`) as HTMLElement;
      const btnAction = tr.querySelector(`#app-btn-action-${socio.id}`) as HTMLButtonElement;

      let isEditing = !isTomada;

      function enterEdit() {
        isEditing = true;
        inputLact.readOnly = false;
        inputLact.style.borderColor = '#0284c7';
        inputLact.style.backgroundColor = '#ffffff';
        btnAction.textContent = '💾 Guardar';
        btnAction.className = 'btn btn-sm btn-success';
        btnAction.disabled = false;
        hintEl.textContent = '✏️ Editando lectura...';
        hintEl.style.color = '#b45309';
        inputLact.focus();
        inputLact.select();
      }

      function exitEdit(guardado: boolean, valActual: number) {
        isEditing = false;
        inputLact.readOnly = true;
        inputLact.style.borderColor = '#86efac';
        inputLact.style.backgroundColor = '#f0fdf4';
        btnAction.textContent = '✏️ Editar';
        btnAction.className = 'btn btn-sm btn-outline';
        btnAction.disabled = false;
        if (guardado) {
          hintEl.textContent = '✓ Modificado por Cajero';
          hintEl.style.color = '#059669';
        }
      }

      function validarCalculo() {
        const valStr = inputLact.value.trim();
        if (valStr === '') {
          inputLact.classList.remove('reading-input-invalid');
          alertBox.style.display = 'none';
          consumoCell.innerHTML = '<span style="color: #94a3b8;">-</span>';
          excedenteCell.innerHTML = '<span style="color: #94a3b8;">-</span>';
          btnAction.disabled = true;
          rowStateMap.delete(socio.id);
          return;
        }

        const lactNum = parseFloat(valStr);
        if (isNaN(lactNum)) return;

        const res = lecturaService.calcularConsumo(lecturaAnterior, lactNum);
        if (!res.valida) {
          inputLact.classList.add('reading-input-invalid');
          alertBox.textContent = `⚠️ Error: L_act (${lactNum}) < L_ant (${lecturaAnterior})`;
          alertBox.style.display = 'block';
          consumoCell.innerHTML = '<span style="color: #dc2626; font-weight: 700;">Inválido</span>';
          excedenteCell.innerHTML = '<span style="color: #dc2626;">-</span>';
          btnAction.disabled = true;
          rowStateMap.set(socio.id, { valid: false });
        } else {
          inputLact.classList.remove('reading-input-invalid');
          alertBox.style.display = 'none';
          btnAction.disabled = false;

          consumoCell.innerHTML = `<span class="consumption-pill">${res.consumoM3} m³</span>`;
          if (res.excedenteM3 > 0) {
            excedenteCell.innerHTML = `<span class="excess-pill">+${res.excedenteM3} m³ (+$${res.valorExcedenteUSD.toFixed(2)})</span>`;
          } else {
            excedenteCell.innerHTML = `<span style="color: #64748b;">0 m³ ($0.00)</span>`;
          }

          rowStateMap.set(socio.id, {
            valid: true,
            clienteId: socio.id,
            periodo: currentPeriodo,
            lecturaAnterior,
            lecturaActual: lactNum
          });
        }
      }

      inputLact.addEventListener('input', validarCalculo);

      btnAction.addEventListener('click', async () => {
        if (!isEditing) {
          enterEdit();
          return;
        }

        validarCalculo();
        const state = rowStateMap.get(socio.id);
        if (!state || !state.valid) {
          alert('Por favor ingrese un valor de lectura válido.');
          return;
        }

        btnAction.disabled = true;
        btnAction.textContent = 'Guardando...';

        const currentUser = authService.getCurrentUser();
        await lecturaService.guardarLectura(
          socio.id,
          currentPeriodo,
          lecturaAnterior,
          state.lecturaActual,
          currentUser?.id || 'usr-cajero'
        );

        const statusCell = tr.querySelector(`#app-status-cell-${socio.id}`) as HTMLElement;
        statusCell.innerHTML = `<span class="status-badge status-badge-active">✅ Tomada</span>`;
        exitEdit(true, state.lecturaActual);

        currentLecturas = await lecturaService.getLecturasPorPeriodo(currentPeriodo);
        cargarDatos();
      });

      lecturasTableBodyApp.appendChild(tr);
    });

    actualizarMetricas(sociosRuta.length, totalTomadas, totalConsumoM3, totalExcedenteM3);
  }

  function actualizarMetricas(totalMedidores: number, tomadas: number, consumo: number, excedente: number) {
    const pendientes = Math.max(0, totalMedidores - tomadas);
    const pct = totalMedidores > 0 ? ((tomadas / totalMedidores) * 100).toFixed(0) : '0';

    (container.querySelector('#metricTotalMedidoresApp') as HTMLElement).textContent = totalMedidores.toString();
    (container.querySelector('#metricLecturasTomadasApp') as HTMLElement).textContent = tomadas.toString();
    (container.querySelector('#metricAvancePctApp') as HTMLElement).textContent = `${pct}% de la ruta completado`;
    (container.querySelector('#metricLecturasPendientesApp') as HTMLElement).textContent = pendientes.toString();
    (container.querySelector('#metricConsumoTotalApp') as HTMLElement).textContent = `${consumo} m³`;
    (container.querySelector('#metricExcedenteTotalApp') as HTMLElement).textContent = `${excedente} m³ de excedente ($${(excedente * 0.10).toFixed(2)})`;
  }

  selectPeriodoApp.addEventListener('change', () => {
    currentPeriodo = selectPeriodoApp.value;
    cargarDatos();
  });

  selectSectorRutaApp.addEventListener('change', () => {
    currentSectorId = selectSectorRutaApp.value;
    renderTabla();
  });

  searchSocioLecturaApp.addEventListener('input', () => {
    busquedaTexto = searchSocioLecturaApp.value.toLowerCase().trim();
    renderTabla();
  });

  container.querySelector('#btnGuardarLoteApp')?.addEventListener('click', async () => {
    const currentUser = authService.getCurrentUser();
    let count = 0;
    for (const [socioId, state] of rowStateMap.entries()) {
      if (state && state.valid) {
        await lecturaService.guardarLectura(
          socioId,
          currentPeriodo,
          state.lecturaAnterior,
          state.lecturaActual,
          currentUser?.id || 'usr-lector'
        );
        count++;
      }
    }
    if (count === 0) {
      alert('No hay lecturas pendientes por guardar.');
      return;
    }
    alert(`✓ Se guardaron ${count} lecturas en IndexedDB.`);
    cargarDatos();
  });

  cargarDatos();

  return container;
}
