import { requireAuth, getCurrentUser, apiFetch, normalizeSearchText, matchesSearchTokens } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';
import { syncEngine } from './sync-engine.js';

// Guard de autenticación (Accesible por ADMIN y CAJERO)
const currentUser = requireAuth(['ADMIN', 'CAJERO']);
if (currentUser) {
  injectAppLayout('caja');
}

let db = null;

const TARIFAS_CONFIG = {
  BASE_NORMAL: 7.00,
  BASE_TERCERA_EDAD: 5.00,
  RECARGO_ALCANTARILLADO: 1.00,
  EXCEDENTE_POR_M3: 0.10,
  LIMITE_BASE_M3: 30,
  EDAD_TERCERA_EDAD: 65
};

// Obtiene todas las multas y rubros directamente desde el Backend REST API (Supabase Cloud)
async function getAllMultasFromDb() {
  try {
    const res = await apiFetch('/api/v1/multas');
    if (res && Array.isArray(res.data)) return res.data;
  } catch (e) {
    console.warn('[Caja] Error obteniendo multas:', e);
  }
  return [];
}

let selectedDeudaAlcantarilladoActiva = true;
let selectedDeudaAlcantarilladoMontoAbonar = 0;
let allLoadedMultas = [];
let selectedMultasAbonosMap = new Map(); // id -> montoAbonado
let selectedDeudasAnterioresAbonosMap = new Map(); // id -> montoAbonado

let PERIODO_ACTUAL = '2026-08';

async function getActivePeriodo() {
  try {
    const res = await apiFetch('/api/v1/periodos');
    if (res && Array.isArray(res.data) && res.data.length > 0) {
      const abierto = res.data.find((p) => p.estado === 'ABIERTO');
      if (abierto) return abierto.periodoCodigo || abierto.periodo_codigo || abierto.id;
    }
  } catch (e) {
    console.warn('[Caja] Error obteniendo período activo:', e);
  }
  return '2026-08';
}

// Variables del Módulo
let cachedSocios = [];
let cachedLecturas = [];
let selectedSocio = null;
let currentCalculation = null;
let socioCalculationsMedidores = [];
let selectedMedidoresIds = new Set();
let selectedMedidoresDeudaIds = new Set();
let socioMultas = [];
let selectedMultasIds = new Set();
let socioDeudasAnteriores = [];
let selectedDeudasAnterioresIds = new Set();

