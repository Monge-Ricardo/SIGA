export type MutationAction = 'CREATE' | 'UPDATE' | 'DELETE';

export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface SyncMutation<T = unknown> {
  id: string; // UUID único de la mutación en la cola
  entity: 'clientes' | 'lecturas' | 'cobros' | 'movimientos_caja';
  entityId: string; // ID del registro afectado
  action: MutationAction;
  payload: T;
  localTimestamp: string; // ISO 8601 generado por el cliente
  status: SyncStatus;
  retryCount: number;
  lastError?: string;
  version: number;
}

export interface SyncBatchRequest {
  clientId: string; // Identificador del dispositivo / cliente
  lastSyncTimestamp: string; // Timestamp de la última sincronización exitosa
  mutations: SyncMutation[];
}

export interface SyncAck {
  mutationId: string;
  entityId: string;
  status: 'ACCEPTED' | 'REJECTED' | 'CONFLICT_RESOLVED';
  serverVersion: number;
  error?: string;
}

export interface SyncBatchResponse {
  serverTimestamp: string;
  acks: SyncAck[];
  incomingUpdates: {
    clientes: unknown[];
    lecturas: unknown[];
    cobros: unknown[];
    movimientos_caja: unknown[];
  };
}
