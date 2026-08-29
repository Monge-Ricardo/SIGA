# Arquitectura del Sistema App Agua (Offline-First)

## 1. Visión General
El sistema está diseñado bajo el paradigma **Local-First / Offline-First**. El cliente (navegador/PWA) no depende de la red para permitir a los usuarios registrar lecturas de medidores, emitir recibos de cobro de agua, o registrar entradas y salidas de caja. Toda la persistencia primaria ocurre en **IndexedDB** local, respondiendo a la UI en menos de 50 ms.

```
+-------------------------------------------------------------+
|                      CLIENTE (PWA)                          |
|                                                             |
|   +--------------------+          +---------------------+   |
|   |  UI (Components)   | <------> | IndexedDB (Dexie)   |   |
|   +--------------------+  <50ms   | - clientes          |   |
|             |                     | - lecturas          |   |
|             v (Encolar)           | - cobros            |   |
|   +--------------------+          | - movimientos_caja  |   |
|   | sync_queue (Outbox)| <--------+---------------------+   |
|   +--------------------+                                    |
|             | (Segundo plano)                               |
|             v                                               |
|   +--------------------+                                    |
|   | OutboxSyncEngine   |                                    |
|   +--------------------+                                    |
+-------------|-----------------------------------------------+
              |
              | POST /api/v1/sync (Batch Deltas cuando hay red)
              v
+-------------------------------------------------------------+
|                     SERVIDOR CENTRAL                        |
|                                                             |
|   +--------------------+          +---------------------+   |
|   | Express / Fastify  | -------> | ConflictResolver    |   |
|   | (SyncController)   |          | (Last-Write-Wins)   |   |
|   +--------------------+          +---------------------+   |
|             |                                               |
|             v                                               |
|   +-----------------------------------------------------+   |
|   | Base de Datos Central (PostgreSQL / SQLite)         |   |
|   +-----------------------------------------------------+   |
+-------------------------------------------------------------+
```

## 2. Flujo de Datos y Patrón Outbox
1. **Escritura Local:** El operador realiza una acción (ej. Registrar Cobro de $15.00).
2. **Transacción Atómica:** Se guarda en la tabla `cobros` de IndexedDB y simultáneamente se crea un registro con estado `PENDING` en `sync_queue`.
3. **Optimistic UI:** La interfaz se actualiza de inmediato (<50ms).
4. **Sincronización por Lotes:** Cuando el navegador detecta conexión `online`:
   * Toma hasta 50 mutaciones `PENDING`.
   * Envía un único payload JSON comprimido a `POST /api/v1/sync`.
   * El servidor resuelve conflictos y responde con reconocimientos (`acks`) y deltas generados por otros usuarios.
   * El cliente marca las mutaciones como `SYNCED` o resuelve conflictos locales.
