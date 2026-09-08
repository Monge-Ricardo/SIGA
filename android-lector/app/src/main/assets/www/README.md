# Prototipo Visual e Interactivo (Offline-First Browser Demo)

Este directorio contiene un demostrador funcional listo para abrir directamente en cualquier navegador moderno (Chrome, Edge, Firefox).

## Características del Demo
1. **Persistencia Real en IndexedDB:** Las operaciones se graban localmente en el navegador a través de transacciones atómicas.
2. **Medidor de Latencia en Vivo:** Comprueba tiempos de respuesta inferiores a **50 ms**.
3. **Simulador de Conexión (Online/Offline):** Permite alternar la conectividad con un clic para observar cómo opera la aplicación sin conexión y acumula mutaciones en estado `PENDING`.
4. **Cola de Mutaciones Outbox (`sync_queue`):** Visualización en vivo del estado de cada mutación (`PENDING` vs `SYNCED`).
5. **Manejo de Cobro de Agua y Caja:** Registro simultáneo de consumo, recibos y flujo de caja (entradas y salidas de gastos de fontanería, electricidad de bombas, etc.).

## Cómo Ejecutarlo
Simplemente abre el archivo `demo/index.html` con doble clic o ejecuta el comando:
```powershell
Start-Process "demo\index.html"
```
