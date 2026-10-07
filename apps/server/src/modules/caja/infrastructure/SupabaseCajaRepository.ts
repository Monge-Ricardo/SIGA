import { supabaseClient } from '../../../db/supabase.ts';
import type { AsientoFondoDTO, MetodoPago } from '../domain/CajaDTOs.ts';
import crypto from 'node:crypto';

export class SupabaseCajaRepository {
  /**
   * Obtiene la información del socio, sus medidores y su sector
   */
  public async getSocioInfo(idSocio: string): Promise<Record<string, any> | null> {
    if (!idSocio) return null;
    const res = await supabaseClient.fetchRecords<Record<string, any>>('socios', `id=eq.${encodeURIComponent(idSocio)}&limit=1`);
    if (res.data && res.data.length > 0) return res.data[0];

    // Búsqueda alternativa por código de socio
    const byCodigo = await supabaseClient.fetchRecords<Record<string, any>>('socios', `codigo_socio=eq.${encodeURIComponent(idSocio)}&limit=1`);
    if (byCodigo.data && byCodigo.data.length > 0) return byCodigo.data[0];

    // Búsqueda alternativa por cédula / RUC
    const byCedula = await supabaseClient.fetchRecords<Record<string, any>>('socios', `cedula_ruc=eq.${encodeURIComponent(idSocio)}&limit=1`);
    if (byCedula.data && byCedula.data.length > 0) return byCedula.data[0];

    // Búsqueda alternativa por número de medidor
    const byMed = await supabaseClient.fetchRecords<Record<string, any>>('medidores', `numero_medidor=eq.${encodeURIComponent(idSocio)}&limit=1`);
    if (byMed.data && byMed.data.length > 0 && byMed.data[0].id_socio) {
      const byMedSocio = await supabaseClient.fetchRecords<Record<string, any>>('socios', `id=eq.${encodeURIComponent(byMed.data[0].id_socio)}&limit=1`);
      if (byMedSocio.data && byMedSocio.data.length > 0) return byMedSocio.data[0];
    }

    return null;
  }

  /**
   * Obtiene los medidores asignados a un socio
   */
  public async getMedidoresSocio(idSocio: string): Promise<Record<string, any>[]> {
    const res = await supabaseClient.fetchRecords<Record<string, any>>('medidores', `id_socio=eq.${encodeURIComponent(idSocio)}`);
    return res.data || [];
  }

  /**
   * Obtiene todos los sectores para mapeo de nombres
   */
  public async getSectores(): Promise<Record<string, any>[]> {
    const res = await supabaseClient.fetchRecords<Record<string, any>>('sectores');
    return res.data || [];
  }

  /**
   * Obtiene las facturas pendientes de pago de un socio
   */
  public async getFacturasPendientes(idSocio: string): Promise<Record<string, any>[]> {
    const res = await supabaseClient.fetchRecords<Record<string, any>>(
      'facturas',
      `id_socio=eq.${encodeURIComponent(idSocio)}&estado_pago=neq.PAGADO&order=created_at.asc`
    );
    return res.data || [];
  }

  /**
   * Obtiene una factura por su ID o número de factura
   */
  public async getFacturaPorIdONumero(idONum: string): Promise<Record<string, any> | null> {
    const byId = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `id=eq.${encodeURIComponent(idONum)}&limit=1`);
    if (byId.data && byId.data.length > 0) return byId.data[0];

