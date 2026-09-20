/**
 * SIGA-Comunitario • Módulo 4: Contraloría y Libro Mayor (3 Columnas)
 * Control estricto de los 7 Fondos Comunitarios (Comunicación Directa Supabase)
 */

import { requireAuth, apiFetch, normalizeSearchText, matchesSearchTokens } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';

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

// Guard de autenticación (Accesible por ADMIN y CAJERO)
const currentUser = requireAuth(['ADMIN', 'CAJERO']);
if (currentUser) {
  injectAppLayout('fondos');
}

// 1. Visibilidad estricta de permisos de Administrador
function verificarPermisosAdmin() {
  const btnConfigurar = document.getElementById('btnConfigurarFondos');
  const thAccion = document.getElementById('thAccionAdmin');
  const isAdmin = currentUser && currentUser.rol === 'ADMIN';

  if (btnConfigurar) {
    btnConfigurar.style.display = isAdmin ? 'inline-flex' : 'none';
  }
  if (thAccion) {
    thAccion.style.display = isAdmin ? 'table-cell' : 'none';
  }
}

const FONDO_UI_CONFIG = {
  PADRE_PARROQUIA: { icon: '⛪', css: 'padre' },
  OPERACION_MANT: { icon: '🔧', css: 'operacion' },
  PAGO_LECTOR: { icon: '⏱️', css: 'lector' },
  MORTUORIO: { icon: '🕊️', css: 'mortuorio' },
  PRO_MEJORAS: { icon: '🏗️', css: 'promejoras' },
  MULTAS_EXTRAS: { icon: '⚖️', css: 'multas' },
  ALCANTARILLADO: { icon: '🌊', css: 'alcantarillado' }
};

let catalogoFondos = [];
let balancesCache = [];
let movimientosCache = [];
let isRefreshing = false;

/**
 * Recarga silenciosa reactiva sin intervención manual
 */
async function recargarDatosSilencioso() {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    await Promise.all([cargarBalanceFondos(), cargarLibroMayor()]);
    const statusText = document.getElementById('liveSyncStatusText');
    if (statusText) {
      const now = new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      statusText.textContent = `En vivo • Auto-actualizado (${now})`;
    }
  } catch (e) {
    console.warn('[Fondos] Error en auto-actualización silenciosa:', e);
  } finally {
    isRefreshing = false;
  }
}

/**
 * 1. Carga dinámica del catálogo de fondos desde la base de datos (Cero datos quemados)
 */
async function cargarCatalogoFondos() {
  try {
    const res = await apiFetch('/api/v1/fondos');
    catalogoFondos = Array.isArray(res.data) ? res.data : [];
    
    // Poblar selects dinámicamente
    const selectFiltro = document.getElementById('filtroFondoSelect');
    const selectEgreso = document.getElementById('egresoIdFondo');

    if (selectFiltro) {
      const valorPrevio = selectFiltro.value;
      selectFiltro.innerHTML = '<option value="">Todos los Fondos</option>' + 
        catalogoFondos.map(f => `<option value="${f.id}">${f.nombre}</option>`).join('');
      if (valorPrevio) selectFiltro.value = valorPrevio;
    }

    if (selectEgreso) {
      selectEgreso.innerHTML = catalogoFondos.map(f => 
        `<option value="${f.id}">${f.nombre}</option>`
      ).join('');
    }
  } catch (err) {
    console.error('[Fondos] Error cargando catálogo de fondos:', err);
  }
}

/**
 * 2. Carga y renderizado del balance general y los 7 fondos
 */
async function cargarBalanceFondos() {
  try {
    const res = await apiFetch('/api/v1/fondos/balance');
    const data = res.data || {};
    balancesCache = data.resumenFondos || (Array.isArray(res.data) ? res.data : []);
    
    renderResumenFondos(balancesCache);
    actualizarResumenPadre(balancesCache);
  } catch (err) {
    console.error('[Fondos] Error cargando balance:', err);
    const grid = document.getElementById('fondosSummaryGrid');
    if (grid) {
      grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #dc2626; padding: 2rem;">Error cargando balance de fondos: ${err.message}</div>`;
    }
  }
}

