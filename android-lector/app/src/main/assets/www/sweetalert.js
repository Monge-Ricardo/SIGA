/**
 * SIGA-Comunitario • SweetAlert Offline Utility (JavaScript Puro)
 * Soporte 100% Local-First para modales interactivos de alerta y confirmación.
 */

class SweetAlertOffline {
  fire(options = {}) {
    return new Promise((resolve) => {
      // Eliminar alerta previa si existe
      document.querySelector('.swal-overlay')?.remove();

      const overlay = document.createElement('div');
      overlay.className = 'swal-overlay';

      const iconsMap = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️',
        question: '❓'
      };

      const iconEmoji = options.icon ? iconsMap[options.icon] || 'ℹ️' : '';
      const iconClass = options.icon ? `swal-icon-${options.icon}` : '';

      const modal = document.createElement('div');
      modal.className = 'swal-modal';

      modal.innerHTML = `
        ${iconEmoji ? `<div class="swal-icon-container ${iconClass}">${iconEmoji}</div>` : ''}
        ${options.title ? `<h3 class="swal-title">${options.title}</h3>` : ''}
        ${options.text ? `<div class="swal-text">${options.text}</div>` : ''}
        ${options.html ? `<div class="swal-html">${options.html}</div>` : ''}
        <div class="swal-actions">
          ${
            options.showCancelButton
              ? `<button class="swal-btn swal-btn-cancel" id="swalBtnCancel">${options.cancelButtonText || 'Cancelar'}</button>`
              : ''
          }
          <button class="swal-btn swal-btn-confirm" id="swalBtnConfirm">${options.confirmButtonText || 'Aceptar'}</button>
        </div>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const cleanup = (isConfirmed) => {
        overlay.classList.add('swal-closing');
        setTimeout(() => {
          overlay.remove();
          resolve({ isConfirmed });
        }, 150);
      };

      modal.querySelector('#swalBtnConfirm')?.addEventListener('click', () => cleanup(true));
      modal.querySelector('#swalBtnCancel')?.addEventListener('click', () => cleanup(false));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && options.showCancelButton) cleanup(false);
      });
    });
  }
}

export const Swal = new SweetAlertOffline();

if (typeof window !== 'undefined') {
  window.Swal = Swal;
}
