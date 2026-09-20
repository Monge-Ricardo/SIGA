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
      console.log('ℹ️ [Supabase] Modo Offline / Sin conexión remota (SUPABASE_URL no configurada).');
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
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { data: null, error: `[Supabase HTTP ${response.status}] ${errorText}` };
      }

      if (response.status === 204) {
        return { data: null, error: null };
      }

      const text = await response.text();
      if (!text || !text.trim()) {
        return { data: null, error: null };
      }

      const data = JSON.parse(text) as T;
      return { data, error: null };
    } catch (err: unknown) {
      const cause = (err as any)?.cause?.message || (err as any)?.cause?.code;
      const message = err instanceof Error
        ? `${err.message}${cause ? ` (${cause})` : ''}`
        : 'Error desconocido al consultar Supabase';
      return { data: null, error: message };
    }
  }

  /**
   * Sincroniza un registro local con la tabla remota en Supabase (Upsert)
   */
  public async syncRecord(tableName: string, record: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured || process.env.NODE_ENV === 'test' || process.env.DISABLE_SUPABASE_SYNC === 'true') return { success: true };

    let payload = record;
    if (tableName === 'socios' || tableName === 'clientes') {
      const { id_sector, medidor_numero, nombre_sector, ...cleanSocio } = record as any;
      payload = cleanSocio;
    } else if (tableName === 'facturas') {
      const { monto_pagado, saldo_pendiente, socio_nombre, socio_cedula, periodo_codigo, observaciones, ...cleanFactura } = record as any;
      payload = cleanFactura;
    } else if (tableName === 'medidores') {
      const { lectura_actual, lectura_anterior, consumo, socio_nombre, ...cleanMedidor } = record as any;
      payload = cleanMedidor;
    }

    const endpoint = tableName === 'lecturas' ? `${tableName}?on_conflict=id_medidor,id_periodo` : tableName;

    const result = await this.request(endpoint, {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: payload
    });

    if (result.error) {
      console.warn(`⚠️ [Supabase Sync] Error sincronizando tabla ${tableName}:`, result.error);
      return { success: false, error: result.error };
    }

    return { success: true };
  }

  public async deleteRecord(tableName: string, id: string, idColumn = 'id'): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured || process.env.NODE_ENV === 'test' || process.env.DISABLE_SUPABASE_SYNC === 'true') return { success: true };

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let actualColumn = idColumn;
    if (idColumn === 'id' && !uuidRegex.test(id)) {
      if (tableName === 'facturas') actualColumn = 'numero_factura';
      else if (tableName === 'socios') actualColumn = 'cedula_ruc';
      else if (tableName === 'medidores') actualColumn = 'numero_medidor';
    }

    const result = await this.request(`${tableName}?${actualColumn}=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });

    if (result.error) {
      console.warn(`⚠️ [Supabase Sync] Error eliminando de tabla ${tableName} (${actualColumn}=${id}):`, result.error);
      return { success: false, error: result.error };
    }

    return { success: true };
  }


  /**
   * Obtiene registros desde Supabase
   */
  public async fetchRecords<T = Record<string, unknown>>(tableName: string, queryParams = ''): Promise<{ data: T[] | null; error: string | null }> {
    if (!this.isConfigured) {
      return { data: null, error: 'Supabase no está configurado.' };
    }

    const endpoint = queryParams ? `${tableName}?${queryParams}` : tableName;
    return this.request<T[]>(endpoint, { method: 'GET' });
  }
}

export const supabaseClient = new SupabaseClient();

