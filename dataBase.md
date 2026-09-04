# 🗄️ Esquema y Modelo de Datos Relacional: SIGA-Comunitario
## Persistencia Dual: SQLite Local Embebido & Supabase PostgreSQL Central

Este documento describe la estructura relacional de la base de datos para el **Sistema de Gestión de Agua Potable y Alcantarillado Comunitario (*SIGA-Comunitario*)**. Admite persistencia local embebida en **SQLite** (`node:sqlite`) y persistencia en la nube mediante **Supabase PostgreSQL**.

---

## 1. Diagrama Entidad-Relación (ERD)

```
┌─────────────────┐
│    SECTORES     │
└────────┬────────┘
         │ 1:N
         ▼
┌─────────────────┐       1:N       ┌─────────────────┐       1:N       ┌─────────────────┐
│     SOCIOS      ├────────────────►│    MEDIDORES    ├────────────────►│    LECTURAS     │
└────────┬────────┘                 └─────────────────┘                 └────────┬────────┘
         │ 1:N                                                                   │ 1:1
         ▼                                                                       ▼
┌─────────────────┐                                                     ┌─────────────────┐
│  MULTAS_RUBROS  │                                                     │    FACTURAS     │
└─────────────────┘                                                     └────────┬────────┘
                                                                                 │ 1:1
                                                                                 ▼
┌───────────────────────────┐       1:N       ┌───────────────────┐     ┌─────────────────┐
│     FONDOS_CATALOGO       ├────────────────►│ FONDOS_MOVIMIENTOS│◄────┤     COBROS      │
│ (3 Columnas: +/-/Saldo)   │                 │ (Mayor 3 Columnas)│     └─────────────────┘
└───────────────────────────┘                 └───────────────────┘
```

---

## 2. Diccionario de Tablas

### 2.1. `usuarios`
Almacena las credenciales y roles de acceso al sistema (`ADMIN`, `CAJERO`, `LECTOR`, `AUDITOR`).

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción / Restricciones |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK (UUIDv4) |
| `username` | `TEXT` | `VARCHAR(50)` | Nombre de usuario único |
| `password_hash` | `TEXT` | `TEXT` | Hash seguro (SHA-256 / PBKDF2) |
| `nombre_completo` | `TEXT` | `VARCHAR(150)` | Nombre y apellido |
| `rol` | `TEXT` | `VARCHAR(20)` | `ADMIN`, `CAJERO`, `LECTOR`, `AUDITOR` |
| `activo` | `INTEGER` | `BOOLEAN` | `1` / `true` si está activo |
| `created_at` | `TEXT` | `TIMESTAMPTZ` | Fecha de creación |
| `updated_at` | `TEXT` | `TIMESTAMPTZ` | Fecha de actualización |

---

### 2.2. `sectores`
Clasificación geográfica y rutas de lectura de la comunidad.

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK |
| `codigo_sector` | `TEXT` | `VARCHAR(20)` | Código único (ej. `SEC-01`, `CENTRO`) |
| `nombre_sector` | `TEXT` | `VARCHAR(100)` | Nombre descriptivo del sector o barrio |
| `descripcion` | `TEXT` | `TEXT` | Observaciones geográficas |
| `activo` | `INTEGER` | `BOOLEAN` | `1` / `true` |
| `created_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |
| `updated_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |

---

