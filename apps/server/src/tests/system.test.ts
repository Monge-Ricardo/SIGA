import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteDb } from '../db/sqlite.ts';
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../utils/security.ts';
import { socioService } from '../services/socioService.ts';
import { lecturaService } from '../services/lecturaService.ts';
import { facturacionService } from '../services/facturacionService.ts';
import { fondosService } from '../services/fondosService.ts';
import { reportesService } from '../services/reportesService.ts';
import { ConflictResolver } from '../services/conflictResolver.ts';
import { ValidationRules } from '../shared.ts';

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

test('3. Módulo 1: Padrón de Socios y Cuenta Corriente', () => {
  const db = sqliteDb.getRawDb();
  const sector = db.prepare('SELECT id FROM sectores LIMIT 1').get() as { id: string };

  const nuevoSocio = socioService.createSocio({
    codigoSocio: `SOC-TEST-${Date.now()}`,
    nombres: 'José',
    apellidos: 'Luna',
    cedulaRuc: `171003${String(Date.now()).slice(-4)}`,
    fechaNacimiento: '1984-03-15', // 42 años -> Normal
    idSector: sector.id,
    medidorNumero: `MED-TEST-${Date.now()}`,
    tieneAlcantarillado: true,
    telefono: '0991234567',
    direccion: 'Sector Centro Calle 1'
  });

  assert.ok(nuevoSocio.id);
  assert.strictEqual(nuevoSocio.esTerceraEdad, false, 'A los 42 años no debe ser 3ra edad');
  assert.strictEqual(nuevoSocio.tieneAlcantarillado, true);

  const estadoCta = socioService.getEstadoCuenta(nuevoSocio.id);
  assert.strictEqual(estadoCta.alDia, true, 'Un socio recién creado sin deudas debe estar al día');
  assert.strictEqual(estadoCta.mesesAdeudados, 0);
});

test('4. Módulo 2: Micromedición, Validación L_act >= L_ant y Excedentes', () => {
  const db = sqliteDb.getRawDb();
  const sector = db.prepare('SELECT id FROM sectores LIMIT 1').get() as { id: string };
  const lector = db.prepare("SELECT id FROM usuarios WHERE rol = 'LECTOR' LIMIT 1").get() as { id: string };
  const periodo = lecturaService.getPeriodos()[0];

  const socio = socioService.createSocio({
    codigoSocio: `SOC-MED-${Date.now()}`,
    nombres: 'María',
    apellidos: 'Pérez',
    cedulaRuc: `092345${String(Date.now()).slice(-4)}`,
    fechaNacimiento: '1950-01-01', // 3ra edad
    idSector: sector.id,
    medidorNumero: `MED-MED-${Date.now()}`,
    tieneAlcantarillado: false,
    direccion: 'Sector La Loma'
  });

  // Caso: Lectura actual 195 m³, anterior 150 m³ -> Consumo 45 m³, Excedente 15 m³
  const lectura = lecturaService.registrarLectura({
    idSocio: socio.id,
    idPeriodo: periodo.id,
    lecturaActual: 195,
    lecturaAnterior: 150,
    idLector: lector.id,
    observaciones: 'Lectura normal'
  });

  assert.strictEqual(lectura.consumoTotal, 45, '45 m3 consumidos');
  assert.strictEqual(lectura.excedenteM3, 15, '15 m3 excedente sobre base de 30m3');

  // Caso inválido: L_act < L_ant
  assert.throws(() => {
    lecturaService.registrarLectura({
      idSocio: socio.id,
      idPeriodo: periodo.id,
      lecturaActual: 100, // Menor que anterior 150
      lecturaAnterior: 150,
      idLector: lector.id
    });
  }, /no puede ser menor a la lectura anterior/);
});

