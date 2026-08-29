# @app-agua/server (Responsabilidad Desarrollador Backend)

Este subdirectorio contiene la API REST central para la recepción de deltas y sincronización de datos.

## Principios y Responsabilidades
* **Sincronización por Lotes:** Endpoint `/api/v1/sync` procesa conjuntos de mutaciones encoladas por clientes.
* **Resolución de Conflictos:** Algoritmo determinista Last-Write-Wins (LWW) en `src/services/conflictResolver.ts`.
* **Conciliación de Caja y Agua:** Procesamiento de cobros y flujos de caja.
* **Bajo Consumo de Ancho de Banda:** Respuestas comprimidas con Gzip/Brotli (`compression`) y payload en JSON mínimo.

## Comandos de Desarrollo
```bash
npm run dev    # Inicia el servidor con recarga en caliente vía tsx
npm run build  # Compila el código a JavaScript estándar en dist/
npm start      # Arranca el servidor de producción compilado
```