### 2.3. `tarifas_config`
Parámetros de tarifación y distribución comunitaria (gestionado por Rol `ADMIN`).

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK |
| `cargo_fijo_normal`| `REAL` | `NUMERIC(10,2)`| Valor normal (Por defecto: `$7.00`) |
| `cargo_fijo_tercera_edad`| `REAL` | `NUMERIC(10,2)`| Valor preferencial $\ge 65$ años (Por defecto: `$5.00`) |
| `limite_base_m3` | `REAL` | `NUMERIC(10,2)`| Base incluida en cargo fijo (`30.00 m³`) |
| `costo_excedente_m3`| `REAL`| `NUMERIC(10,2)`| Valor por m³ extra (Por defecto: `$0.10`) |
| `recargo_alcantarillado`| `REAL`| `NUMERIC(10,2)`| Recargo mensual si aplica (Por defecto: `$1.00`) |
| `reparto_normal_padre`| `REAL`| `NUMERIC(10,2)`| Porción Parroquia/Padre (`$2.00`) |
| `reparto_normal_operacion`| `REAL`| `NUMERIC(10,2)`| Porción Mantenimiento (`$4.00`) |
| `reparto_normal_lector`| `REAL`| `NUMERIC(10,2)`| Porción Lector (`$0.50`) |
| `reparto_normal_mortuorio`| `REAL`| `NUMERIC(10,2)`| Porción Fondo Mortuorio (`$0.50`) |
| `activo` | `INTEGER` | `BOOLEAN` | `1` / `true` |
| `created_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |

---

### 2.4. `socios` (Abonados / Titulares)
Padrón de afiliados con cálculo dinámico mensual de 3ra edad. Un socio puede poseer múltiples medidores (`1:N`).

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK |
| `codigo_socio` | `TEXT` | `VARCHAR(30)` | Código único de socio (ej. `SOC-0012`) |
| `nombres` | `TEXT` | `VARCHAR(100)` | Nombres |
| `apellidos` | `TEXT` | `VARCHAR(100)` | Apellidos |
| `cedula_ruc` | `TEXT` | `VARCHAR(20)` | Cédula o RUC con validación |
| `fecha_nacimiento`| `TEXT` | `DATE` | Base para cálculo dinámico de 3ra edad |
| `fecha_union` | `TEXT` | `DATE` | Fecha de afiliación a la junta |
| `telefono` | `TEXT` | `VARCHAR(25)` | Contacto telefónico |
| `direccion` | `TEXT` | `TEXT` | Dirección o domicilio principal del socio |
| `estado` | `TEXT` | `VARCHAR(20)` | `ACTIVO`, `SUSPENDIDO`, `CORTADO` |
| `version` | `INTEGER` | `INTEGER` | Control de versión para LWW |
| `created_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |
| `updated_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |

---

### 2.5. `medidores` (Acometidas / Puntos de Medición - Multi-Medidor)
Acometidas y conexiones de agua registradas a nombre de un socio. Soporta múltiples medidores por abonado (ej: "Casa principal", "Terreno", "Local").

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK (UUIDv4) |
| `id_socio` | `TEXT` | `UUID` | FK `socios.id` (ON DELETE CASCADE) |
| `id_sector` | `TEXT` | `UUID` | FK `sectores.id` (Ruta geográfica) |
| `numero_medidor`| `TEXT` | `VARCHAR(50)` | Número único / serial físico del medidor |
| `alias` | `TEXT` | `VARCHAR(50)` | Nombre / alias (ej. `Casa principal`, `Terreno`, `Local`, `M1`) |
| `direccion` | `TEXT` | `TEXT` | Ubicación física exacta de la conexión |
| `tiene_alcantarillado`| `INTEGER` | `BOOLEAN` | Aplica recargo de +$1.00 a esta acometida |
| `estado` | `TEXT` | `VARCHAR(20)` | `ACTIVO`, `SUSPENDIDO`, `CORTADO` |
| `version` | `INTEGER` | `INTEGER` | Control de versión para LWW |
| `created_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |
| `updated_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |

---

### 2.6. `periodos`
Ciclos mensuales de facturación y lectura (`YYYY-MM`).

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK |
| `periodo_codigo`| `TEXT` | `VARCHAR(7)` | Formato `YYYY-MM` (ej. `2026-08`) |
| `nombre` | `TEXT` | `VARCHAR(50)` | Nombre descriptivo (ej. `Agosto 2026`) |
| `fecha_inicio` | `TEXT` | `DATE` | Inicio de ciclo |
| `fecha_fin` | `TEXT` | `DATE` | Fin de ciclo |
| `estado` | `TEXT` | `VARCHAR(20)` | `ABIERTO`, `CERRADO`, `FACTURADO` |
| `created_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |

---

### 2.7. `lecturas`
Toma física de micromedición por **Medidor** (Rol Lector / Cobrador). Restricción de unicidad: un medidor solo puede tener una lectura por período.

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK |
| `id_medidor` | `TEXT` | `UUID` | FK `medidores.id` (Acometida específica) |
| `id_socio` | `TEXT` | `UUID` | FK `socios.id` (Titular responsable) |
| `id_periodo` | `TEXT` | `UUID` | FK `periodos.id` |
| `lectura_anterior`| `REAL` | `NUMERIC(10,2)`| $L_{ant}$ acumulada del medidor |
| `lectura_actual`| `REAL` | `NUMERIC(10,2)`| $L_{act}$ capturada ($L_{act} \ge L_{ant}$) |
| `consumo_total` | `REAL` | `NUMERIC(10,2)`| $C_m = L_{act} - L_{ant}$ |
| `excedente_m3` | `REAL` | `NUMERIC(10,2)`| $E_m = \max(0, C_m - 30)$ |
| `fecha_lectura` | `TEXT` | `TIMESTAMPTZ` | Fecha de captura |
| `id_lector` | `TEXT` | `UUID` | FK `usuarios.id` |
| `observaciones` | `TEXT` | `TEXT` | Novedades en la toma |
| `version` | `INTEGER` | `INTEGER` | Control LWW |
| `created_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |
| `updated_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |

