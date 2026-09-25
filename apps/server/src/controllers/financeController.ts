import crypto from 'node:crypto';
import type { Response } from '../core/http.ts';
import { supabaseClient } from '../db/supabase.ts';
import type { AuthenticatedRequest } from '../middlewares/auth.ts';
import { getCurrentTarifas } from './adminController.ts';

export const FONDO_IDS = {
  PADRE_PARROQUIA: '22222222-2222-2222-2222-222222220001',
  OPERACION_MANT: '22222222-2222-2222-2222-222222220002',
  PAGO_LECTOR: '22222222-2222-2222-2222-222222220003',
  MORTUORIO: '22222222-2222-2222-2222-222222220004',
  PRO_MEJORAS: '22222222-2222-2222-2222-222222220005',
  MULTAS_EXTRAS: '22222222-2222-2222-2222-222222220006',
  ALCANTARILLADO: '22222222-2222-2222-2222-222222220007'
};

export const DEFAULT_FONDOS = [
  {
    id: FONDO_IDS.PADRE_PARROQUIA,
    codigo: 'PADRE_PARROQUIA',
    nombre: 'Fondo Parroquial (Entrega al Padre)',
    descripcion: '$2.00 por cuota base normal pagada'
  },
  {
    id: FONDO_IDS.OPERACION_MANT,
    codigo: 'OPERACION_MANT',
    nombre: 'Fondo Operación y Mantenimiento',
    descripcion: 'Cuota de $4.00 base (+ deuda anterior) para operación y mantenimiento general'
  },
  {
    id: FONDO_IDS.PAGO_LECTOR,
    codigo: 'PAGO_LECTOR',
    nombre: 'Fondo Pago a Lectores',
    descripcion: '$0.50 mensual por toma de micromedición'
  },
  {
    id: FONDO_IDS.MORTUORIO,
    codigo: 'MORTUORIO',
    nombre: 'Fondo Mortuorio Solidario',
    descripcion: '$0.50 de auxilio funerario comunitario'
  },
  {
    id: FONDO_IDS.PRO_MEJORAS,
    codigo: 'PRO_MEJORAS',
    nombre: 'Fondo Pro-Mejoras e Infraestructura',
    descripcion: '100% de recaudación por excedentes de consumo para obras de infraestructura'
  },
  {
    id: FONDO_IDS.MULTAS_EXTRAS,
    codigo: 'MULTAS_EXTRAS',
    nombre: 'Fondo Multas y Mingas',
    descripcion: 'Recaudaciones por inasistencias a mingas, asambleas y reconexiones'
  },
  {
    id: FONDO_IDS.ALCANTARILLADO,
    codigo: 'ALCANTARILLADO',
    nombre: 'Fondo Alcantarillado Comunitario',
    descripcion: '$1.00 mensual por servicio de red de saneamiento'
  }
];

export interface FundDistribution {
  PADRE_PARROQUIA: number;
  OPERACION_MANT: number;
  PAGO_LECTOR: number;
  MORTUORIO: number;
  PRO_MEJORAS: number;
  MULTAS_EXTRAS: number;
  ALCANTARILLADO: number;
}

export function isPeriodoCorte(periodoCodigo?: string): boolean {
  if (!periodoCodigo) return false;
  const clean = String(periodoCodigo).trim();
  // Cualquier periodo 2026-07 o anterior es corte contable inicial
  return clean <= '2026-07' || clean.includes('2026-07') || clean.toUpperCase().includes('JUL');
}

