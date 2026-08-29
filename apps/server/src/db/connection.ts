import { sqliteDb, SQLiteDatabase } from './sqlite.ts';
import { supabaseClient, SupabaseClient } from './supabase.ts';

export class CentralDatabase {
  private isConnected = false;
  public local: SQLiteDatabase = sqliteDb;
  public cloud: SupabaseClient = supabaseClient;

  public async connect(): Promise<void> {
    console.log('[CentralDB] Inicializando motor de base de datos dual (SQLite Local + Supabase)...');
    this.isConnected = true;
  }

  public async disconnect(): Promise<void> {
    console.log('[CentralDB] Cerrando conexiones de base de datos.');
    this.isConnected = false;
  }

  public getStatus(): { isConnected: boolean; local: boolean; cloud: boolean } {
    return {
      isConnected: this.isConnected,
      local: true,
      cloud: this.cloud.isEnabled()
    };
  }
}

export const centralDb = new CentralDatabase();