---

### 2.8. `multas_rubros`
Multas por mingas, asambleas, conexiones y cuotas extraordinarias.

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK |
| `id_socio` | `TEXT` | `UUID` | FK `socios.id` |
| `id_periodo` | `TEXT` | `UUID` | FK `periodos.id` |
| `tipo_rubro` | `TEXT` | `VARCHAR(50)` | `MINGA`, `ASAMBLEA`, `RECONEXION`, `CUOTA_EXTRA`, `OTRO` |
| `monto` | `REAL` | `NUMERIC(10,2)`| Valor monetario |
| `motivo` | `TEXT` | `TEXT` | Explicación |
| `pagado` | `INTEGER` | `BOOLEAN` | `1` si fue cancelado |
| `id_factura` | `TEXT` | `UUID` | FK opcional `facturas.id` |
| `created_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |

---

### 2.9. `facturas`
Liquidación mensual por medidor y socio. Bloqueada una vez pagada.

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK |
| `numero_factura`| `TEXT` | `VARCHAR(30)` | Folio correlativo (ej. `FAC-2026-0001`) |
| `id_socio` | `TEXT` | `UUID` | FK `socios.id` |
| `id_medidor` | `TEXT` | `UUID` | FK `medidores.id` |
| `id_periodo` | `TEXT` | `UUID` | FK `periodos.id` |
| `id_lectura` | `TEXT` | `UUID` | FK `lecturas.id` |
| `es_tercera_edad`| `INTEGER` | `BOOLEAN` | Evaluado al liquidar |
| `valor_base` | `REAL` | `NUMERIC(10,2)`| $7.00 o $5.00 |
| `consumo_m3` | `REAL` | `NUMERIC(10,2)`| Metros cúbicos consumidos |
| `excedente_m3` | `REAL` | `NUMERIC(10,2)`| Metros cúbicos en exceso |
| `valor_excedente`| `REAL`| `NUMERIC(10,2)`| $E_m \times \$0.10$ |
| `valor_alcantarillado`| `REAL`| `NUMERIC(10,2)`| $1.00 o $0.00 |
| `valor_multas` | `REAL` | `NUMERIC(10,2)`| Sumatoria de multas asociadas |
| `valor_deuda_anterior`| `REAL`| `NUMERIC(10,2)`| Deuda acumulada de meses en mora |
| `total_mes` | `REAL` | `NUMERIC(10,2)`| Base + Excedente + Alcantarillado |
| `total_pagar` | `REAL` | `NUMERIC(10,2)`| Total Mes + Multas + Deuda Anterior |
| `estado_pago` | `TEXT` | `VARCHAR(20)` | `PENDIENTE`, `PAGADO`, `ANULADO` |
| `fecha_vencimiento`| `TEXT`| `DATE` | Límite oportuno de pago |
| `fecha_pago` | `TEXT` | `TIMESTAMPTZ` | Momento de cobro efectivo |
| `metodo_pago` | `TEXT` | `VARCHAR(30)` | `EFECTIVO`, `TRANSFERENCIA`, `MOVIL` |
| `id_cajero` | `TEXT` | `UUID` | FK `usuarios.id` |
| `version` | `INTEGER` | `INTEGER` | Control LWW |
| `created_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |
| `updated_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |

---

### 2.7. `multas_rubros`
Multas por mingas, asambleas, conexiones y cuotas extraordinarias.

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK |
| `id_socio` | `TEXT` | `UUID` | FK `socios.id` |
| `id_periodo` | `TEXT` | `UUID` | FK `periodos.id` |
| `tipo_rubro` | `TEXT` | `VARCHAR(50)` | `MINGA`, `ASAMBLEA`, `RECONEXION`, `CUOTA_EXTRA`, `OTRO` |
| `monto` | `REAL` | `NUMERIC(10,2)`| Valor monetario |
| `motivo` | `TEXT` | `TEXT` | Explicación |
| `pagado` | `INTEGER` | `BOOLEAN` | `1` si fue cancelado |
| `id_factura` | `TEXT` | `UUID` | FK opcional `facturas.id` |
| `created_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |

