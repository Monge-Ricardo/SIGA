import type { Response } from '../../../core/http.ts';
import type { AuthenticatedRequest } from '../../../middlewares/auth.ts';
import { ConsultarDeudasSocioUseCase } from '../application/ConsultarDeudasSocioUseCase.ts';
import { ProcesarCobroUseCase } from '../application/ProcesarCobroUseCase.ts';
import { CuadreCajaUseCase } from '../application/CuadreCajaUseCase.ts';
import { AnularCobroUseCase } from '../application/AnularCobroUseCase.ts';

export class CajaController {
  private readonly consultarDeudasUC: ConsultarDeudasSocioUseCase;
  private readonly procesarCobroUC: ProcesarCobroUseCase;
  private readonly cuadreCajaUC: CuadreCajaUseCase;
  private readonly anularCobroUC: AnularCobroUseCase;

  constructor(
    consultarDeudasUC: ConsultarDeudasSocioUseCase = new ConsultarDeudasSocioUseCase(),
    procesarCobroUC: ProcesarCobroUseCase = new ProcesarCobroUseCase(),
    cuadreCajaUC: CuadreCajaUseCase = new CuadreCajaUseCase(),
    anularCobroUC: AnularCobroUseCase = new AnularCobroUseCase()
  ) {
    this.consultarDeudasUC = consultarDeudasUC;
    this.procesarCobroUC = procesarCobroUC;
    this.cuadreCajaUC = cuadreCajaUC;
    this.anularCobroUC = anularCobroUC;
  }

  /**
   * GET /api/v1/caja/socios/:id/deudas
   * RF-CAJ-02: Consulta y desglosa todos los valores pendientes del socio
   */
  public consultarDeudasSocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const socioId = req.params.id;
      if (!socioId) {
        res.status(400).json({ success: false, error: 'Identificador de socio requerido' });
        return;
      }

      const resultado = await this.consultarDeudasUC.ejecutar(socioId);
      res.status(200).json(resultado);
    } catch (err: any) {
      console.error('❌ [CajaController.consultarDeudasSocio]', err.message);
      res.status(400).json({ success: false, error: err.message || 'Error consultando deudas del socio' });
    }
  };

  /**
   * POST /api/v1/caja/cobros
   * RF-CAJ-04, 05, 06, 07: Registra cobro total o abono FIFO con distribución de 7 fondos
   */
  public procesarCobro = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }
      body = (body && typeof body === 'object') ? body : {};
      const idCajero = req.user?.id || body.idCajero || (body as any).id_cajero || '00000000-0000-0000-0000-000000000002';

      const requestDTO = {
        ...body,
        idCajero
      };

      const resultado = await this.procesarCobroUC.ejecutar(requestDTO);
      res.status(201).json(resultado);
    } catch (err: any) {
      console.error('❌ [CajaController.procesarCobro]', err.message);
      res.status(400).json({ success: false, error: err.message || 'Error procesando cobro en caja' });
    }
  };

  /**
   * GET /api/v1/caja/cuadre-diario
   * RF-CAJ-10, 11, RN-13: Consulta balance y cuadre diario de caja
   */
  public obtenerCuadreDiario = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const fecha = req.query.fecha;
      const idCajero = req.user?.id;
      const resultado = await this.cuadreCajaUC.ejecutar(fecha, idCajero);
      res.status(200).json(resultado);
    } catch (err: any) {
      console.error('❌ [CajaController.obtenerCuadreDiario]', err.message);
      res.status(500).json({ success: false, error: err.message || 'Error generando cuadre diario' });
    }
  };

  /**
   * POST /api/v1/caja/egresos
   * RN-14: Registra salida de caja chica con justificativo
   */
  public registrarEgreso = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const body = req.body || {};
      const idCajero = req.user?.id || body.idCajero || 'sistema';

      const resultado = await this.cuadreCajaUC.registrarEgreso({
        ...body,
        idCajero
      });
      res.status(201).json({ success: true, egreso: resultado });
    } catch (err: any) {
      console.error('❌ [CajaController.registrarEgreso]', err.message);
      res.status(400).json({ success: false, error: err.message || 'Error registrando egreso de caja' });
    }
  };

  /**
   * POST /api/v1/caja/facturas/:id/anular (o DELETE)
   * RF-CAJ-12, RN-15, RN-16: Anula cobro (Restringido a ADMIN)
   */
  public anularCobro = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const idFactura = req.params.id;
      const idAdmin = req.user?.id || 'admin';
      const motivo = req.body?.motivo || req.query?.motivo;

      const resultado = await this.anularCobroUC.ejecutar({
        idFactura,
        idAdmin,
        motivo
      });
      res.status(200).json(resultado);
    } catch (err: any) {
      console.error('❌ [CajaController.anularCobro]', err.message);
      res.status(400).json({ success: false, error: err.message || 'Error anulando comprobante de cobro' });
    }
  };

  /**
   * GET /api/v1/caja/periodo-activo
   * RF-CAJ-13: Retorna el período activo abierto de cobranza
   */
  public obtenerPeriodoActivo = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { SupabaseCajaRepository } = await import('../infrastructure/SupabaseCajaRepository.ts');
      const repo = new SupabaseCajaRepository();
      const periodos = await repo.getPeriodos();
      const activo = periodos.find((p) => p.estado === 'ABIERTO') || periodos[0] || null;

      res.status(200).json({
        success: true,
        periodo: activo ? {
          id: activo.id,
          codigo: activo.periodo_codigo,
          nombre: activo.nombre || activo.periodo_codigo,
          estado: activo.estado,
          fechaInicio: activo.fecha_inicio,
          fechaFin: activo.fecha_fin
        } : null
      });
    } catch (err: any) {
      console.error('❌ [CajaController.obtenerPeriodoActivo]', err.message);
      res.status(500).json({ success: false, error: err.message || 'Error consultando período activo' });
    }
  };
}

export const cajaController = new CajaController();
