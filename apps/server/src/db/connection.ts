import { supabaseClient, SupabaseClient } from './supabase.ts';

/**
 * Gestor central de conexión a la base de datos remota (Supabase PostgreSQL).
 * Arquitectura de 2 Capas: La persistencia local reside en IndexedDB (cliente)
 * y la persistencia central reside en Supabase Cloud.
 */
export class CentralDatabase {
  private isConnected = false;
  public cloud: SupabaseClient = supabaseClient;

  public async connect(): Promise<void> {
    console.log('[CentralDB] Inicializando conexión hacia Supabase Cloud PostgreSQL...');
    this.isConnected = this.cloud.isEnabled();
  }

  public async disconnect(): Promise<void> {
    console.log('[CentralDB] Conexión cerrada.');
    this.isConnected = false;
  }

  public getStatus(): { isConnected: boolean; cloud: boolean; url: string | null } {
    return {
      isConnected: this.isConnected || this.cloud.isEnabled(),
      cloud: this.cloud.isEnabled(),
      url: this.cloud.getUrl()
    };
  }
}

export const centralDb = new CentralDatabase();

