import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { apiRouter } from './routes/apiRoutes.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { centralDb } from './db/connection.js';

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares de seguridad y optimización de ancho de banda
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/v1', apiRouter);
app.use(errorHandler);

centralDb.connect().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 [Server] Backend Offline-First escuchando en http://localhost:${PORT}`);
  });
});
