import './core/env.ts';
import { express } from './core/http.ts';
import { apiRouter } from './routes/apiRoutes.ts';
import { errorHandler } from './middlewares/errorHandler.ts';
import { centralDb } from './db/connection.ts';

const app = express();
const PORT = process.env.PORT || 4000;

app.setErrorHandler(errorHandler);
app.use('/api/v1', apiRouter);

app.get('/', (_req, res) => {
  res.json({
    sistema: 'Sistema de Gestión de Agua Potable y Alcantarillado Comunitario (SIGA-Comunitario)',
    version: '1.0.0',
    documentacion_api: '/api/v1/health',
    entorno: process.env.NODE_ENV || 'development',
    supabaseConectado: centralDb.cloud.isEnabled()
  });
});

centralDb.connect().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 [Server] SIGA-Comunitario Backend escuchando en http://localhost:${PORT}`);
    console.log(`📡 [API] Endpoints base listos en http://localhost:${PORT}/api/v1`);
  });
});