function renderResumenFondos(balances) {
  const grid = document.getElementById('fondosSummaryGrid');
  if (!grid) return;

  if (!balances || balances.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #64748b; padding: 2rem;">No hay registros de fondos en la base de datos.</div>';
    return;
  }

  grid.innerHTML = balances
    .map((b) => {
      const ui = FONDO_UI_CONFIG[b.codigo] || { icon: '🏛️', css: 'operacion' };
      const ing = Number(b.totalIngresos ?? b.ingresos ?? 0);
      const egr = Number(b.totalEgresos ?? b.egresos ?? 0);
      const sal = Number(b.saldo ?? 0);
      const desc = b.descripcion || '';

      return `
        <div class="fondo-card ${ui.css}">
          <div>
            <div class="fondo-card-title">
              <span>${ui.icon}</span> ${b.nombre}
            </div>
            <div class="fondo-card-desc" title="${desc}">${desc}</div>
          </div>

          <div class="fondo-card-columns">
            <div class="fondo-col-item">
              <span class="col-ingreso">Ingreso (+)</span>
              <strong class="col-ingreso">$${ing.toFixed(2)}</strong>
            </div>
            <div class="fondo-col-item">
              <span class="col-egreso">Egreso (-)</span>
              <strong class="col-egreso">$${egr.toFixed(2)}</strong>
            </div>
            <div class="fondo-col-item">
              <span class="col-saldo">Saldo (=)</span>
              <strong class="col-saldo" style="color: ${sal >= 0 ? '#0f172a' : '#dc2626'}">$${sal.toFixed(2)}</strong>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function actualizarResumenPadre(balances) {
  const padre = balances.find((b) => b.codigo === 'PADRE_PARROQUIA' || b.id === '22222222-2222-2222-2222-222222220001') || { totalIngresos: 0, totalEgresos: 0, saldo: 0 };
  const padIng = Number(padre.totalIngresos ?? padre.ingresos ?? 0);
  const padEgr = Number(padre.totalEgresos ?? padre.egresos ?? 0);
  const padSal = Number(padre.saldo ?? 0);
  
  const saldoEl = document.getElementById('padreSaldoPorEntregar');
  const textEl = document.getElementById('padreSpecialText');

  if (saldoEl) saldoEl.textContent = `$${padSal.toFixed(2)}`;
  if (textEl) {
    textEl.innerHTML = `Total recaudado acumulado: <strong>$${padIng.toFixed(2)}</strong> | Entregado a la Parroquia: <strong>$${padEgr.toFixed(2)}</strong> | Cuota fija: <strong>$2.00 por socio</strong>`;
  }
}

/**
 * 3. Libro Mayor de 3 Columnas (Debe, Haber, Saldo)
 */
async function cargarLibroMayor() {
  const tbody = document.getElementById('tbodyLibroMayor');
  const totalTexto = document.getElementById('totalRegistrosTexto');
  const isAdmin = currentUser && currentUser.rol === 'ADMIN';

  try {
    const res = await apiFetch('/api/v1/fondos/movimientos');
    movimientosCache = res.data || [];
    if (totalTexto) {
      totalTexto.textContent = `${movimientosCache.length} movimientos registrados en Supabase Cloud`;
    }
    renderTablaLibroMayor(movimientosCache);
  } catch (err) {
    console.error('[Fondos] Error cargando libro mayor:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="${isAdmin ? 8 : 7}" style="text-align: center; color: #dc2626; padding: 2rem;">Error cargando libro mayor: ${err.message}</td></tr>`;
    }
  }
}

