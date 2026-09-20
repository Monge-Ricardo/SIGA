/**
 * SIGA-Comunitario • Módulo 6: Gobernanza y Tarifas (Admin)
 */

import { requireAuth, getCurrentUser, apiFetch } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';

// Guard de autenticación (Exclusivo ADMIN)
const currentUser = requireAuth(['ADMIN']);
if (currentUser) {
  injectAppLayout('admin');
}

async function cargarTarifas() {
  try {
    const res = await apiFetch('/api/v1/admin/tarifas');
    const t = res.data || {};
    document.getElementById('cfgCargoNormal').value = t.cargoFijoNormal ?? t.tarifaNormal ?? 7.0;
    document.getElementById('cfgCargoTerceraEdad').value = t.cargoFijoTerceraEdad ?? t.tarifaTerceraEdad ?? 5.0;
    document.getElementById('cfgLimiteBase').value = t.limiteBaseM3 ?? t.limiteBasicoM3 ?? 30;
    document.getElementById('cfgCostoExcedente').value = t.costoExcedenteM3 ?? t.valorExcedenteM3 ?? 0.1;
    document.getElementById('cfgRecargoAlcantarillado').value = t.recargoAlcantarillado ?? t.valorAlcantarillado ?? 1.0;
    
    // Reparto contable configurable
    const elOp = document.getElementById('cfgRepartoOperacion');
    const elPad = document.getElementById('cfgRepartoPadre');
    const elLec = document.getElementById('cfgRepartoLector');
    const elMor = document.getElementById('cfgRepartoMortuorio');
    if (elOp) elOp.value = t.repartoNormalOperacion ?? 4.0;
    if (elPad) elPad.value = t.repartoNormalPadre ?? 2.0;
    if (elLec) elLec.value = t.repartoNormalLector ?? 0.5;
    if (elMor) elMor.value = t.repartoNormalMortuorio ?? 0.5;
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
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #64748b;">No hay sectores registrados.</td></tr>';
      return;
    }

    tbody.innerHTML = sectores
      .map((s) => `
        <tr>
          <td><code>${s.codigoSector || s.codigo || '-'}</code></td>
          <td><strong>${s.nombreSector || s.nombre}</strong></td>
          <td style="color: #64748b;">${s.descripcion || '-'}</td>
          <td style="text-align: center;">
            <div style="display: flex; gap: 0.35rem; justify-content: center;">
              <button class="btn btn-xs btn-secondary btn-edit-sector" 
                data-id="${s.id}" 
                data-codigo="${s.codigoSector || s.codigo || ''}" 
                data-nombre="${s.nombreSector || s.nombre || ''}" 
                data-desc="${s.descripcion || ''}" 
                title="Editar Sector">✏️ Editar</button>
              <button class="btn btn-xs btn-secondary btn-del-sector" 
                data-id="${s.id}" 
                data-nombre="${s.nombreSector || s.nombre || ''}" 
                style="color: #dc2626; border-color: #fca5a5;" 
                title="Eliminar Sector">🗑️</button>
            </div>
          </td>
        </tr>
      `)
      .join('');
  } catch (err) {
    console.error('[Admin] Error cargando sectores:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="color: #dc2626;">Error: ${err.message}</td></tr>`;
  }
}

