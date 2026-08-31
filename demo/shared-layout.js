import { getCurrentUser, logout } from './auth.js';

export function injectAppLayout(activePageId) {
  const user = getCurrentUser();
  const container = document.querySelector('.container');
  if (!container) return;

  // 1. Top Header
  const header = document.createElement('header');
  header.className = 'app-header';

  const roleColors = {
    ADMIN: { bg: '#e0e7ff', text: '#4338ca', label: '👑 ADMIN' },
    CAJERO: { bg: '#dcfce7', text: '#15803d', label: '💵 TESORERÍA / CAJA' },
    LECTOR: { bg: '#fef3c7', text: '#b45309', label: '⏱️ ROL LECTOR' }
  };
  const roleInfo = roleColors[user?.rol] || { bg: '#f1f5f9', text: '#475569', label: user?.rol || 'USUARIO' };

  header.innerHTML = `
    <div class="brand">
      <div class="brand-icon">💧</div>
      <div>
        <h1 class="brand-title">SIGA-Comunitario • App Agua & Caja</h1>
        <p class="brand-subtitle">Gestión Integral de Agua Potable y Control de Fondos (Offline-First)</p>
      </div>
    </div>
    <div class="header-controls">
      <!-- Info Usuario y Logout -->
      <div class="user-session-pill">
        <div class="user-avatar-mini">${user?.rol === 'ADMIN' ? '👑' : user?.rol === 'CAJERO' ? '💵' : '⏱️'}</div>
        <div class="user-session-text">
          <div class="user-session-name">${user?.nombre || user?.username || 'Usuario'}</div>
          <span class="user-role-badge" style="background: ${roleInfo.bg}; color: ${roleInfo.text};">${roleInfo.label}</span>
        </div>
        <button class="btn btn-sm btn-logout" id="btnLogoutHeader" title="Cerrar Sesión">
          🚪 Cerrar Sesión
        </button>
      </div>

      <div class="badge-perf" id="perfMeter">⚡ Latencia DB: <span>0.0 ms</span></div>
      <button id="toggleNetworkBtn" class="btn-network online">
        <span class="pulse-dot"></span>
        <span id="networkStatusText">Simulador: EN LÍNEA</span>
      </button>
    </div>
  `;

  // 2. Banner de Red
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

  // 3. Navigation Bar (El Cajero/Tesorero maneja todos los módulos operativos y de reportes)
  const nav = document.createElement('nav');
  nav.className = 'app-nav';

  const allMenuItems = [
    { id: 'socios', href: 'socios.html', icon: '👥', label: '1. Padrón de Socios', roles: ['ADMIN', 'CAJERO'] },
    { id: 'lecturas', href: 'lecturas.html', icon: '⏱️', label: '2. Toma de Lecturas', roles: ['ADMIN', 'CAJERO', 'LECTOR'] },
    { id: 'caja', href: 'caja.html', icon: '💵', label: '3. Caja y Cobros', roles: ['ADMIN', 'CAJERO'] },
    { id: 'fondos', href: 'fondos.html', icon: '🏛️', label: '4. Fondos (3 Col)', roles: ['ADMIN', 'CAJERO'] },
    { id: 'reportes', href: 'reportes.html', icon: '📊', label: '5. Reportes & Auditoría', roles: ['ADMIN', 'CAJERO'] },
    { id: 'admin', href: 'admin.html', icon: '👑', label: '6. Gobernanza & Tarifas', roles: ['ADMIN'] }
  ];

  // Filtrar solo los módulos que pertenecen al rol activo
  const permittedItems = allMenuItems.filter(
    (item) => !user || item.roles.includes(user.rol)
  );

  const ul = document.createElement('ul');
  ul.className = 'nav-tabs';

  permittedItems.forEach((item) => {
    const isActive = item.id === activePageId;
    const li = document.createElement('li');
    li.innerHTML = `
      <a href="${item.href}" class="nav-tab-btn ${isActive ? 'active' : ''}">
        <span>${item.icon}</span> ${item.label}
      </a>
    `;
    ul.appendChild(li);
  });

  nav.appendChild(ul);

  container.insertBefore(nav, container.firstChild);
  container.insertBefore(banner, container.firstChild);
  container.insertBefore(header, container.firstChild);

  // Logout listener
  document.getElementById('btnLogoutHeader')?.addEventListener('click', () => {
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
      toggleNetworkBtn.className = 'btn-network online';
      networkStatusText.textContent = 'Simulador: EN LÍNEA';
      networkBanner.className = 'status-banner banner-online';
      bannerTitle.textContent = 'Conexión Activa';
      bannerDesc.textContent = 'Los datos se guardan en IndexedDB local y se sincronizan con SQLite / Supabase.';
    } else {
      toggleNetworkBtn.className = 'btn-network offline';
      networkStatusText.textContent = 'Simulador: FUERA DE LÍNEA';
      networkBanner.className = 'status-banner banner-offline';
      bannerTitle.textContent = 'Modo Fuera de Línea (Offline)';
      bannerDesc.textContent = 'Sin conexión. Todas las mutaciones se almacenan localmente en la cola Outbox.';
    }
  });
}
