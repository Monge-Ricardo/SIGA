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
});