function renderTablaLibroMayor(movimientos) {
  const tbody = document.getElementById('tbodyLibroMayor');
  if (!tbody) return;

  const isAdmin = currentUser && currentUser.rol === 'ADMIN';
  const filtroFondo = document.getElementById('filtroFondoSelect')?.value || '';
  const filtroTipo = document.getElementById('filtroTipoSelect')?.value || '';
  const busqueda = (document.getElementById('buscarConceptoInput')?.value || '').trim();

  let filtrados = movimientos;
  if (filtroFondo) {
    filtrados = filtrados.filter((m) => m.idFondo === filtroFondo || m.id_fondo === filtroFondo);
  }
  if (filtroTipo) {
    filtrados = filtrados.filter((m) => (m.tipo || m.tipoMovimiento) === filtroTipo);
  }
  if (busqueda) {
    filtrados = filtrados.filter((m) => {
      const composite = `${m.concepto || ''} ${m.numeroComprobante || ''} ${m.numero_comprobante || ''} ${m.beneficiario || ''} ${m.nombreFondo || ''} ${m.nombre_fondo || ''}`;
      return matchesSearchTokens(composite, busqueda);
    });
  }

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${isAdmin ? 8 : 7}" style="text-align: center; padding: 2rem; color: #64748b;">No se encontraron movimientos registrados con los filtros aplicados.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados
    .map((m) => {
      const fechaRaw = m.fecha || m.fechaMovimiento || m.created_at;
      const fecha = fechaRaw ? new Date(fechaRaw).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : '-';
      const esIngreso = (m.tipo || m.tipoMovimiento) === 'INGRESO';
      const ingresoNum = Number(m.ingreso || 0);
      const egresoNum = Number(m.egreso || 0);
      const ingresoStr = ingresoNum > 0 ? `+$${ingresoNum.toFixed(2)}` : '-';
      const egresoStr = egresoNum > 0 ? `-$${egresoNum.toFixed(2)}` : '-';
      const saldoVal = Number(m.saldo ?? m.saldoResultante ?? 0);
      const codigoFondo = m.codigoFondo || m.codigo_fondo || '';
      const ui = FONDO_UI_CONFIG[codigoFondo] || { icon: '🏛️' };
      const nombreFondo = m.nombreFondo || m.nombre_fondo || 'Fondo Comunitario';
      const comprobante = m.numeroComprobante || m.numero_comprobante || 'REC-AUTO';
      const conceptoDisplay = m.concepto || '-';

      const adminCol = isAdmin
        ? `<td style="text-align: center; white-space: nowrap;">
            <button class="btn btn-sm btn-anular-mov" data-id="${m.id}" data-concepto="${conceptoDisplay.replace(/"/g, '&quot;')}" title="Anular movimiento y revertir cuentas" style="color: #dc2626; border: 1px solid #fecaca; background: #fff5f5; font-size: 0.75rem; padding: 0.22rem 0.5rem; border-radius: 4px; font-weight: 600; cursor: pointer;">
              🗑️ Anular
            </button>
          </td>`
        : '';

      return `
        <tr>
          <td style="font-size: 0.8rem; color: #64748b; white-space: nowrap;">${fecha}</td>
          <td>
            <div style="font-weight: 600; font-size: 0.82rem; display: flex; align-items: center; gap: 0.35rem;">
              <span>${ui.icon}</span> <span>${nombreFondo}</span>
            </div>
          </td>
          <td>
            <div style="font-weight: 500; font-size: 0.85rem; color: #1e293b;">${conceptoDisplay}</div>
            ${m.beneficiario ? `<div style="font-size: 0.75rem; color: #64748b;">Abonado / Prov: <strong>${m.beneficiario}</strong></div>` : ''}
          </td>
          <td>
            <code style="background: #f1f5f9; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.78rem;">
              ${comprobante}
            </code>
          </td>
          <td style="text-align: right; font-weight: 700; color: #16a34a; font-size: 0.88rem;">${ingresoStr}</td>
          <td style="text-align: right; font-weight: 700; color: #dc2626; font-size: 0.88rem;">${egresoStr}</td>
          <td style="text-align: right; font-weight: 800; color: #0f172a; font-size: 0.88rem;">$${saldoVal.toFixed(2)}</td>
          ${adminCol}
        </tr>
      `;
    })
    .join('');

  if (isAdmin) {
    tbody.querySelectorAll('.btn-anular-mov').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const concepto = btn.getAttribute('data-concepto') || 'este movimiento';
        confirmarAnulacionAdmin(id, concepto);
      });
    });
  }
}

/**
 * 4. Anulación y Reversión de Cuentas (Solo Admin)
 */
