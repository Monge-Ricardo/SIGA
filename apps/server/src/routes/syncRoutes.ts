import { Router } from 'express';
import { handleBatchSync } from '../controllers/syncController.js';

export const syncRouter = Router();

// Endpoint central para recibir lote de mutaciones Outbox
syncRouter.post('/sync', handleBatchSync);
