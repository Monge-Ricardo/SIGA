import crypto from 'node:crypto';
import type { Response } from '../core/http.ts';
import { sqliteDb } from '../db/sqlite.ts';
import { socioService } from '../services/socioService.ts';
import { lecturaService } from '../services/lecturaService.ts';
import { facturacionService } from '../services/facturacionService.ts';
import type { AuthenticatedRequest } from '../middlewares/auth.ts';
import type { MetodoPago, MultaRubro, Sector } from '../shared.ts';

// ==========================================
// 1. SECTORES
// ==========================================

export const getSectores = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const db = sqliteDb.getRawDb();
    const rows = db.prepare('SELECT * FROM sectores WHERE activo = 1 ORDER BY nombre_sector ASC').all() as Record<string, unknown>[];
    const sectores: Sector[] = rows.map((r) => ({
      id: r.id as string,
      codigoSector: r.codigo_sector as string,
      nombreSector: r.nombre_sector as string,
      descripcion: (r.descripcion as string) || undefined,
      activo: Boolean(r.activo),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string
    }));
    res.json({ data: sectores });
  } catch (error) {
    console.error('[WaterController] Error obteniendo sectores:', error);
    res.status(500).json({ error: 'Error obteniendo sectores.' });
  }
};

export const createSector = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { codigoSector, nombreSector, descripcion } = req.body || {};
    if (!codigoSector || !nombreSector) {
      res.status(400).json({ error: 'codigoSector y nombreSector son requeridos.' });
      return;
    }

    const db = sqliteDb.getRawDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO sectores (id, codigo_sector, nombre_sector, descripcion, activo, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(id, String(codigoSector).trim().toUpperCase(), String(nombreSector).trim(), descripcion ? String(descripcion).trim() : null, now, now);

    res.status(201).json({
      message: 'Sector creado exitosamente.',
      data: { id, codigoSector, nombreSector, descripcion, activo: true, createdAt: now, updatedAt: now }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error creando sector.';
    res.status(400).json({ error: message });
  }
};

// ==========================================
// 2. PADRÓN DE SOCIOS
// ==========================================

export const getSocios = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { sectorId, estado, search } = req.query as { sectorId?: string; estado?: string; search?: string };
    const socios = socioService.getSocios({ sectorId, estado, search });
    res.json({ data: socios, total: socios.length });
  } catch (error) {
    console.error('[WaterController] Error obteniendo socios:', error);
    res.status(500).json({ error: 'Error obteniendo padrón de socios.' });
  }
};

export const getSocioById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const socio = socioService.getSocioById(id);
    if (!socio) {
      res.status(404).json({ error: 'Socio no encontrado.' });
      return;
    }
    res.json({ data: socio });
  } catch (error) {
    console.error('[WaterController] Error obteniendo socio:', error);
    res.status(500).json({ error: 'Error obteniendo socio.' });
  }
};

export const getSocioEstadoCuenta = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const estadoCuenta = socioService.getEstadoCuenta(id);
    res.json({ data: estadoCuenta });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error obteniendo estado de cuenta.';
    res.status(404).json({ error: message });
  }
};

export const createSocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const socio = socioService.createSocio(req.body);
    res.status(201).json({ message: 'Socio registrado exitosamente.', data: socio });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error registrando socio.';
    res.status(400).json({ error: message });
  }
};

export const updateSocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updated = socioService.updateSocio(id, req.body);
    res.json({ message: 'Socio actualizado correctamente.', data: updated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error actualizando socio.';
    res.status(400).json({ error: message });
  }
};

export const getMedidores = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { sectorId, socioId, search } = req.query;
    const medidores = socioService.getMedidores({
      sectorId: sectorId as string,
      socioId: socioId as string,
      search: search as string
    });
    res.json({ total: medidores.length, data: medidores });
  } catch (error) {
    console.error('[WaterController] Error obteniendo medidores:', error);
    res.status(500).json({ error: 'Error obteniendo medidores.' });
  }
};

