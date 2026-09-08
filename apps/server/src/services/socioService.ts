import crypto from 'node:crypto';
import { sqliteDb } from '../db/sqlite.ts';
import { supabaseClient } from '../db/supabase.ts';
import { ValidationRules } from '../shared.ts';
import type { Socio, EstadoCuentaSocio, Factura, MultaRubro, Medidor } from '../shared.ts';


interface SocioRow {
  id: string;
  codigo_socio: string;
  nombres: string;
  apellidos: string;
  cedula_ruc: string;
  fecha_nacimiento: string;
  fecha_union: string;
  id_sector?: string;
  nombre_sector?: string;
  medidor_numero?: string;
  tiene_alcantarillado?: number;
  telefono?: string;
  direccion: string;
  estado: 'ACTIVO' | 'SUSPENDIDO' | 'CORTADO';
  version: number;
  created_at: string;
  updated_at: string;
}

export class SocioService {
  public getMedidoresBySocioId(socioId: string): Medidor[] {
    const db = sqliteDb.getRawDb();
    const rows = db.prepare(`
      SELECT m.*, sec.nombre_sector, sec.codigo_sector
      FROM medidores m
      LEFT JOIN sectores sec ON m.id_sector = sec.id
      WHERE m.id_socio = ?
      ORDER BY m.created_at ASC
    `).all(socioId) as any[];

    return rows.map((r) => ({
      id: r.id,
      idSocio: r.id_socio,
      idSector: r.id_sector,
      numeroMedidor: r.numero_medidor,
      alias: r.alias || 'Casa principal',
      direccion: r.direccion || undefined,
      tieneAlcantarillado: Boolean(r.tiene_alcantarillado),
      estado: r.estado,
      nombreSector: r.nombre_sector || undefined,
      codigoSector: r.codigo_sector || undefined,
      version: r.version,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  private mapRowToSocio(row: SocioRow): Socio {
    const db = sqliteDb.getRawDb();
    const esTerceraEdad = ValidationRules.calcularEsTerceraEdad(row.fecha_nacimiento);
    const medidores = this.getMedidoresBySocioId(row.id);
    const primario = medidores[0];

    // Consultar deudas pendientes del socio
    const debtRow = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN saldo_pendiente > 0 THEN saldo_pendiente ELSE total_pagar END), 0) as totalDeuda, COUNT(*) as meses, MIN(fecha_vencimiento) as fechaDeuda
      FROM facturas
      WHERE id_socio = ? AND estado_pago = 'PENDIENTE'
    `).get(row.id) as any;

    const montoTotalAdeudado = Number((debtRow?.totalDeuda || 0).toFixed(2));
    const mesesAdeudados = Number(debtRow?.meses || 0);

    return {
      id: row.id,
      codigoSocio: row.codigo_socio,
      nombres: row.nombres,
      apellidos: row.apellidos,
      nombreCompleto: `${row.nombres} ${row.apellidos}`.trim(),
      cedulaRuc: row.cedula_ruc,
      fechaNacimiento: row.fecha_nacimiento,
      esTerceraEdad,
      fechaUnion: row.fecha_union,
      idSector: primario ? primario.idSector : (row.id_sector || ''),
      nombreSector: primario ? primario.nombreSector : row.nombre_sector,
      medidorNumero: primario ? primario.numeroMedidor : (row.medidor_numero || 'S/N'),
      tieneAlcantarillado: primario ? primario.tieneAlcantarillado : Boolean(row.tiene_alcantarillado),
      telefono: row.telefono || undefined,
      direccion: row.direccion,
      estado: row.estado,
      montoTotalAdeudado,
      mesesAdeudados,
      estadoCuenta: montoTotalAdeudado > 0 ? 'EN_MORA' : 'AL_DIA',
      fechaDeudaAntigua: debtRow?.fechaDeuda || undefined,
      medidores,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Resuelve y valida estrictamente el sector.
   * NO asigna sectores por defecto: si no se especifica o no existe, lanza un error claro.
   */
  public resolveSectorId(input?: string): string {
    const db = sqliteDb.getRawDb();

    if (!input || !input.trim() || input.startsWith('{{')) {
      const first = db.prepare('SELECT id FROM sectores WHERE activo = 1 ORDER BY codigo_sector ASC LIMIT 1').get() as { id: string } | undefined;
      if (first) return first.id;
      throw new Error('No hay sectores disponibles en el sistema.');
    }

    const cleanInput = input.trim();

    // 1. Por ID UUID directo
    const byId = db.prepare('SELECT id FROM sectores WHERE id = ?').get(cleanInput) as { id: string } | undefined;
    if (byId) return byId.id;

    // 2. Por código de sector (ej: SEC-PASO, SEC-CENTRO, etc.)
    const byCode = db.prepare('SELECT id FROM sectores WHERE UPPER(codigo_sector) = ?').get(cleanInput.toUpperCase()) as { id: string } | undefined;
    if (byCode) return byCode.id;

    // 3. Mapeo de códigos legacy/demo (SEC-01 -> SEC-PASO, etc.)
    const legacyMap: Record<string, string> = {
      'SEC-01': 'SEC-PASO',
      'SEC-02': 'SEC-SANJOSE',
      'SEC-03': 'SEC-CENTRO',
      'SEC-04': 'SEC-SANANTONIO',
      'SEC-05': 'SEC-SANJOSE'
    };
    const mappedCode = legacyMap[cleanInput.toUpperCase()];
    if (mappedCode) {
      const byMapped = db.prepare('SELECT id FROM sectores WHERE UPPER(codigo_sector) = ?').get(mappedCode) as { id: string } | undefined;
      if (byMapped) return byMapped.id;
    }

    // 4. Por nombre de sector (ej: Paso Lateral, Centro, etc.)
    const byName = db.prepare('SELECT id FROM sectores WHERE nombre_sector LIKE ?').get(`%${cleanInput}%`) as { id: string } | undefined;
    if (byName) return byName.id;

    // 5. Fallback al primer sector activo disponible
    const fallback = db.prepare('SELECT id FROM sectores WHERE activo = 1 ORDER BY codigo_sector ASC LIMIT 1').get() as { id: string } | undefined;
    if (fallback) return fallback.id;

    throw new Error(
      `El sector '${input}' no existe en el sistema. Debe registrar el sector previamente o seleccionar uno existente.`
    );
  }

  public getSocios(filters?: { sectorId?: string; estado?: string; search?: string }): Socio[] {
    const db = sqliteDb.getRawDb();
    let query = `
      SELECT s.*, sec.nombre_sector
      FROM socios s
      LEFT JOIN sectores sec ON s.id_sector = sec.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filters?.sectorId) {
      query += ' AND s.id_sector = ?';
      params.push(filters.sectorId);
    }
    if (filters?.estado) {
      query += ' AND s.estado = ?';
      params.push(filters.estado);
    }
    if (filters?.search) {
      query += ' AND (s.nombres LIKE ? OR s.apellidos LIKE ? OR s.cedula_ruc LIKE ? OR s.codigo_socio LIKE ? OR s.medidor_numero LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term, term, term);
    }

    query += ' ORDER BY s.apellidos ASC, s.nombres ASC';
    const rows = db.prepare(query).all(...params) as SocioRow[];
    return rows.map((r) => this.mapRowToSocio(r));
  }

  public getSocioById(id: string): Socio | null {
    const db = sqliteDb.getRawDb();
    const row = db
      .prepare(`
        SELECT s.*, sec.nombre_sector
        FROM socios s
        LEFT JOIN sectores sec ON s.id_sector = sec.id
        WHERE s.id = ?
      `)
      .get(id) as SocioRow | undefined;

    return row ? this.mapRowToSocio(row) : null;
  }

  public getSocioByCedula(cedula: string): Socio | null {
    const db = sqliteDb.getRawDb();
    const row = db
      .prepare(`
        SELECT s.*, sec.nombre_sector
        FROM socios s
        LEFT JOIN sectores sec ON s.id_sector = sec.id
        WHERE s.cedula_ruc = ?
      `)
      .get(cedula) as SocioRow | undefined;

    return row ? this.mapRowToSocio(row) : null;
  }

  public createSocio(data: {
    codigoSocio?: string;
    nombres: string;
    apellidos: string;
    cedulaRuc: string;
    fechaNacimiento: string;
    fechaUnion?: string;
    idSector: string;
    medidorNumero: string;
    tieneAlcantarillado?: boolean;
    telefono?: string;
    direccion: string;
  }): Socio {
    const db = sqliteDb.getRawDb();

    if (!data.nombres || !data.apellidos || !data.cedulaRuc || !data.fechaNacimiento || !data.idSector || !data.medidorNumero) {
      throw new Error('Los campos nombres, apellidos, cedulaRuc, fechaNacimiento, idSector y medidorNumero son obligatorios.');
    }

    const cedulaLimpia = data.cedulaRuc.trim();

    // Comprobar duplicado de cédula
    const existeCedula = db.prepare('SELECT id FROM socios WHERE cedula_ruc = ?').get(cedulaLimpia);
    if (existeCedula) {
      throw new Error(`Ya existe un socio registrado con la cédula/RUC ${cedulaLimpia}`);
    }

    // Validación estricta del sector especificado (sin valores por defecto)
    const resolvedSectorId = this.resolveSectorId(data.idSector);

    const medidorNumero = data.medidorNumero.trim();

    // Comprobar duplicado de medidor en tabla medidores y socios
    const existeMedidor = db.prepare('SELECT id FROM medidores WHERE numero_medidor = ?').get(medidorNumero);
    if (existeMedidor) {
      throw new Error(`El número de medidor ${medidorNumero} ya está asignado a otro socio.`);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const codigo = data.codigoSocio || `SOC-${String(Date.now()).slice(-5)}`;
    const fechaUnion = data.fechaUnion || now.split('T')[0];
    const direccion = data.direccion ? data.direccion.trim() : 'Comunidad Principal';

    db.prepare(`
      INSERT INTO socios (
        id, codigo_socio, nombres, apellidos, cedula_ruc, fecha_nacimiento,
        fecha_union, id_sector, medidor_numero, tiene_alcantarillado,
        telefono, direccion, estado, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVO', 1, ?, ?)
    `).run(
      id,
      codigo,
      data.nombres.trim(),
      data.apellidos.trim(),
      cedulaLimpia,
      data.fechaNacimiento,
      fechaUnion,
      resolvedSectorId,
      medidorNumero,
      data.tieneAlcantarillado ? 1 : 0,
      data.telefono ? data.telefono.trim() : null,
      direccion,
      now,
      now
    );

    // Insertar acometida inicial en medidores
    const medidorId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO medidores (
        id, id_socio, id_sector, numero_medidor, alias,
        direccion, tiene_alcantarillado, estado, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Casa principal', ?, ?, 'ACTIVO', 1, ?, ?)
    `).run(
      medidorId,
      id,
      resolvedSectorId,
      medidorNumero,
      direccion,
      data.tieneAlcantarillado ? 1 : 0,
      now,
      now
    );

    // Auto-registrar en lecturas para el período abierto actual (si existe)
    const openPeriod = db.prepare("SELECT id FROM periodos WHERE estado = 'ABIERTO' ORDER BY fecha_inicio DESC LIMIT 1").get() as { id: string } | undefined;
    if (openPeriod) {
      const lecturaId = crypto.randomUUID();
      const adminUser = (db.prepare("SELECT id FROM usuarios WHERE rol IN ('ADMIN', 'CAJERO', 'LECTOR') LIMIT 1").get() as { id: string } | undefined)?.id || '00000000-0000-0000-0000-000000000001';
      db.prepare(`
        INSERT INTO lecturas (
          id, id_medidor, id_socio, id_periodo, lectura_anterior, lectura_actual,
          consumo_total, excedente_m3, fecha_lectura, id_lector, observaciones, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, 'Alta inicial de socio', 1, ?, ?)
      `).run(
        lecturaId,
        medidorId,
        id,
        openPeriod.id,
        now,
        adminUser,
        now,
        now
      );

      // Sync lectura inicial
      supabaseClient.syncRecord('lecturas', {
        id: lecturaId,
        id_medidor: medidorId,
        id_socio: id,
        id_periodo: openPeriod.id,
        lectura_anterior: 0,
        lectura_actual: 0,
        consumo_total: 0,
        excedente_m3: 0,
        fecha_lectura: now,
        id_lector: adminUser,
        observaciones: 'Alta inicial de socio',
        version: 1,
        created_at: now,
        updated_at: now
      }).catch((err) => console.warn('[Supabase Sync Lectura]', err));
    }

    // Sincronizar inmediatamente con Supabase Cloud
    supabaseClient.syncRecord('socios', {
      id,
      codigo_socio: codigo,
      nombres: data.nombres.trim(),
      apellidos: data.apellidos.trim(),
      cedula_ruc: cedulaLimpia,
      fecha_nacimiento: data.fechaNacimiento,
      fecha_union: fechaUnion,
      telefono: data.telefono ? data.telefono.trim() : null,
      direccion,
      estado: 'ACTIVO',
      version: 1,
      created_at: now,
      updated_at: now
    }).catch((err) => console.warn('[Supabase Sync Socio]', err));

    supabaseClient.syncRecord('medidores', {
      id: medidorId,
      id_socio: id,
      id_sector: resolvedSectorId,
      numero_medidor: medidorNumero,
      alias: 'Casa principal',
      direccion,
      tiene_alcantarillado: data.tieneAlcantarillado ? 1 : 0,
      estado: 'ACTIVO',
      version: 1,
      created_at: now,
      updated_at: now
    }).catch((err) => console.warn('[Supabase Sync Medidor]', err));


    return this.getSocioById(id)!;
  }

  public addMedidorToSocio(
    socioId: string,
    data: {
      numeroMedidor: string;
      idSector: string;
      alias?: string;
      direccion?: string;
      tieneAlcantarillado?: boolean;
    }
  ): Medidor {
    const db = sqliteDb.getRawDb();
    const socio = this.getSocioById(socioId);
    if (!socio) throw new Error('El socio especificado no existe.');

    const numero = data.numeroMedidor ? data.numeroMedidor.trim() : '';
    if (!numero) throw new Error('El número de medidor es obligatorio.');

    const existe = db.prepare('SELECT id FROM medidores WHERE numero_medidor = ?').get(numero);
    if (existe) throw new Error(`El número de medidor '${numero}' ya se encuentra registrado.`);

    const resolvedSectorId = this.resolveSectorId(data.idSector);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO medidores (
        id, id_socio, id_sector, numero_medidor, alias,
        direccion, tiene_alcantarillado, estado, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVO', 1, ?, ?)
    `).run(
      id,
      socioId,
      resolvedSectorId,
      numero,
      data.alias?.trim() || 'Acometida adicional',
      data.direccion?.trim() || socio.direccion,
      data.tieneAlcantarillado ? 1 : 0,
      now,
      now
    );

    // Auto-registrar lectura para acometida adicional en el período abierto
    const openPeriod = db.prepare("SELECT id FROM periodos WHERE estado = 'ABIERTO' ORDER BY fecha_inicio DESC LIMIT 1").get() as { id: string } | undefined;
    if (openPeriod) {
      const lecturaId = crypto.randomUUID();
      const adminUser = (db.prepare("SELECT id FROM usuarios WHERE rol IN ('ADMIN', 'CAJERO', 'LECTOR') LIMIT 1").get() as { id: string } | undefined)?.id || '00000000-0000-0000-0000-000000000001';
      db.prepare(`
        INSERT INTO lecturas (
          id, id_medidor, id_socio, id_periodo, lectura_anterior, lectura_actual,
          consumo_total, excedente_m3, fecha_lectura, id_lector, observaciones, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, 'Alta acometida adicional', 1, ?, ?)
      `).run(
        lecturaId,
        id,
        socioId,
        openPeriod.id,
        now,
        adminUser,
        now,
        now
      );

      // Sync lectura acometida adicional
      supabaseClient.syncRecord('lecturas', {
        id: lecturaId,
        id_medidor: id,
        id_socio: socioId,
        id_periodo: openPeriod.id,
        lectura_anterior: 0,
        lectura_actual: 0,
        consumo_total: 0,
        excedente_m3: 0,
        fecha_lectura: now,
        id_lector: adminUser,
        observaciones: 'Alta acometida adicional',
        version: 1,
        created_at: now,
        updated_at: now
      }).catch((err) => console.warn('[Supabase Sync Lectura Acometida]', err));
    }

    // Sync medidor adicional a Supabase
    supabaseClient.syncRecord('medidores', {
      id,
      id_socio: socioId,
      id_sector: resolvedSectorId,
      numero_medidor: numero,
      alias: data.alias?.trim() || 'Acometida adicional',
      direccion: data.direccion?.trim() || socio.direccion,
      tiene_alcantarillado: data.tieneAlcantarillado ? 1 : 0,
      estado: 'ACTIVO',
      version: 1,
      created_at: now,
      updated_at: now
    }).catch((err) => console.warn('[Supabase Sync Medidor]', err));

    const medidores = this.getMedidoresBySocioId(socioId);
    return medidores.find((m) => m.id === id)!;
  }


  public getMedidores(filters?: { sectorId?: string; socioId?: string; search?: string }): Medidor[] {
    const db = sqliteDb.getRawDb();
    let query = `
      SELECT m.*, sec.nombre_sector, sec.codigo_sector, s.nombres, s.apellidos, s.codigo_socio, s.cedula_ruc
      FROM medidores m
      JOIN socios s ON m.id_socio = s.id
      LEFT JOIN sectores sec ON m.id_sector = sec.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filters?.sectorId) {
      query += ' AND m.id_sector = ?';
      params.push(filters.sectorId);
    }
    if (filters?.socioId) {
      query += ' AND m.id_socio = ?';
      params.push(filters.socioId);
    }
    if (filters?.search) {
      query += ' AND (m.numero_medidor LIKE ? OR m.alias LIKE ? OR s.nombres LIKE ? OR s.apellidos LIKE ? OR s.cedula_ruc LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term, term, term);
    }

    query += ' ORDER BY sec.nombre_sector ASC, m.numero_medidor ASC';
    const rows = db.prepare(query).all(...params) as any[];

    return rows.map((r) => ({
      id: r.id,
      idSocio: r.id_socio,
      idSector: r.id_sector,
      numeroMedidor: r.numero_medidor,
      alias: r.alias || 'Casa principal',
      direccion: r.direccion || undefined,
      tieneAlcantarillado: Boolean(r.tiene_alcantarillado),
      estado: r.estado,
      nombreSector: r.nombre_sector || undefined,
      codigoSector: r.codigo_sector || undefined,
      socioNombre: `${r.nombres} ${r.apellidos}`,
      socioCedula: r.cedula_ruc,
      socioCodigo: r.codigo_socio,
      version: r.version,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  public updateSocio(
    id: string,
    data: Partial<{
      nombres: string;
      apellidos: string;
      cedulaRuc: string;
      fechaNacimiento: string;
      idSector: string;
      medidorNumero: string;
      tieneAlcantarillado: boolean;
      telefono: string;
      direccion: string;
      estado: 'ACTIVO' | 'SUSPENDIDO' | 'CORTADO';
    }>
  ): Socio {
    const db = sqliteDb.getRawDb();
    const socio = this.getSocioById(id);
    if (!socio) {
      throw new Error('Socio no encontrado.');
    }

    const now = new Date().toISOString();
    const resolvedSectorId = data.idSector ? this.resolveSectorId(data.idSector) : null;

    db.prepare(`
      UPDATE socios SET
        nombres = COALESCE(?, nombres),
        apellidos = COALESCE(?, apellidos),
        cedula_ruc = COALESCE(?, cedula_ruc),
        fecha_nacimiento = COALESCE(?, fecha_nacimiento),
        id_sector = COALESCE(?, id_sector),
        medidor_numero = COALESCE(?, medidor_numero),
        tiene_alcantarillado = CASE WHEN ? IS NOT NULL THEN ? ELSE tiene_alcantarillado END,
        telefono = COALESCE(?, telefono),
        direccion = COALESCE(?, direccion),
        estado = COALESCE(?, estado),
        version = version + 1,
        updated_at = ?
      WHERE id = ?
    `).run(
      data.nombres ?? null,
      data.apellidos ?? null,
      data.cedulaRuc ?? null,
      data.fechaNacimiento ?? null,
      resolvedSectorId,
      data.medidorNumero ?? null,
      data.tieneAlcantarillado !== undefined ? (data.tieneAlcantarillado ? 1 : 0) : null,
      data.tieneAlcantarillado !== undefined ? (data.tieneAlcantarillado ? 1 : 0) : null,
      data.telefono ?? null,
      data.direccion ?? null,
      data.estado ?? null,
      now,
      id
    );

    const updated = this.getSocioById(id)!;

    // Sincronizar actualización con Supabase
    supabaseClient.syncRecord('socios', {
      id: updated.id,
      codigo_socio: updated.codigoSocio,
      nombres: updated.nombres,
      apellidos: updated.apellidos,
      cedula_ruc: updated.cedulaRuc,
      fecha_nacimiento: updated.fechaNacimiento,
      fecha_union: updated.fechaUnion,
      telefono: updated.telefono || null,
      direccion: updated.direccion,
      estado: updated.estado,
      version: updated.version,
      updated_at: now
    }).catch((err) => console.warn('[Supabase Sync Update Socio]', err));


    return updated;
  }


  public getEstadoCuenta(idSocio: string): EstadoCuentaSocio {
    const db = sqliteDb.getRawDb();
    const socio = this.getSocioById(idSocio);
    if (!socio) {
      throw new Error('Socio no encontrado.');
    }

    // Facturas del socio
    const facturasRows = db
      .prepare(`
        SELECT f.*, p.periodo_codigo
        FROM facturas f
        LEFT JOIN periodos p ON f.id_periodo = p.id
        WHERE f.id_socio = ?
        ORDER BY f.created_at DESC
      `)
      .all(idSocio) as Record<string, unknown>[];

    const historialFacturas: Factura[] = facturasRows.map((r) => {
      const totalPagar = r.total_pagar as number;
      const montoPagado = r.monto_pagado !== undefined && r.monto_pagado !== null ? Number(r.monto_pagado) : (r.estado_pago === 'PAGADO' ? totalPagar : 0.0);
      const saldoPendiente = r.saldo_pendiente !== undefined && r.saldo_pendiente !== null ? Number(r.saldo_pendiente) : (r.estado_pago === 'PAGADO' ? 0.0 : totalPagar);

      return {
        id: r.id as string,
        numeroFactura: r.numero_factura as string,
        idSocio: r.id_socio as string,
        idPeriodo: r.id_periodo as string,
        periodoCodigo: (r.periodo_codigo as string) || undefined,
        idLectura: (r.id_lectura as string) || undefined,
        esTerceraEdad: Boolean(r.es_tercera_edad),
        valorBase: r.valor_base as number,
        consumoM3: r.consumo_m3 as number,
        excedenteM3: r.excedente_m3 as number,
        valorExcedente: r.valor_excedente as number,
        valorAlcantarillado: r.valor_alcantarillado as number,
        valorMultas: r.valor_multas as number,
        valorDeudaAnterior: r.valor_deuda_anterior as number,
        totalMes: r.total_mes as number,
        totalPagar,
        montoPagado,
        saldoPendiente,
        estadoPago: r.estado_pago as Factura['estadoPago'],
        fechaVencimiento: r.fecha_vencimiento as string,
        fechaPago: (r.fecha_pago as string) || undefined,
        metodoPago: (r.metodo_pago as Factura['metodoPago']) || undefined,
        idCajero: (r.id_cajero as string) || undefined,
        version: r.version as number,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string
      };
    });

    const facturasPendientes = historialFacturas.filter((f) => f.estadoPago === 'PENDIENTE');

    // Multas pendientes (no liquidadas en facturas)
    const multasRows = db
      .prepare(`
        SELECT * FROM multas_rubros
        WHERE id_socio = ? AND pagado = 0 AND (id_factura IS NULL OR id_factura = '')
        ORDER BY created_at ASC
      `)
      .all(idSocio) as Record<string, unknown>[];

    const multasPendientes: MultaRubro[] = multasRows.map((m) => ({
      id: m.id as string,
      idSocio: m.id_socio as string,
      idPeriodo: (m.id_periodo as string) || undefined,
      tipoRubro: m.tipo_rubro as MultaRubro['tipoRubro'],
      monto: m.monto as number,
      motivo: m.motivo as string,
      pagado: Boolean(m.pagado),
      idFactura: (m.id_factura as string) || undefined,
      createdAt: m.created_at as string
    }));

    const totalFacturasPendientes = facturasPendientes.reduce((sum, f) => {
      const saldo = f.saldoPendiente !== undefined && f.saldoPendiente > 0 ? f.saldoPendiente : f.totalMes;
      return sum + saldo;
    }, 0);
    const totalMultasPendientes = multasPendientes.reduce((sum, m) => sum + m.monto, 0);
    const deudaTotalPendiente = Number((totalFacturasPendientes + totalMultasPendientes).toFixed(2));

    const mesesAdeudados = facturasPendientes.length;
    const alDia = deudaTotalPendiente <= 0.001 && multasPendientes.length === 0;

    let fechaDeudaMasAntigua: string | undefined = undefined;
    if (facturasPendientes.length > 0) {
      const sorted = [...facturasPendientes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      fechaDeudaMasAntigua = sorted[0].createdAt;
    } else if (multasPendientes.length > 0) {
      fechaDeudaMasAntigua = multasPendientes[0].createdAt;
    }

    return {
      socio,
      alDia,
      mesesAdeudados,
      deudaTotalPendiente,
      fechaDeudaMasAntigua,
      facturasPendientes,
      multasPendientes,
      historialFacturas
    };
  }

  public deleteSocio(id: string): { success: boolean; message: string; socioId: string } {
    const db = sqliteDb.getRawDb();
    const socio = this.getSocioById(id);
    if (!socio) {
      throw new Error(`El socio con ID '${id}' no existe o ya fue eliminado.`);
    }

    // Borrado en cascada controlado dentro de una transacción
    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Eliminar asientos de fondos asociados a facturas del socio
      db.prepare('DELETE FROM fondos_movimientos WHERE id_factura IN (SELECT id FROM facturas WHERE id_socio = ?)').run(id);

      // 2. Eliminar multas del socio
      db.prepare('DELETE FROM multas_rubros WHERE id_socio = ?').run(id);

      // 3. Eliminar facturas del socio
      db.prepare('DELETE FROM facturas WHERE id_socio = ?').run(id);

      // 3. Eliminar lecturas del socio o asociadas a sus medidores
      db.prepare('DELETE FROM lecturas WHERE id_socio = ? OR id_medidor IN (SELECT id FROM medidores WHERE id_socio = ?)').run(id, id);

      // 4. Eliminar medidores asignados al socio
      db.prepare('DELETE FROM medidores WHERE id_socio = ?').run(id);

      // 5. Eliminar el registro del socio
      db.prepare('DELETE FROM socios WHERE id = ?').run(id);

      db.exec('COMMIT;');

      // Sincronizar borrado en Supabase
      supabaseClient.deleteRecord('socios', id).catch((err) => console.warn('[Supabase Sync Delete Socio]', err));
      supabaseClient.deleteRecord('medidores', id, 'id_socio').catch((err) => console.warn('[Supabase Sync Delete Medidores Socio]', err));

      return {
        success: true,
        message: `El socio "${socio.nombreCompleto}" y todos sus registros asociados fueron eliminados correctamente.`,
        socioId: id
      };

    } catch (err: unknown) {
      db.exec('ROLLBACK;');
      const errorMsg = err instanceof Error ? err.message : 'Error al eliminar socio en base de datos.';
      throw new Error(`Error en cascada al eliminar socio: ${errorMsg}`);
    }
  }
}

export const socioService = new SocioService();
