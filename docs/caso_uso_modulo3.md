# caso_uso_modulo3

# ESPECIFICACIÓN FORMAL DE REQUISITOS DE SOFTWARE (IEEE 830 / IREB)

# CASOS DE USO, REGLAS DE NEGOCIO Y REQUISITOS

## MÓDULO 3: CAJA, LIQUIDACIÓN, COBROS Y CUADRE DIARIO (SIGA-COMUNITARIO)

### Junta Administradora de Agua Potable y Alcantarillado de la Parroquia Pishilata

---

**Marco Normativo y Metodológico:** Estándar IEEE 830 / ISO/IEC/IEEE 29148:2018 / Fundamentos IREB (International Requirements Engineering Board) / Jerarquía Cockburn (Summary Level, User-Goal, Subfunction)

**Documento Contractual Base:** Contrato de Desarrollo de Software celebrado el 27 de Septiembre de 2026 (Ambato, Tungurahua, Ecuador)

**Arquitectura del Sistema:** Aplicación Web Centralizada Cloud-First / API-First (Cliente Web PWA + Servidor Node.js Express en Render + Base de Datos Central PostgreSQL en Supabase Cloud vía HTTPS en Tiempo Real)

**Origen de Extracción de Código:**

- Cliente Web: `apps/client/caja.html`, `apps/client/caja.js`, `apps/client/comprobante.js`, `apps/client/shared-layout.js`
- Servidor Backend: `apps/server/src/controllers/waterController.ts`, `apps/server/src/controllers/comprobanteController.ts`, `apps/server/src/routes/apiRoutes.ts`, endpoints `/api/v1/facturas/*`, `/api/v1/caja/*`, `/api/v1/multas/*`**Versión del Documento:** 1.0.0 (Línea Base Canónica Aprobada - Conforme a IEEE 830)**Fecha de Emisión:** Octubre de 2026**Responsable de Elicitación:** Ricardo Andrés Monge Miño (Ingeniero de Requisitos y Desarrollador de Software)**Actores Asignados:** Cajero / Secretario (ACT-01), Administrador / Directiva (ACT-03), Servidor Cloud Central (ACT-04), Socio Comunitario (ACT-05 Beneficiario)

---

# NIVEL 0: MACRO-CASO DE USO DEL NEGOCIO (ENTERPRISE / SUMMARY LEVEL)

### ROL: Cajero / Secretario (ACT-01) y Administrador / Directiva (ACT-03)

### ACCION: Gestión Integral de Caja, Recaudación en Ventanilla, Liquidación Algorítmica y Cuadre Diario de Operaciones.

#### startuml

```jsx
@startuml
left to right direction
skinparam packageStyle rectangle
skinparam shadowing false
skinparam roundcorner 8

actor "Cajero / Secretario" as Cajero
actor "Administrador / Directiva" as Admin
actor "Servidor Cloud Central\n(Supabase PostgreSQL)" as Cloud <<Secondary>>

rectangle "Sistema SIGA-Comunitario • Módulo 3: Caja y Cobros" {
    usecase "CU0-03: Gestionar Caja, Cobros,\nLiquidación y Balance Diario" as UC0
}

Cajero --> UC0 : Recaudación Diaria en Ventanilla
Admin --> UC0 : Supervisión y Anulación Transaccional
UC0 <--> Cloud : Peticiones REST Directas (HTTPS / JSON en Tiempo Real)
@enduml
```

### Descripción de Alto Nivel

Permite al personal de ventanilla administrar en tiempo real el ciclo diario de cobranza comunitaria conectado directamente a la base de datos central en la nube. El macro-proceso abarca la búsqueda instantánea del abonado mediante normalización fonética y diacrítica, la consulta y selección granular de rubros adeudados, la liquidación matemática del consumo volumétrico mensual ($30\text{ m}^3$ base y excedentes a $\$0.10/\text{m}^3$), la aplicación automática de tarifas diferenciadas ($USD\ 7.00$ estándar vs $USD\ 5.00$ tercera edad), el cobro del recargo de red de alcantarillado ($USD\ 1.00$), la recuperación de deudas anteriores mediante **abonos cronológicos (criterio contable FIFO no destructivo)**, la recaudación por métodos diversificados (Efectivo o Transferencia) calculando el cambio en vivo, la emisión e impresión de comprobantes oficiales con código de barras y gráfico histórico de consumo de los últimos 5 meses, el registro de egresos menores de caja chica y la generación del informe de cuadre diario con firmas de responsabilidad.

