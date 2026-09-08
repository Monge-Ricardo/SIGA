process.env.NODE_ENV = 'test';
process.env.DISABLE_SUPABASE_SYNC = 'true';

import test, { after } from 'node:test';
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

  const lecturasDelSocio = lecturaService.getLecturas({ socioId: nuevoSocio.id });
  assert.ok(lecturasDelSocio.length >= 1, 'El socio recién creado debe tener registro de lectura inicial en el período abierto');
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

  // Asegurar saldo para el fondo de operación
  const fondoOp = fondosService.getFondoByCodigo('OPERACION_MANT')!;
  fondosService.registrarMovimiento({
    idFondo: fondoOp.id,
    concepto: 'Aporte de apertura para pruebas',
    tipo: 'INGRESO',
    monto: 50.0,
    numeroComprobante: 'REC-INICIAL-TEST',
    idResponsable: cajero.id
  });

  const balance = fondosService.getBalanceGeneralFondos();
  assert.ok(balance.saldoGlobalDisponible >= 0, 'El saldo disponible no debe ser negativo');
  assert.strictEqual(balance.fondos.length, 7);

  // Registrar un egreso con comprobante
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

test('6.1. Eliminación en Cascada de Socio (ADMIN)', () => {
  const db = sqliteDb.getRawDb();
  const sector = db.prepare('SELECT id FROM sectores LIMIT 1').get() as { id: string };

  const socioEliminar = socioService.createSocio({
    codigoSocio: `SOC-DEL-${Date.now()}`,
    nombres: 'Eliminar',
    apellidos: 'Prueba',
    cedulaRuc: `170099${String(Date.now()).slice(-4)}`,
    fechaNacimiento: '1980-01-01',
    idSector: sector.id,
    medidorNumero: `MED-DEL-${Date.now()}`,
    tieneAlcantarillado: true,
    direccion: 'Sector Temporal'
  });

  assert.ok(socioEliminar.id);

  // Intentar eliminar
  const res = socioService.deleteSocio(socioEliminar.id);
  assert.strictEqual(res.success, true);

  // Verificar que ya no existe
  const buscado = socioService.getSocioById(socioEliminar.id);
  assert.strictEqual(buscado, null);
});

