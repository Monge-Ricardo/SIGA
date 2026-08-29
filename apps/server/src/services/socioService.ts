import crypto from 'node:crypto';
import { sqliteDb } from '../db/sqlite.ts';
import { ValidationRules } from '../shared.ts';
import type { Socio, EstadoCuentaSocio, Factura, MultaRubro } from '../shared.ts';

interface SocioRow {
  id: string;
  codigo_socio: string;
  nombres: string;
  apellidos: string;
  cedula_ruc: string;
  fecha_nacimiento: string;
  fecha_union: string;
  id_sector: string;
  nombre_sector?: string;
  medidor_numero: string;
  tiene_alcantarillado: number;
  telefono?: string;
  direccion: string;
  estado: 'ACTIVO' | 'SUSPENDIDO' | 'CORTADO';
  version: number;
  created_at: string;
  updated_at: string;
}

export class SocioService {
  private mapRowToSocio(row: SocioRow): Socio {
    const esTerceraEdad = ValidationRules.calcularEsTerceraEdad(row.fecha_nacimiento);
    return {
      id: row.id,
      codigoSocio: row.codigo_socio,
      nombres: row.nombres,
      apellidos: row.apellidos,
      cedulaRuc: row.cedula_ruc,
      fechaNacimiento: row.fecha_nacimiento,
      esTerceraEdad,
      fechaUnion: row.fecha_union,
      idSector: row.id_sector,
      nombreSector: row.nombre_sector,
      medidorNumero: row.medidor_numero,
      tieneAlcantarillado: Boolean(row.tiene_alcantarillado),
      telefono: row.telefono || undefined,
      direccion: row.direccion,
      estado: row.estado,
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
      throw new Error(
        'El sector (idSector) es obligatorio. Debe seleccionar o ingresar un sector válido (ej: "SEC-01", "SEC-02" o su ID).'
      );
    }

    const cleanInput = input.trim();

    // 1. Por ID UUID directo
    const byId = db.prepare('SELECT id FROM sectores WHERE id = ?').get(cleanInput) as { id: string } | undefined;
    if (byId) return byId.id;

    // 2. Por código de sector (ej: SEC-01)
    const byCode = db.prepare('SELECT id FROM sectores WHERE codigo_sector = ?').get(cleanInput.toUpperCase()) as { id: string } | undefined;
    if (byCode) return byCode.id;

    // 3. Por nombre de sector (ej: Sector Centro)
    const byName = db.prepare('SELECT id FROM sectores WHERE nombre_sector LIKE ?').get(`%${cleanInput}%`) as { id: string } | undefined;
    if (byName) return byName.id;

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

    // Comprobar duplicado de medidor
    const existeMedidor = db.prepare('SELECT id FROM socios WHERE medidor_numero = ?').get(medidorNumero);
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

    return this.getSocioById(id)!;
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

    return this.getSocioById(id)!;
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

    const historialFacturas: Factura[] = facturasRows.map((r) => ({
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
      totalPagar: r.total_pagar as number,
      estadoPago: r.estado_pago as Factura['estadoPago'],
      fechaVencimiento: r.fecha_vencimiento as string,
      fechaPago: (r.fecha_pago as string) || undefined,
      metodoPago: (r.metodo_pago as Factura['metodoPago']) || undefined,
      idCajero: (r.id_cajero as string) || undefined,
      version: r.version as number,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string
    }));

    const facturasPendientes = historialFacturas.filter((f) => f.estadoPago === 'PENDIENTE');

    // Multas pendientes
    const multasRows = db
      .prepare(`
        SELECT * FROM multas_rubros
        WHERE id_socio = ? AND pagado = 0
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

    const totalFacturasPendientes = facturasPendientes.reduce((sum, f) => sum + f.totalMes, 0);
    const totalMultasPendientes = multasPendientes.reduce((sum, m) => sum + m.monto, 0);
    const deudaTotalPendiente = totalFacturasPendientes + totalMultasPendientes;

    const mesesAdeudados = facturasPendientes.length;
    const alDia = mesesAdeudados === 0 && multasPendientes.length === 0;

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
}

export const socioService = new SocioService();
