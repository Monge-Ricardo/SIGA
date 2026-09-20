process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword, generateToken, verifyToken } from '../utils/security.ts';
import { ConflictResolver } from '../services/conflictResolver.ts';
import { cloudSyncService } from '../services/cloudSyncService.ts';
import { ValidationRules } from '../shared.ts';
import { supabaseClient } from '../db/supabase.ts';
import { centralDb } from '../db/connection.ts';

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
