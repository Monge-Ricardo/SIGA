import {
  socioService,
  calcularEdad,
  esTerceraEdad,
  calcularTarifaBaseEstimada,
  validarCedulaEcuatoriana
} from '../../services/socioService.ts';
import type { SocioAgua, Sector, EstadoServicio } from '@app-agua/shared';
import { TARIFAS_CONFIG } from '@app-agua/shared';

export interface SocioFormModalOptions {
  socioToEdit?: SocioAgua;
  sectores: Sector[];
  onSave: () => void;
  onClose: () => void;
}

export function createSocioFormModal(options: SocioFormModalOptions): HTMLElement {
  const { socioToEdit, sectores, onSave, onClose } = options;
  const isEditing = !!socioToEdit;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal-card modal-large';

  // Header
  const header = document.createElement('div');
  header.className = 'modal-header';
  header.innerHTML = `
    <div>
      <h2 style="font-size: 1.25rem; font-weight: 700; color: #f8fafc;">
        ${isEditing ? '✏️ Editar Socio / Abonado' : '➕ Registrar Nuevo Socio'}
      </h2>
      <p style="font-size: 0.85rem; color: #94a3b8; margin-top: 2px;">
        Padrón de Socios - Cálculo dinámico de 3ra Edad y Tarifación Base
      </p>
    </div>
    <button class="btn-close-modal" id="closeModalBtn">&times;</button>
  `;

  // Form Container
  const form = document.createElement('form');
  form.className = 'form-grid-modal';

  const defaultFechaNac = socioToEdit?.fechaNacimiento || '1985-01-01';
  const defaultFechaAfil = socioToEdit?.fechaAfiliacion || new Date().toISOString().split('T')[0];
  const defaultAlcantarillado = socioToEdit?.tieneAlcantarillado ?? true;
  const defaultEstado: EstadoServicio = socioToEdit?.estadoServicio || 'ACTIVO';
  const defaultSectorId = socioToEdit?.sectorId || (sectores[0]?.id || 'sec-01');

  form.innerHTML = `
    <!-- Datos Personales -->
    <div class="form-section-title">👤 Datos Personales e Identificación</div>

    <div class="form-group">
      <label for="inputCedula">Cédula / RUC *</label>
      <input type="text" id="inputCedula" value="${socioToEdit?.cedulaRuc || ''}" placeholder="Ej. 0923456781" maxlength="13" required />
      <span class="field-help" id="cedulaValidationMsg">10 dígitos para persona natural</span>
    </div>

    <div class="form-group">
      <label for="inputNombres">Nombres Completos *</label>
      <input type="text" id="inputNombres" value="${socioToEdit?.nombres || ''}" placeholder="Ej. Juan Alberto" required />
    </div>

    <div class="form-group">
      <label for="inputApellidos">Apellidos Completos *</label>
      <input type="text" id="inputApellidos" value="${socioToEdit?.apellidos || ''}" placeholder="Ej. Pérez Zambrano" required />
    </div>

    <div class="form-group">
      <label for="inputFechaNac">Fecha de Nacimiento *</label>
      <input type="date" id="inputFechaNac" value="${defaultFechaNac}" required />
      <span class="field-help">Se calculará la categoría y tarifa automáticamente</span>
    </div>

    <!-- Indicador Reactivo de Tercera Edad y Tarifa -->
    <div class="form-group full-width">
      <div class="tariff-preview-card" id="tariffPreviewCard">
        <!-- Contenido dinámico calculado -->
      </div>
    </div>

    <!-- Ubicación y Servicio -->
    <div class="form-section-title">📍 Ubicación y Datos del Servicio</div>

    <div class="form-group">
      <label for="selectSector">Sector / Barrio Comunitario *</label>
      <select id="selectSector" required>
        ${sectores
          .map(
            (sec) =>
              `<option value="${sec.id}" ${sec.id === defaultSectorId ? 'selected' : ''}>${sec.codigo} - ${sec.nombre}</option>`
          )
          .join('')}
      </select>
    </div>

    <div class="form-group">
      <label for="inputMedidor">Número de Medidor</label>
      <input type="text" id="inputMedidor" value="${socioToEdit?.medidorNumero || ''}" placeholder="Ej. MED-10450" />
    </div>

    <div class="form-group">
      <label for="inputTelefono">Teléfono de Contacto</label>
      <input type="tel" id="inputTelefono" value="${socioToEdit?.telefono || ''}" placeholder="Ej. 0991234567" />
    </div>

    <div class="form-group">
      <label for="inputFechaAfil">Fecha de Afiliación / Unión</label>
      <input type="date" id="inputFechaAfil" value="${defaultFechaAfil}" required />
    </div>

    <div class="form-group full-width">
      <label for="inputDireccion">Dirección de Domicilio / Referencia</label>
      <input type="text" id="inputDireccion" value="${socioToEdit?.direccion || ''}" placeholder="Ej. Calle Principal s/n frente a la cancha comunal" />
    </div>

    <div class="form-group">
      <label for="selectEstado">Estado del Servicio</label>
      <select id="selectEstado">
        <option value="ACTIVO" ${defaultEstado === 'ACTIVO' ? 'selected' : ''}>🟢 Activo</option>
        <option value="SUSPENDIDO" ${defaultEstado === 'SUSPENDIDO' ? 'selected' : ''}>🟡 Suspendido</option>
        <option value="CORTADO" ${defaultEstado === 'CORTADO' ? 'selected' : ''}>🔴 Cortado</option>
      </select>
    </div>

    <div class="form-group">
      <label class="checkbox-label" style="margin-top: 1.75rem;">
        <input type="checkbox" id="checkAlcantarillado" ${defaultAlcantarillado ? 'checked' : ''} />
        <span><strong>Posee Servicio de Alcantarillado</strong> (+${TARIFAS_CONFIG.RECARGO_ALCANTARILLADO.toFixed(2)}$/mes)</span>
      </label>
    </div>

    <div class="modal-actions full-width">
      <button type="button" class="btn btn-secondary" id="btnCancelModal">Cancelar</button>
      <button type="submit" class="btn btn-primary" id="btnSaveSocio">
        💾 ${isEditing ? 'Guardar Cambios' : 'Registrar Socio'}
      </button>
    </div>
  `;

  modal.appendChild(header);
  modal.appendChild(form);
  overlay.appendChild(modal);

  // Elementos reactivos
  const inputFechaNac = form.querySelector('#inputFechaNac') as HTMLInputElement;
  const checkAlcantarillado = form.querySelector('#checkAlcantarillado') as HTMLInputElement;
  const tariffPreviewCard = form.querySelector('#tariffPreviewCard') as HTMLElement;
  const inputCedula = form.querySelector('#inputCedula') as HTMLInputElement;
  const cedulaValidationMsg = form.querySelector('#cedulaValidationMsg') as HTMLElement;

  function actualizarTarifaPreview() {
    const fechaNac = inputFechaNac.value;
    const edad = calcularEdad(fechaNac);
    const es3raEdad = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
    const tieneAlcant = checkAlcantarillado.checked;
    const tarifaBase = es3raEdad ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
    const recargoAlcant = tieneAlcant ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0;
    const totalEstimado = (tarifaBase + recargoAlcant).toFixed(2);

    tariffPreviewCard.innerHTML = `
      <div class="tariff-preview-header">
        <div class="age-badge ${es3raEdad ? 'badge-senior' : 'badge-normal'}">
          ${es3raEdad ? '👴 TERCERA EDAD (Subsidio Aplicado)' : '👤 CATEGORÍA NORMAL'}
          <span style="font-weight: 400; opacity: 0.9;">(${edad} años)</span>
        </div>
        <div class="tariff-total">
          <span class="total-label">Tarifa Base Fija Estimada:</span>
          <span class="total-amount">$${totalEstimado} USD / mes</span>
        </div>
      </div>
      <div class="tariff-preview-details">
        <span>🔹 Cuota Base ($30 m³ base): <strong>$${tarifaBase.toFixed(2)}</strong></span>
        <span>🔹 Alcantarillado: <strong>${tieneAlcant ? '+$' + TARIFAS_CONFIG.RECARGO_ALCANTARILLADO.toFixed(2) : 'No aplica ($0.00)'}</strong></span>
        <span style="color: #94a3b8; font-size: 0.8rem;">* Excedente >30 m³ se factura a $0.10/m³ adicional en la toma de lecturas.</span>
      </div>
    `;
  }

  // Escuchar cambios reactivos
  inputFechaNac.addEventListener('input', actualizarTarifaPreview);
  checkAlcantarillado.addEventListener('change', actualizarTarifaPreview);
  actualizarTarifaPreview();

  // Validación de cédula en tiempo real
  inputCedula.addEventListener('input', () => {
    const val = inputCedula.value.trim();
    if (val.length === 10) {
      const res = validarCedulaEcuatoriana(val);
      if (res.valida) {
        cedulaValidationMsg.textContent = '✓ Cédula válida (Módulo 10)';
        cedulaValidationMsg.style.color = '#10b981';
      } else {
        cedulaValidationMsg.textContent = `⚠️ ${res.mensaje}`;
        cedulaValidationMsg.style.color = '#f59e0b';
      }
    } else {
      cedulaValidationMsg.textContent = `${val.length}/10 dígitos`;
      cedulaValidationMsg.style.color = '#94a3b8';
    }
  });

  // Cerrar modal
  const closeModal = () => {
    overlay.remove();
    onClose();
  };

  header.querySelector('#closeModalBtn')?.addEventListener('click', closeModal);
  form.querySelector('#btnCancelModal')?.addEventListener('click', closeModal);

  // Enviar formulario
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const cedula = inputCedula.value.trim();
    const nombres = (form.querySelector('#inputNombres') as HTMLInputElement).value.trim();
    const apellidos = (form.querySelector('#inputApellidos') as HTMLInputElement).value.trim();
    const fechaNacimiento = inputFechaNac.value;
    const sectorId = (form.querySelector('#selectSector') as HTMLSelectElement).value;
    const sectorSeleccionado = sectores.find((s) => s.id === sectorId);
    const medidorNumero = (form.querySelector('#inputMedidor') as HTMLInputElement).value.trim();
    const telefono = (form.querySelector('#inputTelefono') as HTMLInputElement).value.trim();
    const direccion = (form.querySelector('#inputDireccion') as HTMLInputElement).value.trim();
    const fechaAfiliacion = (form.querySelector('#inputFechaAfil') as HTMLInputElement).value;
    const estadoServicio = (form.querySelector('#selectEstado') as HTMLSelectElement).value as EstadoServicio;
    const tieneAlcantarillado = checkAlcantarillado.checked;

    if (!cedula || !nombres || !apellidos || !fechaNacimiento) {
      alert('Por favor complete los campos obligatorios (*)');
      return;
    }

    try {
      const submitBtn = form.querySelector('#btnSaveSocio') as HTMLButtonElement;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Guardando en IndexedDB...';

      if (isEditing && socioToEdit) {
        await socioService.actualizarSocio(socioToEdit.id, {
          cedulaRuc: cedula,
          nombres,
          apellidos,
          fechaNacimiento,
          sectorId,
          nombreSector: sectorSeleccionado?.nombre,
          medidorNumero: medidorNumero || undefined,
          telefono: telefono || undefined,
          direccion: direccion || undefined,
          fechaAfiliacion,
          estadoServicio,
          tieneAlcantarillado
        });
      } else {
        const codigoAuto = `${sectorSeleccionado?.codigo || 'SEC'}-${Math.floor(100 + Math.random() * 900)}`;
        await socioService.crearSocio({
          codigoSocio: codigoAuto,
          cedulaRuc: cedula,
          nombres,
          apellidos,
          nombreCompleto: `${nombres} ${apellidos}`,
          fechaNacimiento,
          fechaAfiliacion,
          sectorId,
          nombreSector: sectorSeleccionado?.nombre,
          direccion,
          telefono,
          medidorNumero: medidorNumero || `MED-${Math.floor(10000 + Math.random() * 90000)}`,
          tieneAlcantarillado,
          estadoServicio,
          estadoCuenta: 'AL_DIA',
          mesesAdeudados: 0,
          montoTotalAdeudado: 0
        });
      }

      overlay.remove();
      onSave();
    } catch (err: any) {
      alert(`Error al guardar socio: ${err.message || err}`);
      const submitBtn = form.querySelector('#btnSaveSocio') as HTMLButtonElement;
      submitBtn.disabled = false;
      submitBtn.textContent = isEditing ? 'Guardar Cambios' : 'Registrar Socio';
    }
  });

  return overlay;
}