export function calculateFacturaFundDistribution(
  factura: Record<string, any>,
  customBases?: { operacion?: number; padre?: number; lector?: number; mortuorio?: number; seniorOperacion?: number }
): FundDistribution {
  const pCod = String(factura.periodo_codigo || factura.periodoCodigo || '').trim();
  const totPagar = Number(factura.total_pagar ?? factura.totalPagar ?? factura.total_mes ?? factura.totalMes ?? 0);

  // Si la factura corresponde al corte contable inicial (Julio 2026 o anterior),
  // por acuerdo expreso de la junta administrativa, el 100% de la recaudación va a Operación y Mantenimiento
  if (pCod && isPeriodoCorte(pCod)) {
    return {
      PADRE_PARROQUIA: 0,
      OPERACION_MANT: Number(totPagar.toFixed(2)),
      PAGO_LECTOR: 0,
      MORTUORIO: 0,
      PRO_MEJORAS: 0,
      MULTAS_EXTRAS: 0,
      ALCANTARILLADO: 0
    };
  }

  const current = typeof getCurrentTarifas === 'function' ? getCurrentTarifas() : null;
  const bOperacion = customBases?.operacion ?? current?.repartoNormalOperacion ?? 4.0;
  const bPadre = customBases?.padre ?? current?.repartoNormalPadre ?? 2.0;
  const bLector = customBases?.lector ?? current?.repartoNormalLector ?? 0.5;
  const bMortuorio = customBases?.mortuorio ?? current?.repartoNormalMortuorio ?? 0.5;
  const seniorOperacion = customBases?.seniorOperacion ?? 2.0;

  const esTerceraEdad = Boolean(factura.es_tercera_edad ?? factura.esTerceraEdad ?? false);
  const vExc = Number(factura.valor_excedente ?? factura.valorExcedente ?? 0);
  const vAlc = Number(factura.valor_alcantarillado ?? factura.valorAlcantarillado ?? 0);
  const vMul = Number(factura.valor_multas ?? factura.valorMultas ?? 0);
  const totalMes = Number(factura.total_mes ?? factura.totalMes ?? 0);

  let vBase = Number(factura.valor_base ?? factura.valorBase ?? 0);
  if (totalMes === 0 && totPagar <= vMul) {
    vBase = 0;
  }

  const dist: FundDistribution = {
    PADRE_PARROQUIA: 0,
    OPERACION_MANT: 0, // No absorbe deudas anteriores a ciegas
    PAGO_LECTOR: 0,
    MORTUORIO: 0,
    PRO_MEJORAS: vExc,
    MULTAS_EXTRAS: vMul,
    ALCANTARILLADO: vAlc
  };

  if (vBase > 0) {
    if (esTerceraEdad) {
      // Tercera Edad (Base $5.00):
      // $2.00 al padre, $0.50 al lector, $0.50 al mortuorio y $2.00 a operación y mantenimiento
      dist.PADRE_PARROQUIA += Math.min(vBase, bPadre);
      let rem = Math.max(0, vBase - bPadre);
      dist.OPERACION_MANT += Math.min(rem, seniorOperacion);
      rem = Math.max(0, rem - seniorOperacion);
      dist.PAGO_LECTOR += Math.min(rem, bLector);
      rem = Math.max(0, rem - bLector);
      dist.MORTUORIO += Math.min(rem, bMortuorio);
      rem = Math.max(0, rem - bMortuorio);
      dist.PRO_MEJORAS += rem;
    } else {
      // Normal (Base $7.00):
      // $4.00 a operación, $2.00 al padre, $0.50 al lector, $0.50 al mortuorio
      const normalReq = bOperacion + bPadre + bLector + bMortuorio;
      if (vBase >= normalReq) {
        dist.PADRE_PARROQUIA += bPadre;
        dist.OPERACION_MANT += bOperacion;
        dist.PAGO_LECTOR += bLector;
        dist.MORTUORIO += bMortuorio;
        dist.PRO_MEJORAS += (vBase - normalReq);
      } else {
        dist.OPERACION_MANT += Math.min(vBase, bOperacion);
        let rem = Math.max(0, vBase - bOperacion);
        dist.PADRE_PARROQUIA += Math.min(rem, bPadre);
        rem = Math.max(0, rem - bPadre);
        dist.PAGO_LECTOR += Math.min(rem, bLector);
        rem = Math.max(0, rem - bLector);
        dist.MORTUORIO += Math.min(rem, bMortuorio);
        rem = Math.max(0, rem - bMortuorio);
        dist.PRO_MEJORAS += rem;
      }
    }
  }

  for (const k of Object.keys(dist) as (keyof FundDistribution)[]) {
    dist[k] = Number(dist[k].toFixed(2));
  }

  return dist;
}

/**
 * Calcula la distribución exacta hacia los fondos para un abono parcial o total
 * sobre una factura específica, respetando la regla de corte para periodos <= 2026-07
 * y la prelación de servicios para periodos >= 2026-08.
 */
