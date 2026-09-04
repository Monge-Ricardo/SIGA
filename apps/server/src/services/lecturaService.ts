import crypto from 'node:crypto';
import { sqliteDb } from '../db/sqlite.ts';
import { ValidationRules } from '../shared.ts';
import type { Lectura, Periodo } from '../shared.ts';

interface LecturaRow {
  id: string;
  id_medidor?: string;
  id_socio: string;
  id_periodo: string;
  lectura_anterior: number;
  lectura_actual: number;
  consumo_total: number;
  excedente_m3: number;
  fecha_lectura: string;
  id_lector: string;
  observaciones?: string;
  version: number;
  created_at: string;
  updated_at: string;
  codigo_socio?: string;
  nombres?: string;
  apellidos?: string;
  medidor_numero?: string;
  alias_medidor?: string;
  nombre_sector?: string;
  periodo_codigo?: string;
}

export class LecturaService {
  private mapRowToLectura(row: LecturaRow): Lectura {
    return {
      id: row.id,
      idMedidor: row.id_medidor || '',
      idSocio: row.id_socio,
      idPeriodo: row.id_periodo,
      numeroMedidor: row.medidor_numero,
      aliasMedidor: row.alias_medidor,
      lecturaAnterior: row.lectura_anterior,
      lecturaActual: row.lectura_actual,
      consumoTotal: row.consumo_total,
      excedenteM3: row.excedente_m3,
      fechaLectura: row.fecha_lectura,
      idLector: row.id_lector,
      observaciones: row.observaciones || undefined,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public resolveSocioId(input?: string): string {
    const db = sqliteDb.getRawDb();
    if (input && input.trim() && !input.startsWith('{{')) {
      const clean = input.trim();
      const byId = db.prepare('SELECT id FROM socios WHERE id = ?').get(clean) as { id: string } | undefined;
      if (byId) return byId.id;

      const byCode = db.prepare('SELECT id FROM socios WHERE codigo_socio = ? OR LOWER(codigo_socio) = LOWER(?)').get(clean, clean) as { id: string } | undefined;
      if (byCode) return byCode.id;

      const byMedidor = db.prepare('SELECT id FROM socios WHERE medidor_numero = ? OR cedula_ruc = ?').get(clean, clean) as { id: string } | undefined;
      if (byMedidor) return byMedidor.id;
    }

    const first = db.prepare("SELECT id FROM socios ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
    if (!first) throw new Error('No existen socios registrados en la base de datos.');
    return first.id;
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

  public resolveLectorId(input?: string): string {
    const db = sqliteDb.getRawDb();
    if (input && input.trim() && !input.startsWith('{{')) {
      const clean = input.trim();
      const byId = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(clean) as { id: string } | undefined;
      if (byId) return byId.id;
    }

    const first = db.prepare("SELECT id FROM usuarios WHERE rol IN ('LECTOR', 'CAJERO', 'ADMIN') AND activo = 1 LIMIT 1").get() as { id: string } | undefined;
    if (!first) throw new Error('No hay usuarios disponibles.');
    return first.id;
  }

  public getPeriodos(): Periodo[] {
    const db = sqliteDb.getRawDb();
    const rows = db.prepare('SELECT * FROM periodos ORDER BY fecha_inicio DESC').all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      periodoCodigo: r.periodo_codigo as string,
      nombre: r.nombre as string,
      fechaInicio: r.fecha_inicio as string,
      fechaFin: r.fecha_fin as string,
      estado: r.estado as Periodo['estado'],
      createdAt: r.created_at as string
    }));
  }

  public getPeriodoActivo(): Periodo | null {
    const db = sqliteDb.getRawDb();
    const row = db.prepare("SELECT * FROM periodos WHERE estado = 'ABIERTO' ORDER BY fecha_inicio DESC LIMIT 1").get() as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;
    return {
      id: row.id as string,
      periodoCodigo: row.periodo_codigo as string,
      nombre: row.nombre as string,
      fechaInicio: row.fecha_inicio as string,
      fechaFin: row.fecha_fin as string,
      estado: row.estado as Periodo['estado'],
      createdAt: row.created_at as string
    };
  }

  public getLecturas(filters?: {
    periodoId?: string;
    sectorId?: string;
    socioId?: string;
    medidorId?: string;
  }): Array<Lectura & { socioNombre?: string; socioCedula?: string; medidorNumero?: string; aliasMedidor?: string; sectorNombre?: string }> {
    const db = sqliteDb.getRawDb();
    let query = `
      SELECT l.*, 
             s.codigo_socio, s.nombres, s.apellidos, s.cedula_ruc,
             COALESCE(m.numero_medidor, s.medidor_numero) as medidor_numero,
             m.alias as alias_medidor,
             sec.nombre_sector, p.periodo_codigo
      FROM lecturas l
      JOIN socios s ON l.id_socio = s.id
      LEFT JOIN medidores m ON l.id_medidor = m.id
      LEFT JOIN sectores sec ON COALESCE(m.id_sector, s.id_sector) = sec.id
      JOIN periodos p ON l.id_periodo = p.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filters?.periodoId) {
      try {
        const resolvedId = this.resolvePeriodoId(filters.periodoId);
        query += ' AND (l.id_periodo = ? OR p.periodo_codigo = ?)';
        params.push(resolvedId, filters.periodoId.trim());
      } catch {
        query += ' AND (l.id_periodo = ? OR p.periodo_codigo = ?)';
        params.push(filters.periodoId, filters.periodoId);
      }
    }
    if (filters?.sectorId) {
      query += ' AND (s.id_sector = ? OR m.id_sector = ?)';
      params.push(filters.sectorId, filters.sectorId);
    }
    if (filters?.socioId) {
      try {
        const resolvedSocio = this.resolveSocioId(filters.socioId);
        query += ' AND (l.id_socio = ? OR s.codigo_socio = ?)';
        params.push(resolvedSocio, filters.socioId.trim());
      } catch {
        query += ' AND (l.id_socio = ? OR s.codigo_socio = ?)';
        params.push(filters.socioId, filters.socioId);
      }
    }
    if (filters?.medidorId) {
      query += ' AND (l.id_medidor = ? OR m.numero_medidor = ?)';
      params.push(filters.medidorId, filters.medidorId);
    }

    query += ' ORDER BY sec.nombre_sector ASC, COALESCE(m.numero_medidor, s.medidor_numero) ASC';
    const rows = db.prepare(query).all(...params) as (LecturaRow & { cedula_ruc: string })[];

    return rows.map((r) => ({
      ...this.mapRowToLectura(r),
      socioNombre: `${r.apellidos} ${r.nombres}`,
      socioCedula: r.cedula_ruc,
      medidorNumero: r.medidor_numero,
      aliasMedidor: r.alias_medidor,
      sectorNombre: r.nombre_sector
    }));
  }

  public resolveMedidorId(idSocio: string, inputMedidor?: string): string {
    const db = sqliteDb.getRawDb();
    if (inputMedidor && inputMedidor.trim()) {
      const clean = inputMedidor.trim();
      const byId = db.prepare('SELECT id FROM medidores WHERE id = ?').get(clean) as { id: string } | undefined;
      if (byId) return byId.id;

      const byNum = db.prepare('SELECT id FROM medidores WHERE numero_medidor = ?').get(clean) as { id: string } | undefined;
      if (byNum) return byNum.id;
    }

    const bySocio = db.prepare('SELECT id FROM medidores WHERE id_socio = ? ORDER BY created_at ASC LIMIT 1').get(idSocio) as { id: string } | undefined;
    if (bySocio) return bySocio.id;

    // Fallback: asociar con datos del socio
    const socio = db.prepare('SELECT id, id_sector, medidor_numero, direccion, tiene_alcantarillado FROM socios WHERE id = ?').get(idSocio) as any;
    if (socio) {
      const medId = crypto.randomUUID();
      const now = new Date().toISOString();
      const primerSector = (db.prepare('SELECT id FROM sectores LIMIT 1').get() as { id: string } | undefined)?.id || 'SEC-01';
      db.prepare(`
        INSERT INTO medidores (id, id_socio, id_sector, numero_medidor, alias, direccion, tiene_alcantarillado, estado, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'Casa principal', ?, ?, 'ACTIVO', 1, ?, ?)
      `).run(
        medId,
        socio.id,
        socio.id_sector || primerSector,
        socio.medidor_numero || inputMedidor || `MED-${String(Date.now()).slice(-5)}`,
        socio.direccion || '',
        socio.tiene_alcantarillado ? 1 : 0,
        now,
        now
      );
      return medId;
    }

    throw new Error('No se encontró un medidor asociado.');
  }

  public getUltimaLecturaMedidor(idMedidor: string): number {
    const db = sqliteDb.getRawDb();
    const row = db
      .prepare(`
        SELECT lectura_actual
        FROM lecturas
        WHERE id_medidor = ?
        ORDER BY fecha_lectura DESC
        LIMIT 1
      `)
      .get(idMedidor) as { lectura_actual: number } | undefined;

    return row ? row.lectura_actual : 0;
  }

  public getUltimaLecturaSocio(idSocio: string): number {
    const db = sqliteDb.getRawDb();
    const row = db
      .prepare(`
        SELECT lectura_actual
        FROM lecturas
        WHERE id_socio = ?
        ORDER BY fecha_lectura DESC
        LIMIT 1
      `)
      .get(idSocio) as { lectura_actual: number } | undefined;

    return row ? row.lectura_actual : 0;
  }

  public registrarLectura(data: {
    idSocio: string;
    idMedidor?: string;
    numeroMedidor?: string;
    idPeriodo?: string;
    lecturaActual: number;
    idLector?: string;
    lecturaAnterior?: number;
    observaciones?: string;
  }): Lectura {
    const db = sqliteDb.getRawDb();
    const resolvedSocioId = this.resolveSocioId(data.idSocio);
    const resolvedMedidorId = this.resolveMedidorId(resolvedSocioId, data.idMedidor || data.numeroMedidor);
    const resolvedPeriodoId = this.resolvePeriodoId(data.idPeriodo);
    const resolvedLectorId = this.resolveLectorId(data.idLector);

    const periodo = db.prepare('SELECT estado FROM periodos WHERE id = ?').get(resolvedPeriodoId) as { estado: string } | undefined;
    if (!periodo) {
      throw new Error('El período de facturación especificado no existe.');
    }
    if (periodo.estado === 'CERRADO') {
      throw new Error('No se pueden registrar lecturas en un período cerrado.');
    }

    const lecturaAnterior =
      data.lecturaAnterior !== undefined
        ? data.lecturaAnterior
        : (this.getUltimaLecturaMedidor(resolvedMedidorId) || this.getUltimaLecturaSocio(resolvedSocioId));

    const validacion = ValidationRules.isValidLectura(data.lecturaActual, lecturaAnterior);
    if (!validacion.valid) {
      throw new Error(validacion.message);
    }

    const consumoTotal = Number((data.lecturaActual - lecturaAnterior).toFixed(2));
    const excedenteM3 = Number(Math.max(0, consumoTotal - 30).toFixed(2));

    const now = new Date().toISOString();

    const existente = db
      .prepare('SELECT id FROM lecturas WHERE id_medidor = ? AND id_periodo = ?')
      .get(resolvedMedidorId, resolvedPeriodoId) as { id: string } | undefined;

    let id = existente?.id;

    if (existente) {
      db.prepare(`
        UPDATE lecturas SET
          id_medidor = ?,
          id_socio = ?,
          lectura_anterior = ?,
          lectura_actual = ?,
          consumo_total = ?,
          excedente_m3 = ?,
          fecha_lectura = ?,
          id_lector = ?,
          observaciones = ?,
          version = version + 1,
          updated_at = ?
        WHERE id = ?
      `).run(
        resolvedMedidorId,
        resolvedSocioId,
        lecturaAnterior,
        data.lecturaActual,
        consumoTotal,
        excedenteM3,
        now,
        resolvedLectorId,
        data.observaciones || null,
        now,
        existente.id
      );
    } else {
      id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO lecturas (
          id, id_medidor, id_socio, id_periodo, lectura_anterior, lectura_actual,
          consumo_total, excedente_m3, fecha_lectura, id_lector,
          observaciones, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        id,
        resolvedMedidorId,
        resolvedSocioId,
        resolvedPeriodoId,
        lecturaAnterior,
        data.lecturaActual,
        consumoTotal,
        excedenteM3,
        now,
        resolvedLectorId,
        data.observaciones || null,
        now,
        now
      );
    }

    const row = db.prepare(`
      SELECT l.*, 
             s.codigo_socio, s.nombres, s.apellidos,
             COALESCE(m.numero_medidor, s.medidor_numero) as medidor_numero,
             m.alias as alias_medidor
      FROM lecturas l
      JOIN socios s ON l.id_socio = s.id
      LEFT JOIN medidores m ON l.id_medidor = m.id
      WHERE l.id = ?
    `).get(id) as LecturaRow;

    return this.mapRowToLectura(row);
  }

  public cerrarPeriodo(idPeriodo: string): Periodo {
    const db = sqliteDb.getRawDb();
    const periodo = db.prepare('SELECT * FROM periodos WHERE id = ?').get(idPeriodo) as Record<string, unknown> | undefined;
    if (!periodo) {
      throw new Error('Período no encontrado.');
    }

    db.prepare("UPDATE periodos SET estado = 'CERRADO' WHERE id = ?").run(idPeriodo);

    return {
      id: periodo.id as string,
      periodoCodigo: periodo.periodo_codigo as string,
      nombre: periodo.nombre as string,
      fechaInicio: periodo.fecha_inicio as string,
      fechaFin: periodo.fecha_fin as string,
      estado: 'CERRADO',
      createdAt: periodo.created_at as string
    };
  }
}

export const lecturaService = new LecturaService();
