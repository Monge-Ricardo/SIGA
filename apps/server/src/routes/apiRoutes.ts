import { Router } from 'express';
import { syncRouter } from './syncRoutes.js';
import { getClientes, getLecturas, getCobros } from '../controllers/waterController.js';
import { getMovimientosCaja, getBalanceResumen } from '../controllers/financeController.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

apiRouter.use('/sync', syncRouter);
apiRouter.get('/water/clientes', getClientes);
apiRouter.get('/water/lecturas', getLecturas);
apiRouter.get('/water/cobros', getCobros);
apiRouter.get('/finance/movimientos', getMovimientosCaja);
apiRouter.get('/finance/balance', getBalanceResumen);
