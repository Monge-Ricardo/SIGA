import type { Request, Response } from '../core/http.ts';
import type { SyncBatchRequest, SyncBatchResponse, SyncAck } from '../shared.ts';
import { ConflictResolver } from '../services/conflictResolver.ts';
import { socioService } from '../services/socioService.ts';
import { lecturaService } from '../services/lecturaService.ts';
import { facturacionService } from '../services/facturacionService.ts';
import { fondosService } from '../services/fondosService.ts';

export const handleBatchSync = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId, lastSyncTimestamp, mutations } = (req.body || {}) as SyncBatchRequest;

    if (!clientId || !Array.isArray(mutations)) {
      res.status(400).json({ error: 'Formato de sincronización inválido. Se requiere clientId y array de mutations.' });
      return;
    }

    const acks: SyncAck[] = [];

    // 1. Procesar cada mutación entrante mediante ConflictResolver (LWW)
    for (const mutation of mutations) {
      const resolution = ConflictResolver.resolveLWW(mutation, undefined);
      acks.push(resolution.ack);
    }

    // 2. Extraer deltas/actualizaciones generadas en el servidor
    const socios = socioService.getSocios();
    const lecturas = lecturaService.getLecturas();
    const facturas = facturacionService.getFacturas();
    const movimientos = fondosService.getLibroMayor();

    const response: SyncBatchResponse = {
      serverTimestamp: new Date().toISOString(),
      acks,
      incomingUpdates: {
        clientes: socios,
        lecturas: lecturas,
        cobros: facturas,
        movimientos_caja: movimientos
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('[SyncController] Error procesando lote de sincronización:', error);
    res.status(500).json({ error: 'Error interno procesando sincronización.' });
  }
};
