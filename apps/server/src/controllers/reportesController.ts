/**
 * SIGA-Comunitario • Controlador de Reportes y Auditoría (Módulo 5)
 * Endpoints genéricos y escalables para consultas directas a Supabase Cloud
 */

import type { Response } from '../core/http.ts';
import { supabaseClient } from '../db/supabase.ts';
import type { AuthenticatedRequest } from '../middlewares/auth.ts';
import { DEFAULT_FONDOS, FONDO_IDS, calculateFacturaFundDistribution } from './financeController.ts';

// ==========================================
// 1. REPORTE DE MOROSIDAD Y CARTERA VENCIDA
// ==========================================
export const getReporteMorosidad = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { sectorId, minMeses, q } = req.query as {
      sectorId?: string;
      minMeses?: string;
      q?: string;
    };

    const [socRes, medRes, secRes, facRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('socios'),
      supabaseClient.fetchRecords<Record<string, unknown>>('medidores'),
      supabaseClient.fetchRecords<Record<string, unknown>>('sectores'),
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas', 'estado_pago=eq.PENDIENTE&order=created_at.asc')
    ]);

    const socios = socRes.data || [];
    const medidores = medRes.data || [];
    const sectores = secRes.data || [];
    const facturas = facRes.data || [];

    const socMap = new Map(socios.map((s) => [s.id as string, s]));
    const medMap = new Map(medidores.map((m) => [m.id as string, m]));
    const secMap = new Map(sectores.map((sec) => [sec.id as string, sec]));

    // Agrupar facturas pendientes por socio
    const morososMap = new Map<string, {
      socio: any;
      medidor: any;
      sector: any;
      facturasPendientes: any[];
      totalDeuda: number;
      mesesAdeudados: number;
      fechaMasAntigua: string | null;
    }>();

    for (const f of facturas) {
      const sId = f.id_socio as string;
      if (!sId) continue;

      const socio = socMap.get(sId) || { id: sId, codigo_socio: 'S/N', nombres: 'Socio', apellidos: '', cedula_ruc: '-' };
      const medidor = f.id_medidor ? medMap.get(f.id_medidor as string) : medidores.find((m) => m.id_socio === sId);
      const sector = medidor?.id_sector ? secMap.get(medidor.id_sector as string) : null;
      const deuda = Number(f.total_pagar || 0);
      const fechaFactura = (f.fecha_emision || f.created_at || '') as string;

      const esTercera = Boolean(socio.es_tercera_edad);
      const tarifaBase = esTercera ? 5.0 : 7.0;

      let mesesFactura = 0;
      if (Number(f.valor_base || 0) > 0) {
        mesesFactura += 1;
      }
      if (Number(f.valor_deuda_anterior || 0) > 0) {
        mesesFactura += Math.max(1, Math.round(Number(f.valor_deuda_anterior) / tarifaBase));
      }
      if (mesesFactura === 0 && deuda > 0) {
        mesesFactura = 1;
      }

      if (!morososMap.has(sId)) {
        morososMap.set(sId, {
          socio,
          medidor,
          sector,
          facturasPendientes: [f],
          totalDeuda: deuda,
          mesesAdeudados: mesesFactura,
          fechaMasAntigua: fechaFactura
        });
      } else {
        const item = morososMap.get(sId)!;
        item.facturasPendientes.push(f);
        item.totalDeuda += deuda;
        item.mesesAdeudados += mesesFactura;
        if (!item.fechaMasAntigua || (fechaFactura && fechaFactura < item.fechaMasAntigua)) {
          item.fechaMasAntigua = fechaFactura;
        }
      }
    }

    let morosos = Array.from(morososMap.values()).map((m) => {
      const nombreCompleto = `${m.socio.nombres || ''} ${m.socio.apellidos || ''}`.trim() || 'Socio Desconocido';
      const esTerceraEdad = Boolean(m.socio.es_tercera_edad);
      const meses = m.mesesAdeudados;
      const esCorte = meses >= 3;

      return {
        socioId: m.socio.id,
        idSocio: m.socio.id,
        codigoSocio: m.socio.codigo_socio || 'S/N',
        nombreCompleto,
        nombresCompletos: nombreCompleto,
        cedulaRuc: m.socio.cedula_ruc || '-',
        telefono: m.socio.telefono || '',
        esTerceraEdad,
        idSector: m.sector?.id || '',
        nombreSector: m.sector?.nombre_sector || 'Sin sector asignado',
        medidorId: m.medidor?.id || '',
        medidorNumero: m.medidor?.numero_medidor || 'S/M',
        mesesAdeudados: meses,
        mesesAtrasados: meses,
        deudaTotal: Number(m.totalDeuda.toFixed(2)),
        deudaTotalPendiente: Number(m.totalDeuda.toFixed(2)),
        fechaDeudaMasAntigua: m.fechaMasAntigua,
        requiereCorte: esCorte,
        facturasPendientes: m.facturasPendientes.map((f) => ({
          id: f.id,
          numeroFactura: f.numero_factura || f.id,
          totalPagar: Number(f.total_pagar || 0),
          fechaEmision: f.fecha_emision || f.created_at,
          consumoM3: Number(f.consumo_total_m3 || f.consumo_m3 || 0)
        }))
      };
    });

    // Filtros genéricos
    if (sectorId && sectorId.trim()) {
      morosos = morosos.filter((m) => m.idSector === sectorId);
    }

    if (minMeses && !isNaN(parseInt(minMeses, 10))) {
      const min = parseInt(minMeses, 10);
      morosos = morosos.filter((m) => m.mesesAdeudados >= min);
    }

    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      morosos = morosos.filter(
        (m) =>
          m.nombreCompleto.toLowerCase().includes(term) ||
          m.cedulaRuc.toLowerCase().includes(term) ||
          m.codigoSocio.toLowerCase().includes(term) ||
          m.medidorNumero.toLowerCase().includes(term) ||
          m.nombreSector.toLowerCase().includes(term)
      );
    }

    // Ordenar: primero los de mayor mora (corte) y luego por monto adeudado
    morosos.sort((a, b) => b.mesesAdeudados - a.mesesAdeudados || b.deudaTotal - a.deudaTotal);

    const deudaTotalAcumulada = Number(morosos.reduce((acc, m) => acc + m.deudaTotal, 0).toFixed(2));
    const casosCorte = morosos.filter((m) => m.requiereCorte).length;

    res.json({
      titulo: 'Informe de Morosidad y Cartera Vencida (Supabase Cloud)',
      data: {
        totalMorosos: morosos.length,
        deudaTotalAcumulada,
        casosCorte,
        sociosMorosos: morosos,
        morosos
      },
      totalMorosos: morosos.length,
      deudaTotalAcumulada,
      casosCorte,
      sociosMorosos: morosos,
      morosos
    });
  } catch (error) {
    console.error('[ReportesController] Error generando reporte de morosidad:', error);
    res.status(500).json({ error: 'Error generando reporte de morosidad desde Supabase.' });
  }
};

