import type { Response } from '../core/http.ts';
import { fondosService } from '../services/fondosService.ts';
import type { AuthenticatedRequest } from '../middlewares/auth.ts';

export const getFondosCatalogo = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const fondos = fondosService.getFondos();
    res.json({ data: fondos });
  } catch (error) {
    console.error('[FinanceController] Error obteniendo catálogo de fondos:', error);
    res.status(500).json({ error: 'Error obteniendo fondos comunitarios.' });
  }
};

export const getLibroMayor3Columnas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { idFondo, fechaInicio, fechaFin } = req.query as { idFondo?: string; fechaInicio?: string; fechaFin?: string };
    const movimientos = fondosService.getLibroMayor({ idFondo, fechaInicio, fechaFin });
    res.json({
      descripcion: 'Libro Mayor de 3 Columnas: Ingresos (+), Egresos (-), Saldo Acumulado (=)',
      data: movimientos,
      total: movimientos.length
    });
  } catch (error) {
    console.error('[FinanceController] Error obteniendo Libro Mayor:', error);
    res.status(500).json({ error: 'Error obteniendo Libro Mayor de fondos.' });
  }
};

export const registrarEgreso = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { idFondo, concepto, monto, numeroComprobante, beneficiario, fecha } = req.body || {};

    if (!idFondo || !concepto || monto === undefined || Number(monto) <= 0) {
      res.status(400).json({ error: 'idFondo, concepto y un monto mayor a 0 son obligatorios.' });
      return;
    }

    const idResponsable = req.user?.id || 'tesorero-responsable';
    const movimiento = fondosService.registrarMovimiento({
      idFondo,
      concepto: String(concepto).trim(),
      tipo: 'EGRESO',
      monto: Number(monto),
      idResponsable,
      numeroComprobante: numeroComprobante ? String(numeroComprobante).trim() : undefined,
      beneficiario: beneficiario ? String(beneficiario).trim() : undefined,
      fecha
    });

    res.status(201).json({
      message: 'Egreso registrado correctamente en el Libro Mayor.',
      data: movimiento
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error registrando egreso.';
    res.status(400).json({ error: message });
  }
};

export const getBalanceFondosResumen = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const balance = fondosService.getBalanceGeneralFondos();
    res.json({ data: balance });
  } catch (error) {
    console.error('[FinanceController] Error obteniendo balance general:', error);
    res.status(500).json({ error: 'Error obteniendo balance de fondos.' });
  }
};

export const getLiquidacionPadreParroquia = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { periodoCodigo } = req.query as { periodoCodigo?: string };
    const liquidacion = fondosService.getLiquidacionPadre(periodoCodigo);
    res.json({
      descripcion: 'Control y Liquidación del Fondo Parroquial (Aporte al Padre)',
      data: liquidacion
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error obteniendo liquidación parroquial.';
    res.status(400).json({ error: message });
  }
};

// Aliases para compatibilidad
export const getMovimientosCaja = getLibroMayor3Columnas;
export const getBalanceResumen = getBalanceFondosResumen;
