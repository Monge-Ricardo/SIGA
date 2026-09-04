import { socioService } from '../../services/socioService.ts';
import type { SocioAgua, EstadoServicio } from '@app-agua/shared';
import { TARIFAS_CONFIG } from '@app-agua/shared';

export interface SocioDetailModalOptions {
  socio: SocioAgua;
  onEdit: (socio: SocioAgua) => void;
  onStatusChange: () => void;
  onClose: () => void;
}

export function createSocioDetailModal(options: SocioDetailModalOptions): HTMLElement {
  const { socio, onEdit, onStatusChange, onClose } = options;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal-card modal-large';

  const isEnMora = socio.estadoCuenta === 'EN_MORA' || socio.mesesAdeudados > 0;
  const tarifaBase = socio.esTerceraEdad ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
  const tarifaAlcant = socio.tieneAlcantarillado ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0;

  const statusClass =
    socio.estadoServicio === 'ACTIVO'
      ? 'status-badge-active'
      : socio.estadoServicio === 'SUSPENDIDO'
      ? 'status-badge-suspended'
      : 'status-badge-cut';

  modal.innerHTML = `
    <div class="modal-header">
      <div class="socio-detail-title-group">
        <div class="socio-avatar">
          ${socio.esTerceraEdad ? '👴' : '👤'}
        </div>
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <h2 style="font-size: 1.35rem; font-weight: 700; color: #f8fafc; margin: 0;">
              ${socio.nombreCompleto}
            </h2>
            <span class="status-badge ${statusClass}">
              ${socio.estadoServicio}
            </span>
          </div>
          <p style="font-size: 0.85rem; color: #94a3b8; margin-top: 4px;">
            Código: <strong>${socio.codigoSocio}</strong> &nbsp;|&nbsp; Cédula: <strong>${socio.cedulaRuc}</strong>
          </p>
        </div>
      </div>
      <button class="btn-close-modal" id="closeDetailModalBtn">&times;</button>
    </div>

    <div class="socio-detail-body">
      <!-- Columna 1: Información Personal y Técnica -->
      <div class="detail-column">
        <h3 class="detail-section-heading">📋 Información del Abonado</h3>
        
        <div class="detail-item">
          <span class="detail-label">Categoría Tarifaria:</span>
          <span class="detail-value">
            <span class="age-badge ${socio.esTerceraEdad ? 'badge-senior' : 'badge-normal'}">
              ${socio.esTerceraEdad ? '👴 Tercera Edad (Tarifa Preferencial)' : '👤 Normal'}
            </span>
          </span>
        </div>

        <div class="detail-item">
          <span class="detail-label">Edad Calculada:</span>
          <span class="detail-value"><strong>${socio.edadCalculada} años</strong> (${socio.fechaNacimiento})</span>
        </div>

        <div class="detail-item">
          <span class="detail-label">Sector / Barrio:</span>
          <span class="detail-value"><strong>${socio.nombreSector || socio.sectorId}</strong></span>
        </div>

        <div class="detail-item">
          <span class="detail-label">N° de Medidor:</span>
          <span class="detail-value"><span class="badge-code">${socio.medidorNumero || 'Sin medidor'}</span></span>
        </div>

        <div class="detail-item">
          <span class="detail-label">Servicio Alcantarillado:</span>
          <span class="detail-value">
            ${socio.tieneAlcantarillado ? '<span class="tag-yes">SÍ</span>' : '<span class="tag-no">NO</span>'}
          </span>
        </div>

        <div class="detail-item">
          <span class="detail-label">Fecha de Afiliación:</span>
          <span class="detail-value">${socio.fechaAfiliacion || 'No registrada'}</span>
        </div>

        <div class="detail-item">
          <span class="detail-label">Teléfono:</span>
          <span class="detail-value">${socio.telefono || 'No registrado'}</span>
        </div>

        <div class="detail-item full-span">
          <span class="detail-label">Dirección:</span>
          <span class="detail-value">${socio.direccion || 'Sin dirección especificada'}</span>
        </div>
      </div>

      <!-- Columna 2: Estado Financiero y Cuenta Corriente -->
      <div class="detail-column">
        <h3 class="detail-section-heading">💳 Estado de Cuenta Corriente</h3>

        <div class="account-status-card ${isEnMora ? 'account-mora' : 'account-ok'}">
          <div class="account-status-header">
            <span class="account-status-icon">${isEnMora ? '⚠️' : '✅'}</span>
            <div>
              <strong style="font-size: 1.05rem;">
                ${isEnMora ? 'EN MORA / ATRASADO' : 'AL DÍA CON SUS PAGOS'}
              </strong>
              <p style="font-size: 0.8rem; margin: 2px 0 0 0; opacity: 0.9;">
                ${isEnMora ? `${socio.mesesAdeudados} mes(es) pendiente(s) de cobro` : 'Sin valores adeudados pendientes'}
              </p>
            </div>
          </div>
          ${
            isEnMora
              ? `
            <div class="account-debt-info">
              <div class="debt-total">
                <span>Total Deuda Acumulada:</span>
                <strong>$${socio.montoTotalAdeudado?.toFixed(2) || '0.00'} USD</strong>
              </div>
              <div style="font-size: 0.8rem; color: #fca5a5; margin-top: 4px;">
                Desde: ${socio.fechaDeudaAntigua || 'Período anterior'}
              </div>
            </div>
          `
              : ''
          }
        </div>

        <h3 class="detail-section-heading" style="margin-top: 1.25rem;">💧 Desglose de Valores a Cobrar (Cuota Fija Mensual)</h3>
        <div class="tariff-breakdown-box">
          <div class="breakdown-row">
            <span>Cuota Fija Base (30 m³):</span>
            <span>$${tarifaBase.toFixed(2)}</span>
          </div>
          <div class="breakdown-row">
            <span>Servicio de Alcantarillado:</span>
            <span>${tarifaAlcant > 0 ? '$' + tarifaAlcant.toFixed(2) : '$0.00 (No aplica)'}</span>
          </div>
          <div class="breakdown-divider"></div>
          <div class="breakdown-row total">
            <span><strong>Total Cuota Mensual Fija:</strong></span>
            <span class="text-accent" style="font-size: 1.15rem; font-weight: 700;">
              $${(tarifaBase + tarifaAlcant).toFixed(2)} USD
            </span>
          </div>
        </div>

        <!-- Acciones de Estado de Servicio -->
        <div class="service-status-controller" style="margin-top: 1.25rem;">
          <label style="font-size: 0.85rem; color: #94a3b8; display: block; margin-bottom: 6px;">
            Cambiar Estado del Servicio Operativo:
          </label>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm ${socio.estadoServicio === 'ACTIVO' ? 'btn-active-state' : 'btn-outline'}" id="btnSetActivo">
              🟢 Activo
            </button>
            <button class="btn btn-sm ${socio.estadoServicio === 'SUSPENDIDO' ? 'btn-suspended-state' : 'btn-outline'}" id="btnSetSuspendido">
              🟡 Suspender
            </button>
            <button class="btn btn-sm ${socio.estadoServicio === 'CORTADO' ? 'btn-cut-state' : 'btn-outline'}" id="btnSetCortado">
              🔴 Cortar
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal-actions" style="margin-top: 1.5rem; justify-content: space-between;">
      <button type="button" class="btn btn-secondary" id="btnEditSocioDetail">
        ✏️ Editar Información
      </button>
      <button type="button" class="btn btn-primary" id="btnCloseDetailAction">
        Cerrar Ficha
      </button>
    </div>
  `;

  overlay.appendChild(modal);

  const closeModal = () => {
    overlay.remove();
    onClose();
  };

  header.querySelector('#closeDetailModalBtn')?.addEventListener('click', closeModal);
  modal.querySelector('#btnCloseDetailAction')?.addEventListener('click', closeModal);

  modal.querySelector('#btnEditSocioDetail')?.addEventListener('click', () => {
    overlay.remove();
    onEdit(socio);
  });

  const handleStatusUpdate = async (newStatus: EstadoServicio) => {
    if (socio.estadoServicio === newStatus) return;
    if (confirm(`¿Está seguro de cambiar el estado del servicio a ${newStatus}?`)) {
      await socioService.cambiarEstadoServicio(socio.id, newStatus);
      socio.estadoServicio = newStatus;
      overlay.remove();
      onStatusChange();
    }
  };

  modal.querySelector('#btnSetActivo')?.addEventListener('click', () => handleStatusUpdate('ACTIVO'));
  modal.querySelector('#btnSetSuspendido')?.addEventListener('click', () => handleStatusUpdate('SUSPENDIDO'));
  modal.querySelector('#btnSetCortado')?.addEventListener('click', () => handleStatusUpdate('CORTADO'));

  return overlay;
}