---

# NIVEL 1: PAQUETES DE CASOS DE USO (METAS DE USUARIO / SEA LEVEL)

## MODULO 3: CAJA, LIQUIDACIÓN Y COBROS

### ROL: Cajero / Secretario (ACT-01) y Administrador (ACT-03)

### ACCIÓN:

1. **Administrar Cobranza en Ventanilla, Selección de Rubros y Liquidación Algorítmica.**
2. **Controlar Balances, Registro de Egresos Menores y Cuadre Diario de Caja.**
3. **Auditar Historial de Recibos, Reimpresión Oficial y Anulación Controlada en la Nube.**

#### startuml

```jsx
@startuml
left to right direction
skinparam packageStyle rectangle
skinparam shadowing false
skinparam roundcorner 8

actor "Cajero / Secretario" as Cajero
actor "Administrador" as Admin
actor "Servidor Cloud (Supabase)" as Cloud <<Secondary>>

rectangle "Módulo 3: Caja y Cobros (API-First)" {
    usecase "UC-3.1: Administrar Cobranza en Ventanilla\ny Liquidación Algorítmica" as UC31
    usecase "UC-3.2: Control, Balance y Cuadre\nDiario de Caja" as UC32
    usecase "UC-3.3: Historial de Comprobantes, Reimpresión\ny Anulación Controlada" as UC33
}

Cajero --> UC31
Cajero --> UC32
Cajero --> UC33
Admin --> UC31
Admin --> UC32
Admin --> UC33 : Anulación Exclusiva

UC31 <--> Cloud : POST /api/v1/facturas/cobrar
UC32 <--> Cloud : GET/POST /api/v1/caja
UC33 <--> Cloud : GET/DELETE /api/v1/facturas
@enduml
```

---

# NIVEL 2: ESPECIFICACIÓN DETALLADA, REGLAS DE NEGOCIO, HISTORIAS DE USUARIO Y REQUISITOS (IEEE 830)

### CU-31: Buscar Socio y Consultar Rubros Pendientes en Vivo

### Descripción Operativa

Permite al cajero localizar rápidamente la ficha y cuenta corriente de un socio mediante su nombre, apellido, número de cédula o número de medidor, visualizando en tiempo real la totalidad de rubros vencidos y activos.

### Reglas de Negocio Específicas

**RN-01 (Identificación Independiente de Rubros):**

La cuenta del socio debe desglosar en renglones separados y claramente diferenciados:

- Consumo de agua del periodo activo en curso.
- Consumo de agua de periodos anteriores inactivos/cerrados.
- Deudas históricas arrastradas anteriores al corte inicial (Julio 2026 o anterior).
- Rubro de mantenimiento de red de alcantarillado ($1.00 mensual).
- Multas comunitarias (mingas, asambleas, reconexiones o sanciones).

**RN-02 (Normalización Universal de Búsqueda):**

El motor de búsqueda en ventanilla debe ser insensible a mayúsculas, minúsculas y caracteres diacríticos o tildes (ej. buscar “garcia” localiza “García”, “loma” localiza “Loma Alta”).

---

### CU-32: Seleccionar Rubros y Liquidar Planilla Mensual

### Descripción Operativa

Permite al cajero seleccionar mediante casillas de verificación (*checkbox*) los rubros que el socio desea cancelar o abonar en la sesión actual, computando subtotales por categoría y el gran total a pagar en tiempo real.

### Reglas de Negocio Específicas

**RN-03 (Algoritmo de Liquidación de Agua y Excedentes - Cláusula Contractual 2.1.B):**

$$
\text{ConsumoTotal}_{m^3} = \text{LecturaActual} - \text{LecturaAnterior}
$$

$$
\text{Excedente}_{m^3} = \max(0, \text{ConsumoTotal}_{m^3} - 30)
$$

$$
\text{MontoExcedente} = \text{Excedente}_{m^3} \times \text{USD } 0.10
$$

**RN-04 (Aplicación de Tarifas Fijas Diferenciadas y Ley de Tercera Edad):**

El sistema determina la tarifa base fija mensual según la edad del socio:

