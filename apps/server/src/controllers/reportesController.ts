import type { Response } from '../core/http.ts';
import { reportesService } from '../services/reportesService.ts';
import type { AuthenticatedRequest } from '../middlewares/auth.ts';

export const getReporteMorosidad = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const reporte = reportesService.getReporteMorosidad();
    res.json({
      titulo: 'Informe de Morosidad y Cartera Vencida',
      data: {
        totalMorosos: reporte.totalMorosos,
        deudaTotalAcumulada: reporte.deudaTotalAcumulada,
        sociosMorosos: reporte.morosos,
        morosos: reporte.morosos
      },
      totalMorosos: reporte.totalMorosos,
      deudaTotalAcumulada: reporte.deudaTotalAcumulada,
      sociosMorosos: reporte.morosos,
      morosos: reporte.morosos
    });
  } catch (error) {
    console.error('[ReportesController] Error generando reporte de morosidad:', error);
    res.status(500).json({ error: 'Error generando reporte de morosidad.' });
  }
};

export const getReportePorSector = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { periodoId } = req.query as { periodoId?: string };
    const reporte = reportesService.getReportePorSector(periodoId);
    res.json({
      titulo: 'Informe Consolidado de Consumo y Cobros por Sector',
      periodoId: periodoId || 'HISTORICO_GLOBAL',
      data: reporte,
      sectores: reporte
    });
  } catch (error) {
    console.error('[ReportesController] Error generando reporte por sector:', error);
    res.status(500).json({ error: 'Error generando reporte por sector.' });
  }
};

export const getReporteConsolidado = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { periodoId } = req.query as { periodoId?: string };
    const reporte = reportesService.getReporteConsolidado(periodoId);
    res.json({
      titulo: 'Informe General de Gestión Comunitaria (Auditoría y Contraloría)',
      data: reporte,
      ...reporte
    });
  } catch (error) {
    console.error('[ReportesController] Error generando informe general:', error);
    res.status(500).json({ error: 'Error generando informe general.' });
  }
};
