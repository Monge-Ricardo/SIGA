# Esquema de Base de Datos (Local IndexedDB vs Central)

## 1. Esquema Local IndexedDB (`AppAguaLocalDB`)

### Tabla `clientes`
| Campo | Tipo | Índice | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | PK | Clave primaria generada localmente |
| `codigoCliente` | `string` | INDEX | Código único de suscriptor (ej. SEC-01-04) |
| `nombreCompleto` | `string` | - | Nombre del titular |
| `identificacion` | `string` | - | DNI / Cédula / RFC |
| `sectorId` | `string` | INDEX | Sector o ruta de distribución |
| `tarifaId` | `string` | - | Identificador de tarifa asignada |
| `medidorNumero` | `string` | - | Número de serie del medidor físico |
| `estado` | `string` | INDEX | `ACTIVO`, `SUSPENDIDO`, `INACTIVO` |
| `updatedAt` | `string` | INDEX | Timestamp ISO para deltas |
| `version` | `number` | - | Número de versión para LWW |

### Tabla `lecturas`
| Campo | Tipo | Índice | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | PK | Identificador único de lectura |
| `clienteId` | `string` | INDEX | Suscriptor |
| `periodo` | `string` | INDEX | Periodo de facturación `YYYY-MM` |
| `lecturaAnterior`| `number` | - | Metros cúbicos previos |
| `lecturaActual` | `number` | - | Metros cúbicos medidos |
| `consumoM3` | `number` | - | `lecturaActual - lecturaAnterior` |
| `fechaLectura` | `string` | INDEX | Fecha de toma física |
| `observaciones` | `string` | - | Novedades o anomalías |

### Tabla `cobros`
| Campo | Tipo | Índice | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | PK | Identificador único del recibo |
| `numeroRecibo` | `string` | INDEX | Folio de recibo impreso/digital |
| `clienteId` | `string` | INDEX | Suscriptor cobrado |
| `montoTotal` | `number` | - | Importe total liquidado |
| `estado` | `string` | INDEX | `PENDIENTE`, `PAGADO`, `ANULADO` |
| `fechaVencimiento` | `string` | INDEX | Límite de pago |
| `fechaPago` | `string` | - | Fecha de transacción efectiva |
| `metodoPago` | `string` | - | `EFECTIVO`, `TRANSFERENCIA`, `MOVIL` |

### Tabla `movimientos_caja`
| Campo | Tipo | Índice | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | PK | Identificador de transacción de caja |
| `tipo` | `string` | INDEX | `ENTRADA` o `SALIDA` |
| `categoria` | `string` | INDEX | Motivo del flujo financiero |
| `monto` | `number` | - | Cantidad monetaria |
| `descripcion` | `string` | - | Detalle del gasto/ingreso |
| `fecha` | `string` | INDEX | Timestamp de la operación |
| `responsableId`| `string` | INDEX | Usuario que realizó el movimiento |

### Tabla `sync_queue` (Outbox)
| Campo | Tipo | Índice | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | PK | Identificador de la mutación |
| `entity` | `string` | INDEX | `clientes`, `lecturas`, `cobros`, `movimientos_caja` |
| `entityId` | `string` | - | ID del registro local |
| `action` | `string` | - | `CREATE`, `UPDATE`, `DELETE` |
| `payload` | `object` | - | Datos completos para sincronizar |
| `status` | `string` | INDEX | `PENDING`, `SYNCING`, `SYNCED`, `FAILED` |
| `localTimestamp`| `string`| INDEX | Momento en que ocurrió fuera de línea |
| `retryCount` | `number` | INDEX | Conteo de reintentos |