- **USD $5.00** para socios de 65 años o más (Tercera Edad con subsidio comunitario legal).
- **USD $7.00** para socios menores de 65 años (Tarifa Estándar).
Ambas tarifas incluyen hasta **30 $m^3$** de consumo básico sin costo adicional.

**RN-05 (Recargo Fijo de Red de Alcantarillado):**

Si el socio tiene asignada la marca `tiene_alcantarillado = true` en su acometida, se suma un cargo fijo recurrente de **USD $1.00 mensual**, destinado exclusivamente a la red de alcantarillado.

**RN-06 (Totalización y Cálculo de Cambio / Vuelto):**

$$
\text{TotalLiquidado} = \sum \text{RubrosSeleccionados}
$$

$$
\text{Vuelto/Cambio} = \text{MontoRecibido} - \text{TotalLiquidado} \quad (\text{Condición: } \text{MontoRecibido} \ge \text{TotalLiquidado})
$$

---

### CU-33: Registrar Cobro en Ventanilla (Pago Total o Abono Parcial FIFO)

### Descripción Operativa

Permite confirmar la transacción financiera en la base de datos Supabase PostgreSQL, registrando si la liquidación extingue la totalidad de la deuda o constituye un abono parcial, imputando el dinero bajo estricto orden cronológico.

### Reglas de Negocio Específicas

**RN-07 (Diferenciación de Modalidad de Cobro):**

Toda transacción en caja debe registrarse explícitamente bajo una de las dos modalidades:

- **PAGO TOTAL:** Si el monto cancelado extingue la totalidad del valor del rubro o factura.
- **ABONO PARCIAL:** Si el valor entregado cubre únicamente una fracción de la obligación adeudada.

**RN-08 (Métodos de Recaudación Aceptados):**

El sistema admite dos canales de recaudación en ventanilla:

- `EFECTIVO`: Requiere ingresar el monto recibido para computar el vuelto exacto.
- `TRANSFERENCIA`: Requiere ingresar el número de referencia o comprobante bancario para conciliación en tesorería.

**RN-09 (Desglose Contable Automático a los 7 Fondos - Cláusula 2.1.D):**

Todo cobro registrado en caja dispara de forma automática e inmediata la inserción de asientos en la tabla `fondos_movimientos` para alimentar los 7 fondos comunitarios según las reglas financieras vigentes:

- Tarifa Estándar ($7.00): $2.00 Padre, $4.00 Operación, $0.50 Lector, $0.50 Mortuorio.
- Tarifa 3ra Edad ($5.00): $2.00 Padre, $2.00 Operación, $0.50 Lector, $0.50 Mortuorio.
- Excedente: 100% al Fondo de Pro-Mejoras.
- Alcantarillado: 100% al Fondo de Alcantarillado.

---

### CU-34: Emitir e Imprimir Comprobante Oficial de Pago

### Descripción Operativa

Genera el comprobante oficial de recaudación en formato digital e impreso listo para entrega al socio, conteniendo el desglose de conceptos, código de barras vectorial SVG y gráfico histórico de consumo.

### Reglas de Negocio Específicas

**RN-11 (Contenido Mínimo Mandatorio del Comprobante Oficial):**

El recibo debe incluir obligatoriamente:

1. Membrete oficial de la Junta Administradora de Agua Potable y Alcantarillado de Pishilata.
2. Número de recibo correlativo único (`numero_recibo`).
3. Fecha y hora exacta de emisión de la transacción.
4. Identificación del socio (Nombres, Cédula, Código de Socio, Sector).
5. Número de serie del medidor
6. Datos de medición del mes: Lectura Anterior ($m^3$), Lectura Actual ($m^3$), Consumo Neto ($m^3$), Franquicia Base ($30\text{ m}^3$), Excedente ($m^3$).
7. Indicador explícito de categoría tarifaria: `👴 TERCERA EDAD ($5)` o `👤 NORMAL ($7)`.
8. Desglose pormenorizado de rubros cobrados (Agua, Alcantarillado, Multas, Deudas Anteriores).
9. Total liquidado, método de pago (`EFECTIVO` / `TRANSFERENCIA`) y saldo pendiente remanente.
10. **Gráfico Histórico de Consumo:** Historial de barras de los últimos **5 periodos mensuales** y consumo promedio en $m^3$.
11. **Código de Barras Vectorial (SVG):** Código generado dinámicamente para control y lectura óptica de ventanilla.

---

