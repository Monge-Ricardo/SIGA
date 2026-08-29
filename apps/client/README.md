# @app-agua/client (Responsabilidad Desarrollador Frontend)

Este subdirectorio contiene la aplicación PWA Offline-First para el cliente web y de escritorio.

## Principios y Restricciones
* **Consumo de Memoria:** < 150MB en ejecución activa.
* **Tiempo de respuesta UI:** < 50ms (lectura y escritura 100% en local mediante IndexedDB).
* **Bundle Size:** < 2MB comprimido.
* **Autonomía:** 100% operativo sin conexión a internet.

## Estructura de Carpetas
* `src/db/`: Esquema de IndexedDB (Dexie.js).
* `src/services/`: Motor de sincronización Outbox (`outboxEngine.ts`).
* `src/stores/`: Estado de conectividad y variables reactivas.
* `src/components/`: Componentes modulares UI.
* `src/styles/`: Hojas de estilo CSS optimizadas sin librerías pesadas.

## Comandos de Desarrollo
```bash
npm run dev      # Inicia servidor Vite en modo desarrollo
npm run build    # Compila TypeScript y genera el bundle optimizado para producción
npm run preview  # Previsualiza la compilación de producción localmente
```
