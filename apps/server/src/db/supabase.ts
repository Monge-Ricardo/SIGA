import '../core/env.ts';

/**
 * Cliente de integración y sincronización con Supabase PostgreSQL
 */
export interface SupabaseConfig {
  url?: string;
  apiKey?: string;
  enabled: boolean;
}

export class SupabaseClient {
  private url: string | null = null;
  private apiKey: string | null = null;
  private secretKey: string | null = null;
  private publishableKey: string | null = null;
  private isConfigured = false;

  constructor() {
    this.reloadConfig();
  }

  public reloadConfig(): void {
    this.url = process.env.SUPABASE_URL || null;

    // Soporte para nombres nuevos de Supabase (PUBLISHABLE / SECRET) y clásicos (ANON / SERVICE_ROLE)
    this.secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
    this.publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || null;

    // Preferir la Secret Key (Service Role) para operaciones de backend y sync
    this.apiKey = this.secretKey || this.publishableKey || null;
    this.isConfigured = Boolean(this.url && this.apiKey);

    if (this.isConfigured) {
      console.log(`📡 [Supabase] Configurado y listo para sincronizar con: ${this.url}`);
    } else {
      console.log('ℹ️ [Supabase] Modo 100% Offline / SQLite local activo (SUPABASE_URL no configurada).');
    }
  }

  public isEnabled(): boolean {
    return this.isConfigured;
  }

  public getUrl(): string | null {
    return this.url;
  }

  /**
   * Ejecuta una consulta REST a Supabase
   */
  public async request<T = unknown>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ): Promise<{ data: T | null; error: string | null }> {
    if (!this.isConfigured || !this.url || !this.apiKey) {
      return { data: null, error: 'Supabase no está configurado en las variables de entorno.' };
    }

    try {
      const url = `${this.url.replace(/\/$/, '')}/rest/v1/${endpoint.replace(/^\//, '')}`;
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          apikey: this.apiKey,
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
          ...options.headers
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { data: null, error: `[Supabase HTTP ${response.status}] ${errorText}` };
      }

      const data = (await response.json()) as T;
      return { data, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error desconocido al consultar Supabase';
      return { data: null, error: message };
    }
  }

  /**
   * Sincroniza un registro local con la tabla remota en Supabase (Upsert)
   */
  public async syncRecord(tableName: string, record: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured) return { success: true };

    const result = await this.request(tableName, {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: record
    });

    if (result.error) {
      console.warn(`⚠️ [Supabase Sync] Error sincronizando tabla ${tableName}:`, result.error);
      return { success: false, error: result.error };
    }

    return { success: true };
  }
}

export const supabaseClient = new SupabaseClient();