async function confirmarAnulacionAdmin(id, concepto) {
  const confirm = await Swal.fire({
    title: '¿Anular y revertir cuentas?',
    html: `¿Está seguro de anular el movimiento contable:<br/><strong>"${concepto}"</strong>?<br/><br/><span style="font-size: 0.85rem; color: #dc2626;">⚠️ Esta acción revertirá automáticamente los saldos de todos los fondos afectados y recalculará la caja y el libro mayor.</span>`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Sí, anular y revertir',
    cancelButtonText: 'Cancelar'
  });

  if (!confirm.isConfirmed) return;

  try {
    Swal.fire({
      title: 'Revirtiendo cuentas...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    const res = await apiFetch(`/api/v1/fondos/movimientos/${id}`, {
      method: 'DELETE'
    });

    await Promise.all([cargarBalanceFondos(), cargarLibroMayor()]);

    Swal.fire({
      icon: 'success',
      title: '¡Cuentas Revertidas!',
      text: res.message || 'El movimiento fue anulado y los fondos se actualizaron correctamente.',
      timer: 2000,
      showConfirmButton: false
    });
  } catch (err) {
    console.error('[Fondos] Error al anular movimiento:', err);
    Swal.fire({
      icon: 'error',
      title: 'Error al anular movimiento',
      text: err.message
    });
  }
}

/**
 * 5. Modal de Catálogo y Parámetros de Fondos (Admin)
 */
function abrirModalConfigFondos() {
  const modal = document.getElementById('modalConfigFondos');
  const container = document.getElementById('listaFondosConfig');
  if (!modal || !container) return;

  container.innerHTML = catalogoFondos.map(f => {
    const ui = FONDO_UI_CONFIG[f.codigo] || { icon: '🏛️' };
    return `
      <div style="border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.85rem; background: #ffffff;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <strong style="font-size: 0.95rem; color: #0f172a;">${ui.icon} ${f.nombre}</strong>
          <code style="font-size: 0.75rem; color: #64748b; background: #f1f5f9; padding: 0.2rem 0.4rem; border-radius: 4px;">${f.codigo}</code>
        </div>
        <div style="font-size: 0.82rem; color: #475569; margin-bottom: 0.5rem;">
          <input type="text" id="cfg_desc_${f.id}" value="${f.descripcion || ''}" style="width: 100%; padding: 0.4rem; border-radius: 4px; border: 1px solid #cbd5e1; font-size: 0.82rem;" />
        </div>
        <div style="display: flex; justify-content: flex-end;">
          <button class="btn btn-sm btn-secondary btn-guardar-cfg-fondo" data-id="${f.id}" style="font-size: 0.75rem;">
            💾 Guardar Parámetro
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-guardar-cfg-fondo').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const input = document.getElementById(`cfg_desc_${id}`);
      const nuevaDesc = input?.value?.trim();
      try {
        btn.disabled = true;
        btn.textContent = 'Guardando...';
        await apiFetch(`/api/v1/fondos/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ descripcion: nuevaDesc })
        });
        Swal.fire({ icon: 'success', title: 'Parámetro guardado', timer: 1200, showConfirmButton: false });
        await Promise.all([cargarCatalogoFondos(), cargarBalanceFondos()]);
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Guardar Parámetro';
      }
    });
  });

  modal.style.display = 'flex';
}

function cerrarModalConfigFondos() {
  const modal = document.getElementById('modalConfigFondos');
  if (modal) modal.style.display = 'none';
}

/**
 * 6. Configuración de Eventos y Modales
 */
