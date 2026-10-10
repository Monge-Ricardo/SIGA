import { SupabaseCajaRepository } from '../infrastructure/SupabaseCajaRepository.ts';
import type { ConsultarDeudasSocioResponseDTO, RubroPendienteSocioDTO } from '../domain/CajaDTOs.ts';

export class ConsultarDeudasSocioUseCase {
  private readonly cajaRepo: SupabaseCajaRepository;

  constructor(cajaRepo: SupabaseCajaRepository = new SupabaseCajaRepository()) {
    this.cajaRepo = cajaRepo;
  }

  public async ejecutar(idSocio: string): Promise<ConsultarDeudasSocioResponseDTO> {
    const socio = await this.cajaRepo.getSocioInfo(idSocio);
    if (!socio) {
      throw new Error(`Socio con ID ${idSocio} no fue encontrado en la base de datos.`);
    }

    const [medidores, sectores, facturas, multas, periodos, lecturas] = await Promise.all([
      this.cajaRepo.getMedidoresSocio(idSocio),
      this.cajaRepo.getSectores(),
      this.cajaRepo.getFacturasPendientes(idSocio),
      this.cajaRepo.getMultasPendientes(idSocio),
      typeof this.cajaRepo.getPeriodos === 'function' ? this.cajaRepo.getPeriodos() : Promise.resolve([]),
      typeof this.cajaRepo.getLecturasSocio === 'function' ? this.cajaRepo.getLecturasSocio(idSocio) : Promise.resolve([])
    ]);

    const secMap = new Map(sectores.map((s) => [s.id, s.nombre_sector]));
    const medMap = new Map(medidores.map((m) => [m.id, m]));
    const primaryMed = medidores[0] || null;
    const sectorName = primaryMed?.id_sector ? (secMap.get(primaryMed.id_sector) || 'Sector General') : (socio.id_sector ? (secMap.get(socio.id_sector) || 'Sector General') : 'Sector General');
    const medidorNum = medidores.length > 0 ? medidores.map((m) => m.numero_medidor).filter(Boolean).join(', ') : (socio.medidor_numero || 'S/N');
    const tieneAlcantarillado = medidores.some((m) => Boolean(m.tiene_alcantarillado)) || Boolean(socio.tiene_alcantarillado);

    // Identificar el período activo abierto
    const activePeriod = periodos.find((p) => p.estado === 'ABIERTO') || periodos[0] || null;
    const activePeriodId = activePeriod?.id;

    // Mapa de lecturas por id_lectura y por (id_medidor + id_periodo)
    const lecturasById = new Map(lecturas.map((l) => [l.id, l]));
    const lecturasByMedPer = new Map(lecturas.map((l) => [`${l.id_medidor}_${l.id_periodo}`, l]));

    // Cálculo de Tercera Edad (>= 65 años)
    const esTerceraEdad = this.calcularEsTerceraEdad(socio.fecha_nacimiento);

    const rubrosPendientes: RubroPendienteSocioDTO[] = [];

    // 1. Desglosar Facturas Pendientes (Agua activa, periodos cerrados, deudas anteriores)
    for (const f of facturas) {
      const fNum = String(f.numero_factura || f.id || '');
      const esDeudaHistorica = (Number(f.valor_deuda_anterior || 0) > 0 && Number(f.total_mes || 0) === 0) ||
        !f.id_periodo ||
        String(f.id_periodo).includes('000000000000') ||
        (activePeriodId ? f.id_periodo !== activePeriodId : false);
      const esPeriodoActivo = !esDeudaHistorica && Boolean(activePeriodId && (f.id_periodo === activePeriodId || f.periodo_codigo === activePeriod?.periodo_codigo));

      // Buscar medidor específico asociado a la factura
      const medObj = f.id_medidor ? medMap.get(f.id_medidor) : null;
      const numMed = medObj?.numero_medidor || (medidores.length === 1 ? medidores[0]?.numero_medidor : undefined);

      // Buscar lectura real para cálculo exacto de consumo
      const lec = (f.id_lectura ? lecturasById.get(f.id_lectura) : null) || lecturasByMedPer.get(`${f.id_medidor}_${f.id_periodo}`) || null;
      const lAnt = Number(lec?.lectura_anterior ?? f.lectura_anterior ?? 0);
      const lAct = Number(lec?.lectura_actual ?? f.lectura_actual ?? 0);
      const consM3 = Math.max(0, Number((lAct - lAnt).toFixed(2)) || Number(lec?.consumo_total ?? f.consumo_m3 ?? 0));
      const excM3 = Math.max(0, Number((consM3 - 30).toFixed(2)));
      const vBase = Number(f.valor_base || (esTerceraEdad ? 5.00 : 7.00));
      const vExcedente = Number((excM3 * 0.10).toFixed(2)) || Number(f.valor_excedente || 0);
      const vAlcantarillado = (tieneAlcantarillado || Number(f.valor_alcantarillado || 0) > 0) ? 1.00 : 0.00;
      const totalAguaCalculado = Number((vBase + vExcedente + vAlcantarillado).toFixed(2));

      // En el periodo activo, el valor de agua es estrictamente Base + Excedente + Alcantarillado
      let saldo = 0;
      if (esPeriodoActivo) {
        saldo = totalAguaCalculado;
      } else if (f.saldo_pendiente !== undefined && f.saldo_pendiente !== null) {
        saldo = Number(f.saldo_pendiente);
      } else {
        saldo = Number((Number(f.total_mes) > 0 ? f.total_mes : f.total_pagar) || 0);
      }

      if (saldo <= 0) continue;

      let tipo: RubroPendienteSocioDTO['tipo'] = 'AGUA_PERIODO_ANTERIOR';
      if (esDeudaHistorica) {
        tipo = 'DEUDA_HISTORICA_CORTE';
      } else if (esPeriodoActivo) {
        tipo = 'AGUA_PERIODO_ACTIVO';
      }

      const pObj = periodos.find((p) => p.id === f.id_periodo);
      const pNombre = pObj?.nombre || pObj?.periodo_codigo || (esPeriodoActivo ? (activePeriod?.nombre || 'Período Activo') : 'Anterior');

      let concepto = `Planilla de Agua #${fNum}`;
      if (esDeudaHistorica) {
        const perTxt = pObj?.nombre || pObj?.periodo_codigo ? ` (Corte ${pObj?.nombre || pObj?.periodo_codigo})` : '';
        concepto = numMed ? `Deuda Anterior${perTxt} - Medidor #${numMed} (#${fNum})` : `Deuda Anterior${perTxt} (#${fNum})`;
      } else if (esPeriodoActivo) {
        concepto = numMed ? `Consumo de Agua del Mes - Medidor #${numMed} (#${fNum})` : `Consumo de Agua del Mes - ${pNombre} (#${fNum})`;
      } else {
        concepto = numMed ? `Consumo de Agua (${pNombre}) - Medidor #${numMed} (#${fNum})` : `Consumo de Agua Período Anterior - ${pNombre} (#${fNum})`;
      }

      rubrosPendientes.push({
        id: f.id,
        tipo,
        idReferencia: f.id,
        periodo: pObj?.periodo_codigo || f.periodo_codigo || undefined,
        numeroFactura: fNum,
        numeroMedidor: numMed,
        concepto,
        fechaVencimiento: f.fecha_vencimiento || undefined,
        montoOriginal: saldo,
        montoPagadoPrevio: Number(f.monto_pagado || 0),
        saldoPendiente: saldo,
        esTerceraEdad,
        detallesAgua: esPeriodoActivo || f.id_lectura ? {
          lecturaAnterior: lAnt,
          lecturaActual: lAct,
          consumoM3: consM3,
          excedenteM3: excM3,
          valorBase: vBase,
          valorExcedente: vExcedente,
          valorAlcantarillado: vAlcantarillado
        } : undefined
      });
    }

    // 2. Desglosar Multas / Mingas / Asambleas / Aportes
    for (const m of multas) {
      const saldo = Number(m.saldo_pendiente ?? m.monto ?? 0);
      if (saldo <= 0) continue;

      const tipoRubro = String(m.tipo_rubro || '').toUpperCase();
      const isAlc = tipoRubro === 'ALCANTARILLADO';

      rubrosPendientes.push({
        id: m.id,
        tipo: isAlc ? 'ALCANTARILLADO' : 'MULTA_COMUNITARIA',
        idReferencia: m.id,
        concepto: m.concepto || m.motivo || `Rubro ${tipoRubro}`,
        montoOriginal: Number(m.monto || saldo),
        montoPagadoPrevio: Number(m.monto_pagado || 0),
        saldoPendiente: saldo,
        esTerceraEdad
      });
    }

    const totalDeuda = Number(
      rubrosPendientes.reduce((acc, r) => acc + r.saldoPendiente, 0).toFixed(2)
    );

    return {
      socio: {
        id: socio.id,
        codigoSocio: socio.codigo_socio || 'S/N',
        nombres: socio.nombres || '',
        apellidos: socio.apellidos || '',
        nombreCompleto: `${socio.nombres || ''} ${socio.apellidos || ''}`.trim() || socio.codigo_socio,
        cedulaRuc: socio.cedula_ruc || '',
        esTerceraEdad,
        tieneAlcantarillado,
        sector: sectorName,
        numeroMedidor: medidorNum,
        medidores: medidores.map((m) => ({
          id: m.id,
          numeroMedidor: m.numero_medidor,
          alias: m.alias || 'Medidor'
        }))
      },
      rubrosPendientes,
      totalDeudaPendiente: totalDeuda,
      totalPeriodosImpagos: facturas.length
    };
  }

  private calcularEsTerceraEdad(fechaNacimientoStr?: string): boolean {
    if (!fechaNacimientoStr) return false;
    const nacimiento = new Date(fechaNacimientoStr);
    if (isNaN(nacimiento.getTime())) return false;
    const hoy = new Date();
    let edad = hoy.getFullYear() - nacimiento.getFullYear();
    const m = hoy.getMonth() - nacimiento.getMonth();
    if (m < 0 || (m === 0 && hoy.getDate() < nacimiento.getDate())) {
      edad--;
    }
    return edad >= 65;
  }
}
