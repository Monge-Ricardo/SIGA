import { createNavbar, type TabId } from './components/Navbar.ts';
import { createNetworkStatusBanner } from './components/NetworkStatusBanner.ts';
import { createSocioList } from './components/socios/SocioList.ts';
import { createLecturaList } from './components/lecturas/LecturaList.ts';
import { seedInitialDatabaseIfEmpty } from './db/indexedDB.ts';

export function renderApp(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'app-container';

  // Iniciar datos semilla en segundo plano
  seedInitialDatabaseIfEmpty().catch((err) => {
    console.warn('[App] Error al sembrar base de datos inicial:', err);
  });

  // Top Header
  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `
    <div class="brand">
      <div class="brand-icon">💧</div>
      <div>
        <h1 class="brand-title">SIGA-Comunitario • App Agua & Caja</h1>
        <p class="brand-subtitle">
          Sistema Offline-First de Gestión de Agua Potable y Control de Fondos
        </p>
      </div>
    </div>
    <div class="header-status-group">
      <div class="badge-env">⚡ Rendimiento: <span style="color: #059669; font-weight: 700;">&lt; 50ms</span></div>
      <div class="badge-offline">📦 Local-First (IndexedDB)</div>
    </div>
  `;

  root.appendChild(header);
  root.appendChild(createNetworkStatusBanner());

  let activeTab: TabId = 'socios';
  const mainContent = document.createElement('main');
  mainContent.className = 'main-module-viewport';

  function renderActiveModule() {
    mainContent.innerHTML = '';

    if (activeTab === 'socios') {
      mainContent.appendChild(createSocioList());
    } else if (activeTab === 'lecturas') {
      mainContent.appendChild(createLecturaList());
    } else if (activeTab === 'caja') {
      mainContent.appendChild(renderModulePlaceholder(
        '3. Liquidación, Tarifas y Cobro en Caja',
        '💵',
        'Facturación mensual, desglose de cargo fijo ($7 normal / $5 3ra edad), excedente ($0.10/m³), alcantarillado (+$1.00), multas y deudas anteriores.',
        'Próximo en el Pipeline: Módulo 3'
      ));
    } else if (activeTab === 'fondos') {
      mainContent.appendChild(renderModulePlaceholder(
        '4. Contraloría y Destino de Fondos (Libro Mayor 3 Columnas)',
        '🏛️',
        'Distribución estricta del canon base ($2 Padre, $4 Mantenimiento, $0.50 Lector, $0.50 Mortuorio) y fondos de Pro-mejoras con Ingresos - Egresos - Saldo.',
        'Próximo en el Pipeline: Módulo 4'
      ));
    } else if (activeTab === 'reportes') {
      mainContent.appendChild(renderModulePlaceholder(
        '5. Informes, Consultas y Auditoría',
        '📊',
        'Reportes mensuales, trimestrales, semestrales y anuales por socio y sector. Cartera vencida y liquidación de entrega al Padre.',
        'Próximo en el Pipeline: Módulo 5'
      ));
    }
  }

  function renderModulePlaceholder(title: string, icon: string, desc: string, badge: string): HTMLElement {
    const card = document.createElement('div');
    card.className = 'module-placeholder-card';
    card.innerHTML = `
      <div class="placeholder-icon">${icon}</div>
      <span class="placeholder-badge">${badge}</span>
      <h2 style="font-size: 1.5rem; font-weight: 700; color: #f8fafc; margin: 12px 0 8px;">${title}</h2>
      <p style="color: #94a3b8; max-width: 600px; line-height: 1.6; margin-bottom: 20px;">${desc}</p>
      <button class="btn btn-secondary" id="btnBackToSocios">
        ⬅️ Volver a Padrón de Socios (Módulo 1)
      </button>
    `;
    card.querySelector('#btnBackToSocios')?.addEventListener('click', () => {
      activeTab = 'socios';
      updateNavAndModule();
    });
    return card;
  }

  let navElement = createNavbar(activeTab, (tabId) => {
    activeTab = tabId;
    updateNavAndModule();
  });

  function updateNavAndModule() {
    const newNav = createNavbar(activeTab, (tabId) => {
      activeTab = tabId;
      updateNavAndModule();
    });
    root.replaceChild(newNav, navElement);
    navElement = newNav;
    renderActiveModule();
  }

  root.appendChild(navElement);
  root.appendChild(mainContent);

  renderActiveModule();

  return root;
}