### CU-35: Gestionar Multas Comunitarias y Cuotas Extraordinarias

### Descripción Operativa

Permite al cajero o secretario imponer sanciones económicas por inasistencias a mingas comunitarias, sesiones de asamblea o reconexiones, así como editar o anular multas pendientes.

### Reglas de Negocio Específicas

**RN-12 (Ciclo de Vida de Multas):**

- Las multas registradas ingresan en estado `PENDIENTE`.
- Mientras se encuentren en estado `PENDIENTE`, pueden ser modificadas en su monto o eliminadas por el cajero.
- Una vez que una multa ha sido cobrada (`PAGADO`), queda bloqueada e inalterable; no puede ser editada ni eliminada.

---

### CU-36: Control, Balance y Cuadre Diario de Caja

### Descripción Operativa

Permite al cajero llevar el control en tiempo real de los flujos de dinero en efectivo durante la jornada, registrar egresos menores de caja chica y generar el informe de cierre diario de ventanilla.

### Reglas de Negocio Específicas

**RN-13 (Ecuación del Cuadre Diario de Caja):**

$$
\text{IngresosHoy} = \sum \text{Cobros en Efectivo realizados en la fecha actual}
$$

$$
\text{EgresosHoy} = \sum \text{Salidas de Caja Chica registradas en la fecha actual}
$$

$$
\text{BalanceNetoHoy} = \text{IngresosHoy} - \text{EgresosHoy}
$$

$$
\text{EfectivoEnCaja} = \text{FondoInicial} + \text{BalanceNetoHoy}
$$

**RN-14 (Registro Justificado de Egresos Menores de Caja Chica):**

Todo retiro menor de caja chica exige ingresar: Monto, Motivo / Justificación del gasto, Nombre de la persona que recibe el dinero y Comprobante de respaldo.

---

### CU-37: Historial, Reimpresión y Anulación Controlada de Recibos

### Descripción Operativa

Permite consultar comprobantes emitidos en fechas pasadas, reimprimir copias exactas y, bajo autorización administrativa exclusiva, anular recibos erróneos restableciendo la deuda original al abonado.

### Reglas de Negocio Específicas

**RN-15 (Privilegio Exclusivo de Anulación Transaccional - Rol ADMIN):**

Solo los usuarios autenticados con rol `ADMIN` poseen facultades para anular un comprobante de cobro. El sistema bloquea el botón de anulación para el rol `CAJERO`.

**RN-16 (Integridad Referencial en Anulaciones):**

Al anular un comprobante en Supabase PostgreSQL:

1. El estado de la factura se revierte a `PENDIENTE` o se restauran los saldos adeudados originales.
2. Los valores recaudados se restan del cuadre del día.
3. Se genera un contraasiento en la tabla de auditoría con la fecha, hora, motivo de anulación y usuario administrador responsable.

---

### startuml

## DIAGRAMA DETALLADO DE CASOS DE USO DE NIVEL 2 (PLANTUML)

```
@startuml
left to right direction
skinparam packageStyle rectangle
skinparam shadowing false
skinparam roundcorner 8

actor "Cajero / Secretario" as Cajero
actor "Administrador / Directiva" as Admin
actor "Servidor Cloud (Supabase)" as Cloud <<Secondary>>

rectangle "Módulo 3: Caja y Cobros (Nivel 2)" {
    usecase "CU-31: Buscar Socio y Consultar Deudas" as CU31
    usecase "CU-32: Seleccionar Rubros y Liquidar" as CU32
    usecase "CU-33: Registrar Cobro (Total o Abono FIFO)" as CU33
    usecase "CU-34: Emitir Comprobante con Gráfico Histórico" as CU34
    usecase "CU-35: Gestionar Multas Comunitarias" as CU35
    usecase "CU-36: Registrar Egreso de Caja Chica" as CU36
    usecase "CU-37: Imprimir Cuadre Diario de Caja" as CU37
    usecase "CU-38: Consultar Historial y Reimprimir" as CU38
    usecase "CU-39: Anular Factura en la Nube" as CU39
}

Cajero --> CU31
Cajero --> CU32
Cajero --> CU33
Cajero --> CU34
Cajero --> CU35
Cajero --> CU36
Cajero --> CU37
Cajero --> CU38

Admin --> CU31
Admin --> CU32
Admin --> CU33
Admin --> CU34
Admin --> CU37
Admin --> CU38
Admin --> CU39

CU32 ..> CU31 : <<include>>
CU33 ..> CU32 : <<include>>
CU33 ..> CU34 : <<include>>
CU37 ..> CU36 : <<include>>
CU39 ..> CU38 : <<include>>

CU31 <--> Cloud : GET /api/v1/socios & deudas
CU33 <--> Cloud : POST /api/v1/facturas/cobrar
CU35 <--> Cloud : POST/PUT/DELETE /api/v1/multas
CU36 <--> Cloud : POST /api/v1/caja/egreso
CU37 <--> Cloud : GET /api/v1/caja/resumen
CU39 <--> Cloud : DELETE /api/v1/facturas/:id
@enduml
```