---

### 2.8. `facturas`
Liquidación mensual por socio. Bloqueada una vez pagada.

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK |
| `numero_factura`| `TEXT` | `VARCHAR(30)` | Folio correlativo (ej. `FAC-2026-0001`) |
| `id_socio` | `TEXT` | `UUID` | FK `socios.id` |
| `id_periodo` | `TEXT` | `UUID` | FK `periodos.id` |
| `id_lectura` | `TEXT` | `UUID` | FK `lecturas.id` |
| `es_tercera_edad`| `INTEGER` | `BOOLEAN` | Evaluado al liquidar |
| `valor_base` | `REAL` | `NUMERIC(10,2)`| $7.00 o $5.00 |
| `consumo_m3` | `REAL` | `NUMERIC(10,2)`| Metros cúbicos consumidos |
| `excedente_m3` | `REAL` | `NUMERIC(10,2)`| Metros cúbicos en exceso |
| `valor_excedente`| `REAL`| `NUMERIC(10,2)`| $E_m \times \$0.10$ |
| `valor_alcantarillado`| `REAL`| `NUMERIC(10,2)`| $1.00 o $0.00 |
| `valor_multas` | `REAL` | `NUMERIC(10,2)`| Sumatoria de multas asociadas |
| `valor_deuda_anterior`| `REAL`| `NUMERIC(10,2)`| Deuda acumulada de meses en mora |
| `total_mes` | `REAL` | `NUMERIC(10,2)`| Base + Excedente + Alcantarillado |
| `total_pagar` | `REAL` | `NUMERIC(10,2)`| Total Mes + Multas + Deuda Anterior |
| `estado_pago` | `TEXT` | `VARCHAR(20)` | `PENDIENTE`, `PAGADO`, `ANULADO` |
| `fecha_vencimiento`| `TEXT`| `DATE` | Límite oportuno de pago |
| `fecha_pago` | `TEXT` | `TIMESTAMPTZ` | Momento de cobro efectivo |
| `metodo_pago` | `TEXT` | `VARCHAR(30)` | `EFECTIVO`, `TRANSFERENCIA`, `MOVIL` |
| `id_cajero` | `TEXT` | `UUID` | FK `usuarios.id` |
| `version` | `INTEGER` | `INTEGER` | Control LWW |
| `created_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |
| `updated_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |

---

### 2.9. `fondos_catalogo`
Catálogo maestro de cuentas y destinos de fondos contables.

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK |
| `codigo` | `TEXT` | `VARCHAR(30)` | `PADRE_PARROQUIA`, `OPERACION_MANT`, `PAGO_LECTOR`, `MORTUORIO`, `PRO_MEJORAS`, `MULTAS_EXTRAS`, `ALCANTARILLADO` |
| `nombre` | `TEXT` | `VARCHAR(100)` | Nombre descriptivo |
| `descripcion` | `TEXT` | `TEXT` | Destino y normativa comunitaria |
| `activo` | `INTEGER` | `BOOLEAN` | `1` / `true` |

---

### 2.10. `fondos_movimientos` (Libro Mayor de 3 Columnas)
> **Estructura Estricta:** `Ingresos (+)`, `Egresos (-)`, `Saldo Acumulado (=)`.

| Columna | Tipo SQLite | Tipo Supabase (PG) | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `UUID` | PK |
| `id_fondo` | `TEXT` | `UUID` | FK `fondos_catalogo.id` |
| `fecha` | `TEXT` | `TIMESTAMPTZ` | Fecha del movimiento |
| `concepto` | `TEXT` | `VARCHAR(255)`| Detalle / Concepto contable |
| `tipo` | `TEXT` | `VARCHAR(10)` | `INGRESO` o `EGRESO` |
| `ingreso` | `REAL` | `NUMERIC(10,2)`| Valor ingresado (o 0.00) |
| `egreso` | `REAL` | `NUMERIC(10,2)`| Valor egresado (o 0.00) |
| `saldo` | `REAL` | `NUMERIC(10,2)`| Saldo resultante acumulado |
| `id_factura` | `TEXT` | `UUID` | FK opcional `facturas.id` (si proviene de cobro) |
| `numero_comprobante`| `TEXT`| `VARCHAR(50)` | Comprobante físico de egreso o soporte |
| `id_responsable`| `TEXT` | `UUID` | FK `usuarios.id` |
| `beneficiario` | `TEXT` | `VARCHAR(150)`| Proveedor / Padre / Personal |
| `created_at` | `TEXT` | `TIMESTAMPTZ` | Timestamp |

