import { sqliteDb } from '../db/sqlite.ts';
import { fondosService } from './fondosService.ts';
import { socioService } from './socioService.ts';
import type { BalanceGeneralFondos } from '../shared.ts';

export interface ReporteSector {
  idSector: string;
  codigoSector: string;
  nombreSector: string;
  totalSocios: number;
  sociosAlDia: number;
  sociosEnMora: number;
  consumoTotalM3: number;
  totalFacturado: number;
  totalCobrado: number;
  totalEnMora: number;
  totalRecaudado: number;
  totalPendienteMora: number;
}

export interface ReporteMoroso {
  idSocio: string;
  codigoSocio: string;
  apellidos: string;
  nombres: string;
  nombresCompletos: string;
  cedulaRuc: string;
  medidorNumero: string;
  nombreSector: string;
  mesesAdeudados: number;
  mesesAtrasados: number;
  fechaDeudaMasAntigua?: string;
  fechaCorteInicial?: string;
  deudaTotalPendiente: number;
  totalAdeudado: number;
}

export interface ReporteConsolidadoGeneral {
  periodoFiltro?: string;
  fechaGeneracion: string;
  totalSocios: number;
  totalSociosTerceraEdad: number;
  totalConsumoM3: number;
  totalFacturado: number;
  totalCobradoEfectivo: number;
  totalCobradoTransferencia: number;
  totalCobradoMovil: number;
  totalCobradoGlobal: number;
  totalIngresos: number;
  totalEgresos: number;
  saldoNeto: number;
  totalCarteraPendiente: number;
  desgloseIngresos: {
    baseAgua: number;
    excedentes: number;
    alcantarillado: number;
    multas: number;
  };
  fondos: Array<{
    nombre: string;
    saldo: number;
    ingresos: number;
    egresos: number;
  }>;
  fondosComunitarios: BalanceGeneralFondos;
}

export class ReportesService {
  public getReporteMorosidad(): { totalMorosos: number; deudaTotalAcumulada: number; morosos: ReporteMoroso[] } {
    const socios = socioService.getSocios();
    const morosos: ReporteMoroso[] = [];
    let deudaTotalAcumulada = 0;

    for (const s of socios) {
      const estadoCuenta = socioService.getEstadoCuenta(s.id);
      if (!estadoCuenta.alDia) {
        morosos.push({
          idSocio: s.id,
          codigoSocio: s.codigoSocio,
          apellidos: s.apellidos,
          nombres: s.nombres,
          nombresCompletos: `${s.apellidos} ${s.nombres}`,
          cedulaRuc: s.cedulaRuc,
          medidorNumero: s.medidorNumero,
          nombreSector: s.nombreSector || 'Sin Sector',
          mesesAdeudados: estadoCuenta.mesesAdeudados,
          mesesAtrasados: estadoCuenta.mesesAdeudados,
          fechaDeudaMasAntigua: estadoCuenta.fechaDeudaMasAntigua,
          fechaCorteInicial: estadoCuenta.fechaDeudaMasAntigua,
          deudaTotalPendiente: Number(estadoCuenta.deudaTotalPendiente.toFixed(2)),
          totalAdeudado: Number(estadoCuenta.deudaTotalPendiente.toFixed(2))
        });
        deudaTotalAcumulada += estadoCuenta.deudaTotalPendiente;
      }
    }

    morosos.sort((a, b) => b.totalAdeudado - a.totalAdeudado);

    return {
      totalMorosos: morosos.length,
      deudaTotalAcumulada: Number(deudaTotalAcumulada.toFixed(2)),
      morosos
    };
  }

  public getReportePorSector(periodoId?: string): ReporteSector[] {
    const db = sqliteDb.getRawDb();
    const sectores = db.prepare('SELECT id, codigo_sector, nombre_sector FROM sectores WHERE activo = 1').all() as {
      id: string;
      codigo_sector: string;
      nombre_sector: string;
    }[];

    const reportes: ReporteSector[] = [];

    for (const sec of sectores) {
      const sociosSector = socioService.getSocios({ sectorId: sec.id });
      let sociosAlDia = 0;
      let sociosEnMora = 0;
      let consumoTotalM3 = 0;
      let totalRecaudado = 0;
      let totalPendienteMora = 0;

      let queryLecturas = `
        SELECT COALESCE(SUM(l.consumo_total), 0) as consumo
        FROM lecturas l
        JOIN socios s ON l.id_socio = s.id
        WHERE s.id_sector = ?
      `;
      const lecturasParams: unknown[] = [sec.id];
      if (periodoId) {
        queryLecturas += ' AND l.id_periodo = ?';
        lecturasParams.push(periodoId);
      }
      const lecturasRes = db.prepare(queryLecturas).get(...lecturasParams) as { consumo: number };
      consumoTotalM3 = lecturasRes.consumo;

      let queryFacturas = `
        SELECT f.estado_pago, f.total_mes, f.total_pagar, f.monto_pagado, f.saldo_pendiente
        FROM facturas f
        JOIN socios s ON f.id_socio = s.id
        WHERE s.id_sector = ?
      `;
      const facturasParams: unknown[] = [sec.id];
      if (periodoId) {
        queryFacturas += ' AND f.id_periodo = ?';
        facturasParams.push(periodoId);
      }

      const facturas = db.prepare(queryFacturas).all(...facturasParams) as {
        estado_pago: string;
        total_mes: number;
        total_pagar: number;
        monto_pagado?: number;
        saldo_pendiente?: number;
      }[];

      for (const f of facturas) {
        const pagado = f.monto_pagado !== undefined && f.monto_pagado !== null ? f.monto_pagado : (f.estado_pago === 'PAGADO' ? f.total_pagar : 0);
        const pendiente = f.saldo_pendiente !== undefined && f.saldo_pendiente !== null ? f.saldo_pendiente : (f.estado_pago === 'PENDIENTE' ? f.total_pagar : 0);

        totalRecaudado += pagado;
        totalPendienteMora += pendiente;
      }

      for (const s of sociosSector) {
        const est = socioService.getEstadoCuenta(s.id);
        if (est.alDia) {
          sociosAlDia++;
        } else {
          sociosEnMora++;
        }
      }

      reportes.push({
        idSector: sec.id,
        codigoSector: sec.codigo_sector,
        nombreSector: sec.nombre_sector,
        totalSocios: sociosSector.length,
        sociosAlDia,
        sociosEnMora,
        consumoTotalM3: Number(consumoTotalM3.toFixed(2)),
        totalFacturado: Number((totalRecaudado + totalPendienteMora).toFixed(2)),
        totalCobrado: Number(totalRecaudado.toFixed(2)),
        totalEnMora: Number(totalPendienteMora.toFixed(2)),
        totalRecaudado: Number(totalRecaudado.toFixed(2)),
        totalPendienteMora: Number(totalPendienteMora.toFixed(2))
      });
    }

    return reportes;
  }