// ==========================================
// 2. CONSOLIDADO POR SECTOR GEOGRÁFICO
// ==========================================
export const getReportePorSector = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [secRes, socRes, medRes, facRes, lecRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('sectores', 'activo=eq.true&order=nombre_sector.asc'),
      supabaseClient.fetchRecords<Record<string, unknown>>('socios'),
      supabaseClient.fetchRecords<Record<string, unknown>>('medidores'),
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas'),
      supabaseClient.fetchRecords<Record<string, unknown>>('lecturas')
    ]);

    const sectores = secRes.data || [];
    const socios = socRes.data || [];
    const medidores = medRes.data || [];
    const facturas = facRes.data || [];
    const lecturas = lecRes.data || [];

    const reporte = sectores.map((sec) => {
      const medidoresSector = medidores.filter((m) => m.id_sector === sec.id);
      const medIds = new Set(medidoresSector.map((m) => m.id));
      const socioIds = new Set(medidoresSector.map((m) => m.id_socio));

      const facturasSector = facturas.filter(
        (f) => (f.id_medidor && medIds.has(f.id_medidor)) || (!f.id_medidor && f.id_socio && socioIds.has(f.id_socio))
      );

      const lecturasSector = lecturas.filter((l) => l.id_medidor && medIds.has(l.id_medidor));
      const consumoTotalM3 = Number(
        lecturasSector.reduce((acc, l) => acc + Number(l.consumo_total || l.consumo_m3 || 0), 0).toFixed(2)
      );

      const totalCobrado = Number(
        facturasSector
          .filter((f) => f.estado_pago === 'PAGADO')
          .reduce((acc, f) => {
            const monPag = Number(f.monto_pagado || 0);
            const tot = Number(f.total_pagar || 0);
            return acc + (monPag > 0 ? monPag : tot);
          }, 0)
          .toFixed(2)
      );

      const totalPendienteMora = Number(
        facturasSector
          .filter((f) => f.estado_pago === 'PENDIENTE')
          .reduce((acc, f) => acc + Number(f.total_pagar || 0), 0)
          .toFixed(2)
      );

      const totalFacturado = Number((totalCobrado + totalPendienteMora).toFixed(2));

      return {
        idSector: sec.id,
        codigoSector: sec.codigo_sector || 'S/C',
        nombreSector: sec.nombre_sector,
        totalSocios: socioIds.size,
        totalMedidores: medidoresSector.length,
        consumoTotalM3,
        totalFacturado,
        totalCobrado,
        totalRecaudado: totalCobrado,
        totalEnMora: totalPendienteMora,
        totalPendienteMora
      };
    });

    res.json({
      titulo: 'Informe Consolidado por Sector Geográfico',
      data: reporte,
      sectores: reporte
    });
  } catch (error) {
    console.error('[ReportesController] Error generando reporte por sector:', error);
    res.status(500).json({ error: 'Error generando reporte por sector desde Supabase.' });
  }
};

