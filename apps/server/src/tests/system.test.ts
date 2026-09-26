process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword, generateToken, verifyToken } from '../utils/security.ts';
import { ConflictResolver } from '../services/conflictResolver.ts';
import { cloudSyncService } from '../services/cloudSyncService.ts';
import { ValidationRules } from '../shared.ts';
import { supabaseClient } from '../db/supabase.ts';
import { centralDb } from '../db/connection.ts';
import { getFacturaComprobante } from '../controllers/comprobanteController.ts';
import { inicializarLecturasPeriodo } from '../controllers/waterController.ts';

test('1. Seguridad: Hashing PBKDF2 y JWT HMAC-SHA256', () => {
  const pwd = 'PasswordSegura2026*';
  const hashed = hashPassword(pwd);
  assert.ok(hashed.includes(':'), 'El hash debe contener salt y hash separados por colon');
  assert.ok(verifyPassword(pwd, hashed), 'La contraseña correcta debe ser validada exitosamente');
  assert.strictEqual(verifyPassword('WrongPassword', hashed), false, 'La contraseña incorrecta debe ser rechazada');

  const usuario = {
    id: 'user-01',
    username: 'cajero_test',
    nombreCompleto: 'Juan Cajero',
    rol: 'CAJERO' as const,
    activo: true
  };

  const token = generateToken(usuario);
  assert.ok(typeof token === 'string' && token.split('.').length === 3, 'El token debe tener 3 partes JWT');

  const payload = verifyToken(token);
  assert.ok(payload !== null, 'El token válido debe decodificarse');
  assert.strictEqual(payload?.username, 'cajero_test');
  assert.strictEqual(payload?.rol, 'CAJERO');
});

test('2. Validadores de Negocio: Cédula Ecuatoriana y Tercera Edad', () => {
  const cedulaValida = '1710034065';
  assert.strictEqual(ValidationRules.isValidCedulaEcuatoriana(cedulaValida), true);
  assert.strictEqual(ValidationRules.isValidCedulaEcuatoriana('1710034069'), false);

  const nacSenior = '1955-05-10'; // >= 65 años
  const nacJoven = '1990-08-20'; // < 65 años

  assert.strictEqual(ValidationRules.calcularEsTerceraEdad(nacSenior, new Date('2026-08-29')), true);
  assert.strictEqual(ValidationRules.calcularEsTerceraEdad(nacJoven, new Date('2026-08-29')), false);
});

test('3. Sincronización Offline-First: Resolución de Conflictos LWW', () => {
  const ack = ConflictResolver.processMutation({
    id: 'mutation-sync-01',
    entity: 'clientes',
    entityId: 'socio-sync-01',
    action: 'CREATE',
    payload: {
      codigo_socio: 'SOC-SYNC-01',
      nombres: 'Carlos',
      apellidos: 'Mendoza',
      cedula_ruc: '1710034065'
    },
    localTimestamp: new Date().toISOString(),
    status: 'PENDING',
    retryCount: 0,
    version: 1
  });

  assert.strictEqual(ack.status, 'ACCEPTED');
  assert.strictEqual(ack.mutationId, 'mutation-sync-01');
  assert.strictEqual(ack.serverVersion, 1);

  const resLWW = ConflictResolver.resolveLWW({
    id: 'mutation-lww-02',
    entity: 'medidores',
    entityId: 'med-01',
    action: 'UPDATE',
    payload: { tiene_alcantarillado: true },
    localTimestamp: new Date().toISOString(),
    status: 'PENDING',
    retryCount: 0,
    version: 2
  });

  assert.strictEqual(resLWW.ack.status, 'ACCEPTED');
  assert.strictEqual(resLWW.ack.serverVersion, 2);
  assert.deepStrictEqual(resLWW.finalState, { tiene_alcantarillado: true });
});