async function renderCajaUI() {
  const badge = document.getElementById('fechaHoyBadge');
  if (badge) {
    badge.textContent = new Date().toLocaleDateString('es-EC', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  // Resolver período activo dinámicamente
  PERIODO_ACTUAL = await getActivePeriodo();

  // 1. Cargar Socios, Medidores y Lecturas directamente desde el Backend REST API (Supabase Cloud en tiempo real)
  let localSocios = [];
  try {
    const [resSocios, resLecturas] = await Promise.all([
      apiFetch('/api/v1/socios'),
      apiFetch('/api/v1/lecturas?limit=1000')
    ]);
    if (resSocios && Array.isArray(resSocios.data) && resSocios.data.length > 0) {
      localSocios = resSocios.data;
    }
    if (resLecturas && Array.isArray(resLecturas.data)) {
      cachedLecturas = resLecturas.data;
    }
  } catch (err) {
    console.warn('[Caja] Fallback carga de socios/lecturas backend:', err);
  }

  if (localSocios.length === 0) {
    if (!db) db = await syncEngine.getDb().catch(() => null);
    if (db) {
      localSocios = await new Promise((res) => {
        try {
          const tx = db.transaction(['socios'], 'readonly');
          const req = tx.objectStore('socios').getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => res([]);
        } catch {
          res([]);
        }
      });
    }
  }

  // Cargar medidores adicionales si estuvieran en IndexedDB para modo offline
  let localMedidores = [];
  if (db) {
    localMedidores = await new Promise((res) => {
      try {
        const tx = db.transaction(['medidores'], 'readonly');
        const req = tx.objectStore('medidores').getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      } catch {
        res([]);
      }
    });
  }

  const medidoresPorSocio = new Map();
  localMedidores.forEach((m) => {
    const sid = m.idSocio || m.id_socio || m.socioId;
    if (!sid) return;
    if (!medidoresPorSocio.has(sid)) medidoresPorSocio.set(sid, []);
    medidoresPorSocio.get(sid).push({
      id: m.id,
      idMedidor: m.id,
      numeroMedidor: m.numeroMedidor || m.numero_medidor || m.medidorNumero,
      medidorNumero: m.numeroMedidor || m.numero_medidor || m.medidorNumero,
      alias: m.alias || m.aliasMedidor || 'Casa principal',
      aliasMedidor: m.alias || m.aliasMedidor || 'Casa principal',
      direccion: m.direccion || '',
      tieneAlcantarillado: Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado),
      estado: m.estado || 'ACTIVO',
      lecturaAnterior: Number(m.lecturaAnterior ?? m.lecturaInicial ?? m.lectura_anterior ?? m.lectura_inicial ?? 0),
      lecturaInicial: Number(m.lecturaInicial ?? m.lecturaAnterior ?? m.lectura_inicial ?? m.lectura_anterior ?? 0),
      deudaPendiente: Number(m.deudaPendiente ?? m.deuda_pendiente ?? 0)
    });
  });

  cachedSocios = localSocios.map((s) => {
    let meds = (s.medidores && s.medidores.length > 0) ? s.medidores : (medidoresPorSocio.get(s.id) || []);
    if ((!meds || meds.length === 0) && s.medidorNumero) {
      meds = [{
        id: s.medidorNumero,
        idMedidor: s.medidorNumero,
        numeroMedidor: s.medidorNumero,
        medidorNumero: s.medidorNumero,
        alias: 'Casa principal',
        aliasMedidor: 'Casa principal',
        tieneAlcantarillado: Boolean(s.tieneAlcantarillado ?? s.tiene_alcantarillado ?? false),
        lecturaAnterior: 0,
        lecturaInicial: 0,
        deudaPendiente: 0
      }];
    }

    return {
      id: s.id,
      codigoSocio: s.codigoSocio || s.codigo_socio,
      nombres: s.nombres,
      apellidos: s.apellidos,
      nombreCompleto: s.nombreCompleto || `${s.apellidos || ''} ${s.nombres || ''}`.trim() || `${s.nombres || ''} ${s.apellidos || ''}`.trim() || s.codigoSocio,
      cedulaRuc: s.cedulaRuc || s.cedula_ruc,
      fechaNacimiento: s.fechaNacimiento || s.fecha_nacimiento,
      sectorId: s.idSector || s.sectorId || s.id_sector,
      nombreSector: s.nombreSector || s.nombre_sector || 'Sector General',
      medidorNumero: s.medidorNumero || s.medidor_numero || (meds[0]?.numeroMedidor || ''),
      medidores: meds,
      tieneAlcantarillado: Boolean(s.tieneAlcantarillado ?? s.tiene_alcantarillado ?? (meds.some(m => m.tieneAlcantarillado))),
      deudaAlcantarillado: Number(s.deudaAlcantarillado !== undefined ? s.deudaAlcantarillado : (s.deuda_alcantarillado || 0)),
      estadoServicio: s.estado || s.estadoServicio || 'ACTIVO',
      estadoCuenta: s.estadoCuenta || (s.montoTotalAdeudado > 0 ? 'EN_MORA' : 'AL_DIA'),
      mesesAdeudados: s.mesesAdeudados || 0,
      montoTotalAdeudado: Number(s.montoTotalAdeudado || 0)
    };
  });

  populateSocioSelect(cachedSocios);
  setupSocioSearch();
  await updateMetricsAndHistory();
}

function populateSocioSelect(socios) {
  const select = document.getElementById('selectSocioCobro');
  if (!select) return;
  select.innerHTML = '<option value="">-- Buscar o seleccionar socio del padrón --</option>';

  const ordenados = [...socios].sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto));

  ordenados.forEach((s) => {
    const isMora = s.estadoCuenta === 'EN_MORA' || s.mesesAdeudados > 0;
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.nombreCompleto} (${s.cedulaRuc}) • ${s.nombreSector} ${isMora ? `⚠️ [MORA: $${s.montoTotalAdeudado.toFixed(2)}]` : '✅ [AL DÍA]'}`;
    select.appendChild(opt);
  });
}

let allLoadedCobros = [];
let currentRecibosFilter = 'HOY'; // 'HOY' o 'TODOS'
let currentRecibosSearch = '';

function isFechaHoy(fechaVal) {
  if (!fechaVal) return false;
  const d = new Date(fechaVal);
  if (isNaN(d.getTime())) return false;
  const hoy = new Date();
  return (
    d.getFullYear() === hoy.getFullYear() &&
    d.getMonth() === hoy.getMonth() &&
    d.getDate() === hoy.getDate()
  );
}

function setRecibosFilter(filter) {
  currentRecibosFilter = filter;
  const btnHoy = document.getElementById('tabRecibosHoy');
  const btnTodos = document.getElementById('tabRecibosTodos');
  if (filter === 'HOY') {
    if (btnHoy) {
      btnHoy.className = 'btn btn-sm btn-primary';
      btnHoy.style.fontWeight = '700';
    }
    if (btnTodos) {
      btnTodos.className = 'btn btn-sm btn-outline-secondary';
      btnTodos.style.fontWeight = '600';
      btnTodos.style.background = '#ffffff';
      btnTodos.style.border = '1px solid #cbd5e1';
      btnTodos.style.color = '#475569';
    }
  } else {
    if (btnTodos) {
      btnTodos.className = 'btn btn-sm btn-primary';
      btnTodos.style.fontWeight = '700';
      btnTodos.style.background = '';
      btnTodos.style.border = '';
      btnTodos.style.color = '';
    }
    if (btnHoy) {
      btnHoy.className = 'btn btn-sm btn-outline-secondary';
      btnHoy.style.fontWeight = '600';
      btnHoy.style.background = '#ffffff';
      btnHoy.style.border = '1px solid #cbd5e1';
      btnHoy.style.color = '#475569';
    }
  }
  renderRecibosTable();
}

function actualizarCuentasCorrientesSocios() {
  if (!cachedSocios || cachedSocios.length === 0) return;

  const idsFacturasPagadas = new Set();
  allLoadedCobros.forEach((c) => {
    if (c.estadoPago === 'PAGADO' || Number(c.saldoPendiente || 0) === 0) {
      if (c.id) idsFacturasPagadas.add(c.id);
      if (c.numeroFactura) idsFacturasPagadas.add(c.numeroFactura);
      if (c.numeroRecibo) idsFacturasPagadas.add(c.numeroRecibo);
    }
  });

  cachedSocios.forEach((s) => {
    // 1. Aspecto: Pago de Agua Actual (Agosto 2026)
    const pagoAgosto = allLoadedCobros.some((c) => {
      const isSocio = c.socioId === s.id || c.idSocio === s.id || c.codigoSocio === s.codigoSocio || (s.cedulaRuc && c.socioCedula === s.cedulaRuc);
      const isAgosto = c.periodo === '2026-08' || c.periodoCodigo === '2026-08' || c.idPeriodo === '33333333-0000-0000-0000-000000000001' || String(c.numeroRecibo || c.numeroFactura || '').includes('202608');
      const isPagado = c.estadoPago === 'PAGADO' || (c.saldoPendiente !== undefined ? Number(c.saldoPendiente) === 0 : true);
      return isSocio && isAgosto && isPagado;
    });

    // 2. Aspecto: Deuda Anterior de Alcantarillado (Red Matriz)
    const deudaOriginalAlcant = Number(s.deudaAlcantarillado !== undefined ? s.deudaAlcantarillado : (s.deuda_alcantarillado || 0));
    let totalAlcantPagado = 0;
    allLoadedCobros
      .filter((c) => (c.socioId === s.id || c.idSocio === s.id || c.codigoSocio === s.codigoSocio || (s.cedulaRuc && c.socioCedula === s.cedulaRuc)))
      .forEach((c) => {
        if (Number(c.deudaAlcantarilladoCobrada || 0) > 0) {
          totalAlcantPagado += Number(c.deudaAlcantarilladoCobrada);
        } else if (Number(c.alcantarilladoUSD || c.valorAlcantarillado || 0) > 1.0) {
          totalAlcantPagado += (Number(c.alcantarilladoUSD || c.valorAlcantarillado) - 1.0);
        }
      });
    const deudaAlcantRestante = Math.max(0, Number((deudaOriginalAlcant - totalAlcantPagado).toFixed(2)));
    s.deudaAlcantarillado = deudaAlcantRestante;

    // 3. Aspecto: Multas y Sanciones Pendientes
    let idsMultasCobradas = new Set();
    allLoadedCobros
      .filter((c) => (c.socioId === s.id || c.idSocio === s.id || c.codigoSocio === s.codigoSocio) && Array.isArray(c.multasCobradasIds))
      .forEach((c) => c.multasCobradasIds.forEach((id) => idsMultasCobradas.add(id)));
    const multasBase = allLoadedMultas.filter((m) => (m.idSocio === s.id || m.id_socio === s.id));
    const multasPend = multasBase.filter((m) => !idsMultasCobradas.has(m.id) && !m.pagado);
    const totalMultas = multasPend.reduce((sum, m) => sum + Number(m.monto || 0), 0);

    // 4. Aspecto: Deudas de Meses Anteriores (Julio 2026 o previos)
    const deudaHistMed = Array.isArray(s.medidores)
      ? s.medidores.reduce((acc, m) => acc + Number(m.deudaPendiente || m.deuda_pendiente || 0), 0)
      : Number(s.deudaPendiente || s.deuda_pendiente || s.montoTotalAdeudado || 0);

    let pagadoDeudaAnterior = 0;
    allLoadedCobros
      .filter((c) => (c.socioId === s.id || c.idSocio === s.id || c.codigoSocio === s.codigoSocio || (s.cedulaRuc && c.socioCedula === s.cedulaRuc)))
      .forEach((c) => {
        pagadoDeudaAnterior += Number(c.deudaAnteriorCobrada || c.valorDeudaAnterior || c.valor_deuda_anterior || 0);
      });

    const deudaAnteriorRestante = Math.max(0, Number((deudaHistMed - pagadoDeudaAnterior).toFixed(2)));
    const mesesAdeudados = deudaAnteriorRestante > 0 ? (s.mesesAdeudados || 1) : 0;

    const totalDeudaReal = Number((deudaAnteriorRestante + deudaAlcantRestante + totalMultas).toFixed(2));

    if (pagoAgosto && totalDeudaReal <= 0.001) {
      s.estadoCuenta = 'AL_DIA';
      s.montoTotalAdeudado = 0;
      s.mesesAdeudados = 0;
    } else if (pagoAgosto && totalDeudaReal > 0) {
      s.estadoCuenta = 'EN_MORA';
      s.montoTotalAdeudado = totalDeudaReal;
      s.mesesAdeudados = mesesAdeudados;
    } else if (!pagoAgosto && totalDeudaReal <= 0.001) {
      s.estadoCuenta = 'AL_DIA';
      s.montoTotalAdeudado = 0;
      s.mesesAdeudados = 0;
    } else {
      s.estadoCuenta = 'EN_MORA';
      s.montoTotalAdeudado = totalDeudaReal;
      s.mesesAdeudados = mesesAdeudados;
    }
  });

  populateSocioSelect(cachedSocios);
}

function deduplicateCobros(cobrosList) {
  if (!Array.isArray(cobrosList)) return [];

  const seenReceiptNumbers = new Map();
  const seenIds = new Map();
  const uniqueList = [];

  for (const c of cobrosList) {
    if (!c) continue;

    const rawNum = String(c.numeroRecibo || c.numeroFactura || c.numero_factura || c.id || '').trim();
    const rawId = String(c.id || '').trim();
    if (!rawNum && !rawId) continue;

    const normNum = rawNum.toUpperCase();

    // Comprobar si ya vimos este número de recibo o este ID
    let existing = null;
    if (normNum && seenReceiptNumbers.has(normNum)) {
      existing = seenReceiptNumbers.get(normNum);
    } else if (rawId && seenIds.has(rawId)) {
      existing = seenIds.get(rawId);
    }

    if (existing) {
      // Fusionar enriqueciendo campos si el nuevo registro contiene datos más completos
      if ((!existing.socioNombre || existing.socioNombre === 'Abonado') && (c.socioNombre || c.nombreCompleto)) {
        existing.socioNombre = c.socioNombre || c.nombreCompleto;
      }
      if (!existing.socioCedula && (c.socioCedula || c.cedula_ruc)) {
        existing.socioCedula = c.socioCedula || c.cedula_ruc;
      }
      if (!existing.socioSector && (c.socioSector || c.nombreSector || c.nombre_sector)) {
        existing.socioSector = c.socioSector || c.nombreSector || c.nombre_sector;
      }
      if (!existing.medidorNumero && (c.medidorNumero || c.numero_medidor)) {
        existing.medidorNumero = c.medidorNumero || c.numero_medidor;
      }
      if (!existing.metodoPago && (c.metodoPago || c.metodo_pago)) {
        existing.metodoPago = c.metodoPago || c.metodo_pago;
      }
      if (!existing.fechaPago && (c.fechaPago || c.fecha_pago || c.updated_at)) {
        existing.fechaPago = c.fechaPago || c.fecha_pago || c.updated_at;
      }
      if (c.montoPagado !== undefined && Number(c.montoPagado) > 0) {
        existing.montoPagado = Number(c.montoPagado);
      }
      if (c.montoTotal !== undefined && Number(c.montoTotal) > 0) {
        existing.montoTotal = Number(c.montoTotal);
      }
      // Mantener UUID de Supabase si uno de los dos lo tiene
      if (rawId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing.id)) {
        existing.id = rawId;
        seenIds.set(rawId, existing);
      }
      continue;
    }

    // Resolver nombre del socio si no viene en el registro
    let socioNom = c.socioNombre || c.nombreCompleto;
    let socioCed = c.socioCedula || c.cedula_ruc;
    let socioSec = c.socioSector || c.nombreSector || c.nombre_sector;
    const socioId = c.socioId || c.idSocio || c.id_socio;

    if ((!socioNom || socioNom === 'Abonado') && socioId && Array.isArray(cachedSocios)) {
      const sMatch = cachedSocios.find((s) => s.id === socioId);
      if (sMatch) {
        socioNom = sMatch.nombreCompleto || `${sMatch.nombres} ${sMatch.apellidos}`.trim();
        if (!socioCed) socioCed = sMatch.cedulaRuc || sMatch.cedula_ruc;
        if (!socioSec) socioSec = sMatch.nombreSector || sMatch.nombre_sector;
      }
    }

    const cleanRecord = {
      ...c,
      id: rawId,
      numeroRecibo: rawNum,
      numeroFactura: rawNum,
      socioNombre: socioNom || 'Abonado',
      socioCedula: socioCed || '',
      socioSector: socioSec || '',
      montoPagado: c.montoPagado !== undefined ? c.montoPagado : (c.montoAbonado !== undefined ? c.montoAbonado : c.montoTotal),
      montoTotal: c.montoTotal !== undefined ? c.montoTotal : (c.montoPagado || c.montoAbonado || 0),
      fechaPago: c.fechaPago || c.fecha_pago || c.updated_at || c.createdAt
    };

    if (normNum) seenReceiptNumbers.set(normNum, cleanRecord);
    if (rawId) seenIds.set(rawId, cleanRecord);
    uniqueList.push(cleanRecord);
  }

  return uniqueList;
}

async function updateMetricsAndHistory() {
  if (!db) db = await syncEngine.getDb();
  let cobros = [];

  // Cargar todas las multas de la API (o Supabase Cloud)
  allLoadedMultas = await getAllMultasFromDb();

  const isWebView = typeof window !== 'undefined' && (
    window.location.origin.includes('appassets.androidplatform.net') || 
    window.location.protocol === 'file:'
  );

  // 1. Obtener facturas pagadas del Backend REST API / Supabase Cloud
  let facturasRemotas = [];
  try {
    const resFacturas = await apiFetch('/api/v1/facturas');
    if (resFacturas && Array.isArray(resFacturas.data)) {
      facturasRemotas = resFacturas.data;
    }
  } catch (_e) {
    if (navigator.onLine) {
      try {
        const rSupa = await syncEngine.fetchSupabase('facturas?estado_pago=eq.PAGADO&select=*');
        if (rSupa.ok) {
          const supaData = await rSupa.json();
          if (Array.isArray(supaData)) facturasRemotas = supaData;
        }
      } catch (_sErr) {}
    }
  }

  const facturasPagadas = facturasRemotas.filter(
    (f) => ((f.montoPagado && f.montoPagado > 0) || (f.monto_pagado && f.monto_pagado > 0) || f.estadoPago === 'PAGADO' || f.estado_pago === 'PAGADO') &&
           Number(f.totalPagar ?? f.total_pagar ?? f.montoPagado ?? f.monto_pagado ?? 0) > 0
  );

  const facturasPendientes = facturasRemotas.filter(
    (f) => (f.estadoPago === 'PENDIENTE' || f.estado_pago === 'PENDIENTE') &&
           Number(f.totalPagar ?? f.total_pagar ?? 0) > 0
  );

  if (!isWebView && facturasPagadas.length > 0) {
    // EN PWA OFICINA: El backend (Supabase) es la ÚNICA fuente de verdad. Cero cobros fantasma de IndexedDB.
    cobros = facturasPagadas
      .map((f) => {
        const perCod = f.periodoCodigo || (f.idPeriodo === '33333333-0000-0000-0000-000000000001' || f.id_periodo === '33333333-0000-0000-0000-000000000001' ? '2026-08' : (f.idPeriodo === '33333333-0000-0000-0000-000000000000' || f.id_periodo === '33333333-0000-0000-0000-000000000000' ? '2026-07' : PERIODO_ACTUAL));
        const sId = f.idSocio || f.id_socio;
        let sNom = f.socioNombre;
        let sCed = f.socioCedula;
        let sSec = f.nombreSector || f.nombre_sector;
        if (!sNom && sId && Array.isArray(cachedSocios)) {
          const sMatch = cachedSocios.find((s) => s.id === sId);
          if (sMatch) {
            sNom = sMatch.nombreCompleto || `${sMatch.nombres} ${sMatch.apellidos}`.trim();
            sCed = sCed || sMatch.cedulaRuc || sMatch.cedula_ruc;
            sSec = sSec || sMatch.nombreSector || sMatch.nombre_sector;
          }
        }

        const totalP = Number(f.totalPagar ?? f.total_pagar ?? 0);
        const montoP = Number(f.montoPagado ?? f.monto_pagado ?? totalP);
        const deudaAntCob = Number(f.valorDeudaAnterior ?? f.valor_deuda_anterior ?? 0);
        const multasCob = Number(f.valorMultas ?? f.valor_multas ?? 0);
        const isRec = String(f.numeroFactura || f.numero_factura || '').startsWith('REC-');

        // Deudas anteriores históricas pendientes para este socio
        const deudasAntPend = facturasPendientes.filter((p) => {
          const pSoc = p.idSocio || p.id_socio;
          if (pSoc !== sId) return false;
          const isAug = p.idPeriodo === '33333333-0000-0000-0000-000000000001' || p.id_periodo === '33333333-0000-0000-0000-000000000001' || String(p.numeroFactura || p.numero_factura || '').includes('202608');
          return !isAug;
        });
        const saldoDeudaAntPendiente = Number(deudasAntPend.reduce((sum, p) => sum + Number(p.totalPagar ?? p.total_pagar ?? p.totalMes ?? p.total_mes ?? 0), 0).toFixed(2));

        const multasPend = allLoadedMultas.filter((m) => (m.id_socio === sId || m.idSocio === sId) && m.estado !== 'PAGADO');
        const saldoMultasPendiente = Number(multasPend.reduce((sum, m) => sum + Number(m.saldo_pendiente ?? m.monto ?? 0), 0).toFixed(2));

        const tieneDeudaAntCobrada = deudaAntCob > 0;
        const esDeudaAntAbonada = tieneDeudaAntCobrada && saldoDeudaAntPendiente > 0;
        const esDeudaAntLiquidada = tieneDeudaAntCobrada && saldoDeudaAntPendiente <= 0.001;

        const totalSaldoRestante = Number((saldoDeudaAntPendiente + saldoMultasPendiente).toFixed(2));
        const esAbono = esDeudaAntAbonada || (multasCob > 0 && saldoMultasPendiente > 0) || (isRec && totalSaldoRestante > 0) || Boolean(f.esAbono) || Number(f.saldoPendiente ?? f.saldo_pendiente ?? 0) > 0;
        const saldoFinalPendiente = esAbono ? (totalSaldoRestante > 0 ? totalSaldoRestante : Number(f.saldoPendiente ?? f.saldo_pendiente ?? 0)) : 0;

        return {
          id: f.id,
          numeroRecibo: f.numeroFactura || f.numero_factura || f.id,
          numeroFactura: f.numeroFactura || f.numero_factura || f.id,
          socioId: sId,
          idSocio: sId,
          idMedidor: f.idMedidor || f.id_medidor || null,
          numeroMedidor: f.numeroMedidor || f.numero_medidor || '',
          socioNombre: sNom || 'Abonado',
          socioCedula: sCed || '',
          socioSector: sSec || 'Sector Centro',
          periodo: perCod,
          periodoCodigo: perCod,
          consumoM3: f.consumoM3 ?? f.consumo_m3 ?? 0,
          cargoBase: f.valorBase ?? f.valor_base ?? 0,
          valorExcedenteUSD: f.valorExcedente ?? f.valor_excedente ?? 0,
          alcantarilladoUSD: f.valorAlcantarillado ?? f.valor_alcantarillado ?? 0,
          multaExtra: multasCob,
          deudaAnteriorCobrada: deudaAntCob,
          tieneDeudaAntCobrada,
          esDeudaAntAbonada,
          esDeudaAntLiquidada,
          saldoDeudaAntPendiente,
          esAbono,
          saldoPendiente: saldoFinalPendiente,
          montoTotal: (esAbono && saldoFinalPendiente > 0) ? Number((montoP + saldoFinalPendiente).toFixed(2)) : totalP,
          montoPagado: montoP,
          montoAbonado: montoP,
          estadoPago: 'PAGADO',
          metodoPago: f.metodoPago || f.metodo_pago || 'EFECTIVO',
          fechaPago: f.fechaPago || f.fecha_pago || f.updatedAt || f.updated_at
        };
      });

    // Purgar IndexedDB de cobros desactualizados/fantasma
    if (db) {
      try {
        const txPurge = db.transaction(['cobros'], 'readwrite');
        txPurge.objectStore('cobros').clear();
      } catch (_e) {}
    }
  } else {
    // Modo móvil Lector o fallback si el backend no responde
    if (db) {
      cobros = await new Promise((res) => {
        try {
          const tx = db.transaction(['cobros'], 'readonly');
          const req = tx.objectStore('cobros').getAll();
          req.onsuccess = () => {
            const rawAll = (req.result || []).map((c) => ({
              ...c,
              numeroRecibo: c.numeroRecibo || c.numeroFactura || c.numero_factura || c.id,
              numeroFactura: c.numeroFactura || c.numeroRecibo || c.numero_factura || c.id,
              montoPagado: c.montoPagado !== undefined ? c.montoPagado : (c.montoAbonado !== undefined ? c.montoAbonado : c.montoTotal),
              montoTotal: c.montoTotal !== undefined ? c.montoTotal : (c.montoPagado || 0)
            }));
            res(rawAll);
          };
          req.onerror = () => res([]);
        } catch {
          res([]);
        }
      });
    }

    if (facturasPagadas.length > 0) {
      const knownKeys = new Set();
      cobros.forEach((c) => {
        if (c.id) knownKeys.add(String(c.id).toLowerCase());
        const num = c.numeroRecibo || c.numeroFactura || c.numero_factura;
        if (num) knownKeys.add(String(num).trim().toUpperCase());
      });

      facturasPagadas.forEach((f) => {
        const fNum = String(f.numeroFactura || f.numero_factura || f.id || '').trim().toUpperCase();
        const fId = String(f.id || '').toLowerCase();
        if ((fNum && knownKeys.has(fNum)) || (fId && knownKeys.has(fId))) return;

        const perCod = f.periodoCodigo || (f.idPeriodo === '33333333-0000-0000-0000-000000000001' ? '2026-08' : PERIODO_ACTUAL);
        const sId = f.idSocio || f.id_socio;
        const totalP = Number(f.totalPagar ?? f.total_pagar ?? 0);
        const montoP = Number(f.montoPagado ?? f.monto_pagado ?? totalP);
        const deudaAntCob = Number(f.valorDeudaAnterior ?? f.valor_deuda_anterior ?? 0);
        const multasCob = Number(f.valorMultas ?? f.valor_multas ?? 0);
        const isRec = String(f.numeroFactura || f.numero_factura || '').startsWith('REC-');

        const deudasAntPend = facturasPendientes.filter((p) => {
          const pSoc = p.idSocio || p.id_socio;
          if (pSoc !== sId) return false;
          const isAug = p.idPeriodo === '33333333-0000-0000-0000-000000000001' || p.id_periodo === '33333333-0000-0000-0000-000000000001' || String(p.numeroFactura || p.numero_factura || '').includes('202608');
          return !isAug;
        });
        const saldoDeudaAntPendiente = Number(deudasAntPend.reduce((sum, p) => sum + Number(p.totalPagar ?? p.total_pagar ?? p.totalMes ?? p.total_mes ?? 0), 0).toFixed(2));
        const multasPend = allLoadedMultas.filter((m) => (m.id_socio === sId || m.idSocio === sId) && m.estado !== 'PAGADO');
        const saldoMultasPendiente = Number(multasPend.reduce((sum, m) => sum + Number(m.saldo_pendiente ?? m.monto ?? 0), 0).toFixed(2));

        const tieneDeudaAntCobrada = deudaAntCob > 0;
        const esDeudaAntAbonada = tieneDeudaAntCobrada && saldoDeudaAntPendiente > 0;
        const esDeudaAntLiquidada = tieneDeudaAntCobrada && saldoDeudaAntPendiente <= 0.001;

        const totalSaldoRestante = Number((saldoDeudaAntPendiente + saldoMultasPendiente).toFixed(2));
        const esAbono = esDeudaAntAbonada || (multasCob > 0 && saldoMultasPendiente > 0) || (isRec && totalSaldoRestante > 0) || Boolean(f.esAbono) || Number(f.saldoPendiente ?? f.saldo_pendiente ?? 0) > 0;
        const saldoFinalPendiente = esAbono ? (totalSaldoRestante > 0 ? totalSaldoRestante : Number(f.saldoPendiente ?? f.saldo_pendiente ?? 0)) : 0;

        cobros.push({
          id: f.id,
          numeroRecibo: f.numeroFactura || f.numero_factura || f.id,
          numeroFactura: f.numeroFactura || f.numero_factura || f.id,
          socioId: sId,
          idSocio: sId,
          socioNombre: f.socioNombre || 'Abonado',
          socioCedula: f.socioCedula || '',
          socioSector: f.nombreSector || 'Sector Centro',
          periodo: perCod,
          periodoCodigo: perCod,
          deudaAnteriorCobrada: deudaAntCob,
          multaExtra: multasCob,
          tieneDeudaAntCobrada,
          esDeudaAntAbonada,
          esDeudaAntLiquidada,
          saldoDeudaAntPendiente,
          esAbono,
          saldoPendiente: saldoFinalPendiente,
          montoTotal: (esAbono && saldoFinalPendiente > 0) ? Number((montoP + saldoFinalPendiente).toFixed(2)) : totalP,
          montoPagado: montoP,
          montoAbonado: montoP,
          estadoPago: 'PAGADO',
          metodoPago: f.metodoPago || f.metodo_pago || 'EFECTIVO',
          fechaPago: f.fechaPago || f.fecha_pago || f.updatedAt || f.updated_at
        });
      });
    }
  }

  // Deduplicación final y ordenamiento
  cobros = deduplicateCobros(cobros);
  cobros.sort((a, b) => new Date(b.fechaPago || b.createdAt || 0).getTime() - new Date(a.fechaPago || a.createdAt || 0).getTime());

  allLoadedCobros = cobros;
  actualizarCuentasCorrientesSocios();

  // 3. Métricas consolidadas de recaudación en vivo
  const cobrosHoy = allLoadedCobros.filter((c) => isFechaHoy(c.fechaPago || c.createdAt));
  let totalRecaudacionHoy = 0;
  cobrosHoy.forEach((c) => {
    const pagado = c.montoPagado !== undefined ? c.montoPagado : (c.montoAbonado !== undefined ? c.montoAbonado : c.montoTotal);
    totalRecaudacionHoy += Number(pagado || 0);
  });

  let totalRecaudacionAgua = 0;
  let totalEgresos = 0;

  allLoadedCobros.forEach((c) => {
    const pagado = c.montoPagado !== undefined ? c.montoPagado : (c.montoAbonado !== undefined ? c.montoAbonado : c.montoTotal);
    totalRecaudacionAgua += Number(pagado || 0);
  });

  try {
    const resBalance = await apiFetch('/api/v1/fondos/balance');
    if (resBalance && resBalance.data) {
      if (resBalance.data.totalIngresos !== undefined && Number(resBalance.data.totalIngresos) > 0) {
        totalRecaudacionAgua = Number(resBalance.data.totalIngresos);
      }
      if (resBalance.data.totalEgresos !== undefined) {
        totalEgresos = Number(resBalance.data.totalEgresos);
      }
      if (resBalance.data.totalRecaudadoHoy !== undefined && Number(resBalance.data.totalRecaudadoHoy) > 0) {
        totalRecaudacionHoy = Number(resBalance.data.totalRecaudadoHoy);
      }
    }
  } catch (_e) {}

  const balanceNeto = Number((totalRecaudacionAgua - totalEgresos).toFixed(2));

  const elAgua = document.getElementById('metricRecaudacionAgua');
  if (elAgua) elAgua.textContent = `$${totalRecaudacionHoy.toFixed(2)}`;
  const elCount = document.getElementById('metricRecibosCount');
  if (elCount) elCount.textContent = `${cobrosHoy.length} recibos cobrados hoy`;
  const elEntradas = document.getElementById('metricTotalEntradas');
  if (elEntradas) elEntradas.textContent = `$${totalRecaudacionAgua.toFixed(2)}`;
  const elSalidas = document.getElementById('metricTotalSalidas');
  if (elSalidas) elSalidas.textContent = `$${totalEgresos.toFixed(2)}`;
  const elGastos = document.getElementById('metricGastosCount');
  if (elGastos) elGastos.textContent = `${totalEgresos > 0 ? 'Egresos activos' : '0 egresos registrados'}`;
  const elBalance = document.getElementById('metricBalanceNeto');
  if (elBalance) elBalance.textContent = `$${balanceNeto.toFixed(2)}`;

  // Actualizar conteos de pestañas
  const countHoyEl = document.getElementById('countRecibosHoy');
  if (countHoyEl) countHoyEl.textContent = cobrosHoy.length;
  const countTodosEl = document.getElementById('countRecibosTodos');
  if (countTodosEl) countTodosEl.textContent = allLoadedCobros.length;

  renderRecibosTable();
}

function renderRecibosTable() {
  const tbody = document.getElementById('recibosTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const canDeleteFactura = currentUser?.rol === 'ADMIN';

  // 1. Filtrar por pestaña (HOY o TODOS) y garantizar deduplicación estricta
  let list = deduplicateCobros(allLoadedCobros);
  if (currentRecibosFilter === 'HOY') {
    list = list.filter((c) => isFechaHoy(c.fechaPago || c.createdAt));
  }

  // 2. Filtrar por buscador en vivo si hay texto
  if (currentRecibosSearch) {
    const q = currentRecibosSearch.toLowerCase();
    list = list.filter((c) => {
      const num = String(c.numeroRecibo || c.numeroFactura || c.id || '').toLowerCase();
      const nom = String(c.socioNombre || c.nombreCompleto || '').toLowerCase();
      const ced = String(c.socioCedula || '').toLowerCase();
      const med = String(c.medidorNumero || '').toLowerCase();
      return num.includes(q) || nom.includes(q) || ced.includes(q) || med.includes(q);
    });
  }

  // Deduplicar la lista final para garantizar que nunca se sumen cobros repetidos
  list = deduplicateCobros(list);

  // Actualizar resumen en la barra superior
  let sumMonto = 0;
  list.forEach((c) => {
    const montoVal = c.montoPagado !== undefined ? c.montoPagado : (c.montoAbonado !== undefined ? c.montoAbonado : c.montoTotal);
    sumMonto += Number(montoVal || 0);
  });

  const txtResumen = document.getElementById('txtResumenRecibos');
  if (txtResumen) {
    const label = currentRecibosFilter === 'HOY' ? 'Recibos emitidos hoy' : 'Recibos en historial';
    txtResumen.innerHTML = `${label}: <strong>${list.length}</strong>`;
  }
  const txtMonto = document.getElementById('txtMontoResumenRecibos');
  if (txtMonto) {
    txtMonto.innerHTML = `Total: <strong style="color: #0284c7; font-size: 0.88rem;">$${sumMonto.toFixed(2)} USD</strong>`;
  }

  if (list.length === 0) {
    const hoyTexto = new Date().toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' });
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: #94a3b8; padding: 2.5rem;">
          <div style="font-size: 1.3rem; margin-bottom: 6px;">🧾</div>
          <div>${
            currentRecibosFilter === 'HOY'
              ? `No se han emitido recibos en la jornada de hoy (${hoyTexto}).`
              : 'No se encontraron recibos con los filtros actuales.'
          }</div>
          ${
            currentRecibosFilter === 'HOY' && allLoadedCobros.length > 0
              ? `<div style="font-size: 0.82rem; margin-top: 10px;">
                   <button type="button" id="btnSwitchToHistorial" style="background:none; border:none; color:#0284c7; font-weight:700; cursor:pointer; text-decoration:underline;">
                     Ver historial completo (${allLoadedCobros.length} recibos anteriores)
                   </button>
                 </div>`
              : ''
          }
        </td>
      </tr>
    `;
    document.getElementById('btnSwitchToHistorial')?.addEventListener('click', () => {
      setRecibosFilter('TODOS');
    });
    return;
  }

  // Renderizar TODOS los recibos de la lista completa (sin cortes ni límites)
  list.forEach((c) => {
    const tr = document.createElement('tr');
    const montoVal = c.montoPagado !== undefined ? c.montoPagado : (c.montoAbonado !== undefined ? c.montoAbonado : c.montoTotal);
    const montoDisplay = Number(montoVal || 0).toFixed(2);
    const esAbono = Boolean(c.esAbono || (c.saldoPendiente !== undefined && Number(c.saldoPendiente) > 0));
    const fecha = c.fechaPago || c.createdAt || Date.now();
    const dObj = new Date(fecha);
    const esHoy = isFechaHoy(fecha);
    const timeStr = !isNaN(dObj.getTime())
      ? (esHoy ? dObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : dObj.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' }) + ' ' + dObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
      : '--:--';

    // Generar subtexto descriptivo de deuda anterior / abonos
    let detalleDeudaHtml = '';
    const dCob = Number(c.deudaAnteriorCobrada || 0);
    const sPend = Number(c.saldoDeudaAntPendiente ?? c.saldoPendiente ?? 0);
    if (dCob > 0) {
      if (c.esDeudaAntAbonada || (esAbono && sPend > 0)) {
        detalleDeudaHtml = `<div style="font-size:0.75rem; color:#b45309; font-weight:600; margin-top:2px;">⚠️ Deuda anterior abonada ($${dCob.toFixed(2)}) &bull; Saldo restante: $${sPend.toFixed(2)}</div>`;
      } else {
        detalleDeudaHtml = `<div style="font-size:0.75rem; color:#16a34a; font-weight:600; margin-top:2px;">✓ Deuda anterior liquidada ($${dCob.toFixed(2)})</div>`;
      }
    } else if (esAbono && Number(c.saldoPendiente || 0) > 0) {
      detalleDeudaHtml = `<div style="font-size:0.75rem; color:#b45309; font-weight:600; margin-top:2px;">⚠️ Abono parcial &bull; Saldo restante: $${Number(c.saldoPendiente).toFixed(2)}</div>`;
    }

    const badgeAbono = esAbono
      ? `<span style="background: #fef3c7; color: #b45309; font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; border: 1px solid #fde68a; margin-left: 4px; display: inline-block;">ABONO</span>`
      : '';

    tr.innerHTML = `
      <td>
        <span class="badge-code" style="color:#0284c7; font-weight:700;">${c.numeroRecibo || c.numeroFactura || c.id}</span>
        ${badgeAbono}
      </td>
      <td>
        <strong>${c.socioNombre || c.nombreCompleto || 'Abonado'}</strong>
        ${detalleDeudaHtml}
      </td>
      <td style="text-align: right;">
        <strong class="text-accent" style="font-size:1rem;">$${montoDisplay}</strong>
        ${esAbono && Number(c.montoTotal || 0) > Number(montoVal || 0) ? `<div style="font-size:0.72rem; color:#64748b;">de $${Number(c.montoTotal).toFixed(2)}</div>` : ''}
      </td>
      <td><span style="font-size:0.8rem; color:#64748b;">${timeStr}</span></td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn-icon btn-print-row" title="Ver / Imprimir Recibo">🖨️</button>
        ${
          canDeleteFactura
            ? `<button class="btn-icon btn-delete-row" title="Eliminar / Anular Factura" style="color: #ef4444; margin-left: 4px;">🗑️</button>`
            : ''
        }
      </td>
    `;

    tr.querySelector('.btn-print-row')?.addEventListener('click', () => {
      showReceiptModal(c);
    });

    if (canDeleteFactura) {
      tr.querySelector('.btn-delete-row')?.addEventListener('click', () => {
        confirmDeleteFactura(c);
      });
    }

    tbody.appendChild(tr);
  });
}