// ==========================================
// 3. INFORME GENERAL DE GESTIÓN Y ASAMBLEA
// ==========================================
export const getReporteConsolidado = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [socRes, facRes, lecRes, catRes, movRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('socios'),
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas'),
      supabaseClient.fetchRecords<Record<string, unknown>>('lecturas'),
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_catalogo', 'activo=eq.true&order=codigo.asc'),
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_movimientos')
    ]);

    const socios = socRes.data || [];
    const facturas = facRes.data || [];
    const lecturas = lecRes.data || [];
    const catalogo = catRes.data && catRes.data.length > 0 ? catRes.data : DEFAULT_FONDOS;
    const movimientos = movRes.data || [];

    const facturasPagadas = facturas.filter((f) => f.estado_pago === 'PAGADO');
    const facturasPendientes = facturas.filter((f) => f.estado_pago === 'PENDIENTE' || f.estado_pago === 'PARCIAL' || (f.estado_pago !== 'PAGADO' && Number(f.saldo_pendiente || 0) > 0));

    const totalIngresos = Number(
      facturasPagadas
        .reduce((acc, f) => {
          const monPag = Number(f.monto_pagado || 0);
          const tot = Number(f.total_pagar || 0);
          return acc + (monPag > 0 ? monPag : tot);
        }, 0)
        .toFixed(2)
    );

    const totalEgresos = Number(
      movimientos
        .filter((m) => m.tipo === 'EGRESO')
        .reduce((acc, m) => acc + Number(m.egreso || 0), 0)
        .toFixed(2)
    );

    const saldoNeto = Number((totalIngresos - totalEgresos).toFixed(2));
    const totalCarteraVencida = Number(
      facturasPendientes.reduce((acc, f) => acc + Number(f.total_pagar || 0), 0).toFixed(2)
    );
    const totalConsumoM3 = Number(
      lecturas.reduce((acc, l) => acc + Number(l.consumo_total || l.consumo_m3 || 0), 0).toFixed(2)
    );

    // Desglose de ingresos por rubros
    let baseAgua = 0;
    let excedentes = 0;
    let alcantarillado = 0;
    let multas = 0;

    facturasPagadas.forEach((f) => {
      baseAgua += Number(f.valor_base || 0);
      excedentes += Number(f.valor_excedente || 0);
      alcantarillado += Number(f.valor_alcantarillado || 0);
      multas += Number(f.valor_multas || 0);
    });

    // Desglose de saldos por fondos comunitarios
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

    const fondosResumen = catalogo.map((f) => {
      const fMovs = movimientos.filter((m) => m.id_fondo === f.id);
      const fEgresos = fMovs
        .filter((m) => m.tipo === 'EGRESO')
        .reduce((acc, m) => acc + Number(m.egreso || 0), 0);

      const fIngresosManuales = fMovs
        .filter((m) => m.tipo === 'INGRESO' && !m.id_factura)
        .reduce((acc, m) => acc + Number(m.ingreso || 0), 0);

      const fIngresosFacturas = distribucionFacturas[f.id as string] || 0;
      const fIngresosTotal = Number((fIngresosFacturas + fIngresosManuales).toFixed(2));
      const fSaldo = Number((fIngresosTotal - fEgresos).toFixed(2));

      return {
        id: f.id,
        codigo: f.codigo,
        nombre: f.nombre,
        descripcion: f.descripcion,
        ingresos: fIngresosTotal,
        egresos: Number(fEgresos.toFixed(2)),
        saldo: fSaldo
      };
    });

    const data = {
      fechaEmision: new Date().toISOString().split('T')[0],
      totalSocios: socios.length,
      sociosActivos: socios.filter((s) => s.estado === 'ACTIVO').length,
      totalFacturas: facturas.length,
      facturasPagadasCount: facturasPagadas.length,
      facturasPendientesCount: facturasPendientes.length,
      totalIngresos,
      totalEgresos,
      saldoNeto,
      totalCarteraVencida,
      totalConsumoM3,
      desgloseIngresos: {
        baseAgua: Number(baseAgua.toFixed(2)),
        excedentes: Number(excedentes.toFixed(2)),
        alcantarillado: Number(alcantarillado.toFixed(2)),
        multas: Number(multas.toFixed(2))
      },
      fondos: fondosResumen
    };

    res.json({
      titulo: 'Informe Oficial de Gestión Comunitaria y Rendición de Cuentas',
      data,
      ...data
    });
  } catch (error) {
    console.error('[ReportesController] Error generando informe general:', error);
    res.status(500).json({ error: 'Error generando informe general desde Supabase.' });
  }
};

