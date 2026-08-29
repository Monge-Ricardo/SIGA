export type TabId = 'socios' | 'lecturas' | 'caja' | 'fondos' | 'reportes';

export interface TabItem {
  id: TabId;
  label: string;
  icon: string;
  badge?: string;
  disponible: boolean;
}

import { authService } from '../services/auth.ts';
import type { RolUsuario } from '@app-agua/shared';

export function createNavbar(
  activeTab: TabId,
  onTabChange: (tabId: TabId) => void
): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'app-nav';

  const user = authService.getCurrentUser();
  const userRole: RolUsuario = user?.rol || 'ADMIN';

  const allTabs: Array<TabItem & { roles: RolUsuario[] }> = [
    { id: 'socios', label: '1. Padrón de Socios', icon: '👥', roles: ['ADMIN', 'CAJERO'], disponible: true },
    { id: 'lecturas', label: '2. Toma de Lecturas', icon: '⏱️', roles: ['ADMIN', 'LECTOR'], disponible: true },
    { id: 'caja', label: '3. Caja y Cobros', icon: '💵', roles: ['ADMIN', 'CAJERO'], disponible: true },
    { id: 'fondos', label: '4. Fondos (3 Col)', icon: '🏛️', roles: ['ADMIN', 'CAJERO'], disponible: true },
    { id: 'reportes', label: '5. Reportes & Auditoría', icon: '📊', roles: ['ADMIN'], disponible: true }
  ];

  const permittedTabs = allTabs.filter((t) => t.roles.includes(userRole));

  const list = document.createElement('ul');
  list.className = 'nav-tabs';

  permittedTabs.forEach((tab) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = `nav-tab-btn ${tab.id === activeTab ? 'active' : ''}`;
    btn.innerHTML = `
      <span class="tab-icon">${tab.icon}</span>
      <span class="tab-label">${tab.label}</span>
    `;

    btn.addEventListener('click', () => {
      onTabChange(tab.id);
    });

    li.appendChild(btn);
    list.appendChild(li);
  });

  nav.appendChild(list);
  return nav;
}