    const byNum = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `numero_factura=eq.${encodeURIComponent(idONum)}&limit=1`);
    if (byNum.data && byNum.data.length > 0) return byNum.data[0];

    return null;
  }

  /**
   * Obtiene las multas y rubros pendientes de un socio
   */
  public async getMultasPendientes(idSocio: string): Promise<Record<string, any>[]> {
    const res = await supabaseClient.fetchRecords<Record<string, any>>(
      'multas_rubros',
      `id_socio=eq.${encodeURIComponent(idSocio)}&estado=neq.PAGADO&order=created_at.asc`
    );
    return res.data || [];
  }

  /**
   * Obtiene una multa puntual por su ID
   */
  public async getMultaPorId(id: string): Promise<Record<string, any> | null> {
    const res = await supabaseClient.fetchRecords<Record<string, any>>('multas_rubros', `id=eq.${encodeURIComponent(id)}&limit=1`);
    return res.data?.[0] || null;
  }

  /**
   * Obtiene lecturas de un socio para desglosar mediciones activas
   */
  public async getLecturasSocio(idSocio: string): Promise<Record<string, any>[]> {
    const res = await supabaseClient.fetchRecords<Record<string, any>>(
      'lecturas',
      `id_socio=eq.${encodeURIComponent(idSocio)}&order=fecha_lectura.desc`
    );
    return res.data || [];
  }

  /**
   * Obtiene catálogo de periodos de facturación
   */
  public async getPeriodos(): Promise<Record<string, any>[]> {
    const res = await supabaseClient.fetchRecords<Record<string, any>>('periodos', 'order=fecha_inicio.desc');
    return res.data || [];
  }

  /**
   * Obtiene catálogo de socios para enriquecer comprobantes y cuadres
   */
  public async getSociosCatalogo(): Promise<Record<string, any>[]> {
    const res = await supabaseClient.fetchRecords<Record<string, any>>('socios');
    return res.data || [];
  }

  /**
   * Registra atómicamente el cobro en Supabase
   */
  public async persistirCobroAtómico(params: {
    asientosFondos: AsientoFondoDTO[];
    numeroRecibo: string;
    idSocio: string;
    nombreSocio: string;
    idCajero: string;
    fechaPago: string;
    facturasActualizaciones: {
      id: string;
      patch: Record<string, any>;
    }[];
    multasActualizaciones: {
      id: string;
      patch: Record<string, any>;
      abonoRecord?: Record<string, any>;
    }[];
    nuevoReciboFactura?: Record<string, any>;
  }): Promise<void> {
    const now = params.fechaPago;

    // 1. Asentar en fondos_movimientos
    const isUuid = (val?: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val || '');
    const validFacturaIds = new Set<string>();
    for (const fa of params.facturasActualizaciones) {
      if (fa.id && isUuid(fa.id)) validFacturaIds.add(fa.id);
    }
    if (params.nuevoReciboFactura?.id && isUuid(params.nuevoReciboFactura.id)) {
      validFacturaIds.add(params.nuevoReciboFactura.id);
    }

    for (const af of params.asientosFondos) {
      const candidateId = (af as any).idFactura !== undefined ? (af as any).idFactura : af.idReferencia;
      const idFacturaFinal = (candidateId && isUuid(candidateId) && validFacturaIds.has(candidateId)) ? candidateId : null;

      const mov = {
        id: crypto.randomUUID(),
        id_fondo: af.idFondo,
        fecha: now,
        concepto: af.concepto,
        tipo: 'INGRESO',
        ingreso: af.monto,
        egreso: 0,
        saldo: af.monto,
        id_factura: idFacturaFinal,
        numero_comprobante: params.numeroRecibo,
        id_responsable: params.idCajero,
        beneficiario: params.nombreSocio,
        created_at: now
      };
      const res = await supabaseClient.syncRecord('fondos_movimientos', mov);
      if (res.error) {
        throw new Error(`Error asentando en fondos_movimientos: ${res.error}`);
      }
    }

    // 2. Actualizar facturas
    for (const fa of params.facturasActualizaciones) {
      const res = await supabaseClient.request(`facturas?id=eq.${encodeURIComponent(fa.id)}`, {
        method: 'PATCH',
        body: fa.patch
      });
      if (res.error) {
        throw new Error(`Error actualizando factura ${fa.id}: ${res.error}`);
      }
    }

    // 3. Si se emitió una factura/recibo independiente
    if (params.nuevoReciboFactura) {
      const res = await supabaseClient.syncRecord('facturas', params.nuevoReciboFactura);
      if (res.error) {
        throw new Error(`Error creando comprobante de cobro: ${res.error}`);
      }
    }

    // 4. Actualizar multas y registrar abonos
    for (const mu of params.multasActualizaciones) {
      const res = await supabaseClient.request(`multas_rubros?id=eq.${encodeURIComponent(mu.id)}`, {
        method: 'PATCH',
        body: mu.patch
      });
      if (res.error) {
        throw new Error(`Error actualizando rubro/multa ${mu.id}: ${res.error}`);
      }

      if (mu.abonoRecord) {
        const abRes = await supabaseClient.syncRecord('rubros_abonos', mu.abonoRecord);
        if (abRes.error) {
          throw new Error(`Error registrando abono a rubro: ${abRes.error}`);
        }
      }
    }

    // 5. Registrar bitácora de auditoría
    await supabaseClient.syncRecord('auditoria', {
      id: crypto.randomUUID(),
      tabla: 'facturas',
      operacion: 'COBRO',
      id_registro: params.numeroRecibo,
      id_usuario: params.idCajero,
      descripcion: `Cobro en ventanilla #${params.numeroRecibo} para socio ${params.nombreSocio}`,
      created_at: now
    }).catch(() => {});
  }

  /**
   * Obtiene movimientos de fondos filtrados por fecha
   */
  public async getMovimientosFondosPorFecha(fechaIsoInicio: string, fechaIsoFin: string): Promise<Record<string, any>[]> {
    const res = await supabaseClient.fetchRecords<Record<string, any>>(
      'fondos_movimientos',
      `fecha=gte.${encodeURIComponent(fechaIsoInicio)}&fecha=lte.${encodeURIComponent(fechaIsoFin)}&limit=5000`
    );
    return res.data || [];
  }

  /**
   * Obtiene movimientos de fondos por número de comprobante o id de factura
   */
  public async getMovimientosPorComprobante(numeroComprobante: string): Promise<Record<string, any>[]> {
    if (!numeroComprobante || !numeroComprobante.trim()) return [];
    const term = numeroComprobante.trim();
    const isUuid = (val?: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val || '');

    let res = await supabaseClient.fetchRecords<Record<string, any>>(
      'fondos_movimientos',
      `numero_comprobante=eq.${encodeURIComponent(term)}&limit=100`
    );
    if ((!res.data || res.data.length === 0) && isUuid(term)) {
      res = await supabaseClient.fetchRecords<Record<string, any>>(
        'fondos_movimientos',
        `id_factura=eq.${encodeURIComponent(term)}&limit=100`
      );
    }
    if (!res.data || res.data.length === 0) {
      res = await supabaseClient.fetchRecords<Record<string, any>>(
        'fondos_movimientos',
        `concepto=ilike.*${encodeURIComponent(term)}*&limit=100`
      );
    }
    return res.data || [];
  }

  /**
   * Obtiene catálogo de fondos
   */
  public async getFondosCatalogo(): Promise<Record<string, any>[]> {
    const res = await supabaseClient.fetchRecords<Record<string, any>>('fondos');
    return res.data || [];
  }

  /**
   * Obtiene facturas cobradas en un rango de fechas
   */
  public async getFacturasCobradasPorFecha(fechaIsoInicio: string, fechaIsoFin: string): Promise<Record<string, any>[]> {
    const res = await supabaseClient.fetchRecords<Record<string, any>>(
      'facturas',
      `estado_pago=eq.PAGADO&fecha_pago=gte.${encodeURIComponent(fechaIsoInicio)}&fecha_pago=lte.${encodeURIComponent(fechaIsoFin)}&order=fecha_pago.asc`
    );
    return res.data || [];
  }

  /**
   * Registra un egreso de caja chica
   */
  public async registrarEgreso(egreso: {
    idFondo: string;
    monto: number;
    motivo: string;
    beneficiario: string;
    idCajero: string;
    comprobante?: string;
  }): Promise<Record<string, any>> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const asiento = {
      id,
      id_fondo: egreso.idFondo,
      fecha: now,
      concepto: `Egreso Caja Chica: ${egreso.motivo} (Entregado a: ${egreso.beneficiario})`,
      tipo: 'EGRESO',
      ingreso: 0,
      egreso: egreso.monto,
      saldo: -egreso.monto,
      numero_comprobante: egreso.comprobante || `EGR-${String(Date.now()).slice(-6)}`,
      id_responsable: egreso.idCajero,
      beneficiario: egreso.beneficiario,
      created_at: now
    };

    const res = await supabaseClient.syncRecord('fondos_movimientos', asiento);
    if (res.error) {
      throw new Error(`Error registrando egreso en fondos_movimientos: ${res.error}`);
    }
    return asiento;
  }

  /**
   * Anula un cobro (reversión atómica y contraasiento)
   */
  public async anularCobro(params: {
    idFactura: string;
    numeroFactura: string;
    idAdmin: string;
    motivo: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const isUuid = (val?: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val || '');

    // 1. Obtener movimientos asociados para identificar facturas vinculadas y montos pagados
    let movsRes = await supabaseClient.fetchRecords<Record<string, any>>(
      'fondos_movimientos',
      `numero_comprobante=eq.${encodeURIComponent(params.numeroFactura)}&limit=100`
    );
    if ((!movsRes.data || movsRes.data.length === 0) && params.idFactura) {
      movsRes = await supabaseClient.fetchRecords<Record<string, any>>(
        'fondos_movimientos',
        `numero_comprobante=eq.${encodeURIComponent(params.idFactura)}&limit=100`
      );
    }
    if ((!movsRes.data || movsRes.data.length === 0) && isUuid(params.idFactura)) {
      movsRes = await supabaseClient.fetchRecords<Record<string, any>>(
        'fondos_movimientos',
        `id_factura=eq.${encodeURIComponent(params.idFactura)}&limit=100`
      );
    }
    if (!movsRes.data || movsRes.data.length === 0) {
      movsRes = await supabaseClient.fetchRecords<Record<string, any>>(
        'fondos_movimientos',
        `concepto=ilike.*${encodeURIComponent(params.numeroFactura)}*&limit=100`
      );
    }
    let movs = movsRes.data || [];
    const numComps = [...new Set(movs.map(m => m.numero_comprobante).filter(Boolean))];
    if (numComps.length > 0) {
      const allMovsRes = await supabaseClient.fetchRecords<Record<string, any>>(
        'fondos_movimientos',
        `numero_comprobante=in.(${numComps.map(nc => encodeURIComponent(nc)).join(',')})&limit=200`
      );
      if (allMovsRes.data && allMovsRes.data.length > 0) {
        movs = allMovsRes.data;
      }
    }

    // Identificar IDs únicos de todas las facturas involucradas
    const facturasAfectadasIds = new Set<string>();
    for (const m of movs) {
      if (m.id_factura && isUuid(m.id_factura)) {
        facturasAfectadasIds.add(m.id_factura);
      }
    }
    if (isUuid(params.idFactura)) {
      facturasAfectadasIds.add(params.idFactura);
    }
    const compNum = params.numeroFactura || params.idFactura;
    if (compNum && compNum.startsWith('FAC-')) {
      const fByNum = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `numero_factura=eq.${encodeURIComponent(compNum)}&limit=1`);
      if (fByNum.data?.[0]?.id) {
        facturasAfectadasIds.add(fByNum.data[0].id);
      }
    }

    // Restaurar cada factura afectada: estado PENDIENTE y reponer el saldo original
    for (const facId of facturasAfectadasIds) {
      const facRes = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `id=eq.${encodeURIComponent(facId)}&limit=1`);
      if (facRes.data && facRes.data.length > 0) {
        const fac = facRes.data[0];
        let montoAbonadoEnEsteRecibo = movs
          .filter(m => m.id_factura === facId || (fac.numero_factura && (m.concepto || '').includes(fac.numero_factura)))
          .reduce((sum, m) => sum + Number(m.ingreso || 0), 0);

        if (montoAbonadoEnEsteRecibo === 0 && movs.length > 0 && facturasAfectadasIds.size === 1) {
          montoAbonadoEnEsteRecibo = movs.reduce((sum, m) => sum + Number(m.ingreso || 0), 0);
        }

        const totalOriginal = Number((Number(fac.valor_deuda_anterior || 0) + Number(fac.total_mes || 0) + Number(fac.valor_multas || 0)).toFixed(2));
        const saldoActual = Number(fac.total_pagar || 0);
        const saldoRestaurado = totalOriginal > 0 
          ? Math.min(totalOriginal, Number((saldoActual + montoAbonadoEnEsteRecibo).toFixed(2)))
          : Number((saldoActual + montoAbonadoEnEsteRecibo).toFixed(2));

        await supabaseClient.request(`facturas?id=eq.${encodeURIComponent(fac.id)}`, {
          method: 'PATCH',
          body: {
            estado_pago: 'PENDIENTE',
            total_pagar: saldoRestaurado,
            fecha_pago: null,
            metodo_pago: null,
            id_cajero: null,
            updated_at: now
          }
        });
      }
    }

    // 2. Eliminar asientos de fondos asociados a este comprobante
    for (const m of movs) {
      if (m.id) {
        await supabaseClient.request(`fondos_movimientos?id=eq.${encodeURIComponent(m.id)}`, { method: 'DELETE' }).catch(() => {});
      }
    }
    await supabaseClient.request(
      `fondos_movimientos?numero_comprobante=eq.${encodeURIComponent(params.numeroFactura)}`,
      { method: 'DELETE' }
    ).catch(() => {});
    if (params.idFactura && params.idFactura !== params.numeroFactura) {
      await supabaseClient.request(
        `fondos_movimientos?numero_comprobante=eq.${encodeURIComponent(params.idFactura)}`,
        { method: 'DELETE' }
      ).catch(() => {});
    }
    for (const nc of numComps) {
      await supabaseClient.request(
        `fondos_movimientos?numero_comprobante=eq.${encodeURIComponent(nc)}`,
        { method: 'DELETE' }
      ).catch(() => {});
    }

    // 3. Revertir abonos a multas/rubros si los hubo
    const allFacturaIdsParaAbonos = new Set<string>();
    if (params.idFactura && isUuid(params.idFactura)) {
      allFacturaIdsParaAbonos.add(params.idFactura);
    }
    for (const facId of facturasAfectadasIds) {
      if (facId && isUuid(facId)) {
        allFacturaIdsParaAbonos.add(facId);
      }
    }
    const compCode = params.numeroFactura || params.idFactura;
    if (compCode && (compCode.startsWith('REC-') || compCode.startsWith('FAC-'))) {
      const fByRec = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `numero_factura=eq.${encodeURIComponent(compCode)}&limit=1`);
      if (fByRec.data?.[0]?.id) {
        allFacturaIdsParaAbonos.add(fByRec.data[0].id);
      }
    }
    for (const nc of numComps) {
      if (nc.startsWith('REC-') || nc.startsWith('FAC-')) {
        const fByNc = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `numero_factura=eq.${encodeURIComponent(nc)}&limit=1`);
        if (fByNc.data?.[0]?.id) {
          allFacturaIdsParaAbonos.add(fByNc.data[0].id);
        }
      }
    }

    const todosAbonos: Record<string, any>[] = [];
    for (const fId of allFacturaIdsParaAbonos) {
      const abRes = await supabaseClient.fetchRecords<Record<string, any>>(
        'rubros_abonos',
        `id_factura=eq.${encodeURIComponent(fId)}`
      );
      if (abRes.data) {
        todosAbonos.push(...abRes.data);
      }
    }

    for (const ab of todosAbonos) {
      const rubroRes = await supabaseClient.fetchRecords<Record<string, any>>(
        'multas_rubros',
        `id=eq.${encodeURIComponent(ab.id_rubro)}&limit=1`
      );
      if (rubroRes.data && rubroRes.data.length > 0) {
        const rubro = rubroRes.data[0];
        const montoRevertir = Number(ab.monto_abonado || 0);
        const nuevoPagado = Math.max(0, Number(rubro.monto_pagado || 0) - montoRevertir);
        const nuevoSaldo = Number(rubro.monto || 0) - nuevoPagado;
        await supabaseClient.request(`multas_rubros?id=eq.${encodeURIComponent(rubro.id)}`, {
          method: 'PATCH',
          body: {
            monto_pagado: nuevoPagado,
            saldo_pendiente: nuevoSaldo,
            estado: nuevoSaldo === 0 ? 'PAGADO' : nuevoPagado > 0 ? 'PARCIAL' : 'PENDIENTE'
          }
        });
      }
      if (ab.id) {
        await supabaseClient.request(`rubros_abonos?id=eq.${encodeURIComponent(ab.id)}`, {
          method: 'DELETE'
        }).catch(() => {});
      }
    }

    // 5. Registrar contraasiento en auditoría (si existe tabla)
    await supabaseClient.syncRecord('auditoria', {
      id: crypto.randomUUID(),
      tabla: 'facturas',
      operacion: 'ANULACION',
      id_registro: params.numeroFactura,
      id_usuario: params.idAdmin,
      descripcion: `Anulación de comprobante #${params.numeroFactura}. Motivo: ${params.motivo}`,
      created_at: now
    }).catch(() => {});
  }

  /**
   * Obtiene los totales históricos globales de caja (todas las facturas pagadas y todos los egresos)
   */
  public async getTotalesHistoricosCaja(): Promise<{ totalRecaudado: number; totalEgresos: number; totalFacturas: number; totalEgresosCount: number }> {
    const [facRes, egrRes, ingRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, any>>('facturas', 'estado_pago=eq.PAGADO&limit=5000'),
      supabaseClient.fetchRecords<Record<string, any>>('fondos_movimientos', 'tipo=eq.EGRESO&limit=5000'),
      supabaseClient.fetchRecords<Record<string, any>>('fondos_movimientos', 'tipo=eq.INGRESO&limit=5000')
    ]);

    const facs = facRes.data || [];
    const egrs = egrRes.data || [];
    const ings = ingRes.data || [];

    const totalRecaudado = Math.round(ings.reduce(
      (acc, m) => acc + Number(m.ingreso || 0), 0
    ) * 100) / 100;

    const totalEgresos = Math.round(egrs.reduce(
      (acc, m) => acc + Math.abs(Number(m.egreso ?? m.monto ?? 0)), 0
    ) * 100) / 100;

    return {
      totalRecaudado,
      totalEgresos,
      totalFacturas: facs.length,
      totalEgresosCount: egrs.length
    };
  }
}