test('4. Sanitización de Esquema para Supabase PostgreSQL (CloudSyncService)', () => {
  // 1. Sanitización de socio (camelCase -> snake_case, eliminación de campos no pertenecientes a tabla socios)
  const rawSocio = {
    id: 'soc-uuid-001',
    codigoSocio: 'SOC-0099',
    nombres: 'María',
    apellidos: 'Quishpe',
    cedulaRuc: '1710034065',
    id_sector: 'sec-123',
    medidor_numero: 'MED-999'
  };
  const cleanSocio = cloudSyncService.cleanRecordForSupabase('socios', rawSocio);
  assert.strictEqual(cleanSocio.id, 'soc-uuid-001');
  assert.strictEqual(cleanSocio.codigo_socio, 'SOC-0099');
  assert.strictEqual(cleanSocio.cedula_ruc, '1710034065');
  assert.strictEqual((cleanSocio as any).id_sector, undefined);
  assert.strictEqual((cleanSocio as any).medidor_numero, undefined);

  // 2. Sanitización de lectura
  const rawLectura = {
    id: 'lec-uuid-001',
    idSocio: 'soc-uuid-001',
    idMedidor: 'med-uuid-001',
    idPeriodo: 'per-2026-08',
    lecturaAnterior: 100.5,
    lecturaActual: 125.7,
    consumoM3: 25.2,
    excedenteM3: 10.2
  };
  const cleanLectura = cloudSyncService.cleanRecordForSupabase('lecturas', rawLectura);
  assert.strictEqual(cleanLectura.id_socio, 'soc-uuid-001');
  assert.strictEqual(cleanLectura.lectura_anterior, 100.5);
  assert.strictEqual(cleanLectura.lectura_actual, 125.7);
  assert.strictEqual(cleanLectura.consumo_total, 25.2);
  assert.strictEqual(cleanLectura.excedente_m3, 10.2);

  // 3. Sanitización de factura
  const rawFactura = {
    id: 'fac-uuid-001',
    numeroFactura: 'FAC-2026-08-0099',
    idSocio: 'soc-uuid-001',
    idPeriodo: 'per-2026-08',
    valorBase: 7.0,
    valorExcedente: 1.02,
    valorAlcantarillado: 1.0,
    valorMultas: 3.0,
    totalPagar: 12.02
  };
  const cleanFactura = cloudSyncService.cleanRecordForSupabase('facturas', rawFactura);
  assert.strictEqual(cleanFactura.numero_factura, 'FAC-2026-08-0099');
  assert.strictEqual(cleanFactura.valor_base, 7.0);
  assert.strictEqual(cleanFactura.total_mes, 12.02);
  assert.strictEqual(cleanFactura.total_pagar, 12.02);
});

test('5. Integración Supabase: Verificación de Configuración y Cliente', () => {
  const isEnabled = supabaseClient.isEnabled();
  const url = supabaseClient.getUrl();
  assert.strictEqual(typeof isEnabled, 'boolean');
  if (isEnabled) {
    assert.ok(url?.startsWith('https://'), 'La URL de Supabase debe comenzar con https://');
  }

  const status = centralDb.getStatus();
  assert.strictEqual(status.isConnected, true);
  assert.strictEqual(status.cloud, true);
});