export function calculateAbonoFundDistribution(
  factura: Record<string, any>,
  montoAbonado: number,
  periodoCodigo?: string
): FundDistribution {
  const pCod = String(periodoCodigo || factura.periodo_codigo || factura.periodoCodigo || '').trim();
  const abono = Math.max(0, Number(montoAbonado || 0));

  if (abono <= 0) {
    return {
      PADRE_PARROQUIA: 0,
      OPERACION_MANT: 0,
      PAGO_LECTOR: 0,
      MORTUORIO: 0,
      PRO_MEJORAS: 0,
      MULTAS_EXTRAS: 0,
      ALCANTARILLADO: 0
    };
  }

  // Si es del corte inicial (Julio 2026 o anterior), todo el abono va a Operación
  if (pCod && isPeriodoCorte(pCod)) {
    return {
      PADRE_PARROQUIA: 0,
      OPERACION_MANT: Number(abono.toFixed(2)),
      PAGO_LECTOR: 0,
      MORTUORIO: 0,
      PRO_MEJORAS: 0,
      MULTAS_EXTRAS: 0,
      ALCANTARILLADO: 0
    };
  }

  // Para Agosto en adelante:
  // Si el abono cubre el total de la factura, distribuimos la totalidad
  const totalFactura = Number(factura.total_mes ?? factura.totalMes ?? factura.total_pagar ?? factura.totalPagar ?? 0);
  const distTotal = calculateFacturaFundDistribution(factura);

  if (abono >= totalFactura && totalFactura > 0) {
    return distTotal;
  }

  // Abono parcial: Aplicar cascada de prelación comunitaria:
  // 1. Padre ($2.00)
  // 2. Lector ($0.50)
  // 3. Mortuorio ($0.50)
  // 4. Operación y Mantenimiento ($4.00 o $2.00)
  // 5. Excedente (Pro-mejoras)
  // 6. Alcantarillado
  // 7. Multas
  let rem = abono;
  const distResult: FundDistribution = {
    PADRE_PARROQUIA: 0,
    OPERACION_MANT: 0,
    PAGO_LECTOR: 0,
    MORTUORIO: 0,
    PRO_MEJORAS: 0,
    MULTAS_EXTRAS: 0,
    ALCANTARILLADO: 0
  };

  const orden: (keyof FundDistribution)[] = [
    'PADRE_PARROQUIA',
    'PAGO_LECTOR',
    'MORTUORIO',
    'OPERACION_MANT',
    'PRO_MEJORAS',
    'ALCANTARILLADO',
    'MULTAS_EXTRAS'
  ];

  for (const fondo of orden) {
    if (rem <= 0) break;
    const reqFondo = distTotal[fondo] || 0;
    if (reqFondo > 0) {
      const asignado = Math.min(rem, reqFondo);
      distResult[fondo] = Number(asignado.toFixed(2));
      rem = Number((rem - asignado).toFixed(2));
    }
  }

  // Si sobrara cualquier fracción de redondeo, se añade a Operación
  if (rem > 0) {
    distResult.OPERACION_MANT = Number((distResult.OPERACION_MANT + rem).toFixed(2));
  }

  return distResult;
}

export const getFondosCatalogo = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [catRes, movRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_catalogo', 'activo=eq.true&order=codigo.asc'),
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_movimientos')
    ]);

    const catalogo = catRes.data && catRes.data.length > 0 ? catRes.data : DEFAULT_FONDOS;
    const movimientos = movRes.data || [];

    const enriched = catalogo.map((f) => {
      const fMovs = movimientos.filter((m) => m.id_fondo === f.id);
      const totalIngresos = Number(fMovs.reduce((acc, m) => acc + Number(m.ingreso || 0), 0).toFixed(2));
      const totalEgresos = Number(fMovs.reduce((acc, m) => acc + Number(m.egreso || 0), 0).toFixed(2));
      const saldo = Number((totalIngresos - totalEgresos).toFixed(2));

      return {
        id: f.id,
        idFondo: f.id,
        codigo: f.codigo,
        nombre: f.nombre,
        descripcion: f.descripcion,
        activo: f.activo !== false,
        totalIngresos,
        totalEgresos,
        saldo,
        movimientosCount: fMovs.length
      };
    });

    res.json({ data: enriched });
  } catch (error) {
    console.error('[FinanceController] Error obteniendo catálogo de fondos:', error);
    res.json({ data: DEFAULT_FONDOS });
  }
};

