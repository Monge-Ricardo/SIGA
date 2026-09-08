import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = path.resolve('apps/server/data/app_agua.sqlite');
if (!fs.existsSync(dbPath)) {
  console.error('Error: SQLite database does not exist at', dbPath);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

const sectores = db.prepare('SELECT id, codigo_sector as codigo, nombre_sector as nombre, descripcion FROM sectores WHERE activo = 1 ORDER BY codigo_sector ASC').all();
const medidoresRows = db.prepare(`
  SELECT m.*, s.codigo_socio, s.nombres, s.apellidos, s.cedula_ruc, sec.nombre_sector, sec.codigo_sector
  FROM medidores m
  JOIN socios s ON m.id_socio = s.id
  LEFT JOIN sectores sec ON m.id_sector = sec.id
  WHERE m.estado = 'ACTIVO'
  ORDER BY m.numero_medidor ASC
`).all();

const sociosRows = db.prepare(`
  SELECT s.*, sec.nombre_sector
  FROM socios s
  LEFT JOIN sectores sec ON s.id_sector = sec.id
  WHERE s.estado = 'ACTIVO'
  ORDER BY s.codigo_socio ASC
`).all();

const lecturasRows = db.prepare(`
  SELECT l.*, s.codigo_socio, s.nombres, s.apellidos, m.numero_medidor, m.alias as alias_medidor, sec.nombre_sector
  FROM lecturas l
  JOIN socios s ON l.id_socio = s.id
  LEFT JOIN medidores m ON l.id_medidor = m.id
  LEFT JOIN sectores sec ON m.id_sector = sec.id
  WHERE l.id_periodo = '33333333-0000-0000-0000-000000000001' OR l.id_periodo = '2026-08'
`).all();

// Mapear medidores por socio
const medidoresPorSocio = {};
for (const m of medidoresRows) {
  if (!medidoresPorSocio[m.id_socio]) medidoresPorSocio[m.id_socio] = [];
  medidoresPorSocio[m.id_socio].push({
    id: m.id,
    idMedidor: m.id,
    idSocio: m.id_socio,
    idSector: m.id_sector,
    numeroMedidor: m.numero_medidor,
    medidorNumero: m.numero_medidor,
    alias: m.alias || 'Casa principal',
    aliasMedidor: m.alias || 'Casa principal',
    lecturaInicial: m.lectura_inicial || 0,
    lecturaAnterior: m.lectura_inicial || 0,
    deudaPendiente: m.deuda_pendiente || 0,
    mesesAdeudados: m.meses_adeudados || 0,
    estado: m.estado,
    tieneAlcantarillado: Boolean(m.tiene_alcantarillado)
  });
}

const socios = sociosRows.map(s => {
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
    nombreSector: s.nombre_sector || 'Sector General',
    medidorNumero: primaryMed ? primaryMed.numeroMedidor : (s.medidor_numero || 'S/N'),
    medidores: meds,
    tieneAlcantarillado: primaryMed ? primaryMed.tieneAlcantarillado : Boolean(s.tiene_alcantarillado),
    estadoServicio: s.estado,
    estadoCuenta: 'AL_DIA',
    mesesAdeudados: 0,
    montoTotalAdeudado: 0,
    updatedAt: s.updated_at
  };
});

const lecturas = lecturasRows.map(l => ({
  id: l.id,
  id_medidor: l.id_medidor,
  id_socio: l.id_socio,
  id_periodo: '2026-08',
  periodo_codigo: '2026-08',
  lectura_anterior: l.lectura_anterior || 0,
  lectura_actual: l.lectura_actual || 0,
  consumo_total: l.consumo_total || 0,
  excedente_m3: l.excedente_m3 || 0,
  fecha_lectura: l.fecha_lectura,
  id_lector: l.id_lector,
  observaciones: l.observaciones,
  socio_codigo: l.codigo_socio,
  socio_nombre: `${l.nombres} ${l.apellidos}`.trim(),
  medidor_numero: l.numero_medidor,
  alias_medidor: l.alias_medidor,
  nombre_sector: l.nombre_sector
}));

const seedPayload = {
  version: 4,
  periodoActivo: '2026-08',
  timestamp: new Date().toISOString(),
  sectores,
  socios,
  medidores: medidoresRows.map(m => ({
    id: m.id,
    id_socio: m.id_socio,
    id_sector: m.id_sector,
    numero_medidor: m.numero_medidor,
    alias: m.alias,
    direccion: m.direccion,
    tiene_alcantarillado: Boolean(m.tiene_alcantarillado),
    estado: m.estado
  })),
  lecturas
};

const demoPath = path.resolve('demo/offline_seed.json');
fs.writeFileSync(demoPath, JSON.stringify(seedPayload, null, 2), 'utf8');
console.log(`✅ Seed exportado a demo/offline_seed.json: ${socios.length} socios, ${medidoresRows.length} medidores, ${lecturas.length} lecturas.`);

const apkAssetsPath = path.resolve('android-lector/app/src/main/assets/www/offline_seed.json');
if (fs.existsSync(path.dirname(apkAssetsPath))) {
  fs.writeFileSync(apkAssetsPath, JSON.stringify(seedPayload, null, 2), 'utf8');
  console.log(`✅ Seed exportado a ${apkAssetsPath}`);
}