test('6. Contraloría y Distribución de Fondos: Regla Operación ($4 base) y Pro-Mejoras (Excedentes)', async () => {
  const { calculateFacturaFundDistribution, FONDO_IDS } = await import('../controllers/financeController.ts');

  // Factura normal con excedente, alcantarillado y multas
  const facturaNormal = {
    es_tercera_edad: false,
    valor_base: 7.0,
    valor_excedente: 2.35,
    valor_alcantarillado: 1.0,
    valor_multas: 5.0,
    valor_deuda_anterior: 0.0,
    total_mes: 10.35,
    total_pagar: 15.35
  };

  const distNormal = calculateFacturaFundDistribution(facturaNormal);
  assert.strictEqual(distNormal.OPERACION_MANT, 4.0, 'Operación y Mantenimiento debe recibir exactamente $4.00 base');
  assert.strictEqual(distNormal.PADRE_PARROQUIA, 2.0, 'Padre Parroquia debe recibir $2.00');
  assert.strictEqual(distNormal.PAGO_LECTOR, 0.5, 'Lector debe recibir $0.50');
  assert.strictEqual(distNormal.MORTUORIO, 0.5, 'Mortuorio debe recibir $0.50');
  assert.strictEqual(distNormal.PRO_MEJORAS, 2.35, 'Pro-Mejoras debe recibir el 100% de excedente ($2.35)');
  assert.strictEqual(distNormal.ALCANTARILLADO, 1.0, 'Alcantarillado debe recibir $1.00');
  assert.strictEqual(distNormal.MULTAS_EXTRAS, 5.0, 'Multas debe recibir $5.00');

  // Factura de 3ra edad ($5.00 base):
  // $2.00 al padre, $0.50 al lector, $0.50 al mortuorio, $2.00 a operación y mantenimiento
  const facturaSenior = {
    es_tercera_edad: true,
    valor_base: 5.0,
    valor_excedente: 1.80,
    valor_alcantarillado: 0.0,
    valor_multas: 0.0,
    valor_deuda_anterior: 0.0,
    total_mes: 6.80,
    total_pagar: 6.80
  };

  const distSenior = calculateFacturaFundDistribution(facturaSenior);
  assert.strictEqual(distSenior.PADRE_PARROQUIA, 2.0, 'Tercera edad aporta $2.00 al Padre Parroquia');
  assert.strictEqual(distSenior.OPERACION_MANT, 2.0, 'Operación y Mantenimiento recibe $2.00 en tercera edad');
  assert.strictEqual(distSenior.PAGO_LECTOR, 0.5, 'Lector recibe $0.50');
  assert.strictEqual(distSenior.MORTUORIO, 0.5, 'Mortuorio recibe $0.50');
  assert.strictEqual(distSenior.PRO_MEJORAS, 1.80, 'Pro-Mejoras recibe el 100% de excedente ($1.80)');
  assert.strictEqual(
    distSenior.PADRE_PARROQUIA + distSenior.OPERACION_MANT + distSenior.PAGO_LECTOR + distSenior.MORTUORIO + distSenior.PRO_MEJORAS,
    6.80,
    'La suma de los fondos debe ser idéntica al total pagar'
  );
});

test('7. Gobernanza Admin: Bases de Distribución Configurables', async () => {
  const { calculateFacturaFundDistribution } = await import('../controllers/financeController.ts');

  // Si el Admin cambia las bases personalizadas
  const customBases = {
    operacion: 4.5,
    padre: 1.5,
    lector: 0.5,
    mortuorio: 0.5
  };

  const fac = {
    es_tercera_edad: false,
    valor_base: 7.0,
    valor_excedente: 3.0,
    valor_alcantarillado: 0.0,
    valor_multas: 0.0,
    total_mes: 10.0,
    total_pagar: 10.0
  };

  const distCustom = calculateFacturaFundDistribution(fac, customBases);
  assert.strictEqual(distCustom.OPERACION_MANT, 4.5, 'Operación debe reflejar la nueva base personalizada de $4.50');
  assert.strictEqual(distCustom.PADRE_PARROQUIA, 1.5, 'Padre debe reflejar la nueva base de $1.50');
  assert.strictEqual(distCustom.PRO_MEJORAS, 3.0, 'Pro-Mejoras recibe el 100% del excedente');
});

test('8. Seguridad y Reversión Contable: Solo Admin puede Anular Movimientos', async () => {
  const { deleteMovimiento } = await import('../controllers/financeController.ts');

  // Test 1: CAJERO no autorizado (403)
  let statusResult = 0;
  let jsonResult: any = null;
  const mockResCajero: any = {
    status: (code: number) => {
      statusResult = code;
      return mockResCajero;
    },
    json: (data: any) => {
      jsonResult = data;
    }
  };

  const reqCajero: any = {
    user: { id: 'u1', rol: 'CAJERO' },
    params: { id: 'mov-123' }
  };

  await deleteMovimiento(reqCajero, mockResCajero);
  assert.strictEqual(statusResult, 403, 'Usuario CAJERO debe recibir 403 Forbidden al intentar anular un movimiento');
  assert.ok(jsonResult?.error?.includes('Solo los usuarios con rol ADMINISTRADOR'), 'Mensaje de error debe indicar restricción de ADMIN');
});