export const getFondoById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [catRes, movRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_catalogo', `id=eq.${id}&limit=1`),
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_movimientos', `id_fondo=eq.${id}&order=fecha.desc&limit=50`)
    ]);

    let fondo = catRes.data && catRes.data.length > 0 ? catRes.data[0] : null;
    if (!fondo) {
      fondo = DEFAULT_FONDOS.find((f) => f.id === id || f.codigo === id) || null;
    }

    if (!fondo) {
      res.status(404).json({ error: `Fondo con identificador ${id} no encontrado.` });
      return;
    }

    const movimientos = movRes.data || [];
    const totalIngresos = Number(movimientos.reduce((acc, m) => acc + Number(m.ingreso || 0), 0).toFixed(2));
    const totalEgresos = Number(movimientos.reduce((acc, m) => acc + Number(m.egreso || 0), 0).toFixed(2));
    const saldo = Number((totalIngresos - totalEgresos).toFixed(2));

    res.json({
      data: {
        ...fondo,
        idFondo: fondo.id,
        totalIngresos,
        totalEgresos,
        saldo,
        movimientos
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error obteniendo fondo.';
    res.status(500).json({ error: message });
  }
};

export const updateFondo = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const { nombre, descripcion, activo } = body;

    const updateData: Record<string, any> = {};
    if (nombre) updateData.nombre = String(nombre).trim();
    if (descripcion !== undefined) updateData.descripcion = String(descripcion).trim();
    if (activo !== undefined) updateData.activo = Boolean(activo);

    await supabaseClient.request(`fondos_catalogo?id=eq.${id}`, {
      method: 'PATCH',
      body: updateData
    });

    res.json({ message: 'Fondo actualizado correctamente.', data: { id, ...updateData } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error actualizando fondo.';
    res.status(400).json({ error: message });
  }
};

// ==========================================
// 2. BALANCE GENERAL CONSOLIDADO
// ==========================================

export const getBalanceFondosResumen = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [catRes, movRes, facRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_catalogo', 'activo=eq.true&order=codigo.asc'),
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_movimientos'),
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas', 'estado_pago=eq.PAGADO')
    ]);

    const catalogo = catRes.data && catRes.data.length > 0 ? catRes.data : DEFAULT_FONDOS;
    const movimientos = movRes.data || [];
    const facturasPagadas = facRes.data || [];

    // Total ingresos directamente de facturas pagadas en Supabase Cloud
    const totalIngresos = Number(
      facturasPagadas
        .reduce((acc, f) => {
          const tot = Number(f.total_pagar || 0);
          const monPag = Number(f.monto_pagado || 0);
          const valorReal = monPag > 0 ? monPag : tot;
          return acc + valorReal;
        }, 0)
        .toFixed(2)
    );

    // Total egresos directamente de fondos_movimientos en Supabase Cloud
    const totalEgresos = Number(
      movimientos
        .filter((m) => m.tipo === 'EGRESO')
        .reduce((acc, m) => acc + Number(m.egreso || 0), 0)
        .toFixed(2)
    );

    const balanceNeto = Number((totalIngresos - totalEgresos).toFixed(2));

    const isHoy = (fechaStr: unknown): boolean => {
      if (!fechaStr || typeof fechaStr !== 'string') return false;
      const d = new Date(fechaStr);
      if (isNaN(d.getTime())) return false;
      const hoy = new Date();
      return d.toISOString().split('T')[0] === hoy.toISOString().split('T')[0];
    };

    const totalRecaudadoHoy = Number(
      facturasPagadas
        .filter((f) => isHoy(f.fecha_pago || f.updated_at || f.created_at))
        .reduce((acc, f) => {
          const tot = Number(f.total_pagar || 0);
          const monPag = Number(f.monto_pagado || 0);
          const valorReal = monPag > 0 ? monPag : tot;
          return acc + valorReal;
        }, 0)
        .toFixed(2)
    );

    // Distribución exacta de ingresos de facturas pagadas por fondo
    const distribucionFacturas: Record<string, number> = {
      [FONDO_IDS.PADRE_PARROQUIA]: 0,
      [FONDO_IDS.OPERACION_MANT]: 0,
      [FONDO_IDS.PAGO_LECTOR]: 0,
      [FONDO_IDS.MORTUORIO]: 0,
      [FONDO_IDS.PRO_MEJORAS]: 0,
      [FONDO_IDS.MULTAS_EXTRAS]: 0,
      [FONDO_IDS.ALCANTARILLADO]: 0
    };

    facturasPagadas.forEach((f) => {
      const d = calculateFacturaFundDistribution(f);
      distribucionFacturas[FONDO_IDS.PADRE_PARROQUIA] += d.PADRE_PARROQUIA;
      distribucionFacturas[FONDO_IDS.OPERACION_MANT] += d.OPERACION_MANT;
      distribucionFacturas[FONDO_IDS.PAGO_LECTOR] += d.PAGO_LECTOR;
      distribucionFacturas[FONDO_IDS.MORTUORIO] += d.MORTUORIO;
      distribucionFacturas[FONDO_IDS.PRO_MEJORAS] += d.PRO_MEJORAS;
      distribucionFacturas[FONDO_IDS.MULTAS_EXTRAS] += d.MULTAS_EXTRAS;
      distribucionFacturas[FONDO_IDS.ALCANTARILLADO] += d.ALCANTARILLADO;
    });

    const resumenFondos = catalogo.map((f) => {
      const fMovs = movimientos.filter((m) => m.id_fondo === f.id);
      const fEgresos = fMovs
        .filter((m) => m.tipo === 'EGRESO')
        .reduce((acc, m) => acc + Number(m.egreso || 0), 0);

      // Ingresos contables procedentes de movimientos manuales
      const fIngresosManuales = fMovs
        .filter((m) => m.tipo === 'INGRESO' && !m.id_factura)
        .reduce((acc, m) => acc + Number(m.ingreso || 0), 0);

      const fIngresosFacturas = distribucionFacturas[f.id as string] || 0;
      const totalFondoIngresos = Number((fIngresosFacturas + fIngresosManuales).toFixed(2));
      const saldo = Number((totalFondoIngresos - fEgresos).toFixed(2));

      return {
        id: f.id,
        idFondo: f.id,
        codigo: f.codigo,
        nombre: f.nombre,
        descripcion: f.descripcion,
        totalIngresos: totalFondoIngresos,
        totalEgresos: Number(fEgresos.toFixed(2)),
        saldo,
        movimientosCount: fMovs.length
      };
    });

    res.json({
      data: {
        totalIngresos,
        totalEgresos,
        balanceNeto,
        totalRecaudadoHoy,
        recibosCount: facturasPagadas.length,
        resumenFondos,
        saldoTotalSistema: balanceNeto,
        totalFondos: resumenFondos.length
      }
    });
  } catch (error) {
    console.error('[FinanceController] Error obteniendo balance general:', error);
    res.status(500).json({ error: 'Error obteniendo balance de fondos.' });
  }
};

