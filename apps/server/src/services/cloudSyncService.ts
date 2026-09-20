import { supabaseClient } from '../db/supabase.ts';

export interface CloudQueueItem {
  id: string;
  tableName: string;
  recordId: string;
  action: 'UPSERT' | 'DELETE';
  payload: Record<string, unknown>;
  status: 'PENDING' | 'SYNCED' | 'FAILED';
  retryCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export class CloudSyncService {
  private inMemoryQueue: CloudQueueItem[] = [];

  /**
   * Sanitiza el payload para el esquema exacto de Supabase PostgreSQL
   */
  public cleanRecordForSupabase(tableName: string, raw: Record<string, unknown>): Record<string, unknown> {
    const now = new Date().toISOString();
    const r = { ...raw };

    if (tableName === 'socios' || tableName === 'clientes') {
      const {
        id_sector,
        medidor_numero,
        tiene_alcantarillado,
        nombre_sector,
        codigoSocio,
        cedulaRuc,
        fechaNacimiento,
        fechaUnion,
        estadoServicio,
        updatedAt,
        createdAt,
        ...clean
      } = r as any;

      return {
        id: r.id || crypto.randomUUID(),
        codigo_socio: r.codigo_socio || codigoSocio || 'SOC-0000',
        nombres: r.nombres || '',
        apellidos: r.apellidos || '',
        cedula_ruc: r.cedula_ruc || cedulaRuc || '',
        fecha_nacimiento: r.fecha_nacimiento || fechaNacimiento || '1985-01-01',
        fecha_union: r.fecha_union || fechaUnion || '2022-01-01',
        telefono: r.telefono || null,
        direccion: r.direccion || 'Comunidad',
        estado: r.estado || estadoServicio || 'ACTIVO',
        version: Number(r.version || 1),
        created_at: r.created_at || createdAt || now,
        updated_at: now
      };
    }

    if (tableName === 'medidores') {
      const {
        idSocio,
        idSector,
        numeroMedidor,
        tieneAlcantarillado,
        createdAt,
        updatedAt,
        nombre_sector,
        codigo_sector,
        ...clean
      } = r as any;

      return {
        id: r.id || crypto.randomUUID(),
        id_socio: r.id_socio || idSocio,
        id_sector: r.id_sector || idSector || '11111111-0000-0000-0000-000000000001',
        numero_medidor: r.numero_medidor || numeroMedidor || 'MED-00000',
        alias: r.alias || 'Casa principal',
        direccion: r.direccion || '',
        tiene_alcantarillado: Boolean(r.tiene_alcantarillado ?? tieneAlcantarillado),
        estado: r.estado || 'ACTIVO',
        version: Number(r.version || 1),
        created_at: r.created_at || createdAt || now,
        updated_at: now
      };
    }

    if (tableName === 'lecturas') {
      const {
        clienteId,
        idSocio,
        idMedidor,
        idPeriodo,
        periodo,
        lecturaAnterior,
        lecturaActual,
        consumoM3,
        excedenteM3,
        updatedAt,
        ...clean
      } = r as any;

      return {
        id: r.id || crypto.randomUUID(),
        id_socio: r.id_socio || idSocio || clienteId,
        id_medidor: r.id_medidor || idMedidor || null,
        id_periodo: r.id_periodo || idPeriodo || periodo || '2026-08',
        lectura_anterior: Number(Number(r.lectura_anterior ?? lecturaAnterior ?? 0).toFixed(2)),
        lectura_actual: Number(Number(r.lectura_actual ?? lecturaActual ?? 0).toFixed(2)),
        consumo_total: Number(Number(r.consumo_total ?? consumoM3 ?? 0).toFixed(2)),
        excedente_m3: Number(Number(r.excedente_m3 ?? excedenteM3 ?? 0).toFixed(2)),
        fecha_lectura: r.fecha_lectura || updatedAt || now,
        id_lector: r.id_lector || '00000000-0000-0000-0000-000000000003',
        observaciones: r.observaciones || 'Toma en campo',
        updated_at: now
      };
    }

    if (tableName === 'facturas') {
      const {
        idSocio,
        idMedidor,
        idPeriodo,
        numeroFactura,
        valorBase,
        consumoM3,
        excedenteM3,
        valorExcedente,
        valorAlcantarillado,
        valorMultas,
        valorDeudaAnterior,
        esTerceraEdad,
        totalMes,
        totalPagar,
        estadoPago,
        fechaPago,
        metodoPago,
        createdAt,
        updatedAt,
        ...clean
      } = r as any;

      return {
        id: r.id || crypto.randomUUID(),
        numero_factura: r.numero_factura || numeroFactura,
        id_socio: r.id_socio || idSocio,
        id_medidor: r.id_medidor || idMedidor || null,
        id_periodo: r.id_periodo || idPeriodo,
        id_lectura: r.id_lectura || null,
        es_tercera_edad: Boolean(r.es_tercera_edad ?? esTerceraEdad),
        valor_base: Number(Number(r.valor_base ?? valorBase ?? 0).toFixed(2)),
        consumo_m3: Number(Number(r.consumo_m3 ?? consumoM3 ?? 0).toFixed(2)),
        excedente_m3: Number(Number(r.excedente_m3 ?? excedenteM3 ?? 0).toFixed(2)),
        valor_excedente: Number(Number(r.valor_excedente ?? valorExcedente ?? 0).toFixed(2)),
        valor_alcantarillado: Number(Number(r.valor_alcantarillado ?? valorAlcantarillado ?? 0).toFixed(2)),
        valor_multas: Number(Number(r.valor_multas ?? valorMultas ?? 0).toFixed(2)),
        valor_deuda_anterior: Number(Number(r.valor_deuda_anterior ?? valorDeudaAnterior ?? 0).toFixed(2)),
        total_mes: Number(Number(r.total_mes ?? totalMes ?? r.total_pagar ?? totalPagar ?? 0).toFixed(2)),
        total_pagar: Number(Number(r.total_pagar ?? totalPagar ?? r.total_mes ?? totalMes ?? 0).toFixed(2)),
        estado_pago: r.estado_pago || estadoPago || 'PENDIENTE',
        fecha_pago: r.fecha_pago || fechaPago || null,
        metodo_pago: r.metodo_pago || metodoPago || null,
        fecha_vencimiento: r.fecha_vencimiento || '2026-09-30',
        version: Number(r.version || 1),
        created_at: r.created_at || createdAt || now,
        updated_at: now
      };
    }

    return r;
  }

  /**
   * Sincroniza directamente a Supabase o encola en memoria si falla
   */
  public async syncOrQueue(tableName: string, record: Record<string, unknown>): Promise<void> {
    if (!supabaseClient.isEnabled()) return;

    const cleaned = this.cleanRecordForSupabase(tableName, record);
    const res = await supabaseClient.syncRecord(tableName, cleaned);

    if (!res.success) {
      this.inMemoryQueue.push({
        id: crypto.randomUUID(),
        tableName,
        recordId: (record.id as string) || crypto.randomUUID(),
        action: 'UPSERT',
        payload: cleaned,
        status: 'PENDING',
        retryCount: 0,
        lastError: res.error,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  /**
   * Procesa items pendientes en memoria
   */
  public async flushPending(_force = false): Promise<{ success: boolean; pushed: number; failed: number; errors: string[] }> {
    if (!supabaseClient.isEnabled() || this.inMemoryQueue.length === 0) {
      return { success: true, pushed: 0, failed: 0, errors: [] };
    }

    let pushed = 0;
    let failed = 0;
    const errors: string[] = [];

    const items = [...this.inMemoryQueue];
    this.inMemoryQueue = [];

    for (const item of items) {
      const res = await supabaseClient.syncRecord(item.tableName, item.payload);
      if (res.success) {
        pushed++;
      } else {
        failed++;
        errors.push(`${item.tableName} (${item.recordId}): ${res.error}`);
        if (item.retryCount < 5) {
          item.retryCount++;
          item.lastError = res.error;
          this.inMemoryQueue.push(item);
        }
      }
    }

    return { success: failed === 0, pushed, failed, errors };
  }
}

export const cloudSyncService = new CloudSyncService();
