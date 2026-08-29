import { db } from '../db/indexedDB.ts';
import type { SyncMutation, SyncBatchRequest, SyncBatchResponse } from '@app-agua/shared';

export class OutboxSyncEngine {
  private isSyncing = false;
  private syncIntervalMs = 15000; // 15s debounce
  private retryDelayMs = 2000; // Backoff base
  private timerId: number | null = null;

  constructor() {
    this.initNetworkListeners();
  }

  private initNetworkListeners() {
    window.addEventListener('online', () => {
      console.log('[SyncEngine] Conexión detectada. Disparando sincronización por lotes...');
      this.triggerSync();
    });

    window.addEventListener('offline', () => {
      console.log('[SyncEngine] Dispositivo fuera de línea. Las mutaciones se guardarán en outbox local.');
    });
  }

  public async enqueueMutation<T>(
    entity: SyncMutation['entity'],
    entityId: string,
    action: SyncMutation['action'],
    payload: T
  ): Promise<string> {
    const mutationId = crypto.randomUUID();
    const mutation: SyncMutation<T> = {
      id: mutationId,
      entity,
      entityId,
      action,
      payload,
      localTimestamp: new Date().toISOString(),
      status: 'PENDING',
      retryCount: 0,
      version: 1
    };

    await db.sync_queue.add(mutation);
    console.log(`[SyncEngine] Mutación encolada: ${entity} [${action}] (${mutationId})`);

    if (navigator.onLine) {
      this.triggerSync();
    }

    return mutationId;
  }

  public async triggerSync(): Promise<void> {
    if (this.isSyncing || !navigator.onLine) return;

    this.isSyncing = true;
    try {
      const pendingMutations = await db.sync_queue
        .where('status')
        .equals('PENDING')
        .toArray();

      if (pendingMutations.length === 0) {
        this.isSyncing = false;
        return;
      }

      console.log(`[SyncEngine] Procesando lote de ${pendingMutations.length} mutaciones...`);

      // Marcar temporalmente como SYNCING
      await db.sync_queue
        .where('id')
        .anyOf(pendingMutations.map((m) => m.id))
        .modify({ status: 'SYNCING' });

      // Simulación o llamada real a backend /api/v1/sync
      // const response = await fetch('/api/v1/sync', { method: 'POST', body: JSON.stringify(...) });
      
    } catch (error) {
      console.error('[SyncEngine] Error en sincronización por lotes:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  public async getPendingCount(): Promise<number> {
    return await db.sync_queue
      .where('status')
      .anyOf(['PENDING', 'SYNCING', 'FAILED'])
      .count();
  }
}

export const syncEngine = new OutboxSyncEngine();
