export interface ObligacionPendiente {
  id: string;
  numeroIdentificador: string;
  fechaEmision: string; // ISO string para ordenar cronológicamente
  saldoPendiente: number;
  tipo: string;
}

export interface ResultadoAsignacionFIFO {
  id: string;
  numeroIdentificador: string;
  montoOriginalPendiente: number;
  montoAbonado: number;
  saldoRestante: number;
  extinguida: boolean;
}

export class FIFOAllocationEngine {
  /**
   * Método de conveniencia para asignar pago FIFO sobre deudas con cálculo de totales
   */
  public asignarPagoFIFO(
    deudas: { idReferencia: string; concepto?: string; saldoPendiente: number; fechaEmision?: string }[],
    montoDisponible: number
  ): {
    montoTotalAplicado: number;
    remanenteNoAplicado: number;
    saldoPendienteTotalRestante: number;
    asignaciones: {
      idReferencia: string;
      concepto?: string;
      montoAsignado: number;
      saldoRestante: number;
      estadoFinal: 'PAGADO' | 'PARCIAL' | 'PENDIENTE';
    }[];
  } {
    let remanente = Number(Number(montoDisponible).toFixed(2));
    let totalAplicado = 0;
    const asignaciones = [];

    for (const d of deudas) {
      const saldo = Number(Number(d.saldoPendiente).toFixed(2));
      const aPagar = Math.min(remanente, saldo);
      const saldoRestante = Number((saldo - aPagar).toFixed(2));

      let estadoFinal: 'PAGADO' | 'PARCIAL' | 'PENDIENTE' = 'PENDIENTE';
      if (saldoRestante === 0 && saldo > 0) estadoFinal = 'PAGADO';
      else if (aPagar > 0) estadoFinal = 'PARCIAL';

      asignaciones.push({
        idReferencia: d.idReferencia,
        concepto: d.concepto,
        montoAsignado: aPagar,
        saldoRestante,
        estadoFinal
      });

      remanente = Number((remanente - aPagar).toFixed(2));
      totalAplicado = Number((totalAplicado + aPagar).toFixed(2));
    }

    const saldoPendienteTotalRestante = Number(asignaciones.reduce((acc, a) => acc + a.saldoRestante, 0).toFixed(2));

    return {
      montoTotalAplicado: totalAplicado,
      remanenteNoAplicado: remanente,
      saldoPendienteTotalRestante,
      asignaciones
    };
  }

  /**
   * Imputa un monto disponible a una lista de obligaciones pendientes siguiendo el orden cronológico FIFO.
   * Amortiza primero la deuda más antigua sin alterar facturas posteriores innecesariamente.
   */
  public static imputarAbono(
    obligaciones: ObligacionPendiente[],
    montoDisponible: number
  ): {
    asignaciones: ResultadoAsignacionFIFO[];
    montoRemanenteSinUsar: number;
  } {
    // Ordenar de la más antigua a la más reciente (FIFO)
    const ordenadas = [...obligaciones].sort(
      (a, b) => new Date(a.fechaEmision).getTime() - new Date(b.fechaEmision).getTime()
    );

    let remanente = Number(Number(montoDisponible).toFixed(2));
    const asignaciones: ResultadoAsignacionFIFO[] = [];

    for (const ob of ordenadas) {
      if (remanente <= 0) break;

      const saldo = Number(Number(ob.saldoPendiente).toFixed(2));
      if (saldo <= 0) continue;

      const montoAAplicar = Math.min(remanente, saldo);
      const nuevoSaldo = Number((saldo - montoAAplicar).toFixed(2));

      asignaciones.push({
        id: ob.id,
        numeroIdentificador: ob.numeroIdentificador,
        montoOriginalPendiente: saldo,
        montoAbonado: montoAAplicar,
        saldoRestante: nuevoSaldo,
        extinguida: nuevoSaldo === 0
      });

      remanente = Number((remanente - montoAAplicar).toFixed(2));
    }

    return {
      asignaciones,
      montoRemanenteSinUsar: remanente
    };
  }
}
