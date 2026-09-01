import { getCurrentUser, logout } from './auth.js';

export function injectAppLayout(activePageId) {
  const user = getCurrentUser();
  const container = document.querySelector('.container');
  if (!container) return;

  // Añadir clase al body para el layout con sidebar
  document.body.classList.add('has-sidebar-layout');

  const roleColors = {
    ADMIN: { bg: '#e0e7ff', text: '#4338ca', label: '👑 ADMINISTRADOR' },
    CAJERO: { bg: '#dcfce7', text: '#15803d', label: '💵 TESORERÍA / CAJA' },
    LECTOR: { bg: '#fef3c7', text: '#b45309', label: '⏱️ MICROMEDICIÓN' }
  };
  const roleInfo = roleColors[user?.rol] || { bg: '#f1f5f9', text: '#475569', label: user?.rol || 'USUARIO' };

  // Crear o reutilizar el wrapper de layout
  let layoutWrapper = document.querySelector('.app-layout-wrapper');
  if (!layoutWrapper) {
    layoutWrapper = document.createElement('div');
    layoutWrapper.className = 'app-layout-wrapper';
    document.body.appendChild(layoutWrapper);
  }

  // 1. Navbar / Sidebar Izquierdo
  const sidebar = document.createElement('aside');
  sidebar.className = 'app-sidebar-left';

  const allMenuItems = [
    { id: 'socios', href: 'socios.html', icon: '👥', label: '1. Padrón de Socios', desc: 'Abonados y 3ra edad', roles: ['ADMIN', 'CAJERO'] },
    { id: 'lecturas', href: 'lecturas.html', icon: '⏱️', label: '2. Toma de Lecturas', desc: 'Micromedición por sector', roles: ['ADMIN', 'CAJERO', 'LECTOR'] },
    { id: 'caja', href: 'caja.html', icon: '💵', label: '3. Caja y Cobros', desc: 'Liquidación y recibos', roles: ['ADMIN', 'CAJERO'] },
    { id: 'fondos', href: 'fondos.html', icon: '🏛️', label: '4. Fondos (3 Col)', desc: 'Libro Mayor Ing/Egr/Saldo', roles: ['ADMIN', 'CAJERO'] },
    { id: 'reportes', href: 'reportes.html', icon: '📊', label: '5. Reportes & Auditoría', desc: 'Morosidad y asamblea', roles: ['ADMIN', 'CAJERO'] },
    { id: 'admin', href: 'admin.html', icon: '👑', label: '6. Gobernanza & Tarifas', desc: 'Parámetros del sistema', roles: ['ADMIN'] }
  ];

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

    <!-- Menú de Pestañas del Cobrador y Operador -->
    <nav class="sidebar-nav-menu">
      <div class="sidebar-nav-label">MÓDULOS DEL SISTEMA</div>
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

  // Banner de Sincronización Superior
  const banner = document.createElement('div');
  banner.id = 'networkBanner';
  banner.className = 'status-banner banner-online';
  banner.innerHTML = `
    <div class="banner-content">
      <span class="banner-icon">🌐</span>
      <div>
        <strong id="bannerTitle">Conexión Activa</strong>
        <p id="bannerDesc">Los datos se guardan en IndexedDB local y se sincronizan con SQLite / Supabase.</p>
      </div>
    </div>
    <div class="banner-action">
      <span class="queue-badge" id="queueBadge">0 pendientes en Outbox</span>
    </div>
  `;

  // Mover el contenedor dentro del área principal
  container.parentNode.removeChild(container);
  mainContent.appendChild(banner);
  mainContent.appendChild(container);

  layoutWrapper.appendChild(sidebar);
  layoutWrapper.appendChild(mainContent);

  // Listener para Logout
  document.getElementById('btnLogoutSidebar')?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  // Network Simulator
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
      bannerDesc.textContent = 'Los datos se guardan en IndexedDB local y se sincronizan con SQLite / Supabase.';
    } else {
      toggleNetworkBtn.className = 'btn-network-sidebar offline';
      networkStatusText.textContent = 'Fuera de Línea';
      networkBanner.className = 'status-banner banner-offline';
      bannerTitle.textContent = 'Modo Fuera de Línea (Offline)';
      bannerDesc.textContent = 'Sin conexión. Todas las mutaciones se almacenan localmente en la cola Outbox.';
    }
  });
}
