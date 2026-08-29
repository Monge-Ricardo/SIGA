# 💧 App Agua - Sistema Offline-First para Cobro de Agua y Flujo de Caja

Sistema de gestión comunitaria de agua potable y control de ingresos/egresos de caja, diseñado con arquitectura **Offline-First (Local-First)** para entornos de bajos recursos (Intel Celeron, 4 GB RAM, Windows 10/Chromium).

---

## 👥 Estructura de Roles del Equipo

| Rol | Directorio de Trabajo | Responsabilidad Principal |
| :--- | :--- | :--- |
| **Desarrollador 1 (Frontend)** | `apps/client/` | PWA, IndexedDB (Dexie), Outbox Queue, Optimistic UI (<50ms), Service Worker. |
| **Desarrollador 2 (Backend)** | `apps/server/` | API REST `/api/v1/sync`, resolución de conflictos Last-Write-Wins, persistencia central. |
| **Contratos Comunes** | `packages/shared/` | Modelos de dominio (`ClienteAgua`, `CobroRecibo`, `MovimientoCaja`), DTOs y validaciones. |

---

## 🌳 Estrategia de Ramas Git
* `main`: Rama de producción estable.
* `develop`: Rama principal de integración.
* `feat/frontend-scaffold`: Espacio de trabajo del desarrollador Frontend.
* `feat/backend-scaffold`: Espacio de trabajo del desarrollador Backend.

---

## 🚀 Inicio Rápido

### 1. Ver el Prototipo en el Navegador (Sin dependencias externas)
Puedes abrir el demostrador interactivo en cualquier navegador:
```powershell
Start-Process "demo\index.html"
```

### 2. Estructura del Monorepo
```
app_agua/
├── apps/
│   ├── client/          # Frontend PWA (Vite + TypeScript + Dexie)
│   └── server/          # Backend API (Express + TypeScript + Deltas Sync)
├── packages/
│   └── shared/          # Interfaces TypeScript y contratos compartidos
├── docs/                # Arquitectura, APIs, esquema DB y flujo de trabajo
├── demo/                # Demostrador interactivo Offline-First
└── package.json         # Configuración de workspaces monorepo
```

### 3. Documentación Técnica
* [Arquitectura del Sistema](file:///docs/ARCHITECTURE.md)
* [Contratos de API REST](file:///docs/API_CONTRACTS.md)
* [Esquemas de Base de Datos](file:///docs/DATABASE_SCHEMA.md)
* [Flujo de Trabajo del Equipo](file:///docs/TEAM_WORKFLOW.md)
