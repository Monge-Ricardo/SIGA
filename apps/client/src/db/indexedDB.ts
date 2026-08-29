import Dexie, { type Table } from 'dexie';
import type {
  ClienteAgua,
  LecturaMedidor,
  CobroRecibo,
  MovimientoCaja,
  SyncMutation
} from '@app-agua/shared';

export interface AppMetadata {
  key: string;
  value: unknown;
}

export class AppAguaDatabase extends Dexie {
  clientes!: Table<ClienteAgua, string>;
  lecturas!: Table<LecturaMedidor, string>;
  cobros!: Table<CobroRecibo, string>;
  movimientos_caja!: Table<MovimientoCaja, string>;
  sync_queue!: Table<SyncMutation, string>;
  metadata!: Table<AppMetadata, string>;

  constructor() {
    super('AppAguaLocalDB');

    // Esquema de persistencia local optimizado para bajo consumo
    this.version(1).stores({
      clientes: 'id, codigoCliente, sectorId, estado, updatedAt',
      lecturas: 'id, clienteId, periodo, fechaLectura, updatedAt',
      cobros: 'id, numeroRecibo, clienteId, periodo, estado, fechaVencimiento',
      movimientos_caja: 'id, tipo, categoria, fecha, responsableId',
      sync_queue: 'id, entity, status, localTimestamp, retryCount',
      metadata: 'key'
    });
  }
}

export const db = new AppAguaDatabase();
