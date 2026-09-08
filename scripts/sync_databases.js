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

const data = JSON.parse(fs.readFileSync(path.resolve('scripts/migracion_data.json'), 'utf8'));

console.log('🚀 Iniciando sincronización dual de bases de datos: SQLite Local & Supabase Cloud...');
console.log(`📊 Datos a sincronizar: ${data.sectores.length} Sectores, ${data.socios.length} Socios, ${data.medidores.length} Medidores.`);

const PERIODO_ID = '33333333-0000-0000-0000-000000000001';
const PERIODO_CODIGO = '2026-08';
const PERIODO_NOMBRE = 'Agosto 2026';
const ADMIN_ID = '00000000-0000-0000-0000-000000000001';

// Mapeo del primer medidor por socio para retrocompatibilidad
const socioPrimerMedidor = {};
for (const m of data.medidores) {
  if (!socioPrimerMedidor[m.id_socio]) {
    socioPrimerMedidor[m.id_socio] = m;
  }
}

// ==============================================================================
// 1. SINCRONIZACIÓN LOCAL: SQLite
// ==============================================================================
function syncSQLite() {
  console.log('\n📦 [1/2] Sincronizando SQLite Local (apps/server/data/app_agua.sqlite)...');
  const dataDir = path.resolve('apps/server/data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, 'app_agua.sqlite');
  const db = new DatabaseSync(dbPath);

  db.exec('PRAGMA foreign_keys = OFF;');

  // Limpiar tablas para sincronización exacta 1:1 con Supabase
  db.exec(`
    DELETE FROM facturas;
    DELETE FROM lecturas;
    DELETE FROM medidores;
    DELETE FROM socios;
    DELETE FROM sectores WHERE codigo_sector NOT IN ('SEC-PASO', 'SEC-SANJOSE', 'SEC-CENTRO', 'SEC-SANANTONIO');
  `);

  const now = new Date().toISOString();

  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha256').toString('hex');
    return `${salt}:${hash}`;
  }

  // 1. Usuarios default
  const stmtUser = db.prepare(`
    INSERT OR REPLACE INTO usuarios (id, username, password_hash, nombre_completo, rol, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);
  stmtUser.run('00000000-0000-0000-0000-000000000001', 'admin', hashPassword('Admin123*'), 'Carlos Morales (Administrador)', 'ADMIN', now, now);
  stmtUser.run('00000000-0000-0000-0000-000000000002', 'cajero', hashPassword('Cajero123*'), 'Gladys Guamán (Tesorera / Cajera)', 'CAJERO', now, now);
  stmtUser.run('00000000-0000-0000-0000-000000000003', 'lector', hashPassword('Lector123*'), 'Manuel Tacuri (Lector de Campo)', 'LECTOR', now, now);

  // 2. Sectores
  const stmtSector = db.prepare(`
    INSERT OR REPLACE INTO sectores (id, codigo_sector, nombre_sector, descripcion, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);
  for (const s of data.sectores) {
    stmtSector.run(s.id, s.codigo_sector, s.nombre_sector, s.descripcion, now, now);
  }

  // 3. Tarifas Config
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

  // 4. Periodo
  const stmtPer = db.prepare(`
    INSERT OR REPLACE INTO periodos (id, periodo_codigo, nombre, fecha_inicio, fecha_fin, estado, created_at)
    VALUES (?, ?, ?, '2026-08-01', '2026-08-31', 'ABIERTO', ?)
  `);
  stmtPer.run(PERIODO_ID, PERIODO_CODIGO, PERIODO_NOMBRE, now);

  // 5. Fondos Catálogo
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

  // 6. Socios
  const stmtSocio = db.prepare(`
    INSERT OR REPLACE INTO socios (
      id, codigo_socio, nombres, apellidos, cedula_ruc, 
      fecha_nacimiento, fecha_union, id_sector, medidor_numero, tiene_alcantarillado,
      telefono, direccion, estado, version, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  for (const socio of data.socios) {
    const primerMed = socioPrimerMedidor[socio.id] || {};
    stmtSocio.run(
      socio.id,
      socio.codigo_socio,
      socio.nombres,
      socio.apellidos,
      socio.cedula_ruc,
      socio.fecha_nacimiento,
      socio.fecha_union,
      primerMed.id_sector || data.sectores[0].id,
      primerMed.numero_medidor || 'MED-0000',
      primerMed.tiene_alcantarillado ? 1 : 0,
      socio.telefono,
      socio.direccion,
      socio.estado,
      now,
      now
    );
  }

  // 7. Medidores (Acometidas)
  const stmtMed = db.prepare(`
    INSERT OR REPLACE INTO medidores (id, id_socio, id_sector, numero_medidor, alias, direccion, tiene_alcantarillado, estado, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  for (const m of data.medidores) {
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

  // 8. Lecturas de Base Inicial
  const stmtLec = db.prepare(`
    INSERT OR REPLACE INTO lecturas (id, id_medidor, id_socio, id_periodo, lectura_anterior, lectura_actual, consumo_total, excedente_m3, fecha_lectura, id_lector, observaciones, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  for (const m of data.medidores) {
    const lecturaId = `lec-init-${m.numero_medidor}`;
    stmtLec.run(
      lecturaId,
      m.id,
      m.id_socio,
      PERIODO_ID,
      m.lectura_inicial,
      m.lectura_inicial,
      0.0,
      0.0,
      now,
      ADMIN_ID,
      'Lectura inicial migrada desde padrón',
      now,
      now
    );
  }

  // 9. Facturas Iniciales para socios con mora
  const stmtFac = db.prepare(`
    INSERT OR REPLACE INTO facturas (id, numero_factura, id_socio, id_medidor, id_periodo, id_lectura, es_tercera_edad, valor_base, consumo_m3, excedente_m3, valor_excedente, valor_alcantarillado, valor_multas, valor_deuda_anterior, total_mes, total_pagar, estado_pago, fecha_vencimiento, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', '2026-09-15', 1, ?, ?)
  `);
  let facCount = 0;
  for (const m of data.medidores) {
    if (m.deuda_pendiente > 0) {
      facCount++;
      const facId = `fac-deuda-${m.numero_medidor}`;
      const facNum = `FAC-MIG-${m.numero_medidor}`;
      stmtFac.run(
        facId,
        facNum,
        m.id_socio,
        m.id,
        PERIODO_ID,
        `lec-init-${m.numero_medidor}`,
        0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        m.deuda_pendiente,
        0.0,
        m.deuda_pendiente,
        now,
        now
      );
    }
  }

  db.exec('PRAGMA foreign_keys = ON;');
  console.log(`✅ SQLite actualizado exitosamente: ${data.socios.length} Socios, ${data.medidores.length} Medidores, ${data.medidores.length} Lecturas Base, ${facCount} Facturas en Mora.`);
}

// ==============================================================================
// 2. SINCRONIZACIÓN CLOUD: Supabase REST API
// ==============================================================================
async function syncSupabase() {
  console.log('\n☁️  [2/2] Sincronizando Supabase Cloud (PostgreSQL)...');
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'resolution=merge-duplicates'
  };

  async function postData(endpoint, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error en Supabase (${endpoint} - ${res.status}): ${errText}`);
    }
  }

  // 1. Sectores
  console.log(' - Subiendo sectores...');
  await postData('sectores', data.sectores);

  // 2. Periodo
  console.log(' - Subiendo periodo actual...');
  await postData('periodos', [{
    id: PERIODO_ID,
    periodo_codigo: PERIODO_CODIGO,
    nombre: PERIODO_NOMBRE,
    fecha_inicio: '2026-08-01',
    fecha_fin: '2026-08-31',
    estado: 'ABIERTO'
  }]);

  // 3. Socios (en lotes de 50)
  console.log(` - Subiendo ${data.socios.length} socios...`);
  const sociosPayload = data.socios.map(s => ({
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
  for (let i = 0; i < sociosPayload.length; i += 50) {
    await postData('socios', sociosPayload.slice(i, i + 50));
  }

  // 4. Medidores (en lotes de 50)
  console.log(` - Subiendo ${data.medidores.length} medidores acometidas...`);
  const medidoresPayload = data.medidores.map(m => ({
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
  for (let i = 0; i < medidoresPayload.length; i += 50) {
    await postData('medidores', medidoresPayload.slice(i, i + 50));
  }

  // 5. Lecturas de Base Inicial
  console.log(` - Subiendo ${data.medidores.length} lecturas base...`);

  const lecturasPayload = data.medidores.map((m, idx) => {
    const pseudoId = `44444444-0000-0000-0000-${String(idx + 1).padStart(12, '0')}`;
    return {
      id: pseudoId,
      id_medidor: m.id,
      id_socio: m.id_socio,
      id_periodo: PERIODO_ID,
      lectura_anterior: m.lectura_inicial,
      lectura_actual: m.lectura_inicial,
      consumo_total: 0.0,
      excedente_m3: 0.0,
      id_lector: ADMIN_ID,
      observaciones: 'Lectura inicial migrada desde padrón',
      version: 1
    };
  });
  for (let i = 0; i < lecturasPayload.length; i += 50) {
    await postData('lecturas', lecturasPayload.slice(i, i + 50));
  }

  // 6. Facturas Iniciales para socios con mora
  console.log(' - Subiendo facturas de deudas pendientes...');
  const facturasPayload = [];
  let facIdx = 0;
  for (const m of data.medidores) {
    if (m.deuda_pendiente > 0) {
      facIdx++;
      const facId = `55555555-0000-0000-0000-${String(facIdx).padStart(12, '0')}`;
      facturasPayload.push({
        id: facId,
        numero_factura: `FAC-MIG-${m.numero_medidor}`,
        id_socio: m.id_socio,
        id_medidor: m.id,
        id_periodo: PERIODO_ID,
        es_tercera_edad: false,
        valor_base: 0.0,
        consumo_m3: 0.0,
        excedente_m3: 0.0,
        valor_excedente: 0.0,
        valor_alcantarillado: 0.0,
        valor_multas: 0.0,
        valor_deuda_anterior: m.deuda_pendiente,
        total_mes: 0.0,
        total_pagar: m.deuda_pendiente,
        estado_pago: 'PENDIENTE',
        fecha_vencimiento: '2026-09-15',
        version: 1
      });
    }
  }
  for (let i = 0; i < facturasPayload.length; i += 50) {
    await postData('facturas', facturasPayload.slice(i, i + 50));
  }

  console.log(`✅ Supabase Cloud sincronizado exitosamente al 100%!`);
}

async function main() {
  try {
    syncSQLite();
    await syncSupabase();
    console.log('\n🎉 ¡SINCRONIZACIÓN DUAL COMPLETADA CON ÉXITO TOTAL!');
  } catch (err) {
    console.error('\n❌ ERROR DURANTE LA SINCRONIZACIÓN:', err.message);
    process.exit(1);
  }
}

main();
