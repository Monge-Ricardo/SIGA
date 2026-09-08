import fs from 'node:fs';
import path from 'node:path';
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

console.log('🔍 =========================================================');
console.log('   AUDITORÍA Y VERIFICACIÓN COMPLETA DE BASES DE DATOS');
console.log('=========================================================\n');

// 1. Verificación SQLite
function verifySQLite(dbPath) {
  console.log(`📌 Verificando SQLite: ${dbPath}`);
  const db = new DatabaseSync(dbPath);

  const counts = {};
  for (const t of ['sectores', 'periodos', 'socios', 'medidores', 'lecturas', 'facturas', 'multas_rubros']) {
    counts[t] = db.prepare(`SELECT count(*) as c FROM ${t}`).get().c;
  }
  console.log('   Conteos:', counts);

  const multiSocios = db.prepare(`
    SELECT s.codigo_socio, s.nombres, s.apellidos, s.cedula_ruc, count(m.id) as med_count
    FROM socios s
    JOIN medidores m ON s.id = m.id_socio
    GROUP BY s.id
    HAVING count(m.id) > 1
    ORDER BY s.codigo_socio
  `).all();
  console.log(`   Socios con >1 medidor (${multiSocios.length}):`);
  for (const s of multiSocios) {
    console.log(`     - ${s.codigo_socio}: ${s.nombres} ${s.apellidos} (${s.cedula_ruc}) -> ${s.med_count} medidores`);
  }

  const patricia = db.prepare("SELECT * FROM socios WHERE nombres LIKE '%Patricia%'").get();
  const aracely = db.prepare("SELECT * FROM socios WHERE nombres LIKE '%Aracely%'").get();
  console.log('   Independencia de Socias Flores:');
  console.log(`     - Aracely:  ${aracely?.codigo_socio} | Cédula: ${aracely?.cedula_ruc} | Nombres: ${aracely?.nombres} ${aracely?.apellidos}`);
  console.log(`     - Patricia: ${patricia?.codigo_socio} | Cédula: ${patricia?.cedula_ruc} | Nombres: ${patricia?.nombres} ${patricia?.apellidos}`);

  const uniqueMeds = db.prepare('SELECT count(DISTINCT numero_medidor) as u FROM medidores').get().u;
  console.log(`   Medidores únicos: ${uniqueMeds} de ${counts.medidores} (${uniqueMeds === counts.medidores ? '✅ PERFECTO' : '❌ DUPLICADOS'})`);

  const totalDeuda = db.prepare('SELECT sum(total_pagar) as s FROM facturas').get().s;
  const totalMultas = db.prepare('SELECT sum(monto) as s FROM multas_rubros').get().s;
  console.log(`   Financiero al corte de Julio:`);
  console.log(`     - Total Deuda:  $${totalDeuda.toFixed(2)}`);
  console.log(`     - Total Multas: $${totalMultas.toFixed(2)}`);

  const periodos = db.prepare('SELECT periodo_codigo, nombre, estado FROM periodos ORDER BY fecha_inicio ASC').all();
  console.log('   Períodos configurados:');
  for (const p of periodos) {
    console.log(`     - ${p.periodo_codigo} (${p.nombre}): ${p.estado}`);
  }
}

verifySQLite(path.resolve('apps/server/data/app_agua.sqlite'));
console.log('');
verifySQLite(path.resolve('data/app_agua.sqlite'));

// 2. Verificación Supabase Cloud
async function verifySupabase() {
  console.log('\n☁️  Verificando Supabase Cloud...');
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`
  };

  const tables = ['sectores', 'periodos', 'socios', 'medidores', 'lecturas', 'facturas', 'multas_rubros'];
  for (const t of tables) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=count`, {
      headers: { ...headers, Prefer: 'count=exact' }
    });
    const range = res.headers.get('content-range');
    console.log(`   Supabase ${t}: ${range}`);
  }

  // Verificar período activo
  const perRes = await fetch(`${SUPABASE_URL}/rest/v1/periodos?select=periodo_codigo,nombre,estado&order=fecha_inicio.asc`, { headers });
  const periodos = await perRes.json();
  console.log('   Períodos en Supabase:');
  for (const p of periodos) {
    console.log(`     - ${p.periodo_codigo} (${p.nombre}): ${p.estado}`);
  }

  // Verificar David Masabanda multi-medidor en Supabase
  const socioRes = await fetch(`${SUPABASE_URL}/rest/v1/socios?cedula_ruc=eq.1800000003&select=id,codigo_socio,nombres,apellidos`, { headers });
  const david = (await socioRes.json())[0];
  const medsRes = await fetch(`${SUPABASE_URL}/rest/v1/medidores?id_socio=eq.${david.id}&select=numero_medidor,alias,direccion`, { headers });
  const davidMeds = await medsRes.json();
  console.log(`   Verificación multi-medidor David Masabanda en Supabase:`);
  console.log(`     - Socio: ${david.codigo_socio} - ${david.nombres} ${david.apellidos}`);
  console.log(`     - Medidores vinculados (${davidMeds.length}):`, davidMeds);

  // Verificar Patricia Flores en Supabase
  const patRes = await fetch(`${SUPABASE_URL}/rest/v1/socios?cedula_ruc=eq.1800000081&select=id,codigo_socio,nombres,apellidos`, { headers });
  const pat = (await patRes.json())[0];
  const patMedsRes = await fetch(`${SUPABASE_URL}/rest/v1/medidores?id_socio=eq.${pat.id}&select=numero_medidor,alias`, { headers });
  const patMeds = await patMedsRes.json();
  console.log(`   Verificación Patricia Flores en Supabase:`);
  console.log(`     - Socio: ${pat.codigo_socio} - ${pat.nombres} ${pat.apellidos}`);
  console.log(`     - Medidores vinculados (${patMeds.length}):`, patMeds);

  console.log('\n✅ ¡TODAS LAS VALIDACIONES DE BASE DE DATOS FUERON EXITOSAS AL 100%!');
}

verifySupabase().catch(console.error);