function formatearTipoRubro(tipo) {
  const map = {
    MINGA: 'Minga',
    ASAMBLEA: 'Asamblea',
    RECONEXION: 'Reconexión',
    CUOTA_EXTRA: 'Cuota Extra',
    OTRO: 'Rubro'
  };
  return map[tipo] || tipo || 'Multa';
}

function renderDeudaAlcantarilladoSection() {
  const section = document.getElementById('sectionDeudaAlcantarillado');
  const container = document.getElementById('containerDeudaAlcantarillado');
  if (!section || !container) return;

  const deudaOriginal = Number(selectedSocio?.deudaAlcantarilladoInicial !== undefined ? selectedSocio.deudaAlcantarilladoInicial : (selectedSocio?.deudaAlcantarillado || 0));
  const deudaRestante = Number(selectedSocio?.deudaAlcantarillado || 0);

  if (deudaOriginal === 0 && deudaRestante === 0) {
    section.style.display = 'none';
    container.innerHTML = '';
    selectedDeudaAlcantarilladoActiva = false;
    return;
  }

  section.style.display = 'block';

  if (deudaRestante <= 0 && deudaOriginal > 0) {
    selectedDeudaAlcantarilladoActiva = false;
    container.innerHTML = `
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.1rem;">🌊</span>
          <div>
            <div style="font-weight: 700; font-size: 0.86rem; color: #166534;">
              Deuda Anterior Red Matriz Alcantarillado: ✅ Cancelada
            </div>
            <div style="font-size: 0.74rem; color: #15803d;">
              Fondo de Alcantarillado &bull; Saldo liquidado ($0.00 USD)
            </div>
          </div>
        </div>
        <strong style="font-size: 0.95rem; color: #166534;">$0.00 USD</strong>
      </div>
    `;
    return;
  }

  if (selectedDeudaAlcantarilladoMontoAbonar === undefined || selectedDeudaAlcantarilladoMontoAbonar <= 0 || selectedDeudaAlcantarilladoMontoAbonar > deudaRestante) {
    selectedDeudaAlcantarilladoMontoAbonar = deudaRestante;
  }

  const montoAbono = selectedDeudaAlcantarilladoMontoAbonar;
  const esParcial = selectedDeudaAlcantarilladoActiva && montoAbono < deudaRestante;
  const saldoRestara = Math.max(0, deudaRestante - montoAbono);

  container.innerHTML = `
    <div class="debt-check-item" style="background: #f0f9ff; border: 1.5px solid #0284c7; padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
      <label style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 240px; cursor: pointer; margin: 0;">
        <input type="checkbox" id="chkDeudaAlcantarillado" ${selectedDeudaAlcantarilladoActiva ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #0284c7; cursor: pointer;" />
        <div>
          <div style="font-weight: 700; font-size: 0.86rem; color: #0369a1;">
            🌊 Deuda Anterior Red Matriz Alcantarillado
          </div>
          <div style="font-size: 0.74rem; color: #64748b;">
            Fondo de Alcantarillado Comunitario &bull; Saldo pendiente: <strong style="color: #0369a1;">$${deudaRestante.toFixed(2)} USD</strong>
            ${esParcial ? `<span style="color: #d97706; font-weight: 700;"> &bull; Quedará debiendo: $${saldoRestara.toFixed(2)} USD</span>` : ''}
          </div>
        </div>
      </label>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 0.78rem; font-weight: 700; color: #0369a1;">Abonar:</span>
        <div style="position: relative; width: 95px;">
          <span style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-weight: 800; color: #0284c7; font-size: 0.85rem;">$</span>
          <input type="number" id="inputAbonoAlcantarillado" step="0.01" min="0.01" max="${deudaRestante}" value="${montoAbono.toFixed(2)}"
            ${!selectedDeudaAlcantarilladoActiva ? 'disabled' : ''}
            style="width: 100%; padding: 4px 6px 4px 18px; border: 1.5px solid ${selectedDeudaAlcantarilladoActiva ? '#0284c7' : '#cbd5e1'}; border-radius: 6px; font-weight: 800; font-size: 0.92rem; color: #0369a1; text-align: right; background: ${selectedDeudaAlcantarilladoActiva ? '#ffffff' : '#f1f5f9'};" />
        </div>
      </div>
    </div>
  `;

  const chk = container.querySelector('#chkDeudaAlcantarillado');
  const inputAbono = container.querySelector('#inputAbonoAlcantarillado');

  chk?.addEventListener('change', (e) => {
    selectedDeudaAlcantarilladoActiva = e.target.checked;
    if (selectedDeudaAlcantarilladoActiva && (selectedDeudaAlcantarilladoMontoAbonar <= 0 || selectedDeudaAlcantarilladoMontoAbonar > deudaRestante)) {
      selectedDeudaAlcantarilladoMontoAbonar = deudaRestante;
    }
    renderDeudaAlcantarilladoSection();
    recalcularTotalPOS();
  });

  inputAbono?.addEventListener('input', (e) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val) || val < 0) val = 0;
    if (val > deudaRestante) val = deudaRestante;
    selectedDeudaAlcantarilladoMontoAbonar = Number(val.toFixed(2));
    recalcularTotalPOS();
  });

  inputAbono?.addEventListener('blur', (e) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val) || val <= 0) val = 0;
    if (val > deudaRestante) val = deudaRestante;
    selectedDeudaAlcantarilladoMontoAbonar = Number(val.toFixed(2));
    e.target.value = selectedDeudaAlcantarilladoMontoAbonar.toFixed(2);
    renderDeudaAlcantarilladoSection();
    recalcularTotalPOS();
  });
}

