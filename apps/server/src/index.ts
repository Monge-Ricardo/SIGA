import './core/env.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { express } from './core/http.ts';
import { apiRouter } from './routes/apiRoutes.ts';
import { errorHandler } from './middlewares/errorHandler.ts';

const app = express();
const PORT = process.env.PORT || 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.setErrorHandler(errorHandler);

// Servir la aplicación Web Frontend desde apps/client/dist, apps/client y demo
const rootDir = path.resolve(__dirname, '..', '..', '..');
const clientDir = path.resolve(__dirname, '..', '..', 'client');
const clientDist = path.resolve(clientDir, 'dist');
const demoDir = path.resolve(rootDir, 'demo');

[clientDist, clientDir, demoDir, path.resolve(process.cwd(), 'apps', 'client'), path.resolve(process.cwd(), 'demo')].forEach((dir) => {
  app.serveStatic(dir);
});

// Enrutador de API REST
app.use('/api/v1', apiRouter);

app.listen(PORT, () => {
  console.log(`🚀 [Server] SIGA-Comunitario Backend escuchando en http://localhost:${PORT}`);
  console.log(`💻 [Web App] Aplicación Web Frontend disponible en http://localhost:${PORT}`);
  console.log(`☁️ [Cloud DB] Conexión directa a Supabase Cloud REST API activa`);
});
