# 📋 ESPECIFICACIÓN DE REQUISITOS DE SOFTWARE (SRS)
## Sistema Integral de Gestión y Facturación para Junta Administradora de Agua Potable

---

### 📌 Ficha Técnica del Proyecto
* **Nombre del Sistema:** Sistema de Gestión de Agua Potable y Alcantarillado Comunitario (*SIGA-Comunitario*)
* **Entorno de Despliegue:** Hardware de bajos recursos (Optimizado para procesadores Intel Inside / Celeron / 2GB–4GB RAM).
* **Arquitectura Recomendada:** Monolito ligero / Aplicación de escritorio local o Web local (ej. SQLite + Python/FastAPI/Tkinter/Electron ligero o PHP/SQLite).
* **Versión:** 1.0.0
* **Fecha:** Agosto 2026

---

## 1. OBJETIVO GENERAL Y ALCANCE

El sistema tiene como objetivo automatizar el ciclo integral de la junta de agua: registro de socios, toma de lecturas de micromedición, cálculo de tarifas diferenciadas (normal vs. tercera edad), facturación con recargo por excedente y alcantarillado, control estricto de cartera vencida (morosidad), distribución contable de fondos (Contraloría/Destino de Fondos) y generación de informes periódicos por sector.

---

## 2. REQUISITOS NO FUNCIONALES (ARQUITECTURA Y RENDIMIENTO)

| ID | Requisito | Descripción |
| :--- | :--- | :--- |
| **RNF-01** | **Bajo Consumo de Recursos** | El sistema debe ejecutarse de forma fluida en equipos con procesador **Intel Inside / Celeron / Pentium** y 2 GB a 4 GB de memoria RAM. |
| **RNF-02** | **Motor de Base de Datos Ligero** | Uso de **SQLite** embebido o **MariaDB Lite**, sin necesidad de servidores dedicados pesados. |
| **RNF-03** | **Modo Offline / Local** | Operación 100% local sin dependencia obligatoria de conexión a Internet para cobro y toma de lecturas. |
| **RNF-04** | **Integridad Transaccional** | Bloqueo de lecturas y facturas ya cobradas para evitar descuadres de caja y alteraciones históricas. |

---

## 3. MÓDULOS DEL SISTEMA Y REQUISITOS FUNCIONALES

```
                    ┌───────────────────────────────────────────────┐
                    │       SISTEMA DE GESTIÓN DE AGUA POTABLE     │
                    └───────────────────────┬───────────────────────┘
                                            │
    ┌───────────────────┬───────────────────┼───────────────────┬───────────────────┐
    ▼                   ▼                   ▼                   ▼                   ▼
┌──────────────┐ ┌──────────────┐ ┌───────────────────┐ ┌───────────────┐ ┌──────────────────┐
│   PADRÓN DE  │ │   TOMA DE    │ │   LIQUIDACIÓN Y   │ │  CONTRALORÍA  │ │   REPORTES Y     │
│    SOCIOS    │ │   LECTURAS   │ │    FACTURACIÓN    │ │ Y FONDOS (3C) │ │   AUDITORÍA      │
└──────────────┘ └──────────────┘ └───────────────────┘ └───────────────┘ └──────────────────┘
```

---

### MÓDULO 1: GESTIÓN DEL PADRÓN DE SOCIOS (CONSUMIDORES)

#### Datos del Socio / Abonado:
* **Nombres y Apellidos** (Completos).
* **Número de Cédula / RUC** (Validación de formato).
* **Fecha de Nacimiento:** Con cálculo automático del campo **Tercera Edad (Boolean)**:
  * Si `Edad >= 65 años` $ightarrow$ `Tercera Edad = TRUE` (Aplica tarifa preferencial de **$5.00**).
  * Si `Edad < 65 años` $ightarrow$ `Tercera Edad = FALSE` (Aplica tarifa normal de **$7.00**).
  * *Actualización dinámica automática:* El sistema evaluará mensualmente si el socio cumple 65 años para actualizar su categoría.
* **Fecha de Unión / Afiliación** a la Junta.
* **Sector / Barrio:** Clasificación geográfica para reportes y rutas de lectura.
* **Posee Alcantarillado (Boolean):** Aplica recargo de **+$1.00 USD/mes**.
* **Estado de Servicio:** Activo, Suspendido, Cortado.
* **Historial de Cuenta Corriente:**
  * Indicador de estado: **Al Día** o **En Mora / Atrasado**.
  * Número exacto de meses adeudados.
  * Fecha de inicio de la deuda más antigua.
  * Desglose mes a mes de valores pendientes (consumo, alcantarillado, multas).

---

### MÓDULO 2: MICROMEDICIÓN Y TOMA DE LECTURAS (ROL LECTOR)

