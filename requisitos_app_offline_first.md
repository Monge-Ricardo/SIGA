# Especificación de Requisitos de Software (SRS)
## Sistema Multiplataforma Offline-First para Entornos de Bajos Recursos

---

### 1. Resumen Ejecutivo y Restricciones del Entorno
El sistema debe operar de forma ininterrumpida en hardware de gama de entrada (**Intel Celeron J3060 @ 1.60 GHz, 4 GB RAM, Windows 10**) y bajo condiciones de conectividad inestable o de baja señal (alta latencia, pérdida de paquetes y caídas frecuentes). La arquitectura debe priorizar la persistencia local y el bajo consumo de memoria/CPU.

---

### 2. Requisitos No Funcionales (RNF)

#### 2.1. Rendimiento y Recursos
* **RNF-01 (Consumo de Memoria):** El cliente de escritorio/web no debe exceder los **150–200 MB de RAM** en ejecución activa.
* **RNF-02 (Uso de CPU):** Los hilos de sincronización en segundo plano no deben superar el **15% de uso de CPU** sostenido para evitar congelamientos en procesadores de 2 núcleos.
* **RNF-03 (Bundle Size):** El paquete estático inicial (HTML, JS, CSS y assets) no debe superar los **2 MB** comprimidos (Gzip/Brotli).
* **RNF-04 (Tiempo de Respuesta UI):** Todas las operaciones de lectura y escritura local deben responder en **menos de 50 ms** en la interfaz (0 ms de bloqueo de red).

#### 2.2. Conectividad y Red
* **RNF-05 (Autonomía Offline):** El 100% de las operaciones operativas cotidianas (creación, edición, consulta y eliminación lógica) deben funcionar sin conexión a internet.
* **RNF-06 (Tolerancia a Fallos de Red):** La aplicación debe manejar desconexiones a mitad de transferencia sin corromper datos ni duplicar registros.
* **RNF-07 (Eficiencia de Ancho de Banda):** La sincronización debe enviar únicamente *deltas* (cambios incrementales) comprimidos en JSON o MessagePack.

#### 2.3. Compatibilidad y Despliegue
* **RNF-08 (Compatibilidad Desktop/Web):** Ejecución fluida en navegadores modernos basados en Chromium (Edge/Chrome) mediante PWA o WebView2 liviano (Tauri).
* **RNF-09 (Compatibilidad Móvil):** Soporte para dispositivos móviles con arquitectura React Native o PWA responsiva.

---

### 3. Requisitos Funcionales (RF)

#### 3.1. Gestión de Datos y Almacenamiento Local
* **RF-01 (Base de Datos Local 100% Autónoma):** Implementar persistencia completa en el cliente mediante **IndexedDB** (`siga_offline_db`), garantizando lecturas y escrituras en <50ms sin intermediarios ni dependencias de SQLite.
* **RF-02 (Cache-First para Assets):** Almacenar en caché todos los componentes estáticos (fuentes, SVGs, scripts) mediante Service Workers para permitir el arranque en frío sin conexión.
* **RF-03 (Identificadores Distribuidos):** Generar claves primarias localmente mediante **UUIDv4 / CUID / ULID** para evitar colisiones de IDs autoincrementales durante la creación offline.

#### 3.2. Sincronización y Cola de Salida (Outbox Pattern)
* **RF-04 (Cola de Mutaciones):** Toda acción de escritura debe registrar un evento en una tabla local `sync_queue` con estados: `PENDING`, `SYNCING`, `SYNCED`, `FAILED`.
* **RF-05 (Sincronización por Lotes):** Agrupar múltiples mutaciones locales y enviarlas en una única petición HTTP en segundo plano cuando se detecte conexión estable.
* **RF-06 (Reintentos con Backoff Exponencial):** En caso de timeout o fallo de red, reintentar la sincronización aplicando intervalos incrementales con *jitter* (ej. 2s, 5s, 15s, 60s).
* **RF-07 (Resolución de Conflictos):** Implementar estrategia determinista de resolución (ej. *Last-Write-Wins* con timestamps confiables o campos de versión/revisión).

#### 3.3. Interfaz de Usuario y Experiencia (UX)
* **RF-08 (Indicador de Estado de Conectividad):** Mostrar un componente visual no intrusivo con el estado de red (`En línea`, `Sin conexión`, `Sincronizando`, `Cambios pendientes`).
* **RF-09 (Optimistic UI):** Reflejar los cambios en pantalla inmediatamente tras la acción del usuario, sin esperar respuesta del servidor central.
* **RF-10 (Gestión de Recursos Multimedia):** Desacoplar la subida de metadatos de los archivos pesados/imágenes; encolar y comprimir imágenes localmente antes del envío.

---

### 4. Matriz de Stack Técnico (Arquitectura de 2 Capas)

| Componente | Opción Implementada | Alternativa Viable | Descartado para este Entorno |
| :--- | :--- | :--- | :--- |
| **Desktop / Web** | PWA (HTML5 + Vanilla JS / Vite) | Tauri (WebView2 + Rust) | Electron (Excesivo uso de RAM/CPU) |
| **Móvil** | Android WebView / PWA Offline | React Native | WebViews embebidos sin caché local |
| **BD Local (Capa 1)** | IndexedDB (`siga_offline_db`) | Dexie.js wrapper | SQLite embebido (eliminado para simplificar a 2 capas) |
| **BD Central (Capa 2)** | Supabase (PostgreSQL Cloud) | PostgreSQL Administrado | Bases de datos relacionales locales intermedias |
| **Estrategia Caché** | Workbox (Service Worker) | CacheStorage API nativa | Carga dinámica por CDN remota |
| **Protocolo Sync** | REST / Batch Deltas + CORS Proxy | WebSockets ligeros | GraphQL sobrecargado / Polling corto |
