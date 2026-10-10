import test from 'node:test';
import assert from 'node:assert/strict';

import { FONDO_IDS, type ItemCobroRequestDTO } from '../modules/caja/domain/CajaDTOs.ts';
import { DistribucionFondosStrategy } from '../modules/caja/domain/DistribucionFondosStrategy.ts';
import { FIFOAllocationEngine } from '../modules/caja/domain/FIFOAllocationEngine.ts';
import { CobroTransaction } from '../modules/caja/domain/CobroTransaction.ts';
import { CuadreCajaUseCase } from '../modules/caja/application/CuadreCajaUseCase.ts';
import { AnularCobroUseCase } from '../modules/caja/application/AnularCobroUseCase.ts';

test('MÓDULO 3: CAJA, COBROS Y CUADRE DIARIO (IEEE 830 / CLEAN ARCHITECTURE)', async (t) => {

  await t.test('1. DistribucionFondosStrategy: Tarifa Estándar ($7.00)', () => {
    const strategy = new DistribucionFondosStrategy();
    const asientos = strategy.distribuirCobro({
      montoAguaBase: 7.00,
      esTerceraEdad: false,
      montoExcedente: 0,
      montoAlcantarillado: 0,
      montoMultas: 0
    });

    const sum = asientos.reduce((acc, a) => acc + a.monto, 0);
    assert.equal(Math.round(sum * 100) / 100, 7.00, 'La suma de asientos debe ser exactamente $7.00');

    const padre = asientos.find(a => a.idFondo === FONDO_IDS.PADRE_PARROQUIA)?.monto;
    const operacion = asientos.find(a => a.idFondo === FONDO_IDS.OPERACION_MANT)?.monto;
    const lector = asientos.find(a => a.idFondo === FONDO_IDS.PAGO_LECTOR)?.monto;
    const mortuorio = asientos.find(a => a.idFondo === FONDO_IDS.MORTUORIO)?.monto;

    assert.equal(padre, 2.00);
    assert.equal(operacion, 4.00);
    assert.equal(lector, 0.50);
    assert.equal(mortuorio, 0.50);
  });

  await t.test('2. DistribucionFondosStrategy: Tarifa Tercera Edad ($5.00 con subsidio)', () => {
    const strategy = new DistribucionFondosStrategy();
    const asientos = strategy.distribuirCobro({
      montoAguaBase: 5.00,
      esTerceraEdad: true,
      montoExcedente: 0,
      montoAlcantarillado: 0,
      montoMultas: 0
    });

    const sum = asientos.reduce((acc, a) => acc + a.monto, 0);
    assert.equal(Math.round(sum * 100) / 100, 5.00, 'La suma de asientos debe ser exactamente $5.00');

    const padre = asientos.find(a => a.idFondo === FONDO_IDS.PADRE_PARROQUIA)?.monto;
    const operacion = asientos.find(a => a.idFondo === FONDO_IDS.OPERACION_MANT)?.monto;
    assert.equal(padre, 2.00);
    assert.equal(operacion, 2.00, 'En tercera edad la operación se reduce a $2.00');
  });

  await t.test('3. DistribucionFondosStrategy: Cobro Combinado (Agua + Excedente + Alcantarillado + Multa)', () => {
    const strategy = new DistribucionFondosStrategy();
    const asientos = strategy.distribuirCobro({
      montoAguaBase: 7.00,
      esTerceraEdad: false,
      montoExcedente: 1.50, // 15 m3 excedente a $0.10
      montoAlcantarillado: 1.00,
      montoMultas: 25.00
    });

    const totalEsperado = 7.00 + 1.50 + 1.00 + 25.00; // 34.50
    const sum = asientos.reduce((acc, a) => acc + a.monto, 0);
    assert.equal(Math.round(sum * 100) / 100, 34.50, 'Conservación matemática estricta');

    const proMejoras = asientos.find(a => a.idFondo === FONDO_IDS.PRO_MEJORAS)?.monto;
    const alcantarillado = asientos.find(a => a.idFondo === FONDO_IDS.ALCANTARILLADO)?.monto;
    const multas = asientos.find(a => a.idFondo === FONDO_IDS.MULTAS_EXTRAS)?.monto;

    assert.equal(proMejoras, 1.50, '100% del excedente va a Pro-Mejoras');
    assert.equal(alcantarillado, 1.00, '100% de alcantarillado va a fondo Alcantarillado');
    assert.equal(multas, 25.00, '100% de multas va a Multas/Extras');
  });

  await t.test('4. FIFOAllocationEngine: Liquidación Parcial en Deudas Cronológicas (RN-06, RN-07)', () => {
    const deudas = [
      { idReferencia: 'FAC-001', concepto: 'Consumo Julio 2026', saldoPendiente: 7.00 },
      { idReferencia: 'FAC-002', concepto: 'Consumo Agosto 2026', saldoPendiente: 8.50 },
      { idReferencia: 'FAC-003', concepto: 'Consumo Septiembre 2026', saldoPendiente: 7.00 }
    ];

    const engine = new FIFOAllocationEngine();
    // Socio abona $12.00
    const resultado = engine.asignarPagoFIFO(deudas, 12.00);

    assert.equal(resultado.montoTotalAplicado, 12.00);
    assert.equal(resultado.remanenteNoAplicado, 0);

    // Item 1: cubierto en su totalidad ($7.00)
    assert.equal(resultado.asignaciones[0].montoAsignado, 7.00);
    assert.equal(resultado.asignaciones[0].saldoRestante, 0);
    assert.equal(resultado.asignaciones[0].estadoFinal, 'PAGADO');

    // Item 2: amortizado parcialmente ($5.00 de los $8.50)
    assert.equal(resultado.asignaciones[1].montoAsignado, 5.00);
    assert.equal(resultado.asignaciones[1].saldoRestante, 3.50);
    assert.equal(resultado.asignaciones[1].estadoFinal, 'PARCIAL');

    // Item 3: intacto ($0 asignado, $7.00 restante)
    assert.equal(resultado.asignaciones[2].montoAsignado, 0);
    assert.equal(resultado.asignaciones[2].saldoRestante, 7.00);
    assert.equal(resultado.asignaciones[2].estadoFinal, 'PENDIENTE');

    // Total de deuda remanente: 0 + 3.50 + 7.00 = 10.50
    assert.equal(resultado.saldoPendienteTotalRestante, 10.50);
  });

  await t.test('5. CobroTransaction Entity: Validaciones de Invariantes y Reglas de Efectivo/Transferencia', () => {
    const items: ItemCobroRequestDTO[] = [
      { tipo: 'AGUA_PERIODO_ACTIVO', idReferencia: 'fac-1', montoACobrar: 7.00 }
    ];

    // Invariante: Efectivo con dinero suficiente calcula vuelto
    const txEfectivo = new CobroTransaction(
      'socio-1',
      'cajero-1',
      'EFECTIVO',
      10.00,
      items
    );
    assert.equal(txEfectivo.getTotalCobrado(), 7.00);
    assert.equal(txEfectivo.getMontoRecibido(), 10.00);
    assert.equal(txEfectivo.getCambioVuelto(), 3.00);

    // Invariante: Efectivo insuficiente lanza error
    assert.throws(() => {
      new CobroTransaction('socio-1', 'cajero-1', 'EFECTIVO', 5.00, items);
    }, /Efectivo insuficiente/);

    // Invariante: Transferencia exige comprobante bancario
    assert.throws(() => {
      new CobroTransaction('socio-1', 'cajero-1', 'TRANSFERENCIA', 7.00, items, '');
    }, /transferencias bancarias es obligatorio/);

    // Invariante: Transferencia válida tiene cambio $0.00
    const txTransf = new CobroTransaction(
      'socio-1',
      'cajero-1',
      'TRANSFERENCIA',
      7.00,
      items,
      'PRODUBANCO-REF-99214'
    );
    assert.equal(txTransf.getCambioVuelto(), 0);
  });

  await t.test('6. CuadreCajaUseCase: Ecuación Contable y Egresos de Caja Chica (RN-13, RN-14)', async () => {
    // Mock repo en memoria
    const movimientosMock: any[] = [
      { id: '1', tipo: 'INGRESO', ingreso: 7.00, id_fondo: FONDO_IDS.OPERACION_MANT, numero_comprobante: 'REC-001' },
      { id: '2', tipo: 'INGRESO', ingreso: 5.00, id_fondo: FONDO_IDS.PADRE_PARROQUIA, numero_comprobante: 'REC-002' },
      { id: '3', tipo: 'EGRESO', egreso: 3.50, monto: 3.50, concepto: 'Compra cinta teflón', beneficiario: 'Ferretería Central' }
    ];

    const mockRepo: any = {
      getMovimientosFondosPorFecha: async () => movimientosMock,
      getFondosCatalogo: async () => [
        { id: FONDO_IDS.OPERACION_MANT, nombre: 'Operación y Mantenimiento' },
        { id: FONDO_IDS.PADRE_PARROQUIA, nombre: 'Padre Parroquia' }
      ],
      getFacturasCobradasPorFecha: async () => [
        { id: 'f1', numero_factura: 'REC-001', total: 7.00, metodo_pago: 'EFECTIVO', fecha_pago: new Date().toISOString() },
        { id: 'f2', numero_factura: 'REC-002', total: 5.00, metodo_pago: 'TRANSFERENCIA', fecha_pago: new Date().toISOString() }
      ],
      getSociosCatalogo: async () => [],
      registrarEgreso: async (params: any) => ({
        id: 'egr-test-uuid',
        fecha: new Date().toISOString(),
        egreso: params.monto,
        concepto: params.motivo,
        beneficiario: params.beneficiario
      })
    };

    const useCase = new CuadreCajaUseCase(mockRepo);
    const balance = await useCase.ejecutar('2026-10-06', 'cajero-test');

    assert.equal(balance.resumenOperaciones.totalCobrosEfectivo, 7.00);
    assert.equal(balance.resumenOperaciones.totalCobrosTransferencia, 5.00);
    assert.equal(balance.resumenOperaciones.totalEgresosCajaChica, 3.50);
    assert.equal(balance.resumenOperaciones.saldoNetoEfectivo, 3.50, 'Saldo neto en efectivo = 7.00 - 3.50 = 3.50');

    // Registrar nuevo egreso con validaciones
    await assert.rejects(async () => {
      await useCase.registrarEgreso({ idCajero: 'cajero-1', monto: 0, motivo: 'X', beneficiario: 'Y' });
    }, /El monto del egreso debe ser estrictamente mayor a 0/);

    const egresoExitoso = await useCase.registrarEgreso({
      idCajero: 'cajero-1',
      monto: 15.00,
      motivo: 'Pago refrigerio minga',
      beneficiario: 'Rosa Pérez'
    });
    assert.equal(egresoExitoso.monto, 15.00);
    assert.equal(egresoExitoso.beneficiario, 'Rosa Pérez');
  });

  await t.test('7. AnularCobroUseCase: Restricciones de Estado y Reversión (RF-CAJ-12, RN-15, RN-16)', async () => {
    let cobroAnulado = false;
    const mockRepo: any = {
      getFacturaPorIdONumero: async (id: string) => {
        if (id === 'FAC-PAGADA') {
          return { id: 'uuid-1', numero_factura: 'REC-000100', estado_pago: 'PAGADO', total: 7.00 };
        }
        if (id === 'FAC-PENDIENTE') {
          return { id: 'uuid-2', numero_factura: 'REC-000101', estado_pago: 'PENDIENTE', total: 7.00 };
        }
        return null;
      },
      anularCobro: async () => {
        cobroAnulado = true;
      }
    };

    const anularUC = new AnularCobroUseCase(mockRepo);

    // Error si factura no existe
    await assert.rejects(async () => {
      await anularUC.ejecutar({ idFactura: 'FAC-INEXISTENTE', idAdmin: 'admin', motivo: 'Error digitación' });
    }, /No se encontró ninguna factura/);

    // Error si no está pagada
    await assert.rejects(async () => {
      await anularUC.ejecutar({ idFactura: 'FAC-PENDIENTE', idAdmin: 'admin', motivo: 'Error digitación' });
    }, /no puede anularse porque su estado actual es PENDIENTE/);

    // Error si falta motivo
    await assert.rejects(async () => {
      await anularUC.ejecutar({ idFactura: 'FAC-PAGADA', idAdmin: 'admin', motivo: '' });
    }, /especificar una justificación obligatoria/);

    // Éxito con factura pagada y motivo
    const res = await anularUC.ejecutar({ idFactura: 'FAC-PAGADA', idAdmin: 'admin', motivo: 'Cobro duplicado por error' });
    assert.equal(res.success, true);
    assert.equal(res.numeroFactura, 'REC-000100');
    assert.equal(cobroAnulado, true);
  });

  await t.test('8. CajaController: Handlers HTTP para Deudas, Cuadre y Cobros', async () => {
    const { CajaController } = await import('../modules/caja/ui/CajaController.ts');

    const mockRepo: any = {
      getSocioInfo: async () => ({
        id: 'socio-123',
        nombres: 'Segundo',
        apellidos: 'Masaquiza',
        cedula_ruc: '1801234567',
        es_tercera_edad: false,
        tiene_alcantarillado: true,
        medidor_numero: 'MED-009'
      }),
      getMedidoresSocio: async () => [
        { id: 'm1', numero_medidor: 'MED-009', tiene_alcantarillado: true }
      ],
      getSectores: async () => [{ id: 's1', nombre_sector: 'Centro' }],
      getFacturasPendientes: async () => [
        {
          id: 'fac-1',
          numero_factura: 'FAC-2026-001',
          periodo_codigo: '2026-09',
          total: 8.00,
          saldo_pendiente: 8.00,
          monto_pagado: 0,
          lectura_anterior: 100,
          lectura_actual: 120,
          consumo: 20
        }
      ],
      getMultasPendientes: async () => [],
      getPeriodos: async () => [{ id: 'per-act', periodo_codigo: '2026-09', estado: 'ABIERTO', mes_nombre: 'Septiembre 2026' }],
      getLecturasSocio: async () => [],
      getSociosCatalogo: async () => [{ id: 'socio-123', nombres: 'Segundo', apellidos: 'Masaquiza' }],
      getMovimientosFondosPorFecha: async () => [],
      getFondosCatalogo: async () => [],
      getFacturasCobradasPorFecha: async () => [],
      persistirCobroAtómico: async () => {},
      registrarEgreso: async () => ({ id: 'egr-1', fecha: new Date().toISOString(), egreso: 10.00 }),
      anularCobro: async () => {}
    };

    const { ConsultarDeudasSocioUseCase } = await import('../modules/caja/application/ConsultarDeudasSocioUseCase.ts');
    const { ProcesarCobroUseCase } = await import('../modules/caja/application/ProcesarCobroUseCase.ts');
    const { CuadreCajaUseCase } = await import('../modules/caja/application/CuadreCajaUseCase.ts');
    const { AnularCobroUseCase } = await import('../modules/caja/application/AnularCobroUseCase.ts');

    const controller = new CajaController(
      new ConsultarDeudasSocioUseCase(mockRepo),
      new ProcesarCobroUseCase(mockRepo),
      new CuadreCajaUseCase(mockRepo),
      new AnularCobroUseCase(mockRepo)
    );

    // Test GET deudas
    let resStatus = 0;
    let resData: any = null;
    const mockRes: any = {
      status(code: number) { resStatus = code; return this; },
      json(data: any) { resData = data; return this; }
    };

    await controller.consultarDeudasSocio({ params: { id: 'socio-123' } } as any, mockRes);
    assert.equal(resStatus, 200);
    assert.equal(resData.socio.cedulaRuc, '1801234567');
    assert.equal(resData.rubrosPendientes.length, 1);
    assert.equal(resData.totalDeudaPendiente, 8.00);

    // Test GET cuadre diario
    await controller.obtenerCuadreDiario({ query: { fecha: '2026-10-06' }, user: { id: 'cajero-1' } } as any, mockRes);
    assert.equal(resStatus, 200);
    assert.equal(resData.resumenOperaciones.saldoNetoEfectivo, 0);
  });

  await t.test('9. ProcesarCobroUseCase: Desacoplamiento de Agua ($10.50) + Corte ($7.30) + Abono Multa ($20.00)', async () => {
    let persistedPayload: any = null;
    const mockFacturasDB: Record<string, any> = {
      'fac-corte-jul': {
        id: 'fac-corte-jul',
        numero_factura: 'FAC-JUL-1208021050',
        id_socio: 'soc-test-01',
        valor_deuda_anterior: 7.30,
        total_mes: 0,
        total_pagar: 7.30,
        estado_pago: 'PENDIENTE'
      },
      'fac-sep-079': {
        id: 'fac-sep-079',
        numero_factura: 'FAC-202609-0079',
        id_socio: 'soc-test-01',
        valor_base: 7.00,
        valor_excedente: 3.50,
        valor_multas: 0.00,
        total_mes: 10.50,
        total_pagar: 10.50,
        estado_pago: 'PENDIENTE'
      }
    };

    const mockMultasDB: Record<string, any> = {
      'mlt-minga-01': {
        id: 'mlt-minga-01',
        id_socio: 'soc-test-01',
        tipo_rubro: 'MINGA',
        monto: 40.00,
        monto_pagado: 0.00,
        saldo_pendiente: 40.00,
        estado: 'PENDIENTE',
        pagado: false
      }
    };

    const mockRepo: any = {
      getSocioInfo: async () => ({
        id: 'soc-test-01',
        nombres: 'Carlos',
        apellidos: 'Pérez',
        codigo_socio: 'SOC-001',
        fecha_nacimiento: '1985-05-15'
      }),
      getFacturaPorIdONumero: async (id: string) => mockFacturasDB[id] || null,
      getMultaPorId: async (id: string) => mockMultasDB[id] || null,
      getFacturasPendientes: async () => [],
      getMultasPendientes: async () => [{ ...mockMultasDB['mlt-minga-01'], saldo_pendiente: 20.00 }],
      persistirCobroAtómico: async (params: any) => {
        persistedPayload = params;
      }
    };

    const { ProcesarCobroUseCase } = await import('../modules/caja/application/ProcesarCobroUseCase.ts');
    const useCase = new ProcesarCobroUseCase(mockRepo);

    const response = await useCase.ejecutar({
      idSocio: 'soc-test-01',
      idCajero: 'cajero-test',
      metodoPago: 'EFECTIVO',
      montoTotalRecibido: 40.00,
      items: [
        {
          tipo: 'DEUDA_HISTORICA_CORTE',
          idReferencia: 'fac-corte-jul',
          montoACobrar: 7.30,
          descripcion: 'Corte Julio'
        },
        {
          tipo: 'AGUA_PERIODO_ACTIVO',
          idReferencia: 'fac-sep-079',
          montoACobrar: 10.50,
          descripcion: 'Consumo Septiembre'
        },
        {
          tipo: 'MULTA_COMUNITARIA',
          idReferencia: 'mlt-minga-01',
          montoACobrar: 20.00,
          descripcion: 'Abono Multa Minga'
        }
      ]
    });

    // 1. Validar totales generales
    assert.equal(response.success, true);
    assert.equal(response.totalCobrado, 37.80);
    assert.equal(response.cambioVuelto, 2.20); // 40.00 entregado - 37.80 cobrado = 2.20

    // 2. Validar que la factura de Septiembre quedó PAGADA con $10.50 y valor_multas = 0.00
    const patchFacSep = persistedPayload.facturasActualizaciones.find((f: any) => f.id === 'fac-sep-079');
    assert.ok(patchFacSep, 'La factura de Septiembre debe actualizarse');
    assert.equal(patchFacSep.patch.estado_pago, 'PAGADO', 'El agua del mes debe extinguirse a PAGADO');
    assert.equal(patchFacSep.patch.total_pagar, 10.50, 'total_pagar debe ser exactamente $10.50');
    assert.equal(patchFacSep.patch.valor_multas, 0.00, 'valor_multas debe ser 0.00');
    assert.ok(patchFacSep.patch.fecha_pago, 'Factura extinguida debe registrar fecha_pago');

    // 3. Validar que la factura de Julio quedó PAGADA con $7.30
    const patchFacJul = persistedPayload.facturasActualizaciones.find((f: any) => f.id === 'fac-corte-jul');
    assert.ok(patchFacJul, 'La factura de corte debe actualizarse');
    assert.equal(patchFacJul.patch.estado_pago, 'PAGADO');
    assert.equal(patchFacJul.patch.total_pagar, 7.30);

    // 4. Validar que la multa quedó en PARCIAL con saldo $20.00 y su abono registrado
    const patchMulta = persistedPayload.multasActualizaciones.find((m: any) => m.id === 'mlt-minga-01');
    assert.ok(patchMulta, 'La multa comunitaria debe actualizarse');
    assert.equal(patchMulta.patch.monto_pagado, 20.00);
    assert.equal(patchMulta.patch.saldo_pendiente, 20.00);
    assert.equal(patchMulta.patch.estado, 'PARCIAL');
    assert.equal(patchMulta.patch.pagado, false);
    assert.ok(patchMulta.abonoRecord, 'Debe generarse un registro en rubros_abonos');
    assert.equal(patchMulta.abonoRecord.monto_abonado, 20.00);
    assert.equal(patchMulta.abonoRecord.saldo_restante, 20.00);

    // 5. Validar distribución de asientos contables a los fondos
    const asientos = persistedPayload.asientosFondos;
    const totalAsientos = asientos.reduce((acc: number, a: any) => acc + a.monto, 0);
    assert.equal(Math.round(totalAsientos * 100) / 100, 37.80, 'Suma de asientos debe ser exactamente $37.80');

    const fondoMultasAsiento = asientos.find((a: any) => a.idFondo === FONDO_IDS.MULTAS_EXTRAS);
    assert.ok(fondoMultasAsiento, 'Debe existir asiento al Fondo de Multas y Extras');
    assert.equal(fondoMultasAsiento.monto, 20.00, 'Exactamente $20.00 deben ir al Fondo de Multas');
  });
});
