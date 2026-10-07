import { FONDO_IDS, type CuadreCajaDiarioResponseDTO, type RegistrarEgresoRequestDTO, type RegistrarEgresoResponseDTO } from '../domain/CajaDTOs.ts';
import { SupabaseCajaRepository } from '../infrastructure/SupabaseCajaRepository.ts';

export class CuadreCajaUseCase {
  private readonly repo: SupabaseCajaRepository;

  constructor(repo: SupabaseCajaRepository = new SupabaseCajaRepository()) {
    this.repo = repo;
  }

  /**
   * Ejecuta el cálculo del cuadre diario de caja para una fecha dada (o hoy por defecto)
   * Cumple con RF-CAJ-10, RF-CAJ-11, RN-13
   */
  public async ejecutar(fechaStr?: string, idCajero?: string): Promise<CuadreCajaDiarioResponseDTO> {
    // 1. Determinar rango de fecha (UTC / Local Ecuador UTC-5)
    const esHistoricoTodos = fechaStr?.toUpperCase() === 'TODOS';
    let dateOnly = '';
    if (fechaStr && typeof fechaStr === 'string' && fechaStr.trim().length >= 10 && !esHistoricoTodos) {
      dateOnly = fechaStr.trim().slice(0, 10);
    } else {
      dateOnly = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date());
    }

    const d = new Date(dateOnly + 'T12:00:00Z');
    d.setDate(d.getDate() + 1);
    const nextDate = d.toISOString().slice(0, 10);

    const inicioDia = esHistoricoTodos ? '1970-01-01T00:00:00.000Z' : `${dateOnly}T00:00:00.000Z`;
    const finDia = esHistoricoTodos ? '2099-12-31T23:59:59.999Z' : `${nextDate}T05:00:00.000Z`;

    // 2. Consultar movimientos de fondos, facturas cobradas, socios y acumulados históricos en paralelo
    const [movimientos, fondosCatalogo, facturasCobradas, sociosCatalogo, totalesHistoricos] = await Promise.all([
      this.repo.getMovimientosFondosPorFecha(inicioDia, finDia),
      this.repo.getFondosCatalogo(),
      this.repo.getFacturasCobradasPorFecha(inicioDia, finDia),
      typeof this.repo.getSociosCatalogo === 'function' ? this.repo.getSociosCatalogo() : Promise.resolve([]),
      typeof this.repo.getTotalesHistoricosCaja === 'function' ? this.repo.getTotalesHistoricosCaja() : Promise.resolve(null)
    ]);

    const sociosMap = new Map(sociosCatalogo.map((s) => [s.id, s]));

    // 3. Procesar egresos
    const egresosMovs = movimientos.filter(m => (m.tipo || '').toUpperCase() === 'EGRESO');
    const totalEgresos = egresosMovs.reduce((acc, m) => acc + Math.abs(Number(m.egreso || m.monto || 0)), 0);

    // 4. Procesar ingresos auditados por comprobante garantizando consistencia matemática con el libro diario
    const ingresosMovs = movimientos.filter(m => (m.tipo || '').toUpperCase() === 'INGRESO');

    const facturasMap = new Map<string, Record<string, any>>();
    for (const f of facturasCobradas) {
      if (f.numero_factura) facturasMap.set(f.numero_factura, f);
      if (f.id) facturasMap.set(f.id, f);
    }

    const compDataMap = new Map<string, {
      total: number;
      fecha: string;
      rawTimestamp: number;
      idFactura?: string;
      beneficiario?: string;
    }>();

    for (const m of ingresosMovs) {
      const comp = m.numero_comprobante || m.id_factura || 'REC-DESC';
      const monto = Number(m.ingreso || 0);
      const mFecha = m.fecha || m.created_at || `${dateOnly}T12:00:00Z`;
      const mTime = new Date(mFecha).getTime() || 0;

      const existing = compDataMap.get(comp);
      if (existing) {
        existing.total += monto;
        if (!existing.idFactura && m.id_factura) existing.idFactura = m.id_factura;
        if (!existing.beneficiario && m.beneficiario) existing.beneficiario = m.beneficiario;
        if (mTime && mTime < existing.rawTimestamp) {
          existing.rawTimestamp = mTime;
          existing.fecha = mFecha;
        }
      } else {
        compDataMap.set(comp, {
          total: monto,
          fecha: mFecha,
          rawTimestamp: mTime,
          idFactura: m.id_factura,
          beneficiario: m.beneficiario
        });
      }
    }

    const recibosDetalle: CuadreCajaDiarioResponseDTO['recibosDetalle'] = [];
    const processedComps = new Set<string>();

    for (const m of ingresosMovs) {
      if (m.numero_comprobante) processedComps.add(m.numero_comprobante);
      if (m.id_factura) processedComps.add(m.id_factura);
      const match = (m.concepto || '').match(/(FAC-[A-Za-z0-9-]+)/);
      if (match) processedComps.add(match[1]);
    }