test('9. Módulo de Reportes: Consultas Genéricas de Morosidad y Sectores', async () => {
  const { getReporteMorosidad, getReportePorSector, getReporteConsolidado } = await import('../controllers/reportesController.ts');

  // Test getReporteMorosidad
  let jsonMora: any = null;
  const mockResMora: any = {
    json: (d: any) => { jsonMora = d; },
    status: () => mockResMora
  };
  await getReporteMorosidad({ query: {} } as any, mockResMora);
  assert.ok(jsonMora, 'Debe retornar datos de morosidad');
  assert.strictEqual(typeof jsonMora.totalMorosos, 'number', 'totalMorosos debe ser número');
  assert.ok(Array.isArray(jsonMora.sociosMorosos), 'sociosMorosos debe ser un array');

  // Test getReportePorSector
  let jsonSec: any = null;
  const mockResSec: any = {
    json: (d: any) => { jsonSec = d; },
    status: () => mockResSec
  };
  await getReportePorSector({} as any, mockResSec);
  assert.ok(jsonSec, 'Debe retornar balance de sectores');
  assert.ok(Array.isArray(jsonSec.data), 'data de sectores debe ser array');

  // Test getReporteConsolidado
  let jsonCons: any = null;
  const mockResCons: any = {
    json: (d: any) => { jsonCons = d; },
    status: () => mockResCons
  };
  await getReporteConsolidado({} as any, mockResCons);
  assert.ok(jsonCons, 'Debe retornar consolidado de asamblea');
  assert.strictEqual(typeof jsonCons.totalIngresos, 'number', 'totalIngresos debe ser número');
  assert.ok(jsonCons.desgloseIngresos, 'Debe incluir desglose de ingresos por rubro');
  assert.ok(Array.isArray(jsonCons.fondos), 'Debe incluir el estado de los 7 fondos');
});

test('10. Auditoría y Trazabilidad: Historial y Estado de Cuenta', async () => {
  const { getReporteAuditoria } = await import('../controllers/reportesController.ts');

  let jsonAudit: any = null;
  const mockResAudit: any = {
    json: (d: any) => { jsonAudit = d; },
    status: () => mockResAudit
  };
  await getReporteAuditoria({ query: {} } as any, mockResAudit);
  assert.ok(jsonAudit, 'Debe retornar logs de auditoría');
  assert.ok(Array.isArray(jsonAudit.data), 'data de auditoría debe ser array');
});

