import crypto from 'node:crypto';
import { sqliteDb } from '../db/sqlite.ts';
import { socioService } from './socioService.ts';
import { fondosService } from './fondosService.ts';
import { ValidationRules } from '../shared.ts';
import type { Factura, TarifaConfig, MultaRubro, MetodoPago } from '../shared.ts';

interface FacturaRow {
  id: string;
  numero_factura: string;
  id_socio: string;
  socio_nombre?: string;
  socio_cedula?: string;
  id_periodo: string;
  periodo_codigo?: string;
  id_lectura?: string;
  es_tercera_edad: number;
  valor_base: number;
  consumo_m3: number;
  excedente_m3: number;
  valor_excedente: number;
  valor_alcantarillado: number;
  valor_multas: number;
  valor_deuda_anterior: number;
  total_mes: number;
  total_pagar: number;
  estado_pago: 'PENDIENTE' | 'PAGADO' | 'ANULADO';
  fecha_vencimiento: string;
  fecha_pago?: string;
  metodo_pago?: MetodoPago;
  id_cajero?: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export class FacturacionService {
  private mapRowToFactura(row: FacturaRow): Factura {
    return {
      id: row.id,
      numeroFactura: row.numero_factura,
      idSocio: row.id_socio,
      socioNombre: row.socio_nombre,
      socioCedula: row.socio_cedula,
      idPeriodo: row.id_periodo,
      periodoCodigo: row.periodo_codigo,
      idLectura: row.id_lectura || undefined,
      esTerceraEdad: Boolean(row.es_tercera_edad),
      valorBase: row.valor_base,
      consumoM3: row.consumo_m3,
      excedenteM3: row.excedente_m3,
      valorExcedente: row.valor_excedente,
      valorAlcantarillado: row.valor_alcantarillado,
      valorMultas: row.valor_multas,
      valorDeudaAnterior: row.valor_deuda_anterior,
      totalMes: row.total_mes,
      totalPagar: row.total_pagar,
      estadoPago: row.estado_pago,
      fechaVencimiento: row.fecha_vencimiento,
      fechaPago: row.fecha_pago || undefined,
      metodoPago: row.metodo_pago || undefined,
      idCajero: row.id_cajero || undefined,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public resolvePeriodoId(input?: string): string {
    const db = sqliteDb.getRawDb();
    if (input && input.trim() && !input.startsWith('{{')) {
      const clean = input.trim();
      const byId = db.prepare('SELECT id FROM periodos WHERE id = ?').get(clean) as { id: string } | undefined;
      if (byId) return byId.id;

      const byCode = db.prepare('SELECT id FROM periodos WHERE periodo_codigo = ?').get(clean) as { id: string } | undefined;
      if (byCode) return byCode.id;
    }

    const first = db.prepare("SELECT id FROM periodos WHERE estado = 'ABIERTO' ORDER BY fecha_inicio DESC LIMIT 1").get() as { id: string } | undefined;
    if (!first) throw new Error('No hay períodos de facturación abiertos.');
    return first.id;
  }

  public resolveCajeroId(input?: string): string {
    const db = sqliteDb.getRawDb();
    if (input && input.trim() && !input.startsWith('{{')) {
      const clean = input.trim();
      const byId = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(clean) as { id: string } | undefined;
      if (byId) return byId.id;
    }

    const first = db.prepare("SELECT id FROM usuarios WHERE rol IN ('CAJERO', 'ADMIN') AND activo = 1 LIMIT 1").get() as { id: string } | undefined;
    if (!first) throw new Error('No hay cajero o administrador disponible.');
    return first.id;
  }

  public getTarifasConfig(): TarifaConfig {
    const db = sqliteDb.getRawDb();
    const row = db.prepare('SELECT * FROM tarifas_config WHERE activo = 1 ORDER BY created_at DESC LIMIT 1').get() as Record<
      string,
      unknown
    >;

    return {
      id: row.id as string,
      cargoFijoNormal: row.cargo_fijo_normal as number,
      cargoFijoTerceraEdad: row.cargo_fijo_tercera_edad as number,
      limiteBaseM3: row.limite_base_m3 as number,
      costoExcedenteM3: row.costo_excedente_m3 as number,
      recargoAlcantarillado: row.recargo_alcantarillado as number,
      repartoNormalPadre: row.reparto_normal_padre as number,
      repartoNormalOperacion: row.reparto_normal_operacion as number,
      repartoNormalLector: row.reparto_normal_lector as number,
      repartoNormalMortuorio: row.reparto_normal_mortuorio as number,
      activo: Boolean(row.activo),
      createdAt: row.created_at as string
    };
  }

  public updateTarifasConfig(data: Partial<TarifaConfig>): TarifaConfig {
    const db = sqliteDb.getRawDb();
    const actual = this.getTarifasConfig();

    db.prepare(`
      UPDATE tarifas_config SET
        cargo_fijo_normal = COALESCE(?, cargo_fijo_normal),
        cargo_fijo_tercera_edad = COALESCE(?, cargo_fijo_tercera_edad),
        limite_base_m3 = COALESCE(?, limite_base_m3),
        costo_excedente_m3 = COALESCE(?, costo_excedente_m3),
        recargo_alcantarillado = COALESCE(?, recargo_alcantarillado),
        reparto_normal_padre = COALESCE(?, reparto_normal_padre),
        reparto_normal_operacion = COALESCE(?, reparto_normal_operacion),
        reparto_normal_lector = COALESCE(?, reparto_normal_lector),
        reparto_normal_mortuorio = COALESCE(?, reparto_normal_mortuorio)
      WHERE id = ?
    `).run(
      data.cargoFijoNormal ?? null,
      data.cargoFijoTerceraEdad ?? null,
      data.limiteBaseM3 ?? null,
      data.costoExcedenteM3 ?? null,
      data.recargoAlcantarillado ?? null,
      data.repartoNormalPadre ?? null,
      data.repartoNormalOperacion ?? null,
      data.repartoNormalLector ?? null,
      data.repartoNormalMortuorio ?? null,
      actual.id
    );

    return this.getTarifasConfig();
  }

  public liquidarFacturaMes(idSocio: string, idPeriodo?: string): Factura {
    const db = sqliteDb.getRawDb();
    const socio = socioService.getSocioById(idSocio);
    if (!socio) throw new Error('Socio no encontrado.');

    const resolvedPeriodoId = this.resolvePeriodoId(idPeriodo);
    const tarifa = this.getTarifasConfig();

    // 1. Evaluación dinámica de 3ra edad
    const esTerceraEdad = ValidationRules.calcularEsTerceraEdad(socio.fechaNacimiento);
    const valorBase = esTerceraEdad ? tarifa.cargoFijoTerceraEdad : tarifa.cargoFijoNormal;

    // 2. Obtener lectura si existe
    const lecturaRow = db
      .prepare('SELECT id, consumo_total, excedente_m3 FROM lecturas WHERE id_socio = ? AND id_periodo = ?')
      .get(idSocio, resolvedPeriodoId) as { id: string; consumo_total: number; excedente_m3: number } | undefined;

    const consumoM3 = lecturaRow ? lecturaRow.consumo_total : 0.0;
    const excedenteM3 = lecturaRow ? lecturaRow.excedente_m3 : 0.0;
    const valorExcedente = Number((excedenteM3 * tarifa.costoExcedenteM3).toFixed(2));

    // 3. Alcantarillado
    const valorAlcantarillado = socio.tieneAlcantarillado ? tarifa.recargoAlcantarillado : 0.0;

    // Total del mes actual
    const totalMes = Number((valorBase + valorExcedente + valorAlcantarillado).toFixed(2));

    // 4. Multas y rubros pendientes
    const multasStats = db
      .prepare('SELECT COALESCE(SUM(monto), 0) as total_multas FROM multas_rubros WHERE id_socio = ? AND pagado = 0')
      .get(idSocio) as { total_multas: number };
    const valorMultas = Number(multasStats.total_multas.toFixed(2));

    // 5. Deuda anterior acumulada de facturas pendientes (excluyendo el período actual)
    const deudaAnteriorStats = db
      .prepare(`
        SELECT COALESCE(SUM(total_mes), 0) as total_anterior
        FROM facturas
        WHERE id_socio = ? AND id_periodo != ? AND estado_pago = 'PENDIENTE'
      `)
      .get(idSocio, resolvedPeriodoId) as { total_anterior: number };
    const valorDeudaAnterior = Number(deudaAnteriorStats.total_anterior.toFixed(2));

    // Total a liquidar
    const totalPagar = Number((totalMes + valorMultas + valorDeudaAnterior).toFixed(2));

    const now = new Date().toISOString();
    const fechaVencimiento = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Verificar si ya existe factura emitida para este período
    const existente = db
      .prepare('SELECT id, numero_factura, estado_pago FROM facturas WHERE id_socio = ? AND id_periodo = ?')
      .get(idSocio, resolvedPeriodoId) as { id: string; numero_factura: string; estado_pago: string } | undefined;

    let id = existente?.id;

    if (existente) {
      if (existente.estado_pago === 'PAGADO') {
        throw new Error('La factura para este período ya ha sido cobrada y se encuentra bloqueada.');
      }
      db.prepare(`
        UPDATE facturas SET
          id_lectura = ?,
          es_tercera_edad = ?,
          valor_base = ?,
          consumo_m3 = ?,
          excedente_m3 = ?,
          valor_excedente = ?,
          valor_alcantarillado = ?,
          valor_multas = ?,
          valor_deuda_anterior = ?,
          total_mes = ?,
          total_pagar = ?,
          fecha_vencimiento = ?,
          version = version + 1,
          updated_at = ?
        WHERE id = ?
      `).run(
        lecturaRow ? lecturaRow.id : null,
        esTerceraEdad ? 1 : 0,
        valorBase,
        consumoM3,
        excedenteM3,
        valorExcedente,
        valorAlcantarillado,
        valorMultas,
        valorDeudaAnterior,
        totalMes,
        totalPagar,
        fechaVencimiento,
        now,
        existente.id
      );
    } else {
      id = crypto.randomUUID();
      const numCorrelativo = String(Date.now()).slice(-6);
      const numeroFactura = `FAC-${new Date().getFullYear()}-${numCorrelativo}`;

      db.prepare(`
        INSERT INTO facturas (
          id, numero_factura, id_socio, id_periodo, id_lectura, es_tercera_edad,
          valor_base, consumo_m3, excedente_m3, valor_excedente, valor_alcantarillado,
          valor_multas, valor_deuda_anterior, total_mes, total_pagar, estado_pago,
          fecha_vencimiento, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, 1, ?, ?)
      `).run(
        id,
        numeroFactura,
        idSocio,
        resolvedPeriodoId,
        lecturaRow ? lecturaRow.id : null,
        esTerceraEdad ? 1 : 0,
        valorBase,
        consumoM3,
        excedenteM3,
        valorExcedente,
        valorAlcantarillado,
        valorMultas,
        valorDeudaAnterior,
        totalMes,
        totalPagar,
        fechaVencimiento,
        now,
        now
      );
    }

    return this.getFacturaById(id!)!;
  }

  public liquidarPeriodo(idPeriodo?: string): { totalLiquidados: number; facturas: Factura[] } {
    const db = sqliteDb.getRawDb();
    const resolvedPeriodoId = this.resolvePeriodoId(idPeriodo);
    const socios = db.prepare("SELECT id FROM socios WHERE estado = 'ACTIVO'").all() as { id: string }[];

    const facturas: Factura[] = [];
    for (const s of socios) {
      try {
        const fac = this.liquidarFacturaMes(s.id, resolvedPeriodoId);
        facturas.push(fac);
      } catch (err) {
        console.error(`[FacturacionService] Error liquidando socio ${s.id}:`, err);
      }
    }

    return { totalLiquidados: facturas.length, facturas };
  }

  public getFacturas(filters?: {
    socioId?: string;
    periodoId?: string;
    estadoPago?: string;
  }): Factura[] {
    const db = sqliteDb.getRawDb();
    let query = `
      SELECT f.*, s.nombres || ' ' || s.apellidos as socio_nombre, s.cedula_ruc as socio_cedula, p.periodo_codigo
      FROM facturas f
      JOIN socios s ON f.id_socio = s.id
      JOIN periodos p ON f.id_periodo = p.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filters?.socioId) {
      query += ' AND f.id_socio = ?';
      params.push(filters.socioId);
    }
    if (filters?.periodoId) {
      query += ' AND f.id_periodo = ?';
      params.push(filters.periodoId);
    }
    if (filters?.estadoPago) {
      query += ' AND f.estado_pago = ?';
      params.push(filters.estadoPago);
    }

    query += ' ORDER BY f.created_at DESC';
    const rows = db.prepare(query).all(...params) as FacturaRow[];
    return rows.map((r) => this.mapRowToFactura(r));
  }

  public getFacturaById(id: string): Factura | null {
    const db = sqliteDb.getRawDb();
    const row = db
      .prepare(`
        SELECT f.*, s.nombres || ' ' || s.apellidos as socio_nombre, s.cedula_ruc as socio_cedula, p.periodo_codigo
        FROM facturas f
        JOIN socios s ON f.id_socio = s.id
        JOIN periodos p ON f.id_periodo = p.id
        WHERE f.id = ?
      `)
      .get(id) as FacturaRow | undefined;

    return row ? this.mapRowToFactura(row) : null;
  }

  public cobrarFactura(
    idFactura: string,
    data: {
      metodoPago: MetodoPago;
      idCajero?: string;
      fechaPago?: string;
    }
  ): Factura {
    const db = sqliteDb.getRawDb();
    const factura = this.getFacturaById(idFactura);
    if (!factura) throw new Error('Factura no encontrada.');

    if (factura.estadoPago === 'PAGADO') {
      throw new Error(`La factura #${factura.numeroFactura} ya se encuentra pagada.`);
    }

    const resolvedCajeroId = this.resolveCajeroId(data.idCajero);
    const now = new Date().toISOString();
    const fechaPago = data.fechaPago || now;

    // 1. Marcar factura como PAGADA
    db.prepare(`
      UPDATE facturas SET
        estado_pago = 'PAGADO',
        fecha_pago = ?,
        metodo_pago = ?,
        id_cajero = ?,
        version = version + 1,
        updated_at = ?
      WHERE id = ?
    `).run(fechaPago, data.metodoPago, resolvedCajeroId, now, idFactura);

    // 2. Marcar multas asociadas como pagadas
    db.prepare(`
      UPDATE multas_rubros SET
        pagado = 1,
        id_factura = ?
      WHERE id_socio = ? AND pagado = 0
    `).run(idFactura, factura.idSocio);

    // 3. Disparar distribución contable en el Libro Mayor de 3 Columnas
    fondosService.distribuirFondosFactura({
      id: factura.id,
      numeroFactura: factura.numeroFactura,
      esTerceraEdad: factura.esTerceraEdad,
      valorBase: factura.valorBase,
      valorExcedente: factura.valorExcedente,
      valorAlcantarillado: factura.valorAlcantarillado,
      valorMultas: factura.valorMultas,
      idCajero: resolvedCajeroId,
      socioNombre: factura.socioNombre
    });

    return this.getFacturaById(idFactura)!;
  }

  public crearMulta(data: {
    idSocio: string;
    tipoRubro: MultaRubro['tipoRubro'];
    monto: number;
    motivo: string;
    idPeriodo?: string;
  }): MultaRubro {
    const db = sqliteDb.getRawDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const resolvedPeriodoId = data.idPeriodo ? this.resolvePeriodoId(data.idPeriodo) : null;

    db.prepare(`
      INSERT INTO multas_rubros (id, id_socio, id_periodo, tipo_rubro, monto, motivo, pagado, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, data.idSocio, resolvedPeriodoId, data.tipoRubro, data.monto, data.motivo, now);

    return {
      id,
      idSocio: data.idSocio,
      idPeriodo: resolvedPeriodoId || undefined,
      tipoRubro: data.tipoRubro,
      monto: data.monto,
      motivo: data.motivo,
      pagado: false,
      createdAt: now
    };
  }

  public getMultas(filters?: { socioId?: string; pagado?: boolean }): MultaRubro[] {
    const db = sqliteDb.getRawDb();
    let query = 'SELECT * FROM multas_rubros WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.socioId) {
      query += ' AND id_socio = ?';
      params.push(filters.socioId);
    }
    if (filters?.pagado !== undefined) {
      query += ' AND pagado = ?';
      params.push(filters.pagado ? 1 : 0);
    }

    query += ' ORDER BY created_at DESC';
    const rows = db.prepare(query).all(...params) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r.id as string,
      idSocio: r.id_socio as string,
      idPeriodo: (r.id_periodo as string) || undefined,
      tipoRubro: r.tipo_rubro as MultaRubro['tipoRubro'],
      monto: r.monto as number,
      motivo: r.motivo as string,
      pagado: Boolean(r.pagado),
      idFactura: (r.id_factura as string) || undefined,
      createdAt: r.created_at as string
    }));
  }
}

export const facturacionService = new FacturacionService();
