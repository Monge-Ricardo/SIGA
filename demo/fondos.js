/**
 * SIGA-Comunitario • Módulo 4: Contraloría y Libro Mayor (3 Columnas)
 * Control estricto de los 7 Fondos Comunitarios (Offline-First + API REST)
 */

import { requireAuth, getAuthToken } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';

// Guard de autenticación (Accesible por ADMIN y CAJERO)
const currentUser = requireAuth(['ADMIN', 'CAJERO']);
if (currentUser) {
  injectAppLayout('fondos');
}

const FONDO_META = {
  PADRE: { nombre: 'Aporte Parroquial (Padre)', icon: '⛪', css: 'padre', desc: '$2.00 por cada cuota normal pagada' },
  OPERACION_MANT: { nombre: 'Operación y Mantenimiento', icon: '🔧', css: 'operacion', desc: '$4.00 base + 100% de excedentes de agua' },
  HONORARIOS_LECTOR: { nombre: 'Honorarios Lector', icon: '⏱️', css: 'lector', desc: '$0.50 por lectura y gestión de campo' },
  FONDO_MORTUORIO: { nombre: 'Fondo Mortuorio', icon: '🕊️', css: 'mortuorio', desc: '$0.50 fondo de auxilio funerario comunitario' },
  PRO_MEJORAS: { nombre: 'Fondo Pro-mejoras', icon: '🏗️', css: 'promejoras', desc: 'Obras y ampliaciones de la red' },
  MULTAS_EXTRAS: { nombre: 'Multas y Cuotas Extras', icon: '⚖️', css: 'multas', desc: 'Inasistencia a mingas, asambleas y reconexiones' },
  ALCANTARILLADO: { nombre: 'Fondo de Alcantarillado', icon: '🌊', css: 'alcantarillado', desc: '+$1.00 por usuario con servicio de red' }
};

let movimientosCache = [];
let balancesCache = [];

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

async function cargarBalanceFondos() {
  try {
    const res = await apiFetch('/api/v1/fondos/balance');
    balancesCache = res.data || [];
    renderResumenFondos(balancesCache);
    actualizarResumenPadre(balancesCache);
  } catch (err) {
    console.error('[Fondos] Error cargando balance:', err);
    // Fallback con datos locales si está offline
    renderResumenFallback();
  }
}

function renderResumenFondos(balances) {
  const grid = document.getElementById('fondosSummaryGrid');
  if (!grid) return;

  if (!balances || balances.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #64748b;">No hay registros de fondos.</div>';
    return;
  }

  grid.innerHTML = balances
    .map((b) => {
      const meta = FONDO_META[b.id] || { nombre: b.nombre, icon: '🏛️', css: 'operacion', desc: b.descripcion || '' };
      return `
        <div class="fondo-card ${meta.css}">
          <div>
            <div class="fondo-card-title">
              <span>${meta.icon}</span> ${meta.nombre}
            </div>
            <div class="fondo-card-desc">${meta.desc}</div>
          </div>

          <div class="fondo-card-columns">
            <div class="fondo-col-item">
              <span class="col-ingreso">Ingreso (+)</span>
              <strong class="col-ingreso">$${Number(b.ingresos || 0).toFixed(2)}</strong>
            </div>
            <div class="fondo-col-item">
              <span class="col-egreso">Egreso (-)</span>
              <strong class="col-egreso">$${Number(b.egresos || 0).toFixed(2)}</strong>
            </div>
            <div class="fondo-col-item">
              <span class="col-saldo">Saldo (=)</span>
              <strong class="col-saldo" style="color: ${b.saldo >= 0 ? '#0f172a' : '#dc2626'}">$${Number(b.saldo || 0).toFixed(2)}</strong>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function actualizarResumenPadre(balances) {
  const padre = balances.find((b) => b.id === 'PADRE') || { ingresos: 0, egresos: 0, saldo: 0 };
  const saldoEl = document.getElementById('padreSaldoPorEntregar');
  const textEl = document.getElementById('padreSpecialText');

  if (saldoEl) saldoEl.textContent = `$${Number(padre.saldo || 0).toFixed(2)}`;
  if (textEl) {
    textEl.innerHTML = `Total recaudado acumulado: <strong>$${Number(padre.ingresos || 0).toFixed(2)}</strong> | Entregado a la Parroquia: <strong>$${Number(padre.egresos || 0).toFixed(2)}</strong>`;
  }
}

function renderResumenFallback() {
  const fallback = Object.keys(FONDO_META).map((k) => ({
    id: k,
    nombre: FONDO_META[k].nombre,
    ingresos: 0,
    egresos: 0,
    saldo: 0
  }));
  renderResumenFondos(fallback);
}

async function cargarLibroMayor() {
  const tbody = document.getElementById('tbodyLibroMayor');
  try {
    const res = await apiFetch('/api/v1/fondos/libro-mayor');
    movimientosCache = res.data || [];
    renderTablaLibroMayor(movimientosCache);
  } catch (err) {
    console.error('[Fondos] Error cargando libro mayor:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #dc2626;">Error cargando libro mayor: ${err.message}</td></tr>`;
    }
  }
}

