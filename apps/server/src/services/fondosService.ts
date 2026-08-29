import crypto from 'node:crypto';
import { sqliteDb } from '../db/sqlite.ts';
import type {
  CodigoFondo,
  FondoCatalogo,
  MovimientoFondo3Columnas,
  ResumenFondo3Columnas,
  LiquidacionPadreParroquia,
  BalanceGeneralFondos
} from '../shared.ts';

interface MovimientoRow {
  id: string;
  id_fondo: string;
  codigo_fondo?: CodigoFondo;
  nombre_fondo?: string;
  fecha: string;
  concepto: string;
  tipo: 'INGRESO' | 'EGRESO';
  ingreso: number;
  egreso: number;
  saldo: number;
  id_factura?: string;
  numero_comprobante?: string;
  id_responsable: string;
  responsable_nombre?: string;
  beneficiario?: string;
  created_at: string;
}

export class FondosService {
  public getFondos(): FondoCatalogo[] {
    const db = sqliteDb.getRawDb();
    const rows = db.prepare('SELECT * FROM fondos_catalogo WHERE activo = 1').all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      codigo: r.codigo as CodigoFondo,
      nombre: r.nombre as string,
      descripcion: r.descripcion as string,
      activo: Boolean(r.activo)
    }));
  }

  public getFondoByCodigo(codigo: CodigoFondo): FondoCatalogo | null {
    const db = sqliteDb.getRawDb();
    const row = db.prepare('SELECT * FROM fondos_catalogo WHERE codigo = ?').get(codigo) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      codigo: row.codigo as CodigoFondo,
      nombre: row.nombre as string,
      descripcion: row.descripcion as string,
      activo: Boolean(row.activo)
    };
  }

  public getUltimoSaldoFondo(idFondo: string): number {
    const db = sqliteDb.getRawDb();
    const row = db
      .prepare('SELECT saldo FROM fondos_movimientos WHERE id_fondo = ? ORDER BY fecha DESC, created_at DESC LIMIT 1')
      .get(idFondo) as { saldo: number } | undefined;

    return row ? row.saldo : 0.0;
  }

  public registrarMovimiento(data: {
    idFondo: string;
    concepto: string;
    tipo: 'INGRESO' | 'EGRESO';
    monto: number;
    idResponsable: string;
    idFactura?: string;
    numeroComprobante?: string;
    beneficiario?: string;
    fecha?: string;
  }): MovimientoFondo3Columnas {
    const db = sqliteDb.getRawDb();
    const now = new Date().toISOString();
    const fecha = data.fecha || now;
    const monto = Number(Math.abs(data.monto).toFixed(2));

    const saldoAnterior = this.getUltimoSaldoFondo(data.idFondo);
    let nuevoSaldo = 0.0;
    let ingreso = 0.0;
    let egreso = 0.0;

    if (data.tipo === 'INGRESO') {
      ingreso = monto;
      nuevoSaldo = Number((saldoAnterior + monto).toFixed(2));
    } else {
      egreso = monto;
      if (monto > saldoAnterior) {
        console.warn(`[FondosService] Egreso ($${monto}) superior al saldo disponible ($${saldoAnterior}).`);
      }
      nuevoSaldo = Number((saldoAnterior - monto).toFixed(2));
    }

    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO fondos_movimientos (
        id, id_fondo, fecha, concepto, tipo, ingreso, egreso, saldo,
        id_factura, numero_comprobante, id_responsable, beneficiario, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.idFondo,
      fecha,
      data.concepto,
      data.tipo,
      ingreso,
      egreso,
      nuevoSaldo,
      data.idFactura || null,
      data.numeroComprobante || null,
      data.idResponsable,
      data.beneficiario || null,
      now
    );

    return {
      id,
      idFondo: data.idFondo,
      fecha,
      concepto: data.concepto,
      tipo: data.tipo,
      ingreso,
      egreso,
      saldo: nuevoSaldo,
      idFactura: data.idFactura,
      numeroComprobante: data.numeroComprobante,
      idResponsable: data.idResponsable,
      beneficiario: data.beneficiario,
      createdAt: now
    };
  }

  public distribuirFondosFactura(factura: {
    id: string;
    numeroFactura: string;
    esTerceraEdad: boolean;
    valorBase: number;
    valorExcedente: number;
    valorAlcantarillado: number;
    valorMultas: number;
    idCajero: string;
    socioNombre?: string;
  }): void {
    const fondos = this.getFondos();
    const mapaFondos = new Map(fondos.map((f) => [f.codigo, f.id]));

    const getFondoId = (codigo: CodigoFondo): string => {
      const id = mapaFondos.get(codigo);
      if (!id) throw new Error(`Fondo ${codigo} no encontrado en catálogo.`);
      return id;
    };

    const socioRef = factura.socioNombre ? ` (${factura.socioNombre})` : '';

    // 1. Distribución del Canon Base
    if (factura.valorBase > 0) {
      if (factura.esTerceraEdad) {
        this.registrarMovimiento({
          idFondo: getFondoId('PADRE_PARROQUIA'),
          concepto: `Cobro cuota base 3ra edad #${factura.numeroFactura}${socioRef} - Porción Padre`,
          tipo: 'INGRESO',
          monto: 1.5,
          idResponsable: factura.idCajero,
          idFactura: factura.id
        });
        this.registrarMovimiento({
          idFondo: getFondoId('OPERACION_MANT'),
          concepto: `Cobro cuota base 3ra edad #${factura.numeroFactura}${socioRef} - Operación`,
          tipo: 'INGRESO',
          monto: 2.8,
          idResponsable: factura.idCajero,
          idFactura: factura.id
        });
        this.registrarMovimiento({
          idFondo: getFondoId('PAGO_LECTOR'),
          concepto: `Cobro cuota base 3ra edad #${factura.numeroFactura}${socioRef} - Lector`,
          tipo: 'INGRESO',
          monto: 0.35,
          idResponsable: factura.idCajero,
          idFactura: factura.id
        });
        this.registrarMovimiento({
          idFondo: getFondoId('MORTUORIO'),
          concepto: `Cobro cuota base 3ra edad #${factura.numeroFactura}${socioRef} - Mortuorio`,
          tipo: 'INGRESO',
          monto: 0.35,
          idResponsable: factura.idCajero,
          idFactura: factura.id
        });
      } else {
        this.registrarMovimiento({
          idFondo: getFondoId('PADRE_PARROQUIA'),
          concepto: `Cobro cuota normal #${factura.numeroFactura}${socioRef} - Aporte al Padre/Parroquia`,
          tipo: 'INGRESO',
          monto: 2.0,
          idResponsable: factura.idCajero,
          idFactura: factura.id
        });
        this.registrarMovimiento({
          idFondo: getFondoId('OPERACION_MANT'),
          concepto: `Cobro cuota normal #${factura.numeroFactura}${socioRef} - Operación y Mantenimiento`,
          tipo: 'INGRESO',
          monto: 4.0,
          idResponsable: factura.idCajero,
          idFactura: factura.id
        });
        this.registrarMovimiento({
          idFondo: getFondoId('PAGO_LECTOR'),
          concepto: `Cobro cuota normal #${factura.numeroFactura}${socioRef} - Honorarios Lector`,
          tipo: 'INGRESO',
          monto: 0.5,
          idResponsable: factura.idCajero,
          idFactura: factura.id
        });
        this.registrarMovimiento({
          idFondo: getFondoId('MORTUORIO'),
          concepto: `Cobro cuota normal #${factura.numeroFactura}${socioRef} - Fondo Mortuorio`,
          tipo: 'INGRESO',
          monto: 0.5,
          idResponsable: factura.idCajero,
          idFactura: factura.id
        });
      }
    }

    // 2. Fondo Pro-mejoras
    if (factura.valorExcedente > 0) {
      this.registrarMovimiento({
        idFondo: getFondoId('PRO_MEJORAS'),
        concepto: `Recaudación excedente consumo #${factura.numeroFactura}${socioRef}`,
        tipo: 'INGRESO',
        monto: factura.valorExcedente,
        idResponsable: factura.idCajero,
        idFactura: factura.id
      });
    }

    // 3. Fondo de Alcantarillado
    if (factura.valorAlcantarillado > 0) {
      this.registrarMovimiento({
        idFondo: getFondoId('ALCANTARILLADO'),
        concepto: `Recaudación servicio alcantarillado #${factura.numeroFactura}${socioRef}`,
        tipo: 'INGRESO',
        monto: factura.valorAlcantarillado,
        idResponsable: factura.idCajero,
        idFactura: factura.id
      });
    }

    // 4. Fondo de Multas y Rubros Extraordinarios
    if (factura.valorMultas > 0) {
      this.registrarMovimiento({
        idFondo: getFondoId('MULTAS_EXTRAS'),
        concepto: `Recaudación multas y cuotas extraordinarias #${factura.numeroFactura}${socioRef}`,
        tipo: 'INGRESO',
        monto: factura.valorMultas,
        idResponsable: factura.idCajero,
        idFactura: factura.id
      });
    }
  }

  public getLibroMayor(filters?: {
    idFondo?: string;
    fechaInicio?: string;
    fechaFin?: string;
  }): MovimientoFondo3Columnas[] {
    const db = sqliteDb.getRawDb();
    let query = `
      SELECT m.*, f.codigo as codigo_fondo, f.nombre as nombre_fondo, u.nombre_completo as responsable_nombre
      FROM fondos_movimientos m
      JOIN fondos_catalogo f ON m.id_fondo = f.id
      LEFT JOIN usuarios u ON m.id_responsable = u.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filters?.idFondo) {
      query += ' AND m.id_fondo = ?';
      params.push(filters.idFondo);
    }
    if (filters?.fechaInicio) {
      query += ' AND m.fecha >= ?';
      params.push(filters.fechaInicio);
    }
    if (filters?.fechaFin) {
      query += ' AND m.fecha <= ?';
      params.push(filters.fechaFin);
    }

    query += ' ORDER BY m.fecha ASC, m.created_at ASC';
    const rows = db.prepare(query).all(...params) as MovimientoRow[];

    return rows.map((r) => ({
      id: r.id,
      idFondo: r.id_fondo,
      codigoFondo: r.codigo_fondo,
      nombreFondo: r.nombre_fondo,
      fecha: r.fecha,
      concepto: r.concepto,
      tipo: r.tipo,
      ingreso: r.ingreso,
      egreso: r.egreso,
      saldo: r.saldo,
      idFactura: r.id_factura,
      numeroComprobante: r.numero_comprobante,
      idResponsable: r.id_responsable,
      responsableNombre: r.responsable_nombre,
      beneficiario: r.beneficiario,
      createdAt: r.created_at
    }));
  }

  public getBalanceGeneralFondos(): BalanceGeneralFondos {
    const fondos = this.getFondos();
    const db = sqliteDb.getRawDb();

    const fondosResumen: ResumenFondo3Columnas[] = [];
    let granTotalIngresos = 0;
    let granTotalEgresos = 0;
    let saldoGlobalDisponible = 0;

    for (const f of fondos) {
      const stats = db
        .prepare(`
          SELECT 
            COALESCE(SUM(ingreso), 0) as total_ingreso,
            COALESCE(SUM(egreso), 0) as total_egreso,
            COUNT(*) as conteo
          FROM fondos_movimientos
          WHERE id_fondo = ?
        `)
        .get(f.id) as { total_ingreso: number; total_egreso: number; conteo: number };

      const saldoActual = this.getUltimoSaldoFondo(f.id);

      fondosResumen.push({
        idFondo: f.id,
        codigoFondo: f.codigo,
        nombreFondo: f.nombre,
        totalIngresos: stats.total_ingreso,
        totalEgresos: stats.total_egreso,
        saldoActual,
        conteoMovimientos: stats.conteo
      });

      granTotalIngresos += stats.total_ingreso;
      granTotalEgresos += stats.total_egreso;
      saldoGlobalDisponible += saldoActual;
    }

    return {
      fechaCorte: new Date().toISOString(),
      fondos: fondosResumen,
      granTotalIngresos: Number(granTotalIngresos.toFixed(2)),
      granTotalEgresos: Number(granTotalEgresos.toFixed(2)),
      saldoGlobalDisponible: Number(saldoGlobalDisponible.toFixed(2))
    };
  }

  public getLiquidacionPadre(periodoCodigo?: string): LiquidacionPadreParroquia {
    const db = sqliteDb.getRawDb();
    const fondoPadre = this.getFondoByCodigo('PADRE_PARROQUIA');
    if (!fondoPadre) throw new Error('Fondo Parroquial no configurado.');

    const saldoFondoPadre = this.getUltimoSaldoFondo(fondoPadre.id);

    let queryFacturas = `
      SELECT f.estado_pago, f.es_tercera_edad, COUNT(*) as cantidad
      FROM facturas f
    `;
    const params: unknown[] = [];

    if (periodoCodigo) {
      queryFacturas += `
        JOIN periodos p ON f.id_periodo = p.id
        WHERE p.periodo_codigo = ?
      `;
      params.push(periodoCodigo);
    }
    queryFacturas += ' GROUP BY f.estado_pago, f.es_tercera_edad';

    const facturasStats = db.prepare(queryFacturas).all(...params) as {
      estado_pago: string;
      es_tercera_edad: number;
      cantidad: number;
    }[];

    let totalRecaudadoMes = 0;
    let totalSociosAportaron = 0;
    let montoPendienteCobro = 0;
    let totalSociosMorosos = 0;

    for (const stat of facturasStats) {
      const canonPadre = stat.es_tercera_edad ? 1.5 : 2.0;
      if (stat.estado_pago === 'PAGADO') {
        totalRecaudadoMes += canonPadre * stat.cantidad;
        totalSociosAportaron += stat.cantidad;
      } else if (stat.estado_pago === 'PENDIENTE') {
        montoPendienteCobro += canonPadre * stat.cantidad;
        totalSociosMorosos += stat.cantidad;
      }
    }

    let queryEgresos = `
      SELECT COALESCE(SUM(egreso), 0) as total_entregado
      FROM fondos_movimientos
      WHERE id_fondo = ? AND tipo = 'EGRESO'
    `;
    const egresosParams: unknown[] = [fondoPadre.id];
    if (periodoCodigo) {
      queryEgresos += ' AND fecha LIKE ?';
      egresosParams.push(`${periodoCodigo}%`);
    }

    const egresoRes = db.prepare(queryEgresos).get(...egresosParams) as { total_entregado: number };

    return {
      periodoCodigo: periodoCodigo || 'HISTORICO_GLOBAL',
      totalRecaudadoMes: Number(totalRecaudadoMes.toFixed(2)),
      totalEntregadoPadre: Number(egresoRes.total_entregado.toFixed(2)),
      saldoDisponibleFondoPadre: Number(saldoFondoPadre.toFixed(2)),
      totalSociosAportaron,
      totalSociosMorosos,
      montoPendienteCobro: Number(montoPendienteCobro.toFixed(2))
    };
  }
}

export const fondosService = new FondosService();