function setupEventos() {
  const modalEgreso = document.getElementById('modalEgreso');
  const btnNuevoEgreso = document.getElementById('btnNuevoEgreso');
  const btnCerrarEgreso = document.getElementById('btnCerrarModalEgreso');
  const btnCancelarEgreso = document.getElementById('btnCancelarEgreso');
  const formEgreso = document.getElementById('formEgreso');
  
  const btnLiquidacionPadre = document.getElementById('btnLiquidacionPadre');
  const btnConfigurarFondos = document.getElementById('btnConfigurarFondos');

  // Modal Config
  const btnCerrarConfig = document.getElementById('btnCerrarModalConfig');
  const btnCerrarConfigBtn = document.getElementById('btnCerrarModalConfigBtn');

  const abrirModalEgreso = (idFondo = '', conceptoDefault = '', comprobanteDefault = '') => {
    if (modalEgreso) {
      if (idFondo) document.getElementById('egresoIdFondo').value = idFondo;
      document.getElementById('egresoConcepto').value = conceptoDefault;
      document.getElementById('egresoComprobante').value = comprobanteDefault || `EGR-${String(Date.now()).slice(-5)}`;
      document.getElementById('egresoMonto').value = '';
      document.getElementById('egresoBeneficiario').value = '';
      modalEgreso.style.display = 'flex';
    }
  };

  const cerrarModalEgreso = () => {
    if (modalEgreso) modalEgreso.style.display = 'none';
  };

  btnNuevoEgreso?.addEventListener('click', () => abrirModalEgreso());
  btnCerrarEgreso?.addEventListener('click', cerrarModalEgreso);
  btnCancelarEgreso?.addEventListener('click', cerrarModalEgreso);

  // Entrega al Padre
  btnLiquidacionPadre?.addEventListener('click', () => {
    const padre = balancesCache.find((b) => b.codigo === 'PADRE_PARROQUIA' || b.id === '22222222-2222-2222-2222-222222220001') || { saldo: 0 };
    abrirModalEgreso(padre.id || '22222222-2222-2222-2222-222222220001', 'Entrega formal de aportes recaudados para la Parroquia', `ENT-PADRE-${new Date().getFullYear()}`);
    if (padre.saldo > 0) {
      document.getElementById('egresoMonto').value = Number(padre.saldo).toFixed(2);
      document.getElementById('egresoBeneficiario').value = 'Parroquia / Padre Párroco';
    }
  });

  // Administrar fondos (Solo Admin)
  if (currentUser && currentUser.rol === 'ADMIN') {
    btnConfigurarFondos?.addEventListener('click', abrirModalConfigFondos);
  }
  btnCerrarConfig?.addEventListener('click', cerrarModalConfigFondos);
  btnCerrarConfigBtn?.addEventListener('click', cerrarModalConfigFondos);

  // Filtros de búsqueda
  document.getElementById('filtroFondoSelect')?.addEventListener('change', () => renderTablaLibroMayor(movimientosCache));
  document.getElementById('filtroTipoSelect')?.addEventListener('change', () => renderTablaLibroMayor(movimientosCache));
  document.getElementById('buscarConceptoInput')?.addEventListener('input', () => renderTablaLibroMayor(movimientosCache));

  // Clic en badge de estado para refresco forzado si se desea
  document.getElementById('liveSyncStatus')?.addEventListener('click', () => recargarDatosSilencioso());

  // Registrar Egreso
  formEgreso?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btnGuardarEgreso');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Registrando...';

    const idFondo = document.getElementById('egresoIdFondo').value;
    const monto = parseFloat(document.getElementById('egresoMonto').value);
    const concepto = document.getElementById('egresoConcepto').value.trim();
    const numeroComprobante = document.getElementById('egresoComprobante').value.trim();
    const beneficiario = document.getElementById('egresoBeneficiario').value.trim();

    try {
      await apiFetch('/api/v1/fondos/egreso', {
        method: 'POST',
        body: JSON.stringify({
          idFondo,
          monto,
          concepto,
          numeroComprobante,
          beneficiario
        })
      });

      Swal.fire({
        icon: 'success',
        title: 'Egreso Registrado',
        text: 'El monto ha sido debitado del fondo correctamente.',
        timer: 1800,
        showConfirmButton: false
      });

      cerrarModalEgreso();
      await recargarDatosSilencioso();
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Error al registrar egreso',
        text: err.message
      });
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = '💸 Registrar Egreso';
    }
  });

}

async function initFondos() {
  verificarPermisosAdmin();
  setupEventos();
  await Promise.all([cargarCatalogoFondos(), cargarBalanceFondos(), cargarLibroMayor()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFondos);
} else {
  initFondos();
}
