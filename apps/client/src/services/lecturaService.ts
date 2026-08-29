import { db } from '../db/indexedDB.ts';
import { syncEngine } from './outboxEngine.ts';
import type { LecturaMedidor } from '@app-agua/shared';
import { TARIFAS_CONFIG } from '@app-agua/shared';

export interface LecturaCalculoResult {
  valida: boolean;
  consumoM3: number;
  excedenteM3: number;
  valorExcedenteUSD: number;
  error?: string;
}

export class LecturaService {
  /**
   * Valida la consistencia Lact >= Lant y calcula consumo y excedente.
   */
  public calcularConsumo(lecturaAnterior: number, lecturaActual: number): LecturaCalculoResult {
    if (lecturaActual < lecturaAnterior) {
      return {
        valida: false,
        consumoM3: 0,
        excedenteM3: 0,
        valorExcedenteUSD: 0,
        error: `Lectura actual (${lecturaActual}) no puede ser menor a la lectura anterior (${lecturaAnterior})`
      };
    }

    const consumo = lecturaActual - lecturaAnterior;
    const excedente = Math.max(0, consumo - TARIFAS_CONFIG.LIMITE_BASE_M3);
    const valorExcedente = Number((excedente * TARIFAS_CONFIG.EXCEDENTE_POR_M3).toFixed(2));

    return {
      valida: true,
      consumoM3: consumo,
      excedenteM3: excedente,
      valorExcedenteUSD: valorExcedente
    };
  }

  /**
   * Obtiene todas las lecturas de un período específico.
   */
  public async getLecturasPorPeriodo(periodo: string): Promise<LecturaMedidor[]> {
    return await db.lecturas.where('periodo').equals(periodo).toArray();
  }

  /**
   * Guarda o actualiza una lectura en IndexedDB y encola en Outbox.
   */
  public async guardarLectura(
    clienteId: string,
    periodo: string,
    lecturaAnterior: number,
    lecturaActual: number,
    lectorResponsableId: string,
    observaciones?: string
  ): Promise<LecturaMedidor> {
    const calculo = this.calcularConsumo(lecturaAnterior, lecturaActual);
    if (!calculo.valida) {
      throw new Error(calculo.error);
    }

    const id = `lec-${clienteId}-${periodo}`;
    const now = new Date().toISOString();

    const lectura: LecturaMedidor = {
      id,
      clienteId,
      periodo,
      lecturaAnterior,
      lecturaActual,
      consumoM3: calculo.consumoM3,
      fechaLectura: now,
      lectorResponsableId,
      observaciones,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    await db.lecturas.put(lectura);
    await syncEngine.enqueueMutation('WATER_RECORD', id, 'CREATE', lectura);

    return lectura;
  }
}

export const lecturaService = new LecturaService();