test('6.2. Eliminación y Reversión Contable de Factura (ADMIN)', () => {
  const db = sqliteDb.getRawDb();
  const sector = db.prepare('SELECT id FROM sectores LIMIT 1').get() as { id: string };
  const cajero = db.prepare("SELECT id FROM usuarios WHERE rol = 'CAJERO' LIMIT 1").get() as { id: string };
  const periodo = lecturaService.getPeriodos()[0];

  // 1. Crear socio de prueba
  const socio = socioService.createSocio({
    codigoSocio: `SOC-REV-${Date.now()}`,
    nombres: 'Prueba',
    apellidos: 'Reversión',
    cedulaRuc: `010099${String(Date.now()).slice(-4)}`,
    fechaNacimiento: '1985-05-15',
    idSector: sector.id,
    medidorNumero: `MED-REV-${Date.now()}`,
    tieneAlcantarillado: true,
    direccion: 'Sector Reversión'
  });

  // 2. Crear una multa de $5.00
  facturacionService.crearMulta({
    idSocio: socio.id,
    tipoRubro: 'MINGA',
    monto: 5.0,
    motivo: 'Inasistencia a minga'
  });

  // 3. Liquidar y cobrar factura
  const factura = facturacionService.liquidarFacturaMes(socio.id, periodo.id);
  const fondoPadre = fondosService.getFondoByCodigo('PADRE_PARROQUIA')!;
  const fondoOp = fondosService.getFondoByCodigo('OPERACION_MANT')!;
  const saldoPadreAntesCobro = fondosService.getUltimoSaldoFondo(fondoPadre.id);
  const saldoOpAntesCobro = fondosService.getUltimoSaldoFondo(fondoOp.id);

  const cobrada = facturacionService.cobrarFactura(factura.id, {
    metodoPago: 'EFECTIVO',
    idCajero: cajero.id
  });
  assert.strictEqual(cobrada.estadoPago, 'PAGADO');

  // Verificar que los saldos aumentaron (Padre +$2.00, Operación +$4.00)
  const saldoPadreDespuesCobro = fondosService.getUltimoSaldoFondo(fondoPadre.id);
  const saldoOpDespuesCobro = fondosService.getUltimoSaldoFondo(fondoOp.id);
  assert.strictEqual(Number((saldoPadreDespuesCobro - saldoPadreAntesCobro).toFixed(2)), 2.0);
  assert.strictEqual(Number((saldoOpDespuesCobro - saldoOpAntesCobro).toFixed(2)), 4.0);

  // Verificar que la multa quedó pagada y vinculada a la factura
  const multasPagadas = facturacionService.getMultas({ socioId: socio.id, pagado: true });
  assert.strictEqual(multasPagadas.length, 1);
  assert.strictEqual(multasPagadas[0].idFactura, factura.id);

  // 4. Admin elimina y anula la factura
  const resDel = facturacionService.deleteFactura(factura.id);
  assert.strictEqual(resDel.success, true);

  // 5. Verificar que la factura ya no existe
  const facBuscada = facturacionService.getFacturaById(factura.id);
  assert.strictEqual(facBuscada, null);

  // 6. Verificar que los fondos se revirtieron al saldo previo exacto
  const saldoPadreFinal = fondosService.getUltimoSaldoFondo(fondoPadre.id);
  const saldoOpFinal = fondosService.getUltimoSaldoFondo(fondoOp.id);
  assert.strictEqual(saldoPadreFinal, saldoPadreAntesCobro);
  assert.strictEqual(saldoOpFinal, saldoOpAntesCobro);

  // 7. Verificar que la multa volvió a estar impaga y desvinculada
  const multasRestauradas = facturacionService.getMultas({ socioId: socio.id });
  assert.strictEqual(multasRestauradas.length, 1);
  assert.strictEqual(multasRestauradas[0].pagado, false);
  assert.strictEqual(multasRestauradas[0].idFactura, undefined);

  // 8. Verificar que el estado de cuenta del socio refleja la deuda restaurada
  const estadoCta = socioService.getEstadoCuenta(socio.id);
  assert.strictEqual(estadoCta.alDia, false);
  assert.strictEqual(estadoCta.deudaTotalPendiente, 5.0);
});

test('6.3. Gestión y Cobro Selectivo de Multas y Deudas Anteriores', () => {
  const db = sqliteDb.getRawDb();
  const sector = db.prepare('SELECT id FROM sectores LIMIT 1').get() as { id: string };
  const cajero = db.prepare("SELECT id FROM usuarios WHERE rol = 'CAJERO' LIMIT 1").get() as { id: string };
  const periodo = lecturaService.getPeriodos()[0];

  // 1. Crear socio
  const socio = socioService.createSocio({
    codigoSocio: `SOC-SEL-${Date.now()}`,
    nombres: 'Socio',
    apellidos: 'Selectivo',
    cedulaRuc: `070099${String(Date.now()).slice(-4)}`,
    fechaNacimiento: '1988-10-10',
    idSector: sector.id,
    medidorNumero: `MED-SEL-${Date.now()}`,
    tieneAlcantarillado: false,
    direccion: 'Sector Sel'
  });

  // 2. Crear dos multas
  const m1 = facturacionService.crearMulta({
    idSocio: socio.id,
    tipoRubro: 'MINGA',
    monto: 3.0,
    motivo: 'Inasistencia minga 1'
  });
  const m2 = facturacionService.crearMulta({
    idSocio: socio.id,
    tipoRubro: 'ASAMBLEA',
    monto: 2.0,
    motivo: 'Inasistencia asamblea'
  });

  // 3. Editar m1 (cambiar monto a $4.00 y motivo)
  const m1Updated = facturacionService.updateMulta(m1.id, {
    monto: 4.0,
    motivo: 'Inasistencia minga modificada'
  });
  assert.strictEqual(m1Updated.monto, 4.0);
  assert.strictEqual(m1Updated.motivo, 'Inasistencia minga modificada');

  // 4. Crear una tercera multa y eliminarla
  const m3 = facturacionService.crearMulta({
    idSocio: socio.id,
    tipoRubro: 'OTRO',
    monto: 10.0,
    motivo: 'Multa temporal errónea'
  });
  const delRes = facturacionService.deleteMulta(m3.id);
  assert.strictEqual(delRes.success, true);

  // 5. Liquidar seleccionando ÚNICAMENTE m1 ($4.00) y dejando m2 ($2.00) desmarcada
  const factura = facturacionService.liquidarFacturaMes(socio.id, periodo.id, {
    multasIds: [m1.id]
  });
  assert.strictEqual(factura.valorBase, 7.0);
  assert.strictEqual(factura.valorMultas, 4.0, 'Debe incluir solo la multa m1 de $4.00');
  assert.strictEqual(factura.totalPagar, 11.0, '$7.00 base + $4.00 multa m1 = $11.00');

  // 6. Cobrar la factura con m1 seleccionada
  const cobro = facturacionService.cobrarFactura(factura.id, {
    metodoPago: 'EFECTIVO',
    idCajero: cajero.id,
    multasIds: [m1.id]
  });
  assert.strictEqual(cobro.estadoPago, 'PAGADO');

  // 7. Verificar que m1 quedó pagada y m2 sigue pendiente
  const multasActuales = facturacionService.getMultas({ socioId: socio.id });
  const m1Final = multasActuales.find((m) => m.id === m1.id);
  const m2Final = multasActuales.find((m) => m.id === m2.id);
  assert.strictEqual(m1Final?.pagado, true);
  assert.strictEqual(m2Final?.pagado, false);

  // 8. Verificar que el estado de cuenta refleja la mora reducida (solo $2.00 de m2 pendiente)
  const estCta = socioService.getEstadoCuenta(socio.id);
  assert.strictEqual(estCta.deudaTotalPendiente, 2.0);
  assert.strictEqual(estCta.alDia, false);
});