test('11. Transición de Periodos y Distribución de Fondos (Regla Julio vs Periodos Posteriores)', async () => {
  const { isPeriodoCorte, calculateFacturaFundDistribution, calculateAbonoFundDistribution } = await import('../controllers/financeController.ts');

  // A. Verificación de corte contable
  assert.strictEqual(isPeriodoCorte('2026-07'), true, '2026-07 debe identificarse como periodo de corte');
  assert.strictEqual(isPeriodoCorte('2026-06'), true, '2026-06 debe identificarse como periodo anterior de corte');
  assert.strictEqual(isPeriodoCorte('JUL-2026'), true, 'JUL-2026 con formato mes debe identificarse como corte');
  assert.strictEqual(isPeriodoCorte('2026-08'), false, '2026-08 NO es periodo de corte');
  assert.strictEqual(isPeriodoCorte('2026-09'), false, '2026-09 NO es periodo de corte');
  assert.strictEqual(isPeriodoCorte(undefined), false, 'Periodo no definido no es corte');

  // B. Factura de corte (Julio 2026): 100% a Operación y Mantenimiento
  const facturaJulio = {
    periodo_codigo: '2026-07',
    es_tercera_edad: false,
    valor_base: 7.0,
    valor_excedente: 2.50,
    valor_alcantarillado: 1.0,
    valor_multas: 0.0,
    total_mes: 10.50,
    total_pagar: 10.50
  };
  const distJulio = calculateFacturaFundDistribution(facturaJulio);
  assert.strictEqual(distJulio.OPERACION_MANT, 10.50, 'En periodos <= 2026-07 el 100% se destina a Operación y Mantenimiento');
  assert.strictEqual(distJulio.PADRE_PARROQUIA, 0.0, 'No se desglosa al Padre en facturas de corte histórico');
  assert.strictEqual(distJulio.PAGO_LECTOR, 0.0, 'No se desglosa al Lector en corte histórico');
  assert.strictEqual(distJulio.MORTUORIO, 0.0, 'No se desglosa a Mortuorio en corte histórico');
  assert.strictEqual(distJulio.PRO_MEJORAS, 0.0, 'No se desglosa a Pro-Mejoras en corte histórico');

  // C. Factura de periodos nuevos (Agosto/Septiembre 2026): desglose completo e independiente
  const facturaAgosto = {
    periodo_codigo: '2026-08',
    es_tercera_edad: false,
    valor_base: 7.0,
    valor_excedente: 3.0,
    valor_alcantarillado: 1.0,
    valor_multas: 0.0,
    total_mes: 11.0,
    total_pagar: 11.0
  };
  const distAgosto = calculateFacturaFundDistribution(facturaAgosto);
  assert.strictEqual(distAgosto.OPERACION_MANT, 4.0, 'Operación recibe $4.00 base');
  assert.strictEqual(distAgosto.PADRE_PARROQUIA, 2.0, 'Padre recibe $2.00');
  assert.strictEqual(distAgosto.PAGO_LECTOR, 0.5, 'Lector recibe $0.50');
  assert.strictEqual(distAgosto.MORTUORIO, 0.5, 'Mortuorio recibe $0.50');
  assert.strictEqual(distAgosto.PRO_MEJORAS, 3.0, 'Pro-Mejoras recibe $3.00 de excedente');
  assert.strictEqual(distAgosto.ALCANTARILLADO, 1.0, 'Alcantarillado recibe $1.00');

  // D. Abono parcial a factura de corte (Julio): 100% a Operación y Mantenimiento
  const abonoJulio = calculateAbonoFundDistribution(facturaJulio, 5.0, '2026-07');
  assert.strictEqual(abonoJulio.OPERACION_MANT, 5.0, 'Abono parcial a factura de Julio va 100% a Operación');
  assert.strictEqual(abonoJulio.PADRE_PARROQUIA, 0.0);

  // E. Abonos parciales a periodos nuevos (Agosto): Cascada de prioridad comunitaria
  // Abono de $3.00 en factura de $11.00:
  // Cascada: Padre ($2.00 max) -> Lector ($0.50 max) -> Mortuorio ($0.50 max) = $3.00 exactos
  const abonoParcial1 = calculateAbonoFundDistribution(facturaAgosto, 3.0, '2026-08');
  assert.strictEqual(abonoParcial1.PADRE_PARROQUIA, 2.0, 'Padre cubre su cuota prioritaria de $2.00');
  assert.strictEqual(abonoParcial1.PAGO_LECTOR, 0.5, 'Lector cubre su cuota de $0.50');
  assert.strictEqual(abonoParcial1.MORTUORIO, 0.5, 'Mortuorio cubre su cuota de $0.50');
  assert.strictEqual(abonoParcial1.OPERACION_MANT, 0.0, 'Operación no recibe todavía con abono de solo $3.00');
  const sumaAbono1 = Object.values(abonoParcial1).reduce((acc, v) => acc + v, 0);
  assert.strictEqual(Number(sumaAbono1.toFixed(2)), 3.0, 'La suma de fondos debe ser exactamente igual al abono de $3.00');

  // Abono de $7.00 en factura de $11.00:
  // Padre $2.00, Lector $0.50, Mortuorio $0.50, Operación $4.00 = $7.00 exactos
  const abonoParcial2 = calculateAbonoFundDistribution(facturaAgosto, 7.0, '2026-08');
  assert.strictEqual(abonoParcial2.PADRE_PARROQUIA, 2.0);
  assert.strictEqual(abonoParcial2.PAGO_LECTOR, 0.5);
  assert.strictEqual(abonoParcial2.MORTUORIO, 0.5);
  assert.strictEqual(abonoParcial2.OPERACION_MANT, 4.0);
  assert.strictEqual(abonoParcial2.PRO_MEJORAS, 0.0);
  const sumaAbono2 = Object.values(abonoParcial2).reduce((acc, v) => acc + v, 0);
  assert.strictEqual(Number(sumaAbono2.toFixed(2)), 7.0, 'La suma de fondos debe ser exactamente igual al abono de $7.00');

  // Abono completo de $11.00:
  const abonoCompleto = calculateAbonoFundDistribution(facturaAgosto, 11.0, '2026-08');
  assert.deepStrictEqual(abonoCompleto, distAgosto, 'El abono completo debe coincidir exactamente con la distribución total');
});

