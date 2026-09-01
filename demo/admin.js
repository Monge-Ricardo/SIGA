/**
 * SIGA-Comunitario • Módulo 6: Gobernanza y Tarifas (Admin)
 */

import { requireAuth, getAuthToken } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';

// Guard de autenticación (Exclusivo ADMIN)
const currentUser = requireAuth(['ADMIN']);
if (currentUser) {
  injectAppLayout('admin');
}

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

async function cargarTarifas() {
  try {
    const res = await apiFetch('/api/v1/admin/tarifas');
    const t = res.data || {};
    document.getElementById('cfgCargoNormal').value = t.cargoFijoNormal || 7.0;
    document.getElementById('cfgCargoTerceraEdad').value = t.cargoFijoTerceraEdad || 5.0;
    document.getElementById('cfgLimiteBase').value = t.limiteBaseM3 || 30;
    document.getElementById('cfgCostoExcedente').value = t.costoExcedenteM3 || 0.1;
    document.getElementById('cfgRecargoAlcantarillado').value = t.recargoAlcantarillado || 1.0;
  } catch (err) {
    console.error('[Admin] Error cargando tarifas:', err);
  }
}

async function cargarSectores() {
  const tbody = document.getElementById('tbodySectores');
  try {
    const res = await apiFetch('/api/v1/sectores');
    const sectores = res.data || [];
    if (sectores.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align: center;">No hay sectores registrados.</td></tr>';
      return;
    }

    tbody.innerHTML = sectores
      .map((s) => `
        <tr>
          <td><code>${s.codigoSector || s.codigo || '-'}</code></td>
          <td><strong>${s.nombreSector || s.nombre}</strong></td>
          <td style="color: #64748b;">${s.descripcion || '-'}</td>
        </tr>
      `)
      .join('');
  } catch (err) {
    console.error('[Admin] Error cargando sectores:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="3" style="color: #dc2626;">Error: ${err.message}</td></tr>`;
  }
}

async function cargarUsuarios() {
  const tbody = document.getElementById('tbodyUsuarios');
  try {
    const res = await apiFetch('/api/v1/admin/usuarios');
    const usuarios = res.data || [];
    if (usuarios.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No hay usuarios registrados.</td></tr>';
      return;
    }

    const badgeRole = {
      ADMIN: '<span class="badge-role-tag" style="background: #e0e7ff; color: #4338ca;">ADMIN</span>',
      CAJERO: '<span class="badge-role-tag" style="background: #dcfce7; color: #15803d;">CAJERO</span>',
      LECTOR: '<span class="badge-role-tag" style="background: #fef3c7; color: #b45309;">LECTOR</span>'
    };

    tbody.innerHTML = usuarios
      .map((u) => `
        <tr>
          <td><strong>${u.username}</strong></td>
          <td>${u.nombreCompleto}</td>
          <td>${badgeRole[u.rol] || u.rol}</td>
          <td><span style="color: #16a34a; font-weight: 600;">● Activo</span></td>
          <td style="color: #64748b; font-size: 0.8rem;">${u.createdAt ? u.createdAt.split('T')[0] : '-'}</td>
        </tr>
      `)
      .join('');
  } catch (err) {
    console.error('[Admin] Error cargando usuarios:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="color: #dc2626;">Error: ${err.message}</td></tr>`;
  }
}

function setupEventos() {
  // Guardar Tarifas
  document.getElementById('formTarifas')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnGuardarTarifas');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    const cargoFijoNormal = parseFloat(document.getElementById('cfgCargoNormal').value);
    const cargoFijoTerceraEdad = parseFloat(document.getElementById('cfgCargoTerceraEdad').value);
    const limiteBaseM3 = parseFloat(document.getElementById('cfgLimiteBase').value);
    const costoExcedenteM3 = parseFloat(document.getElementById('cfgCostoExcedente').value);
    const recargoAlcantarillado = parseFloat(document.getElementById('cfgRecargoAlcantarillado').value);

    try {
      await apiFetch('/api/v1/admin/tarifas', {
        method: 'PUT',
        body: JSON.stringify({
          cargoFijoNormal,
          cargoFijoTerceraEdad,
          limiteBaseM3,
          costoExcedenteM3,
          recargoAlcantarillado
        })
      });

      Swal.fire({
        icon: 'success',
        title: '¡Tarifas Actualizadas!',
        text: 'Los nuevos valores tarifarios aplicarán a las siguientes emisiones.',
        timer: 2000,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error al actualizar tarifas', text: err.message });
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Guardar Configuración de Tarifas';
    }
  });

  // Toggle Forms
  const formSector = document.getElementById('formCrearSector');
  const formUsuario = document.getElementById('formCrearUsuario');

  document.getElementById('btnMostrarCrearSector')?.addEventListener('click', () => {
    formSector.style.display = formSector.style.display === 'none' ? 'flex' : 'none';
  });
  document.getElementById('btnCancelarSector')?.addEventListener('click', () => {
    formSector.style.display = 'none';
  });

  document.getElementById('btnMostrarCrearUsuario')?.addEventListener('click', () => {
    formUsuario.style.display = formUsuario.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('btnCancelarUsuario')?.addEventListener('click', () => {
    formUsuario.style.display = 'none';
  });

  // Guardar Sector
  formSector?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codigoSector = document.getElementById('secCodigo').value.trim();
    const nombreSector = document.getElementById('secNombre').value.trim();
    const descripcion = document.getElementById('secDesc').value.trim();

    try {
      await apiFetch('/api/v1/sectores', {
        method: 'POST',
        body: JSON.stringify({ codigoSector, nombreSector, descripcion })
      });

      Swal.fire({ icon: 'success', title: '¡Sector Creado!', timer: 1500, showConfirmButton: false });
      formSector.reset();
      formSector.style.display = 'none';
      await cargarSectores();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error al crear sector', text: err.message });
    }
  });

  // Guardar Usuario
  formUsuario?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombreCompleto = document.getElementById('usrNombre').value.trim();
    const username = document.getElementById('usrUsername').value.trim();
    const password = document.getElementById('usrPassword').value.trim();
    const rol = document.getElementById('usrRol').value;

    try {
      await apiFetch('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ nombreCompleto, username, password, rol })
      });

      Swal.fire({ icon: 'success', title: '¡Usuario Registrado!', timer: 1500, showConfirmButton: false });
      formUsuario.reset();
      formUsuario.style.display = 'none';
      await cargarUsuarios();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error al registrar usuario', text: err.message });
    }
  });
}

async function initAdmin() {
  setupEventos();
  await Promise.all([cargarTarifas(), cargarSectores(), cargarUsuarios()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}
