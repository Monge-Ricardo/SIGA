import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

function loadEnv() {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        const val = (match[2] || '').trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';

const seedData = JSON.parse(fs.readFileSync(path.resolve('scripts/seed_normalizado.json'), 'utf8'));

console.log('🚀 [SIGA] Sincronización Integral Dual: SQLite Local + Supabase Cloud');
console.log(`📊 Datos a sincronizar:`);
console.log(`   - Sectores: ${seedData.sectores.length}`);
console.log(`   - Períodos: ${seedData.periodos.length} (Julio 2026 CERRADO / Agosto 2026 ABIERTO)`);
console.log(`   - Socios Titulares: ${seedData.socios.length}`);
console.log(`   - Medidores Acometidas: ${seedData.medidores.length}`);
console.log(`   - Lecturas Iniciales (Julio): ${seedData.lecturas.length}`);
console.log(`   - Facturas con Deuda (Julio): ${seedData.facturas.length}`);
console.log(`   - Multas Acumuladas (Julio): ${seedData.multas_rubros.length}`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

const now = new Date().toISOString();

// Mapeo del primer medidor por socio para retrocompatibilidad en tabla socios
const primerMedidorPorSocio = {};
for (const m of seedData.medidores) {
  if (!primerMedidorPorSocio[m.id_socio]) {
    primerMedidorPorSocio[m.id_socio] = m;
  }
}

// ==============================================================================
// 1. SINCRONIZACIÓN LOCAL: SQLite (en apps/server/data y en data)
// ==============================================================================
function syncSingleSQLite(targetFilePath) {
  console.log(`\n📦 Sincronizando SQLite en: ${targetFilePath}...`);
  const dir = path.dirname(targetFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(targetFilePath);
  db.exec('PRAGMA foreign_keys = OFF;');

  // 1. Limpieza de tablas transaccionales
  db.exec(`
    DELETE FROM fondos_movimientos;
    DELETE FROM facturas;
    DELETE FROM multas_rubros;
    DELETE FROM lecturas;
    DELETE FROM medidores;
    DELETE FROM socios;
    DELETE FROM periodos;
    DELETE FROM sectores;
  `);

  // 2. Usuarios del sistema
  const stmtUser = db.prepare(`
    INSERT OR REPLACE INTO usuarios (id, username, password_hash, nombre_completo, rol, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);
  stmtUser.run('00000000-0000-0000-0000-000000000001', 'admin', hashPassword('Admin123*'), 'Carlos Morales (Administrador)', 'ADMIN', now, now);
  stmtUser.run('00000000-0000-0000-0000-000000000002', 'cajero', hashPassword('Cajero123*'), 'Gladys Guamán (Tesorera / Cajera)', 'CAJERO', now, now);
  stmtUser.run('00000000-0000-0000-0000-000000000003', 'lector', hashPassword('Lector123*'), 'Manuel Tacuri (Lector de Campo)', 'LECTOR', now, now);

  // 3. Sectores oficiales
  const stmtSector = db.prepare(`
    INSERT OR REPLACE INTO sectores (id, codigo_sector, nombre_sector, descripcion, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);
  for (const s of seedData.sectores) {
    stmtSector.run(s.id, s.codigo_sector, s.nombre_sector, s.descripcion, now, now);
  }

  // 4. Tarifas Config
  db.exec(`
    INSERT OR REPLACE INTO tarifas_config (
      id, cargo_fijo_normal, cargo_fijo_tercera_edad, limite_base_m3, 
      costo_excedente_m3, recargo_alcantarillado,
      reparto_normal_padre, reparto_normal_operacion, reparto_normal_lector, reparto_normal_mortuorio,
      activo, created_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000010', 7.00, 5.00, 30.00, 0.10, 1.00, 2.00, 4.00, 0.50, 0.50, 1, '${now}'
    );
  `);

  // 5. Catálogo de Fondos
  const fondos = [
    { id: '22222222-2222-2222-2222-222222220001', codigo: 'PADRE_PARROQUIA', nombre: 'Fondo Parroquial (Entrega al Padre)', desc: '$2.00 por tarifa base normal' },
    { id: '22222222-2222-2222-2222-222222220002', codigo: 'OPERACION_MANT', nombre: 'Fondo Operación y Mantenimiento', desc: '$4.00 base + 100% de excedentes' },
    { id: '22222222-2222-2222-2222-222222220003', codigo: 'PAGO_LECTOR', nombre: 'Fondo Pago a Lectores', desc: '$0.50 mensual por toma de lecturas' },
    { id: '22222222-2222-2222-2222-222222220004', codigo: 'MORTUORIO', nombre: 'Fondo Mortuorio Solidario', desc: '$0.50 de auxilio funerario comunitario' },
    { id: '22222222-2222-2222-2222-222222220005', codigo: 'PRO_MEJORAS', nombre: 'Fondo Pro-Mejoras e Infraestructura', desc: 'Fondo de reserva comunitario' },
    { id: '22222222-2222-2222-2222-222222220006', codigo: 'MULTAS_EXTRAS', nombre: 'Fondo Multas y Mingas', desc: 'Sanciones e inasistencias' },
    { id: '22222222-2222-2222-2222-222222220007', codigo: 'ALCANTARILLADO', nombre: 'Fondo Alcantarillado', desc: '$1.00 mensual para saneamiento' }
  ];
  const stmtFondo = db.prepare(`INSERT OR REPLACE INTO fondos_catalogo (id, codigo, nombre, descripcion, activo) VALUES (?, ?, ?, ?, 1)`);
  for (const f of fondos) {
    stmtFondo.run(f.id, f.codigo, f.nombre, f.desc);
  }

  // 6. Períodos (Julio cerrado, Agosto abierto)
  const stmtPer = db.prepare(`
    INSERT OR REPLACE INTO periodos (id, periodo_codigo, nombre, fecha_inicio, fecha_fin, estado, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of seedData.periodos) {
    stmtPer.run(p.id, p.periodo_codigo, p.nombre, p.fecha_inicio, p.fecha_fin, p.estado, now);
  }

  // 7. Socios
  const stmtSocio = db.prepare(`
    INSERT OR REPLACE INTO socios (
      id, codigo_socio, nombres, apellidos, cedula_ruc, 
      fecha_nacimiento, fecha_union, id_sector, medidor_numero, tiene_alcantarillado,
      telefono, direccion, estado, version, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  for (const s of seedData.socios) {
    const primerMed = primerMedidorPorSocio[s.id] || {};
    stmtSocio.run(
      s.id,
      s.codigo_socio,
      s.nombres,
      s.apellidos,
      s.cedula_ruc,
      s.fecha_nacimiento,
      s.fecha_union,
      primerMed.id_sector || s.id_sector,
      primerMed.numero_medidor || 'SN-01',
      primerMed.tiene_alcantarillado ? 1 : 0,
      s.telefono,
      s.direccion,
      s.estado,
      now,
      now
    );
  }

  // 8. Medidores Acometidas (1 Socio : N Medidores)
  const stmtMed = db.prepare(`
    INSERT OR REPLACE INTO medidores (id, id_socio, id_sector, numero_medidor, alias, direccion, tiene_alcantarillado, estado, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  for (const m of seedData.medidores) {
    stmtMed.run(
      m.id,
      m.id_socio,
      m.id_sector,
      m.numero_medidor,
      m.alias,
      m.direccion,
      m.tiene_alcantarillado ? 1 : 0,
      m.estado,
      now,
      now
    );
  }

  // 9. Lecturas de Corte Inicial (Julio 2026)
  const stmtLec = db.prepare(`
    INSERT OR REPLACE INTO lecturas (id, id_medidor, id_socio, id_periodo, lectura_anterior, lectura_actual, consumo_total, excedente_m3, fecha_lectura, id_lector, observaciones, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  for (const l of seedData.lecturas) {
    stmtLec.run(
      l.id,
      l.id_medidor,
      l.id_socio,
      l.id_periodo,
      l.lectura_anterior,
      l.lectura_actual,
      l.consumo_total,
      l.excedente_m3,
      l.fecha_lectura,
      l.id_lector,
      l.observaciones,
      now,
      now
    );
  }

  // 10. Facturas con Deuda Pendiente acumulada al corte de Julio
  const stmtFac = db.prepare(`
    INSERT OR REPLACE INTO facturas (
      id, numero_factura, id_socio, id_medidor, id_periodo, id_lectura,
      es_tercera_edad, valor_base, consumo_m3, excedente_m3, valor_excedente,
      valor_alcantarillado, valor_multas, valor_deuda_anterior, total_mes,
      total_pagar, monto_pagado, saldo_pendiente, estado_pago,
      fecha_vencimiento, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, 1, ?, ?)
  `);
  for (const f of seedData.facturas) {
    stmtFac.run(
      f.id,
      f.numero_factura,
      f.id_socio,
      f.id_medidor,
      f.id_periodo,
      f.id_lectura,
      f.es_tercera_edad ? 1 : 0,
      f.valor_base,
      f.consumo_m3,
      f.excedente_m3,
      f.valor_excedente,
      f.valor_alcantarillado,
      f.valor_multas,
      f.valor_deuda_anterior,
      f.total_mes,
      f.total_pagar,
      f.monto_pagado,
      f.saldo_pendiente,
      f.fecha_vencimiento,
      now,
      now
    );
  }

  // 11. Multas y Rubros acumulados al corte de Julio
  const stmtMul = db.prepare(`
    INSERT OR REPLACE INTO multas_rubros (id, id_socio, id_periodo, tipo_rubro, monto, motivo, pagado, id_factura, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const m of seedData.multas_rubros) {
    stmtMul.run(
      m.id,
      m.id_socio,
      m.id_periodo,
      m.tipo_rubro,
      m.monto,
      m.motivo,
      m.pagado ? 1 : 0,
      m.id_factura || null,
      m.created_at
    );
  }

  db.exec('PRAGMA foreign_keys = ON;');
  console.log(`   ✅ Sincronizado exitosamente: ${targetFilePath}`);
}

function syncSQLite() {
  console.log('\n========================================');
  console.log(' [1/3] SINCRONIZANDO BASES SQLITE LOCALES');
  console.log('========================================');
  syncSingleSQLite(path.resolve('apps/server/data/app_agua.sqlite'));
  syncSingleSQLite(path.resolve('data/app_agua.sqlite'));
}

// ==============================================================================
// 2. SINCRONIZACIÓN CLOUD: Supabase REST API
// ==============================================================================
async function syncSupabase() {
  console.log('\n========================================');
  console.log(' [2/3] SINCRONIZANDO SUPABASE CLOUD (PostgreSQL)');
  console.log('========================================');
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('⚠️ Supabase no configurado en .env. Omitiendo sync remoto.');
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`
  };

  async function deleteTable(tableName) {
    console.log(`   - Vaciando tabla remota: ${tableName}...`);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?id=neq.00000000-0000-0000-0000-000000000000`, {
      method: 'DELETE',
      headers
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn(`     ⚠️ Aviso vaciando ${tableName} (${res.status}): ${txt}`);
    }
  }

  async function postBatch(endpoint, items, batchSize = 50) {
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
        method: 'POST',
        headers: {
          ...headers,
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify(chunk)
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Error en Supabase (${endpoint} - ${res.status}): ${txt}`);
      }
    }
  }

  // 1. Limpieza en orden inverso de claves foráneas
  console.log(' 🧹 1. Limpiando datos antiguos de Supabase...');
  await deleteTable('fondos_movimientos');
  await deleteTable('facturas');
  await deleteTable('multas_rubros');
  await deleteTable('lecturas');
  await deleteTable('medidores');
  await deleteTable('socios');
  await deleteTable('periodos');
  await deleteTable('sectores');

  // 2. Carga de sectores
  console.log(` 📤 2. Subiendo ${seedData.sectores.length} sectores...`);
  await postBatch('sectores', seedData.sectores);

  // 3. Carga de periodos
  console.log(` 📤 3. Subiendo ${seedData.periodos.length} periodos...`);
  await postBatch('periodos', seedData.periodos);

  // 4. Carga de socios
  console.log(` 📤 4. Subiendo ${seedData.socios.length} socios...`);
  const sociosPayload = seedData.socios.map(s => ({
    id: s.id,
    codigo_socio: s.codigo_socio,
    nombres: s.nombres,
    apellidos: s.apellidos,
    cedula_ruc: s.cedula_ruc,
    fecha_nacimiento: s.fecha_nacimiento,
    fecha_union: s.fecha_union,
    telefono: s.telefono,
    direccion: s.direccion,
    estado: s.estado,
    version: 1
  }));
  await postBatch('socios', sociosPayload);

  // 5. Carga de medidores
  console.log(` 📤 5. Subiendo ${seedData.medidores.length} medidores...`);
  const medidoresPayload = seedData.medidores.map(m => ({
    id: m.id,
    id_socio: m.id_socio,
    id_sector: m.id_sector,
    numero_medidor: m.numero_medidor,
    alias: m.alias,
    direccion: m.direccion,
    tiene_alcantarillado: m.tiene_alcantarillado,
    estado: m.estado,
    version: 1
  }));
  await postBatch('medidores', medidoresPayload);

  // 6. Carga de lecturas de corte
  console.log(` 📤 6. Subiendo ${seedData.lecturas.length} lecturas de corte...`);
  await postBatch('lecturas', seedData.lecturas);

  // 7. Carga de facturas
  console.log(` 📤 7. Subiendo ${seedData.facturas.length} facturas con deuda...`);
  const facturasPayload = seedData.facturas.map(f => ({
    id: f.id,
    numero_factura: f.numero_factura,
    id_socio: f.id_socio,
    id_medidor: f.id_medidor,
    id_periodo: f.id_periodo,
    id_lectura: f.id_lectura,
    es_tercera_edad: f.es_tercera_edad,
    valor_base: f.valor_base,
    consumo_m3: f.consumo_m3,
    excedente_m3: f.excedente_m3,
    valor_excedente: f.valor_excedente,
    valor_alcantarillado: f.valor_alcantarillado,
    valor_multas: f.valor_multas,
    valor_deuda_anterior: f.valor_deuda_anterior,
    total_mes: f.total_mes,
    total_pagar: f.total_pagar,
    estado_pago: f.estado_pago,
    fecha_vencimiento: f.fecha_vencimiento,
    version: f.version
  }));
  await postBatch('facturas', facturasPayload);

  // 8. Carga de multas
  console.log(` 📤 8. Subiendo ${seedData.multas_rubros.length} multas acumuladas...`);
  await postBatch('multas_rubros', seedData.multas_rubros);

  console.log('   ✅ Supabase Cloud sincronizado al 100% exitosamente.');
}

// ==============================================================================
// 3. EXPORTACIÓN DE SEMILLA OFFLINE PARA APP MÓVIL Y WEB DEMO
// ==============================================================================
function exportOfflineSeeds() {
  console.log('\n========================================');
  console.log(' [3/3] EXPORTANDO SEMILLA OFFLINE');
  console.log('========================================');

  const medidoresPorSocio = {};
  for (const m of seedData.medidores) {
    if (!medidoresPorSocio[m.id_socio]) medidoresPorSocio[m.id_socio] = [];
    medidoresPorSocio[m.id_socio].push({
      id: m.id,
      idMedidor: m.id,
      idSocio: m.id_socio,
      idSector: m.id_sector,
      numeroMedidor: m.numero_medidor,
      medidorNumero: m.numero_medidor,
      alias: m.alias,
      aliasMedidor: m.alias,
      lecturaInicial: m.lectura_inicial,
      lecturaAnterior: m.lectura_inicial,
      deudaPendiente: m.deuda_pendiente,
      estado: m.estado,
      tieneAlcantarillado: m.tiene_alcantarillado
    });
  }

  const socios = seedData.socios.map(s => {
    const meds = medidoresPorSocio[s.id] || [];
    const primaryMed = meds[0];
    return {
      id: s.id,
      codigoSocio: s.codigo_socio,
      nombres: s.nombres,
      apellidos: s.apellidos,
      nombreCompleto: `${s.nombres} ${s.apellidos}`.trim(),
      cedulaRuc: s.cedula_ruc,
      fechaNacimiento: s.fecha_nacimiento,
      fechaAfiliacion: s.fecha_union,
      telefono: s.telefono || '',
      direccion: s.direccion,
      sectorId: primaryMed ? primaryMed.idSector : s.id_sector,
      nombreSector: s.sector_nombre || 'Sector General',
      medidorNumero: primaryMed ? primaryMed.numeroMedidor : 'S/N',
      medidores: meds,
      tieneAlcantarillado: primaryMed ? primaryMed.tieneAlcantarillado : false,
      estadoServicio: s.estado,
      estadoCuenta: s.deuda_total_acumulada > 0 ? 'EN_MORA' : 'AL_DIA',
      mesesAdeudados: s.deuda_total_acumulada > 0 ? 1 : 0,
      montoTotalAdeudado: s.deuda_total_acumulada,
      updatedAt: now
    };
  });

  const seedPayload = {
    version: 5,
    periodoActivo: '2026-08',
    timestamp: now,
    sectores: seedData.sectores.map(s => ({
      id: s.id,
      codigo: s.codigo_sector,
      nombre: s.nombre_sector,
      descripcion: s.descripcion
    })),
    socios,
    medidores: seedData.medidores.map(m => ({
      id: m.id,
      id_socio: m.id_socio,
      id_sector: m.id_sector,
      numero_medidor: m.numero_medidor,
      alias: m.alias,
      direccion: m.direccion,
      tiene_alcantarillado: m.tiene_alcantarillado,
      estado: m.estado
    })),
    lecturas: seedData.lecturas
  };

  const demoPath = path.resolve('demo/offline_seed.json');
  fs.writeFileSync(demoPath, JSON.stringify(seedPayload, null, 2), 'utf8');
  console.log(`   ✅ Exportado a: ${demoPath}`);

  const apkAssetsPath = path.resolve('android-lector/app/src/main/assets/www/offline_seed.json');
  if (fs.existsSync(path.dirname(apkAssetsPath))) {
    fs.writeFileSync(apkAssetsPath, JSON.stringify(seedPayload, null, 2), 'utf8');
    console.log(`   ✅ Exportado a: ${apkAssetsPath}`);
  }
}

async function main() {
  try {
    syncSQLite();
    await syncSupabase();
    exportOfflineSeeds();
    console.log('\n🎉 ¡SINCRONIZACIÓN Y NORMALIZACIÓN COMPLETADA CON ÉXITO TOTAL!\n');
  } catch (err) {
    console.error('\n❌ ERROR DURANTE LA SINCRONIZACIÓN:', err);
    process.exit(1);
  }
}

main();