---

## HISTORIAS DE USUARIO (HU - FORMATO ÁGIL)

### HU-301: Búsqueda Rápida de Socio en Ventanilla

**Como** Cajero / Secretario

**Quiero** buscar a un socio por su nombre, cédula o número de medidor con tolerancia a mayúsculas y acentos

**Para** acceder de inmediato a sus datos y determinar sus deudas pendientes en menos de tres segundos.

#### Criterios de Aceptación:

1. Campo de búsqueda accesible de inmediato con autofocus.
2. Búsqueda insensible a mayúsculas, minúsculas y tildes (`normalizeSearchText`).
3. Muestra una lista desplegable con las coincidencias encontradas: Código, Nombre Completo, Cédula, Sector y Medidor.
4. Al hacer clic o presionar Enter sobre el socio, se cargan sus consumos del mes y deudas pendientes.

---

### HU-302: Consulta de Valores Pendientes y Rubros Desglosados

**Como** Cajero / Secretario

**Quiero** visualizar en pantalla la totalidad de los rubros pendientes del socio seleccionado

**Para** informar al abonado con exactitud cuánto debe por cada concepto antes de cobrar.

#### Criterios de Aceptación:

1. Despliega en tarjetas o filas independientes:
    - Consumo de agua del periodo activo (con lectura anterior, actual y consumo en $m^3$).
    - Consumos de agua pendientes de periodos anteriores.
    - Deudas históricas arrastradas.
    - Recargo de alcantarillado ($1.00 si aplica).
    - Multas y sanciones comunitarias con su descripción.
2. Presenta el saldo pendiente individual de cada concepto.
3. Muestra un badge identificando si el socio goza de tarifa `👴 Tercera Edad ($5)` o `👤 Normal ($7)`.

---

### HU-303: Selección Granular de Rubros a Cancelar

**Como** Cajero / Secretario

**Quiero** marcar o desmarcar mediante casillas de verificación (check) los rubros que el socio desea pagar

**Para** procesar cobros combinados o selectivos acordes a la disponibilidad económica del abonado.

#### Criterios de Aceptación:

1. Cada rubro pendiente dispone de un checkbox individual.
2. Casilla maestra “Seleccionar Todo” para marcar la totalidad de adeudos en un solo clic.
3. El sistema recalcula automáticamente el “Total a Cobrar” en tiempo real al marcar o desmarcar cualquier casilla.
4. Muestra un resumen del desglose antes de pasar a la ventana de confirmación del pago.

---

### HU-304: Registro de Cobro de Agua (Pago Total o Abono Parcial)

**Como** Cajero / Secretario

**Quiero** registrar el pago total o un abono parcial sobre la deuda del socio

**Para** liquidar sus consumos o amortizar su cartera vencida respetando el orden cronológico.

#### Criterios de Aceptación:

1. Permite seleccionar modalidad: “Pago Total” o “Abono Parcial”.
2. En caso de abono parcial, permite ingresar el monto en dinero que el socio entrega.
3. El sistema aplica el abono con criterio **FIFO**, amortizando primero la deuda más antigua sin alterar las facturas posteriores.
4. Actualiza inmediatamente el saldo pendiente del socio en la base de datos Supabase.
5. Si se liquida el pago de agua del periodo activo se actualiza inmediatamente descartando el check para que no se repita de nuevo el pago.

---

### HU-305: Selección de Método de Pago y Cálculo de Cambio en Efectivo

**Como** Cajero / Secretario

**Quiero** seleccionar el método de recaudación (Efectivo o Transferencia) e ingresar el monto recibido

**Para** calcular automáticamente el vuelto exacto y registrar el canal de ingreso.

