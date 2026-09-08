import { Router } from '../core/http.ts';
import { handleBatchSync, getSyncStatus, syncWithSupabase } from '../controllers/syncController.ts';

export const syncRouter = new Router();

syncRouter.post('/', handleBatchSync);
syncRouter.post('/push', handleBatchSync);
syncRouter.get('/status', getSyncStatus);
syncRouter.post('/supabase', syncWithSupabase);

