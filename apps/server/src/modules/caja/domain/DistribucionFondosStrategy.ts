import { FONDO_IDS, type AsientoFondoDTO, type TipoRubroCobro } from './CajaDTOs.ts';

export interface ItemLiquidadoContext {
  tipo: TipoRubroCobro;
  idReferencia: string;
  idFactura?: string | null;
  numeroComprobante: string;
  monto: number;
  esTerceraEdad?: boolean;
  consumoM3?: number;
  excedenteM3?: number;
  valorBase?: number;
  valorExcedente?: number;
  valorAlcantarillado?: number;
  nombreSocio: string;
}

export class DistribucionFondosStrategy {
  /**
   * Método de conveniencia para tests y liquidación directa
   */
  public distribuirCobro(params: {
    montoAguaBase: number;
    esTerceraEdad: boolean;
    montoExcedente: number;
    montoAlcantarillado: number;
    montoMultas: number;
    numeroComprobante?: string;
    nombreSocio?: string;
  }): AsientoFondoDTO[] {
    const items: ItemLiquidadoContext[] = [];
    const comp = params.numeroComprobante || 'REC-001';
    const socio = params.nombreSocio || 'Socio';

    if (params.montoAguaBase > 0 || params.montoExcedente > 0) {
      items.push({
        tipo: 'AGUA_PERIODO_ACTIVO',
        idReferencia: 'ref-agua',
        numeroComprobante: comp,
        monto: params.montoAguaBase + params.montoExcedente,
        esTerceraEdad: params.esTerceraEdad,
        nombreSocio: socio
      });
    }

    if (params.montoAlcantarillado > 0) {
      items.push({
        tipo: 'ALCANTARILLADO',
        idReferencia: 'ref-alc',
        numeroComprobante: comp,
        monto: params.montoAlcantarillado,
        nombreSocio: socio
      });
    }

    if (params.montoMultas > 0) {
      items.push({
        tipo: 'MULTA_COMUNITARIA',
        idReferencia: 'ref-multa',
        numeroComprobante: comp,
        monto: params.montoMultas,
        nombreSocio: socio
      });
    }

    return DistribucionFondosStrategy.calcularAsientos(items);
  }

  /**
   * Calcula con precisión matemática los asientos a los 7 fondos para un cobro específico.
   * Invariante estricto: Suma(Asientos) === Suma(Items Liquidados)
   */
  public static calcularAsientos(items: ItemLiquidadoContext[]): AsientoFondoDTO[] {
    const asientos: AsientoFondoDTO[] = [];

    for (const item of items) {
      if (item.monto <= 0) continue;

      switch (item.tipo) {
        case 'AGUA_PERIODO_ACTIVO':
        case 'AGUA_PERIODO_ANTERIOR':
          this.distribuirConsumoAgua(item, asientos);
          break;

        case 'ALCANTARILLADO':
          asientos.push({
            idFondo: FONDO_IDS.ALCANTARILLADO,
            nombreFondo: 'Servicio Alcantarillado',
            monto: item.monto,
            concepto: `Cobro #${item.numeroComprobante} - Servicio Alcantarillado ($${item.monto.toFixed(2)}) - ${item.nombreSocio}`,
            idReferencia: item.idReferencia,
            idFactura: item.idFactura || null
          });
          break;

        case 'MULTA_COMUNITARIA':
          asientos.push({
            idFondo: FONDO_IDS.MULTAS_EXTRAS,
            nombreFondo: 'Multas y Extras',
            monto: item.monto,
            concepto: `Cobro #${item.numeroComprobante} - Multas y Extras ($${item.monto.toFixed(2)}) - ${item.nombreSocio}`,
            idReferencia: item.idReferencia,
            idFactura: item.idFactura || null
          });
          break;

        case 'DEUDA_HISTORICA_CORTE':
        default:
          asientos.push({
            idFondo: FONDO_IDS.OPERACION_MANT,
            nombreFondo: 'Operación y Mantenimiento',
            monto: item.monto,
            concepto: `Cobro #${item.numeroComprobante} - Deuda Anterior ($${item.monto.toFixed(2)}) - ${item.nombreSocio}`,
            idReferencia: item.idReferencia,
            idFactura: item.idFactura !== undefined ? item.idFactura : item.idReferencia
          });
          break;
      }
    }

    return asientos;
  }

