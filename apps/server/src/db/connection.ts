/**
 * Conector de Base de Datos Central (PostgreSQL / SQLite para desarrollo)
 */
export interface CentralDBConfig {
  connectionString?: string;
  maxConnections: number;
}

export class CentralDatabase {
  private isConnected = false;

  public async connect(): Promise<void> {
    console.log('[CentralDB] Conectando a base de datos central de sincronización...');
    this.isConnected = true;
  }

  public async disconnect(): Promise<void> {
    console.log('[CentralDB] Desconectado de base de datos.');
    this.isConnected = false;
  }

  public getStatus(): boolean {
    return this.isConnected;
  }
}

export const centralDb = new CentralDatabase();
