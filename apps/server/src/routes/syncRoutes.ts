import { Router } from '../core/http.ts';
import { handleBatchSync, handlePush, handlePull, getSyncStatus, syncWithSupabase, handleCloudPush, handleSupabaseProxy } from '../controllers/syncController.ts';

export const syncRouter = new Router();

syncRouter.post('/', handleBatchSync);
syncRouter.post('/push', handlePush);
syncRouter.get('/pull', handlePull);
syncRouter.get('/status', getSyncStatus);
syncRouter.post('/supabase', syncWithSupabase);
syncRouter.post('/cloud-push', handleCloudPush);
syncRouter.get('/proxy', handleSupabaseProxy);
syncRouter.post('/proxy', handleSupabaseProxy);
syncRouter.patch('/proxy', handleSupabaseProxy);
syncRouter.put('/proxy', handleSupabaseProxy);
syncRouter.delete('/proxy', handleSupabaseProxy);


