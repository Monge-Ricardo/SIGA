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
  monto_pagado?: number;
  saldo_pendiente?: number;
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
    const totalPagar = row.total_pagar;
    const montoPagado = row.monto_pagado !== undefined && row.monto_pagado !== null ? Number(row.monto_pagado) : (row.estado_pago === 'PAGADO' ? totalPagar : 0.0);
    const saldoPendiente = row.saldo_pendiente !== undefined && row.saldo_pendiente !== null ? Number(row.saldo_pendiente) : (row.estado_pago === 'PAGADO' ? 0.0 : totalPagar);

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
      montoPagado,
      saldoPendiente,
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

  public liquidarFacturaMes(
    idSocio: string,
    idPeriodo?: string,
    options?: {
      multasIds?: string[];
      deudasAnterioresIds?: string[];
    }
  ): Factura {
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

    // 4. Multas y rubros pendientes (seleccionados o todos)
    let valorMultas = 0.0;
    if (Array.isArray(options?.multasIds)) {
      if (options.multasIds.length > 0) {
        const placeholders = options.multasIds.map(() => '?').join(',');
        const multasStats = db
          .prepare(
            `SELECT COALESCE(SUM(monto), 0) as total_multas FROM multas_rubros WHERE id_socio = ? AND id IN (${placeholders}) AND pagado = 0`
          )
          .get(idSocio, ...options.multasIds) as { total_multas: number };
        valorMultas = Number(multasStats.total_multas.toFixed(2));
      } else {
        valorMultas = 0.0;
      }
    } else {
      const multasStats = db
        .prepare('SELECT COALESCE(SUM(monto), 0) as total_multas FROM multas_rubros WHERE id_socio = ? AND pagado = 0')
        .get(idSocio) as { total_multas: number };
      valorMultas = Number(multasStats.total_multas.toFixed(2));
    }

    // 5. Deuda anterior acumulada de facturas pendientes (seleccionadas o todas)
    let valorDeudaAnterior = 0.0;
    if (Array.isArray(options?.deudasAnterioresIds)) {
      if (options.deudasAnterioresIds.length > 0) {
        const placeholders = options.deudasAnterioresIds.map(() => '?').join(',');
        const deudaStats = db
          .prepare(
            `SELECT COALESCE(SUM(CASE WHEN saldo_pendiente > 0 THEN saldo_pendiente ELSE total_mes END), 0) as total_anterior FROM facturas WHERE id_socio = ? AND id IN (${placeholders}) AND estado_pago = 'PENDIENTE'`
          )
          .get(idSocio, ...options.deudasAnterioresIds) as { total_anterior: number };
        valorDeudaAnterior = Number(deudaStats.total_anterior.toFixed(2));
      } else {
        valorDeudaAnterior = 0.0;
      }
    } else {
      const deudaAnteriorStats = db
        .prepare(`
          SELECT COALESCE(SUM(CASE WHEN saldo_pendiente > 0 THEN saldo_pendiente ELSE total_mes END), 0) as total_anterior
          FROM facturas
          WHERE id_socio = ? AND id_periodo != ? AND estado_pago = 'PENDIENTE'
        `)
        .get(idSocio, resolvedPeriodoId) as { total_anterior: number };
      valorDeudaAnterior = Number(deudaAnteriorStats.total_anterior.toFixed(2));
    }

    // Total a liquidar
    const totalPagar = Number((totalMes + valorMultas + valorDeudaAnterior).toFixed(2));

    const now = new Date().toISOString();
    const fechaVencimiento = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Verificar si ya existe factura emitida para este período
    const existente = db
      .prepare('SELECT id, numero_factura, estado_pago, monto_pagado, saldo_pendiente FROM facturas WHERE id_socio = ? AND id_periodo = ?')
      .get(idSocio, resolvedPeriodoId) as { id: string; numero_factura: string; estado_pago: string; monto_pagado?: number; saldo_pendiente?: number } | undefined;

    let id = existente?.id;

    if (existente) {
      if (existente.estado_pago === 'PAGADO') {
        throw new Error('La factura para este período ya ha sido cobrada y se encuentra bloqueada.');
      }
      const montoPagadoActual = existente.monto_pagado || 0;
      const nuevoSaldoPendiente = Math.max(0, Number((totalPagar - montoPagadoActual).toFixed(2)));

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
          saldo_pendiente = ?,
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
        nuevoSaldoPendiente,
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
          valor_multas, valor_deuda_anterior, total_mes, total_pagar, monto_pagado, saldo_pendiente, estado_pago,
          fecha_vencimiento, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?, 'PENDIENTE', ?, 1, ?, ?)
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
      multasIds?: string[];
      deudasAnterioresIds?: string[];
      montoCobrado?: number;
    }
  ): Factura {
    const db = sqliteDb.getRawDb();
    const factura = this.getFacturaById(idFactura);
    if (!factura) throw new Error('Factura no encontrada.');

    if (factura.estadoPago === 'PAGADO' && (!factura.saldoPendiente || factura.saldoPendiente <= 0)) {
      throw new Error(`La factura #${factura.numeroFactura} ya se encuentra pagada.`);
    }

    const resolvedCajeroId = this.resolveCajeroId(data.idCajero);
    const now = new Date().toISOString();
    const fechaPago = data.fechaPago || now;

    const deudaActual = factura.saldoPendiente !== undefined && factura.saldoPendiente > 0
      ? factura.saldoPendiente
      : factura.totalPagar;

    const montoCobrado = data.montoCobrado !== undefined && !isNaN(data.montoCobrado) && data.montoCobrado > 0
      ? Number(data.montoCobrado.toFixed(2))
      : deudaActual;

    const montoPrevio = factura.montoPagado || 0;
    const nuevoMontoPagado = Number((montoPrevio + montoCobrado).toFixed(2));
    const nuevoSaldoPendiente = Math.max(0, Number((factura.totalPagar - nuevoMontoPagado).toFixed(2)));
    const esPagoCompleto = nuevoSaldoPendiente <= 0.001;
    const nuevoEstadoPago = esPagoCompleto ? 'PAGADO' : 'PENDIENTE';

    // 1. Actualizar factura con nuevo saldo y monto pagado
    db.prepare(`
      UPDATE facturas SET
        estado_pago = ?,
        monto_pagado = ?,
        saldo_pendiente = ?,
        fecha_pago = ?,
        metodo_pago = ?,
        id_cajero = ?,
        version = version + 1,
        updated_at = ?
      WHERE id = ?
    `).run(
      nuevoEstadoPago,
      nuevoMontoPagado,
      nuevoSaldoPendiente,
      fechaPago,
      data.metodoPago,
      resolvedCajeroId,
      now,
      idFactura
    );

    // 2. Marcar multas asociadas como pagadas y vinculadas a la factura
    if (Array.isArray(data.multasIds) && data.multasIds.length > 0) {
      const placeholders = data.multasIds.map(() => '?').join(',');
      db.prepare(`
        UPDATE multas_rubros SET
          pagado = 1,
          id_factura = ?
        WHERE id_socio = ? AND id IN (${placeholders}) AND pagado = 0
      `).run(idFactura, factura.idSocio, ...data.multasIds);
    } else if (factura.valorMultas > 0) {
      db.prepare(`
        UPDATE multas_rubros SET
          pagado = 1,
          id_factura = ?
        WHERE id_socio = ? AND pagado = 0
      `).run(idFactura, factura.idSocio);
    }

    // 2.1 Si se seleccionaron deudas de meses anteriores, marcarlas como PAGADAS
    if (Array.isArray(data.deudasAnterioresIds) && data.deudasAnterioresIds.length > 0) {
      for (const idAnterior of data.deudasAnterioresIds) {
        const facAnt = this.getFacturaById(idAnterior);
        if (facAnt && facAnt.estadoPago === 'PENDIENTE') {
          db.prepare(`
            UPDATE facturas SET
              estado_pago = 'PAGADO',
              monto_pagado = total_pagar,
              saldo_pendiente = 0,
              fecha_pago = ?,
              metodo_pago = ?,
              id_cajero = ?,
              version = version + 1,
              updated_at = ?
            WHERE id = ?
          `).run(fechaPago, data.metodoPago, resolvedCajeroId, now, idAnterior);

          fondosService.distribuirFondosFactura({
            id: facAnt.id,
            numeroFactura: facAnt.numeroFactura,
            esTerceraEdad: facAnt.esTerceraEdad,
            valorBase: facAnt.valorBase,
            valorExcedente: facAnt.valorExcedente,
            valorAlcantarillado: facAnt.valorAlcantarillado,
            valorMultas: facAnt.valorMultas,
            montoCobrado: facAnt.saldoPendiente || facAnt.totalPagar,
            idCajero: resolvedCajeroId,
            socioNombre: facAnt.socioNombre
          });
        }
      }
    }

    // 3. Disparar distribución contable en el Libro Mayor de 3 Columnas
    fondosService.distribuirFondosFactura({
      id: factura.id,
      numeroFactura: factura.numeroFactura,
      esTerceraEdad: factura.esTerceraEdad,
      valorBase: factura.valorBase,
      valorExcedente: factura.valorExcedente,
      valorAlcantarillado: factura.valorAlcantarillado,
      valorMultas: factura.valorMultas,
      montoCobrado,
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

  public updateMulta(
    id: string,
    data: {
      tipoRubro?: MultaRubro['tipoRubro'];
      monto?: number;
      motivo?: string;
    }
  ): MultaRubro {
    const db = sqliteDb.getRawDb();
    const existing = db.prepare('SELECT * FROM multas_rubros WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) throw new Error('Multa no encontrada.');
    if (existing.pagado) throw new Error('No se puede editar una multa que ya ha sido pagada.');

    db.prepare(`
      UPDATE multas_rubros SET
        tipo_rubro = COALESCE(?, tipo_rubro),
        monto = COALESCE(?, monto),
        motivo = COALESCE(?, motivo)
      WHERE id = ?
    `).run(
      data.tipoRubro ?? null,
      data.monto !== undefined ? Number(data.monto) : null,
      data.motivo ? data.motivo.trim() : null,
      id
    );

    const updated = db.prepare('SELECT * FROM multas_rubros WHERE id = ?').get(id) as Record<string, unknown>;
    return {
      id: updated.id as string,
      idSocio: updated.id_socio as string,
      idPeriodo: (updated.id_periodo as string) || undefined,
      tipoRubro: updated.tipo_rubro as MultaRubro['tipoRubro'],
      monto: updated.monto as number,
      motivo: updated.motivo as string,
      pagado: Boolean(updated.pagado),
      idFactura: (updated.id_factura as string) || undefined,
      createdAt: updated.created_at as string
    };
  }

  public deleteMulta(id: string): { success: boolean; message: string; id: string } {
    const db = sqliteDb.getRawDb();
    const existing = db.prepare('SELECT * FROM multas_rubros WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) throw new Error('Multa no encontrada.');
    if (existing.pagado) throw new Error('No se puede eliminar una multa que ya ha sido cobrada.');

    db.prepare('DELETE FROM multas_rubros WHERE id = ?').run(id);
    return { success: true, message: 'Multa eliminada exitosamente.', id };
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

  public deleteFactura(id: string): { success: boolean; message: string; facturaId: string; numeroFactura: string } {
    const db = sqliteDb.getRawDb();
    const factura = this.getFacturaById(id);
    if (!factura) {
      throw new Error(`La factura con ID '${id}' no existe o ya fue eliminada.`);
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Eliminar asientos asociados a esta factura en el Libro Mayor de Fondos
      db.prepare('DELETE FROM fondos_movimientos WHERE id_factura = ?').run(id);

      // 2. Restablecer multas cobradas en esta factura a estado no pagado y desvincularlas
      db.prepare('UPDATE multas_rubros SET pagado = 0, id_factura = NULL WHERE id_factura = ?').run(id);

      // 3. Eliminar la factura
      db.prepare('DELETE FROM facturas WHERE id = ?').run(id);

      db.exec('COMMIT;');

      return {
        success: true,
        message: `Factura #${factura.numeroFactura} eliminada exitosamente. Se han revertido los fondos contables y restablecido las deudas correspondientes.`,
        facturaId: id,
        numeroFactura: factura.numeroFactura
      };
    } catch (err: unknown) {
      db.exec('ROLLBACK;');
      const errorMsg = err instanceof Error ? err.message : 'Error al eliminar factura en base de datos.';
      throw new Error(`Error en reversión al eliminar factura: ${errorMsg}`);
    }
  }
}

export const facturacionService = new FacturacionService();