function renderDeudasAnterioresList() {
  const section = document.getElementById('sectionDeudasAnteriores');
  const container = document.getElementById('containerDeudasAnteriores');
  const countEl = document.getElementById('posMesesMora');
  if (!section || !container) return;

  const deudasGenerales = socioDeudasAnteriores;

  if (deudasGenerales.length === 0) {
    section.style.display = 'block';
    if (countEl) countEl.textContent = '0';
    container.innerHTML = `
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 8px 12px; border-radius: 6px; color: #166534; font-size: 0.82rem; font-weight: 600; display: flex; align-items: center; gap: 6px;">
        <span>✅ Sin deudas de meses anteriores ($0.00 USD).</span>
      </div>
    `;
    return;
  }

  section.style.display = 'block';
  if (countEl) countEl.textContent = deudasGenerales.length;

  container.innerHTML = deudasGenerales
    .map((d) => {
      const isChecked = selectedDeudasAnterioresIds.has(d.id);
      const saldo = Number(d.totalPagar ?? d.total_pagar ?? d.totalMes ?? d.total_mes ?? d.saldoPendiente ?? d.saldo_pendiente ?? 0);
      let montoAbonar = selectedDeudasAnterioresAbonosMap.has(d.id) ? Number(selectedDeudasAnterioresAbonosMap.get(d.id)) : saldo;
      if (montoAbonar > saldo) montoAbonar = saldo;
      const esParcial = isChecked && montoAbonar < saldo;
      const saldoRestara = Math.max(0, saldo - montoAbonar);

      return `
        <div class="debt-check-item" style="background: #fff7ed; border: 1px solid ${isChecked ? '#fb923c' : '#fed7aa'}; padding: 8px 12px; border-radius: 6px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
          <label style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 220px; cursor: pointer; margin: 0;">
            <input type="checkbox" class="chk-deuda-anterior" data-id="${d.id}" ${isChecked ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #ea580c; cursor: pointer;" />
            <div style="font-size: 0.82rem; color: #1e293b;">
              <strong>Período ${d.periodoCodigo || d.idPeriodo || 'Anterior'}</strong>
              <span style="color: #64748b; font-size: 0.74rem;"> &bull; Saldo: <strong style="color: #c2410c;">$${saldo.toFixed(2)} USD</strong></span>
              ${esParcial ? `<span style="color: #d97706; font-weight: 700; font-size: 0.74rem;"> &bull; Quedará debiendo: $${saldoRestara.toFixed(2)}</span>` : ''}
            </div>
          </label>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 0.76rem; font-weight: 700; color: #c2410c;">Abonar:</span>
            <div style="position: relative; width: 85px;">
              <span style="position: absolute; left: 6px; top: 50%; transform: translateY(-50%); font-weight: 800; color: #c2410c; font-size: 0.82rem;">$</span>
              <input type="number" class="input-abono-deuda-ant" data-id="${d.id}" step="0.01" min="0.01" max="${saldo}" value="${montoAbonar.toFixed(2)}"
                ${!isChecked ? 'disabled' : ''}
                style="width: 100%; padding: 2px 4px 2px 14px; border: 1.5px solid ${isChecked ? '#ea580c' : '#cbd5e1'}; border-radius: 4px; font-weight: 800; font-size: 0.88rem; color: #c2410c; text-align: right; background: ${isChecked ? '#fff' : '#f1f5f9'};" />
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  container.querySelectorAll('.chk-deuda-anterior').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      const d = deudasGenerales.find((item) => item.id === id);
      const saldo = Number(d?.totalPagar ?? d?.total_pagar ?? d?.monto ?? 0);
      if (e.target.checked) {
        selectedDeudasAnterioresIds.add(id);
        if (!selectedDeudasAnterioresAbonosMap.has(id) || selectedDeudasAnterioresAbonosMap.get(id) <= 0) {
          selectedDeudasAnterioresAbonosMap.set(id, saldo);
        }
      } else {
        selectedDeudasAnterioresIds.delete(id);
      }
      renderDeudasAnterioresList();
      recalcularTotalPOS();
    });
  });

  container.querySelectorAll('.input-abono-deuda-ant').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const id = e.target.dataset.id;
      const d = deudasGenerales.find((item) => item.id === id);
      const saldo = Number(d?.totalPagar ?? d?.total_pagar ?? d?.monto ?? 0);
      let val = parseFloat(e.target.value);
      if (isNaN(val) || val < 0) val = 0;
      if (val > saldo) val = saldo;
      selectedDeudasAnterioresAbonosMap.set(id, Number(val.toFixed(2)));
      recalcularTotalPOS();
    });

    inp.addEventListener('blur', (e) => {
      const id = e.target.dataset.id;
      const d = deudasGenerales.find((item) => item.id === id);
      const saldo = Number(d?.totalPagar ?? d?.total_pagar ?? d?.monto ?? 0);
      let val = parseFloat(e.target.value);
      if (isNaN(val) || val <= 0) val = 0;
      if (val > saldo) val = saldo;
      const finalVal = Number(val.toFixed(2));
      selectedDeudasAnterioresAbonosMap.set(id, finalVal);
      e.target.value = finalVal.toFixed(2);
      renderDeudasAnterioresList();
      recalcularTotalPOS();
    });
  });
}

function renderMultasList() {
  const container = document.getElementById('containerMultasSocio');
  if (!container) return;

  if (socioMultas.length === 0) {
    container.innerHTML = `
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 8px 12px; border-radius: 6px; color: #166534; font-size: 0.82rem; font-weight: 600; display: flex; align-items: center; gap: 6px;">
        <span>✅ Sin multas ni sanciones pendientes ($0.00 USD).</span>
      </div>
    `;
    return;
  }

  container.innerHTML = socioMultas
    .map((m) => {
      const isChecked = selectedMultasIds.has(m.id);
      const saldo = Number(m.saldo_pendiente ?? m.monto ?? 0);
      let montoAbonar = selectedMultasAbonosMap.has(m.id) ? Number(selectedMultasAbonosMap.get(m.id)) : saldo;
      if (montoAbonar > saldo) montoAbonar = saldo;
      const esParcial = isChecked && montoAbonar < saldo;
      const saldoRestara = Math.max(0, saldo - montoAbonar);

      return `
        <div class="multa-card-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border: 1px solid ${isChecked ? '#fca5a5' : '#e2e8f0'}; background: ${isChecked ? '#fff5f5' : '#ffffff'}; border-radius: 6px; margin-bottom: 4px; flex-wrap: wrap; gap: 6px;">
          <label style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 220px; cursor: pointer; margin: 0;">
            <input type="checkbox" class="chk-multa-socio" data-id="${m.id}" ${isChecked ? 'checked' : ''} style="width: 17px; height: 17px; accent-color: #ef4444; cursor: pointer;" />
            <div>
              <div style="font-weight: 700; font-size: 0.82rem; color: #0f172a;">
                <span class="badge-multa-tipo">${formatearTipoRubro(m.tipoRubro)}</span>
                ${m.motivo || 'Multa'}
              </div>
              <div style="font-size: 0.72rem; color: #64748b;">
                Saldo pendiente: <strong style="color: #b91c1c;">$${saldo.toFixed(2)} USD</strong>
                ${esParcial ? `<span style="color: #d97706; font-weight: 700;"> &bull; Quedará debiendo: $${saldoRestara.toFixed(2)}</span>` : ''}
              </div>
            </div>
          </label>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 0.76rem; font-weight: 700; color: #b91c1c;">Abonar:</span>
              <div style="position: relative; width: 85px;">
                <span style="position: absolute; left: 6px; top: 50%; transform: translateY(-50%); font-weight: 800; color: #b91c1c; font-size: 0.82rem;">$</span>
                <input type="number" class="input-abono-multa" data-id="${m.id}" step="0.01" min="0.01" max="${saldo}" value="${montoAbonar.toFixed(2)}"
                  ${!isChecked ? 'disabled' : ''}
                  style="width: 100%; padding: 2px 4px 2px 14px; border: 1.5px solid ${isChecked ? '#ef4444' : '#cbd5e1'}; border-radius: 4px; font-weight: 800; font-size: 0.88rem; color: #b91c1c; text-align: right; background: ${isChecked ? '#fff' : '#f1f5f9'};" />
              </div>
            </div>
            <button type="button" class="btn-icon btn-edit-multa" data-id="${m.id}" title="Editar Multa" style="width: 26px; height: 26px; font-size: 0.75rem;">✏️</button>
            <button type="button" class="btn-icon btn-del-multa" data-id="${m.id}" title="Eliminar Multa" style="width: 26px; height: 26px; font-size: 0.75rem; color: #ef4444;">🗑️</button>
          </div>
        </div>
      `;
    })
    .join('');

  container.querySelectorAll('.chk-multa-socio').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      const m = socioMultas.find((item) => item.id === id);
      const saldo = Number(m?.saldo_pendiente ?? m?.monto ?? 0);
      if (e.target.checked) {
        selectedMultasIds.add(id);
        if (!selectedMultasAbonosMap.has(id) || selectedMultasAbonosMap.get(id) <= 0) {
          selectedMultasAbonosMap.set(id, saldo);
        }
      } else {
        selectedMultasIds.delete(id);
      }
      renderMultasList();
      recalcularTotalPOS();
    });
  });

  container.querySelectorAll('.input-abono-multa').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const id = e.target.dataset.id;
      const m = socioMultas.find((item) => item.id === id);
      const saldo = Number(m?.saldo_pendiente ?? m?.monto ?? 0);
      let val = parseFloat(e.target.value);
      if (isNaN(val) || val < 0) val = 0;
      if (val > saldo) val = saldo;
      selectedMultasAbonosMap.set(id, Number(val.toFixed(2)));
      recalcularTotalPOS();
    });

    inp.addEventListener('blur', (e) => {
      const id = e.target.dataset.id;
      const m = socioMultas.find((item) => item.id === id);
      const saldo = Number(m?.saldo_pendiente ?? m?.monto ?? 0);
      let val = parseFloat(e.target.value);
      if (isNaN(val) || val <= 0) val = 0;
      if (val > saldo) val = saldo;
      const finalVal = Number(val.toFixed(2));
      selectedMultasAbonosMap.set(id, finalVal);
      e.target.value = finalVal.toFixed(2);
      renderMultasList();
      recalcularTotalPOS();
    });
  });

  container.querySelectorAll('.btn-edit-multa').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const m = socioMultas.find((item) => item.id === id);
      if (m) openMultaModal(m);
    });
  });

  container.querySelectorAll('.btn-del-multa').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const m = socioMultas.find((item) => item.id === id);
      if (m) await confirmDeleteMulta(m);
    });
  });
}

function recalcularTotalPOS() {
  if (!currentCalculation) return;

  let totalConsumoMes = 0;
  let totalDeudaAlcant = 0;
  let totalDeudasAnt = 0;
  let totalMultas = 0;

  // 1. Consumo mes actual (tarifa base + Excedente + servicio alcantarillado mensual si tiene)
  socioCalculationsMedidores.forEach((m) => {
    const isChecked = selectedMedidoresIds.has(m.id);
    const card = document.getElementById(`card-meter-${m.id}`);
    const subEl = document.getElementById(`displaySubtotalMedidor_${m.id}`);

    if (isChecked && !m.yaPagadoMes) {
      totalConsumoMes += m.subtotalMes;
      if (subEl) {
        subEl.textContent = `$${m.subtotalMes.toFixed(2)} USD`;
        subEl.style.color = '#0284c7';
      }
      if (card) {
        card.style.background = '#ffffff';
        card.style.border = '1.5px solid #0284c7';
        card.style.opacity = '1';
      }
    } else {
      if (subEl) {
        subEl.textContent = m.yaPagadoMes ? '$0.00 USD (Al Día)' : '$0.00 USD';
        subEl.style.color = m.yaPagadoMes ? '#166534' : '#64748b';
      }
      if (card) {
        card.style.background = m.yaPagadoMes ? '#f0fdf4' : '#f8fafc';
        card.style.border = m.yaPagadoMes ? '1.5px solid #86efac' : '1px dashed #cbd5e1';
        card.style.opacity = m.yaPagadoMes ? '1' : '0.7';
      }
    }
  });

  // 2. Deuda_alcantarillado (Red Matriz)
  if (selectedDeudaAlcantarilladoActiva && selectedSocio?.deudaAlcantarillado > 0) {
    const dRestante = Number(selectedSocio.deudaAlcantarillado);
    if (selectedDeudaAlcantarilladoMontoAbonar === undefined || selectedDeudaAlcantarilladoMontoAbonar === null) {
      selectedDeudaAlcantarilladoMontoAbonar = dRestante;
    }
    totalDeudaAlcant = Number(Math.min(selectedDeudaAlcantarilladoMontoAbonar, dRestante).toFixed(2));
  }

  // 3. Deuda historia (Corte Julio 2026 o previos)
  socioDeudasAnteriores.forEach((d) => {
    if (selectedDeudasAnterioresIds.has(d.id)) {
      const saldo = Number(d.totalPagar ?? d.total_pagar ?? d.monto ?? 0);
      const abono = selectedDeudasAnterioresAbonosMap.has(d.id) ? Number(selectedDeudasAnterioresAbonosMap.get(d.id)) : saldo;
      totalDeudasAnt += Number(Math.min(abono, saldo).toFixed(2));
    }
  });

  // 4. Multas y mingas
  socioMultas.forEach((mul) => {
    if (selectedMultasIds.has(mul.id)) {
      const saldo = Number(mul.saldo_pendiente ?? mul.monto ?? 0);
      const abono = selectedMultasAbonosMap.has(mul.id) ? Number(selectedMultasAbonosMap.get(mul.id)) : saldo;
      totalMultas += Number(Math.min(abono, saldo).toFixed(2));
    }
  });

  totalConsumoMes = Number(totalConsumoMes.toFixed(2));
  totalDeudaAlcant = Number(totalDeudaAlcant.toFixed(2));
  totalDeudasAnt = Number(totalDeudasAnt.toFixed(2));
  totalMultas = Number(totalMultas.toFixed(2));

  const totalGeneral = Number((totalConsumoMes + totalDeudaAlcant + totalDeudasAnt + totalMultas).toFixed(2));

  currentCalculation.totalConsumoMes = totalConsumoMes;
  currentCalculation.totalMes = totalConsumoMes;
  currentCalculation.totalDeudaAlcantarillado = totalDeudaAlcant;
  currentCalculation.totalDeudasSeleccionadas = totalDeudasAnt;
  currentCalculation.totalMultasSeleccionadas = totalMultas;
  currentCalculation.totalPagar = totalGeneral;

  const totalEl = document.getElementById('posTotalPagar');
  if (totalEl) totalEl.textContent = `$${totalGeneral.toFixed(2)} USD`;

  updateVuelto();

  const btnCobro = document.getElementById('btnEjecutarCobro');
  if (btnCobro) {
    const hayAlgo = totalGeneral > 0;
    btnCobro.disabled = !hayAlgo;
    btnCobro.style.cursor = hayAlgo ? 'pointer' : 'not-allowed';
    if (hayAlgo) {
      btnCobro.innerHTML = '✓ Confirmar Pago y Emitir Recibo';
      btnCobro.style.background = '';
      btnCobro.style.borderColor = '';
      btnCobro.style.color = '';
    } else {
      const estaAlDia =
        socioCalculationsMedidores.every((m) => m.yaPagadoMes) &&
        (!selectedSocio?.deudaAlcantarillado || selectedSocio.deudaAlcantarillado <= 0) &&
        socioDeudasAnteriores.length === 0 &&
        socioMultas.length === 0;

      if (estaAlDia) {
        btnCobro.innerHTML = '✅ Socio se encuentra al día';
        btnCobro.style.background = '#10b981';
        btnCobro.style.borderColor = '#10b981';
        btnCobro.style.color = '#ffffff';
      } else {
        btnCobro.innerHTML = '⚠️ Marque los rubros que cancelará hoy';
        btnCobro.style.background = '';
        btnCobro.style.borderColor = '';
        btnCobro.style.color = '';
      }
    }
  }

  updateVuelto();
}

function renderMedidoresPOS() {
  const container = document.getElementById('containerMedidoresPOS');
  if (!container) return;
  container.innerHTML = '';

  if (socioCalculationsMedidores.length === 0) {
    container.innerHTML = `
      <div style="color: #94a3b8; font-size: 0.85rem; text-align: center; padding: 1.5rem; background: #fff; border: 1px dashed #cbd5e1; border-radius: 6px;">
        ⚠️ No se registraron medidores asociados a este socio.
      </div>
    `;
    return;
  }

  socioCalculationsMedidores.forEach((m) => {
    const yaPagado = Boolean(m.yaPagadoMes);
    const isChecked = !yaPagado && selectedMedidoresIds.has(m.id);

    const card = document.createElement('div');
    card.className = 'pos-meter-card';
    card.id = `card-meter-${m.id}`;
    card.style.cssText = `
      background: ${yaPagado ? '#f0fdf4' : (isChecked ? '#ffffff' : '#f8fafc')};
      border: ${yaPagado ? '1.5px solid #86efac' : (isChecked ? '1.5px solid #0284c7' : '1px dashed #cbd5e1')};
      border-radius: 8px;
      padding: 0.85rem 1rem;
      transition: all 0.2s ease;
      opacity: ${yaPagado ? '1' : (isChecked ? '1' : '0.7')};
      box-shadow: ${yaPagado ? '0 1px 3px rgba(22, 101, 52, 0.08)' : (isChecked ? '0 1px 3px rgba(2, 132, 199, 0.08)' : 'none')};
    `;

    const badgeCorte = m.requiereCorte
      ? '<span class="badge" style="background:#fee2e2; color:#991b1b; font-weight:700; font-size:0.72rem; padding:2px 6px; border-radius:4px;">🚨 CORTE (≥3 meses)</span>'
      : '';

    card.innerHTML = `
      <!-- Cabecera de la Tarjeta del Medidor -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed ${yaPagado ? '#86efac' : '#cbd5e1'}; padding-bottom: 6px; margin-bottom: 8px; flex-wrap: wrap; gap: 4px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: ${yaPagado ? 'default' : 'pointer'}; margin: 0;">
          <input type="checkbox" class="chk-medidor-item" data-id="${m.id}" ${isChecked ? 'checked' : ''} ${yaPagado ? 'disabled' : ''} style="width: 18px; height: 18px; accent-color: #0284c7; cursor: ${yaPagado ? 'not-allowed' : 'pointer'}; opacity: ${yaPagado ? '0.4' : '1'};" />
          <span style="font-weight: 800; color: #0f172a; font-size: 0.94rem;">
            💧 Medidor: <code style="color: #0284c7; background: #e0f2fe; padding: 2px 6px; border-radius: 4px; font-size: 0.88rem;">${m.numeroMedidor}</code>
          </span>
          <span class="badge" style="background: #f1f5f9; color: #475569; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">${m.alias}</span>
          ${badgeCorte}
          ${yaPagado ? `<span class="badge" style="background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; font-weight: 700;">✅ AL DÍA</span>` : ''}
        </label>
        <div style="text-align: right;">
          <span style="font-size: 0.72rem; color: #64748b; display: block;">Consumo Mes:</span>
          <strong id="displaySubtotalMedidor_${m.id}" style="font-size: 1.05rem; color: ${yaPagado ? '#166534' : (isChecked ? '#0284c7' : '#64748b')};">
            ${yaPagado ? '$0.00 USD (Al Día)' : `$${m.subtotalMes.toFixed(2)} USD`}
          </strong>
        </div>
      </div>

      <!-- Bloque de Lecturas y Consumo del Medidor -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: #f8fafc; border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; font-size: 0.82rem; text-align: center; border: 1px solid #e2e8f0;">
        <div>
          <span style="color: #64748b; font-size: 0.72rem; display: block;">⏱️ Anterior</span>
          <strong style="color: #334155;">${m.lecturaAnterior.toFixed(1)} m³</strong>
        </div>
        <div>
          <span style="color: #64748b; font-size: 0.72rem; display: block;">⏱️ Actual</span>
          <strong style="color: #0284c7;">${m.lecturaActual.toFixed(1)} m³</strong>
        </div>
        <div>
          <span style="color: #64748b; font-size: 0.72rem; display: block;">Consumo Mes</span>
          <strong style="color: #059669;">${m.consumoM3.toFixed(1)} m³</strong>
        </div>
      </div>

      <!-- Desglose Aspecto 1: Consumo mes actual (tarifa base + Excedente + servicio alcantarillado mensual si tiene) -->
      <div style="display: flex; flex-direction: column; gap: 4px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 10px; font-size: 0.8rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; color: #334155;">
          <span>• Tarifa Base (${selectedSocio?.esTerceraEdad ? '3ra Edad' : 'Normal'}):</span>
          <strong style="color: #0f172a;">$${m.cargoBase.toFixed(2)} USD</strong>
        </div>
        ${m.excedenteM3 > 0 ? `
        <div style="display: flex; justify-content: space-between; align-items: center; color: #0284c7;">
          <span>• Excedente (${m.excedenteM3.toFixed(1)} m³ a $${TARIFAS_CONFIG.EXCEDENTE_POR_M3.toFixed(2)}):</span>
          <strong>+$${m.valorExcedenteUSD.toFixed(2)} USD</strong>
        </div>` : ''}
        ${m.tieneAlcantarillado ? `
        <div style="display: flex; justify-content: space-between; align-items: center; color: #0284c7;">
          <span>• Serv. Alcantarillado mensual:</span>
          <strong>+$${m.recargoAlcant.toFixed(2)} USD</strong>
        </div>` : ''}
      </div>
    `;

    // Listener del Checkbox del Medidor
    const chkMedidor = card.querySelector('.chk-medidor-item');
    if (!yaPagado && chkMedidor) {
      chkMedidor.addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedMedidoresIds.add(m.id);
        } else {
          selectedMedidoresIds.delete(m.id);
        }
        recalcularTotalPOS();
      });
    }

    container.appendChild(card);
  });
}

async function displaySocioPlanilla(socio) {
  selectedSocio = socio;

  // 1. Consultar estado de cuenta y deudas en vivo desde el endpoint genérico universal del backend
  let dataDeudas = null;
  try {
    const resDeudas = await apiFetch(`/api/v1/socios/${socio.id}/deudas`);
    if (resDeudas && (resDeudas.socio || resDeudas.medidores)) {
      dataDeudas = resDeudas;
    } else if (resDeudas?.data && (resDeudas.data.socio || resDeudas.data.medidores)) {
      dataDeudas = resDeudas.data;
    }
  } catch (err) {
    console.warn('[Caja] Error consultando /deudas:', err);
  }

  // Fallback a /estado-cuenta
  if (!dataDeudas) {
    try {
      const resEst = await apiFetch(`/api/v1/socios/${socio.id}/estado-cuenta`);
      if (resEst && resEst.data) dataDeudas = resEst.data;
    } catch (_e) {}
  }

  const medidoresList = dataDeudas?.medidores || socio.medidores || [];
  const multasList = dataDeudas?.multasPendientes || [];

  socioCalculationsMedidores = [];
  socioDeudasAnteriores = [];
  selectedMedidoresIds = new Set();
  selectedDeudasAnterioresIds = new Set();

  medidoresList.forEach((m, idx) => {
    const numMedStr = String(m.numeroMedidor || m.numero_medidor || m.medidorNumero || '').trim();
    const consumo = m.consumoActual || {};
    const lant = Number(consumo.lecturaAnterior ?? m.lecturaAnterior ?? m.lecturaInicial ?? 0);
    const lact = Number(consumo.lecturaActual ?? lant);
    const cargoBase = Number(consumo.tarifaBase ?? (socio.esTerceraEdad ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL));
    const tieneAlcantMed = Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado);
    const recargoAlcant = tieneAlcantMed ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0.0;
    const facturasPendientes = m.facturasPendientes || [];
    const facturasPagadas = m.facturasPagadas || [];

    // Un medidor solo está al día en el mes si existe una factura pagada explícitamente para el período activo
    const codPeriodoActual = String(PERIODO_ACTUAL || '2026-08').trim();
    const codClean = codPeriodoActual.replace('-', '');
    const tieneFacPagadaMes = facturasPagadas.some((f) => {
      const pCod = String(f.periodoCodigo || f.periodo_codigo || f.id_periodo || f.idPeriodo || '');
      const numFac = String(f.numeroFactura || f.numero_factura || '');
      const isPer = pCod.includes(codPeriodoActual) || (codClean && numFac.includes(codClean));
      const cobroConsumo = Number(f.totalMes || f.total_mes || 0) > 0 || Number(f.valorBase || f.valor_base || 0) > 0;
      return isPer && cobroConsumo;
    });
    const tieneFacAguaPendienteMes = facturasPendientes.some((f) => {
      const pCod = String(f.periodoCodigo || f.periodo_codigo || f.id_periodo || f.idPeriodo || '');
      const numFac = String(f.numeroFactura || f.numero_factura || '');
      const isPer = pCod.includes(codPeriodoActual) || (codClean && numFac.includes(codClean));
      return isPer && Number(f.valorBase || f.valor_base || 0) > 0;
    });
    const yaPagadoMed = m.yaPagadoMes !== undefined
      ? Boolean(m.yaPagadoMes)
      : (Boolean(m.ya_pagado_mes || tieneFacPagadaMes) && !tieneFacAguaPendienteMes);

    const facMes = facturasPendientes[0] || null;

    let consumoM3 = Number(consumo.consumoTotalM3 ?? Math.max(0, lact - lant));
    let excedenteM3 = Number(consumo.excedenteM3 ?? Math.max(0, consumoM3 - TARIFAS_CONFIG.LIMITE_BASE_M3));
    let valorExcedenteUSD = Number(consumo.valorExcedente ?? (excedenteM3 * TARIFAS_CONFIG.EXCEDENTE_POR_M3).toFixed(2));

    // Si la lectura es 0 o lact <= lant, el excedente es estrictamente 0
    if (lact <= lant || consumoM3 === 0) {
      excedenteM3 = 0;
      valorExcedenteUSD = 0.0;
    }

    const facValorBase = facMes?.valorBase !== undefined && Number(facMes.valorBase) > 0 ? Number(facMes.valorBase) : cargoBase;
    
    // Sincronización fidedigna con base de datos:
    let facValorExc = valorExcedenteUSD;
    if (facMes && facMes.valorExcedente !== undefined) {
      facValorExc = Number(facMes.valorExcedente || 0);
    }
    if (lact <= lant || consumoM3 === 0) {
      facValorExc = 0.0;
      excedenteM3 = 0.0;
    }

    const facConsumoM3 = (lact <= lant || consumoM3 === 0) ? (facMes?.consumoM3 ? Number(facMes.consumoM3) : 0) : Math.max(Number(facMes?.consumoM3 || 0), consumoM3);
    const facExcedenteM3 = excedenteM3;

    // Aislamiento estricto: El cobro del mes actual es única y exclusivamente el recargo mensual de $1.00 si tiene alcantarillado
    const facValorAlcant = tieneAlcantMed ? recargoAlcant : 0.0;

    // Aspecto 1: Subtotal mes actual = Base + Excedente + Serv. Alcantarillado mensual
    const subtotalMes = Number((facValorBase + facValorExc + facValorAlcant).toFixed(2));

    const calcMed = {
      id: m.id || numMedStr,
      idMedidor: m.id,
      facturaId: facMes?.id || null,
      numeroMedidor: numMedStr,
      alias: m.alias || (medidoresList.length > 1 ? `Medidor #${idx + 1}` : 'Casa principal'),
      nombreSector: m.nombreSector || socio.nombreSector || 'Sector General',
      lecturaAnterior: lant,
      lecturaActual: lact,
      consumoM3: facConsumoM3,
      excedenteM3: facExcedenteM3,
      valorExcedenteUSD: facValorExc,
      cargoBase: facValorBase,
      tieneAlcantarillado: tieneAlcantMed,
      recargoAlcant: facValorAlcant,
      subtotalMes: subtotalMes,
      totalDeuda: Math.max(Number(m.totalDeuda || 0), subtotalMes),
      mesesAdeudados: Number(m.mesesAdeudados || (facMes?.mesesCalculados ?? (yaPagadoMed ? 0 : 1))),
      requiereCorte: Boolean(m.requiereCorte),
      yaPagadoMes: yaPagadoMed,
      reciboPago: facturasPagadas[0]?.numeroFactura || null,
      fechaPagoMes: facturasPagadas[0]?.fechaPago || null,
      facturasPendientes: facturasPendientes
    };

    socioCalculationsMedidores.push(calcMed);

    if (!yaPagadoMed) {
      selectedMedidoresIds.add(calcMed.id);
    }
  });

  // 2. Aspecto 2: Deuda_alcantarillado (Red Matriz - multas_rubros con tipo_rubro ALCANTARILLADO)
  const rubrosAlcant = Array.isArray(dataDeudas?.rubrosAlcantarillado)
    ? dataDeudas.rubrosAlcantarillado
    : (Array.isArray(dataDeudas?.multasPendientes) ? dataDeudas.multasPendientes.filter(m => (m.tipo_rubro || m.tipoRubro) === 'ALCANTARILLADO') : []);

  let deudaAlcantSocioMed = 0;
  if (dataDeudas?.socio?.deudaAlcantarillado !== undefined && Number(dataDeudas.socio.deudaAlcantarillado) > 0) {
    deudaAlcantSocioMed = Number(dataDeudas.socio.deudaAlcantarillado);
  } else if (rubrosAlcant.length > 0) {
    deudaAlcantSocioMed = rubrosAlcant.reduce((sum, r) => sum + Number(r.saldo_pendiente ?? r.monto ?? 0), 0);
  } else {
    deudaAlcantSocioMed = Number(socio.deudaAlcantarillado ?? socio.deuda_alcantarillado ?? 0);
  }

  selectedSocio.deudaAlcantarillado = deudaAlcantSocioMed;
  selectedDeudaAlcantarilladoActiva = deudaAlcantSocioMed > 0;
  selectedDeudaAlcantarilladoMontoAbonar = deudaAlcantSocioMed;

  // 3. Aspecto 3: Deuda historia (Corte Julio 2026 o facturas de períodos anteriores pendientes)
  medidoresList.forEach((m) => {
    const fPendientes = m.facturasPendientes || [];
    fPendientes.forEach((f) => {
      const isJuly = f.id_periodo === '33333333-0000-0000-0000-000000000000' || String(f.numeroFactura || f.numero_factura || '').includes('JUL') || f.periodoCodigo === '2026-07';
      const isAugust = f.id_periodo === '33333333-0000-0000-0000-000000000001' || String(f.numeroFactura || f.numero_factura || '').includes('202608') || f.periodoCodigo === '2026-08';
      
      if (!isAugust || isJuly) {
        const totP = Number(f.totalPagar || f.total_pagar || f.valorDeudaAnterior || f.valor_deuda_anterior || f.totalMes || f.total_mes || 0);
        if (totP > 0 && !socioDeudasAnteriores.some((d) => d.id === f.id)) {
          socioDeudasAnteriores.push({
            id: f.id,
            idMedidor: m.id,
            numeroFactura: f.numeroFactura || f.numero_factura || f.id,
            periodoCodigo: isJuly ? 'Corte Julio 2026' : (f.periodoCodigo || 'Mes Anterior'),
            totalPagar: totP,
            consumoM3: Number(f.consumoM3 || 0),
            descripcion: `Factura ${f.numeroFactura || f.numero_factura || f.id} (Corte Julio)`
          });
        }
      }
    });

    const facMes = fPendientes.find(f => String(f.periodoCodigo || '').includes('2026-08') || String(f.numeroFactura || '').includes('202608'));
    const facValorDeudaAnt = Number(facMes?.valorDeudaAnterior ?? facMes?.valor_deuda_anterior ?? 0);
    if (facValorDeudaAnt > 0 && socioDeudasAnteriores.length === 0) {
      const idDeuda = `deuda_hist_${m.id || m.numeroMedidor || m.medidorNumero}`;
      if (!socioDeudasAnteriores.some((d) => d.id === idDeuda)) {
        socioDeudasAnteriores.push({
          id: idDeuda,
          idMedidor: m.id,
          periodoCodigo: 'Corte Julio 2026',
          totalPagar: facValorDeudaAnt,
          consumoM3: 0,
          descripcion: `Deuda anterior medidor ${m.numeroMedidor || m.medidorNumero}`
        });
      }
    }
  });

  if (Array.isArray(dataDeudas?.facturasPendientes)) {
    dataDeudas.facturasPendientes.forEach((fac) => {
      const isJuly = fac.id_periodo === '33333333-0000-0000-0000-000000000000' || String(fac.numeroFactura || fac.numero_factura || '').includes('JUL') || fac.periodoCodigo === '2026-07';
      const totP = Number(fac.totalPagar || fac.total_pagar || fac.saldoPendiente || fac.saldo_pendiente || 0);
      if (isJuly && totP > 0 && !socioDeudasAnteriores.some((d) => d.id === fac.id)) {
        socioDeudasAnteriores.push({
          id: fac.id,
          numeroFactura: fac.numeroFactura || fac.numero_factura || fac.id,
          periodoCodigo: 'Corte Julio 2026',
          totalPagar: totP,
          consumoM3: Number(fac.consumoM3 || 0),
          descripcion: `Factura ${fac.numeroFactura || fac.id} (Corte Julio)`
        });
      }
    });
  }

  const deudaSocioGen = Number(socio.deudaPendiente || socio.deuda_pendiente || socio.valorDeudaAnterior || 0);
  const sumDeudasAnt = socioDeudasAnteriores.reduce((acc, d) => acc + d.totalPagar, 0);
  if (deudaSocioGen > sumDeudasAnt) {
    socioDeudasAnteriores.push({
      id: `deuda_socio_${socio.id}`,
      periodoCodigo: 'Corte Julio 2026',
      totalPagar: Number((deudaSocioGen - sumDeudasAnt).toFixed(2)),
      consumoM3: 0,
      descripcion: 'Saldo pendiente arrastrado general'
    });
  }

  selectedDeudasAnterioresIds = new Set(socioDeudasAnteriores.map((d) => d.id));
  selectedDeudasAnterioresAbonosMap.clear();
  socioDeudasAnteriores.forEach((d) => {
    selectedDeudasAnterioresAbonosMap.set(d.id, Number(d.totalPagar ?? d.total_pagar ?? d.monto ?? 0));
  });

  // 4. Aspecto 4: Multas y mingas (excluyendo alcantarillado que tiene su casilla independiente)
  socioMultas = (multasList || []).filter(m => (m.tipo_rubro || m.tipoRubro) !== 'ALCANTARILLADO');
  selectedMultasIds = new Set(socioMultas.map((m) => m.id));
  selectedMultasAbonosMap.clear();
  socioMultas.forEach((m) => {
    selectedMultasAbonosMap.set(m.id, Number(m.saldo_pendiente ?? m.monto ?? 0));
  });

  // Base tarifaria
  const edad = calcularEdad(socio.fechaNacimiento);
  const es3raEdad = Boolean(dataDeudas?.socio?.esTerceraEdad ?? (edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD));
  const tieneAlcantGeneral = Boolean(socio.tieneAlcantarillado || medidoresList.some((m) => m.tieneAlcantarillado));

  currentCalculation = {
    socioId: socio.id,
    socioNombre: dataDeudas?.socio?.nombreCompleto || socio.nombreCompleto,
    socioCedula: dataDeudas?.socio?.cedulaRuc || socio.cedulaRuc,
    socioSector: socio.nombreSector || socio.sectorId,
    medidorNumero: socioCalculationsMedidores.map((m) => m.numeroMedidor).join(' / ') || socio.medidorNumero,
    esTerceraEdad: es3raEdad,
    tieneAlcantarillado: tieneAlcantGeneral,
    medidores: socioCalculationsMedidores,
    rubrosAlcantarillado: rubrosAlcant,
    totalConsumoMes: 0,
    totalMes: 0,
    totalDeudaAlcantarillado: 0,
    totalMultasSeleccionadas: 0,
    totalDeudasSeleccionadas: 0,
    totalPagar: 0
  };

  document.getElementById('socioPlanillaEmpty').style.display = 'none';
  document.getElementById('socioPlanillaDetails').style.display = 'flex';

  // Mini Card
  document.getElementById('posSocioNombre').textContent = currentCalculation.socioNombre;
  document.getElementById('posSocioCedula').textContent = currentCalculation.socioCedula;

  const numMedidores = socioCalculationsMedidores.length;
  const medidoresStr =
    numMedidores > 1
      ? `💧 ${numMedidores} medidores (${socioCalculationsMedidores.map((m) => m.alias || m.numeroMedidor).join(', ')})`
      : `Medidor: ${currentCalculation.medidorNumero}`;

  document.getElementById('posSocioSector').innerHTML = `
    ${currentCalculation.socioSector} &bull; <strong style="color: #0284c7;">${medidoresStr}</strong>
  `;

  const todosMedsPagados = socioCalculationsMedidores.every((m) => m.yaPagadoMes);
  const estaAlDiaGeneral =
    todosMedsPagados &&
    socioMultas.length === 0 &&
    selectedSocio.deudaAlcantarillado <= 0 &&
    socioDeudasAnteriores.length === 0;

  document.getElementById('posCategoriaBadge').innerHTML = `
    <span class="age-badge ${currentCalculation.esTerceraEdad ? 'badge-senior' : 'badge-normal'}">
      ${currentCalculation.esTerceraEdad ? '👴 3ra Edad ($5.00)' : '👤 Normal ($7.00)'}
    </span>
    ${estaAlDiaGeneral ? '<span class="badge" style="background:#dcfce7; color:#166534; font-weight:700; padding:4px 10px; border-radius:4px; margin-left:6px; border:1px solid #bbf7d0;">✅ AL DÍA</span>' : ''}
  `;

  // Renderizar componentes
  renderMedidoresPOS();
  renderDeudaAlcantarilladoSection();
  renderDeudasAnterioresList();
  renderMultasList();
  recalcularTotalPOS();

  const inputRecibido = document.getElementById('inputMontoRecibido');
  if (inputRecibido) inputRecibido.value = '';
  updateVuelto();
}