  public getReporteConsolidado(periodoId?: string): ReporteConsolidadoGeneral {
    const db = sqliteDb.getRawDb();
    const socios = socioService.getSocios();
    const totalSociosTerceraEdad = socios.filter((s) => s.esTerceraEdad).length;

    let queryLecturas = 'SELECT COALESCE(SUM(consumo_total), 0) as consumo FROM lecturas WHERE 1=1';
    let queryFacturas = 'SELECT * FROM facturas WHERE 1=1';
    const params: unknown[] = [];

    if (periodoId) {
      queryLecturas += ' AND id_periodo = ?';
      queryFacturas += ' AND id_periodo = ?';
      params.push(periodoId);
    }

    const lecturasStats = db.prepare(queryLecturas).get(...params) as { consumo: number };
    const facturas = db.prepare(queryFacturas).all(...params) as Record<string, unknown>[];

    let totalFacturado = 0;
    let totalCobradoEfectivo = 0;
    let totalCobradoTransferencia = 0;
    let totalCobradoMovil = 0;
    let totalCarteraPendiente = 0;

    let baseAgua = 0;
    let excedentes = 0;
    let alcantarillado = 0;
    let multas = 0;

    for (const f of facturas) {
      const totalPagar = (f.total_pagar as number) || 0;
      const montoPagado = (f.monto_pagado as number) !== undefined && f.monto_pagado !== null ? (f.monto_pagado as number) : (f.estado_pago === 'PAGADO' ? totalPagar : 0);
      const saldoPendiente = (f.saldo_pendiente as number) !== undefined && f.saldo_pendiente !== null ? (f.saldo_pendiente as number) : (f.estado_pago === 'PENDIENTE' ? totalPagar : 0);

      totalFacturado += totalPagar;

      if (montoPagado > 0) {
        const metodo = f.metodo_pago as string;
        if (metodo === 'EFECTIVO') totalCobradoEfectivo += montoPagado;
        else if (metodo === 'TRANSFERENCIA') totalCobradoTransferencia += montoPagado;
        else if (metodo === 'MOVIL') totalCobradoMovil += montoPagado;
        else totalCobradoEfectivo += montoPagado;

        const ratio = totalPagar > 0 ? (montoPagado / totalPagar) : 1;
        baseAgua += ((f.valor_base as number) || 0) * ratio;
        excedentes += ((f.valor_excedente as number) || 0) * ratio;
        alcantarillado += ((f.valor_alcantarillado as number) || 0) * ratio;
        multas += ((f.valor_multas as number) || 0) * ratio;
      }

      if (saldoPendiente > 0) {
        totalCarteraPendiente += saldoPendiente;
      }
    }

    const totalCobradoGlobal = totalCobradoEfectivo + totalCobradoTransferencia + totalCobradoMovil;
    const fondosComunitarios = fondosService.getBalanceGeneralFondos();
    const totalEgresos = fondosComunitarios.granTotalEgresos || 0;
    const saldoNeto = Number((totalCobradoGlobal - totalEgresos).toFixed(2));

    const fondosLista = fondosComunitarios.fondos.map((f) => ({
      nombre: f.nombreFondo,
      saldo: f.saldoActual,
      ingresos: f.totalIngresos,
      egresos: f.totalEgresos
    }));

    return {
      periodoFiltro: periodoId || 'HISTORICO_CONSOLIDADO',
      fechaGeneracion: new Date().toISOString(),
      totalSocios: socios.length,
      totalSociosTerceraEdad,
      totalConsumoM3: Number(lecturasStats.consumo.toFixed(2)),
      totalFacturado: Number(totalFacturado.toFixed(2)),
      totalCobradoEfectivo: Number(totalCobradoEfectivo.toFixed(2)),
      totalCobradoTransferencia: Number(totalCobradoTransferencia.toFixed(2)),
      totalCobradoMovil: Number(totalCobradoMovil.toFixed(2)),
      totalCobradoGlobal: Number(totalCobradoGlobal.toFixed(2)),
      totalIngresos: Number(totalCobradoGlobal.toFixed(2)),
      totalEgresos: Number(totalEgresos.toFixed(2)),
      saldoNeto,
      totalCarteraPendiente: Number(totalCarteraPendiente.toFixed(2)),
      desgloseIngresos: {
        baseAgua: Number(baseAgua.toFixed(2)),
        excedentes: Number(excedentes.toFixed(2)),
        alcantarillado: Number(alcantarillado.toFixed(2)),
        multas: Number(multas.toFixed(2))
      },
      fondos: fondosLista,
      fondosComunitarios
    };
  }
}

export const reportesService = new ReportesService();
