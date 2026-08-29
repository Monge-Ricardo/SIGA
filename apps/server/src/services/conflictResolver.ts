import type { SyncMutation, SyncAck } from '@app-agua/shared';

export interface EntityRecord {
  id: string;
  version: number;
  updatedAt: string;
  [key: string]: unknown;
}

export class ConflictResolver {
  /**
   * Estrategia determinista Last-Write-Wins (LWW) basada en timestamps ISO y versiones
   */
  public static resolveLWW(
    incomingMutation: SyncMutation,
    serverRecord?: EntityRecord
  ): { shouldApply: boolean; ack: SyncAck } {
    if (!serverRecord) {
      // Registro nuevo en servidor
      return {
        shouldApply: true,
        ack: {
          mutationId: incomingMutation.id,
          entityId: incomingMutation.entityId,
          status: 'ACCEPTED',
          serverVersion: incomingMutation.version || 1
        }
      };
    }

    const serverTimestamp = new Date(serverRecord.updatedAt).getTime();
    const clientTimestamp = new Date(incomingMutation.localTimestamp).getTime();

    if (clientTimestamp >= serverTimestamp) {
      // Mutación de cliente es más reciente
      return {
        shouldApply: true,
        ack: {
          mutationId: incomingMutation.id,
          entityId: incomingMutation.entityId,
          status: 'ACCEPTED',
          serverVersion: serverRecord.version + 1
        }
      };
    } else {
      // Mutación de servidor es más reciente (Conflicto)
      return {
        shouldApply: false,
        ack: {
          mutationId: incomingMutation.id,
          entityId: incomingMutation.entityId,
          status: 'CONFLICT_RESOLVED',
          serverVersion: serverRecord.version,
          error: 'Servidor contenía una versión más reciente. Se mantuvieron los datos del servidor.'
        }
      };
    }
  }
}