#### Funcionalidades del Rol Lector:
* **Interfaz de Captura Rápida:**
  * Listado ordenado por **Sector** y número de medidor.
  * Carga automática de la **Lectura Anterior ($L_{ant}$)**.
  * Campo de entrada exclusivo para **Lectura Actual ($L_{act}$)**.
* **Reglas de Negocio en la Medición:**
  * **Validación de Consistencias:** $L_{act} \ge L_{ant}$. Si $L_{act} < L_{ant}$, alerta por posible cambio/reinicio de medidor o error de digitación.
  * **Consumo del Mes ($C_m$):** 
    $$C_m = L_{act} - L_{ant}$$
  * **Excedente de Consumo ($E_m$):** El servicio incluye una base fija de **$30	ext{ m}^3$**.
    $$E_m = \max(0, C_m - 30)$$
  * **Cierre de Ciclo Mensual:** Una vez cerrada la facturación del mes, la **Lectura Actual** pasa a ser automáticamente la **Lectura Anterior** del siguiente período.

---

### MÓDULO 3: LIQUIDACIÓN, TARIFAS Y CAJA (COBROS)

#### Matriz de Reglas de Tarifación:
| Rubro | Condición / Tipo | Valor Unitario | Destino Contable |
| :--- | :--- | :--- | :--- |
| **Cargo Fijo Base** | Normal ($< 65$ años) | **$7.00** (hasta $30	ext{ m}^3$) | Fondo Base Comunitario (Desglose 4 subfondos) |
| **Cargo Fijo Base** | 3ra Edad ($\ge 65$ años) | **$5.00** (hasta $30	ext{ m}^3$) | Fondo Base Comunitario (Tarifa Subsidiada) |
| **Excedente** | Consumo $> 30	ext{ m}^3$ | **$0.10 / 	ext{m}^3$ extra** | Fondo de Pro-mejoras |
| **Servicio Alcantarillado** | Si socio tiene alcantarillado | **+$1.00** | Fondo Alcantarillado / Mantenimiento |
| **Multas y Otros Rubros** | Mingas, Asambleas, Conexiones | Variable | Fondo de Multas y Cuotas Extraordinarias |
| **Deudas Anteriores** | Meses en mora acumulados | Sumatoria histórica | Cancelación cronológica de planillas pendientes |

#### Fórmula de Cálculo del Total Mensual:
$$	ext{Total Mes} = 	ext{Cargo Fijo (7\$ ó 5\$)} + (E_m 	imes 0.10\$) + 	ext{Alcantarillado (1\$ ó 0\$)}$$

$$	ext{Total a Pagar} = 	ext{Total Mes} + 	ext{Multas / Cuotas Extras} + 	ext{Deudas Anteriores Acumuladas}$$

#### Ejemplo de Facturación (Caso Práctico):
* **Socio:** José Luna (Normal, 42 años, Sector Centro, Tiene Alcantarillado).
* **Lectura Anterior:** $150	ext{ m}^3$ | **Lectura Actual:** $195	ext{ m}^3$ $ightarrow$ **Consumo Total:** $45	ext{ m}^3$.
* **Base:** $30	ext{ m}^3$ (Cubiertos en el cargo fijo de $7.00$).
* **Excedente:** $45 - 30 = 15	ext{ m}^3 	imes \$0.10 = \$1.50$.
* **Alcantarillado:** $\$1.00$.
* **Multa por inasistencia a minga:** $\$3.00$.
* **Deuda anterior:** 2 meses pendientes ($\$16.00$, desde Junio 2026).
* **Liquidación Total:** $\$7.00 + \$1.50 + \$1.00 + \$3.00 + \$16.00 = \mathbf{\$28.50}$.

---

### MÓDULO 4: CONTRALORÍA Y DESTINO DE FONDOS (LIBRO MAYOR DE 3 COLUMNAS)

> **REGLA TRANSVERSAL:** Todas las tablas de fondos contables deben poseer estrictamente la estructura de **3 Columnas**:
> 1. **Ingresos (+)**
> 2. **Egresos (-)**
> 3. **Saldo Acumulado (=)**

#### 1. Distribución del Cargo Base ($7.00 Normal):
Cada pago de cuota básica normal de $7.00 se fracciona automáticamente al momento del cobro:
* **\$2.00 $ightarrow$ Aporte al Padre / Parroquia:** Fondo acumulativo mes a mes con seguimiento de cuánto se ha pagado y cuántos socios faltan por aportar.
* **\$4.00 $ightarrow$ Consumo Base / Mantenimiento y Operación:** Operación de la red y químicos.
* **\$0.50 $ightarrow$ Pago al Lector:** Honorarios por toma de lecturas.
* **\$0.50 $ightarrow$ Fondo Mortuorio:** Fondo de auxilio funerario comunitario.
*(Nota: En caso de tercera edad de $5.00$, el sistema aplica prorrateo configurado por la directiva).*

