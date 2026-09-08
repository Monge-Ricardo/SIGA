import { Router } from '../core/http.ts';
import { handleBatchSync, handlePush, handlePull, getSyncStatus, syncWithSupabase } from '../controllers/syncController.ts';

export const syncRouter = new Router();

syncRouter.post('/', handleBatchSync);
syncRouter.post('/push', handlePush);
syncRouter.get('/pull', handlePull);
syncRouter.get('/status', getSyncStatus);
syncRouter.post('/supabase', syncWithSupabase);


