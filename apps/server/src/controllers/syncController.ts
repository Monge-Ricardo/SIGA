import { Request, Response } from 'express';
import type { SyncBatchRequest, SyncBatchResponse, SyncAck } from '@app-agua/shared';
import { ConflictResolver } from '../services/conflictResolver.js';

export const handleBatchSync = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId, lastSyncTimestamp, mutations } = req.body as SyncBatchRequest;

    if (!clientId || !Array.isArray(mutations)) {
      res.status(400).json({ error: 'Formato de sincronización inválido.' });
      return;
    }

    const acks: SyncAck[] = [];

    // Procesar lote de mutaciones entrantes
    for (const mutation of mutations) {
      const resolution = ConflictResolver.resolveLWW(mutation, undefined);
      acks.push(resolution.ack);
    }

    const response: SyncBatchResponse = {
      serverTimestamp: new Date().toISOString(),
      acks,
      incomingUpdates: {
        clientes: [],
        lecturas: [],
        cobros: [],
        movimientos_caja: []
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('[SyncController] Error procesando lote:', error);
    res.status(500).json({ error: 'Error interno procesando sincronización.' });
  }
};
