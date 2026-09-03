import { getCurrentUser, logout } from './auth.js';

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
    } else {
      toggleNetworkBtn.className = 'btn-network-sidebar offline';
      networkStatusText.textContent = 'Modo Local / Fuera de Línea';
      networkBanner.className = 'status-banner banner-offline';
      bannerTitle.textContent = 'Modo Fuera de Línea (Offline)';
      bannerDesc.textContent = 'Sin conexión de red. Todas las operaciones se almacenan localmente en IndexedDB.';
    }
  });
}