test('12. Comprobante Oficial de Pago de Agua Potable: Contrato API-First y Validación DTO', async () => {
  // A. Validación de parámetro requerido (ID ausente -> HTTP 400)
  let statusResult = 0;
  let jsonResult: any = null;
  const mockReqEmpty: any = { params: {} };
  const mockRes: any = {
    status: (code: number) => {
      statusResult = code;
      return {
        json: (data: any) => { jsonResult = data; }
      };
    }
  };

  await getFacturaComprobante(mockReqEmpty, mockRes);
  assert.strictEqual(statusResult, 400, 'Debe retornar HTTP 400 cuando falta el parámetro ID');
  assert.ok(jsonResult?.error, 'Debe incluir mensaje de error descriptivo');

  // B. Validación de factura inexistente (ID no encontrado -> HTTP 404)
  const mockReqNotFound: any = { params: { id: 'uuid-no-existente-9999' } };
  await getFacturaComprobante(mockReqNotFound, mockRes);
  assert.strictEqual(statusResult, 404, 'Debe retornar HTTP 404 cuando la factura no existe en la base de datos');
  assert.ok(jsonResult?.error?.includes('no encontrado'), 'Debe especificar que el comprobante no fue encontrado');

  // C. Validación de comprobante de abono a deuda anterior exclusiva (REC-1211036816-01):
  const mockReqRec: any = { params: { id: 'REC-1211036816-01' } };
  let jsonResultRec: any = null;
  const mockResRec: any = {
    status: (code: number) => ({ json: (d: any) => { jsonResultRec = d; } }),
    json: (d: any) => { jsonResultRec = d; }
  };
  await getFacturaComprobante(mockReqRec, mockResRec);
  if (jsonResultRec?.success && jsonResultRec?.data) {
    const data = jsonResultRec.data;
    assert.strictEqual(data.detalleValores.consumoMes.length, 0, 'No debe tener filas de consumo de agua si solo pagó deuda');
    assert.strictEqual(data.detalleValores.subtotalConsumoMes, 0, 'Subtotal consumo del mes debe ser 0');
    assert.strictEqual(data.detalleValores.totalFactura, 96, 'El total del comprobante debe ser exactamente el monto cobrado de 96');
    assert.ok(data.detalleValores.rubrosPendientes.some((r: any) => r.cp === 'MA01'), 'Debe incluir rubro MA01 de deuda');
  }

  // D. Validación de comprobante mixto de consumo + deuda (FAC-202608-0030):
  const mockReqFac: any = { params: { id: 'FAC-202608-0030' } };
  let jsonResultFac: any = null;
  const mockResFac: any = {
    status: (code: number) => ({ json: (d: any) => { jsonResultFac = d; } }),
    json: (d: any) => { jsonResultFac = d; }
  };
  await getFacturaComprobante(mockReqFac, mockResFac);
  if (jsonResultFac?.success && jsonResultFac?.data) {
    const data = jsonResultFac.data;
    assert.strictEqual(data.detalleValores.subtotalConsumoMes, 5, 'Subtotal consumo del mes debe ser 5');
    assert.strictEqual(data.detalleValores.subtotalRubrosPendientes, 8, 'Subtotal rubros pendientes debe ser 8');
    assert.strictEqual(data.detalleValores.totalFactura, 13, 'Total del comprobante debe ser exactamente 13');
  }

  // E. Validación de comprobante con excedente de consumo (FAC-202608-0014):
  const mockReqExc: any = { params: { id: 'FAC-202608-0014' } };
  let jsonResultExc: any = null;
  const mockResExc: any = {
    status: (code: number) => ({ json: (d: any) => { jsonResultExc = d; } }),
    json: (d: any) => { jsonResultExc = d; }
  };
  await getFacturaComprobante(mockReqExc, mockResExc);
  if (jsonResultExc?.success && jsonResultExc?.data) {
    const data = jsonResultExc.data;
    assert.strictEqual(data.medidores[0]?.consumoM3, 81, 'El consumo total debe ser 81 m³ (6619 - 6538)');
    assert.strictEqual(data.medidores[0]?.excedenteM3, 51, 'El excedente debe ser 51 m³ (81 - 30)');
    assert.strictEqual(data.detalleValores.totalFactura, 10.10, 'Total de la factura debe ser 10.10');
    const excItem = data.detalleValores.consumoMes.find((r: any) => r.cp === 'EX01');
    assert.ok(excItem, 'Debe incluir el rubro EX01');
    assert.ok(excItem.descripcion.includes('51 m³'), 'La descripción de EX01 debe indicar 51 m³');
    assert.strictEqual(excItem.aPagarCobrado, 5.10, 'El valor cobrado del excedente debe ser 5.10');
  }
});