// ==========================================
// 3. LIBRO MAYOR (3 COLUMNAS: INGRESOS, EGRESOS, SALDO)
// ==========================================

export const getLibroMayor3Columnas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // Sincronización transparente y automática de facturas pagadas que no tengan asiento aún
    await autoSincronizarAsientosFacturas();

    const { idFondo, tipo, fechaDesde, fechaHasta, q } = req.query as {
      idFondo?: string;
      tipo?: string;
      fechaDesde?: string;
      fechaHasta?: string;
      q?: string;
    };

    let query = 'order=fecha.desc,created_at.desc&limit=500';
    if (idFondo) {
      const fondoMatch = DEFAULT_FONDOS.find((f) => f.id === idFondo || f.codigo === idFondo || (idFondo === 'PADRE' && f.codigo === 'PADRE_PARROQUIA'));
      const targetId = fondoMatch ? fondoMatch.id : idFondo;
      query += `&id_fondo=eq.${targetId}`;
    }
    if (tipo) query += `&tipo=eq.${encodeURIComponent(tipo)}`;
    if (fechaDesde) query += `&fecha=gte.${encodeURIComponent(fechaDesde)}`;
    if (fechaHasta) query += `&fecha=lte.${encodeURIComponent(fechaHasta)}`;

    const [resData, catRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_movimientos', query),
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_catalogo')
    ]);

    const catalogo = catRes.data && catRes.data.length > 0 ? catRes.data : DEFAULT_FONDOS;
    const catMap = new Map<string, any>(catalogo.map((f) => [f.id as string, f]));

    let rows = (resData.data || []).map((m) => {
      const f = catMap.get(m.id_fondo as string) || DEFAULT_FONDOS.find((df) => df.id === m.id_fondo);
      return {
        id: m.id,
        idFondo: m.id_fondo,
        id_fondo: m.id_fondo,
        codigoFondo: f?.codigo || '',
        codigo_fondo: f?.codigo || '',
        nombreFondo: f?.nombre || 'Fondo Comunitario',
        nombre_fondo: f?.nombre || 'Fondo Comunitario',
        fecha: m.fecha,
        fechaMovimiento: m.fecha,
        concepto: m.concepto,
        tipo: m.tipo,
        tipoMovimiento: m.tipo,
        ingreso: Number(m.ingreso || 0),
        egreso: Number(m.egreso || 0),
        saldo: Number(m.saldo || 0),
        saldoResultante: Number(m.saldo || 0),
        idFactura: m.id_factura || null,
        id_factura: m.id_factura || null,
        numeroComprobante: m.numero_comprobante || '',
        numero_comprobante: m.numero_comprobante || '',
        idResponsable: m.id_responsable || '',
        beneficiario: m.beneficiario || '',
        createdAt: m.created_at,
        created_at: m.created_at
      };
    });

    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          String(r.concepto || '').toLowerCase().includes(term) ||
          String(r.numeroComprobante || '').toLowerCase().includes(term) ||
          String(r.beneficiario || '').toLowerCase().includes(term) ||
          String(r.nombreFondo || '').toLowerCase().includes(term)
      );
    }

    res.json({
      descripcion: 'Libro Mayor de 3 Columnas: Ingresos (+), Egresos (-), Saldo Acumulado (=)',
      data: rows,
      total: rows.length
    });
  } catch (error) {
    console.error('[FinanceController] Error obteniendo Libro Mayor:', error);
    res.status(500).json({ error: 'Error obteniendo Libro Mayor de fondos.' });
  }
};

