import { Router } from '../core/http.ts';
import { handleBatchSync } from '../controllers/syncController.ts';

export const syncRouter = new Router();

syncRouter.post('/', handleBatchSync);