// ==========================================
// 4. AUDITORÍA Y TRAZABILIDAD DE MOVIMIENTOS
// ==========================================
export const getReporteAuditoria = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { fechaDesde, fechaHasta, tipo, q } = req.query as {
      fechaDesde?: string;
      fechaHasta?: string;
      tipo?: string;
      q?: string;
    };

    const [movRes, facRes, socRes, catRes, usuRes, perRes, abonosRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_movimientos', 'order=fecha.desc'),
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas', 'order=created_at.desc'),
      supabaseClient.fetchRecords<Record<string, unknown>>('socios'),
      supabaseClient.fetchRecords<Record<string, unknown>>('fondos_catalogo'),
      supabaseClient.fetchRecords<Record<string, unknown>>('usuarios'),
      supabaseClient.fetchRecords<Record<string, unknown>>('periodos'),
      supabaseClient.fetchRecords<Record<string, unknown>>('rubros_abonos', 'order=created_at.desc')
    ]);

    const movimientos = movRes.data || [];
    const facturas = facRes.data || [];
    const socios = socRes.data || [];
    const catalogo = catRes.data && catRes.data.length > 0 ? catRes.data : DEFAULT_FONDOS;
    const usuarios = usuRes.data || [];
    const periodos = perRes.data || [];
    const abonos = abonosRes.data || [];

    const facMap = new Map(facturas.map((f) => [f.id as string, f]));
    const socMap = new Map(socios.map((s) => [s.id as string, s]));
    const catMap = new Map(catalogo.map((f) => [f.id as string, f]));
    const usuMap = new Map(usuarios.map((u) => [u.id as string, u]));
    const perMap = new Map(periodos.map((p) => [p.id as string, p]));

    const abonosPorFactura = new Map<string, number>();
    for (const a of abonos) {
      const fid = a.id_factura as string;
      if (fid) {
        const monto = Number(a.monto_abonado || 0);
        abonosPorFactura.set(fid, Number(((abonosPorFactura.get(fid) || 0) + monto).toFixed(2)));
      }
    }

    const movimientosLogs = movimientos.map((m) => {
      const f = catMap.get(m.id_fondo as string);
      const fac = m.id_factura ? facMap.get(m.id_factura as string) : null;
      const soc = fac?.id_socio ? socMap.get(fac.id_socio as string) : null;
      const resp = m.id_responsable ? usuMap.get(m.id_responsable as string) : null;

      const socioNombre = soc ? `${soc.nombres || ''} ${soc.apellidos || ''}`.trim() : m.beneficiario || '-';
      const responsableNombre = resp ? `${resp.nombre_completo || resp.usuario} (${resp.rol})` : 'Sistema Automático';

      return {
        id: m.id,
        origen: 'MOVIMIENTO',
        fecha: m.fecha || m.created_at,
        tipo: m.tipo,
        nombreFondo: f?.nombre || 'Fondo Comunitario',
        codigoFondo: f?.codigo || '',
        concepto: m.concepto || '-',
        numeroComprobante: m.numero_comprobante || '-',
        monto: m.tipo === 'EGRESO' ? Number(m.egreso || 0) : Number(m.ingreso || 0),
        saldoResultante: Number(m.saldo || 0),
        socioBeneficiario: socioNombre,
        responsable: responsableNombre,
        idFactura: m.id_factura || null,
        facturaNumero: fac?.numero_factura || null
      };
    });

    const facturasLogs = facturas.map((f) => {
      const soc = f.id_socio ? socMap.get(f.id_socio as string) : null;
      const per = f.id_periodo ? perMap.get(f.id_periodo as string) : null;
      const resp = f.id_cajero ? usuMap.get(f.id_cajero as string) : null;
      const pCod = (per?.periodo_codigo || per?.codigo || f.periodo_codigo || '') as string;
      const fNum = (f.numero_factura as string) || (f.id as string);
      const isPagado = f.estado_pago === 'PAGADO';
      const totP = Number(f.total_pagar || 0);
      const totAbonos = Number(abonosPorFactura.get(f.id as string) || 0);
      const montoCobrado = isPagado ? totP : (totAbonos > 0 ? totAbonos : (f.fecha_pago ? totP : Number(f.monto_pagado || 0)));
      const saldoPendiente = isPagado ? 0 : (totAbonos > 0 ? totP : Number(f.saldo_pendiente !== undefined && f.saldo_pendiente !== null ? f.saldo_pendiente : totP));
      const esAbono = !isPagado && (totAbonos > 0 || (Boolean(f.fecha_pago) && totP > 0));

      const socioNombre = soc ? `${soc.nombres || ''} ${soc.apellidos || ''}`.trim() : 'Socio';
      const socioCedula = (soc?.cedula_ruc as string) || '';
      const responsableNombre = resp ? `${resp.nombre_completo || resp.usuario} (${resp.rol})` : (f.fecha_pago ? 'Cajero / Oficina' : 'Sistema Automático');

      const estadoStr = isPagado ? 'PAGADO' : (esAbono ? 'ABONO' : 'PENDIENTE');
      const isRec = String(fNum).startsWith('REC-');
      const conceptoStr = isRec
        ? `Recibo de Cobro / Abono #${fNum}`
        : `Planilla Agua [${pCod || 'Mes'}] - Consumo: ${f.consumo_m3 || 0} m³` +
          (Number(f.valor_multas || 0) > 0 ? ` + Multas: $${Number(f.valor_multas).toFixed(2)}` : '') +
          (Number(f.valor_deuda_anterior || 0) > 0 ? ` + Deuda: $${Number(f.valor_deuda_anterior).toFixed(2)}` : '');

      return {
        id: f.id,
        origen: 'FACTURA',
        fecha: f.fecha_pago || f.created_at,
        tipo: isPagado ? 'PAGADO' : (esAbono ? 'ABONO' : 'EMITIDO'),
        estadoPago: estadoStr,
        nombreFondo: 'Agua Potable y Servicios',
        codigoFondo: 'AGUA',
        concepto: conceptoStr,
        numeroComprobante: fNum,
        monto: isPagado ? totP : (montoCobrado > 0 ? montoCobrado : totP),
        totalFactura: totP,
        montoCobrado: montoCobrado,
        saldoPendiente: saldoPendiente,
        consumoM3: Number(f.consumo_m3 || 0),
        periodoCodigo: pCod,
        saldoResultante: saldoPendiente,
        socioBeneficiario: `${socioNombre} ${socioCedula ? `(${socioCedula})` : ''}`.trim(),
        socioId: f.id_socio,
        responsable: responsableNombre,
        metodoPago: f.metodo_pago || 'EFECTIVO',
        idFactura: f.id,
        facturaNumero: fNum
      };
    });

    let logs = [...facturasLogs, ...movimientosLogs].sort(
      (a, b) => new Date(b.fecha || 0).getTime() - new Date(a.fecha || 0).getTime()
    );

    if (tipo && tipo.trim()) {
      const t = tipo.trim().toUpperCase();
      if (t === 'FACTURA') {
        logs = logs.filter((l) => l.origen === 'FACTURA');
      } else if (t === 'MOVIMIENTO') {
        logs = logs.filter((l) => l.origen === 'MOVIMIENTO');
      } else if (t === 'INGRESO' || t === 'EGRESO') {
        logs = logs.filter((l) => l.tipo === t);
      } else if (t === 'PAGADO' || t === 'PENDIENTE' || t === 'ABONO' || t === 'EMITIDO') {
        logs = logs.filter((l) => l.tipo === t || (l as any).estadoPago === t);
      } else {
        logs = logs.filter((l) => l.tipo === t);
      }
    }

    if (fechaDesde && fechaDesde.trim()) {
      logs = logs.filter((l) => String(l.fecha) >= fechaDesde);
    }

    if (fechaHasta && fechaHasta.trim()) {
      logs = logs.filter((l) => String(l.fecha) <= fechaHasta);
    }

    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      logs = logs.filter(
        (l) =>
          (l.concepto && l.concepto.toLowerCase().includes(term)) ||
          (l.numeroComprobante && l.numeroComprobante.toLowerCase().includes(term)) ||
          (l.socioBeneficiario && l.socioBeneficiario.toLowerCase().includes(term)) ||
          (l.nombreFondo && l.nombreFondo.toLowerCase().includes(term)) ||
          (l.responsable && l.responsable.toLowerCase().includes(term))
      );
    }

    res.json({
      titulo: 'Registro y Trazabilidad de Auditoría Contable y Transacciones',
      totalLogs: logs.length,
      data: logs,
      facturas: facturasLogs,
      movimientos: movimientosLogs
    });
  } catch (error) {
    console.error('[ReportesController] Error obteniendo auditoría:', error);
    res.status(500).json({ error: 'Error obteniendo registros de auditoría.' });
  }
};