#### Criterios de Aceptación:

1. Selector de método: `Efectivo` o `Transferencia Bancaria`.
2. Si se selecciona `Efectivo`, campo “Monto Recibido”: al teclear el valor entregado por el socio, calcula en vivo: `Cambio / Vuelto: $X.XX`.
3. Si el monto recibido es inferior al total a pagar, alerta en color rojo y bloquea el botón “Cobrar”.
4. Si se selecciona `Transferencia`, habilita campo obligatorio “Número de Referencia Bancaria”.

---

### HU-306: Emisión e Impresión de Factura / Comprobante Oficial de Pago

**Como** Cajero / Secretario

**Quiero** generar e imprimir el comprobante oficial inmediatamente después de confirmar el cobro

**Para** entregar un comprobante físico y transparente al socio comunitario.

#### Criterios de Aceptación:

1. Genera el recibo con formato oficial de la Junta Administradora de Pishilata.
2. Contiene: Número de recibo, datos del socio, medidor, lecturas anterior y actual, consumo en $m^3$, excedente, alcantarillado, multas y total pagado.
3. Incorpora el **código de barras vectorial SVG** generado dinámicamente.
4. Renderiza el **gráfico de barras histórico de los últimos 5 meses** y el consumo promedio.
5. Abre automáticamente el diálogo de impresión del navegador formateado para impresora de recibos o estándar.

---

### HU-307: Gestión de Multas Comunitarias y Cuotas Extraordinarias

**Como** Cajero / Secretario

**Quiero** registrar, modificar o eliminar multas asignadas a un socio

**Para** sancionar inasistencias a mingas o asambleas y mantener actualizada la cartera comunitaria.

#### Criterios de Aceptación:

1. Botón “+ Nueva Multa” en la ficha del socio.
2. Solicita: Tipo de multa (Minga, Sesión, Conexión, Disciplinaria), Descripción y Monto en dólares.
3. Permite editar el monto y concepto de multas en estado `PENDIENTE`.
4. Permite eliminar multas no cobradas con confirmación de seguridad.
5. Las multas canceladas (`PAGADO`) quedan bloqueadas contra edición o eliminación.

---

### HU-308: Consulta de Estado de Caja y Cuadre Diario

**Como** Cajero / Secretario

**Quiero** consultar los movimientos del día y generar el cuadre de cierre de jornada

**Para** entregar el dinero recaudado a la tesorería debidamente cuadrado y respaldado.

#### Criterios de Aceptación:

1. Panel “Estado de Caja Hoy” mostrando: Total Ingresos en Efectivo, Total Transferencias, Total Egresos Menores y Saldo Neto en Efectivo.
2. Botón “Imprimir Cuadre Diario” que genera un informe consolidado con fecha, hora y detalle de recibos emitidos hoy.
3. Incluye espacio para firmas de responsabilidad: “Cajero Entregante” y “Tesorero Receptor”.

---

### HU-310: Consulta de Historial, Reimpresión y Anulación de Facturas

**Como** Cajero o Administrador

**Quiero** buscar facturas emitidas anteriormente para reimprimirlas o anularlas si hubo error

**Para** resolver reclamos de socios o corregir transacciones erróneas.

#### Criterios de Aceptación:

1. Pestaña “Historial de Facturas” con buscador por socio, número de recibo o fecha.
2. Botón “👁️ Ver / Reimprimir” disponible para todos los usuarios con rol `CAJERO` y `ADMIN`.
3. Botón “🗑️ Anular Factura” visible y habilitado **únicamente para usuarios con rol `ADMIN`**.
4. Al anular, se revierte el cobro en la base de datos Supabase, se restaura la deuda original del socio y se registra la justificación en la bitácora de auditoría.
5. La busqueda debe ser reactiva, segun escribo aparece las coincidencias y si borro aparece todos.

---

## REQUISITOS FUNCIONALES FORMALES (IEEE 830)