#### 2. Fondo de Pro-mejoras (Excedentes):
* Se alimenta exclusivamente del valor recaudado por **Excedentes de consumo** ($\$0.10/	ext{m}^3$).
* Registro con auditoría: fecha, recibo de ingreso, concepto de egreso (obras, tuberías, mejoras), soporte y saldo disponible.

#### 3. Fondo de Multas y Otros Rubros:
* Se alimenta de inasistencias a mingas, cuotas extraordinarias de nuevos socios, multas por reconexión, etc.

#### 4. Control del Fondo del Padre / Parroquia:
* Acumulador mensual de valores cobrados destinados al Padre.
* Generador de liquidación de entrega: Total recaudado en el mes, Total pagado/entregado al Padre, Saldo pendiente de cobro por socios morosos.

---

### MÓDULO 5: REPORTES, CONSULTAS Y AUDITORÍA

#### Tipos de Informes:
1. **Filtros Temporales:**
   * Informe Mensual.
   * Informe Trimestral.
   * Informe Semestral.
   * Informe Anual.
2. **Filtros de Segmentación:**
   * **Por Socio:** Estado de cuenta, historial de lecturas, pagos y deudas detalladas con fechas.
   * **Por Sector:** Consumo total en $	ext{m}^3$, dinero recaudado, dinero pendiente en mora por cada sector.
   * **General / Consolidado:** Totalización de ingresos de la Junta.
3. **Reporte de Morosidad y Cartera Vencida:**
   * Listado de socios atrasados con: Nombres, Cédula, Sector, Meses atrasados, Fecha de corte inicial, Total adeudado.
4. **Reporte de Destino de Fondos (Contraloría Comunitaria):**
   * Estado de cada fondo (Padre, Operación, Lector, Mortuorio, Pro-mejoras, Multas) con detalle de Ingresos, Egresos y Saldo.

---

## 4. ROLES DE USUARIO Y PERMISOS

| Rol | Pantallas y Acceso Permitido | Restricciones |
| :--- | :--- | :--- |
| **Rol Lector** | Captura de lectura actual por sector; vista de lectura anterior y nombres de socio. | Sin acceso a montos de dinero, reportes contables ni cobro en caja. |
| **Rol Cobrador / Tesorero** | Módulo de Cobros en Caja, Emisión de comprobantes, Gestión de Socios, Registro de Ingresos/Egresos. | No puede alterar lecturas históricas cerradas sin autorización. |
| **Rol Administrador / Directiva** | Control total: Configuración de tarifas, Cierre mensual, Informes trimestrales/semestrales/anuales, Auditoría y Contraloría. | Acceso completo. |

---

## 5. MODELO DE DATOS CONCEPTUAL (TABLAS PRINCIPALES)

1. **`SOCIOS`** (`id_socio`, `nombres`, `apellidos`, `cedula`, `fecha_nacimiento`, `es_tercera_edad`, `fecha_union`, `id_sector`, `tiene_alcantarillado`, `estado`)
2. **`SECTORES`** (`id_sector`, `nombre_sector`, `descripcion`)
3. **`PERIODOS`** (`id_periodo`, `mes`, `anio`, `estado_periodo`)
4. **`LECTURAS`** (`id_lectura`, `id_socio`, `id_periodo`, `lectura_anterior`, `lectura_actual`, `consumo_total`, `excedente_m3`, `fecha_lectura`, `id_lector`)
5. **`FACTURAS`** (`id_factura`, `id_socio`, `id_periodo`, `valor_base`, `valor_excedente`, `valor_alcantarillado`, `valor_multas`, `valor_deuda_anterior`, `total_mes`, `total_pagar`, `estado_pago`, `fecha_pago`)
6. **`FONDOS_MOVIMIENTOS`** (`id_movimiento`, `id_fondo` [Padre, Operación, Lector, Mortuorio, Pro-mejoras, Multas], `fecha`, `concepto`, `ingreso`, `egreso`, `saldo`, `id_comprobante`)
7. **`MULTAS_RUBROS`** (`id_rubro`, `id_socio`, `tipo_rubro`, `monto`, `fecha_emision`, `id_periodo`, `pagado`)

---

## 6. CRONOGRAMA DE IMPLEMENTACIÓN RECOMENDADO

* **Fase 1:** Base de datos SQLite y Módulo de Socios con cálculo dinámico de 3ra Edad.
* **Fase 2:** Módulo de Toma de Lecturas (Rol Lector) con validación $L_{act} \ge L_{ant}$ y cálculo de excedente ($>30	ext{ m}^3$).
* **Fase 3:** Motor de Facturación, cobro en caja y liquidación con desglose de alcantarillado, multas y deudas anteriores.
* **Fase 4:** Libro Mayor de Contraloría (Fondos con 3 columnas: Ingreso, Egreso, Saldo) y reparto del canon base.
* **Fase 5:** Módulo de Reportería (Mensual, Trimestral, Semestral, Anual) por socio y sector.