export const getMedidoresBySocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const medidores = socioService.getMedidoresBySocioId(id);
    res.json({ total: medidores.length, data: medidores });
  } catch (error) {
    console.error('[WaterController] Error obteniendo medidores del socio:', error);
    res.status(500).json({ error: 'Error obteniendo medidores del socio.' });
  }
};

export const addMedidorToSocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const nuevo = socioService.addMedidorToSocio(id, req.body);
    res.status(201).json({ message: 'Medidor asignado correctamente al socio.', data: nuevo });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error agregando medidor.';
    res.status(400).json({ error: message });
  }
};

// ==========================================
// 3. PERIODOS DE FACTURACIÓN
// ==========================================

export const getPeriodos = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const periodos = lecturaService.getPeriodos();
    res.json({ data: periodos });
  } catch (error) {
    console.error('[WaterController] Error obteniendo periodos:', error);
    res.status(500).json({ error: 'Error obteniendo periodos.' });
  }
};

export const createPeriodo = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { periodoCodigo, nombre, fechaInicio, fechaFin } = req.body || {};
    if (!periodoCodigo || !nombre || !fechaInicio || !fechaFin) {
      res.status(400).json({ error: 'periodoCodigo (YYYY-MM), nombre, fechaInicio y fechaFin son requeridos.' });
      return;
    }

    const db = sqliteDb.getRawDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO periodos (id, periodo_codigo, nombre, fecha_inicio, fecha_fin, estado, created_at)
      VALUES (?, ?, ?, ?, ?, 'ABIERTO', ?)
    `).run(id, String(periodoCodigo).trim(), String(nombre).trim(), fechaInicio, fechaFin, now);

    res.status(201).json({
      message: 'Período creado exitosamente.',
      data: { id, periodoCodigo, nombre, fechaInicio, fechaFin, estado: 'ABIERTO', createdAt: now }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error creando período.';
    res.status(400).json({ error: message });
  }
};

export const cerrarPeriodo = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const cerrado = lecturaService.cerrarPeriodo(id);
    res.json({ message: 'Período cerrado exitosamente.', data: cerrado });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error cerrando período.';
    res.status(400).json({ error: message });
  }
};

// ==========================================
// 4. MICROMEDICIÓN Y LECTURAS
// ==========================================

export const getLecturas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { periodoId, sectorId, socioId, medidorId } = req.query as {
      periodoId?: string;
      sectorId?: string;
      socioId?: string;
      medidorId?: string;
    };
    const lecturas = lecturaService.getLecturas({ periodoId, sectorId, socioId, medidorId });
    res.json({ data: lecturas, total: lecturas.length });
  } catch (error) {
    console.error('[WaterController] Error obteniendo lecturas:', error);
    res.status(500).json({ error: 'Error obteniendo lecturas.' });
  }
};

export const registrarLectura = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { idSocio, idMedidor, numeroMedidor, idPeriodo, lecturaActual, lecturaAnterior, observaciones } = req.body || {};
    if (!idSocio || !idPeriodo || lecturaActual === undefined) {
      res.status(400).json({ error: 'idSocio, idPeriodo y lecturaActual son requeridos.' });
      return;
    }

    const idLector = req.user?.id || 'cajero-sistema';
    const lectura = lecturaService.registrarLectura({
      idSocio,
      idMedidor,
      numeroMedidor,
      idPeriodo,
      lecturaActual: Number(lecturaActual),
      lecturaAnterior: lecturaAnterior !== undefined ? Number(lecturaAnterior) : undefined,
      idLector,
      observaciones
    });

    res.status(201).json({
      message: 'Lectura registrada y calculada correctamente.',
      data: lectura
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error registrando lectura.';
    res.status(400).json({ error: message });
  }
};

// ==========================================
// 5. FACTURACIÓN Y LIQUIDACIÓN
// ==========================================

export const getFacturas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { socioId, periodoId, estadoPago } = req.query as { socioId?: string; periodoId?: string; estadoPago?: string };
    const facturas = facturacionService.getFacturas({ socioId, periodoId, estadoPago });
    res.json({ data: facturas, total: facturas.length });
  } catch (error) {
    console.error('[WaterController] Error obteniendo facturas:', error);
    res.status(500).json({ error: 'Error obteniendo facturas.' });
  }
};

export const getFacturaById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const factura = facturacionService.getFacturaById(id);
    if (!factura) {
      res.status(404).json({ error: 'Factura no encontrada.' });
      return;
    }
    res.json({ data: factura });
  } catch (error) {
    console.error('[WaterController] Error obteniendo factura:', error);
    res.status(500).json({ error: 'Error obteniendo factura.' });
  }
};

export const liquidarFactura = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { idSocio, idPeriodo } = req.body || {};
    if (!idSocio || !idPeriodo) {
      res.status(400).json({ error: 'idSocio y idPeriodo son requeridos para liquidar.' });
      return;
    }

    const factura = facturacionService.liquidarFacturaMes(idSocio, idPeriodo);
    res.status(201).json({ message: 'Planilla liquidada exitosamente.', data: factura });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error liquidando factura.';
    res.status(400).json({ error: message });
  }
};

export const liquidarPeriodo = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { idPeriodo } = req.body || {};
    if (!idPeriodo) {
      res.status(400).json({ error: 'idPeriodo es requerido.' });
      return;
    }

    const resultado = facturacionService.liquidarPeriodo(idPeriodo);
    res.json({
      message: `Liquidación masiva completada: ${resultado.totalLiquidados} planillas generadas.`,
      data: resultado
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error en liquidación de período.';
    res.status(400).json({ error: message });
  }
};

// ==========================================
// 6. CAJA (COBROS)
// ==========================================

export const cobrarFactura = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { metodoPago, fechaPago } = (req.body || {}) as { metodoPago?: MetodoPago; fechaPago?: string };

    const idCajero = req.user?.id || 'cajero-general';
    const facturaPagada = facturacionService.cobrarFactura(id, {
      metodoPago: metodoPago || 'EFECTIVO',
      idCajero,
      fechaPago
    });

    res.json({
      message: `Factura #${facturaPagada.numeroFactura} cobrada exitosamente por $${facturaPagada.totalPagar.toFixed(2)}. Fondos distribuidos al Libro Mayor.`,
      data: facturaPagada
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error cobrando factura.';
    res.status(400).json({ error: message });
  }
};

