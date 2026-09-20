/**
 * SIGA-Comunitario • SweetAlert Offline Utility (JavaScript Puro)
 * Soporte 100% Local-First para modales interactivos de alerta y confirmación.
 */

class SweetAlertOffline {
  mixin(mixinOptions = {}) {
    return {
      fire: (fireOptions = {}) => this.fire({ ...mixinOptions, ...fireOptions })
    };
  }

  showLoading() {
    const existing = document.querySelector('.swal-modal') || document.querySelector('.swal-toast');
    if (existing) {
      const actions = existing.querySelector('.swal-actions');
      if (actions) {
        actions.innerHTML = '<div style="font-size: 0.85rem; color: #0284c7; font-weight: 600; padding: 6px;">⏳ Procesando solicitud...</div>';
      }
    }
  }

  close() {
    document.querySelectorAll('.swal-overlay, .swal-toast-container').forEach((el) => el.remove());
  }

  fire(options = {}) {
    return new Promise((resolve) => {
      // 1. Manejo de modo TOAST (Notificación no bloqueante en esquina)
      if (options.toast) {
        let container = document.querySelector('.swal-toast-container');
        if (!container) {
          container = document.createElement('div');
          container.className = 'swal-toast-container';
          container.style.cssText = `
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
          `;
          document.body.appendChild(container);
        }

        const iconsMap = {
          success: '✅',
          error: '❌',
          warning: '⚠️',
          info: 'ℹ️',
          question: '❓'
        };

        const iconEmoji = options.icon ? iconsMap[options.icon] || 'ℹ️' : '';
        const toast = document.createElement('div');
        toast.className = 'swal-toast';
        toast.style.cssText = `
          background: #0f172a;
          color: #ffffff;
          padding: 10px 16px;
          border-radius: 8px;
          box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3);
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 0.85rem;
          display: flex;
          align-items: center;
          gap: 8px;
          pointer-events: auto;
          transition: all 0.25s ease;
          opacity: 0;
          transform: translateY(-8px);
        `;

        toast.innerHTML = `
          ${iconEmoji ? `<span style="font-size: 1.1rem;">${iconEmoji}</span>` : ''}
          <div style="font-weight: 600;">${options.title || options.text || ''}</div>
        `;

        container.appendChild(toast);

        requestAnimationFrame(() => {
          toast.style.opacity = '1';
          toast.style.transform = 'translateY(0)';
        });

        const timerMs = options.timer || 2500;
        setTimeout(() => {
          toast.style.opacity = '0';
          toast.style.transform = 'translateY(-8px)';
          setTimeout(() => {
            toast.remove();
            if (container.children.length === 0) container.remove();
            resolve({ isConfirmed: true });
          }, 250);
        }, timerMs);

        return;
      }

      // 2. Modal Completo (Alerta / Confirmación con Overlay)
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

      if (options.timer) {
        setTimeout(() => cleanup(true), options.timer);
      }
    });
  }
}

export const Swal = new SweetAlertOffline();

if (typeof window !== 'undefined') {
  window.Swal = Swal;
}