---

## 3. Script DDL para SQLite (Local Embebido)

```sql
PRAGMA foreign_keys = ON;

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
  telefono TEXT,
  direccion TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'ACTIVO' CHECK(estado IN ('ACTIVO', 'SUSPENDIDO', 'CORTADO')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_socios_estado ON socios(estado);

-- 5. Medidores (Acometidas de Agua - 1 Socio : N Medidores)
CREATE TABLE IF NOT EXISTS medidores (
  id TEXT PRIMARY KEY,
  id_socio TEXT NOT NULL,
  id_sector TEXT NOT NULL,
  numero_medidor TEXT UNIQUE NOT NULL,
  alias TEXT, -- ej: 'Casa principal', 'Terreno', 'Local comercial', 'M1'
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

-- 7. Lecturas (Micromedición por Medidor)
CREATE TABLE IF NOT EXISTS lecturas (
  id TEXT PRIMARY KEY,
  id_medidor TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_lecturas_medidor ON lecturas(id_medidor);
CREATE INDEX IF NOT EXISTS idx_lecturas_periodo ON lecturas(id_periodo);
CREATE INDEX IF NOT EXISTS idx_lecturas_socio ON lecturas(id_socio);

-- 8. Multas y Rubros
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

-- 9. Facturas (Liquidación mensual por Medidor y Socio)
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
CREATE INDEX IF NOT EXISTS idx_facturas_medidor ON facturas(id_medidor);
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
```

---

## 4. Script DDL para Supabase (PostgreSQL Cloud)

