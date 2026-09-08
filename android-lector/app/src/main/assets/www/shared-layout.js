import { getCurrentUser, logout } from './auth.js';
import { syncEngine, SYNC_CONFIG } from './sync-engine.js';
import { Swal } from './sweetalert.js';

// Registrar Service Worker para PWA Offline-First
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[PWA] Error registrando Service Worker:', err);
    });
  });
}

export function injectAppLayout(activePageId) {
  const user = getCurrentUser();
  const container = document.querySelector('.container');
  if (!container) return;

  // Añadir clase al body para el layout con sidebar
  document.body.classList.add('has-sidebar-layout');

  const roleColors = {
    ADMIN: { bg: '#e0e7ff', text: '#4338ca', label: '👑 ADMINISTRADOR' },
    CAJERO: { bg: '#dcfce7', text: '#15803d', label: '💵 TESORERÍA / CAJA' },
    LECTOR: { bg: '#fef3c7', text: '#b45309', label: '⏱️ LECTOR DE CAMPO' }
  };
  const roleInfo = roleColors[user?.rol] || { bg: '#f1f5f9', text: '#475569', label: user?.rol || 'USUARIO' };

  // Crear o limpiar el wrapper de layout
  let layoutWrapper = document.querySelector('.app-layout-wrapper');
  if (layoutWrapper) {
    layoutWrapper.remove();
  }
  layoutWrapper = document.createElement('div');
  layoutWrapper.className = 'app-layout-wrapper';
  document.body.appendChild(layoutWrapper);

  // Backdrop oscuro para móvil
  const mobileBackdrop = document.createElement('div');
  mobileBackdrop.className = 'sidebar-mobile-backdrop';
  layoutWrapper.appendChild(mobileBackdrop);

  // 1. Sidebar Izquierdo
  const sidebar = document.createElement('aside');
  sidebar.className = 'app-sidebar-left';
  sidebar.id = 'appSidebarLeft';

  const isCajeroOAdmin = user?.rol === 'CAJERO' || user?.rol === 'ADMIN';

  const allMenuItems = [
    { id: 'socios', href: 'socios.html', icon: '👥', label: '1. Padrón de Socios', desc: 'Abonados y medidores', roles: ['ADMIN', 'CAJERO'] },
    { 
      id: 'lecturas', 
      href: 'lecturas.html', 
      icon: isCajeroOAdmin ? '📋' : '⏱️', 
      label: isCajeroOAdmin ? '2. Revisión de Lecturas' : '2. Toma de Lecturas', 
      desc: isCajeroOAdmin ? 'Auditoría y cierre de ciclo' : 'Captura en ruta por sector', 
      roles: ['ADMIN', 'CAJERO', 'LECTOR'] 
    },
    { id: 'caja', href: 'caja.html', icon: '💵', label: '3. Caja y Cobros', desc: 'Liquidación y recibos', roles: ['ADMIN', 'CAJERO'] },
    { id: 'fondos', href: 'fondos.html', icon: '🏛️', label: '4. Fondos (3 Col)', desc: 'Libro Mayor Ing/Egr/Saldo', roles: ['ADMIN', 'CAJERO'] },
    { id: 'reportes', href: 'reportes.html', icon: '📊', label: '5. Reportes & Auditoría', desc: 'Morosidad y asamblea', roles: ['ADMIN', 'CAJERO'] },
    { id: 'admin', href: 'admin.html', icon: '👑', label: '6. Gobernanza & Tarifas', desc: 'Parámetros del sistema', roles: ['ADMIN'] }
  ];

  // Filtrar según el rol autenticado
  const permittedItems = allMenuItems.filter(
    (item) => !user || item.roles.includes(user.rol)
  );

  sidebar.innerHTML = `
    <!-- Brand / Logo -->
    <div class="sidebar-brand-box">
      <div class="sidebar-brand-icon">💧</div>
      <div>
        <div class="sidebar-brand-title">SIGA-Comunitario</div>
        <div class="sidebar-brand-sub">Junta de Agua Potable</div>
      </div>
      <button class="btn-close-sidebar-mobile" id="btnCloseSidebarMobile" title="Cerrar menú">&times;</button>
    </div>

    <!-- Perfil del Usuario Activo -->
    <div class="sidebar-user-card">
      <div class="sidebar-user-avatar">${user?.rol === 'ADMIN' ? '👑' : user?.rol === 'CAJERO' ? '💵' : '⏱️'}</div>
      <div class="sidebar-user-info">
        <div class="sidebar-user-name">${user?.nombre || user?.username || 'Usuario'}</div>
        <span class="sidebar-role-pill" style="background: ${roleInfo.bg}; color: ${roleInfo.text};">
          ${roleInfo.label}
        </span>
      </div>
    </div>

    <!-- Menú de Navegación Vertical -->
    <nav class="sidebar-nav-menu">
      <div class="sidebar-nav-label">MÓDULOS DISPONIBLES</div>
      <ul class="sidebar-nav-list">
        ${permittedItems
          .map((item) => {
            const isActive = item.id === activePageId;
            return `
              <li class="sidebar-nav-item">
                <a href="${item.href}" class="sidebar-nav-link ${isActive ? 'active' : ''}">
                  <span class="nav-link-icon">${item.icon}</span>
                  <div class="nav-link-text">
                    <span class="nav-link-title">${item.label}</span>
                    <span class="nav-link-desc">${item.desc}</span>
                  </div>
                </a>
              </li>
            `;
          })
          .join('')}
      </ul>
    </nav>

    <!-- Footer del Sidebar: Estado de Red y Logout -->
    <div class="sidebar-footer-box">
      <div class="sidebar-status-row">
        <button id="toggleNetworkBtn" class="btn-network-sidebar online">
          <span class="pulse-dot"></span>
          <span id="networkStatusText">En Línea</span>
        </button>
        <span class="badge-perf-sidebar" id="perfMeter">⚡ 0.0 ms</span>
      </div>

      <button class="btn btn-sidebar-logout" id="btnLogoutSidebar" title="Cerrar sesión de forma segura">
        🚪 Cerrar Sesión
      </button>
    </div>
  `;

  // 2. Área de Contenido Principal (Derecha)
  const mainContent = document.createElement('main');
  mainContent.className = 'app-main-content-area';

  // 3. Barra Superior (Top Header) con Botón Cerrar Sesión SIEMPRE VISIBLE
  const topHeader = document.createElement('header');
  topHeader.className = 'app-top-header';

  const activeItem = allMenuItems.find((m) => m.id === activePageId) || { label: 'SIGA-Comunitario', icon: '💧' };

  topHeader.innerHTML = `
    <div class="top-header-left">
      <button class="btn-hamburger-menu" id="btnToggleSidebar" title="Abrir menú de navegación">
        ☰ <span class="hamburger-text">Menú</span>
      </button>
      <div class="top-header-page-title">
        <span class="page-title-icon">${activeItem.icon}</span>
        <span class="page-title-text">${activeItem.label}</span>
      </div>
    </div>

    <div class="top-header-right">
      <button class="btn-git-sync-chip" id="btnGitStatusTop" title="Centro de Sincronización Git">
        <span class="git-status-dot"></span>
        <span id="gitStatusLabel">🟢 Sincronizado</span>
        <span class="git-pending-count" id="topGitPendingBadge" style="display: none;">0</span>
      </button>

      <div class="top-user-chip">
        <span class="user-chip-avatar">${user?.rol === 'ADMIN' ? '👑' : user?.rol === 'CAJERO' ? '💵' : '⏱️'}</span>
        <div class="user-chip-info">
          <span class="user-chip-name">${user?.nombre || user?.username || 'Usuario'}</span>
          <span class="user-chip-role">${roleInfo.label}</span>
        </div>
      </div>

      <button class="btn btn-top-logout" id="btnLogoutTop" title="Cerrar sesión inmediatamente">
        🚪 Cerrar Sesión
      </button>
    </div>
  `;

  // Banner de Sincronización Superior
  const banner = document.createElement('div');
  banner.id = 'networkBanner';
  banner.className = 'status-banner banner-online';
  banner.innerHTML = `
    <div class="banner-content">
      <span class="banner-icon">🌐</span>
      <div>
        <strong id="bannerTitle">Conexión Activa</strong>
        <p id="bannerDesc">Los datos se guardan en IndexedDB local y se sincronizan con SQLite central.</p>
      </div>
    </div>
    <div class="banner-action">
      <span class="queue-badge" id="queueBadge">0 pendientes en Outbox</span>
    </div>
  `;

  // Mover el contenedor dentro del área principal
  container.parentNode.removeChild(container);
  mainContent.appendChild(topHeader);
  mainContent.appendChild(banner);
  mainContent.appendChild(container);

  layoutWrapper.appendChild(sidebar);
  layoutWrapper.appendChild(mainContent);

  // Manejo del Drawer en Móvil
  const openSidebar = () => {
    sidebar.classList.add('mobile-open');
    mobileBackdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  const closeSidebar = () => {
    sidebar.classList.remove('mobile-open');
    mobileBackdrop.classList.remove('active');
    document.body.style.overflow = '';
  };

  document.getElementById('btnToggleSidebar')?.addEventListener('click', openSidebar);
  document.getElementById('btnCloseSidebarMobile')?.addEventListener('click', closeSidebar);
  mobileBackdrop.addEventListener('click', closeSidebar);

  // Listeners de Logout (Tanto en Top Header como en Sidebar Footer)
  document.getElementById('btnLogoutTop')?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  document.getElementById('btnLogoutSidebar')?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  // Simulador de Red
  initNetworkSimulator();

  // Escuchador Global de Sincronización Git-Like
  initGitSyncListener();
}

function initGitSyncListener() {
  const chipBtn = document.getElementById('btnGitStatusTop');
  const label = document.getElementById('gitStatusLabel');
  const badge = document.getElementById('topGitPendingBadge');
  const queueBadge = document.getElementById('queueBadge');
  const networkStatusText = document.getElementById('networkStatusText');
  const toggleNetworkBtn = document.getElementById('toggleNetworkBtn');

  function updateVisualStatus(detail) {
    const { status, pendingCount } = detail;

    if (badge) {
      if (pendingCount > 0) {
        badge.textContent = pendingCount;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }

    if (queueBadge) {
      queueBadge.textContent = `${pendingCount} pendientes en Outbox`;
      queueBadge.style.background = pendingCount > 0 ? '#fef08a' : '#dcfce7';
      queueBadge.style.color = pendingCount > 0 ? '#854d0e' : '#166534';
    }

    if (!chipBtn || !label) return;

    chipBtn.className = 'btn-git-sync-chip';

    if (status === 'PUSHING') {
      chipBtn.classList.add('syncing');
      label.textContent = '⬆️ Subiendo...';
    } else if (status === 'PULLING') {
      chipBtn.classList.add('syncing');
      label.textContent = '⬇️ Descargando...';
    } else if (status === 'OFFLINE' || !navigator.onLine) {
      chipBtn.classList.add('offline');
      label.textContent = '🔌 Modo Offline';
      if (networkStatusText) networkStatusText.textContent = 'Modo Fuera de Línea';
      if (toggleNetworkBtn) toggleNetworkBtn.className = 'btn-network-sidebar offline';
    } else if (pendingCount > 0) {
      chipBtn.classList.add('pending');
      label.textContent = `🟡 ${pendingCount} por subir`;
      if (networkStatusText) networkStatusText.textContent = 'En Línea';
      if (toggleNetworkBtn) toggleNetworkBtn.className = 'btn-network-sidebar online';
    } else if (status === 'ERROR') {
      chipBtn.classList.add('error');
      label.textContent = '⚠️ Error Sync';
    } else {
      label.textContent = '🟢 Sincronizado';
      if (networkStatusText) networkStatusText.textContent = 'En Línea';
      if (toggleNetworkBtn) toggleNetworkBtn.className = 'btn-network-sidebar online';
    }
  }

  window.addEventListener('siga-sync-status', (ev) => {
    updateVisualStatus(ev.detail || {});
  });

  // Inicializar estado actual
  syncEngine.getPendingCount().then((count) => {
    updateVisualStatus({
      status: navigator.onLine ? 'SYNCED' : 'OFFLINE',
      pendingCount: count
    });
  });

  // Clic abre modal Git
  chipBtn?.addEventListener('click', () => {
    openGlobalSyncModal();
  });
}

function openGlobalSyncModal() {
  syncEngine.getPendingCount().then((pendingCount) => {
    const isOnline = navigator.onLine;
    const lastSync = syncEngine.getLastSyncTimestamp();

    Swal.fire({
      title: '🔄 Centro Git de Sincronización',
      html: `
        <div style="text-align: left; font-size: 0.88rem; color: #334155; line-height: 1.4;">
          <div style="background: ${isOnline ? '#f0fdf4' : '#fff7ed'}; border: 1px solid ${isOnline ? '#bbf7d0' : '#fed7aa'}; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <strong style="color: ${isOnline ? '#166534' : '#9a3412'}; font-size: 0.95rem;">
                ${isOnline ? '🟢 Conectado a la Red' : '🔌 Modo Fuera de Línea (Offline)'}
              </strong>
              <span style="font-size: 0.75rem; color: #64748b;">Dispositivo: <code>${syncEngine.deviceId}</code></span>
            </div>
            <div>• Mutaciones locales pendientes por subir: <strong>${pendingCount}</strong></div>
            <div>• Última sincronización: <span style="font-family: monospace;">${lastSync !== '1970-01-01T00:00:00.000Z' ? new Date(lastSync).toLocaleTimeString() : 'Nunca'}</span></div>
            <div>• Repositorio Remoto (Origin): <strong>Supabase Cloud</strong> (${SYNC_CONFIG.SUPABASE_URL.slice(8, 28)}...)</div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">
            <button type="button" id="btnModalPushGlobal" class="btn btn-primary" style="width: 100%; padding: 10px; font-weight: 700; font-size: 0.88rem; background: #0284c7; border: none; border-radius: 6px; color: white; cursor: pointer;">
              ⬆️ Subir Cambios Locales (Push)
            </button>
            <button type="button" id="btnModalPullGlobal" class="btn" style="width: 100%; padding: 10px; font-weight: 700; font-size: 0.88rem; border: 1px solid #059669; color: #065f46; background: #ecfdf5; border-radius: 6px; cursor: pointer;">
              ⬇️ Descargar Actualizaciones de la Nube (Pull)
            </button>
            <button type="button" id="btnModalSyncAllGlobal" class="btn btn-outline" style="width: 100%; padding: 9px; font-weight: 700; font-size: 0.82rem; border: 1px solid #64748b; color: #334155; border-radius: 6px; background: white; cursor: pointer;">
              🔄 Sincronización Completa Bidireccional
            </button>
          </div>
        </div>
      `,
      showConfirmButton: false,
      showCloseButton: true,
      didOpen: () => {
        document.getElementById('btnModalPushGlobal')?.addEventListener('click', async () => {
          Swal.showLoading();
          const res = await syncEngine.pushPending();
          Swal.fire({
            icon: res.success ? 'success' : 'warning',
            title: res.success ? '¡Push Completado!' : 'Aviso de Sincronización',
            text: res.success ? `Se subieron ${res.pushed || 0} cambios.` : (res.reason || res.error || 'Error de conexión')
          });
        });

        document.getElementById('btnModalPullGlobal')?.addEventListener('click', async () => {
          Swal.showLoading();
          const res = await syncEngine.pullDeltas();
          Swal.fire({
            icon: res.success ? 'success' : 'warning',
            title: res.success ? '¡Pull Completado!' : 'Aviso de Sincronización',
            text: res.success ? `Se descargaron y fusionaron ${res.pulled || 0} registros.` : (res.error || 'Error de conexión')
          }).then(() => {
            window.location.reload();
          });
        });

        document.getElementById('btnModalSyncAllGlobal')?.addEventListener('click', async () => {
          Swal.showLoading();
          await syncEngine.syncAll();
          Swal.fire({
            icon: 'success',
            title: '¡Sincronización Completada!',
            text: 'Base de datos local sincronizada con la nube.'
          }).then(() => {
            window.location.reload();
          });
        });
      }
    });
  });
}

let isOnlineSimulator = true;
function initNetworkSimulator() {
  const toggleNetworkBtn = document.getElementById('toggleNetworkBtn');
  const networkBanner = document.getElementById('networkBanner');
  const networkStatusText = document.getElementById('networkStatusText');
  const bannerTitle = document.getElementById('bannerTitle');
  const bannerDesc = document.getElementById('bannerDesc');

  if (!toggleNetworkBtn) return;

  toggleNetworkBtn.addEventListener('click', () => {
    isOnlineSimulator = !isOnlineSimulator;
    if (isOnlineSimulator) {
      toggleNetworkBtn.className = 'btn-network-sidebar online';
      networkStatusText.textContent = 'En Línea';
      networkBanner.className = 'status-banner banner-online';
      bannerTitle.textContent = 'Conexión Activa';
      bannerDesc.textContent = 'Los datos se guardan en IndexedDB local y se sincronizan con SQLite central.';
      window.dispatchEvent(new Event('online'));
    } else {
      toggleNetworkBtn.className = 'btn-network-sidebar offline';
      networkStatusText.textContent = 'Modo Local / Fuera de Línea';
      networkBanner.className = 'status-banner banner-offline';
      bannerTitle.textContent = 'Modo Fuera de Línea (Offline)';
      bannerDesc.textContent = 'Sin conexión de red. Todas las operaciones se almacenan localmente en IndexedDB.';
      window.dispatchEvent(new Event('offline'));
    }
  });
}