test('6.4. Pagos Parciales / Abonos en Caja y Saldo Pendiente del Socio', () => {
  const db = sqliteDb.getRawDb();
  const sector = db.prepare('SELECT id FROM sectores LIMIT 1').get() as { id: string };
  const cajero = db.prepare("SELECT id FROM usuarios WHERE rol = 'CAJERO' LIMIT 1").get() as { id: string };
  const periodo = lecturaService.getPeriodos()[0];

  // 1. Crear socio
  const socio = socioService.createSocio({
    codigoSocio: `SOC-ABONO-${Date.now()}`,
    nombres: 'Abono',
    apellidos: 'Parcial',
    cedulaRuc: `180099${String(Date.now()).slice(-4)}`,
    fechaNacimiento: '1990-01-01',
    idSector: sector.id,
    medidorNumero: `MED-ABONO-${Date.now()}`,
    tieneAlcantarillado: true,
    direccion: 'Sector Abonos'
  });

  // 2. Registrar lectura de 288 m3 de excedente para totalizar $34.80 ($7.00 base + $28.80 exc + $1.00 alcant - o con multas)
  // Base: $7.00 + Alcant: $1.00 + Multa: $26.80 = $34.80
  facturacionService.crearMulta({
    idSocio: socio.id,
    tipoRubro: 'CUOTA_EXTRA',
    monto: 26.80,
    motivo: 'Cuota extraordinaria para tubería'
  });

  const factura = facturacionService.liquidarFacturaMes(socio.id, periodo.id);
  assert.strictEqual(factura.totalPagar, 34.80, 'Total a pagar = $34.80 USD');
  assert.strictEqual(factura.montoPagado, 0.0);
  assert.strictEqual(factura.saldoPendiente, 34.80);

  // 3. El socio realiza un abono parcial de $32.22 en efectivo
  const facturaAbonada = facturacionService.cobrarFactura(factura.id, {
    metodoPago: 'EFECTIVO',
    idCajero: cajero.id,
    montoCobrado: 32.22
  });

  assert.strictEqual(facturaAbonada.estadoPago, 'PENDIENTE', 'La factura sigue PENDIENTE porque queda saldo');
  assert.strictEqual(facturaAbonada.montoPagado, 32.22, 'Monto pagado = $32.22 USD');
  assert.strictEqual(facturaAbonada.saldoPendiente, 2.58, 'Saldo pendiente = $2.58 USD');

  // 4. El estado de cuenta del socio debe reflejar la deuda de $2.58 y estado EN_MORA
  const estCta = socioService.getEstadoCuenta(socio.id);
  assert.strictEqual(estCta.alDia, false);
  assert.strictEqual(estCta.deudaTotalPendiente, 2.58, 'Deuda pendiente del socio = $2.58 USD');
  assert.strictEqual(estCta.mesesAdeudados, 1);

  // 5. El socio regresa después y cancela los $2.58 restantes
  const facturaFiniquitada = facturacionService.cobrarFactura(factura.id, {
    metodoPago: 'EFECTIVO',
    idCajero: cajero.id,
    montoCobrado: 2.58
  });

  assert.strictEqual(facturaFiniquitada.estadoPago, 'PAGADO', 'La factura queda PAGADA al completar saldo');
  assert.strictEqual(facturaFiniquitada.montoPagado, 34.80);
  assert.strictEqual(facturaFiniquitada.saldoPendiente, 0.0);

  // 6. El estado de cuenta del socio ahora queda AL DÍA
  const estCtaFinal = socioService.getEstadoCuenta(socio.id);
  assert.strictEqual(estCtaFinal.alDia, true);
  assert.strictEqual(estCtaFinal.deudaTotalPendiente, 0.0);
  assert.strictEqual(estCtaFinal.mesesAdeudados, 0);
});

