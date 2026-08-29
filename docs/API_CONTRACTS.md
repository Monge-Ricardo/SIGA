# Contratos de API REST (/api/v1)

## 1. Endpoint Central de Sincronización

### `POST /api/v1/sync`
Recibe un lote de mutaciones acumuladas por el cliente fuera de línea y retorna confirmaciones más datos actualizados del servidor.

#### Request Body
```json
{
  "clientId": "terminal-caja-01",
  "lastSyncTimestamp": "2026-08-29T12:00:00.000Z",
  "mutations": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "entity": "cobros",
      "entityId": "recibo-1002",
      "action": "CREATE",
      "payload": {
        "id": "recibo-1002",
        "numeroRecibo": "REC-2026-0089",
        "clienteId": "cli-01",
        "montoTotal": 25.50,
        "estado": "PAGADO",
        "fechaPago": "2026-08-29T12:15:00.000Z"
      },
      "localTimestamp": "2026-08-29T12:15:05.000Z",
      "status": "PENDING",
      "retryCount": 0,
      "version": 1
    }
  ]
}
```

#### Response Body (200 OK)
```json
{
  "serverTimestamp": "2026-08-29T12:16:00.000Z",
  "acks": [
    {
      "mutationId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "entityId": "recibo-1002",
      "status": "ACCEPTED",
      "serverVersion": 1
    }
  ],
  "incomingUpdates": {
    "clientes": [],
    "lecturas": [],
    "cobros": [],
    "movimientos_caja": []
  }
}
```

---

## 2. Endpoints Operativos Directos
* `GET /api/v1/health` - Estado de salud y conectividad del servidor.
* `GET /api/v1/water/clientes` - Catálogo maestro de suscriptores de agua.
* `GET /api/v1/water/lecturas` - Listado histórico de lecturas.
* `GET /api/v1/water/cobros` - Recibos emitidos y cobrados.
* `GET /api/v1/finance/movimientos` - Registro de entradas y salidas de caja.
* `GET /api/v1/finance/balance` - Resumen de balance neto en un rango de fechas.