function updateVuelto() {
  if (!currentCalculation) return;

  const total = currentCalculation.totalPagar;
  const inputRecibido = document.getElementById('inputMontoRecibido');
  const displayCambio = document.getElementById('posCambioMonto');
  if (!inputRecibido || !displayCambio) return;
  const recibidoVal = parseFloat(inputRecibido.value);

  if (isNaN(recibidoVal) || recibidoVal === 0) {
    displayCambio.textContent = '$0.00 USD';
    displayCambio.style.color = '#64748b';
    return;
  }

  const diff = Number((recibidoVal - total).toFixed(2));
  if (diff < 0) {
    const falta = Math.abs(diff);
    displayCambio.innerHTML = `<span style="color: #dc2626; font-weight: 800;">⚠️ Falta recibir: $${falta.toFixed(2)} USD</span> &bull; <span style="color: #64748b; font-size: 0.8rem;">(Total a liquidar: $${total.toFixed(2)})</span>`;
    displayCambio.style.color = '#dc2626';
  } else {
    displayCambio.textContent = `Cambio: $${diff.toFixed(2)} USD`;
    displayCambio.style.color = '#059669';
  }
}

// Event Listeners de Selección y Cálculo
document.getElementById('selectSocioCobro')?.addEventListener('change', async (e) => {
  const socioId = e.target.value;
  const inputSearch = document.getElementById('inputBuscarSocioCobro');
  if (!socioId) {
    selectedSocio = null;
    currentCalculation = null;
    if (inputSearch) inputSearch.value = '';
    document.getElementById('socioPlanillaEmpty').style.display = 'block';
    document.getElementById('socioPlanillaDetails').style.display = 'none';
    return;
  }

  const s = cachedSocios.find((item) => item.id === socioId);
  if (s) {
    if (inputSearch) inputSearch.value = s.nombreCompleto;
    await displaySocioPlanilla(s);
  }
});

