import fs from 'node:fs';
import path from 'node:path';

/**
 * Cargador ligero y automático de variables de entorno desde archivos .env
 * Sin dependencias externas, compatible con Node.js nativo.
 */
export function loadEnv(): void {
  const possiblePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps', 'server', '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(process.cwd(), '..', '..', '.env')
  ];

  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        const lines = content.split(/\r?\n/);

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith('#')) continue;

          const eqIdx = line.indexOf('=');
          if (eqIdx === -1) continue;

          const key = line.slice(0, eqIdx).trim();
          let val = line.slice(eqIdx + 1).trim();

          // Remover comillas envolventes si existen
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1).trim();
          }

          // Solo asignar si tiene un valor real (no vacío)
          if (val.length > 0) {
            process.env[key] = val;
          }
        }

        console.log(`🔧 [Env] Variables cargadas correctamente desde: ${envPath}`);
        return;
      } catch (err) {
        console.warn(`[Env] Advertencia al leer archivo ${envPath}:`, err);
      }
    }
  }
}

// Ejecución automática al importar este módulo
loadEnv();