function renderTablaLibroMayor(movimientos) {
  const tbody = document.getElementById('tbodyLibroMayor');
  if (!tbody) return;

  const filtroFondo = document.getElementById('filtroFondoSelect')?.value || '';
  const busqueda = (document.getElementById('buscarConceptoInput')?.value || '').toLowerCase().trim();

  let filtrados = movimientos;
  if (filtroFondo) {
    filtrados = filtrados.filter((m) => m.idFondo === filtroFondo);
  }
  if (busqueda) {
    filtrados = filtrados.filter(
      (m) =>
        (m.concepto && m.concepto.toLowerCase().includes(busqueda)) ||
        (m.numeroComprobante && m.numeroComprobante.toLowerCase().includes(busqueda)) ||
        (m.beneficiario && m.beneficiario.toLowerCase().includes(busqueda)) ||
        (m.nombreFondo && m.nombreFondo.toLowerCase().includes(busqueda))
    );
  }

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: #64748b;">No se encontraron movimientos registrados con los filtros aplicados.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados
    .map((m) => {
      const fecha = m.fechaMovimiento ? new Date(m.fechaMovimiento).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : '-';
      const esIngreso = m.tipoMovimiento === 'INGRESO' || Number(m.ingreso) > 0;
      const ingresoStr = Number(m.ingreso || 0) > 0 ? `+$${Number(m.ingreso).toFixed(2)}` : '-';
      const egresoStr = Number(m.egreso || 0) > 0 ? `-$${Number(m.egreso).toFixed(2)}` : '-';
      const meta = FONDO_META[m.idFondo] || { icon: '🏛️', nombre: m.nombreFondo || m.idFondo };

      return `
        <tr>
          <td style="font-size: 0.8rem; color: #64748b;">${fecha}</td>
          <td>
            <div style="font-weight: 600; font-size: 0.85rem; display: flex; align-items: center; gap: 0.35rem;">
              <span>${meta.icon}</span> ${meta.nombre}
            </div>
          </td>
          <td>
            <div style="font-weight: 500; font-size: 0.88rem; color: #1e293b;">${m.concepto || '-'}</div>
            ${m.beneficiario ? `<div style="font-size: 0.75rem; color: #64748b;">Beneficiario: ${m.beneficiario}</div>` : ''}
          </td>
          <td>
            <code style="background: #f1f5f9; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.8rem;">
              ${m.numeroComprobante || 'REC-AUTO'}
            </code>
          </td>
          <td style="text-align: right; font-weight: 700; color: #16a34a;">${ingresoStr}</td>
          <td style="text-align: right; font-weight: 700; color: #dc2626;">${egresoStr}</td>
          <td style="text-align: right; font-weight: 800; color: #0f172a;">$${Number(m.saldoResultante || 0).toFixed(2)}</td>
        </tr>
      `;
    })
    .join('');
}

// Configuración de Modal y Eventos
function setupEventos() {
  const modal = document.getElementById('modalEgreso');
  const btnNuevoEgreso = document.getElementById('btnNuevoEgreso');
  const btnCerrar = document.getElementById('btnCerrarModalEgreso');
  const btnCancelar = document.getElementById('btnCancelarEgreso');
  const formEgreso = document.getElementById('formEgreso');
  const btnRefrescar = document.getElementById('btnRefrescarFondos');
  const btnLiquidacionPadre = document.getElementById('btnLiquidacionPadre');

  const abrirModal = (idFondo = 'OPERACION_MANT', conceptoDefault = '', comprobanteDefault = '') => {
    if (modal) {
      document.getElementById('egresoIdFondo').value = idFondo;
      document.getElementById('egresoConcepto').value = conceptoDefault;
      document.getElementById('egresoComprobante').value = comprobanteDefault || `EGR-${String(Date.now()).slice(-5)}`;
      document.getElementById('egresoMonto').value = '';
      document.getElementById('egresoBeneficiario').value = '';
      modal.style.display = 'flex';
    }
  };

  const cerrarModal = () => {
    if (modal) modal.style.display = 'none';
  };

  btnNuevoEgreso?.addEventListener('click', () => abrirModal());
  btnCerrar?.addEventListener('click', cerrarModal);
  btnCancelar?.addEventListener('click', cerrarModal);

  btnLiquidacionPadre?.addEventListener('click', () => {
    const padre = balancesCache.find((b) => b.id === 'PADRE') || { saldo: 0 };
    abrirModal('PADRE', 'Entrega formal de aportes recaudados para la Parroquia', `ENT-PADRE-${new Date().getFullYear()}`);
    if (padre.saldo > 0) {
      document.getElementById('egresoMonto').value = padre.saldo.toFixed(2);
      document.getElementById('egresoBeneficiario').value = 'Parroquia / Padre Párroco';
    }
  });

  btnRefrescar?.addEventListener('click', async () => {
    btnRefrescar.disabled = true;
    btnRefrescar.textContent = '⏳ Cargando...';
    await Promise.all([cargarBalanceFondos(), cargarLibroMayor()]);
    btnRefrescar.disabled = false;
    btnRefrescar.textContent = '🔄 Actualizar';
  });

  // Filtros
  document.getElementById('filtroFondoSelect')?.addEventListener('change', () => renderTablaLibroMayor(movimientosCache));
  document.getElementById('buscarConceptoInput')?.addEventListener('input', () => renderTablaLibroMayor(movimientosCache));

  // Envío de Egreso
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
      await apiFetch('/api/v1/fondos/egresos', {
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
        title: '¡Egreso Registrado!',
        text: `Se debitaron $${monto.toFixed(2)} del fondo correspondiente con soporte comprobado.`,
        timer: 2000,
        showConfirmButton: false
      });

      cerrarModal();
      await Promise.all([cargarBalanceFondos(), cargarLibroMayor()]);
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
  setupEventos();
  await Promise.all([cargarBalanceFondos(), cargarLibroMayor()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFondos);
} else {
  initFondos();
}
