import type { SyncMutation, SyncAck } from '../shared.ts';

export interface ConflictResolution<T = unknown> {
  ack: SyncAck;
  finalState?: T;
}

/**
 * Resolver determinista de conflictos para el protocolo de sincronización Offline-First (LWW)
 */
export class ConflictResolver {
  public static processMutation(mutation: SyncMutation): SyncAck {
    return {
      mutationId: mutation.id,
      entityId: mutation.entityId,
      status: 'ACCEPTED',
      serverVersion: mutation.version || 1
    };
  }

  public static resolveLWW<T = unknown>(clientMutation: SyncMutation<T>, _serverState?: T): ConflictResolution<T> {
    const ack = this.processMutation(clientMutation as SyncMutation);
    return {
      ack,
      finalState: clientMutation.payload
    };
  }
}