```sql
-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tablas con tipos PostgreSQL y constraints
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nombre_completo VARCHAR(150) NOT NULL,
  rol VARCHAR(20) NOT NULL CHECK(rol IN ('ADMIN', 'CAJERO', 'LECTOR', 'AUDITOR')),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sectores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_sector VARCHAR(20) UNIQUE NOT NULL,
  nombre_sector VARCHAR(100) NOT NULL,
  descripcion TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tarifas_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cargo_fijo_normal NUMERIC(10,2) NOT NULL DEFAULT 7.00,
  cargo_fijo_tercera_edad NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  limite_base_m3 NUMERIC(10,2) NOT NULL DEFAULT 30.00,
  costo_excedente_m3 NUMERIC(10,2) NOT NULL DEFAULT 0.10,
  recargo_alcantarillado NUMERIC(10,2) NOT NULL DEFAULT 1.00,
  reparto_normal_padre NUMERIC(10,2) NOT NULL DEFAULT 2.00,
  reparto_normal_operacion NUMERIC(10,2) NOT NULL DEFAULT 4.00,
  reparto_normal_lector NUMERIC(10,2) NOT NULL DEFAULT 0.50,
  reparto_normal_mortuorio NUMERIC(10,2) NOT NULL DEFAULT 0.50,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS socios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_socio VARCHAR(30) UNIQUE NOT NULL,
  nombres VARCHAR(100) NOT NULL,
  apellidos VARCHAR(100) NOT NULL,
  cedula_ruc VARCHAR(20) UNIQUE NOT NULL,
  fecha_nacimiento DATE NOT NULL,
  fecha_union DATE NOT NULL,
  telefono VARCHAR(25),
  direccion TEXT NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO' CHECK(estado IN ('ACTIVO', 'SUSPENDIDO', 'CORTADO')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabla de Medidores (1 Socio : N Medidores)
CREATE TABLE IF NOT EXISTS medidores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_socio UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  id_sector UUID NOT NULL REFERENCES sectores(id),
  numero_medidor VARCHAR(50) UNIQUE NOT NULL,
  alias VARCHAR(50), -- ej: "Casa principal", "Terreno", "Local comercial", "M1"
  direccion TEXT,
  tiene_alcantarillado BOOLEAN NOT NULL DEFAULT false,
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO' CHECK(estado IN ('ACTIVO', 'SUSPENDIDO', 'CORTADO')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pg_medidores_socio ON medidores(id_socio);
CREATE INDEX IF NOT EXISTS idx_pg_medidores_sector ON medidores(id_sector);

CREATE TABLE IF NOT EXISTS periodos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  periodo_codigo VARCHAR(7) UNIQUE NOT NULL,
  nombre VARCHAR(50) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTO' CHECK(estado IN ('ABIERTO', 'CERRADO', 'FACTURADO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Micromedición por Medidor
CREATE TABLE IF NOT EXISTS lecturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_medidor UUID NOT NULL REFERENCES medidores(id),
  id_socio UUID NOT NULL REFERENCES socios(id),
  id_periodo UUID NOT NULL REFERENCES periodos(id),
  lectura_anterior NUMERIC(10,2) NOT NULL,
  lectura_actual NUMERIC(10,2) NOT NULL,
  consumo_total NUMERIC(10,2) NOT NULL,
  excedente_m3 NUMERIC(10,2) NOT NULL,
  fecha_lectura TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  id_lector UUID NOT NULL REFERENCES usuarios(id),
  observaciones TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_medidor_periodo_lectura UNIQUE (id_medidor, id_periodo)
);

CREATE INDEX IF NOT EXISTS idx_pg_lecturas_medidor ON lecturas(id_medidor);
CREATE INDEX IF NOT EXISTS idx_pg_lecturas_socio ON lecturas(id_socio);
CREATE INDEX IF NOT EXISTS idx_pg_lecturas_periodo ON lecturas(id_periodo);

CREATE TABLE IF NOT EXISTS multas_rubros (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_socio UUID NOT NULL REFERENCES socios(id),
  id_periodo UUID REFERENCES periodos(id),
  tipo_rubro VARCHAR(50) NOT NULL CHECK(tipo_rubro IN ('MINGA', 'ASAMBLEA', 'RECONEXION', 'CUOTA_EXTRA', 'OTRO')),
  monto NUMERIC(10,2) NOT NULL,
  motivo TEXT NOT NULL,
  pagado BOOLEAN NOT NULL DEFAULT false,
  id_factura UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS facturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero_factura VARCHAR(30) UNIQUE NOT NULL,
  id_socio UUID NOT NULL REFERENCES socios(id),
  id_medidor UUID REFERENCES medidores(id),
  id_periodo UUID NOT NULL REFERENCES periodos(id),
  id_lectura UUID REFERENCES lecturas(id),
  es_tercera_edad BOOLEAN NOT NULL DEFAULT false,
  valor_base NUMERIC(10,2) NOT NULL,
  consumo_m3 NUMERIC(10,2) NOT NULL,
  excedente_m3 NUMERIC(10,2) NOT NULL,
  valor_excedente NUMERIC(10,2) NOT NULL,
  valor_alcantarillado NUMERIC(10,2) NOT NULL,
  valor_multas NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  valor_deuda_anterior NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  total_mes NUMERIC(10,2) NOT NULL,
  total_pagar NUMERIC(10,2) NOT NULL,
  estado_pago VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK(estado_pago IN ('PENDIENTE', 'PAGADO', 'ANULADO')),
  fecha_vencimiento DATE NOT NULL,
  fecha_pago TIMESTAMPTZ,
  metodo_pago VARCHAR(30) CHECK(metodo_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'MOVIL')),
  id_cajero UUID REFERENCES usuarios(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fondos_catalogo (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo VARCHAR(30) UNIQUE NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS fondos_movimientos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_fondo UUID NOT NULL REFERENCES fondos_catalogo(id),
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concepto VARCHAR(255) NOT NULL,
  tipo VARCHAR(10) NOT NULL CHECK(tipo IN ('INGRESO', 'EGRESO')),
  ingreso NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  egreso NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  saldo NUMERIC(10,2) NOT NULL,
  id_factura UUID REFERENCES facturas(id),
  numero_comprobante VARCHAR(50),
  id_responsable UUID NOT NULL REFERENCES usuarios(id),
  beneficiario VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vista de Libro Mayor Consolidado de 3 Columnas
CREATE OR REPLACE VIEW vista_libro_mayor_3columnas AS
SELECT 
  f.codigo AS codigo_fondo,
  f.nombre AS nombre_fondo,
  m.fecha,
  m.concepto,
  m.tipo,
  m.ingreso AS "Ingresos (+)",
  m.egreso AS "Egresos (-)",
  m.saldo AS "Saldo Acumulado (=)",
  m.numero_comprobante,
  m.beneficiario
FROM fondos_movimientos m
JOIN fondos_catalogo f ON m.id_fondo = f.id
ORDER BY m.fecha ASC;
```