test('5. Módulo 3: Facturación y Cálculo Exacto (Caso Práctico José Luna)', () => {
  const db = sqliteDb.getRawDb();
  const sector = db.prepare('SELECT id FROM sectores LIMIT 1').get() as { id: string };
  const lector = db.prepare("SELECT id FROM usuarios WHERE rol = 'LECTOR' LIMIT 1").get() as { id: string };
  const cajero = db.prepare("SELECT id FROM usuarios WHERE rol = 'CAJERO' LIMIT 1").get() as { id: string };
  const periodo = lecturaService.getPeriodos()[0];

  // Socio José Luna: Normal (42 años), Sector Centro, Alcantarillado ($1.00)
  const socio = socioService.createSocio({
    codigoSocio: `SOC-LUNA-${Date.now()}`,
    nombres: 'José',
    apellidos: 'Luna',
    cedulaRuc: `110293${String(Date.now()).slice(-4)}`,
    fechaNacimiento: '1984-05-10',
    idSector: sector.id,
    medidorNumero: `MED-LUNA-${Date.now()}`,
    tieneAlcantarillado: true,
    direccion: 'Centro'
  });

  // Lectura: 195 vs 150 -> 45 m3 total (15 m3 excedente * $0.10 = $1.50)
  lecturaService.registrarLectura({
    idSocio: socio.id,
    idPeriodo: periodo.id,
    lecturaActual: 195,
    lecturaAnterior: 150,
    idLector: lector.id
  });

  // Multa de $3.00 por inasistencia a minga
  facturacionService.crearMulta({
    idSocio: socio.id,
    tipoRubro: 'MINGA',
    monto: 3.0,
    motivo: 'Inasistencia a minga de limpieza'
  });

  // Liquidar factura
  const factura = facturacionService.liquidarFacturaMes(socio.id, periodo.id);

  assert.strictEqual(factura.valorBase, 7.0, 'Cargo fijo normal de $7.00');
  assert.strictEqual(factura.valorExcedente, 1.5, '15 m3 * $0.10 = $1.50');
  assert.strictEqual(factura.valorAlcantarillado, 1.0, 'Alcantarillado = $1.00');
  assert.strictEqual(factura.valorMultas, 3.0, 'Multa = $3.00');
  assert.strictEqual(factura.totalMes, 9.5, '$7.00 + $1.50 + $1.00 = $9.50');
  assert.strictEqual(factura.totalPagar, 12.5, '$9.50 + $3.00 multa = $12.50');

  // Cobro en caja
  const facturaPagada = facturacionService.cobrarFactura(factura.id, {
    metodoPago: 'EFECTIVO',
    idCajero: cajero.id
  });

  assert.strictEqual(facturaPagada.estadoPago, 'PAGADO');
  assert.ok(facturaPagada.fechaPago);

  // RNF-04: Bloqueo de cobro duplicado
  assert.throws(() => {
    facturacionService.cobrarFactura(factura.id, {
      metodoPago: 'TRANSFERENCIA',
      idCajero: cajero.id
    });
  }, /ya se encuentra pagada/);
});

test('6. Módulo 4: Libro Mayor de Fondos de 3 Columnas y Reparto Automático', () => {
  const db = sqliteDb.getRawDb();
  const cajero = db.prepare("SELECT id FROM usuarios WHERE rol = 'CAJERO' LIMIT 1").get() as { id: string };

  const catalogo = fondosService.getFondos();
  assert.strictEqual(catalogo.length, 7, 'Debe haber 7 fondos comunitarios');

  const libroMayor = fondosService.getLibroMayor();
  assert.ok(Array.isArray(libroMayor), 'El Libro Mayor debe retornar lista de movimientos');

  const balance = fondosService.getBalanceGeneralFondos();
  assert.ok(balance.saldoGlobalDisponible >= 0, 'El saldo disponible no debe ser negativo');
  assert.strictEqual(balance.fondos.length, 7);

  // Registrar un egreso con comprobante
  const fondoOp = fondosService.getFondoByCodigo('OPERACION_MANT')!;
  const egreso = fondosService.registrarMovimiento({
    idFondo: fondoOp.id,
    concepto: 'Compra de 2 sacos de sulfato de aluminio para potabilización',
    tipo: 'EGRESO',
    monto: 15.0,
    numeroComprobante: 'FACT-PROV-0089',
    beneficiario: 'Químicos del Austro',
    idResponsable: cajero.id
  });

  assert.strictEqual(egreso.tipo, 'EGRESO');
  assert.strictEqual(egreso.egreso, 15.0);
  assert.strictEqual(egreso.numeroComprobante, 'FACT-PROV-0089');
});

test('7. Módulo 5: Reportes de Morosidad, Sectores y Consolidado', () => {
  const reporteMora = reportesService.getReporteMorosidad();
  assert.ok(typeof reporteMora.totalMorosos === 'number');
  assert.ok(typeof reporteMora.deudaTotalAcumulada === 'number');

  const reportesSectores = reportesService.getReportePorSector();
  assert.ok(Array.isArray(reportesSectores));
  assert.ok(reportesSectores.length >= 3, 'Al menos 3 sectores');

  const consolidado = reportesService.getReporteConsolidado();
  assert.ok(consolidado.totalSocios >= 1);
  assert.ok(consolidado.fondosComunitarios.fondos.length === 7);
});

test('8. Módulo 6: Sincronización Offline-First con LWW', () => {
  const db = sqliteDb.getRawDb();
  const sector = db.prepare('SELECT id FROM sectores LIMIT 1').get() as { id: string };

  const ack = ConflictResolver.processMutation({
    id: 'mutation-sync-01',
    entity: 'clientes',
    entityId: 'socio-sync-01',
    action: 'CREATE',
    payload: {
      codigoSocio: `SOC-SYNC-${Date.now()}`,
      nombres: 'Carlos',
      apellidos: 'Mendoza',
      cedulaRuc: `010293${String(Date.now()).slice(-4)}`,
      fechaNacimiento: '1975-06-12',
      idSector: sector.id,
      medidorNumero: `MED-SYNC-${Date.now()}`,
      tieneAlcantarillado: true,
      direccion: 'Sector Centro'
    },
    localTimestamp: new Date().toISOString(),
    status: 'PENDING',
    retryCount: 0,
    version: 1
  });

  assert.strictEqual(ack.status, 'ACCEPTED');
  assert.strictEqual(ack.mutationId, 'mutation-sync-01');
});
