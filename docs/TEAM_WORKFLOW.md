# Guía de Trabajo en Equipo (Frontend vs Backend)

## 1. División de Responsabilidades
| Aspecto | Desarrollador 1 (Frontend) | Desarrollador 2 (Backend) |
| :--- | :--- | :--- |
| **Directorio de Trabajo** | `apps/client/` | `apps/server/` |
| **Rama de Desarrollo** | `feat/frontend-scaffold` | `feat/backend-scaffold` |
| **Dominio Principal** | UI PWA, IndexedDB (Dexie), Outbox Queue, Optimistic UI, Service Worker | API REST `/api/v1/sync`, conciliación de caja, persistencia central, LWW |
| **Contrato Común** | Consume `@app-agua/shared` | Consume e implementa `@app-agua/shared` |

## 2. Flujo de Ramas (Git Flow)
1. Nunca trabajar directamente sobre `main`.
2. Las nuevas características se desarrollan en ramas derivadas de `develop`:
   * `feat/frontend-<nombre-feature>`
   * `feat/backend-<nombre-feature>`
3. Cada desarrollador crea un Pull Request hacia `develop`.
4. El equipo realiza pruebas de integración en `develop` antes de fusionar a `main`.

## 3. Reglas de Compatibilidad
* Si un cambio requiere modificar la estructura de un dato (ej. nuevo campo en `CobroRecibo`), debe actualizarse primero en `packages/shared/src/types/` y coordinarse entre ambos desarrolladores.