export const getMovimientoById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const resData = await supabaseClient.fetchRecords<Record<string, unknown>>('fondos_movimientos', `id=eq.${id}&limit=1`);
    if (!resData.data || resData.data.length === 0) {
      res.status(404).json({ error: `Movimiento ${id} no encontrado.` });
      return;
    }
    const m = resData.data[0];
    res.json({ data: m });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error obteniendo movimiento.';
    res.status(500).json({ error: message });
  }
};

export const registrarEgreso = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const body = req.body || {};
    let idFondo = (body.idFondo || body.id_fondo) as string;
    const concepto = (body.concepto || body.descripcion) as string;
    const monto = Number(body.monto || body.egreso || 0);
    const numeroComprobante = body.numeroComprobante || body.comprobante || body.numero_comprobante;
    const beneficiario = body.beneficiario;
    const fecha = body.fecha;

    const matchFondo = DEFAULT_FONDOS.find((f) => f.id === idFondo || f.codigo === idFondo || (idFondo === 'PADRE' && f.codigo === 'PADRE_PARROQUIA'));
    if (matchFondo) {
      idFondo = matchFondo.id;
    }

    if (!idFondo || !concepto || monto <= 0) {
      res.status(400).json({ error: 'idFondo, concepto y un monto mayor a 0 son obligatorios.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const respId = req.user?.id && uuidRegex.test(req.user.id) ? req.user.id : '00000000-0000-0000-0000-000000000002';

    const fondoMovs = await supabaseClient.fetchRecords<Record<string, unknown>>('fondos_movimientos', `id_fondo=eq.${idFondo}`);
    const ingresosPrev = (fondoMovs.data || []).reduce((acc, m) => acc + Number(m.ingreso || 0), 0);
    const egresosPrev = (fondoMovs.data || []).reduce((acc, m) => acc + Number(m.egreso || 0), 0);
    const nuevoSaldo = Number((ingresosPrev - (egresosPrev + monto)).toFixed(2));

    const record = {
      id,
      id_fondo: idFondo,
      fecha: fecha || now,
      concepto: String(concepto).trim(),
      tipo: 'EGRESO',
      ingreso: 0.0,
      egreso: monto,
      saldo: nuevoSaldo,
      numero_comprobante: numeroComprobante ? String(numeroComprobante).trim() : `EGR-${Date.now().toString().slice(-6)}`,
      id_responsable: respId,
      beneficiario: beneficiario ? String(beneficiario).trim() : null,
      created_at: now
    };

    await supabaseClient.syncRecord('fondos_movimientos', record);

    res.status(201).json({
      message: 'Egreso registrado correctamente en el Libro Mayor de Supabase.',
      data: record
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error registrando egreso.';
    res.status(400).json({ error: message });
  }
};

export const updateMovimiento = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  res.status(403).json({
    error: 'Operación no permitida: Los movimientos contables del Libro Mayor son registros inmutables. Para corregir, anule el movimiento con rol ADMIN.'
  });
};

export const deleteMovimiento = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userRole = req.user?.rol;
    if (userRole !== 'ADMIN') {
      res.status(403).json({
        error: 'Acceso denegado: Solo los usuarios con rol ADMINISTRADOR pueden anular movimientos y revertir cuentas.'
      });
      return;
    }

    const { id } = req.params;
    const existing = await supabaseClient.fetchRecords<Record<string, unknown>>(
      'fondos_movimientos',
      `id=eq.${id}&limit=1`
    );

    if (!existing.data || existing.data.length === 0) {
      res.status(404).json({ error: `Movimiento ${id} no encontrado en la base de datos.` });
      return;
    }

    const targetMov = existing.data[0];
    const idFactura = targetMov.id_factura as string | undefined;

    if (idFactura) {
      // 1. Reversión integral de factura: Eliminar todos los asientos contables vinculados a esta factura
      await supabaseClient.request(`fondos_movimientos?id_factura=eq.${idFactura}`, {
        method: 'DELETE'
      });

      // 2. Revertir el estado de la factura a PENDIENTE
      await supabaseClient.request(`facturas?id=eq.${idFactura}`, {
        method: 'PATCH',
        body: {
          estado_pago: 'PENDIENTE',
          monto_pagado: 0.0,
          fecha_pago: null,
          metodo_pago: null,
          updated_at: new Date().toISOString()
        }
      });

      res.json({
        success: true,
        message: `Factura y asientos contables revertidos exitosamente. Todos los fondos y la caja han sido recalculados.`,
        reversionType: 'FACTURA_COMPLETA',
        idFactura
      });
    } else {
      // Movimiento directo (Egreso o Ingreso manual): Eliminar asiento
      await supabaseClient.request(`fondos_movimientos?id=eq.${id}`, {
        method: 'DELETE'
      });

      res.json({
        success: true,
        message: `Movimiento contable ${id} eliminado y saldo del fondo revertido exitosamente.`,
        reversionType: 'MOVIMIENTO_DIRECTO',
        id
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al anular movimiento y revertir cuentas.';
    console.error('[FinanceController] Error eliminando movimiento:', error);
    res.status(400).json({ error: message });
  }
};

// ==========================================
// 4. CONTROL PARROQUIAL (ENTREGA AL PADRE)
// ==========================================

export const getLiquidacionPadreParroquia = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { periodoCodigo } = req.query as { periodoCodigo?: string };
    const fondoPadreId = FONDO_IDS.PADRE_PARROQUIA;

    const [facRes, movRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas', 'estado_pago=eq.PAGADO'),
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_movimientos', `id_fondo=eq.${fondoPadreId}&order=fecha.desc`)
    ]);

    const facturas = facRes.data || [];
    const movimientosPadre = movRes.data || [];

    let totalRecaudado = 0;
    let cuotasNormalesCount = 0;
    facturas.forEach((f) => {
      const d = calculateFacturaFundDistribution(f);
      if (d.PADRE_PARROQUIA > 0) {
        totalRecaudado += d.PADRE_PARROQUIA;
        cuotasNormalesCount += 1;
      }
    });

    const entregasRegistradas = movimientosPadre.filter((m) => m.tipo === 'EGRESO');
    const totalEntregado = entregasRegistradas.reduce((acc, m) => acc + Number(m.egreso || 0), 0);
    const saldoPendiente = Number(Math.max(0, totalRecaudado - totalEntregado).toFixed(2));

    res.json({
      descripcion: 'Control y Liquidación del Fondo Parroquial (Aporte al Padre)',
      data: {
        periodo: periodoCodigo || '2026-08',
        totalRecaudado: Number(totalRecaudado.toFixed(2)),
        cuotasNormalesCount,
        aportePorCuota: 2.0,
        totalEntregadoPadre: Number(totalEntregado.toFixed(2)),
        saldoPendienteEntrega: saldoPendiente,
        entregas: entregasRegistradas
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error obteniendo liquidación parroquial.';
    res.status(400).json({ error: message });
  }
};

// ==========================================
// 5. SINCRONIZACIÓN AUTOMÁTICA DE FACTURAS
// ==========================================

export async function autoSincronizarAsientosFacturas(): Promise<number> {
  try {
    const [facRes, movRes, socRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas', 'estado_pago=eq.PAGADO'),
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_movimientos', 'tipo=eq.INGRESO'),
      supabaseClient.fetchRecords<Record<string, unknown>>('socios')
    ]);

    const facturas = facRes.data || [];
    const movimientos = movRes.data || [];
    const socios = socRes.data || [];
    const socMap = new Map(socios.map((s) => [s.id as string, s]));

    const facturasConAsiento = new Set<string>();
    movimientos.forEach((m) => {
      if (m.id_factura) facturasConAsiento.add(String(m.id_factura));
    });

    let count = 0;
    const ahora = new Date().toISOString();
    const nuevosAsientos: any[] = [];

    for (const f of facturas) {
      if (facturasConAsiento.has(f.id as string)) continue;

      const d = calculateFacturaFundDistribution(f);
      const soc = socMap.get(f.id_socio as string);
      const sNom = soc ? `${soc.nombres || ''} ${soc.apellidos || ''}`.trim() : 'Socio Abonado';
      const numFac = (f.numero_factura as string) || (f.id as string);
      const fechaPago = (f.fecha_pago as string) || (f.created_at as string) || ahora;
      const respId = '00000000-0000-0000-0000-000000000002';

      const items = [
        { idFondo: FONDO_IDS.OPERACION_MANT, monto: d.OPERACION_MANT, concepto: `Cobro Factura #${numFac} - Cuota Operación ($${d.OPERACION_MANT.toFixed(2)}) - ${sNom}` },
        { idFondo: FONDO_IDS.PADRE_PARROQUIA, monto: d.PADRE_PARROQUIA, concepto: `Cobro Factura #${numFac} - Aporte Parroquial ($2.00) - ${sNom}` },
        { idFondo: FONDO_IDS.PAGO_LECTOR, monto: d.PAGO_LECTOR, concepto: `Cobro Factura #${numFac} - Toma Lectura ($0.50) - ${sNom}` },
        { idFondo: FONDO_IDS.MORTUORIO, monto: d.MORTUORIO, concepto: `Cobro Factura #${numFac} - Fondo Mortuorio ($0.50) - ${sNom}` },
        { idFondo: FONDO_IDS.PRO_MEJORAS, monto: d.PRO_MEJORAS, concepto: `Cobro Factura #${numFac} - Excedente Consumo - ${sNom}` },
        { idFondo: FONDO_IDS.ALCANTARILLADO, monto: d.ALCANTARILLADO, concepto: `Cobro Factura #${numFac} - Servicio Alcantarillado - ${sNom}` },
        { idFondo: FONDO_IDS.MULTAS_EXTRAS, monto: d.MULTAS_EXTRAS, concepto: `Cobro Factura #${numFac} - Multas y Mingas - ${sNom}` }
      ];

      for (const item of items) {
        if (item.monto > 0) {
          nuevosAsientos.push({
            id: crypto.randomUUID(),
            id_fondo: item.idFondo,
            fecha: fechaPago,
            concepto: item.concepto,
            tipo: 'INGRESO',
            ingreso: item.monto,
            egreso: 0.0,
            saldo: item.monto,
            id_factura: f.id,
            numero_comprobante: numFac,
            id_responsable: respId,
            beneficiario: sNom,
            created_at: ahora
          });
        }
      }
    }

    if (nuevosAsientos.length > 0) {
      if (supabaseClient.isEnabled()) {
        const batchRes = await supabaseClient.request('fondos_movimientos', {
          method: 'POST',
          body: nuevosAsientos
        });
        if (batchRes.error) {
          for (const a of nuevosAsientos) {
            await supabaseClient.syncRecord('fondos_movimientos', a);
          }
        }
      }
      count = nuevosAsientos.length;
    }

    return count;
  } catch (err) {
    console.warn('[FinanceController] autoSincronizarAsientosFacturas error:', err);
    return 0;
  }
}

export const sincronizarAsientosContablesFacturas = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const nuevosCount = await autoSincronizarAsientosFacturas();
    res.json({
      success: true,
      message: `Asientos contables sincronizados automáticamente. Nuevos creados: ${nuevosCount}.`,
      data: { totalNuevosAsientos: nuevosCount }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error sincronizando asientos.';
    res.status(500).json({ error: message });
  }
};

// Aliases para compatibilidad
export const getMovimientosCaja = getLibroMayor3Columnas;
export const getBalanceResumen = getBalanceFondosResumen;
export const createMovimiento = registrarEgreso;