| Identificador | Requisito Funcional | Prioridad | Origen de Código |
| --- | --- | --- | --- |
| **RF-CAJ-01** | El sistema debe permitir buscar socios en tiempo real por nombres, apellidos, cédula o medidor con normalización fonética y de acentos. | Esencial (Alta) | `caja.js:buscarSocio`, `auth.js:normalizeSearchText` |
| **RF-CAJ-02** | El sistema debe consultar y desglosar todos los valores pendientes del socio: agua periodo activo, agua periodos cerrados, deudas anteriores, alcantarillado y multas. | Esencial (Alta) | `caja.js:renderRubrosPendientes`, `GET /api/v1/socios/:id/deudas` |
| **RF-CAJ-03** | El sistema debe permitir la selección granular de rubros a liquidar mediante casillas de verificación, recalculando subtotales y el gran total en tiempo real. | Esencial (Alta) | `caja.js:updateTotalSeleccionado` |
| **RF-CAJ-04** | El sistema debe computar el valor de consumo y excedentes aplicando la base de 30 $m^3$, excedente a $0.10/m³ y tarifas de $7.00 normal vs $5.00 tercera edad. | Esencial (Alta) | `caja.js:calcularPlanillaAgua`, `waterController.ts` |
| **RF-CAJ-05** | El sistema debe soportar modalidades de Pago Total y Abono Parcial en dinero. | Esencial (Alta) | `caja.js:modalidadCobro`, `POST /api/v1/facturas/cobrar` |
| **RF-CAJ-06** | El sistema debe aplicar los abonos parciales bajo el criterio contable FIFO (imputación cronológica a la deuda más antigua sin destruir deudas posteriores). | Esencial (Alta) | `waterController.ts:procesarAbonoFIFO` |
| **RF-CAJ-07** | El sistema debe soportar métodos de recaudación en Efectivo (calculando el vuelto) y Transferencia Bancaria (solicitando referencia). | Alta | `caja.js:handleMetodoPago` |
| **RF-CAJ-08** | El sistema debe emitir comprobantes oficiales con membrete institucional, desglose de rubros, código de barras vectorial SVG y gráfico histórico de 5 periodos. | Esencial (Alta) | `comprobante.js:renderComprobanteOficial`, `comprobanteController.ts` |
| **RF-CAJ-09** | El sistema debe permitir crear, modificar y eliminar multas comunitarias no pagadas. | Alta | `caja.js:guardarMulta`, `POST/PUT/DELETE /api/v1/multas` |
| **RF-CAJ-10** | El sistema debe permitir visualizar el balance de caja | Alta | `caja.js:registrarEgresoCaja`,  `GET /api/v1/caja/balance` |
| **RF-CAJ-11** | El sistema debe calcular el balance diario de caja (ingresos, egresos, saldo en efectivo) y generar el reporte imprimible de cuadre diario con firmas. | Esencial (Alta) | `caja.js:imprimirCuadreDiario`, `GET /api/v1/caja/resumen` |
| **RF-CAJ-12** | El sistema debe permitir al rol `ADMIN` anular facturas cobradas, revirtiendo el cobro, restaurando la deuda del socio y registrando la auditoría. | Alta | `caja.js:anularFactura`, `DELETE /api/v1/facturas/:id` |

---

## REQUISITOS NO FUNCIONALES ESPECÍFICOS (RNF - IEEE 830)

| Identificador | Requisito No Funcional | Métrica / Criterio Verificable |
| --- | --- | --- |
| **RNF-CAJ-01** | **Latencia de Transacción de Cobro:** La liquidación y confirmación del pago en la API REST hacia Supabase PostgreSQL debe completarse en menos de **450 ms** bajo condiciones estándar de red. |  |
| **RNF-CAJ-02** | **Integridad Transaccional ACID:** El cobro de factura y la distribución hacia los 7 fondos comunitarios deben ejecutarse dentro de una única transacción atómica; si cualquier asiento falla, se revierte toda la operación sin alterar saldos ni emitir recibo y se avisa en el frontend emotivo del error. |  |
| **RNF-CAJ-03** | **Seguridad y Control de Acceso (RBAC):** La recaudación diaria está autorizada para `CAJERO` y `ADMIN`. La anulación de comprobantes de pago está restringida de forma inviolable y exclusiva para el rol `ADMIN`. |  |
| **RNF-CAJ-04** | **Fidelidad y Compatibilidad de Impresión:** El comprobante emitido debe adaptarse automáticamente a impresoras para hojas a4 en sentido vertical. |  |
| **RNF-CAJ-05** | **Idempotencia Transaccional:** El sistema debe prevenir cobros dobles accidentales mediante el bloqueo del botón “Confirmar Cobro” tras el primer clic y asignación de identificador único de transacción. |  |

---