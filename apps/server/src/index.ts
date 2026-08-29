import './core/env.ts';
import path from 'node:path';
import { express } from './core/http.ts';
import { apiRouter } from './routes/apiRoutes.ts';
import { errorHandler } from './middlewares/errorHandler.ts';
import { centralDb } from './db/connection.ts';

const app = express();
const PORT = process.env.PORT || 4000;

app.setErrorHandler(errorHandler);

// Servir la aplicación Web Frontend desde la carpeta demo
app.serveStatic(path.resolve(process.cwd(), 'demo'));
app.serveStatic(path.resolve(process.cwd(), '..', '..', 'demo'));
app.serveStatic(path.resolve(process.cwd(), 'apps', 'client', 'public'));

// Enrutador de API REST
app.use('/api/v1', apiRouter);

centralDb.connect().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 [Server] SIGA-Comunitario Backend escuchando en http://localhost:${PORT}`);
    console.log(`💻 [Web App] Aplicación Web Frontend disponible en http://localhost:${PORT}`);
    console.log(`📡 [API] Endpoints base listos en http://localhost:${PORT}/api/v1`);
  });
});
