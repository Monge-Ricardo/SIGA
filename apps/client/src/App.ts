import { createNetworkStatusBanner } from './components/NetworkStatusBanner.ts';

export function renderApp(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'app-container';

  const header = document.createElement('header');
  header.innerHTML = `
    <h1 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: #38bdf8;">
      💧 App Agua & Flujo de Caja
    </h1>
    <p style="color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.5rem;">
      Arquitectura Offline-First de Alto Rendimiento para Entornos de Bajos Recursos
    </p>
  `;

  root.appendChild(header);
  root.appendChild(createNetworkStatusBanner());

  return root;
}
