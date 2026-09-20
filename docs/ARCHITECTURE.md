# Arquitectura del Sistema App Agua (Offline-First)

## 1. Visión General
El sistema está diseñado bajo el paradigma **Local-First / Offline-First**. El cliente (navegador/PWA) no depende de la red para permitir a los usuarios registrar lecturas de medidores, emitir recibos de cobro de agua, o registrar entradas y salidas de caja. Toda la persistencia primaria ocurre en **IndexedDB** local, respondiendo a la UI en menos de 50 ms.

```
+-------------------------------------------------------------+
|               CAPA 1: CLIENTE (PWA / ANDROID)               |
|                                                             |
|   +--------------------+          +---------------------+   |
|   |  UI (HTML5/JS/CSS) | <------> | IndexedDB           |   |
|   +--------------------+  <50ms   | (siga_offline_db)   |   |
|             |                     | - socios, medidores |   |
|             v (Encolar)           | - lecturas, facturas|   |
|   +--------------------+          | - cobros, fondos    |   |
|   | sync_queue (Outbox)| <--------+---------------------+   |
|   +--------------------+                                    |
|             | (Segundo plano)                               |
|             v                                               |
|   +--------------------+                                    |
|   | OutboxSyncEngine   |                                    |
|   +--------------------+                                    |
+-------------|-----------------------------------------------+
              |
              | POST /api/v1/sync/proxy o REST directo
              v
+-------------------------------------------------------------+
|    SERVIDOR NODE.JS (Host Estático + Proxy Transparente)    |
|   (Express: Servidor HTTP ligero y sin base de datos local)  |
+-------------------------------------------------------------+
              |
              | Conexión Segura HTTPS / REST API
              v
+-------------------------------------------------------------+
|         CAPA 2: NUBE CENTRAL (SUPABASE POSTGRESQL)          |
|                                                             |
|   - Base de Datos Relacional Central                        |
|   - Tablas canónicas: socios, medidores, lecturas,          |
|     facturas, fondos_catalogo, fondos_movimientos, etc.     |
|   - Manejo de concurrencia y respaldos automáticos          |
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