// ==========================================
// 7. MULTAS Y RUBROS
// ==========================================

export const getMultas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { socioId, pagado } = req.query as { socioId?: string; pagado?: string };
    const pagadoBool = pagado !== undefined ? pagado === 'true' || pagado === '1' : undefined;
    const multas = facturacionService.getMultas({ socioId, pagado: pagadoBool });
    res.json({ data: multas, total: multas.length });
  } catch (error) {
    console.error('[WaterController] Error obteniendo multas:', error);
    res.status(500).json({ error: 'Error obteniendo multas.' });
  }
};

export const crearMulta = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { idSocio, tipoRubro, monto, motivo, idPeriodo } = req.body || {};
    if (!idSocio || !tipoRubro || monto === undefined || !motivo) {
      res.status(400).json({ error: 'idSocio, tipoRubro, monto y motivo son requeridos.' });
      return;
    }

    const multa = facturacionService.crearMulta({
      idSocio,
      tipoRubro: tipoRubro as MultaRubro['tipoRubro'],
      monto: Number(monto),
      motivo: String(motivo),
      idPeriodo
    });

    res.status(201).json({ message: 'Multa / Cuota extraordinaria registrada.', data: multa });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error registrando multa.';
    res.status(400).json({ error: message });
  }
};

// Aliases para compatibilidad
export const getClientes = getSocios;
export const getCobros = getFacturas;
