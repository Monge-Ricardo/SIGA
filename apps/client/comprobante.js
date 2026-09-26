import { apiFetch } from './auth.js';

/**
 * Módulo: Comprobante Oficial de Pago de Agua Potable
 * Arquitectura: API-First & Single Responsibility Principle (SRP)
 * Responsabilidad: Consumir el endpoint /api/v1/facturas/:id/comprobante
 * y renderizar el comprobante oficial físico/digital exacto de la Junta Administradora.
 */

/**
 * Genera un código de barras en formato SVG vectorial nítido
 * @param {string} code - Texto a codificar en el código de barras
 * @returns {string} - SVG string
 */
export function generarBarcodeSVG(code = 'ABC0123456789ABC') {
  const cleanCode = String(code).replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'ABC0123456789ABC';
  const barPatterns = [
    '101001101101', '110100101011', '101100101011', '110110100101',
    '101011001011', '110101100101', '101101100101', '101001011011',
    '110100101101', '101100101101', '110101001011', '110101011001'
  ];

  let binaryPattern = '11010010100'; // Start pattern
  for (let i = 0; i < cleanCode.length; i++) {
    const charCode = cleanCode.charCodeAt(i);
    const pattern = barPatterns[charCode % barPatterns.length];
    binaryPattern += pattern;
  }
  binaryPattern += '110001010111'; // Stop pattern

  const barWidth = 1.4;
  const barHeight = 44;
  let x = 10;
  let rects = '';

  for (let i = 0; i < binaryPattern.length; i++) {
    if (binaryPattern[i] === '1') {
      rects += `<rect x="${x.toFixed(1)}" y="0" width="${barWidth}" height="${barHeight}" fill="#000" />`;
    }
    x += barWidth;
  }

  const svgWidth = Math.ceil(x + 10);
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${barHeight + 16}" style="max-width: 260px; height: 56px; display: block; margin: 0 auto;">
      ${rects}
      <text x="${(svgWidth / 2).toFixed(1)}" y="${barHeight + 12}" font-family="monospace, Courier" font-size="11" font-weight="700" text-anchor="middle" fill="#000" letter-spacing="2">${cleanCode}</text>
    </svg>
  `;
}

/**
 * Consulta los datos autoritativos del comprobante vía API REST (API-First)
 * @param {string} facturaId - ID o número de la factura
 * @returns {Promise<Object>} Datos estructurados del comprobante
 */
export async function fetchComprobanteData(facturaId) {
  if (!facturaId) throw new Error('ID de factura requerido para consultar comprobante.');

  const res = await apiFetch(`/api/v1/facturas/${encodeURIComponent(facturaId)}/comprobante`);
  if (!res || !res.success || !res.data) {
    throw new Error(res?.error || 'No se pudo obtener la información del comprobante desde el servidor.');
  }

  return res.data;
}

/**
 * Renderiza el Comprobante Oficial en el contenedor DOM exacto
 * @param {Object} data - Objeto retornado por /api/v1/facturas/:id/comprobante
 * @param {HTMLElement|string} targetContainer - Contenedor DOM donde inyectar el comprobante
 */
export function renderComprobanteEnDOM(data, targetContainer = 'printableReceiptContent') {
  const container = typeof targetContainer === 'string' ? document.getElementById(targetContainer) : targetContainer;
  if (!container) return;

  const { institucion, comprobante, socio, medidores, historicoConsumo, detalleValores } = data;

  // 1. Generar filas de medidores
  const rowsMedidores = (medidores && medidores.length > 0 ? medidores : [
    {
      numeroMedidor: socio.medidorNumero || '1211036816',
      basicoM3: 30,
      lecturaAnterior: 1456,
      lecturaActual: 1488,
      consumoM3: 32,
      excedenteM3: 2,
      alcantarilladoTexto: 'Si'
    }
  ]).map((m) => `
    <tr>
      <td><strong>${m.numeroMedidor || 'S/N'}</strong></td>
      <td>${Number(m.basicoM3 || 30).toFixed(0)}</td>
      <td>${Number(m.lecturaAnterior || 0).toFixed(0)}</td>
      <td>${Number(m.lecturaActual || 0).toFixed(0)}</td>
      <td><strong>${Number(m.consumoM3 || 0).toFixed(0)}</strong></td>
      <td>${Number(m.excedenteM3 || 0).toFixed(0)}</td>
      <td>${m.alcantarilladoTexto || (m.tieneAlcantarillado ? 'Si' : 'No')}</td>
    </tr>
  `).join('');

  // 2. Generar barras del histórico de consumo (últimos 5 meses)
  const mesesHistorico = historicoConsumo?.meses || [
    { periodo: 'JUL/26', consumo: 18 },
    { periodo: 'AGO/26', consumo: 15 },
    { periodo: 'SEP/26', consumo: 13 },
    { periodo: 'OCT/26', consumo: 15 },
    { periodo: 'NOV/26', consumo: 13 }
  ];

  const maxConsumo = Math.max(...mesesHistorico.map((m) => Number(m.consumo || 0)), 20);
  const barsHTML = mesesHistorico.map((m) => {
    const cons = Number(m.consumo || 0);
    const pct = Math.max(8, Math.min(100, Math.round((cons / maxConsumo) * 65)));
    return `
      <div class="comp-bar-col">
        <span class="comp-bar-val">${cons}</span>
        <div class="comp-bar-fill" style="height: ${pct}px;"></div>
        <span class="comp-bar-lbl">${m.periodo}</span>
      </div>
    `;
  }).join('');

  // 3. Generar filas de "Consumo del Mes" (SOLO rubros cobrados o facturados)
  const itemsConsumoMes = (detalleValores?.consumoMes || []).filter(
    (item) => Number(item.aPagarCobrado || 0) > 0 || (Number(item.valorTotal || 0) > 0 && Number(item.saldoRestante || 0) > 0)
  );
  const rowsConsumoMes = itemsConsumoMes.map((item) => `
    <tr>
      <td style="text-align: center;">${item.cp}</td>
      <td style="text-align: center;">${item.ca}</td>
      <td>${item.descripcion}</td>
      <td style="text-align: right;">${Number(item.valorTotal || 0).toFixed(2)}</td>
      <td style="text-align: right; color: ${item.saldoRestante > 0 ? '#dc2626' : '#64748b'};">${Number(item.saldoRestante || 0).toFixed(2)}</td>
      <td style="text-align: right; font-weight: 700;">${Number(item.aPagarCobrado || 0).toFixed(2)}</td>
    </tr>
  `).join('');

  // 4. Generar filas de "Rubros Pendientes y Cuotas" (SOLO rubros cobrados o pendientes)
  const itemsRubrosPend = (detalleValores?.rubrosPendientes || []).filter(
    (item) => Number(item.aPagarCobrado || 0) > 0 || (Number(item.valorTotal || 0) > 0 && Number(item.saldoRestante || 0) > 0)
  );
  const rowsRubrosPend = itemsRubrosPend.map((item) => `
    <tr>
      <td style="text-align: center;">${item.cp}</td>
      <td style="text-align: center;">${item.ca}</td>
      <td>${item.descripcion}</td>
      <td style="text-align: right;">${Number(item.valorTotal || 0).toFixed(2)}</td>
      <td style="text-align: right; color: ${item.saldoRestante > 0 ? '#dc2626' : '#64748b'};">${Number(item.saldoRestante || 0).toFixed(2)}</td>
      <td style="text-align: right; font-weight: 700;">${Number(item.aPagarCobrado || 0).toFixed(2)}</td>
    </tr>
  `).join('');

  // 5. SVG del Código de Barras
  const barcodeSVG = generarBarcodeSVG(comprobante.codigoBarras || comprobante.numeroFactura || 'ABC0123456789ABC');

  // Subtablas dinámicas: Solo se renderizan si tienen rubros cobrados o facturados
  const subtablaConsumoMesHTML = itemsConsumoMes.length > 0 ? `
    <div class="comp-subtable-title">Consumo del Mes</div>
    <table class="comp-valores-table">
      <thead>
        <tr>
          <th style="width: 50px; text-align: center;">CP</th>
          <th style="width: 40px; text-align: center;">CA</th>
          <th>DESCRIPCIÓN</th>
          <th style="width: 100px; text-align: right;">VALOR TOTAL</th>
          <th style="width: 100px; text-align: right;">SALDO REST.</th>
          <th style="width: 130px; text-align: right;">A PAGAR/COBRADO</th>
        </tr>
      </thead>
      <tbody>
        ${rowsConsumoMes}
      </tbody>
    </table>
  ` : '';

  const subtablaRubrosPendHTML = itemsRubrosPend.length > 0 ? `
    <div class="comp-subtable-title" style="margin-top: ${itemsConsumoMes.length > 0 ? '8px' : '2px'};">Rubros Pendientes y Cuotas</div>
    <table class="comp-valores-table">
      <thead>
        <tr>
          <th style="width: 50px; text-align: center;">CP</th>
          <th style="width: 40px; text-align: center;">CA</th>
          <th>DESCRIPCIÓN</th>
          <th style="width: 100px; text-align: right;">VALOR TOTAL</th>
          <th style="width: 100px; text-align: right;">SALDO REST.</th>
          <th style="width: 130px; text-align: right;">A PAGAR/COBRADO</th>
        </tr>
      </thead>
      <tbody>
        ${rowsRubrosPend}
      </tbody>
    </table>
  ` : '';

  // 6. Ensamblaje completo del comprobante oficial idéntico a la plantilla
  container.innerHTML = `
    <div class="comprobante-oficial-wrapper" id="comprobanteOficialRoot">
      <!-- HEADER CURVO OFICIAL -->
      <div class="comp-header">
        <div class="comp-header-brand">
          <div class="comp-header-logo">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#004b87" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" fill="#004b87"></path>
            </svg>
          </div>
          <div class="comp-header-title">
            <span>AGUA POTABLE Y</span>
            <span>ALCANTARILLADO DE LA</span>
            <span>PARROQUIA PISHILATA</span>
          </div>
        </div>
        <div class="comp-header-info">
          <div><strong>Matriz:</strong> ${institucion?.matriz || 'Vía a Quillán'}</div>
          <div><strong>Provincia:</strong> ${institucion?.provincia || 'Tungurahua'}</div>
          <div><strong>Atención al Cliente :</strong> ${institucion?.telefono || '0987370618'}</div>
        </div>
      </div>

      <!-- METADATA Y CÓDIGO DE BARRAS -->
      <div class="comp-meta-section">
        <div class="comp-meta-left">
          <div class="comp-meta-row"><strong>FACTURA NO.</strong> <span>${comprobante.numeroComprobante || comprobante.numeroFactura}</span></div>
          <div class="comp-meta-row"><strong>FECHA Y HORA AUT:</strong> <span>${comprobante.fechaHoraAut || comprobante.fechaHoraEmision}</span></div>
        </div>
        <div class="comp-barcode-box">
          ${barcodeSVG}
        </div>
      </div>

      <!-- DATOS DEL SOCIO Y CONEXIÓN (2 COLUMNAS) -->
      <div class="comp-socio-grid">
        <div class="comp-socio-col">
          <div class="comp-info-item"><span class="comp-lbl">CUENTA No:</span> <strong class="comp-val">${socio.cuentaNo}</strong></div>
          <div class="comp-info-item"><span class="comp-lbl">Razón Social:</span> <strong class="comp-val">${socio.razonSocial}</strong></div>
          <div class="comp-info-item"><span class="comp-lbl">Sector:</span> <span class="comp-val">${socio.sector}</span></div>
          <div class="comp-info-item"><span class="comp-lbl">No. Medidor:</span> <span class="comp-val">${medidores[0]?.numeroMedidor || socio.medidorNumero || 'S/N'}</span></div>
        </div>
        <div class="comp-socio-col">
          <div class="comp-info-item"><span class="comp-lbl">Cedula:</span> <span class="comp-val">${socio.cedulaRuc}</span></div>
          <div class="comp-info-item"><span class="comp-lbl">Telefono:</span> <span class="comp-val">${socio.telefono || '-'}</span></div>
          <div class="comp-info-item"><span class="comp-lbl">Tarifa:</span> <strong class="comp-val">${socio.tarifa || (socio.esTerceraEdad ? 'Tercera Edad' : 'Normal')}</strong></div>
          <div class="comp-info-item"><span class="comp-lbl">Periodo Consumo:</span> <strong class="comp-val" style="color: #0284c7;">${socio.periodoConsumo}</strong></div>
        </div>
      </div>

      <!-- TABLA DE MICROMEDICIÓN / MEDIDOR -->
      <table class="comp-table comp-medidores-table">
        <thead>
          <tr>
            <th>MEDIDOR</th>
            <th>BASICO (m3)</th>
            <th>LECT. ANT.</th>
            <th>LECT. ACTUAL</th>
            <th>CONSUMO (m3)</th>
            <th>EXCEDENTES (m3)</th>
            <th>ALCANTARILLADO</th>
          </tr>
        </thead>
        <tbody>
          ${rowsMedidores}
        </tbody>
      </table>

      <!-- HISTÓRICO DE CONSUMO MENSUAL EN M³ -->
      <div class="comp-section-title">HISTÓRICO DE CONSUMO MENSUAL EN M³</div>
      <div class="comp-historico-box">
        <div class="comp-historico-left">
          <div class="comp-bars-container">
            ${barsHTML}
          </div>
        </div>
        <div class="comp-historico-right">
          <div class="comp-droplet-badge">
            <svg viewBox="0 0 100 100" class="comp-droplet-svg">
              <ellipse cx="50" cy="74" rx="36" ry="12" fill="none" stroke="#000" stroke-width="3"></ellipse>
              <ellipse cx="50" cy="74" rx="24" ry="7" fill="none" stroke="#000" stroke-width="2.5"></ellipse>
              <path d="M50 14 C44 26, 30 46, 30 60 A20 20 0 0 0 70 60 C70 46, 56 26, 50 14 Z" fill="#fff" stroke="#000" stroke-width="3"></path>
            </svg>
            <div class="comp-droplet-txt">
              <strong>${historicoConsumo.consumoTotalAcumulado || 1367} m³</strong>
              <span>consumo</span>
            </div>
          </div>
          <div class="comp-promedio-txt">Su consumo promedio es: <strong>${historicoConsumo.consumoPromedio || 15} m3</strong></div>
        </div>
      </div>

      <!-- DETALLE DE VALORES A PAGAR / FACTURACIÓN -->
      <div class="comp-section-title" style="margin-top: 10px;">DETALLE DE VALORES A PAGAR</div>
      <div class="comp-banner-facturacion">FACTURACIÓN</div>

      <!-- Subtablas dinámicas -->
      ${subtablaConsumoMesHTML}
      ${subtablaRubrosPendHTML}

      <!-- PIE DE COMPROBANTE Y TOTALES -->
      <div class="comp-footer">
        <div class="comp-footer-left">
          <div class="comp-metodo-line">
            <span>Metodo Pago: <strong>${comprobante.metodoPago || 'Efectivo'}</strong></span> &bull; 
            <span>Cajero: <strong>${comprobante.cajeroNombre || 'Caja Central'}</strong></span>
          </div>
          <div class="comp-stamp-badge ${comprobante.esAbono ? 'badge-abono' : 'badge-cancelado'}">
            ${comprobante.esAbono ? '⚠️ ABONO PARCIAL REGISTRADO' : '✓ TOTAL CANCELADO'}
          </div>
          ${comprobante.esAbono && detalleValores.saldoPendienteTotal > 0 ? `
            <div style="font-size: 0.78rem; color: #dc2626; font-weight: 700; margin-top: 2px;">
              Saldo Pendiente Restante: $${Number(detalleValores.saldoPendienteTotal).toFixed(2)} USD
            </div>
          ` : ''}
        </div>
        <div class="comp-footer-right">
          <div class="comp-total-box">
            <span class="comp-total-lbl">VALOR TOTAL FACTURA</span>
            <span class="comp-total-num">${Number(detalleValores.totalCobrado || detalleValores.totalFactura || 0).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Transforma un objeto cobro local a la estructura oficial del comprobante (Fallback Offline)
 * @param {Object} cobro - Objeto del cobro registrado en caja
 * @returns {Object} DTO canónico de comprobante oficial
 */
export function transformarCobroLocalAComprobante(cobro = {}) {
  const fecha = new Date(cobro.fechaPago || cobro.fecha_pago || cobro.createdAt || Date.now());
  const dia = String(fecha.getDate()).padStart(2, '0');
  const nombresMeses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  const mesNom = nombresMeses[fecha.getMonth()];
  const anio = fecha.getFullYear();
  const hora = String(fecha.getHours()).padStart(2, '0');
  const min = String(fecha.getMinutes()).padStart(2, '0');

  const numFactura = cobro.numeroFactura || cobro.numeroRecibo || cobro.id || 'FAC-000001';
  let numCorrelativo = String(numFactura).replace(/^(?:REC|FAC)-/i, '');
  if (/^\d{4}-/.test(numCorrelativo)) numCorrelativo = numCorrelativo.replace(/^\d{4}-/, '');
  if (/^\d+$/.test(numCorrelativo)) numCorrelativo = numCorrelativo.padStart(6, '0');

  // Determinar si en este cobro se incluyó consumo del mes o si es solo deuda anterior / saldo pendiente
  const montoTotalFactura = Number(cobro.montoTotal ?? cobro.montoPagado ?? cobro.totalPagar ?? 0);
  const saldoAnt = Number(cobro.deudaAnteriorCobrada || cobro.valorDeudaAnterior || 0);
  const deudaAlcant = Number(cobro.deudaAlcantarilladoCobrada || 0);
  const multas = Number(cobro.multaExtra || cobro.valorMultas || 0);

  let totalMes = Number(cobro.totalMes || 0);
  let cargoBaseExplicit = Number(cobro.cargoBase !== undefined ? cobro.cargoBase : (cobro.valorBase !== undefined ? cobro.valorBase : 0));
  let excedenteExplicit = Number(cobro.valorExcedenteUSD || cobro.valorExcedente || 0);
  let alcantMesExplicit = Math.max(0, Number(cobro.alcantarilladoUSD || 0) - deudaAlcant);
  const consumoM3Explicit = Number(cobro.consumoM3 || 0);

  // Discriminación estricta de consumo de agua mensual:
  // Un recibo REC-... de abono o liquidación de deuda anterior SIN totalMes ni cargoBase NO tiene consumo de agua
  const esReciboAbonoDeuda = String(cobro.numeroFactura || cobro.numeroRecibo || '').startsWith('REC-') && saldoAnt > 0 && totalMes === 0 && cargoBaseExplicit === 0;
  const tieneConsumoAgua = !esReciboAbonoDeuda && (totalMes > 0 || cargoBaseExplicit > 0 || excedenteExplicit > 0 || alcantMesExplicit > 0 || consumoM3Explicit > 0);

  let cargoBase = 0;
  let excedente = 0;
  let alcantMes = 0;

  if (tieneConsumoAgua) {
    cargoBase = cargoBaseExplicit;
    excedente = excedenteExplicit;
    alcantMes = alcantMesExplicit;
    if (cargoBase === 0 && totalMes > 0) {
      cargoBase = Math.max(0, Number((totalMes - excedente - alcantMes).toFixed(2))) || totalMes;
    }
  }

  const cobroConsumoMes = tieneConsumoAgua && (cargoBase > 0 || excedente > 0 || alcantMes > 0);
  const esSoloSaldoAnterior = !cobroConsumoMes && saldoAnt > 0;

  // Medidores (Si solo paga saldo anterior, mostrar sin consumo imputado)
  const medidorNum = cobro.medidorNumero || cobro.numeroMedidor || 'S/N';
  let cobroLecAnt = Number(cobro.lecturaAnterior || 0);
  let cobroLecAct = Number(cobro.lecturaActual || 0);
  let cobroConsumoM3 = Number(cobro.consumoM3 || 0);
  let cobroExcedenteM3 = Number(cobro.excedenteM3 || 0);
  const valorExcCobro = Number(cobro.valorExcedenteUSD || cobro.valorExcedente || 0);

  if (cobroExcedenteM3 === 0 && valorExcCobro > 0) {
    cobroExcedenteM3 = Math.round(valorExcCobro / 0.10);
  }

  // Si no vienen lecturas en el objeto cobro pero hay consumo o medidor, buscarlas en window.cachedLecturas
  if (cobroLecAnt === 0 && cobroLecAct === 0 && typeof window !== 'undefined' && Array.isArray(window.cachedLecturas)) {
    const matchedLec = window.cachedLecturas.find((l) =>
      (cobro.idLectura && (l.id === cobro.idLectura || l.id_lectura === cobro.idLectura)) ||
      (cobro.idMedidor && l.id_medidor === cobro.idMedidor) ||
      (medidorNum && medidorNum !== 'S/N' && (l.numeroMedidor === medidorNum || l.numero_medidor === medidorNum)) ||
      (cobro.idSocio && l.id_socio === cobro.idSocio)
    );
    if (matchedLec) {
      cobroLecAnt = Number(matchedLec.lectura_anterior ?? 0);
      cobroLecAct = Number(matchedLec.lectura_actual ?? (cobroLecAnt + cobroConsumoM3));
      if (matchedLec.consumo_total && Number(matchedLec.consumo_total) > cobroConsumoM3) {
        cobroConsumoM3 = Number(matchedLec.consumo_total);
      }
      if (matchedLec.excedente_m3 && Number(matchedLec.excedente_m3) > cobroExcedenteM3) {
        cobroExcedenteM3 = Number(matchedLec.excedente_m3);
      }
    }
  }

  if (cobroLecAct > cobroLecAnt) {
    const consLec = cobroLecAct - cobroLecAnt;
    if (consLec > cobroConsumoM3) cobroConsumoM3 = consLec;
  }

  if (cobroConsumoM3 <= 30 && cobroExcedenteM3 > 0) {
    cobroConsumoM3 = cobroConsumoM3 + cobroExcedenteM3;
  }
  if (cobroExcedenteM3 === 0 && cobroConsumoM3 > 30) {
    cobroExcedenteM3 = cobroConsumoM3 - 30;
  }

  const meds = esSoloSaldoAnterior
    ? [
        {
          numeroMedidor: medidorNum,
          basicoM3: 0,
          lecturaAnterior: cobroLecAnt,
          lecturaActual: cobroLecAct,
          consumoM3: 0,
          excedenteM3: 0,
          alcantarilladoTexto: 'No'
        }
      ]
    : (cobro.medidoresCobrados && cobro.medidoresCobrados.length > 0)
    ? cobro.medidoresCobrados.map((m) => {
        const cons = Number(m.consumoM3 || (Number(m.lecturaActual || 0) - Number(m.lecturaAnterior || 0)));
        const basico = 30;
        const exc = Math.max(0, cons - basico);
        return {
          numeroMedidor: m.numeroMedidor || m.medidorNumero || 'S/N',
          basicoM3: basico,
          lecturaAnterior: Number(m.lecturaAnterior || 0),
          lecturaActual: Number(m.lecturaActual || 0),
          consumoM3: cons,
          excedenteM3: exc,
          alcantarilladoTexto: Number(m.alcantarilladoUSD || 0) > 0 ? 'Si' : 'No'
        };
      })
    : [
        {
          numeroMedidor: medidorNum,
          basicoM3: 30,
          lecturaAnterior: cobroLecAnt,
          lecturaActual: cobroLecAct,
          consumoM3: cobroConsumoM3,
          excedenteM3: cobroExcedenteM3,
          alcantarilladoTexto: Number(cobro.alcantarilladoUSD || 0) > 0 ? 'Si' : 'No'
        }
      ];

  const totalConsumo = meds.reduce((acc, m) => acc + m.consumoM3, 0);

  const esAbono = Boolean(cobro.esAbono || (cobro.saldoPendiente !== undefined && Number(cobro.saldoPendiente) > 0));
  const montoCobrado = Number(cobro.montoAbonado ?? cobro.montoPagado ?? cobro.montoTotal ?? 0);
  const saldoR = Number(cobro.saldoPendiente || 0);

  // Subtabla Consumo del Mes (SOLO si realmente formó parte de la transacción cobrada)
  const consumoMes = [];
  if (cobroConsumoMes) {
    if (cargoBase > 0) {
      consumoMes.push({
        cp: 'AP01',
        ca: '01',
        descripcion: 'Consumo Agua Potable (30 m³ básico)',
        valorTotal: cargoBase,
        saldoRestante: 0,
        aPagarCobrado: cargoBase
      });
    }
    if (excedente > 0) {
      consumoMes.push({
        cp: 'EX01',
        ca: '01',
        descripcion: `Excedente de Consumo (${meds.reduce((acc, m) => acc + m.excedenteM3, 0)} m³)`,
        valorTotal: excedente,
        saldoRestante: 0,
        aPagarCobrado: excedente
      });
    }
    if (alcantMes > 0) {
      consumoMes.push({
        cp: 'AL01',
        ca: '01',
        descripcion: 'Alcantarillado del Período',
        valorTotal: alcantMes,
        saldoRestante: 0,
        aPagarCobrado: alcantMes
      });
    }
  }

  // Subtabla Rubros Pendientes y Cuotas (SOLO rubros activos o pagados)
  const rubrosPendientes = [];
  if (deudaAlcant > 0) {
    rubrosPendientes.push({
      cp: 'SA01',
      ca: '01',
      descripcion: 'Alcantarillado Pendiente Acumulado',
      valorTotal: deudaAlcant,
      saldoRestante: 0,
      aPagarCobrado: deudaAlcant
    });
  }
  if (saldoAnt > 0) {
    const valorTotalDeuda = Number((cobro.deudaTotalOriginal ? cobro.deudaTotalOriginal : (saldoAnt + saldoR)).toFixed(2));
    rubrosPendientes.push({
      cp: 'MA01',
      ca: '01',
      descripcion: 'Saldo Anterior / Deuda Histórica',
      valorTotal: valorTotalDeuda,
      saldoRestante: saldoR,
      aPagarCobrado: saldoAnt
    });
  }
  if (multas > 0) {
    rubrosPendientes.push({
      cp: 'MU01',
      ca: '01',
      descripcion: 'Multas y Sanciones',
      valorTotal: multas,
      saldoRestante: 0,
      aPagarCobrado: multas
    });
  }

  const subtotalConsumo = consumoMes.reduce((acc, c) => acc + c.aPagarCobrado, 0);
  const subtotalRubros = rubrosPendientes.reduce((acc, r) => acc + r.aPagarCobrado, 0);
  const totalCobradoFinal = Number((subtotalConsumo + subtotalRubros).toFixed(2)) || montoCobrado;

  const periodoConsumoFinal = esSoloSaldoAnterior
    ? 'DEUDA ANTERIOR / SALDO HISTÓRICO'
    : (cobro.periodo || `${mesNom} ${anio}`).toUpperCase();

  return {
    institucion: {
      nombre: 'AGUA POTABLE Y ALCANTARILLADO DE LA PARROQUIA PISHILATA',
      matriz: 'Vía a Quillán',
      provincia: 'Tungurahua',
      telefono: '0987370618'
    },
    comprobante: {
      id: cobro.id || '',
      numeroFactura: numFactura,
      numeroComprobante: numCorrelativo,
      codigoBarras: String(numFactura).replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
      fechaHoraAut: `${dia}-${mesNom.slice(0, 3)}-${anio} ${hora}:${min}`,
      metodoPago: cobro.metodoPago || 'EFECTIVO',
      cajeroNombre: cobro.cajeroNombre || 'Caja Central',
      esAbono,
      saldoPendiente: saldoR
    },
    socio: {
      cuentaNo: cobro.codigoSocio || (cobro.socioCedula ? `SOC-${cobro.socioCedula.slice(-5)}` : 'SOC-00102'),
      razonSocial: (cobro.socioNombre || '').toUpperCase(),
      sector: cobro.socioSector || 'Sector Centro',
      cedulaRuc: cobro.socioCedula || '',
      telefono: cobro.socioTelefono || '-',
      tarifa: cobro.tarifa || 'Normal',
      periodoConsumo: periodoConsumoFinal
    },
    medidores: meds,
    historicoConsumo: {
      meses: [
        { periodo: `${mesNom.slice(0, 3)}/${String(anio).slice(-2)}`, consumo: totalConsumo }
      ],
      consumoTotalAcumulado: meds.reduce((acc, m) => acc + m.lecturaActual, 0) || totalConsumo,
      consumoPromedio: totalConsumo || 15
    },
    detalleValores: {
      consumoMes,
      rubrosPendientes,
      subtotalConsumoMes: subtotalConsumo,
      subtotalRubrosPendientes: subtotalRubros,
      totalFactura: totalCobradoFinal,
      totalCobrado: totalCobradoFinal,
      saldoPendienteTotal: saldoR
    }
  };
}

/**
 * Función principal consumible: Consulta por API y muestra el modal con el comprobante oficial
 * @param {string} facturaId - ID o número correlativo de la factura
 * @param {Object} [fallbackCobro=null] - Datos locales del cobro para fallback en caso de error o modo offline
 */
export async function cargarYMostrarComprobante(facturaId, fallbackCobro = null) {
  const modal = document.getElementById('modalReciboPrint');
  if (!modal) return;

  // Mostrar modal con spinner de carga inicial
  modal.style.display = 'flex';
  const container = document.getElementById('printableReceiptContent');
  if (container) {
    container.innerHTML = `
      <div style="padding: 3rem; text-align: center; color: #475569;">
        <div class="spinner" style="margin: 0 auto 1rem; width: 36px; height: 36px; border: 3px solid #cbd5e1; border-top-color: #0284c7; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <p style="font-weight: 700; font-size: 0.95rem;">Cargando comprobante oficial desde el servidor...</p>
      </div>
    `;
  }

  try {
    if (facturaId) {
      const data = await fetchComprobanteData(facturaId);
      renderComprobanteEnDOM(data, container);
      return;
    }
  } catch (err) {
    console.warn('[Comprobante] Endpoint de comprobante no disponible o error:', err.message);
  }

  // Fallback seguro con datos en memoria si el endpoint no está disponible
  if (fallbackCobro) {
    const fallbackData = transformarCobroLocalAComprobante(fallbackCobro);
    renderComprobanteEnDOM(fallbackData, container);
    return;
  }

  if (container) {
    container.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: #dc2626;">
        <p style="font-weight: 800; font-size: 1.1rem;">⚠️ Error al cargar comprobante</p>
        <p style="color: #64748b; font-size: 0.88rem;">No se pudo comunicar con el endpoint de comprobante ni se encontraron datos locales.</p>
        <button class="btn btn-secondary" onclick="document.getElementById('modalReciboPrint').style.display='none'" style="margin-top: 1rem;">Cerrar</button>
      </div>
    `;
  }
}

// Exponer funciones en window para consumo global por el Módulo de Caja
if (typeof window !== 'undefined') {
  window.cargarYMostrarComprobante = cargarYMostrarComprobante;
  window.renderComprobanteEnDOM = renderComprobanteEnDOM;
  window.generarBarcodeSVG = generarBarcodeSVG;
  window.transformarCobroLocalAComprobante = transformarCobroLocalAComprobante;
}

