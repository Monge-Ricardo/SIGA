import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { hashPassword } from '../utils/security.ts';

export class SQLiteDatabase {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.dbPath = customPath;
    } else {
      const dataDir = path.resolve(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      this.dbPath = path.join(dataDir, 'app_agua.sqlite');
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
    this.seedDefaultData();
  }

  public getRawDb(): DatabaseSync {
    return this.db;
  }

  private initSchema(): void {
    this.db.exec('PRAGMA foreign_keys = ON;');

    this.db.exec(`
      -- 1. Usuarios
      CREATE TABLE IF NOT EXISTS usuarios (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        nombre_completo TEXT NOT NULL,
        rol TEXT NOT NULL CHECK(rol IN ('ADMIN', 'CAJERO', 'LECTOR', 'AUDITOR')),
        activo INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- 2. Sectores
      CREATE TABLE IF NOT EXISTS sectores (
        id TEXT PRIMARY KEY,
        codigo_sector TEXT UNIQUE NOT NULL,
        nombre_sector TEXT NOT NULL,
        descripcion TEXT,
        activo INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- 3. Tarifas Config
      CREATE TABLE IF NOT EXISTS tarifas_config (
        id TEXT PRIMARY KEY,
        cargo_fijo_normal REAL NOT NULL DEFAULT 7.00,
        cargo_fijo_tercera_edad REAL NOT NULL DEFAULT 5.00,
        limite_base_m3 REAL NOT NULL DEFAULT 30.00,
        costo_excedente_m3 REAL NOT NULL DEFAULT 0.10,
        recargo_alcantarillado REAL NOT NULL DEFAULT 1.00,
        reparto_normal_padre REAL NOT NULL DEFAULT 2.00,
        reparto_normal_operacion REAL NOT NULL DEFAULT 4.00,
        reparto_normal_lector REAL NOT NULL DEFAULT 0.50,
        reparto_normal_mortuorio REAL NOT NULL DEFAULT 0.50,
        activo INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      -- 4. Socios (Titulares / Abonados)
      CREATE TABLE IF NOT EXISTS socios (
        id TEXT PRIMARY KEY,
        codigo_socio TEXT UNIQUE NOT NULL,
        nombres TEXT NOT NULL,
        apellidos TEXT NOT NULL,
        cedula_ruc TEXT UNIQUE NOT NULL,
        fecha_nacimiento TEXT NOT NULL,
        fecha_union TEXT NOT NULL,
        id_sector TEXT,
        medidor_numero TEXT,
        tiene_alcantarillado INTEGER NOT NULL DEFAULT 0,
        telefono TEXT,
        direccion TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'ACTIVO' CHECK(estado IN ('ACTIVO', 'SUSPENDIDO', 'CORTADO')),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (id_sector) REFERENCES sectores(id)
      );

      CREATE INDEX IF NOT EXISTS idx_socios_sector ON socios(id_sector);
      CREATE INDEX IF NOT EXISTS idx_socios_estado ON socios(estado);

      -- 5. Medidores (Acometidas de Agua - 1 Socio : N Medidores)
      CREATE TABLE IF NOT EXISTS medidores (
        id TEXT PRIMARY KEY,
        id_socio TEXT NOT NULL,
        id_sector TEXT NOT NULL,
        numero_medidor TEXT UNIQUE NOT NULL,
        alias TEXT,
        direccion TEXT,
        tiene_alcantarillado INTEGER NOT NULL DEFAULT 0,
        estado TEXT NOT NULL DEFAULT 'ACTIVO' CHECK(estado IN ('ACTIVO', 'SUSPENDIDO', 'CORTADO')),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (id_socio) REFERENCES socios(id) ON DELETE CASCADE,
        FOREIGN KEY (id_sector) REFERENCES sectores(id)
      );

      CREATE INDEX IF NOT EXISTS idx_medidores_socio ON medidores(id_socio);
      CREATE INDEX IF NOT EXISTS idx_medidores_sector ON medidores(id_sector);

      -- 6. Periodos
      CREATE TABLE IF NOT EXISTS periodos (
        id TEXT PRIMARY KEY,
        periodo_codigo TEXT UNIQUE NOT NULL,
        nombre TEXT NOT NULL,
        fecha_inicio TEXT NOT NULL,
        fecha_fin TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'ABIERTO' CHECK(estado IN ('ABIERTO', 'CERRADO', 'FACTURADO')),
        created_at TEXT NOT NULL
      );

      -- 7. Lecturas
      CREATE TABLE IF NOT EXISTS lecturas (
        id TEXT PRIMARY KEY,
        id_medidor TEXT,
        id_socio TEXT NOT NULL,
        id_periodo TEXT NOT NULL,
        lectura_anterior REAL NOT NULL,
        lectura_actual REAL NOT NULL,
        consumo_total REAL NOT NULL,
        excedente_m3 REAL NOT NULL,
        fecha_lectura TEXT NOT NULL,
        id_lector TEXT NOT NULL,
        observaciones TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (id_medidor) REFERENCES medidores(id),
        FOREIGN KEY (id_socio) REFERENCES socios(id),
        FOREIGN KEY (id_periodo) REFERENCES periodos(id),
        FOREIGN KEY (id_lector) REFERENCES usuarios(id)
      );

      CREATE INDEX IF NOT EXISTS idx_lecturas_periodo ON lecturas(id_periodo);
      CREATE INDEX IF NOT EXISTS idx_lecturas_socio ON lecturas(id_socio);

      -- 7. Multas y Rubros
      CREATE TABLE IF NOT EXISTS multas_rubros (
        id TEXT PRIMARY KEY,
        id_socio TEXT NOT NULL,
        id_periodo TEXT,
        tipo_rubro TEXT NOT NULL CHECK(tipo_rubro IN ('MINGA', 'ASAMBLEA', 'RECONEXION', 'CUOTA_EXTRA', 'OTRO')),
        monto REAL NOT NULL,
        motivo TEXT NOT NULL,
        pagado INTEGER NOT NULL DEFAULT 0,
        id_factura TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (id_socio) REFERENCES socios(id),
        FOREIGN KEY (id_periodo) REFERENCES periodos(id)
      );

      CREATE INDEX IF NOT EXISTS idx_multas_socio_pagado ON multas_rubros(id_socio, pagado);

      -- 8. Facturas
      CREATE TABLE IF NOT EXISTS facturas (
        id TEXT PRIMARY KEY,
        numero_factura TEXT UNIQUE NOT NULL,
        id_socio TEXT NOT NULL,
        id_medidor TEXT,
        id_periodo TEXT NOT NULL,
        id_lectura TEXT,
        es_tercera_edad INTEGER NOT NULL DEFAULT 0,
        valor_base REAL NOT NULL,
        consumo_m3 REAL NOT NULL,
        excedente_m3 REAL NOT NULL,
        valor_excedente REAL NOT NULL,
        valor_alcantarillado REAL NOT NULL,
        valor_multas REAL NOT NULL DEFAULT 0.0,
        valor_deuda_anterior REAL NOT NULL DEFAULT 0.0,
        total_mes REAL NOT NULL,
        total_pagar REAL NOT NULL,
        estado_pago TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK(estado_pago IN ('PENDIENTE', 'PAGADO', 'ANULADO')),
        fecha_vencimiento TEXT NOT NULL,
        fecha_pago TEXT,
        metodo_pago TEXT CHECK(metodo_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'MOVIL')),
        id_cajero TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (id_socio) REFERENCES socios(id),
        FOREIGN KEY (id_medidor) REFERENCES medidores(id),
        FOREIGN KEY (id_periodo) REFERENCES periodos(id),
        FOREIGN KEY (id_lectura) REFERENCES lecturas(id),
        FOREIGN KEY (id_cajero) REFERENCES usuarios(id)
      );

      CREATE INDEX IF NOT EXISTS idx_facturas_socio_estado ON facturas(id_socio, estado_pago);
      CREATE INDEX IF NOT EXISTS idx_facturas_periodo ON facturas(id_periodo);

      -- 9. Catálogo de Fondos
      CREATE TABLE IF NOT EXISTS fondos_catalogo (
        id TEXT PRIMARY KEY,
        codigo TEXT UNIQUE NOT NULL,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        activo INTEGER NOT NULL DEFAULT 1
      );

      -- 10. Movimientos de Fondos (Libro Mayor 3 Columnas)
      CREATE TABLE IF NOT EXISTS fondos_movimientos (
        id TEXT PRIMARY KEY,
        id_fondo TEXT NOT NULL,
        fecha TEXT NOT NULL,
        concepto TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK(tipo IN ('INGRESO', 'EGRESO')),
        ingreso REAL NOT NULL DEFAULT 0.0,
        egreso REAL NOT NULL DEFAULT 0.0,
        saldo REAL NOT NULL,
        id_factura TEXT,
        numero_comprobante TEXT,
        id_responsable TEXT NOT NULL,
        beneficiario TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (id_fondo) REFERENCES fondos_catalogo(id),
        FOREIGN KEY (id_factura) REFERENCES facturas(id),
        FOREIGN KEY (id_responsable) REFERENCES usuarios(id)
      );

      CREATE INDEX IF NOT EXISTS idx_fondos_mov_fondo_fecha ON fondos_movimientos(id_fondo, fecha);
    `);

    // Migraciones de esquema para bases de datos existentes
    try {
      this.db.exec('ALTER TABLE lecturas ADD COLUMN id_medidor TEXT REFERENCES medidores(id);');
    } catch {}
    try {
      this.db.exec('ALTER TABLE facturas ADD COLUMN id_medidor TEXT REFERENCES medidores(id);');
    } catch {}
    try {
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_lecturas_medidor_periodo ON lecturas(id_medidor, id_periodo);');
    } catch {}
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_facturas_medidor ON facturas(id_medidor);');
    } catch {}

    this.migrateMedidores();
    try {
      this.db.exec("UPDATE lecturas SET id_medidor = (SELECT id FROM medidores WHERE medidores.id_socio = lecturas.id_socio LIMIT 1) WHERE id_medidor IS NULL OR id_medidor = '';");
    } catch {}

    this.migrateLecturasUniqueConstraint();
    this.migrateFacturasUniqueConstraint();
  }

  private migrateLecturasUniqueConstraint(): void {
    const tableSql = (
      this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='lecturas'").get() as { sql?: string }
    )?.sql || '';

    if (tableSql.includes('id_socio, id_periodo') || tableSql.includes('id_socio,id_periodo')) {
      this.db.exec('PRAGMA foreign_keys = OFF;');
      this.db.exec(`
        CREATE TABLE lecturas_multimedidor (
          id TEXT PRIMARY KEY,
          id_medidor TEXT,
          id_socio TEXT NOT NULL,
          id_periodo TEXT NOT NULL,
          lectura_anterior REAL NOT NULL,
          lectura_actual REAL NOT NULL,
          consumo_total REAL NOT NULL,
          excedente_m3 REAL NOT NULL,
          fecha_lectura TEXT NOT NULL,
          id_lector TEXT NOT NULL,
          observaciones TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(id_medidor, id_periodo),
          FOREIGN KEY (id_medidor) REFERENCES medidores(id),
          FOREIGN KEY (id_socio) REFERENCES socios(id),
          FOREIGN KEY (id_periodo) REFERENCES periodos(id),
          FOREIGN KEY (id_lector) REFERENCES usuarios(id)
        );

        INSERT INTO lecturas_multimedidor (
          id, id_medidor, id_socio, id_periodo, lectura_anterior, lectura_actual,
          consumo_total, excedente_m3, fecha_lectura, id_lector, observaciones, version, created_at, updated_at
        )
        SELECT 
          l.id, 
          COALESCE(l.id_medidor, (SELECT m.id FROM medidores m WHERE m.id_socio = l.id_socio LIMIT 1)),
          l.id_socio, 
          l.id_periodo, 
          l.lectura_anterior, 
          l.lectura_actual, 
          l.consumo_total, 
          l.excedente_m3, 
          l.fecha_lectura, 
          l.id_lector, 
          l.observaciones, 
          l.version, 
          l.created_at, 
          l.updated_at
        FROM lecturas l;

        DROP TABLE lecturas;
        ALTER TABLE lecturas_multimedidor RENAME TO lecturas;

        CREATE INDEX IF NOT EXISTS idx_lecturas_medidor ON lecturas(id_medidor);
        CREATE INDEX IF NOT EXISTS idx_lecturas_periodo ON lecturas(id_periodo);
        CREATE INDEX IF NOT EXISTS idx_lecturas_socio ON lecturas(id_socio);
      `);
      this.db.exec('PRAGMA foreign_keys = ON;');
      console.log('✅ [SQLite] Tabla lecturas migrada a UNIQUE(id_medidor, id_periodo) para multi-medidor.');
    }
  }

  private migrateFacturasUniqueConstraint(): void {
    const tableSql = (
      this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='facturas'").get() as { sql?: string }
    )?.sql || '';

    if (tableSql.includes('id_socio, id_periodo') || tableSql.includes('id_socio,id_periodo')) {
      this.db.exec('PRAGMA foreign_keys = OFF;');
      this.db.exec(`
        CREATE TABLE facturas_multimedidor (
          id TEXT PRIMARY KEY,
          numero_factura TEXT UNIQUE NOT NULL,
          id_socio TEXT NOT NULL,
          id_medidor TEXT,
          id_periodo TEXT NOT NULL,
          id_lectura TEXT,
          es_tercera_edad INTEGER NOT NULL DEFAULT 0,
          valor_base REAL NOT NULL,
          consumo_m3 REAL NOT NULL,
          excedente_m3 REAL NOT NULL,
          valor_excedente REAL NOT NULL,
          valor_alcantarillado REAL NOT NULL,
          valor_multas REAL NOT NULL DEFAULT 0.0,
          valor_deuda_anterior REAL NOT NULL DEFAULT 0.0,
          total_mes REAL NOT NULL,
          total_pagar REAL NOT NULL,
          estado_pago TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK(estado_pago IN ('PENDIENTE', 'PAGADO', 'ANULADO')),
          fecha_vencimiento TEXT NOT NULL,
          fecha_pago TEXT,
          metodo_pago TEXT CHECK(metodo_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'MOVIL')),
          id_cajero TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (id_socio) REFERENCES socios(id),
          FOREIGN KEY (id_medidor) REFERENCES medidores(id),
          FOREIGN KEY (id_periodo) REFERENCES periodos(id),
          FOREIGN KEY (id_lectura) REFERENCES lecturas(id),
          FOREIGN KEY (id_cajero) REFERENCES usuarios(id)
        );

        INSERT INTO facturas_multimedidor (
          id, numero_factura, id_socio, id_medidor, id_periodo, id_lectura,
          es_tercera_edad, valor_base, consumo_m3, excedente_m3, valor_excedente,
          valor_alcantarillado, valor_multas, valor_deuda_anterior, total_mes,
          total_pagar, estado_pago, fecha_vencimiento, fecha_pago, metodo_pago,
          id_cajero, version, created_at, updated_at
        )
        SELECT 
          f.id, f.numero_factura, f.id_socio, f.id_medidor, f.id_periodo, f.id_lectura,
          f.es_tercera_edad, f.valor_base, f.consumo_m3, f.excedente_m3, f.valor_excedente,
          f.valor_alcantarillado, f.valor_multas, f.valor_deuda_anterior, f.total_mes,
          f.total_pagar, f.estado_pago, f.fecha_vencimiento, f.fecha_pago, f.metodo_pago,
          f.id_cajero, f.version, f.created_at, f.updated_at
        FROM facturas f;

        DROP TABLE facturas;
        ALTER TABLE facturas_multimedidor RENAME TO facturas;

        CREATE INDEX IF NOT EXISTS idx_facturas_socio_estado ON facturas(id_socio, estado_pago);
        CREATE INDEX IF NOT EXISTS idx_facturas_medidor ON facturas(id_medidor);
        CREATE INDEX IF NOT EXISTS idx_facturas_periodo ON facturas(id_periodo);
      `);
      this.db.exec('PRAGMA foreign_keys = ON;');
      console.log('✅ [SQLite] Tabla facturas migrada para soportar múltiples medidores.');
    }
  }

  private migrateMedidores(): void {
    const medidorCount = (this.db.prepare('SELECT COUNT(*) as count FROM medidores').get() as { count: number }).count;
    if (medidorCount === 0) {
      const socios = this.db.prepare('SELECT id, id_sector, medidor_numero, direccion, tiene_alcantarillado FROM socios').all() as any[];
      if (socios && socios.length > 0) {
        const now = new Date().toISOString();
        const insertMed = this.db.prepare(`
          INSERT INTO medidores (id, id_socio, id_sector, numero_medidor, alias, direccion, tiene_alcantarillado, estado, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'Casa principal', ?, ?, 'ACTIVO', 1, ?, ?)
        `);

        for (const s of socios) {
          if (s.medidor_numero && s.id_sector) {
            const medId = crypto.randomUUID();
            try {
              insertMed.run(medId, s.id, s.id_sector, s.medidor_numero, s.direccion || '', s.tiene_alcantarillado ? 1 : 0, now, now);
              this.db.prepare("UPDATE lecturas SET id_medidor = ? WHERE id_socio = ? AND (id_medidor IS NULL OR id_medidor = '')").run(medId, s.id);
            } catch (err: any) {
              console.warn('[SQLite] Aviso migrando medidor:', err.message);
            }
          }
        }
        console.log(`✅ [SQLite] Migrados ${socios.length} medidores existentes a tabla medidores.`);
      }
    }
  }

  private seedDefaultData(): void {
    const now = new Date().toISOString();

    // 1. Usuarios por defecto
    const userCount = this.db.prepare('SELECT COUNT(*) as count FROM usuarios').get() as { count: number };
    if (userCount.count === 0) {
      const insertUser = this.db.prepare(`
        INSERT INTO usuarios (id, username, password_hash, nombre_completo, rol, activo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `);

      insertUser.run(crypto.randomUUID(), 'admin', hashPassword('Admin123*'), 'Administrador Directiva', 'ADMIN', now, now);
      insertUser.run(crypto.randomUUID(), 'cajero', hashPassword('Cajero123*'), 'Tesorero / Cobrador General', 'CAJERO', now, now);
      insertUser.run(crypto.randomUUID(), 'lector', hashPassword('Lector123*'), 'Operador de Micromedición', 'LECTOR', now, now);
      console.log('✅ [SQLite] Usuarios iniciales sembrados (admin, cajero, lector).');
    }

    // 2. Sectores por defecto
    const sectorCount = this.db.prepare('SELECT COUNT(*) as count FROM sectores').get() as { count: number };
    if (sectorCount.count === 0) {
      const insertSector = this.db.prepare(`
        INSERT INTO sectores (id, codigo_sector, nombre_sector, descripcion, activo, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `);

      insertSector.run(crypto.randomUUID(), 'SEC-01', 'Sector Centro', 'Zona central comunitaria y parroquial', now, now);
      insertSector.run(crypto.randomUUID(), 'SEC-02', 'Sector La Loma', 'Zona alta con bombeo secundario', now, now);
      insertSector.run(crypto.randomUUID(), 'SEC-03', 'Sector El Rosario', 'Zona periférica este', now, now);
      console.log('✅ [SQLite] Sectores iniciales sembrados.');
    }

    // 3. Tarifas por defecto
    const tarifaCount = this.db.prepare('SELECT COUNT(*) as count FROM tarifas_config').get() as { count: number };
    if (tarifaCount.count === 0) {
      this.db.prepare(`
        INSERT INTO tarifas_config (
          id, cargo_fijo_normal, cargo_fijo_tercera_edad, limite_base_m3, costo_excedente_m3,
          recargo_alcantarillado, reparto_normal_padre, reparto_normal_operacion,
          reparto_normal_lector, reparto_normal_mortuorio, activo, created_at
        ) VALUES (?, 7.00, 5.00, 30.00, 0.10, 1.00, 2.00, 4.00, 0.50, 0.50, 1, ?)
      `).run(crypto.randomUUID(), now);
      console.log('✅ [SQLite] Configuración de tarifas inicial sembrada ($7.00 normal, $5.00 3ra edad, base 30m3).');
    }

    // 4. Catálogo de Fondos
    const fondoCount = this.db.prepare('SELECT COUNT(*) as count FROM fondos_catalogo').get() as { count: number };
    if (fondoCount.count === 0) {
      const insertFondo = this.db.prepare(`
        INSERT INTO fondos_catalogo (id, codigo, nombre, descripcion, activo)
        VALUES (?, ?, ?, ?, 1)
      `);

      insertFondo.run(crypto.randomUUID(), 'PADRE_PARROQUIA', 'Aporte Parroquial (Padre)', 'Fondo de aporte mensual destinado a la Iglesia / Padre.');
      insertFondo.run(crypto.randomUUID(), 'OPERACION_MANT', 'Operación y Mantenimiento', 'Mantenimiento de red de agua, cloro y químicos.');
      insertFondo.run(crypto.randomUUID(), 'PAGO_LECTOR', 'Honorarios Lector', 'Pago por toma mensual de lecturas.');
      insertFondo.run(crypto.randomUUID(), 'MORTUORIO', 'Fondo Mortuorio', 'Auxilio funerario comunitario para los socios.');
      insertFondo.run(crypto.randomUUID(), 'PRO_MEJORAS', 'Fondo Pro-mejoras', 'Obras de infraestructura financiado con excedentes de consumo.');
      insertFondo.run(crypto.randomUUID(), 'MULTAS_EXTRAS', 'Fondo de Multas y Cuotas Extras', 'Ingresos por inasistencia a mingas, asambleas y reconexiones.');
      insertFondo.run(crypto.randomUUID(), 'ALCANTARILLADO', 'Fondo de Alcantarillado', 'Recargo mensual para mantenimiento del sistema de alcantarillado.');
      console.log('✅ [SQLite] Catálogo de fondos comunitarios sembrado (7 fondos).');
    }

    // 5. Período actual abierto
    const periodoCount = this.db.prepare('SELECT COUNT(*) as count FROM periodos').get() as { count: number };
    if (periodoCount.count === 0) {
      const fecha = new Date();
      const mes = String(fecha.getMonth() + 1).padStart(2, '0');
      const anio = fecha.getFullYear();
      const codigo = `${anio}-${mes}`;
      const nombre = `Período ${mes}/${anio}`;

      this.db.prepare(`
        INSERT INTO periodos (id, periodo_codigo, nombre, fecha_inicio, fecha_fin, estado, created_at)
        VALUES (?, ?, ?, ?, ?, 'ABIERTO', ?)
      `).run(crypto.randomUUID(), codigo, nombre, `${anio}-${mes}-01`, `${anio}-${mes}-28`, now);
      console.log(`✅ [SQLite] Período inicial ${codigo} creado.`);
    }
  }
}

export const sqliteDb = new SQLiteDatabase();