    for (const [compNum, data] of compDataMap.entries()) {
      processedComps.add(compNum);
      if (data.idFactura) processedComps.add(data.idFactura);

      const f = facturasMap.get(compNum) || (data.idFactura ? facturasMap.get(data.idFactura) : null);
      if (f?.numero_factura) processedComps.add(f.numero_factura);
      if (f?.id) processedComps.add(f.id);

      const sObj = f?.id_socio ? sociosMap.get(f.id_socio) : null;
      const nombreSocio = sObj
        ? `${sObj.nombres || ''} ${sObj.apellidos || ''}`.trim()
        : (data.beneficiario || f?.socio_nombre || f?.nombre_socio || 'Socio Comunitario');

      const metodo = (f?.metodo_pago || 'EFECTIVO').toUpperCase() === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : 'EFECTIVO';
      const d = data.fecha ? new Date(data.fecha) : null;
      const horaStr = d && !isNaN(d.getTime()) ? d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false }) : '12:00';
      const fechaStr = d && !isNaN(d.getTime()) ? d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
      const fechaHoraStr = fechaStr ? `${fechaStr} ${horaStr}` : horaStr;

      recibosDetalle.push({
        id: f?.id || compNum,
        numeroRecibo: compNum,
        hora: fechaHoraStr,
        fechaHora: fechaHoraStr,
        fecha: fechaStr,
        fechaIso: data.fecha,
        rawTimestamp: data.rawTimestamp,
        socio: nombreSocio,
        socioCedula: sObj?.cedula_ruc || f?.socio_cedula || '',
        socioCodigo: sObj?.codigo_socio || f?.socio_codigo || '',
        numeroMedidor: f?.numero_medidor || '',
        metodoPago: metodo,
        monto: Math.round(data.total * 100) / 100
      } as any);
    }

    // Agregar facturas que pudieran estar cobradas sin movimientos contables directos
    for (const f of facturasCobradas) {
      const numF = f.numero_factura || f.id;
      if (numF && !processedComps.has(numF) && !processedComps.has(f.id)) {
        processedComps.add(numF);
        processedComps.add(f.id);
        const monto = Number(f.monto_pagado ?? f.total_pagar ?? f.total_mes ?? f.total ?? 0);
        const metodo = (f.metodo_pago || 'EFECTIVO').toUpperCase() === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : 'EFECTIVO';
        const d = f.fecha_pago ? new Date(f.fecha_pago) : null;
        const horaStr = d && !isNaN(d.getTime()) ? d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false }) : '12:00';
        const fechaStr = d && !isNaN(d.getTime()) ? d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
        const fechaHoraStr = fechaStr ? `${fechaStr} ${horaStr}` : horaStr;
        const fTime = d && !isNaN(d.getTime()) ? d.getTime() : 0;
        const sObj = f.id_socio ? sociosMap.get(f.id_socio) : null;
        const nombreSocio = sObj ? `${sObj.nombres || ''} ${sObj.apellidos || ''}`.trim() : (f.socio_nombre || f.nombre_socio || 'Socio Comunitario');

        recibosDetalle.push({
          id: f.id,
          numeroRecibo: numF,
          hora: fechaHoraStr,
          fechaHora: fechaHoraStr,
          fecha: fechaStr,
          fechaIso: f.fecha_pago,
          rawTimestamp: fTime,
          socio: nombreSocio,
          socioCedula: sObj?.cedula_ruc || f.socio_cedula || '',
          socioCodigo: sObj?.codigo_socio || f.socio_codigo || '',
          numeroMedidor: f.numero_medidor || '',
          metodoPago: metodo,
          monto: Math.round(monto * 100) / 100
        } as any);
      }
    }

    // Orden cronológico: las más recientes primeras y las más antiguas abajo
    recibosDetalle.sort((a: any, b: any) => {
      const tA = a.rawTimestamp || 0;
      const tB = b.rawTimestamp || 0;
      if (tA !== tB) return tB - tA;
      return (b.numeroRecibo || '').localeCompare(a.numeroRecibo || '');
    });

    let totalEfectivo = 0;
    let totalTransferencia = 0;
    for (const r of recibosDetalle) {
      if (r.metodoPago === 'TRANSFERENCIA') {
        totalTransferencia += r.monto;
      } else {
        totalEfectivo += r.monto;
      }
    }

    // 5. Agrupar distribución por fondos comunitarios
    const fondosMap = new Map<string, { nombre: string; total: number }>();
    for (const f of fondosCatalogo) {
      fondosMap.set(f.id, { nombre: f.nombre || 'Fondo Comunitario', total: 0 });
    }
    // Asegurar los 7 fondos en el mapa
    fondosMap.set(FONDO_IDS.PADRE_PARROQUIA, fondosMap.get(FONDO_IDS.PADRE_PARROQUIA) || { nombre: 'Padre Parroquia', total: 0 });
    fondosMap.set(FONDO_IDS.OPERACION_MANT, fondosMap.get(FONDO_IDS.OPERACION_MANT) || { nombre: 'Operación y Mantenimiento', total: 0 });
    fondosMap.set(FONDO_IDS.PAGO_LECTOR, fondosMap.get(FONDO_IDS.PAGO_LECTOR) || { nombre: 'Pago al Lector', total: 0 });
    fondosMap.set(FONDO_IDS.MORTUORIO, fondosMap.get(FONDO_IDS.MORTUORIO) || { nombre: 'Fondo Mortuorio', total: 0 });
    fondosMap.set(FONDO_IDS.PRO_MEJORAS, fondosMap.get(FONDO_IDS.PRO_MEJORAS) || { nombre: 'Pro-Mejoras (Excedentes)', total: 0 });
    fondosMap.set(FONDO_IDS.MULTAS_EXTRAS, fondosMap.get(FONDO_IDS.MULTAS_EXTRAS) || { nombre: 'Multas y Obras Comunitarias', total: 0 });
    fondosMap.set(FONDO_IDS.ALCANTARILLADO, fondosMap.get(FONDO_IDS.ALCANTARILLADO) || { nombre: 'Mantenimiento Red Alcantarillado', total: 0 });

    for (const m of movimientos) {
      if ((m.tipo || '').toUpperCase() === 'INGRESO' && m.id_fondo) {
        const current = fondosMap.get(m.id_fondo);
        if (current) {
          current.total += Number(m.ingreso || 0);
        } else {
          fondosMap.set(m.id_fondo, { nombre: 'Fondo Adicional', total: Number(m.ingreso || 0) });
        }
      }
    }

    const distribucionPorFondos = Array.from(fondosMap.entries()).map(([idFondo, data]) => ({
      idFondo,
      nombreFondo: data.nombre,
      totalRecaudado: Math.round(data.total * 100) / 100
    }));

    // 6. Egresos detalle
    const egresosDetalle = egresosMovs.map(e => {
      const d = e.fecha ? new Date(e.fecha) : null;
      const horaStr = d && !isNaN(d.getTime()) ? d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false }) : '12:00';
      const fechaStr = d && !isNaN(d.getTime()) ? d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
      const fechaHoraStr = fechaStr ? `${fechaStr} ${horaStr}` : horaStr;
      return {
        id: e.id || '',
        hora: fechaHoraStr,
        fechaHora: fechaHoraStr,
        fecha: fechaStr,
        beneficiario: e.beneficiario || 'No especificado',
        motivo: e.concepto || 'Gasto Operativo',
        monto: Math.round(Math.abs(Number(e.egreso || e.monto || 0)) * 100) / 100
      };
    });

    const totalCobrosEfectivo = Math.round(totalEfectivo * 100) / 100;
    const totalCobrosTransferencia = Math.round(totalTransferencia * 100) / 100;
    const totalEgresosCajaChica = Math.round(totalEgresos * 100) / 100;
    const saldoNetoEfectivo = Math.round((totalCobrosEfectivo - totalEgresosCajaChica) * 100) / 100;

    return {
      fecha: esHistoricoTodos ? 'TODOS' : dateOnly,
      cajero: {
        id: idCajero || 'cajero-ventanilla',
        nombre: 'Cajero en Turno'
      },
      resumenOperaciones: {
        totalRecibosEmitidos: recibosDetalle.length,
        totalCobrosEfectivo,
        totalCobrosTransferencia,
        totalEgresosCajaChica,
        saldoNetoEfectivo
      },
      distribucionPorFondos,
      recibosDetalle,
      egresosDetalle,
      balanceGeneral: totalesHistoricos ? {
        totalRecaudadoHistorico: totalesHistoricos.totalRecaudado,
        totalEgresosHistorico: totalesHistoricos.totalEgresos,
        saldoNetoDisponible: Number((totalesHistoricos.totalRecaudado - totalesHistoricos.totalEgresos).toFixed(2)),
        totalRecibosHistoricos: totalesHistoricos.totalFacturas,
        totalEgresosCount: totalesHistoricos.totalEgresosCount
      } : undefined
    };
  }

  /**
   * Registra un egreso de caja chica (RN-14)
   */
  public async registrarEgreso(dto: RegistrarEgresoRequestDTO): Promise<RegistrarEgresoResponseDTO> {
    if (!dto.monto || dto.monto <= 0) {
      throw new Error('El monto del egreso debe ser estrictamente mayor a 0');
    }
    if (!dto.motivo || !dto.motivo.trim()) {
      throw new Error('El motivo o justificación del egreso es obligatorio');
    }
    if (!dto.beneficiario || !dto.beneficiario.trim()) {
      throw new Error('El beneficiario que recibe el dinero es obligatorio');
    }

    const fondoOperacion = FONDO_IDS.OPERACION_MANT;

    const asiento = await this.repo.registrarEgreso({
      idFondo: fondoOperacion,
      monto: Math.round(dto.monto * 100) / 100,
      motivo: dto.motivo.trim(),
      beneficiario: dto.beneficiario.trim(),
      idCajero: dto.idCajero || 'sistema',
      comprobante: dto.comprobanteRespaldo
    });

    return {
      id: asiento.id,
      fecha: asiento.fecha,
      monto: asiento.egreso,
      motivo: dto.motivo.trim(),
      beneficiario: dto.beneficiario.trim(),
      comprobanteRespaldo: dto.comprobanteRespaldo
    };
  }
}