function setupSocioSearch() {
  const inputSearch = document.getElementById('inputBuscarSocioCobro');
  const dropdown = document.getElementById('dropdownSugerenciasSocio');
  const selectSocio = document.getElementById('selectSocioCobro');
  if (!inputSearch || !dropdown) return;

  inputSearch.addEventListener('input', (e) => {
    const rawVal = e.target.value;
    const term = normalizeSearchText(rawVal);
    if (!term) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      return;
    }

    const matches = cachedSocios
      .filter((s) => {
        const medidoresStr = s.medidores ? s.medidores.map((m) => `${m.numeroMedidor} ${m.alias || ''}`).join(' ') : '';
        const composite = `${s.nombreCompleto || ''} ${s.cedulaRuc || ''} ${s.codigoSocio || ''} ${s.medidorNumero || ''} ${medidoresStr} ${s.nombreSector || ''}`;
        return matchesSearchTokens(composite, rawVal);
      })
      .slice(0, 8);

    if (matches.length === 0) {
      dropdown.innerHTML = `
        <div style="padding: 0.85rem; color: #64748b; font-size: 0.85rem; text-align: center;">
          🔍 No se encontraron socios para "<strong>${rawVal.trim()}</strong>"
        </div>
      `;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = matches
      .map((s) => {
        return `
          <div class="search-suggestion-item" data-id="${s.id}">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
              <div>
                <strong style="color: #0f172a; font-size: 0.9rem;">${s.nombreCompleto}</strong>
                <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">
                  Cédula: <code>${s.cedulaRuc}</code> &bull; Sector: <span class="sector-tag" style="font-size:0.7rem;">${s.nombreSector}</span> &bull; Medidor: <code>${s.medidorNumero}</code>
                </div>
              </div>
              <div style="text-align: right;">
                <span style="font-size: 0.78rem; color: #0284c7; font-weight: 600;">Seleccionar &rarr;</span>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    dropdown.querySelectorAll('.search-suggestion-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const id = item.dataset.id;
        const s = cachedSocios.find((x) => x.id === id);
        if (s) {
          inputSearch.value = s.nombreCompleto;
          if (selectSocio) selectSocio.value = s.id;
          dropdown.style.display = 'none';
          await displaySocioPlanilla(s);
        }
      });
    });

    dropdown.style.display = 'block';
  });

  document.addEventListener('click', (e) => {
    if (!inputSearch.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  inputSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });
}

// Modal Multa Eventos y Métodos
function openMultaModal(multa = null) {
  if (!selectedSocio) {
    Swal.fire({
      icon: 'warning',
      title: 'Seleccione un socio',
      text: 'Debe buscar o seleccionar un socio del padrón antes de registrar una multa.'
    });
    return;
  }

  const modal = document.getElementById('modalMulta');
  const titleEl = document.getElementById('modalMultaTitle');
  const idInput = document.getElementById('inputMultaId');
  const tipoSelect = document.getElementById('selectTipoRubroMulta');
  const motivoInput = document.getElementById('inputMotivoMulta');
  const montoInput = document.getElementById('inputMontoMulta');

  if (!modal) return;

  if (multa) {
    titleEl.textContent = `✏️ Editar Multa para ${selectedSocio.nombreCompleto}`;
    idInput.value = multa.id;
    tipoSelect.value = multa.tipoRubro || 'OTRO';
    motivoInput.value = multa.motivo || '';
    montoInput.value = Number(multa.monto).toFixed(2);
  } else {
    titleEl.textContent = `⚖️ Registrar Multa para ${selectedSocio.nombreCompleto}`;
    idInput.value = '';
    tipoSelect.value = 'MINGA';
    motivoInput.value = '';
    montoInput.value = '3.00';
  }

  modal.style.display = 'flex';
}

async function confirmDeleteMulta(multa) {
  const confirm = await Swal.fire({
    icon: 'question',
    title: '¿Eliminar Multa / Rubro?',
    text: `¿Desea eliminar la multa "${multa.motivo}" por $${Number(multa.monto).toFixed(2)}?`,
    showCancelButton: true,
    confirmButtonText: 'Sí, Eliminar',
    cancelButtonText: 'Cancelar'
  });

  if (!confirm.isConfirmed) return;

  try {
    await apiFetch(`/api/v1/multas/${multa.id}`, { method: 'DELETE' });
    selectedMultasIds.delete(multa.id);
    await refreshSocioEstadoCuenta();
    Swal.fire({
      icon: 'success',
      title: 'Multa Eliminada',
      text: 'La multa fue eliminada correctamente.',
      timer: 1500,
      showConfirmButton: false
    });
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error', text: err.message });
  }
}

async function refreshSocioEstadoCuenta() {
  if (!selectedSocio) return;
  try {
    await displaySocioPlanilla(selectedSocio);
  } catch (err) {
    console.warn('[Caja] Error actualizando estado de cuenta:', err);
  }
}

document.getElementById('btnOpenModalMulta')?.addEventListener('click', () => {
  openMultaModal();
});

document.getElementById('btnCloseMultaModal')?.addEventListener('click', () => {
  const m = document.getElementById('modalMulta');
  if (m) m.style.display = 'none';
});

document.getElementById('btnCancelMulta')?.addEventListener('click', () => {
  const m = document.getElementById('modalMulta');
  if (m) m.style.display = 'none';
});

document.getElementById('selectTipoRubroMulta')?.addEventListener('change', (e) => {
  const selOpt = e.target.selectedOptions[0];
  const suggested = selOpt ? selOpt.dataset.monto : '';
  const montoInput = document.getElementById('inputMontoMulta');
  if (suggested && montoInput) {
    montoInput.value = parseFloat(suggested).toFixed(2);
  }
});

document.getElementById('formMulta')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const idMulta = document.getElementById('inputMultaId')?.value;
  const tipoRubro = document.getElementById('selectTipoRubroMulta')?.value || 'OTRO';
  const motivo = document.getElementById('inputMotivoMulta')?.value.trim();
  const monto = parseFloat(document.getElementById('inputMontoMulta')?.value || '0');

  if (!motivo || isNaN(monto) || monto <= 0) {
    Swal.fire({ icon: 'warning', title: 'Datos incompletos', text: 'Ingrese un motivo y monto válidos.' });
    return;
  }

  const btnSave = document.getElementById('btnSaveMulta');
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.textContent = 'Guardando...';
  }

  try {
    if (idMulta) {
      await apiFetch(`/api/v1/multas/${idMulta}`, {
        method: 'PUT',
        body: JSON.stringify({ tipoRubro, motivo, monto })
      });
      selectedMultasIds.add(idMulta);
    } else {
      const res = await apiFetch('/api/v1/multas', {
        method: 'POST',
        body: JSON.stringify({
          idSocio: selectedSocio.id,
          tipoRubro,
          motivo,
          monto,
          idPeriodo: PERIODO_ACTUAL
        })
      });
      if (res.data?.id) {
        selectedMultasIds.add(res.data.id);
      }
    }

    const modal = document.getElementById('modalMulta');
    if (modal) modal.style.display = 'none';

    await refreshSocioEstadoCuenta();

    Swal.fire({
      icon: 'success',
      title: '¡Multa Guardada!',
      text: 'La multa ha sido registrada y agregada a la liquidación.',
      timer: 1500,
      showConfirmButton: false
    });
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error', text: err.message });
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.textContent = '💾 Guardar Multa';
    }
  }
});

/**
 * Restringe un campo numérico/monetario para:
 * 1. Bloquear comas (,), caracteres exponenciales (e, E), signos (+, -) y caracteres no numéricos.
 * 2. Permitir únicamente un solo punto decimal (.)
 * 3. Limitar a un máximo de 2 decimales (ej. 34.80 y bloquear 38.8000000).
 * 4. Sanitizar automáticamente pegado (paste) o autocompletado.
 */
function restrictDecimalInput(input, maxDecimals = 2, onChangeCallback = null) {
  if (!input) return;

  // 1. Interceptar pulsaciones de teclas
  input.addEventListener('keydown', (e) => {
    // Permitir teclas de navegación y control del sistema
    const allowedControls = [
      'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Home', 'End'
    ];
    if (allowedControls.includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    // Bloquear explícitamente comas, signos + / - y notación exponencial
    if (e.key === ',' || e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
      e.preventDefault();
      return;
    }

    // Permitir punto decimal solo si aún no existe uno
    if (e.key === '.') {
      if (input.value.includes('.')) {
        e.preventDefault();
      }
      return;
    }

    // Bloquear cualquier carácter que no sea un dígito 0-9
    if (!/^\d$/.test(e.key)) {
      e.preventDefault();
      return;
    }

    // Si ya existe un punto decimal, verificar la cantidad de decimales actuales
    const val = input.value;
    const dotIndex = val.indexOf('.');
    if (dotIndex !== -1) {
      try {
        const selStart = input.selectionStart;
        const selEnd = input.selectionEnd;
        // Si el cursor está en la parte decimal y no está reemplazando una selección
        if (selStart !== null && selStart > dotIndex && selStart === selEnd) {
          const decs = val.slice(dotIndex + 1);
          if (decs.length >= maxDecimals) {
            e.preventDefault();
            return;
          }
        }
      } catch (_) {
        // En navegadores donde input[type="number"] no expone selectionStart, el listener 'input' truncará al instante
      }
    }
  });

  // 2. Sanitizar en tiempo real en cada cambio/entrada/pegado
  const sanitizeValue = () => {
    let val = input.value;
    if (!val && val !== '0') {
      if (typeof onChangeCallback === 'function') onChangeCallback();
      return;
    }

    // Reemplazar cualquier coma por punto si se coló
    let cleaned = val.replace(/,/g, '.');

    // Mantener solo un punto decimal
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      cleaned = parts[0] + '.' + parts.slice(1).join('');
    }

    // Limitar parte decimal a maxDecimals
    const splitParts = cleaned.split('.');
    if (splitParts[1] && splitParts[1].length > maxDecimals) {
      cleaned = `${splitParts[0]}.${splitParts[1].slice(0, maxDecimals)}`;
    }

    if (input.value !== cleaned) {
      input.value = cleaned;
    }

    if (typeof onChangeCallback === 'function') {
      onChangeCallback();
    }
  };

  input.addEventListener('input', sanitizeValue);
  input.addEventListener('paste', () => {
    setTimeout(sanitizeValue, 0);
  });
  input.addEventListener('change', sanitizeValue);
  input.addEventListener('blur', () => {
    if (input.value && input.value.endsWith('.')) {
      input.value = input.value.slice(0, -1);
      if (typeof onChangeCallback === 'function') onChangeCallback();
    }
  });
}

// Aplicar restricción de 2 decimales y sin comas a los inputs monetarios de Caja
restrictDecimalInput(document.getElementById('inputMontoRecibido'), 2, updateVuelto);
restrictDecimalInput(document.getElementById('inputMontoMulta'), 2);
restrictDecimalInput(document.getElementById('inputMontoGasto'), 2);

// Ejecutar Cobro (Transacción de Caja en Vivo con el Servidor Backend)
document.getElementById('btnEjecutarCobro')?.addEventListener('click', async () => {
  if (!selectedSocio || !currentCalculation) return;

  const selectMetodo = document.getElementById('selectMetodoPago');
  const metodoPago = selectMetodo ? selectMetodo.value : 'EFECTIVO';
  const inputRecibido = document.getElementById('inputMontoRecibido');
  const montoRecibido = parseFloat(inputRecibido?.value || '0');

  if (metodoPago === 'EFECTIVO' && (isNaN(montoRecibido) || montoRecibido <= 0)) {
    Swal.fire({
      icon: 'warning',
      title: 'Monto Requerido',
      text: 'Por favor ingrese el monto recibido en efectivo (pago total o abono parcial).'
    });
    return;
  }

  const totalPagar = currentCalculation.totalPagar;

  if (metodoPago === 'EFECTIVO' && montoRecibido < totalPagar) {
    Swal.fire({
      icon: 'warning',
      title: 'Monto Recibido Insuficiente',
      html: `
        <div style="text-align: left; font-size: 0.95rem; color: #334155; line-height: 1.5;">
          <p>El Total a Liquidar configurado en las casillas es de <strong>$${totalPagar.toFixed(2)} USD</strong>, pero ha ingresado <strong>$${montoRecibido.toFixed(2)} USD</strong> en efectivo recibido.</p>
          <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 0.65rem; margin-top: 0.6rem; color: #92400e; font-size: 0.85rem;">
            💡 <em>Para cobrar un abono de exactamente $${montoRecibido.toFixed(2)} USD, por favor ajuste los campos "Abonar" de los rubros para que la suma coincida con lo recibido.</em>
          </div>
        </div>
      `
    });
    return;
  }

  const selectedMeters = socioCalculationsMedidores.filter((m) => selectedMedidoresIds.has(m.id) && !m.yaPagadoMes);
  const valBase = selectedMeters.reduce((acc, m) => acc + m.cargoBase, 0);
  const valExc = selectedMeters.reduce((acc, m) => acc + m.valorExcedenteUSD, 0);
  const consM3 = selectedMeters.reduce((acc, m) => acc + m.consumoM3, 0);
  const excM3 = selectedMeters.reduce((acc, m) => acc + m.excedenteM3, 0);
  const mensualAlcant = selectedMeters.reduce((acc, m) => acc + m.recargoAlcant, 0);
  const deudaAlcantCob = (selectedDeudaAlcantarilladoActiva && selectedSocio?.deudaAlcantarillado > 0)
    ? Number((selectedDeudaAlcantarilladoMontoAbonar ?? selectedSocio.deudaAlcantarillado).toFixed(2))
    : 0;
  const alcantTotalCobrado = Number((mensualAlcant + deudaAlcantCob).toFixed(2));
  const valMultasCob = socioMultas.filter((m) => selectedMultasIds.has(m.id)).reduce((acc, m) => {
    const saldo = Number(m.saldo_pendiente ?? m.monto ?? 0);
    const ab = selectedMultasAbonosMap.has(m.id) ? Number(selectedMultasAbonosMap.get(m.id)) : saldo;
    return acc + Number(Math.min(ab, saldo).toFixed(2));
  }, 0);
  const valDeudaAntCob = socioDeudasAnteriores.filter((d) => selectedDeudasAnterioresIds.has(d.id)).reduce((acc, d) => {
    const saldo = Number(d.totalPagar ?? d.total_pagar ?? d.monto ?? 0);
    const ab = selectedDeudasAnterioresAbonosMap.has(d.id) ? Number(selectedDeudasAnterioresAbonosMap.get(d.id)) : saldo;
    return acc + Number(Math.min(ab, saldo).toFixed(2));
  }, 0);
  const totalMesCob = Number((valBase + valExc + mensualAlcant).toFixed(2));
  const totalCobroCalculado = Number((totalMesCob + deudaAlcantCob + valDeudaAntCob + valMultasCob).toFixed(2));

  const hayAbonosParciales =
    (selectedDeudaAlcantarilladoActiva && selectedSocio?.deudaAlcantarillado > deudaAlcantCob) ||
    socioMultas.some((m) => selectedMultasIds.has(m.id) && (selectedMultasAbonosMap.get(m.id) || 0) < Number(m.saldo_pendiente ?? m.monto ?? 0)) ||
    socioDeudasAnteriores.some((d) => selectedDeudasAnterioresIds.has(d.id) && (selectedDeudasAnterioresAbonosMap.get(d.id) || 0) < Number(d.totalPagar ?? d.total_pagar ?? d.monto ?? 0));

  const cambio = metodoPago === 'EFECTIVO' ? Math.max(0, montoRecibido - totalCobroCalculado) : 0;
  let confirmHtml = `
    <div style="text-align: left; font-size: 0.95rem; color: #334155; line-height: 1.5;">
      <p style="margin-bottom: 0.5rem;">Socio: <strong>${currentCalculation.socioNombre}</strong></p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.6rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span>Total a Cobrar Hoy:</span>
          <strong style="color: #0284c7; font-size: 1.05rem;">$${totalCobroCalculado.toFixed(2)} USD</strong>
        </div>
        ${metodoPago === 'EFECTIVO' ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #059669; font-weight: 700;">
            <span>Efectivo Recibido:</span>
            <span>$${montoRecibido.toFixed(2)} USD</span>
          </div>
          ${cambio > 0 ? `
            <div style="display: flex; justify-content: space-between; color: #166534; font-weight: 800;">
              <span>Cambio a devolver:</span>
              <span>$${cambio.toFixed(2)} USD</span>
            </div>
          ` : ''}
        ` : ''}
      </div>
  `;

  if (hayAbonosParciales) {
    confirmHtml += `
      <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 0.6rem; font-size: 0.82rem; color: #92400e;">
        <strong>Detalle de Abonos Parciales:</strong>
        <ul style="margin: 4px 0 0 16px; padding: 0;">
          ${(selectedDeudaAlcantarilladoActiva && selectedSocio?.deudaAlcantarillado > deudaAlcantCob) ? `<li>Alcantarillado: Abonando $${deudaAlcantCob.toFixed(2)} (Resta: $${(selectedSocio.deudaAlcantarillado - deudaAlcantCob).toFixed(2)})</li>` : ''}
          ${socioMultas.filter(m => selectedMultasIds.has(m.id) && (selectedMultasAbonosMap.get(m.id) || 0) < Number(m.saldo_pendiente ?? m.monto ?? 0)).map(m => {
            const ab = selectedMultasAbonosMap.get(m.id) || 0;
            const sal = Number(m.saldo_pendiente ?? m.monto ?? 0);
            return `<li>${m.motivo || 'Multa'}: Abonando $${ab.toFixed(2)} (Resta: $${(sal - ab).toFixed(2)})</li>`;
          }).join('')}
        </ul>
      </div>
    `;
  }
  confirmHtml += `</div>`;

  const confirmRes = await Swal.fire({
    icon: 'question',
    title: hayAbonosParciales ? '¿Confirmar Cobro con Abonos?' : '¿Confirmar Cobro en Caja?',
    html: confirmHtml,
    showCancelButton: true,
    confirmButtonColor: '#0284c7',
    cancelButtonColor: '#64748b',
    confirmButtonText: '✓ Sí, Registrar Cobro',
    cancelButtonText: 'Cancelar'
  });

  if (!confirmRes.isConfirmed) return;

  const btnEjecutar = document.getElementById('btnEjecutarCobro');
  btnEjecutar.disabled = true;
  btnEjecutar.textContent = '⏳ Procesando transacción...';

  let cobroFinal = null;

  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const debtInvoiceIds = Array.from(selectedDeudasAnterioresIds).filter((id) => uuidRegex.test(id));
    const meterInvoiceIds = selectedMeters
      .map((m) => m.facturaId)
      .filter((id) => id && uuidRegex.test(id));

    // Determinar la factura principal que concentrará el cobro
    let mainInvoiceId = null;
    const secondaryMeterInvoiceIds = [];

    if (meterInvoiceIds.length > 0) {
      // 1. Si hay factura del mes actual, esa es la factura principal del cobro
      mainInvoiceId = meterInvoiceIds[0];
      meterInvoiceIds.slice(1).forEach((id) => {
        if (id !== mainInvoiceId) secondaryMeterInvoiceIds.push(id);
      });
    } else {
      // 2. Si no se cobra factura de mes actual (abono a deudas anteriores, multas o alcantarillado),
      // SIEMPRE se liquida una factura oficial de recibo REC-XXXXXX para concentrar el dinero
      // de la transacción actual sin sobreescribir ni liquidar prematuramente las facturas históricas.
      const firstMedidor = selectedMeters[0] || socioCalculationsMedidores[0];
      const liquidarRes = await apiFetch('/api/v1/facturas/liquidar', {
        method: 'POST',
        body: JSON.stringify({
          idSocio: selectedSocio.id,
          idMedidor: firstMedidor?.idMedidor || firstMedidor?.id || null,
          idPeriodo: '33333333-0000-0000-0000-000000000001', // Período activo
          esTerceraEdad: Boolean(currentCalculation.esTerceraEdad),
          valorBase: valBase,
          consumoM3: consM3,
          excedenteM3: excM3,
          valorExcedente: valExc,
          valorAlcantarillado: alcantTotalCobrado,
          valorMultas: valMultasCob,
          valorDeudaAnterior: valDeudaAntCob,
          totalMes: totalMesCob,
          totalPagar: totalCobroCalculado,
          numeroFactura: `REC-${String(Date.now()).slice(-6)}`
        })
      });

      if (liquidarRes?.data?.id) {
        mainInvoiceId = liquidarRes.data.id;
      } else {
        throw new Error(liquidarRes?.error || 'No se pudo generar la factura oficial para registrar el cobro en el servidor.');
      }
    }

    // Preparar abonos granulares a multas dentro de la factura
    const abonosList = [];
    if (selectedMultasIds.size > 0) {
      selectedMultasIds.forEach((mId) => {
        const mObj = socioMultas.find((m) => m.id === mId) || allLoadedMultas.find((m) => m.id === mId);
        const saldo = Number(mObj?.saldo_pendiente ?? mObj?.monto ?? 0);
        const montoAbonar = selectedMultasAbonosMap.has(mId) ? Number(selectedMultasAbonosMap.get(mId)) : saldo;
        const realAbono = Number(Math.min(montoAbonar, saldo).toFixed(2));
        if (realAbono > 0) {
          abonosList.push({
            idRubro: mId,
            montoAbonado: realAbono
          });
        }
      });
    }

    if (deudaAlcantCob > 0 && Array.isArray(currentCalculation.rubrosAlcantarillado)) {
      let remAbonoAlcant = deudaAlcantCob;
      currentCalculation.rubrosAlcantarillado.forEach((r) => {
        const saldo = Number(r.saldo_pendiente ?? r.monto ?? 0);
        if (saldo > 0 && remAbonoAlcant > 0) {
          const chunk = Number(Math.min(saldo, remAbonoAlcant).toFixed(2));
          abonosList.push({
            idRubro: r.id,
            montoAbonado: chunk
          });
          remAbonoAlcant = Number((remAbonoAlcant - chunk).toFixed(2));
        }
      });
    }

    // Enviar cobro ÚNICO a la factura principal (concentra todo el dinero recaudado y emite 1 solo recibo)
    let facturaConfirmada = null;
    const facturaId = mainInvoiceId;
    const resCobro = await apiFetch(`/api/v1/facturas/${mainInvoiceId}/cobrar`, {
      method: 'POST',
      body: JSON.stringify({
        metodoPago,
        montoRecibido: totalCobroCalculado,
        fechaPago: new Date().toISOString(),
        consumoM3: consM3,
        excedenteM3: excM3,
        valorBase: valBase,
        valorExcedente: valExc,
        valorAlcantarillado: alcantTotalCobrado,
        valorMultas: valMultasCob,
        valorDeudaAnterior: valDeudaAntCob,
        totalMes: totalMesCob,
        totalPagar: totalCobroCalculado,
        abonos: abonosList,
        multasCobradasIds: Array.from(selectedMultasIds)
      })
    });

    if (!resCobro || (!resCobro.success && !resCobro.data)) {
      throw new Error(resCobro?.error || 'El servidor central no confirmó la transacción.');
    }
    if (resCobro.data?.factura) {
      facturaConfirmada = resCobro.data.factura;
    }

    // Actualizar facturas secundarias del mes actual (si el socio tiene múltiples medidores)
    for (const secId of secondaryMeterInvoiceIds) {
      try {
        await apiFetch(`/api/v1/facturas/${secId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            estado_pago: 'PAGADO',
            total_pagar: 0.00,
            total_mes: 0.00,
            fecha_pago: new Date().toISOString(),
            metodo_pago: metodoPago
          })
        });
      } catch (_secErr) {
        console.warn('[Caja] Advertencia actualizando medidor secundario:', secId, _secErr);
      }
    }

    // ACTUALIZACIÓN GENÉRICA DE DEUDAS ANTERIORES:
    // Soporta liquidación total ($0) y abonos parciales manteniendo el saldo sobrante en PENDIENTE
    for (const dId of debtInvoiceIds) {
      const deudaObj = socioDeudasAnteriores.find((d) => d.id === dId);
      const saldoOrig = Number(deudaObj?.totalPagar ?? deudaObj?.total_pagar ?? deudaObj?.monto ?? 0);
      const montoAbonar = selectedDeudasAnterioresAbonosMap.has(dId)
        ? Number(selectedDeudasAnterioresAbonosMap.get(dId))
        : saldoOrig;
      const abonoReal = Number(Math.min(montoAbonar, saldoOrig).toFixed(2));
      const saldoRestante = Number(Math.max(0, saldoOrig - abonoReal).toFixed(2));

      if (saldoRestante <= 0.001) {
        // Liquidación total de la deuda anterior
        try {
          await apiFetch(`/api/v1/facturas/${dId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              estado_pago: 'PAGADO',
              total_pagar: 0.00,
              total_mes: 0.00,
              valor_deuda_anterior: 0.00,
              fecha_pago: new Date().toISOString(),
              metodo_pago: metodoPago
            })
          });
        } catch (_secErr) {
          console.warn('[Caja] Advertencia liquidando deuda anterior:', dId, _secErr);
        }
      } else {
        // ¡ABONO PARCIAL GENÉRICO! La factura anterior permanece PENDIENTE con su saldo restante
        try {
          await apiFetch(`/api/v1/facturas/${dId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              estado_pago: 'PENDIENTE',
              total_pagar: saldoRestante,
              total_mes: saldoRestante,
              valor_deuda_anterior: saldoRestante
            })
          });
        } catch (_secErr) {
          console.warn('[Caja] Advertencia registrando abono en deuda anterior:', dId, _secErr);
        }
      }
    }

    // Notificar reactivamente a otros módulos (Módulo 4 Fondos / Contraloría)
    try {
      const bc = new BroadcastChannel('siga_fondos_events');
      bc.postMessage({ type: 'COBRO_FACTURA', facturaId, timestamp: Date.now() });
      bc.close();
    } catch (_e) {}
    localStorage.setItem('siga_last_cobro', String(Date.now()));

    const medidoresCobrados = selectedMeters.map((m) => ({
      idMedidor: m.idMedidor || m.id,
      numeroMedidor: m.numeroMedidor,
      alias: m.alias,
      cobraMes: true,
      cobraDeuda: false,
      lecturaAnterior: m.lecturaAnterior,
      lecturaActual: m.lecturaActual,
      consumoM3: m.consumoM3,
      excedenteM3: m.excedenteM3,
      cargoBase: m.cargoBase,
      valorExcedenteUSD: m.valorExcedenteUSD,
      alcantarilladoUSD: m.recargoAlcant,
      deudaMedidorCobrada: 0,
      multaCobrada: 0,
      subtotalCobrado: m.subtotalMes
    }));

    let periodoCobro = PERIODO_ACTUAL;
    if (selectedMeters.length === 0 && selectedDeudasAnterioresIds.size > 0) {
      const firstDeuda = socioDeudasAnteriores.find((d) => selectedDeudasAnterioresIds.has(d.id));
      periodoCobro = firstDeuda?.periodoCodigo || firstDeuda?.periodoNombre || '2026-07';
    }

    const medidorNumeroStr = medidoresCobrados.map((m) => m.numeroMedidor).join(' / ') || currentCalculation.medidorNumero;
    const numeroRecibo = facturaConfirmada?.numero_factura || facturaConfirmada?.numeroFactura || (facturaId ? `FAC-${facturaId.slice(0, 8)}` : `REC-${String(Date.now()).slice(-6)}`);

    // Calcular remanentes totales exactos (Alcantarillado + Multas + Deudas Anteriores)
    const saldoRestanteDeudasAnt = socioDeudasAnteriores
      .filter((d) => selectedDeudasAnterioresIds.has(d.id))
      .reduce((acc, d) => {
        const sal = Number(d.totalPagar ?? d.total_pagar ?? d.monto ?? 0);
        const ab = selectedDeudasAnterioresAbonosMap.has(d.id) ? Number(selectedDeudasAnterioresAbonosMap.get(d.id)) : sal;
        return acc + Math.max(0, Number((sal - ab).toFixed(2)));
      }, 0);

    const saldoRestanteAlcant = (selectedDeudaAlcantarilladoActiva && selectedSocio?.deudaAlcantarillado > deudaAlcantCob)
      ? Number((selectedSocio.deudaAlcantarillado - deudaAlcantCob).toFixed(2))
      : 0;

    const saldoRestanteMultas = socioMultas
      .filter((m) => selectedMultasIds.has(m.id))
      .reduce((acc, m) => {
        const sal = Number(m.saldo_pendiente ?? m.monto ?? 0);
        const ab = selectedMultasAbonosMap.get(m.id) || 0;
        return acc + Math.max(0, Number((sal - ab).toFixed(2)));
      }, 0);

    const saldoPendienteTotal = Number((saldoRestanteAlcant + saldoRestanteMultas + saldoRestanteDeudasAnt).toFixed(2));

    cobroFinal = {
      id: facturaId,
      numeroRecibo,
      numeroFactura: numeroRecibo,
      socioId: selectedSocio.id,
      idSocio: selectedSocio.id,
      codigoSocio: selectedSocio.codigoSocio,
      socioNombre: currentCalculation.socioNombre,
      socioCedula: currentCalculation.socioCedula,
      socioSector: currentCalculation.socioSector,
      medidorNumero: medidorNumeroStr,
      medidoresCobrados,
      periodo: periodoCobro,
      lecturaAnterior: medidoresCobrados[0]?.lecturaAnterior || 0,
      lecturaActual: medidoresCobrados[0]?.lecturaActual || 0,
      consumoM3: consM3,
      cargoBase: valBase,
      valorExcedenteUSD: valExc,
      alcantarilladoUSD: alcantTotalCobrado,
      deudaAlcantarilladoCobrada: deudaAlcantCob,
      multaExtra: valMultasCob,
      multasCobradasIds: Array.from(selectedMultasIds),
      deudaAnteriorCobrada: valDeudaAntCob,
      totalMes: totalMesCob,
      montoTotal: totalCobroCalculado,
      montoAbonado: totalCobroCalculado,
      montoPagado: totalCobroCalculado,
      saldoPendiente: saldoPendienteTotal,
      esAbono: hayAbonosParciales || saldoPendienteTotal > 0,
      metodoPago,
      montoRecibido: metodoPago === 'EFECTIVO' ? montoRecibido : totalCobroCalculado,
      cambioEntregado: metodoPago === 'EFECTIVO' ? Math.max(0, montoRecibido - totalCobroCalculado) : 0,
      fechaPago: new Date().toISOString()
    };

    // Agregar cobroFinal inmediatamente para refresco reactivo instantáneo de caja
    if (cobroFinal) {
      allLoadedCobros.unshift(cobroFinal);
    }
  } catch (apiErr) {
    console.error('[Caja] Error en transacción:', apiErr);
    Swal.fire({
      icon: 'error',
      title: 'No se pudo registrar el cobro',
      text: apiErr.message || 'El servidor central o Supabase Cloud rechazó la transacción. No se generó ningún cobro.'
    });
    return;
  } finally {
    btnEjecutar.disabled = false;
    btnEjecutar.textContent = '✅ Cobrar y Emitir Recibo';
  }

  // Actualizar socio en memoria y recalcular cuentas corrientes
  const totalDeudaAlcantCobrada = currentCalculation.totalDeudaAlcantarillado || 0;
  cachedSocios = cachedSocios.map((s) => {
    if (s.id === selectedSocio.id) {
      const nuevoDeudaAlcant = Math.max(0, Number(((s.deudaAlcantarillado || 0) - totalDeudaAlcantCobrada).toFixed(2)));
      return {
        ...s,
        deudaAlcantarillado: nuevoDeudaAlcant,
        estadoCuenta: cobroFinal.saldoPendiente > 0 ? 'EN_MORA' : 'AL_DIA',
        mesesAdeudados: cobroFinal.saldoPendiente > 0 ? 1 : 0,
        montoTotalAdeudado: cobroFinal.saldoPendiente
      };
    }
    return s;
  });
  actualizarCuentasCorrientesSocios();

  // Limpiar UI del POS
  const inputSearch = document.getElementById('inputBuscarSocioCobro');
  if (inputSearch) inputSearch.value = '';
  const selectSocioEl = document.getElementById('selectSocioCobro');
  if (selectSocioEl) selectSocioEl.value = '';
  document.getElementById('socioPlanillaEmpty').style.display = 'block';
  document.getElementById('socioPlanillaDetails').style.display = 'none';
  selectedSocio = null;
  currentCalculation = null;

  await updateMetricsAndHistory();
  populateSocioSelect(cachedSocios);

  // Mostrar Recibo Imprimible Pishilata
  showReceiptModal(cobroFinal);

  if (cobroFinal.esAbono) {
    Swal.fire({
      icon: 'info',
      title: '¡Abono Parcial Registrado!',
      html: `Se registró el abono de <strong>$${cobroFinal.montoAbonado.toFixed(2)} USD</strong> para ${cobroFinal.socioNombre}.<br>Saldo restante por cobrar: <strong style="color: #dc2626;">$${cobroFinal.saldoPendiente.toFixed(2)} USD</strong>.`
    });
  } else {
    Swal.fire({
      icon: 'success',
      title: '¡Cobro Exitoso!',
      text: `Se registró el cobro de $${cobroFinal.montoTotal.toFixed(2)} USD para ${cobroFinal.socioNombre}. Fondos distribuidos en Contraloría.`
    });
  }
});

// Extrae información precisa del período facturado/cancelado (Nombre de mes, número de mes y año)
function getPeriodoInfoCobro(cobro) {
  const nombresMeses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  let raw = String(cobro?.periodo || cobro?.periodoCodigo || cobro?.periodoNombre || cobro?.idPeriodo || cobro?.id_periodo || '').trim();

  // Mapeo de UUIDs conocidos de períodos
  if (raw === '33333333-0000-0000-0000-000000000001') raw = '2026-08';
  if (raw === '33333333-0000-0000-0000-000000000000') raw = '2026-07';

  // Si no viene o es un UUID desconocido, deducir por el número de factura/recibo (ej: FAC-202608-0022)
  if (!raw || raw.length < 4 || /^[0-9a-f-]{36}$/i.test(raw)) {
    const num = String(cobro?.numeroFactura || cobro?.numeroRecibo || cobro?.id || '');
    const m = num.match(/(?:FAC|REC)[-_]?(\d{4})(\d{2})/i);
    if (m) {
      raw = `${m[1]}-${m[2]}`;
    }
  }

  // Si sigue sin definirse, tomar el período activo del sistema (PERIODO_ACTUAL)
  if (!raw || /^[0-9a-f-]{36}$/i.test(raw)) {
    raw = String(typeof PERIODO_ACTUAL !== 'undefined' && PERIODO_ACTUAL ? PERIODO_ACTUAL : '2026-08').trim();
  }

  // Formato ISO 'YYYY-MM' (ej: '2026-08' -> Agosto del 2026)
  const matchIso = raw.match(/^(\d{4})-(\d{1,2})/);
  if (matchIso) {
    const anio = parseInt(matchIso[1], 10);
    const mesNum = parseInt(matchIso[2], 10);
    if (mesNum >= 1 && mesNum <= 12) {
      return {
        mesNombre: nombresMeses[mesNum - 1],
        mesNumero: mesNum,
        anio: anio,
        anioStr: String(anio),
        anioDigito: String(anio).slice(-1)
      };
    }
  }

  // Formato con texto de mes (ej: 'Corte Julio 2026', 'Agosto 2026')
  for (let i = 0; i < nombresMeses.length; i++) {
    if (new RegExp(nombresMeses[i], 'i').test(raw)) {
      const matchAnio = raw.match(/\b(20\d\d)\b/);
      const anio = matchAnio ? parseInt(matchAnio[1], 10) : 2026;
      return {
        mesNombre: nombresMeses[i],
        mesNumero: i + 1,
        anio: anio,
        anioStr: String(anio),
        anioDigito: String(anio).slice(-1)
      };
    }
  }

  // Fallback seguro: Período activo del sistema (Agosto 2026)
  return {
    mesNombre: 'Agosto',
    mesNumero: 8,
    anio: 2026,
    anioStr: '2026',
    anioDigito: '6'
  };
}

// Modal Recibo Formato Físico Pishilata - Tungurahua
function showReceiptModal(cobro) {
  const modal = document.getElementById('modalReciboPrint');
  if (!modal) return;

  const fechaCobro = new Date(cobro.fechaPago || cobro.fecha_pago || cobro.createdAt || Date.now());
  const nombresMeses = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre'
  ];

  // 1. Fecha de Cancelación en Caja (Fecha real del sistema / momento del pago)
  const diaPago = !isNaN(fechaCobro.getTime()) ? fechaCobro.getDate() : new Date().getDate();
  const mesPagoIndex = !isNaN(fechaCobro.getTime()) ? fechaCobro.getMonth() : new Date().getMonth();
  const mesPagoNombre = nombresMeses[mesPagoIndex];
  const anioPagoStr = String(!isNaN(fechaCobro.getTime()) ? fechaCobro.getFullYear() : new Date().getFullYear());

  // 2. Período que se está cancelando en el sistema (ej: Cuenta correspondiente al mes de Agosto del 2026)
  const infoPeriodo = getPeriodoInfoCobro(cobro);
  const mesPeriodoNombre = infoPeriodo.mesNombre; // ej: 'Agosto'
  const anioPeriodoStr = infoPeriodo.anioStr;     // ej: '2026'
  const anioPeriodoDigito = infoPeriodo.anioDigito; // ej: '6'

  // Cuenta No y Número correlativo
  const cuentaNoEl = document.getElementById('reciboCuentaNo');
  if (cuentaNoEl) {
    cuentaNoEl.textContent =
      cobro.codigoSocio || (cobro.socioCedula ? `SOC-${cobro.socioCedula.slice(-5)}` : 'SOC-00102');
  }

  const rawNumero = cobro.numeroRecibo || cobro.numeroFactura || cobro.id || '';
  const numEl = document.getElementById('reciboNumero');
  const codigoEl = document.getElementById('reciboCodigoTxt');

  // Obtener código completo con prefijo (ej: REC-045194)
  let codigoCompleto = String(rawNumero).trim();
  if (!codigoCompleto) {
    codigoCompleto = `REC-${String(Date.now()).slice(-6)}`;
  } else if (!codigoCompleto.startsWith('REC-') && !codigoCompleto.startsWith('FAC-')) {
    codigoCompleto = `REC-${codigoCompleto}`;
  }

  // Extraer número correlativo para la casilla oficial (ej: 045194)
  let numCorrelativo = codigoCompleto.replace(/^(?:REC|FAC)-/i, '');
  if (/^\d{4}-/.test(numCorrelativo)) {
    numCorrelativo = numCorrelativo.replace(/^\d{4}-/, '');
  }
  if (/^\d+$/.test(numCorrelativo)) {
    numCorrelativo = numCorrelativo.padStart(6, '0');
  }

  if (numEl) numEl.textContent = numCorrelativo;
  if (codigoEl) codigoEl.textContent = codigoCompleto;

  // Datos del Abonado
  const socioEl = document.getElementById('reciboSocio');
  if (socioEl) socioEl.textContent = (cobro.socioNombre || '').toUpperCase();

  const medidorEl = document.getElementById('reciboMedidor');
  if (medidorEl) {
    if (cobro.medidoresCobrados && cobro.medidoresCobrados.length > 1) {
      medidorEl.textContent = cobro.medidoresCobrados.map((m) => `${m.numeroMedidor} (${m.alias || 'Acometida'})`).join(' • ');
    } else {
      medidorEl.textContent = cobro.medidorNumero || 'MED-10492';
    }
  }

  const sectorEl = document.getElementById('reciboSector');
  if (sectorEl) sectorEl.textContent = cobro.socioSector || 'Sector Centro';

  // Fecha en que se canceló en caja (ej: 20 de Septiembre del 2026)
  const fechaCanceladoEl = document.getElementById('reciboFechaCancelado');
  if (fechaCanceladoEl) {
    fechaCanceladoEl.textContent = `${diaPago} de ${mesPagoNombre} del ${anioPagoStr}`;
  }

  // Mes y año del período al que corresponde la cuenta cancelada (ej: Agosto del 2026)
  const mesCorrEl = document.getElementById('reciboMesCorrespondiente');
  if (mesCorrEl) mesCorrEl.textContent = mesPeriodoNombre;

  const anioDigitoEl = document.getElementById('reciboAnioDigito');
  if (anioDigitoEl) anioDigitoEl.textContent = anioPeriodoDigito;

  // Fechas de consumo y vencimiento del período facturado
  const diaDesdeEl = document.getElementById('reciboDiaDesde');
  if (diaDesdeEl) diaDesdeEl.textContent = '01';
  const mesDesdeEl = document.getElementById('reciboMesDesde');
  if (mesDesdeEl) mesDesdeEl.textContent = mesPeriodoNombre;
  
  const ultimoDiaMesPeriodo = new Date(infoPeriodo.anio, infoPeriodo.mesNumero, 0).getDate();
  const diaHastaEl = document.getElementById('reciboDiaHasta');
  if (diaHastaEl) diaHastaEl.textContent = String(ultimoDiaMesPeriodo).padStart(2, '0');
  const mesHastaEl = document.getElementById('reciboMesHasta');
  if (mesHastaEl) mesHastaEl.textContent = mesPeriodoNombre;

  const vencimientoEl = document.getElementById('reciboVencimiento');
  if (vencimientoEl) {
    const mesVencIndex = infoPeriodo.mesNumero % 12;
    const anioVenc = infoPeriodo.mesNumero === 12 ? infoPeriodo.anio + 1 : infoPeriodo.anio;
    const mesVencNombre = nombresMeses[mesVencIndex];
    vencimientoEl.textContent = `15 de ${mesVencNombre} del ${anioVenc}`;
  }

  // Tabla Cuadriculada (Soporta 1 o Múltiples Medidores Dinámicamente)
  const tbody = document.getElementById('reciboTableBody');
  const meds = cobro.medidoresCobrados;
  let totalFinal = Number(cobro.montoTotal ?? (cobro.montoPagado || 0));

  if (tbody && meds && meds.length > 1) {
    tbody.innerHTML = '';
    let sumConsumo = 0;
    let sumBasico = 0;
    let sumExcM3 = 0;
    let sumCargoFijo = 0;
    let sumValorExc = 0;
    let sumTotalTarifa = 0;
    let sumOtros = 0;
    let sumTotalMes = 0;
    let sumDeudaAnt = 0;
    let sumTotal = 0;

    meds.forEach((m) => {
      const mConsumo = Number(m.consumoM3 || 0);
      const mBasico = 30;
      const mExcM3 = Number(m.excedenteM3 || 0);
      const mCargoFijo = Number(m.cargoBase || 0);
      const mValorExc = Number(m.valorExcedenteUSD || 0);
      const mTotalTarifa = mCargoFijo + mValorExc;
      const mOtros = Number(m.alcantarilladoUSD || 0);
      const mTotalMes = mTotalTarifa + mOtros;
      const mDeudaAnt = Number(m.deudaMedidorCobrada || 0);
      const mTotalFinal = mTotalMes + mDeudaAnt;

      sumConsumo += mConsumo;
      sumBasico += mBasico;
      sumExcM3 += mExcM3;
      sumCargoFijo += mCargoFijo;
      sumValorExc += mValorExc;
      sumTotalTarifa += mTotalTarifa;
      sumOtros += mOtros;
      sumTotalMes += mTotalMes;
      sumDeudaAnt += mDeudaAnt;
      sumTotal += mTotalFinal;

      // Encabezado del medidor dentro de la tabla
      const trHeader = document.createElement('tr');
      trHeader.className = 'data-row';
      trHeader.innerHTML = `
        <td colspan="12" style="text-align: left; font-size: 0.72rem; font-weight: 800; color: #0369a1; background: #e0f2fe; padding: 3px 6px; border-top: 1px solid #334155; border-bottom: 1px solid #cbd5e1;">
          💧 Medidor: <strong>${m.numeroMedidor}</strong> (${m.alias || 'Acometida'})
        </td>
      `;
      tbody.appendChild(trHeader);

      // Fila de datos del medidor
      const trData = document.createElement('tr');
      trData.className = 'data-row';
      trData.innerHTML = `
        <td>${Number(m.lecturaActual || 0).toFixed(2)}</td>
        <td>${Number(m.lecturaAnterior || 0).toFixed(2)}</td>
        <td>${mConsumo.toFixed(2)}</td>
        <td>${mBasico.toFixed(2)}</td>
        <td>${mExcM3.toFixed(2)}</td>
        <td>$${mCargoFijo.toFixed(2)}</td>
        <td>$${mValorExc.toFixed(2)}</td>
        <td>$${mTotalTarifa.toFixed(2)}</td>
        <td>$${mOtros.toFixed(2)}</td>
        <td>$${mTotalMes.toFixed(2)}</td>
        <td>$${mDeudaAnt.toFixed(2)}</td>
        <td><strong>$${mTotalFinal.toFixed(2)}</strong></td>
      `;
      tbody.appendChild(trData);
    });

    // Rubros extraordinarios / Deuda general de alcantarillado
    const multasExtra = Number(cobro.multaExtra || 0);
    const deudaAlcantGen = Number(cobro.deudaAlcantarilladoCobrada || 0);
    const generalOtros = multasExtra + deudaAlcantGen;
    if (generalOtros > 0) {
      sumOtros += generalOtros;
      sumTotalMes += generalOtros;
      sumTotal += generalOtros;

      const trExtra = document.createElement('tr');
      trExtra.className = 'data-row';
      trExtra.innerHTML = `
        <td colspan="8" style="text-align: right; font-size: 0.72rem; font-weight: 700; background: #fef3c7; color: #92400e; padding: 3px 6px;">
          ⚖️ Multas Extraordinarias / Deuda Alcantarillado General:
        </td>
        <td style="background: #fef3c7; font-weight: 700;">$${generalOtros.toFixed(2)}</td>
        <td style="background: #fef3c7; font-weight: 700;">$${generalOtros.toFixed(2)}</td>
        <td style="background: #fef3c7;">$0.00</td>
        <td style="background: #fef3c7; font-weight: 800;">$${generalOtros.toFixed(2)}</td>
      `;
      tbody.appendChild(trExtra);
    }

    // Fila de TOTALES
    const trTotal = document.createElement('tr');
    trTotal.className = 'data-row';
    trTotal.style.cssText = 'background: #f1f5f9; font-weight: 800; border-top: 2px solid #0f172a;';
    trTotal.innerHTML = `
      <td colspan="2" style="text-align: right; font-weight: 800; font-size: 0.78rem;">TOTALES:</td>
      <td>${sumConsumo.toFixed(2)}</td>
      <td>-</td>
      <td>${sumExcM3.toFixed(2)}</td>
      <td>$${sumCargoFijo.toFixed(2)}</td>
      <td>$${sumValorExc.toFixed(2)}</td>
      <td>$${sumTotalTarifa.toFixed(2)}</td>
      <td>$${sumOtros.toFixed(2)}</td>
      <td>$${sumTotalMes.toFixed(2)}</td>
      <td>$${sumDeudaAnt.toFixed(2)}</td>
      <td style="color: #0284c7; font-size: 0.88rem;">$${sumTotal.toFixed(2)}</td>
    `;
    tbody.appendChild(trTotal);
    totalFinal = cobro.montoTotal !== undefined ? Number(cobro.montoTotal) : sumTotal;

  } else if (tbody) {
    // 1 solo medidor (formato clásico directo)
    const lact = cobro.lecturaActual ?? (cobro.consumoM3 ? 150 + cobro.consumoM3 : 185);
    const lant = cobro.lecturaAnterior ?? 150;
    const consumo = cobro.consumoM3 ?? Math.max(0, lact - lant);
    const basico = 30;
    const excedenteM3 = Math.max(0, consumo - basico);

    const cargoFijo = cobro.cargoBase ?? 7.0;
    const valorExcedente = cobro.valorExcedenteUSD ?? Number((excedenteM3 * 0.1).toFixed(2));
    const totalTarifa = cargoFijo + valorExcedente;
    const otros = (cobro.alcantarilladoUSD || 0) + (cobro.multaExtra || 0);
    const totalMes = totalTarifa + otros;
    const deudaAnterior = cobro.deudaAnteriorCobrada || 0;
    totalFinal = cobro.montoTotal !== undefined ? Number(cobro.montoTotal) : (totalMes + deudaAnterior);

    tbody.innerHTML = `
      <tr class="data-row">
        <td>${Number(lact).toFixed(2)}</td>
        <td>${Number(lant).toFixed(2)}</td>
        <td>${Number(consumo).toFixed(2)}</td>
        <td>${Number(basico).toFixed(2)}</td>
        <td>${Number(excedenteM3).toFixed(2)}</td>
        <td>$${cargoFijo.toFixed(2)}</td>
        <td>$${valorExcedente.toFixed(2)}</td>
        <td>$${totalTarifa.toFixed(2)}</td>
        <td>$${otros.toFixed(2)}</td>
        <td>$${totalMes.toFixed(2)}</td>
        <td>$${deudaAnterior.toFixed(2)}</td>
        <td>$${totalFinal.toFixed(2)}</td>
      </tr>
      <tr class="empty-row">
        <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
        <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
        <td>&nbsp;</td><td>&nbsp;</td>
      </tr>
    `;
  }

  // Total e info cajero
  const totalFinalEl = document.getElementById('reciboTotalFinal');
  if (totalFinalEl) totalFinalEl.textContent = `$${Number(totalFinal || 0).toFixed(2)}`;

  // Mostrar detalle de abono si aplica
  const totalLabelEl = document.getElementById('reciboTotalLabel');
  const abonoInfoEl = document.getElementById('reciboAbonoInfo');
  const abonoMontoEl = document.getElementById('reciboMontoAbonado');
  const saldoPendEl = document.getElementById('reciboSaldoPendiente');
  const stampTextEl = document.getElementById('reciboStampText');

  const esAbono = Boolean(cobro.esAbono || (cobro.saldoPendiente !== undefined && Number(cobro.saldoPendiente) > 0));
  const montoCobrado = Number(cobro.montoAbonado ?? cobro.montoPagado ?? cobro.montoRecibido ?? totalFinal);
  const saldoR = Number(cobro.saldoPendiente ?? cobro.saldoDeudaAntPendiente ?? 0);

  if (esAbono) {
    if (totalLabelEl) totalLabelEl.textContent = 'TOTAL ABONADO';
    if (stampTextEl) stampTextEl.textContent = 'ABONO REGISTRADO';
    if (abonoInfoEl) abonoInfoEl.style.display = 'block';
    if (abonoMontoEl) abonoMontoEl.textContent = `$${montoCobrado.toFixed(2)}`;
    if (saldoPendEl) saldoPendEl.textContent = `$${saldoR.toFixed(2)}`;
  } else {
    if (totalLabelEl) totalLabelEl.textContent = 'TOTAL A PAGAR';
    if (stampTextEl) stampTextEl.textContent = 'CANCELADO';
    if (abonoInfoEl) abonoInfoEl.style.display = 'none';
  }

  const cajeroEl = document.getElementById('reciboCajeroTxt');
  if (cajeroEl) {
    const cajeroNom = currentUser?.nombreCompleto || currentUser?.nombre_completo || currentUser?.nombre || currentUser?.username || 'Cajero Responsable';
    cajeroEl.textContent = cajeroNom;
  }

  const metodoEl = document.getElementById('reciboMetodoTxt');
  if (metodoEl) metodoEl.textContent = cobro.metodoPago || 'EFECTIVO';

  const stampFechaEl = document.getElementById('reciboStampFecha');
  if (stampFechaEl) {
    stampFechaEl.textContent = `${diaPago}-${mesPagoNombre.slice(0, 3).toUpperCase()}-${anioPagoStr}`;
  }

  const disclaimerEl = document.querySelector('.pishilata-disclaimer');
  if (disclaimerEl) {
    const notas = [];
    if (cobro.observaciones || cobro.observacion || cobro.nota) {
      notas.push(String(cobro.observaciones || cobro.observacion || cobro.nota));
    }
    const dCobrada = Number(cobro.deudaAnteriorCobrada || 0);
    if (dCobrada > 0) {
      if (cobro.esDeudaAntAbonada || (esAbono && saldoR > 0)) {
        notas.push(`📌 Deuda anterior abonada: $${dCobrada.toFixed(2)} USD (Saldo restante: $${saldoR.toFixed(2)} USD).`);
      } else {
        notas.push(`✓ Deuda anterior liquidada: $${dCobrada.toFixed(2)} USD (Saldo pendiente: $0.00 USD).`);
      }
    }
    if (cobro.multaExtra && Number(cobro.multaExtra) > 0) {
      notas.push(`Multas: $${Number(cobro.multaExtra).toFixed(2)} USD.`);
    }
    if (cobro.deudaAlcantarilladoCobrada && Number(cobro.deudaAlcantarilladoCobrada) > 0) {
      notas.push(`Alcantarillado: $${Number(cobro.deudaAlcantarilladoCobrada).toFixed(2)} USD.`);
    }
    if (esAbono && saldoR > 0 && dCobrada === 0) {
      notas.push(`⚠️ Abono registrado. Saldo pendiente: $${saldoR.toFixed(2)} USD.`);
    }

    if (notas.length > 0) {
      disclaimerEl.innerHTML = `Válido como comprobante de pago si tiene sello de cancelación.<br><span style="color: #0284c7; font-size: 0.74rem; font-weight: 700;">${notas.join(' ')}</span>`;
    } else {
      disclaimerEl.textContent = 'Válido como comprobante de pago si tiene sello de cancelación.';
    }
  }

  // Botón de eliminación en el modal (EXCLUSIVO ADMIN)
  const btnDelModal = document.getElementById('btnDeleteFacturaModal');
  if (btnDelModal) {
    if (currentUser?.rol === 'ADMIN') {
      btnDelModal.style.display = 'inline-flex';
      btnDelModal.onclick = () => confirmDeleteFactura(cobro);
    } else {
      btnDelModal.style.display = 'none';
      btnDelModal.onclick = null;
    }
  }

  modal.style.display = 'flex';
}

async function confirmDeleteFactura(cobro) {
  if (currentUser?.rol !== 'ADMIN') {
    Swal.fire({
      icon: 'error',
      title: 'Acceso Restringido',
      text: 'Solo el usuario con rol de ADMINISTRADOR puede eliminar o anular facturas. El rol de Cajero no tiene autorización para realizar eliminaciones.'
    });
    return;
  }

  const confirm = await Swal.fire({
    icon: 'warning',
    title: `¿Eliminar Factura #${cobro.numeroRecibo}?`,
    html: `
      <div style="text-align: left; font-size: 0.92rem; color: #334155; line-height: 1.5;">
        <p style="margin-bottom: 0.6rem;">Esta acción eliminará el comprobante <strong>#${cobro.numeroRecibo}</strong> de <strong>${cobro.socioNombre}</strong> por <strong>$${cobro.montoTotal.toFixed(2)} USD</strong> y realizará las siguientes reversiones automáticas:</p>
        <ul style="padding-left: 1.2rem; margin-bottom: 0.8rem;">
          <li><strong>Reversión Contable:</strong> Se cancelarán todos los asientos en el Libro Mayor (3 Columnas), restaurando los fondos de <em>Operación</em>, <em>Parroquia</em>, <em>Lector</em>, <em>Mortuorio</em>, etc.</li>
          <li><strong>Restablecimiento de Deuda:</strong> El socio volverá a su estado en mora con su saldo pendiente por pagar.</li>
          <li><strong>Multas:</strong> Las multas cobradas volverán a estar impagas en el sistema.</li>
        </ul>
        <p style="color: #b91c1c; font-weight: 700; margin: 0;">⚠️ Esta acción es irreversible.</p>
      </div>
    `,
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    cancelButtonColor: '#64748b',
    confirmButtonText: '🗑️ Sí, Eliminar y Revertir Fondos',
    cancelButtonText: 'Cancelar'
  });

  if (!confirm.isConfirmed) return;

  Swal.fire({
    title: 'Revirtiendo y eliminando factura...',
    text: 'Ajustando libro mayor y cuentas de socios...',
    allowOutsideClick: false,
    didOpen: () => {
      Swal.showLoading();
    }
  });

  try {
    const targetId = cobro.id;
    const targetNum = cobro.numeroRecibo || cobro.numeroFactura || cobro.numero_factura;
    const socioId = cobro.socioId || cobro.idSocio;
    const multasIds = Array.isArray(cobro.multasCobradasIds) ? cobro.multasCobradasIds : [];

    // 1. Llamar al endpoint oficial del backend DELETE /api/v1/facturas/:id
    // El servidor ejecuta de forma atómica la reversión contable, multas y eliminación de la factura
    let apiDeleteSuccess = false;
    try {
      const primaryTarget = targetId || targetNum;
      if (primaryTarget) {
        const resDel = await apiFetch(`/api/v1/facturas/${encodeURIComponent(primaryTarget)}`, { method: 'DELETE' });
        if (resDel && (resDel.success || resDel.ok)) {
          apiDeleteSuccess = true;
        }
      }
    } catch (apiErr) {
      console.warn('[Caja] API delete backend aviso:', apiErr.message);
    }

    // 2. Fallback solo si estamos offline (sin servidor backend activo)
    if (!apiDeleteSuccess && window.syncEngine?.deleteFacturaSupabase) {
      try {
        if (targetId) await window.syncEngine.deleteFacturaSupabase(targetId);
        else if (targetNum) await window.syncEngine.deleteFacturaSupabase(targetNum);
      } catch (syncErr) {
        console.warn('[Caja] SyncEngine delete aviso:', syncErr.message);
      }
    }

    // 3. Revertir multas en memoria y en IndexedDB
    if (Array.isArray(allLoadedMultas)) {
      allLoadedMultas.forEach((m) => {
        const isMatchSocio = !socioId || m.idSocio === socioId || m.id_socio === socioId;
        if (isMatchSocio && (multasIds.includes(m.id) || multasIds.length === 0 || m.idFactura === targetId || m.idFactura === targetNum)) {
          m.pagado = false;
          m.idFactura = null;
        }
      });
    }

    if (Array.isArray(cachedSocios)) {
      const cachedS = cachedSocios.find((s) => s.id === socioId || s.codigoSocio === cobro.codigoSocio);
      if (cachedS && Array.isArray(cachedS.multas)) {
        cachedS.multas.forEach((m) => {
          if (multasIds.includes(m.id) || multasIds.length === 0 || m.idFactura === targetId || m.idFactura === targetNum) {
            m.pagado = false;
          }
        });
      }
    }

    if (db && db.objectStoreNames.contains('multas_rubros')) {
      try {
        const txM = db.transaction(['multas_rubros'], 'readwrite');
        const mStore = txM.objectStore('multas_rubros');
        const reqM = mStore.getAll();
        reqM.onsuccess = () => {
          const allM = reqM.result || [];
          allM.forEach((m) => {
            const isMatch =
              (m.idSocio === socioId || m.id_socio === socioId) &&
              (multasIds.includes(m.id) || m.idFactura === targetId || m.idFactura === targetNum || (multasIds.length === 0 && m.pagado));
            if (isMatch) {
              m.pagado = false;
              delete m.idFactura;
              delete m.fechaPago;
              mStore.put(m);
            }
          });
        };
      } catch (eM) {
        console.warn('[Caja] Error revirtiendo multas en IndexedDB:', eM);
      }
    }

    // 4. Eliminar de IndexedDB local (cobros y sync_queue)
    if (db) {
      try {
        const txCob = db.transaction(['cobros'], 'readwrite');
        const cStore = txCob.objectStore('cobros');
        if (targetId) cStore.delete(targetId);
        const reqCob = cStore.getAll();
        reqCob.onsuccess = () => {
          const allC = reqCob.result || [];
          allC.forEach((item) => {
            const itemNum = item.numeroRecibo || item.numeroFactura || item.numero_factura;
            if (item.id === targetId || (targetNum && itemNum === targetNum)) {
              cStore.delete(item.id);
            }
          });
        };
      } catch (eC) {
        console.warn('[Caja] Error borrando cobro de IndexedDB:', eC);
      }

      try {
        if (db.objectStoreNames.contains('sync_queue')) {
          const txSync = db.transaction(['sync_queue'], 'readwrite');
          const sStore = txSync.objectStore('sync_queue');
          const reqSync = sStore.getAll();
          reqSync.onsuccess = () => {
            (reqSync.result || []).forEach((s) => {
              if (s.entityId === targetId || (targetNum && s.entityId === targetNum)) {
                sStore.delete(s.id);
              }
            });
          };
        }
      } catch (_e) {}
    }

    // 5. Purgar de memoria inmediata allLoadedCobros
    allLoadedCobros = (allLoadedCobros || []).filter((c) => {
      const cId = String(c.id || '').toLowerCase();
      const cNum = String(c.numeroRecibo || c.numeroFactura || c.numero_factura || '').trim().toUpperCase();
      const isMatchId = targetId && cId === String(targetId).toLowerCase();
      const isMatchNum = targetNum && cNum === String(targetNum).trim().toUpperCase();
      return !isMatchId && !isMatchNum;
    });

    // 6. Cerrar modal de recibo si estaba abierto
    const modalRecibo = document.getElementById('modalReciboPrint');
    if (modalRecibo) modalRecibo.style.display = 'none';

    // 7. Refrescar datos en vivo de la vista de caja y cuentas corrientes
    actualizarCuentasCorrientesSocios();
    await updateMetricsAndHistory();

    if (selectedSocio && (selectedSocio.id === socioId || selectedSocio.codigoSocio === cobro.codigoSocio)) {
      await displaySocioPlanilla(selectedSocio);
    }

    Swal.fire({
      icon: 'success',
      title: '¡Factura Eliminada y Fondos Revertidos!',
      text: `La factura #${cobro.numeroRecibo} fue eliminada, los fondos fueron revertidos y la deuda del socio fue restaurada.`
    });
  } catch (err) {
    console.error('[Caja] Error eliminando factura:', err);
    Swal.fire({
      icon: 'error',
      title: 'Error al Eliminar Factura',
      text: err.message || 'No se pudo eliminar la factura en el servidor.'
    });
  }
}

document.getElementById('btnCloseReciboModal')?.addEventListener('click', () => {
  const m = document.getElementById('modalReciboPrint');
  if (m) m.style.display = 'none';
});

document.getElementById('btnDoneRecibo')?.addEventListener('click', () => {
  const m = document.getElementById('modalReciboPrint');
  if (m) m.style.display = 'none';
});

document.getElementById('btnPrintReciboBtn')?.addEventListener('click', () => {
  window.print();
});

// Filtros y Búsqueda de Recibos
document.getElementById('tabRecibosHoy')?.addEventListener('click', () => {
  setRecibosFilter('HOY');
});

document.getElementById('tabRecibosTodos')?.addEventListener('click', () => {
  setRecibosFilter('TODOS');
});

document.getElementById('inputBuscarReciboTabla')?.addEventListener('input', (e) => {
  currentRecibosSearch = (e.target.value || '').toLowerCase().trim();
  renderRecibosTable();
});

// Modal Cuadre Diario de Recibos Emitidos Hoy
function showCuadreDiarioModal() {
  const modal = document.getElementById('modalCuadreDiarioPrint');
  if (!modal) return;

  const cobrosHoy = allLoadedCobros.filter((c) => isFechaHoy(c.fechaPago || c.createdAt));
  const hoy = new Date();
  const fechaTexto = hoy.toLocaleDateString('es-EC', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const fechaEl = document.getElementById('cuadreFechaTxt');
  if (fechaEl) fechaEl.textContent = fechaTexto.charAt(0).toUpperCase() + fechaTexto.slice(1);

  const cajeroNom = (currentUser && (currentUser.nombreCompleto || currentUser.nombre_completo || currentUser.nombre))
    ? (currentUser.nombreCompleto || currentUser.nombre_completo || currentUser.nombre)
    : 'Cajero Responsable';
  const cajeroEl = document.getElementById('cuadreCajeroTxt');
  if (cajeroEl) cajeroEl.textContent = cajeroNom;

  const firmaEl = document.getElementById('cuadreFirmaCajero');
  if (firmaEl) firmaEl.textContent = cajeroNom;

  const totalRecibosEl = document.getElementById('cuadreTotalRecibosTxt');
  if (totalRecibosEl) totalRecibosEl.textContent = String(cobrosHoy.length);

  let totalRecaudado = 0;
  const tbody = document.getElementById('cuadreTableBody');
  if (tbody) {
    tbody.innerHTML = '';
    if (cobrosHoy.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2rem; color: #64748b;">
            No se han registrado cobros ni emitido recibos en la jornada de hoy.
          </td>
        </tr>
      `;
    } else {
      cobrosHoy.forEach((c) => {
        const pagado = c.montoPagado !== undefined ? c.montoPagado : (c.montoAbonado !== undefined ? c.montoAbonado : c.montoTotal);
        const montoNum = Number(pagado || 0);
        totalRecaudado += montoNum;

        const dObj = new Date(c.fechaPago || c.createdAt || Date.now());
        const horaStr = !isNaN(dObj.getTime())
          ? dObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '--:--';

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-weight: 700; font-family: monospace; color: #0284c7;">
            ${c.numeroRecibo || c.numeroFactura || c.id}
          </td>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-size: 0.8rem; color: #64748b;">
            ${horaStr}
          </td>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-weight: 600;">
            ${c.socioNombre || c.nombreCompleto || 'Abonado'}
          </td>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-size: 0.8rem;">
            ${c.socioCedula || c.codigoSocio || '-'}
          </td>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-size: 0.8rem;">
            ${c.medidorNumero || '-'}
          </td>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center; font-size: 0.78rem; font-weight: 600;">
            ${c.metodoPago || 'EFECTIVO'}
          </td>
          <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: 800; color: #0f172a;">
            $${montoNum.toFixed(2)}
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  const totalRecaudadoEl = document.getElementById('cuadreTotalRecaudadoTxt');
  if (totalRecaudadoEl) totalRecaudadoEl.textContent = `$${totalRecaudado.toFixed(2)} USD`;

  const footerTotalEl = document.getElementById('cuadreFooterTotal');
  if (footerTotalEl) footerTotalEl.textContent = `$${totalRecaudado.toFixed(2)}`;

  modal.style.display = 'flex';
}

document.getElementById('btnPrintCuadreHoy')?.addEventListener('click', showCuadreDiarioModal);

document.getElementById('btnCloseCuadreModal')?.addEventListener('click', () => {
  const m = document.getElementById('modalCuadreDiarioPrint');
  if (m) m.style.display = 'none';
});

document.getElementById('btnCloseCuadreModalBtn')?.addEventListener('click', () => {
  const m = document.getElementById('modalCuadreDiarioPrint');
  if (m) m.style.display = 'none';
});

document.getElementById('btnPrintCuadreModalBtn')?.addEventListener('click', () => {
  window.print();
});

// Modal Gasto / Egreso
const modalGasto = document.getElementById('modalGasto');
document.getElementById('btnOpenGastoModal')?.addEventListener('click', () => {
  modalGasto.style.display = 'flex';
});

document.getElementById('btnCloseGastoModal')?.addEventListener('click', () => {
  modalGasto.style.display = 'none';
});

document.getElementById('btnCancelGasto')?.addEventListener('click', () => {
  modalGasto.style.display = 'none';
});

document.getElementById('formGasto')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const selectCat = document.getElementById('selectCategoriaGasto');
  const categoria = selectCat ? selectCat.value : 'OTROS';
  const inputMonto = document.getElementById('inputMontoGasto');
  const monto = parseFloat(inputMonto?.value || '0');
  const inputDesc = document.getElementById('inputDescGasto');
  const descripcion = inputDesc ? inputDesc.value.trim() : '';
  const inputComp = document.getElementById('inputComprobanteGasto');
  const comprobante = inputComp ? inputComp.value.trim() : '';

  if (isNaN(monto) || monto <= 0 || !descripcion) {
    Swal.fire({ icon: 'warning', title: 'Datos Incompletos', text: 'Ingrese un monto y detalle válidos.' });
    return;
  }

  const movimientoRecord = {
    id: 'egr-' + crypto.randomUUID(),
    tipo: 'EGRESO',
    categoria,
    monto,
    descripcion,
    comprobante,
    fecha: new Date().toISOString()
  };

  const isWebView = typeof window !== 'undefined' && (
    window.location.origin.includes('appassets.androidplatform.net') || 
    window.location.protocol === 'file:'
  );

  if (!isWebView) {
    // Modo PWA Escritorio: Registrar directamente en el Backend API
    try {
      await apiFetch('/api/v1/fondos/egresos', {
        method: 'POST',
        body: JSON.stringify({
          idFondo: '22222222-2222-2222-2222-222222220002',
          concepto: descripcion,
          descripcion,
          monto,
          numeroComprobante: comprobante || undefined,
          beneficiario: 'Proveedor General'
        })
      });
    } catch (err) {
      console.error('[Caja] Error registrando egreso en backend:', err);
      Swal.fire({
        icon: 'error',
        title: 'Error al Registrar Egreso',
        text: err.message || 'No se pudo registrar el egreso en el servidor.'
      });
      return;
    }
  } else {
    // Modo móvil lector en campo
    if (db) {
      try {
        const tx = db.transaction(['movimientos_caja'], 'readwrite');
        tx.objectStore('movimientos_caja').add(movimientoRecord);
      } catch (e) {}
    }
    await syncEngine.enqueueMutation('movimientos_caja', movimientoRecord.id, 'CREATE', movimientoRecord);
  }

  modalGasto.style.display = 'none';
  const formGasto = document.getElementById('formGasto');
  if (formGasto) formGasto.reset();

  await updateMetricsAndHistory();

  Swal.fire({
    icon: 'success',
    title: 'Egreso Registrado',
    text: `Se registró la salida de $${monto.toFixed(2)} USD correctamente en el Libro Mayor.`
  });
});

function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return 0;
  const hoy = new Date();
  const nac = new Date(fechaNacimiento);
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) {
    edad--;
  }
  return edad;
}

// Auto-limpieza de bases de datos locales obsoletas (IndexedDB)
if (typeof window !== 'undefined' && window.indexedDB) {
  try {
    window.indexedDB.deleteDatabase('app_agua_db');
    window.indexedDB.deleteDatabase('siga_comunitario_db');
    window.indexedDB.deleteDatabase('sigalector_db');
  } catch (_e) {}
}

// Inicializar Módulo Caja
renderCajaUI();

function handleSocioUpdatedEvent(socioId, socioData) {
  if (!socioId || !socioData) return;
  const s = cachedSocios.find((x) => x.id === socioId);
  const newFullName = socioData.nombreCompleto || `${socioData.nombres || ''} ${socioData.apellidos || ''}`.trim();
  if (s) {
    if (socioData.nombres) s.nombres = socioData.nombres;
    if (socioData.apellidos) s.apellidos = socioData.apellidos;
    if (newFullName) s.nombreCompleto = newFullName;
    if (socioData.cedulaRuc) s.cedulaRuc = socioData.cedulaRuc;
    if (socioData.idSector) s.sectorId = socioData.idSector;
    if (socioData.nombreSector) s.nombreSector = socioData.nombreSector;
    if (socioData.direccion !== undefined) s.direccion = socioData.direccion;
    if (socioData.telefono !== undefined) s.telefono = socioData.telefono;
    if (socioData.medidorNumero) s.medidorNumero = socioData.medidorNumero;
    if (socioData.tieneAlcantarillado !== undefined) s.tieneAlcantarillado = socioData.tieneAlcantarillado;
    if (socioData.medidores && socioData.medidores.length > 0) s.medidores = socioData.medidores;
  }
  populateSocioSelect(cachedSocios);

  if (selectedSocio && selectedSocio.id === socioId) {
    if (newFullName) {
      selectedSocio.nombreCompleto = newFullName;
      const elNombre = document.getElementById('posSocioNombre');
      if (elNombre) elNombre.textContent = newFullName;
    }
    if (socioData.cedulaRuc) {
      selectedSocio.cedulaRuc = socioData.cedulaRuc;
      const elCed = document.getElementById('posSocioCedula');
      if (elCed) elCed.textContent = socioData.cedulaRuc;
    }
  }
}

if (typeof BroadcastChannel !== 'undefined') {
  try {
    const rxBc = new BroadcastChannel('siga_sync_channel');
    rxBc.onmessage = (ev) => {
      if (ev.data?.type === 'SOCIO_UPDATED' && ev.data?.id) {
        handleSocioUpdatedEvent(ev.data.id, ev.data.socio || {});
      }
    };
  } catch (e) {}
}

window.addEventListener('storage', (e) => {
  if (e.key === 'siga_last_socio_update') {
    try {
      const data = JSON.parse(e.newValue || '{}');
      if (data.id) {
        handleSocioUpdatedEvent(data.id, data.socio || data);
      }
    } catch (err) {}
  }
});