async function cargarUsuarios() {
  const tbody = document.getElementById('tbodyUsuarios');
  try {
    const res = await apiFetch('/api/v1/admin/usuarios');
    const usuarios = res.data || [];
    if (usuarios.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b;">No hay usuarios registrados.</td></tr>';
      return;
    }

    const badgeRole = {
      ADMIN: '<span class="badge-role-tag" style="background: #e0e7ff; color: #4338ca;">ADMIN</span>',
      CAJERO: '<span class="badge-role-tag" style="background: #dcfce7; color: #15803d;">CAJERO</span>',
      LECTOR: '<span class="badge-role-tag" style="background: #fef3c7; color: #b45309;">LECTOR</span>',
      AUDITOR: '<span class="badge-role-tag" style="background: #f3e8ff; color: #7e22ce;">AUDITOR</span>'
    };

    tbody.innerHTML = usuarios
      .map((u) => {
        const isRootAdmin = u.id === '00000000-0000-0000-0000-000000000001';
        const isCurrentSession = currentUser && currentUser.id === u.id;
        const estadoTag = u.activo
          ? '<span style="color: #16a34a; font-weight: 600;">● Activo</span>'
          : '<span style="color: #dc2626; font-weight: 600;">○ Inactivo</span>';

        return `
          <tr>
            <td><strong>${u.username}</strong> ${isCurrentSession ? '<span style="font-size: 0.7rem; color: #0284c7;">(Tú)</span>' : ''}</td>
            <td>${u.nombreCompleto}</td>
            <td>${badgeRole[u.rol] || u.rol}</td>
            <td>${estadoTag}</td>
            <td style="color: #64748b; font-size: 0.8rem;">${u.createdAt ? u.createdAt.split('T')[0] : '-'}</td>
            <td style="text-align: center;">
              <div style="display: flex; gap: 0.35rem; justify-content: center; align-items: center; flex-wrap: wrap;">
                <button class="btn btn-xs btn-secondary btn-edit-user" 
                  data-id="${u.id}" 
                  data-username="${u.username}" 
                  data-nombre="${u.nombreCompleto}" 
                  data-rol="${u.rol}" 
                  title="Editar datos de usuario">✏️ Editar</button>
                <button class="btn btn-xs ${u.activo ? 'btn-secondary' : 'btn-primary'} btn-toggle-user" 
                  data-id="${u.id}" 
                  data-username="${u.username}" 
                  data-activo="${u.activo}" 
                  ${isRootAdmin || isCurrentSession ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}
                  title="${isRootAdmin || isCurrentSession ? 'No se puede desactivar' : u.activo ? 'Desactivar cuenta' : 'Activar cuenta'}">
                  ${u.activo ? '⏸️ Desactivar' : '▶️ Activar'}
                </button>
                <button class="btn btn-xs btn-secondary btn-del-user" 
                  data-id="${u.id}" 
                  data-username="${u.username}" 
                  ${isRootAdmin || isCurrentSession ? 'disabled style="opacity: 0.3; cursor: not-allowed; border-color: #cbd5e1; color: #94a3b8;"' : 'style="color: #dc2626; border-color: #fca5a5;"'}
                  title="${isRootAdmin || isCurrentSession ? 'No se puede eliminar' : 'Eliminar usuario'}">🗑️</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    console.error('[Admin] Error cargando usuarios:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color: #dc2626;">Error: ${err.message}</td></tr>`;
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

    const repartoNormalOperacion = parseFloat(document.getElementById('cfgRepartoOperacion')?.value || '4.0');
    const repartoNormalPadre = parseFloat(document.getElementById('cfgRepartoPadre')?.value || '2.0');
    const repartoNormalLector = parseFloat(document.getElementById('cfgRepartoLector')?.value || '0.5');
    const repartoNormalMortuorio = parseFloat(document.getElementById('cfgRepartoMortuorio')?.value || '0.5');

    try {
      await apiFetch('/api/v1/admin/tarifas', {
        method: 'PUT',
        body: JSON.stringify({
          cargoFijoNormal,
          cargoFijoTerceraEdad,
          limiteBaseM3,
          costoExcedenteM3,
          recargoAlcantarillado,
          repartoNormalOperacion,
          repartoNormalPadre,
          repartoNormalLector,
          repartoNormalMortuorio
        })
      });

      Swal.fire({
        icon: 'success',
        title: '¡Parámetros Actualizados!',
        text: 'Los nuevos valores de tarifas y bases de fondos se guardaron exitosamente en Supabase.',
        timer: 2000,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error al actualizar tarifas', text: err.message });
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Guardar Parámetros y Tarifas';
    }
  });

  // Toggle Forms de Creación
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

  // Registrar Sector
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

  // Registrar Usuario
  formUsuario?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombreCompleto = document.getElementById('usrNombre').value.trim();
    const username = document.getElementById('usrUsername').value.trim();
    const password = document.getElementById('usrPassword').value.trim();
    const rol = document.getElementById('usrRol').value;

    try {
      await apiFetch('/api/v1/admin/usuarios', {
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

  // Modales de Edición
  const modalEditarUsuario = document.getElementById('modalEditarUsuario');
  const modalEditarSector = document.getElementById('modalEditarSector');

  const cerrarModalUsuario = () => {
    if (modalEditarUsuario) modalEditarUsuario.style.display = 'none';
  };
  const cerrarModalSector = () => {
    if (modalEditarSector) modalEditarSector.style.display = 'none';
  };

  document.getElementById('btnCerrarModalUsuario')?.addEventListener('click', cerrarModalUsuario);
  document.getElementById('btnCancelarEditarUsuario')?.addEventListener('click', cerrarModalUsuario);
  document.getElementById('btnCerrarModalSector')?.addEventListener('click', cerrarModalSector);
  document.getElementById('btnCancelarEditarSector')?.addEventListener('click', cerrarModalSector);

  // Delegación de eventos en Tabla Sectores (Editar y Eliminar)
  document.getElementById('tbodySectores')?.addEventListener('click', async (e) => {
    const btnEdit = e.target.closest('.btn-edit-sector');
    if (btnEdit) {
      const id = btnEdit.dataset.id;
      const codigo = btnEdit.dataset.codigo;
      const nombre = btnEdit.dataset.nombre;
      const desc = btnEdit.dataset.desc;

      document.getElementById('editSecId').value = id;
      document.getElementById('editSecCodigo').value = codigo;
      document.getElementById('editSecNombre').value = nombre;
      document.getElementById('editSecDesc').value = desc;

      modalEditarSector.style.display = 'flex';
      return;
    }

    const btnDel = e.target.closest('.btn-del-sector');
    if (btnDel) {
      const id = btnDel.dataset.id;
      const nombre = btnDel.dataset.nombre;

      const confirm = await Swal.fire({
        title: '¿Eliminar Sector?',
        text: `¿Está seguro de eliminar el sector "${nombre}"? Esta acción se sincroniza directamente con la base de datos.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
      });

      if (confirm.isConfirmed) {
        try {
          await apiFetch(`/api/v1/sectores/${id}`, { method: 'DELETE' });
          Swal.fire({ icon: 'success', title: 'Sector Eliminado', timer: 1500, showConfirmButton: false });
          await cargarSectores();
        } catch (err) {
          Swal.fire({ icon: 'error', title: 'No se pudo eliminar sector', text: err.message });
        }
      }
    }
  });

  // Guardar Cambios de Sector
  document.getElementById('formEditarSector')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editSecId').value;
    const codigoSector = document.getElementById('editSecCodigo').value.trim();
    const nombreSector = document.getElementById('editSecNombre').value.trim();
    const descripcion = document.getElementById('editSecDesc').value.trim();

    try {
      await apiFetch(`/api/v1/sectores/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ codigoSector, nombreSector, descripcion })
      });

      Swal.fire({ icon: 'success', title: 'Sector Actualizado', timer: 1500, showConfirmButton: false });
      cerrarModalSector();
      await cargarSectores();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error actualizando sector', text: err.message });
    }
  });

  // Delegación de eventos en Tabla Usuarios (Editar, Toggle Activo, Eliminar)
  document.getElementById('tbodyUsuarios')?.addEventListener('click', async (e) => {
    // 1. Editar Usuario
    const btnEdit = e.target.closest('.btn-edit-user');
    if (btnEdit) {
      const id = btnEdit.dataset.id;
      const username = btnEdit.dataset.username;
      const nombre = btnEdit.dataset.nombre;
      const rol = btnEdit.dataset.rol;

      const isRootAdmin = id === '00000000-0000-0000-0000-000000000001';
      const usrInput = document.getElementById('editUsrUsername');
      usrInput.value = username;
      usrInput.disabled = isRootAdmin;
      usrInput.style.background = isRootAdmin ? '#f1f5f9' : '#ffffff';

      document.getElementById('editUsrId').value = id;
      document.getElementById('editUsrNombre').value = nombre;
      document.getElementById('editUsrRol').value = rol;
      document.getElementById('editUsrPassword').value = '';

      modalEditarUsuario.style.display = 'flex';
      return;
    }

    // 2. Activar / Desactivar Usuario
    const btnToggle = e.target.closest('.btn-toggle-user');
    if (btnToggle && !btnToggle.disabled) {
      const id = btnToggle.dataset.id;
      const username = btnToggle.dataset.username;
      const activo = btnToggle.dataset.activo === 'true';

      const accion = activo ? 'desactivar' : 'activar';
      const confirm = await Swal.fire({
        title: `¿${activo ? 'Desactivar' : 'Activar'} Usuario?`,
        text: `¿Desea ${accion} la cuenta de acceso para el usuario "${username}"?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: `Sí, ${accion}`,
        cancelButtonText: 'Cancelar'
      });

      if (confirm.isConfirmed) {
        try {
          const res = await apiFetch(`/api/v1/admin/usuarios/${id}/toggle`, { method: 'PATCH' });
          Swal.fire({ icon: 'success', title: res.message || `Usuario ${accion}do`, timer: 1500, showConfirmButton: false });
          await cargarUsuarios();
        } catch (err) {
          Swal.fire({ icon: 'error', title: 'Error al cambiar estado', text: err.message });
        }
      }
      return;
    }

    // 3. Eliminar Usuario
    const btnDel = e.target.closest('.btn-del-user');
    if (btnDel && !btnDel.disabled) {
      const id = btnDel.dataset.id;
      const username = btnDel.dataset.username;

      const confirm = await Swal.fire({
        title: '¿Eliminar Usuario?',
        text: `¿Está seguro de eliminar permanentemente al usuario "${username}"? Esta acción se aplicará directamente en la base de datos Supabase y no se puede deshacer.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
      });

      if (confirm.isConfirmed) {
        try {
          await apiFetch(`/api/v1/admin/usuarios/${id}`, { method: 'DELETE' });
          Swal.fire({ icon: 'success', title: 'Usuario Eliminado', timer: 1500, showConfirmButton: false });
          await cargarUsuarios();
        } catch (err) {
          Swal.fire({ icon: 'error', title: 'No se pudo eliminar usuario', text: err.message });
        }
      }
    }
  });

  // Guardar Cambios de Usuario
  document.getElementById('formEditarUsuario')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Guardando...';
    }

    const id = document.getElementById('editUsrId').value;
    const username = document.getElementById('editUsrUsername').value.trim();
    const nombreCompleto = document.getElementById('editUsrNombre').value.trim();
    const rol = document.getElementById('editUsrRol').value;
    const password = document.getElementById('editUsrPassword').value.trim();

    const payload = {
      username,
      nombreCompleto,
      rol
    };
    if (password.length > 0) {
      payload.password = password;
    }

    try {
      const res = await apiFetch(`/api/v1/admin/usuarios/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      const loggedUser = getCurrentUser();
      if (loggedUser && (loggedUser.id === id || loggedUser.username === res?.data?.username || loggedUser.username === username)) {
        const updated = {
          ...loggedUser,
          username: res?.data?.username || username || loggedUser.username,
          nombre: nombreCompleto,
          nombreCompleto: nombreCompleto,
          nombre_completo: nombreCompleto,
          rol: rol
        };
        sessionStorage.setItem('SIGA_AUTH_USER', JSON.stringify(updated));
        localStorage.setItem('SIGA_AUTH_USER', JSON.stringify(updated));

        const chipName = document.querySelector('.user-chip-name');
        if (chipName) chipName.textContent = nombreCompleto;
        const sideName = document.querySelector('.sidebar-user-name');
        if (sideName) sideName.textContent = nombreCompleto;
      }

      Swal.fire({
        icon: 'success',
        title: 'Usuario Actualizado',
        text: 'Los datos del usuario se guardaron y sincronizaron exitosamente con la base de datos.',
        timer: 1800,
        showConfirmButton: false
      });
      cerrarModalUsuario();
      await cargarUsuarios();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error actualizando usuario', text: err.message });
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Guardar Cambios';
      }
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