  private static distribuirConsumoAgua(item: ItemLiquidadoContext, asientos: AsientoFondoDTO[]): void {
    const es3ra = Boolean(item.esTerceraEdad);
    let monto = item.monto;
    const baseEsperada = es3ra ? 5.00 : 7.00;

    const idFac = item.idFactura !== undefined ? item.idFactura : item.idReferencia;

    // 1. Extraer alcantarillado mensual si está contenido en la planilla
    const valAlcant = Number((item.valorAlcantarillado || 0).toFixed(2));
    if (valAlcant > 0 && monto >= (baseEsperada + valAlcant)) {
      monto = Number((monto - valAlcant).toFixed(2));
      asientos.push({
        idFondo: FONDO_IDS.ALCANTARILLADO,
        nombreFondo: 'Mantenimiento Red Alcantarillado',
        monto: valAlcant,
        concepto: `Cobro #${item.numeroComprobante} - Servicio Alcantarillado Mensual ($${valAlcant.toFixed(2)}) - ${item.nombreSocio}`,
        idReferencia: item.idReferencia,
        idFactura: idFac
      });
    }

    // 2. Si el monto restante incluye o es exactamente la tarifa base
    if (monto >= baseEsperada) {
      const operacionBase = es3ra ? 2.00 : 4.00;
      const excedente = Number((monto - baseEsperada).toFixed(2));

      asientos.push(
        {
          idFondo: FONDO_IDS.OPERACION_MANT,
          nombreFondo: 'Operación y Mantenimiento',
          monto: operacionBase,
          concepto: `Cobro #${item.numeroComprobante} - Cuota Operación ($${operacionBase.toFixed(2)}) - ${item.nombreSocio}`,
          idReferencia: item.idReferencia,
          idFactura: idFac
        },
        {
          idFondo: FONDO_IDS.PADRE_PARROQUIA,
          nombreFondo: 'Aporte Parroquial',
          monto: 2.00,
          concepto: `Cobro #${item.numeroComprobante} - Aporte Parroquial ($2.00) - ${item.nombreSocio}`,
          idReferencia: item.idReferencia,
          idFactura: idFac
        },
        {
          idFondo: FONDO_IDS.PAGO_LECTOR,
          nombreFondo: 'Pago Lector',
          monto: 0.50,
          concepto: `Cobro #${item.numeroComprobante} - Toma Lectura ($0.50) - ${item.nombreSocio}`,
          idReferencia: item.idReferencia,
          idFactura: idFac
        },
        {
          idFondo: FONDO_IDS.MORTUORIO,
          nombreFondo: 'Fondo Mortuorio',
          monto: 0.50,
          concepto: `Cobro #${item.numeroComprobante} - Fondo Mortuorio ($0.50) - ${item.nombreSocio}`,
          idReferencia: item.idReferencia,
          idFactura: idFac
        }
      );

      if (excedente > 0) {
        asientos.push({
          idFondo: FONDO_IDS.PRO_MEJORAS,
          nombreFondo: 'Pro-Mejoras (Excedentes)',
          monto: excedente,
          concepto: `Cobro #${item.numeroComprobante} - Excedente Consumo ($${excedente.toFixed(2)}) - ${item.nombreSocio}`,
          idReferencia: item.idReferencia,
          idFactura: idFac
        });
      }
    } else {
      // Abono parcial a tarifa de agua: distribuir en proporción
      const ratio = monto / baseEsperada;
      const operacionBaseTeorica = es3ra ? 2.00 : 4.00;
      
      const pOperacion = Number((operacionBaseTeorica * ratio).toFixed(2));
      const pParroquia = Number((2.00 * ratio).toFixed(2));
      const pLector = Number((0.50 * ratio).toFixed(2));
      const pMortuorio = Number((monto - (pOperacion + pParroquia + pLector)).toFixed(2));

      asientos.push(
        {
          idFondo: FONDO_IDS.OPERACION_MANT,
          nombreFondo: 'Operación y Mantenimiento',
          monto: pOperacion,
          concepto: `Cobro #${item.numeroComprobante} - Abono Operación ($${pOperacion.toFixed(2)}) - ${item.nombreSocio}`,
          idReferencia: item.idReferencia,
          idFactura: idFac
        },
        {
          idFondo: FONDO_IDS.PADRE_PARROQUIA,
          nombreFondo: 'Aporte Parroquial',
          monto: pParroquia,
          concepto: `Cobro #${item.numeroComprobante} - Abono Parroquial ($${pParroquia.toFixed(2)}) - ${item.nombreSocio}`,
          idReferencia: item.idReferencia,
          idFactura: idFac
        },
        {
          idFondo: FONDO_IDS.PAGO_LECTOR,
          nombreFondo: 'Pago Lector',
          monto: pLector,
          concepto: `Cobro #${item.numeroComprobante} - Abono Lector ($${pLector.toFixed(2)}) - ${item.nombreSocio}`,
          idReferencia: item.idReferencia,
          idFactura: idFac
        },
        {
          idFondo: FONDO_IDS.MORTUORIO,
          nombreFondo: 'Fondo Mortuorio',
          monto: pMortuorio,
          concepto: `Cobro #${item.numeroComprobante} - Abono Mortuorio ($${pMortuorio.toFixed(2)}) - ${item.nombreSocio}`,
          idReferencia: item.idReferencia,
          idFactura: idFac
        }
      );
    }
  }
}
