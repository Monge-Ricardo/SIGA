import { SupabaseCajaRepository } from '../infrastructure/SupabaseCajaRepository.ts';
import { CobroTransaction } from '../domain/CobroTransaction.ts';
import { DistribucionFondosStrategy, type ItemLiquidadoContext } from '../domain/DistribucionFondosStrategy.ts';
import type { RegistrarCobroRequestDTO, RegistrarCobroResponseDTO, TipoRubroCobro } from '../domain/CajaDTOs.ts';
import { isPeriodoCorte } from '../../../controllers/financeController.ts';
import crypto from 'node:crypto';

export class ProcesarCobroUseCase {
  private readonly cajaRepo: SupabaseCajaRepository;

  constructor(cajaRepo: SupabaseCajaRepository = new SupabaseCajaRepository()) {
    this.cajaRepo = cajaRepo;
  }

  public async ejecutar(dto: RegistrarCobroRequestDTO): Promise<RegistrarCobroResponseDTO> {
    const txId = crypto.randomUUID();

    let rawSocioId = (dto.idSocio || (dto as any).id_socio || (dto as any).socioId || (dto as any).id || '').toString().trim();
    const rawCajeroId = (dto.idCajero || (dto as any).id_cajero || (dto as any).cajeroId || '').toString().trim() || '00000000-0000-0000-0000-000000000002';

    // 1. Salvaguarda: Si no vino el ID explícito del socio, deducirlo del primer rubro/factura a cobrar
    if (!rawSocioId && Array.isArray(dto.items) && dto.items.length > 0) {
      for (const it of dto.items) {
        if (!it.idReferencia) continue;
        const fac = await this.cajaRepo.getFacturaPorIdONumero(it.idReferencia);
        if (fac?.id_socio) {
          rawSocioId = String(fac.id_socio);
          break;
        }
      }
    }

    const [socio, periodos] = await Promise.all([
      this.cajaRepo.getSocioInfo(rawSocioId),
      typeof this.cajaRepo.getPeriodos === 'function' ? this.cajaRepo.getPeriodos() : Promise.resolve([])
    ]);
    if (!socio) {
      throw new Error(`Socio con ID o identificador '${rawSocioId}' no encontrado.`);
    }

    const activePeriod = periodos.find((p: any) => (p.estado || '').toUpperCase() === 'ABIERTO') || periodos[periodos.length - 1];
    const activePeriodId = activePeriod?.id;

    const socioId = socio.id;

    // 2. Instanciar entidad y validar reglas de invariantes matemáticas
    const cobroTx = new CobroTransaction({
      id: txId,
      idSocio: socioId,
      idCajero: rawCajeroId,
      metodoPago: dto.metodoPago,
      montoTotalRecibido: dto.montoTotalRecibido,
      referenciaBancaria: dto.referenciaBancaria,
      items: dto.items
    });

    const nombreCompleto = `${socio.nombres || ''} ${socio.apellidos || ''}`.trim() || socio.codigo_socio;
    const es3ra = this.calcularEsTerceraEdad(socio.fecha_nacimiento);
    const now = new Date().toISOString();
    let numeroRecibo = `REC-${String(Date.now()).slice(-6)}`;
    if (cobroTx.items.length === 1 && (cobroTx.items[0].tipo.startsWith('AGUA_') || cobroTx.items[0].tipo === 'DEUDA_HISTORICA_CORTE')) {
      const singleFac = await this.cajaRepo.getFacturaPorIdONumero(cobroTx.items[0].idReferencia);
      if (singleFac?.numero_factura) {
        numeroRecibo = singleFac.numero_factura;
      }
    }

    const facturasActualizaciones: { id: string; patch: Record<string, any> }[] = [];
    const multasActualizaciones: { id: string; patch: Record<string, any>; abonoRecord?: Record<string, any> }[] = [];
    const itemsLiquidacionFondos: ItemLiquidadoContext[] = [];
    const rubrosLiquidados: RegistrarCobroResponseDTO['rubrosLiquidados'] = [];

    const itemsFacturas = cobroTx.items.filter(
      (item) =>
        item.tipo === 'AGUA_PERIODO_ACTIVO' ||
        item.tipo === 'AGUA_PERIODO_ANTERIOR' ||
        item.tipo === 'DEUDA_HISTORICA_CORTE'
    );
    const itemsMultas = cobroTx.items.filter(
      (item) =>
        item.tipo !== 'AGUA_PERIODO_ACTIVO' &&
        item.tipo !== 'AGUA_PERIODO_ANTERIOR' &&
        item.tipo !== 'DEUDA_HISTORICA_CORTE'
    );

    // 3a. Procesar cada factura a cobrar
    for (const item of itemsFacturas) {
      const fac = await this.cajaRepo.getFacturaPorIdONumero(item.idReferencia);
      if (!fac) {
        throw new Error(`Factura ${item.idReferencia} no encontrada.`);
      }

      const saldoActual = fac.saldo_pendiente !== undefined && fac.saldo_pendiente !== null
        ? Number(fac.saldo_pendiente)
        : Number((Number(fac.total_mes) > 0 ? fac.total_mes : fac.total_pagar) || 0);

      if (item.montoACobrar > saldoActual + 0.001) {
        throw new Error(
          `El monto a cobrar ($${item.montoACobrar.toFixed(2)}) supera el saldo de la factura ${fac.numero_factura} ($${saldoActual.toFixed(2)}).`
        );
      }

      const nuevoSaldo = Number(Math.max(0, saldoActual - item.montoACobrar).toFixed(2));
      const estaExtinguida = nuevoSaldo === 0;

      facturasActualizaciones.push({
        id: fac.id,
        patch: {
          estado_pago: estaExtinguida ? 'PAGADO' : 'PENDIENTE',
          total_pagar: estaExtinguida ? Number(fac.total_mes || fac.total_pagar || item.montoACobrar) : nuevoSaldo,
          valor_multas: 0.00, // @deprecated: Multas gestionadas de forma independiente
          fecha_pago: estaExtinguida ? now : (fac.fecha_pago || null),
          metodo_pago: estaExtinguida ? dto.metodoPago : (fac.metodo_pago || null),
          id_cajero: estaExtinguida ? rawCajeroId : (fac.id_cajero || null),
          updated_at: now
        }
      });

      const pObj = periodos.find((p: any) => p.id === fac.id_periodo);
      const pCodigo = String(pObj?.periodo_codigo || fac.periodo_codigo || '').trim();
      const esCorteInicial = isPeriodoCorte(pCodigo) ||
        (!fac.id_periodo && Number(fac.total_mes || 0) === 0 && !fac.id_lectura && Number(fac.consumo_m3 || 0) === 0);

      // Regla Macro: Si el periodo es a partir de Agosto 2026 (> 2026-07) o registra consumo/lectura,
      // es AGUA_PERIODO_ANTERIOR (o ACTIVO). Solo el corte inicial <= 2026-07 es DEUDA_HISTORICA_CORTE.
      let tipoReal: TipoRubroCobro = item.tipo;
      if (esCorteInicial) {
        tipoReal = 'DEUDA_HISTORICA_CORTE';
      } else if (activePeriodId && fac.id_periodo === activePeriodId) {
        tipoReal = 'AGUA_PERIODO_ACTIVO';
      } else if (pCodigo > '2026-07' || Number(fac.total_mes || 0) > 0 || Number(fac.valor_base || 0) > 0 || Boolean(fac.id_lectura)) {
        tipoReal = 'AGUA_PERIODO_ANTERIOR';
      }

      itemsLiquidacionFondos.push({
        tipo: tipoReal,
        idReferencia: fac.id,
        idFactura: fac.id,
        numeroComprobante: numeroRecibo,
        monto: item.montoACobrar,
        esTerceraEdad: es3ra,
        valorBase: Number(fac.valor_base || (es3ra ? 5.00 : 7.00)),
        valorExcedente: Number(fac.valor_excedente || 0),
        valorAlcantarillado: Number(fac.valor_alcantarillado || 0),
        nombreSocio: nombreCompleto
      });

      const descFac = esCorteInicial
        ? `Deuda Anterior / Saldo Histórico (#${fac.numero_factura || fac.id.slice(0, 8)})`
        : (fac.numero_factura ? `Planilla de Agua #${fac.numero_factura}` : 'Planilla de Agua');

      const totalOriginalFac = Number((Number(fac.valor_deuda_anterior || 0) + Number(fac.total_mes || fac.total_pagar || 0)).toFixed(2));
      const valTotFacturado = totalOriginalFac > 0 ? totalOriginalFac : saldoActual;

      rubrosLiquidados.push({
        tipo: tipoReal,
        idReferencia: fac.id,
        descripcion: item.descripcion || descFac,
        valorTotal: valTotFacturado,
        montoOriginal: valTotFacturado,
        montoPagado: item.montoACobrar,
        aPagarCobrado: item.montoACobrar,
        saldoRestante: nuevoSaldo,
        estadoFinal: estaExtinguida ? 'PAGADO' : 'PARCIAL'
      });
    }

    // Si solo se cobran multas (sin facturas), emitir un recibo independiente en facturas para dar soporte contable y FK
    let nuevoReciboFactura: Record<string, any> | undefined = undefined;
    let reciboFacturaId: string | undefined = undefined;

    if (facturasActualizaciones.length === 0 && itemsMultas.length > 0) {
      reciboFacturaId = crypto.randomUUID();
      nuevoReciboFactura = {
        id: reciboFacturaId,
        numero_factura: numeroRecibo,
        id_socio: socioId,
        id_medidor: null,
        id_periodo: null,
        id_lectura: null,
        es_tercera_edad: es3ra,
        valor_base: 0,
        consumo_m3: 0,
        excedente_m3: 0,
        valor_excedente: 0,
        valor_alcantarillado: 0,
        valor_multas: cobroTx.totalACobrar,
        valor_deuda_anterior: 0,
        total_mes: 0,
        total_pagar: cobroTx.totalACobrar,
        estado_pago: 'PAGADO',
        fecha_vencimiento: now.slice(0, 10),
        fecha_pago: now,
        metodo_pago: dto.metodoPago,
        id_cajero: rawCajeroId,
        version: 1,
        created_at: now,
        updated_at: now
      };
    }

    const primaryFacturaId = facturasActualizaciones[0]?.id || reciboFacturaId;

    // 3b. Procesar multas y rubros comunitarios
    for (const item of itemsMultas) {
      const rubro = await this.cajaRepo.getMultaPorId(item.idReferencia);
      if (!rubro) {
        throw new Error(`Rubro o multa ${item.idReferencia} no encontrado.`);
      }

      const saldoActual = Number(rubro.saldo_pendiente ?? rubro.monto ?? 0);
      if (item.montoACobrar > saldoActual + 0.001) {
        throw new Error(
          `El monto a cobrar ($${item.montoACobrar.toFixed(2)}) supera el saldo del rubro ($${saldoActual.toFixed(2)}).`
        );
      }

      const nuevoSaldo = Number(Math.max(0, saldoActual - item.montoACobrar).toFixed(2));
      const nuevoMontoPagado = Number((Number(rubro.monto_pagado || 0) + item.montoACobrar).toFixed(2));
      const estaExtinguido = nuevoSaldo === 0;

      const idFacturaAsociada = rubro.id_factura || primaryFacturaId;

      const abonoRecord = {
        id: crypto.randomUUID(),
        id_rubro: rubro.id,
        id_factura: idFacturaAsociada,
        monto_abonado: item.montoACobrar,
        saldo_anterior: saldoActual,
        saldo_restante: nuevoSaldo,
        fecha: now,
        id_cajero: rawCajeroId,
        created_at: now
      };

      multasActualizaciones.push({
        id: rubro.id,
        patch: {
          monto_pagado: nuevoMontoPagado,
          saldo_pendiente: nuevoSaldo,
          estado: estaExtinguido ? 'PAGADO' : 'PARCIAL',
          pagado: estaExtinguido
        },
        abonoRecord
      });

      itemsLiquidacionFondos.push({
        tipo: item.tipo,
        idReferencia: rubro.id,
        idFactura: idFacturaAsociada,
        numeroComprobante: numeroRecibo,
        monto: item.montoACobrar,
        esTerceraEdad: es3ra,
        nombreSocio: nombreCompleto
      });

      const totalOriginalRubro = Number(rubro.monto || saldoActual);

      rubrosLiquidados.push({
        tipo: item.tipo,
        idReferencia: rubro.id,
        descripcion: item.descripcion || rubro.concepto || rubro.motivo || 'Multa / Rubro Comunitario',
        valorTotal: totalOriginalRubro,
        montoOriginal: totalOriginalRubro,
        montoPagado: item.montoACobrar,
        aPagarCobrado: item.montoACobrar,
        saldoRestante: nuevoSaldo,
        estadoFinal: estaExtinguido ? 'PAGADO' : 'PARCIAL'
      });
    }

    // 4. Calcular asientos a los 7 fondos y validar cuadre estricto
    const asientosFondos = DistribucionFondosStrategy.calcularAsientos(itemsLiquidacionFondos);
    cobroTx.validarAsientosContables(asientosFondos);

    // 5. Persistir atómicamente en Supabase
    await this.cajaRepo.persistirCobroAtómico({
      asientosFondos,
      numeroRecibo,
      idSocio: socioId,
      nombreSocio: nombreCompleto,
      idCajero: rawCajeroId,
      fechaPago: now,
      facturasActualizaciones,
      multasActualizaciones,
      nuevoReciboFactura
    });

    // 6. Calcular saldo pendiente restante total del socio
    const deudasActualizadas = await this.cajaRepo.getFacturasPendientes(socioId);
    const multasActualizadas = await this.cajaRepo.getMultasPendientes(socioId);
    const saldoTotalRestante = Number(
      (
        deudasActualizadas.reduce((acc, f) => acc + Number(f.saldo_pendiente ?? f.total_pagar ?? 0), 0) +
        multasActualizadas.reduce((acc, m) => acc + Number(m.saldo_pendiente ?? m.monto ?? 0), 0)
      ).toFixed(2)
    );

    return {
      success: true,
      transaccionId: numeroRecibo,
      numeroRecibo,
      facturaId: facturasActualizaciones.length === 1 ? facturasActualizaciones[0].id : (reciboFacturaId || facturasActualizaciones[0]?.id),
      fechaEmision: now,
      socio: {
        id: socio.id,
        nombreCompleto,
        cedulaRuc: socio.cedula_ruc || '',
        codigoSocio: socio.codigo_socio || 'S/N'
      },
      totalCobrado: cobroTx.totalACobrar,
      montoRecibido: cobroTx.montoTotalRecibido,
      cambioVuelto: cobroTx.cambioVuelto,
      metodoPago: cobroTx.metodoPago,
      referenciaBancaria: cobroTx.referenciaBancaria,
      asientosFondos,
      rubrosLiquidados,
      saldoPendienteRestanteTotal: saldoTotalRestante
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