test('7. Módulo 5: Reportes de Morosidad, Sectores y Consolidado', () => {
  const reporteMora = reportesService.getReporteMorosidad();
  assert.ok(typeof reporteMora.totalMorosos === 'number');
  assert.ok(typeof reporteMora.deudaTotalAcumulada === 'number');
  assert.ok(Array.isArray(reporteMora.morosos));
  if (reporteMora.morosos.length > 0) {
    const primerMoroso = reporteMora.morosos[0];
    assert.ok(typeof primerMoroso.mesesAdeudados === 'number');
    assert.ok(typeof primerMoroso.deudaTotalPendiente === 'number');
    assert.ok(typeof primerMoroso.nombresCompletos === 'string');
    assert.ok(typeof primerMoroso.nombreSector === 'string');
  }

  const reportesSectores = reportesService.getReportePorSector();
  assert.ok(Array.isArray(reportesSectores));
  assert.ok(reportesSectores.length >= 3, 'Al menos 3 sectores');
  const primerSector = reportesSectores[0];
  assert.ok(typeof primerSector.totalFacturado === 'number');
  assert.ok(typeof primerSector.totalCobrado === 'number');
  assert.ok(typeof primerSector.totalEnMora === 'number');

  const consolidado = reportesService.getReporteConsolidado();
  assert.ok(consolidado.totalSocios >= 1);
  assert.ok(typeof consolidado.totalIngresos === 'number');
  assert.ok(typeof consolidado.totalEgresos === 'number');
  assert.ok(typeof consolidado.saldoNeto === 'number');
  assert.ok(consolidado.desgloseIngresos && typeof consolidado.desgloseIngresos.baseAgua === 'number');
  assert.ok(Array.isArray(consolidado.fondos) && consolidado.fondos.length === 7);
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

after(() => {
  // Limpieza de datos de prueba para mantener la integridad del padrón oficial (81 socios, 89 medidores)
  const db = sqliteDb.getRawDb();
  db.exec(`
    DELETE FROM fondos_movimientos WHERE id_factura IN (SELECT id FROM facturas WHERE id_socio IN (SELECT id FROM socios WHERE codigo_socio NOT LIKE 'SOC-0%'));
    DELETE FROM multas_rubros WHERE id_socio IN (SELECT id FROM socios WHERE codigo_socio NOT LIKE 'SOC-0%');
    DELETE FROM facturas WHERE id_socio IN (SELECT id FROM socios WHERE codigo_socio NOT LIKE 'SOC-0%');
    DELETE FROM lecturas WHERE id_socio IN (SELECT id FROM socios WHERE codigo_socio NOT LIKE 'SOC-0%');
    DELETE FROM medidores WHERE id_socio IN (SELECT id FROM socios WHERE codigo_socio NOT LIKE 'SOC-0%');
    DELETE FROM socios WHERE codigo_socio NOT LIKE 'SOC-0%';
    DELETE FROM usuarios WHERE username IN ('cajero_test');
  `);
});



