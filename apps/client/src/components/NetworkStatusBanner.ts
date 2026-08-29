import { connectivityStore, type ConnectionState } from '../stores/connectivityStore.ts';
import { syncEngine } from '../services/outboxEngine.ts';

export function createNetworkStatusBanner(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'status-banner';

  const updateUI = async (state: ConnectionState) => {
    const pendingCount = await syncEngine.getPendingCount();
    const isOnline = state === 'ONLINE';

    container.className = `status-banner ${isOnline ? 'status-online' : 'status-offline'}`;
    container.innerHTML = `
      <div class="status-indicator">
        <span class="dot"></span>
        <span class="status-text">${isOnline ? 'En línea (Sincronizado)' : 'Modo Fuera de Línea (Local)'}</span>
      </div>
      <div class="status-pending">
        ${pendingCount > 0 ? `<span>⏳ ${pendingCount} cambio(s) pendientes por enviar</span>` : `<span>✓ Todo al día</span>`}
      </div>
    `;
  };

  connectivityStore.subscribe((state) => updateUI(state));
  updateUI(connectivityStore.getState());

  return container;
}