// ==========================================
// 5. ESTADO DE CUENTA INDIVIDUAL POR SOCIO
// ==========================================
export const getEstadoCuentaSocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [socRes, medRes, facRes, lecRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('socios', `id=eq.${id}&limit=1`),
      supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id_socio=eq.${id}`),
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas', `id_socio=eq.${id}&order=created_at.desc`),
      supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', 'order=fecha_lectura.desc')
    ]);

    if (!socRes.data || socRes.data.length === 0) {
      res.status(404).json({ error: `Socio con ID ${id} no encontrado.` });
      return;
    }

    const socio = socRes.data[0];
    const medidores = medRes.data || [];
    const facturas = facRes.data || [];
    const medIds = new Set(medidores.map((m) => m.id));
    const lecturas = (lecRes.data || []).filter((l) => medIds.has(l.id_medidor));

    const totalFacturado = Number(
      facturas.reduce((acc, f) => acc + Number(f.total_pagar || 0), 0).toFixed(2)
    );
    const totalPagado = Number(
      facturas
        .filter((f) => f.estado_pago === 'PAGADO')
        .reduce((acc, f) => {
          const monPag = Number(f.monto_pagado || 0);
          const tot = Number(f.total_pagar || 0);
          return acc + (monPag > 0 ? monPag : tot);
        }, 0)
        .toFixed(2)
    );
    const totalPendiente = Number(
      facturas
        .filter((f) => f.estado_pago === 'PENDIENTE' || f.estado_pago === 'PARCIAL' || (f.estado_pago !== 'PAGADO' && Number(f.saldo_pendiente || 0) > 0))
        .reduce((acc, f) => acc + Number(f.saldo_pendiente !== undefined && f.saldo_pendiente !== null ? f.saldo_pendiente : (f.total_pagar || 0)), 0)
        .toFixed(2)
    );

    const facturasPendientes = facturas.filter((f) => f.estado_pago === 'PENDIENTE' || f.estado_pago === 'PARCIAL' || (f.estado_pago !== 'PAGADO' && Number(f.saldo_pendiente || 0) > 0));

    const esTercera = Boolean(socio.es_tercera_edad);
    const tarifaBase = esTercera ? 5.0 : 7.0;
    let mesesAdeudados = 0;
    for (const f of facturasPendientes) {
      let m = 0;
      if (Number(f.valor_base || 0) > 0) m += 1;
      if (Number(f.valor_deuda_anterior || 0) > 0) {
        m += Math.max(1, Math.round(Number(f.valor_deuda_anterior) / tarifaBase));
      }
      if (m === 0 && Number(f.total_pagar || 0) > 0) m = 1;
      mesesAdeudados += m;
    }

    res.json({
      socio: {
        id: socio.id,
        codigoSocio: socio.codigo_socio,
        nombreCompleto: `${socio.nombres || ''} ${socio.apellidos || ''}`.trim(),
        cedulaRuc: socio.cedula_ruc,
        telefono: socio.telefono,
        direccion: socio.direccion,
        esTerceraEdad: Boolean(socio.es_tercera_edad),
        estado: socio.estado
      },
      resumenFinanciero: {
        totalFacturado,
        totalPagado,
        totalPendiente,
        facturasTotal: facturas.length,
        facturasPendientesCount: facturasPendientes.length,
        mesesAdeudados,
        requiereCorte: mesesAdeudados >= 3 || facturasPendientes.length >= 3
      },
      medidores,
      facturas,
      lecturas
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error obteniendo estado de cuenta del socio.';
    res.status(500).json({ error: message });
  }
};
