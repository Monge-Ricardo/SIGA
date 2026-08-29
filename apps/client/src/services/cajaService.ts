import { db } from '../db/indexedDB.ts';
import { syncEngine } from './outboxEngine.ts';
import type { CobroRecibo, MovimientoCaja, SocioAgua } from '@app-agua/shared';
import { TARIFAS_CONFIG } from '@app-agua/shared';

export interface PlanillaLiquidacionCalculada {
  socioId: string;
  socioNombre: string;
  socioCedula: string;
  socioSector: string;
  esTerceraEdad: boolean;
  tieneAlcantarillado: boolean;
  lecturaAnterior: number;
  lecturaActual: number;
  consumoM3: number;
  excedenteM3: number;
  cargoBaseUSD: number;
  excedenteUSD: number;
  alcantarilladoUSD: number;
  multaExtraUSD: number;
  deudaAnteriorUSD: number;
  totalMesUSD: number;
  totalPagarUSD: number;
}

export class CajaService {
  public calcularLiquidacion(
    socio: SocioAgua,
    lecturaAnterior: number,
    lecturaActual: number,
    multaExtraUSD: number = 0
  ): PlanillaLiquidacionCalculada {
    const es3raEdad = socio.esTerceraEdad;
    const cargoBaseUSD = es3raEdad ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
    const tieneAlcant = socio.tieneAlcantarillado;
    const alcantarilladoUSD = tieneAlcant ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0;

    const consumoM3 = Math.max(0, lecturaActual - lecturaAnterior);
    const excedenteM3 = Math.max(0, consumoM3 - TARIFAS_CONFIG.LIMITE_BASE_M3);
    const excedenteUSD = Number((excedenteM3 * TARIFAS_CONFIG.EXCEDENTE_POR_M3).toFixed(2));
    const deudaAnteriorUSD = socio.montoTotalAdeudado || 0;

    const totalMesUSD = cargoBaseUSD + excedenteUSD + alcantarilladoUSD;
    const totalPagarUSD = Number((totalMesUSD + multaExtraUSD + deudaAnteriorUSD).toFixed(2));

    return {
      socioId: socio.id,
      socioNombre: socio.nombreCompleto,
      socioCedula: socio.cedulaRuc,
      socioSector: socio.nombreSector || socio.sectorId,
      esTerceraEdad: es3raEdad,
      tieneAlcantarillado: tieneAlcant,
      lecturaAnterior,
      lecturaActual,
      consumoM3,
      excedenteM3,
      cargoBaseUSD,
      excedenteUSD,
      alcantarilladoUSD,
      multaExtraUSD,
      deudaAnteriorUSD,
      totalMesUSD,
      totalPagarUSD
    };
  }

  public async ejecutarCobro(
    socio: SocioAgua,
    liquidacion: PlanillaLiquidacionCalculada,
    periodo: string,
    metodoPago: 'EFECTIVO' | 'TRANSFERENCIA' | 'MOVIL',
    cajeroResponsableId: string
  ): Promise<{ cobro: CobroRecibo; movimiento: MovimientoCaja }> {
    const cobrosCount = await db.cobros.count();
    const numeroRecibo = `REC-${periodo.replace('-', '')}-${String(cobrosCount + 1).padStart(4, '0')}`;
    const now = new Date().toISOString();
    const cobroId = crypto.randomUUID();
    const movId = crypto.randomUUID();

    const cobro: CobroRecibo = {
      id: cobroId,
      numeroRecibo,
      clienteId: socio.id,
      periodo,
      montoBase: liquidacion.cargoBaseUSD,
      montoExceso: liquidacion.excedenteUSD,
      montoMora: liquidacion.deudaAnteriorUSD,
      montoOtros: liquidacion.multaExtraUSD,
      montoTotal: liquidacion.totalPagarUSD,
      estado: 'PAGADO',
      fechaVencimiento: now,
      fechaPago: now,
      metodoPago,
      cajeroResponsableId,
      movimientoCajaId: movId,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    const movimiento: MovimientoCaja = {
      id: movId,
      tipo: 'ENTRADA',
      categoria: 'COBRO_AGUA',
      monto: liquidacion.totalPagarUSD,
      descripcion: `Cobro planilla agua ${periodo} - ${socio.nombreCompleto} (${numeroRecibo})`,
      fecha: now,
      responsableId: cajeroResponsableId,
      reciboAguaId: cobroId,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    const socioActualizado: SocioAgua = {
      ...socio,
      estadoCuenta: 'AL_DIA',
      mesesAdeudados: 0,
      montoTotalAdeudado: 0,
      fechaDeudaAntigua: undefined,
      updatedAt: now,
      version: socio.version + 1
    };

    await db.transaction('rw', [db.cobros, db.movimientos_caja, db.socios, db.sync_queue], async () => {
      await db.cobros.add(cobro);
      await db.movimientos_caja.add(movimiento);
      await db.socios.put(socioActualizado);
      await syncEngine.enqueueMutation('WATER_RECORD', cobroId, 'CREATE', cobro);
    });

    return { cobro, movimiento };
  }
}

export const cajaService = new CajaService();