test('13. Pipeline Genérico de Transición de Período y Línea Base de Lecturas', async () => {
  const pNuevoId = '7a420bed-0c8f-407c-ab03-6814e98f993e'; // Septiembre 2026
  const pAntId = '33333333-0000-0000-0000-000000000001';   // Agosto 2026

  // 1. Ejecutar inicialización genérica de lecturas
  const initResult = await inicializarLecturasPeriodo(pNuevoId, pAntId, '2026-09');
  assert.ok(initResult.medidoresAvanzados > 0, 'Debe haber procesado medidores activos');

  // 2. Verificar que en Supabase las lecturas de Septiembre 2026 existen y cumplen restricciones NOT NULL
  const lRes = await supabaseClient.fetchRecords<Record<string, any>>('lecturas', `id_periodo=eq.${pNuevoId}`);
  const lecturas = lRes.data || [];
  assert.strictEqual(lecturas.length, 88, 'Deben existir exactamente 88 lecturas base en Septiembre 2026');

  // Verificar que ninguna lectura tenga lectura_actual o id_lector nulos
  for (const l of lecturas) {
    assert.notStrictEqual(l.lectura_anterior, null, 'lectura_anterior no debe ser nula');
    assert.notStrictEqual(l.lectura_actual, null, 'lectura_actual no debe ser nula');
    assert.notStrictEqual(l.id_lector, null, 'id_lector no debe ser nulo');
    assert.strictEqual(l.consumo_total, 0, 'El consumo inicial del ciclo debe ser 0');
    assert.strictEqual(l.excedente_m3, 0, 'El excedente inicial del ciclo debe ser 0');
    assert.ok(
      l.observaciones?.startsWith('Punto de partida') || l.observaciones?.startsWith('Sin medidor'),
      'La observación debe indicar que es línea base de partida para el lector'
    );
  }

  // 3. Auditoría de facturas: Cero duplicidades entre facturas pagadas y pendientes en Agosto 2026
  const fRes = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `id_periodo=eq.${pAntId}`);
  const byMed = new Map<string, any[]>();
  for (const f of (fRes.data || [])) {
    if (f.id_medidor) {
      if (!byMed.has(f.id_medidor)) byMed.set(f.id_medidor, []);
      byMed.get(f.id_medidor)!.push(f);
    }
  }

  for (const [mId, list] of byMed.entries()) {
    const pag = list.filter((x) => x.estado_pago === 'PAGADO');
    const pen = list.filter((x) => x.estado_pago === 'PENDIENTE');
    assert.ok(
      !(pag.length > 0 && pen.length > 0),
      `El medidor ${mId} no debe tener simultáneamente facturas pagadas y pendientes en el mismo período`
    );
  }
});



