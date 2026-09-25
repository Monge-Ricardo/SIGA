import crypto from 'node:crypto';
import type { Response } from '../core/http.ts';
import { supabaseClient } from '../db/supabase.ts';
import type { AuthenticatedRequest } from '../middlewares/auth.ts';
import { ValidationRules } from '../shared.ts';
import type { MetodoPago, MultaRubro, Sector } from '../shared.ts';
import {
  calculateFacturaFundDistribution,
  calculateAbonoFundDistribution,
  isPeriodoCorte,
  FONDO_IDS
} from './financeController.ts';
import { getCurrentTarifas } from './adminController.ts';

const isValidUUID = (val: unknown): boolean =>
  typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

/**
 * Obtiene el período actualmente ABIERTO en Supabase, o el más reciente.
 */
export async function getActivePeriod(): Promise<Record<string, any> | null> {
  try {
    const res = await supabaseClient.fetchRecords<Record<string, any>>('periodos', 'estado=eq.ABIERTO&order=fecha_inicio.desc&limit=1');
    if (res.data && res.data.length > 0) return res.data[0];
    const all = await supabaseClient.fetchRecords<Record<string, any>>('periodos', 'order=fecha_inicio.desc&limit=1');
    return all.data?.[0] || null;
  } catch (_e) {
    return null;
  }
}

/**
 * Obtiene el período inicial histórico del sistema.
 */
export async function getInitialPeriod(): Promise<Record<string, any> | null> {
  try {
    const res = await supabaseClient.fetchRecords<Record<string, any>>('periodos', 'order=fecha_inicio.asc&limit=1');
    return res.data?.[0] || null;
  } catch (_e) {
    return null;
  }
}

/**
 * Obtiene el ID del período base para lecturas iniciales de acometidas.
 */
export async function getBaselinePeriodId(): Promise<string> {
  const init = await getInitialPeriod();
  if (init?.id) return init.id;
  const act = await getActivePeriod();
  return (act?.id as string) || '00000000-0000-0000-0000-000000000000';
}

/**
 * Retorna un mapa indexado de todos los períodos para resolución dinámica de códigos sin fallbacks estáticos.
 */
export async function getPeriodosMap(): Promise<Map<string, Record<string, any>>> {
  const map = new Map<string, Record<string, any>>();
  try {
    const res = await supabaseClient.fetchRecords<Record<string, any>>('periodos', 'order=fecha_inicio.desc&limit=200');
    for (const p of res.data || []) {
      if (p.id) map.set(p.id, p);
      if (p.periodo_codigo) map.set(p.periodo_codigo, p);
      if (p.codigo) map.set(p.codigo, p);
    }
  } catch (_e) {
    // fallback map vacío
  }
  return map;
}

// ==========================================
// 1. SECTORES
// ==========================================

export const getSectores = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const resData = await supabaseClient.fetchRecords<Record<string, unknown>>(
      'sectores',
      'activo=eq.true&order=nombre_sector.asc'
    );
    const rows = resData.data || [];
    const sectores: Sector[] = rows.map((r) => ({
      id: r.id as string,
      codigoSector: r.codigo_sector as string,
      nombreSector: r.nombre_sector as string,
      descripcion: (r.descripcion as string) || undefined,
      activo: Boolean(r.activo),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string
    }));
    res.json({ data: sectores });
  } catch (error) {
    console.error('[WaterController] Error obteniendo sectores:', error);
    res.status(500).json({ error: 'Error obteniendo sectores.' });
  }
};

export const createSector = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { codigoSector, nombreSector, descripcion } = req.body || {};
    if (!codigoSector || !nombreSector) {
      res.status(400).json({ error: 'codigoSector y nombreSector son requeridos.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const record = {
      id,
      codigo_sector: String(codigoSector).trim().toUpperCase(),
      nombre_sector: String(nombreSector).trim(),
      descripcion: descripcion ? String(descripcion).trim() : null,
      activo: true,
      created_at: now,
      updated_at: now
    };

    await supabaseClient.syncRecord('sectores', record);

    res.status(201).json({
      message: 'Sector creado exitosamente.',
      data: { id, codigoSector, nombreSector, descripcion, activo: true, createdAt: now, updatedAt: now }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error creando sector.';
    res.status(400).json({ error: message });
  }
};

export const updateSector = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { codigoSector, nombreSector, descripcion, activo } = req.body || {};

    if (!id) {
      res.status(400).json({ error: 'ID de sector es requerido.' });
      return;
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };
    if (codigoSector !== undefined) updates.codigo_sector = String(codigoSector).trim().toUpperCase();
    if (nombreSector !== undefined) updates.nombre_sector = String(nombreSector).trim();
    if (descripcion !== undefined) updates.descripcion = descripcion ? String(descripcion).trim() : null;
    if (activo !== undefined) updates.activo = Boolean(activo);

    if (supabaseClient.isEnabled()) {
      await supabaseClient.request(`sectores?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: updates
      });
    }

    res.json({
      message: 'Sector actualizado exitosamente.',
      data: { id, ...updates }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error actualizando sector.';
    res.status(500).json({ error: message });
  }
};

export const deleteSector = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'ID de sector es requerido.' });
      return;
    }

    if (supabaseClient.isEnabled()) {
      // Verificar si hay medidores vinculados a este sector
      const checkMed = await supabaseClient.fetchRecords<Record<string, unknown>>(
        'medidores',
        `id_sector=eq.${encodeURIComponent(id)}&limit=1`
      );
      if (checkMed.data && checkMed.data.length > 0) {
        res.status(400).json({
          error: 'No se puede eliminar el sector porque tiene medidores asociados. Reasigne los medidores a otro sector primero.'
        });
        return;
      }

      await supabaseClient.request(`sectores?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
    }

    res.json({ message: 'Sector eliminado exitosamente.' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error eliminando sector.';
    res.status(500).json({ error: message });
  }
};

// ==========================================
// 2. PADRÓN DE SOCIOS
// ==========================================

export const getSocios = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { sectorId, estado, search } = req.query as { sectorId?: string; estado?: string; search?: string };
    const [socRes, medRes, secRes, facRes, lecRes, mulRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('socios', 'order=nombres.asc'),
      supabaseClient.fetchRecords<Record<string, unknown>>('medidores'),
      supabaseClient.fetchRecords<Record<string, unknown>>('sectores'),
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas', 'estado_pago=eq.PENDIENTE'),
      supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', 'order=fecha_lectura.asc'),
      supabaseClient.fetchRecords<Record<string, unknown>>('multas_rubros', 'estado=neq.PAGADO')
    ]);

    const medidores = medRes.data || [];
    const sectores = secRes.data || [];
    const facturas = facRes.data || [];
    const lecturas = lecRes.data || [];
    const multas = mulRes.data || [];
    const secMap = new Map(sectores.map((s) => [s.id as string, s.nombre_sector as string]));

    const lecturaInicialMap = new Map<string, number>();
    lecturas.forEach((l) => {
      const mId = l.id_medidor as string;
      if (mId && !lecturaInicialMap.has(mId)) {
        lecturaInicialMap.set(mId, Number(l.lectura_anterior ?? l.lectura_actual ?? 0));
      }
    });

    let socios = (socRes.data || []).map((s) => {
      const socioMeds = medidores.filter((m) => m.id_socio === s.id);
      const socioFacs = facturas.filter((f) => f.id_socio === s.id);
      const socioMuls = multas.filter((m) => m.id_socio === s.id);
      const deudaAgua = socioFacs.reduce((acc, f) => {
        const sal = f.saldo_pendiente !== undefined && f.saldo_pendiente !== null ? Number(f.saldo_pendiente) : Number(f.total_pagar || 0);
        const mulInFac = Number(f.valor_multas || 0);
        return acc + Math.max(0, sal - mulInFac);
      }, 0);
      const deudaMultas = socioMuls.reduce((acc, m) => acc + Number(m.saldo_pendiente ?? m.monto ?? 0), 0);
      const deuda = Number((deudaAgua + deudaMultas).toFixed(2));
      const es3ra = ValidationRules.calcularEsTerceraEdad(s.fecha_nacimiento as string);
      const primarySectorId = (socioMeds[0]?.id_sector as string) || (s.id_sector as string) || '';
      const primaryMedNum = (socioMeds[0]?.numero_medidor as string) || (s.medidor_numero as string) || 'S/N';

      return {
        id: s.id as string,
        codigoSocio: s.codigo_socio as string,
        nombres: s.nombres as string,
        apellidos: s.apellidos as string,
        nombreCompleto: `${s.nombres || ''} ${s.apellidos || ''}`.trim() || (s.codigo_socio as string),
        cedulaRuc: s.cedula_ruc as string,
        fechaNacimiento: s.fecha_nacimiento as string,
        esTerceraEdad: es3ra,
        fechaUnion: s.fecha_union as string,
        idSector: primarySectorId,
        id_sector: primarySectorId,
        nombreSector: secMap.get(primarySectorId) || 'Sector General',
        nombre_sector: secMap.get(primarySectorId) || 'Sector General',
        medidorNumero: primaryMedNum,
        tieneAlcantarillado: socioMeds.some((m) => Boolean(m.tiene_alcantarillado)) || Boolean(s.tiene_alcantarillado),
        telefono: (s.telefono as string) || undefined,
        direccion: (s.direccion as string) || 'Comunidad',
        estado: (s.estado as string) || 'ACTIVO',
        montoTotalAdeudado: Number(deuda.toFixed(2)),
        mesesAdeudados: socioFacs.length,
        estadoCuenta: deuda > 0 ? 'EN_MORA' : 'AL_DIA',
        medidores: socioMeds.map((m) => {
          const lecIni = lecturaInicialMap.get(m.id as string) ?? Number(m.lectura_inicial ?? m.lecturaInicial ?? 0);
          return {
            id: m.id as string,
            idSocio: m.id_socio as string,
            id_socio: m.id_socio as string,
            idSector: m.id_sector as string,
            id_sector: m.id_sector as string,
            numeroMedidor: m.numero_medidor as string,
            numero_medidor: m.numero_medidor as string,
            alias: (m.alias as string) || 'Casa principal',
            direccion: (m.direccion as string) || (s.direccion as string) || '',
            tieneAlcantarillado: Boolean(m.tiene_alcantarillado),
            tiene_alcantarillado: Boolean(m.tiene_alcantarillado),
            lecturaInicial: lecIni,
            lectura_inicial: lecIni,
            estado: (m.estado as string) || 'ACTIVO'
          };
        }),
        version: Number(s.version || 1),
        createdAt: s.created_at as string,
        updatedAt: s.updated_at as string
      };
    });

    if (sectorId) socios = socios.filter((s) => s.idSector === sectorId);
    if (estado) socios = socios.filter((s) => s.estado === estado);
    if (search) {
      const q = search.toLowerCase();
      socios = socios.filter(
        (s) =>
          s.nombreCompleto.toLowerCase().includes(q) ||
          s.cedulaRuc.includes(q) ||
          s.codigoSocio.toLowerCase().includes(q)
      );
    }

    res.json({ data: socios, total: socios.length });
  } catch (error) {
    console.error('[WaterController] Error obteniendo socios:', error);
    res.status(500).json({ error: 'Error obteniendo padrón de socios.' });
  }
};

export const getSocioById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [socRes, medRes, facRes, lecRes, mulRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('socios', `id=eq.${id}&limit=1`),
      supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id_socio=eq.${id}`),
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas', `id_socio=eq.${id}&estado_pago=eq.PENDIENTE`),
      supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id_socio=eq.${id}&order=fecha_lectura.asc`),
      supabaseClient.fetchRecords<Record<string, unknown>>('multas_rubros', `id_socio=eq.${id}&estado=neq.PAGADO`)
    ]);

    if (!socRes.data || socRes.data.length === 0) {
      res.status(404).json({ error: 'Socio no encontrado.' });
      return;
    }

    const lecturaInicialMap = new Map<string, number>();
    (lecRes.data || []).forEach((l) => {
      const mId = l.id_medidor as string;
      if (mId && !lecturaInicialMap.has(mId)) {
        lecturaInicialMap.set(mId, Number(l.lectura_anterior ?? l.lectura_actual ?? 0));
      }
    });

    const s = socRes.data[0];
    const socioFacs = facRes.data || [];
    const socioMuls = mulRes.data || [];
    const deudaAgua = socioFacs.reduce((acc, f) => {
      const sal = f.saldo_pendiente !== undefined && f.saldo_pendiente !== null ? Number(f.saldo_pendiente) : Number(f.total_pagar || 0);
      const mulInFac = Number(f.valor_multas || 0);
      return acc + Math.max(0, sal - mulInFac);
    }, 0);
    const deudaMultas = socioMuls.reduce((acc, m) => acc + Number(m.saldo_pendiente ?? m.monto ?? 0), 0);
    const deuda = Number((deudaAgua + deudaMultas).toFixed(2));

    res.json({
      data: {
        id: s.id,
        codigoSocio: s.codigo_socio,
        nombres: s.nombres,
        apellidos: s.apellidos,
        nombreCompleto: `${s.nombres || ''} ${s.apellidos || ''}`.trim(),
        cedulaRuc: s.cedula_ruc,
        fechaNacimiento: s.fecha_nacimiento,
        esTerceraEdad: ValidationRules.calcularEsTerceraEdad(s.fecha_nacimiento as string),
        fechaUnion: s.fecha_union,
        idSector: (medRes.data?.[0]?.id_sector as string) || (s.id_sector as string) || '11111111-0000-0000-0000-000000000001',
        id_sector: (medRes.data?.[0]?.id_sector as string) || (s.id_sector as string) || '11111111-0000-0000-0000-000000000001',
        medidorNumero: (medRes.data?.[0]?.numero_medidor as string) || (s.medidor_numero as string) || 'S/N',
        tieneAlcantarillado: medRes.data?.some(m => Boolean(m.tiene_alcantarillado)) || Boolean(s.tiene_alcantarillado),
        telefono: s.telefono,
        direccion: s.direccion,
        estado: s.estado,
        montoTotalAdeudado: Number(deuda.toFixed(2)),
        mesesAdeudados: socioFacs.length,
        estadoCuenta: deuda > 0 ? 'EN_MORA' : 'AL_DIA',
        medidores: (medRes.data || []).map((m) => {
          const lecIni = lecturaInicialMap.get(m.id as string) ?? Number(m.lectura_inicial ?? m.lecturaInicial ?? 0);
          return {
            id: m.id,
            idSocio: m.id_socio,
            id_socio: m.id_socio,
            idSector: m.id_sector,
            id_sector: m.id_sector,
            numeroMedidor: m.numero_medidor,
            numero_medidor: m.numero_medidor,
            alias: m.alias || 'Casa principal',
            direccion: m.direccion || s.direccion || '',
            tieneAlcantarillado: Boolean(m.tiene_alcantarillado),
            tiene_alcantarillado: Boolean(m.tiene_alcantarillado),
            lecturaInicial: lecIni,
            lectura_inicial: lecIni,
            estado: m.estado || 'ACTIVO'
          };
        }),
        version: s.version || 1,
        createdAt: s.created_at,
        updatedAt: s.updated_at
      }
    });
  } catch (error) {
    console.error('[WaterController] Error obteniendo socio:', error);
    res.status(500).json({ error: 'Error obteniendo socio.' });
  }
};

export const getSocioEstadoCuenta = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [socRes, facRes, mulRes, allMulRes, lecRes, medRes, perRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('socios', `id=eq.${id}&limit=1`),
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas', `id_socio=eq.${id}&order=created_at.desc`),
      supabaseClient.fetchRecords<Record<string, unknown>>('multas_rubros', `id_socio=eq.${id}&estado=neq.PAGADO&order=created_at.asc`),
      supabaseClient.fetchRecords<Record<string, unknown>>('multas_rubros', `id_socio=eq.${id}`),
      supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id_socio=eq.${id}&order=fecha_lectura.desc`),
      supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id_socio=eq.${id}`),
      supabaseClient.fetchRecords<Record<string, unknown>>('periodos', 'order=fecha_inicio.desc')
    ]);

    if (!socRes.data || socRes.data.length === 0) {
      res.status(404).json({ error: 'Socio no encontrado.' });
      return;
    }

    const s = socRes.data[0];
    const facturas = facRes.data || [];
    const multas = mulRes.data || [];
    const medidores = medRes.data || [];
    const periodosList = perRes.data || [];

    const periodosMap = new Map<string, Record<string, any>>();
    for (const p of periodosList) {
      if (p.id) periodosMap.set(p.id as string, p);
      if (p.periodo_codigo) periodosMap.set(p.periodo_codigo as string, p);
    }

    const periodoActivoRow = periodosList.find((p) => p.estado === 'ABIERTO') || periodosList[0] || null;
    const periodoActivoId = (periodoActivoRow?.id as string) || '';
    const periodoActivoCod = (periodoActivoRow?.periodo_codigo || periodoActivoRow?.codigo || '') as string;

    // Normalizar todas las facturas del socio con claves duales (camelCase y snake_case)
    const facturasNormalizadas = facturas.map((f) => {
      const fNum = (f.numero_factura as string) || (f.id as string);
      const pId = (f.id_periodo as string) || '';
      const pObj = periodosMap.get(pId);
      const pCod = (pObj?.periodo_codigo || pObj?.codigo || (pId === periodoActivoId ? periodoActivoCod : '')) as string;
      const totP = Number(f.total_pagar || 0);
      const isPagado = f.estado_pago === 'PAGADO';
      const salPend = Number(f.saldo_pendiente !== undefined && f.saldo_pendiente !== null ? f.saldo_pendiente : (isPagado ? 0 : totP));
      const monPag = Number(f.monto_pagado !== undefined && f.monto_pagado !== null ? f.monto_pagado : (isPagado ? totP : 0));

      return {
        id: f.id as string,
        numeroFactura: fNum,
        numero_factura: fNum,
        idSocio: f.id_socio as string,
        id_socio: f.id_socio as string,
        idMedidor: f.id_medidor as string,
        id_medidor: f.id_medidor as string,
        idPeriodo: pId,
        id_periodo: pId,
        periodoCodigo: pCod,
        periodo_codigo: pCod,
        periodoNombre: `Período ${pCod}`,
        consumoM3: Number(f.consumo_m3 || 0),
        consumo_m3: Number(f.consumo_m3 || 0),
        valorBase: Number(f.valor_base || 0),
        valor_base: Number(f.valor_base || 0),
        valorExcedente: Number(f.valor_excedente || 0),
        valor_excedente: Number(f.valor_excedente || 0),
        valorAlcantarillado: Number(f.valor_alcantarillado || 0),
        valor_alcantarillado: Number(f.valor_alcantarillado || 0),
        valorMultas: Number(f.valor_multas || 0),
        valor_multas: Number(f.valor_multas || 0),
        valorDeudaAnterior: Number(f.valor_deuda_anterior || 0),
        valor_deuda_anterior: Number(f.valor_deuda_anterior || 0),
        totalMes: Number(f.total_mes ?? totP),
        total_mes: Number(f.total_mes ?? totP),
        totalPagar: totP,
        total_pagar: totP,
        montoPagado: monPag,
        monto_pagado: monPag,
        saldoPendiente: salPend,
        saldo_pendiente: salPend,
        estadoPago: (f.estado_pago as string) || 'PENDIENTE',
        estado_pago: (f.estado_pago as string) || 'PENDIENTE',
        fechaPago: (f.fecha_pago as string) || (f.updated_at as string) || null,
        fecha_pago: (f.fecha_pago as string) || (f.updated_at as string) || null,
        metodoPago: (f.metodo_pago as string) || 'EFECTIVO',
        metodo_pago: (f.metodo_pago as string) || 'EFECTIVO'
      };
    });

    const facturasPendientes = facturasNormalizadas.filter((f) => f.estadoPago === 'PENDIENTE' || f.saldoPendiente > 0);
    const facturasPagadas = facturasNormalizadas.filter((f) => f.estadoPago === 'PAGADO' || f.saldoPendiente === 0);

    const lecturaInicialMap = new Map<string, number>();
    const sortedLecs = [...(lecRes.data || [])].sort((a, b) => String(a.fecha_lectura || '').localeCompare(String(b.fecha_lectura || '')));
    sortedLecs.forEach((l) => {
      const medId = l.id_medidor as string;
      if (medId && !lecturaInicialMap.has(medId)) {
        lecturaInicialMap.set(medId, Number(l.lectura_anterior ?? l.lectura_actual ?? 0));
      }
    });

    // Evaluar estado para cada medidor
    const medidoresEstado = medidores.map((m) => {
      const mId = m.id as string;
      const mNum = String(m.numero_medidor || '').trim();
      const lecIni = lecturaInicialMap.get(mId) ?? Number(m.lectura_inicial ?? m.lecturaInicial ?? 0);

      // Buscar factura pagada de este medidor para el periodo activo
      const facMesPagada = facturasNormalizadas.find((f) => {
        const isPeriodo = f.idPeriodo === periodoActivoId || String(f.numeroFactura || '').includes(periodoActivoCod.replace('-', ''));
        const isMed = f.idMedidor === mId || (medidores.length === 1 && !f.idMedidor);
        const isPag = f.estadoPago === 'PAGADO' || f.saldoPendiente === 0;
        const cobroConsumo = Number(f.totalMes || 0) > 0 || Number(f.valorBase || 0) > 0;
        return isPeriodo && isMed && isPag && cobroConsumo;
      });

      const tieneFacMesPendiente = facturasNormalizadas.some((f) => {
        const isPeriodo = f.idPeriodo === periodoActivoId || String(f.numeroFactura || '').includes(periodoActivoCod.replace('-', ''));
        const isMed = f.idMedidor === mId || (medidores.length === 1 && !f.idMedidor);
        return isPeriodo && isMed && f.estadoPago === 'PENDIENTE';
      });

      const yaPagadoMes = Boolean(facMesPagada) && !tieneFacMesPendiente;

      return {
        id: mId,
        idMedidor: mId,
        numeroMedidor: mNum,
        numero_medidor: mNum,
        alias: (m.alias as string) || 'Casa principal',
        direccion: (m.direccion as string) || '',
        tieneAlcantarillado: Boolean(m.tiene_alcantarillado),
        tiene_alcantarillado: Boolean(m.tiene_alcantarillado),
        lecturaInicial: lecIni,
        lectura_inicial: lecIni,
        estado: (m.estado as string) || 'ACTIVO',
        yaPagadoMes,
        reciboPago: facMesPagada ? facMesPagada.numeroFactura : null,
        fechaPagoMes: facMesPagada ? facMesPagada.fechaPago : null,
        facturaMes: facMesPagada || null
      };
    });

    const mesActualPagado = medidoresEstado.length > 0
      ? medidoresEstado.every((m) => m.yaPagadoMes)
      : facturasNormalizadas.some((f) => (f.idPeriodo === periodoActivoId || String(f.numeroFactura || '').includes(periodoActivoCod.replace('-', ''))) && f.estadoPago === 'PAGADO');

    // Combinar y deduplicar lecturas del socio y de sus medidores asignados
    const lecturasMap = new Map<string, Record<string, unknown>>();
    (lecRes.data || []).forEach((l) => { if (l.id) lecturasMap.set(l.id as string, l); });
    const medIds = medidores.map((m) => m.id as string).filter(Boolean);
    if (medIds.length > 0) {
      const medLecRes = await supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id_medidor=in.(${medIds.join(',')})&order=fecha_lectura.desc`);
      (medLecRes.data || []).forEach((l) => { if (l.id) lecturasMap.set(l.id as string, l); });
    }
    const lecturas = Array.from(lecturasMap.values());

    // Obtener historial de abonos vinculados a los rubros del socio
    let abonosHistorial: Record<string, unknown>[] = [];
    const rubroIds = (allMulRes.data || []).map((r) => r.id as string).filter(Boolean);
    if (rubroIds.length > 0) {
      const abRes = await supabaseClient.fetchRecords<Record<string, unknown>>(
        'rubros_abonos',
        `id_rubro=in.(${rubroIds.join(',')})&order=fecha.desc&limit=25`
      );
      abonosHistorial = abRes.data || [];
    }

    const rubrosAlcant = multas.filter((m) => m.tipo_rubro === 'ALCANTARILLADO');
    const multasOtras = multas.filter((m) => m.tipo_rubro !== 'ALCANTARILLADO');
    const deudaAlcantarillado = Number(
      rubrosAlcant.reduce((acc, m) => acc + Number(m.saldo_pendiente ?? m.monto ?? 0), 0).toFixed(2)
    );
    const totalDeudaAgua = facturasPendientes.reduce((acc, f) => {
      const sal = f.saldoPendiente !== undefined && f.saldoPendiente !== null ? Number(f.saldoPendiente) : Number(f.totalPagar || 0);
      const mulInFac = Number(f.valorMultas || 0);
      return acc + Math.max(0, sal - mulInFac);
    }, 0);
    const totalMultas = Number(
      multasOtras.reduce((acc, m) => acc + Number(m.saldo_pendiente ?? m.monto ?? 0), 0).toFixed(2)
    );
    const deudaTotal = Number((totalDeudaAgua + totalMultas + deudaAlcantarillado).toFixed(2));

    res.json({
      data: {
        socio: {
          id: s.id,
          codigoSocio: s.codigo_socio,
          nombres: s.nombres,
          apellidos: s.apellidos,
          nombreCompleto: `${s.nombres || ''} ${s.apellidos || ''}`.trim() || (s.codigo_socio as string),
          cedulaRuc: s.cedula_ruc,
          deudaAlcantarillado,
          tieneAlcantarillado: Boolean(s.tiene_alcantarillado)
        },
        periodoActivo: {
          id: periodoActivoId,
          codigo: periodoActivoCod,
          nombre: (periodoActivoRow.nombre as string) || `Período ${periodoActivoCod}`
        },
        mesActualPagado,
        alDia: deudaTotal === 0 && mesActualPagado,
        montoTotalAdeudado: deudaTotal,
        totalDeudaAgua: Number(totalDeudaAgua.toFixed(2)),
        totalMultas: Number(totalMultas.toFixed(2)),
        mesesAdeudados: facturasPendientes.length,
        facturasPendientes,
        facturasPagadas,
        multasPendientes: multasOtras,
        rubrosAlcantarillado: rubrosAlcant,
        historialFacturas: facturasNormalizadas,
        todasLasFacturas: facturasNormalizadas,
        abonosHistorial,
        lecturas,
        medidores: medidoresEstado
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error obteniendo estado de cuenta.';
    res.status(404).json({ error: message });
  }
};

export const createSocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const p = req.body || {};
    const id = (p.id && isValidUUID(p.id)) ? p.id : crypto.randomUUID();
    const now = new Date().toISOString();

    const medidoresInput = Array.isArray(p.medidores) && p.medidores.length > 0
      ? p.medidores
      : (p.medidorNumero || p.numeroMedidor)
        ? [{
            id: crypto.randomUUID(),
            numeroMedidor: p.medidorNumero || p.numeroMedidor,
            alias: 'Casa principal',
            direccion: p.direccion || 'Comunidad',
            tieneAlcantarillado: Boolean(p.tieneAlcantarillado ?? p.tiene_alcantarillado),
            estado: p.estado || 'ACTIVO'
          }]
        : [];

    const hasAnyAlcant = medidoresInput.some(
      (m: Record<string, unknown>) => Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado) && m.estado !== 'CORTADO'
    ) || Boolean(p.tieneAlcantarillado ?? p.tiene_alcantarillado);

    const primaryMed = medidoresInput[0] || {};
    const primaryNum = primaryMed.numeroMedidor || primaryMed.numero_medidor || p.medidorNumero || p.medidor_numero || 'S/N';

    const record = {
      id,
      codigo_socio: p.codigoSocio || p.codigo_socio || `SOC-${String(Date.now()).slice(-4)}`,
      nombres: String(p.nombres || '').trim(),
      apellidos: String(p.apellidos || '').trim(),
      cedula_ruc: String(p.cedulaRuc || p.cedula_ruc || '').trim(),
      fecha_nacimiento: p.fechaNacimiento || p.fecha_nacimiento || '1985-01-01',
      fecha_union: p.fechaUnion || p.fechaAfiliacion || p.fecha_union || now.split('T')[0],
      id_sector: p.idSector || p.id_sector || p.sectorId || '11111111-0000-0000-0000-000000000001',
      medidor_numero: primaryNum,
      tiene_alcantarillado: hasAnyAlcant,
      telefono: p.telefono || null,
      direccion: p.direccion || 'Comunidad',
      estado: p.estado || p.estadoServicio || 'ACTIVO',
      version: 1,
      created_at: now,
      updated_at: now
    };

    await supabaseClient.syncRecord('socios', record);

    const createdMedidores = [];
    for (let idx = 0; idx < medidoresInput.length; idx++) {
      const m = medidoresInput[idx];
      const numMed = (m.numeroMedidor || m.numero_medidor || '').trim();
      if (!numMed) continue;
      const medId = (m.id && isValidUUID(m.id)) ? m.id : crypto.randomUUID();
      const lecIni = Number(m.lecturaInicial ?? m.lectura_inicial ?? p.lecturaInicial ?? p.lectura_inicial ?? 0);
      const medRecord = {
        id: medId,
        id_socio: id,
        id_sector: m.idSector || m.id_sector || record.id_sector,
        numero_medidor: numMed,
        alias: m.alias || (idx === 0 ? 'Casa principal' : `Acometida #${idx + 1}`),
        direccion: m.direccion || record.direccion,
        tiene_alcantarillado: Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado ?? hasAnyAlcant),
        estado: m.estado || record.estado,
        version: 1,
        created_at: now,
        updated_at: now
      };
      await supabaseClient.syncRecord('medidores', medRecord);

      if (lecIni > 0) {
        const basePeriodId = await getBaselinePeriodId();
        await supabaseClient.syncRecord('lecturas', {
          id: crypto.randomUUID(),
          id_medidor: medId,
          id_socio: id,
          id_periodo: basePeriodId,
          lectura_anterior: lecIni,
          lectura_actual: lecIni,
          consumo_total: 0,
          excedente_m3: 0,
          fecha_lectura: now,
          id_lector: '00000000-0000-0000-0000-000000000003',
          observaciones: 'Lectura inicial de apertura/instalación de acometida',
          version: 1,
          created_at: now,
          updated_at: now
        }).catch(() => {});
      }

      createdMedidores.push({
        ...medRecord,
        idSocio: medRecord.id_socio,
        idSector: medRecord.id_sector,
        numeroMedidor: medRecord.numero_medidor,
        tieneAlcantarillado: medRecord.tiene_alcantarillado,
        lecturaInicial: lecIni,
        lectura_inicial: lecIni
      });
    }

    res.status(201).json({
      message: 'Socio registrado exitosamente.',
      data: {
        ...record,
        codigoSocio: record.codigo_socio,
        cedulaRuc: record.cedula_ruc,
        tieneAlcantarillado: record.tiene_alcantarillado,
        medidorNumero: record.medidor_numero,
        medidores: createdMedidores
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error registrando socio.';
    res.status(400).json({ error: message });
  }
};

export const updateSocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const p = req.body || {};
    const now = new Date().toISOString();

    const targetSectorId = p.idSector || p.sectorId || p.id_sector;
    const socioPatch: Record<string, unknown> = { updated_at: now };
    if (p.nombres !== undefined) socioPatch.nombres = String(p.nombres).trim();
    if (p.apellidos !== undefined) socioPatch.apellidos = String(p.apellidos).trim();
    if (p.cedulaRuc !== undefined || p.cedula_ruc !== undefined) socioPatch.cedula_ruc = String(p.cedulaRuc || p.cedula_ruc).trim();
    if (p.telefono !== undefined) socioPatch.telefono = p.telefono || null;
    if (p.direccion !== undefined) socioPatch.direccion = p.direccion;
    if (p.fechaNacimiento !== undefined || p.fecha_nacimiento !== undefined) {
      socioPatch.fecha_nacimiento = p.fechaNacimiento || p.fecha_nacimiento;
    }
    if (p.fechaAfiliacion !== undefined || p.fechaUnion !== undefined || p.fecha_union !== undefined) {
      socioPatch.fecha_union = p.fechaAfiliacion || p.fechaUnion || p.fecha_union;
    }
    if (p.estado !== undefined || p.estadoServicio !== undefined) {
      socioPatch.estado = p.estado || p.estadoServicio;
    }

    let savedMedidores: Record<string, unknown>[] = [];

    // Si se enviaron medidores en la edición
    if (Array.isArray(p.medidores) && p.medidores.length > 0) {
      const existingMedsRes = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id_socio=eq.${id}`);
      const existingMeds = existingMedsRes.data || [];
      const submittedIds = new Set(
        p.medidores.map((m: Record<string, unknown>) => m.id).filter((mid: unknown) => isValidUUID(mid))
      );

      for (let idx = 0; idx < p.medidores.length; idx++) {
        const m = p.medidores[idx];
        const numMed = (m.numeroMedidor || m.numero_medidor || '').trim();
        if (!numMed) continue;

        const isRealId = m.id && isValidUUID(m.id) && existingMeds.some((em) => em.id === m.id);
        const medId = isRealId ? (m.id as string) : crypto.randomUUID();

        const existingMatch = existingMeds.find((em) => em.id === medId);
        const lecIni = (m.lecturaInicial !== undefined || m.lectura_inicial !== undefined)
          ? Number(m.lecturaInicial ?? m.lectura_inicial ?? 0)
          : Number(existingMatch?.lectura_inicial || 0);

        const medRecord = {
          id: medId,
          id_socio: id,
          id_sector: m.idSector || m.id_sector || targetSectorId || existingMeds[0]?.id_sector || '11111111-0000-0000-0000-000000000001',
          numero_medidor: numMed,
          alias: m.alias || (idx === 0 ? 'Casa principal' : `Acometida #${idx + 1}`),
          direccion: m.direccion || (socioPatch.direccion as string) || existingMeds[0]?.direccion || '',
          tiene_alcantarillado: Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado),
          estado: m.estado || (socioPatch.estado as string) || 'ACTIVO',
          version: 1,
          created_at: m.createdAt || m.created_at || now,
          updated_at: now
        };

        await supabaseClient.syncRecord('medidores', medRecord);

        if (lecIni > 0) {
          const basePeriodId = await getBaselinePeriodId();
          const lecFetch = await supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id_medidor=eq.${medId}&order=fecha_lectura.asc&limit=1`);
          if (lecFetch.data && lecFetch.data.length > 0) {
            const baseLec = lecFetch.data[0];
            if (baseLec.id_periodo === basePeriodId || (Number(baseLec.consumo_total || 0) === 0 && Number(baseLec.lectura_anterior) === Number(baseLec.lectura_actual))) {
              await supabaseClient.request(`lecturas?id=eq.${baseLec.id}`, {
                method: 'PATCH',
                body: { lectura_anterior: lecIni, lectura_actual: lecIni, updated_at: now }
              }).catch(() => {});
            }
          } else {
            await supabaseClient.syncRecord('lecturas', {
              id: crypto.randomUUID(),
              id_medidor: medId,
              id_socio: id,
              id_periodo: basePeriodId,
              lectura_anterior: lecIni,
              lectura_actual: lecIni,
              consumo_total: 0,
              excedente_m3: 0,
              fecha_lectura: now,
              id_lector: '00000000-0000-0000-0000-000000000003',
              observaciones: 'Lectura inicial de apertura/instalación de acometida',
              version: 1,
              created_at: now,
              updated_at: now
            }).catch(() => {});
          }
        }

        savedMedidores.push({
          ...medRecord,
          idSocio: medRecord.id_socio,
          idSector: medRecord.id_sector,
          numeroMedidor: medRecord.numero_medidor,
          tieneAlcantarillado: medRecord.tiene_alcantarillado,
          lecturaInicial: lecIni,
          lectura_inicial: lecIni
        });
      }

      // Medidores que fueron removidos en la interfaz
      for (const em of existingMeds) {
        if (!submittedIds.has(em.id as string)) {
          const lecFetch = await supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id_medidor=eq.${em.id}&limit=1`);
          if (!lecFetch.data || lecFetch.data.length === 0) {
            await supabaseClient.request(`medidores?id=eq.${em.id}`, { method: 'DELETE' }).catch(() => {});
          } else {
            await supabaseClient.request(`medidores?id=eq.${em.id}`, {
              method: 'PATCH',
              body: { estado: 'CORTADO', updated_at: now }
            }).catch(() => {});
          }
        }
      }

      if (savedMedidores.length > 0) {
        socioPatch.tiene_alcantarillado = savedMedidores.some(
          (m) => Boolean(m.tiene_alcantarillado) && m.estado !== 'CORTADO'
        );
      }
    } else {
      // Actualización directa sin lista de medidores (compatibilidad)
      if (p.tieneAlcantarillado !== undefined || p.tiene_alcantarillado !== undefined) {
        const hasAlcant = Boolean(p.tieneAlcantarillado ?? p.tiene_alcantarillado);
        socioPatch.tiene_alcantarillado = hasAlcant;
        await supabaseClient.request(`medidores?id_socio=eq.${id}`, {
          method: 'PATCH',
          body: { tiene_alcantarillado: hasAlcant, updated_at: now }
        }).catch(() => {});
      }
      if (targetSectorId) {
        await supabaseClient.request(`medidores?id_socio=eq.${id}`, {
          method: 'PATCH',
          body: { id_sector: targetSectorId, updated_at: now }
        }).catch(() => {});
      }
      if (p.medidorNumero || p.medidor_numero) {
        const num = p.medidorNumero || p.medidor_numero;
        await supabaseClient.request(`medidores?id_socio=eq.${id}&limit=1`, {
          method: 'PATCH',
          body: { numero_medidor: num, updated_at: now }
        }).catch(() => {});
      }
    }

    // Actualizar socio en Supabase (solo campos nativos de la tabla socios)
    const patchRes = await supabaseClient.request(`socios?id=eq.${id}`, {
      method: 'PATCH',
      body: socioPatch
    });

    if (patchRes.error) {
      console.error('[WaterController] Error actualizando socio en Supabase:', patchRes.error);
      res.status(400).json({ error: `Error en base de datos: ${patchRes.error}` });
      return;
    }

    const primaryMed = savedMedidores[0] || {};
    const primaryNum = (primaryMed.numero_medidor || primaryMed.numeroMedidor || p.medidorNumero || p.medidor_numero || 'S/N') as string;
    const primarySector = (primaryMed.id_sector || primaryMed.idSector || targetSectorId || '11111111-0000-0000-0000-000000000001') as string;
    const nombreCompleto = `${socioPatch.nombres || ''} ${socioPatch.apellidos || ''}`.trim();

    res.json({
      message: 'Socio actualizado correctamente.',
      data: {
        id,
        ...socioPatch,
        nombreCompleto: nombreCompleto || undefined,
        idSector: primarySector,
        id_sector: primarySector,
        medidorNumero: primaryNum,
        tieneAlcantarillado: Boolean(socioPatch.tiene_alcantarillado),
        medidores: savedMedidores
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error actualizando socio.';
    res.status(400).json({ error: message });
  }
};

export const deleteSocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // 1. Obtener medidores del socio
    const medsRes = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id_socio=eq.${id}`);
    const medIds = (medsRes.data || []).map((m) => m.id as string).filter(Boolean);

    // 2. Obtener facturas del socio
    const facsRes = await supabaseClient.fetchRecords<Record<string, unknown>>('facturas', `id_socio=eq.${id}`);
    const facIds = (facsRes.data || []).map((f) => f.id as string).filter(Boolean);

    // 3. Obtener multas/rubros del socio
    const mulRes = await supabaseClient.fetchRecords<Record<string, unknown>>('multas_rubros', `id_socio=eq.${id}`);
    const mulIds = (mulRes.data || []).map((m) => m.id as string).filter(Boolean);

    // 4. Eliminar movimientos contables (Libro Mayor) y abonos vinculados a facturas del socio
    if (facIds.length > 0) {
      await supabaseClient.request(`fondos_movimientos?id_factura=in.(${facIds.join(',')})`, { method: 'DELETE' }).catch(() => {});
      const facNums = (facsRes.data || []).map((f) => f.numero_factura as string).filter(Boolean);
      if (facNums.length > 0) {
        await supabaseClient.request(`fondos_movimientos?numero_comprobante=in.(${facNums.join(',')})`, { method: 'DELETE' }).catch(() => {});
      }
      await supabaseClient.request(`facturas_abonos?id_factura=in.(${facIds.join(',')})`, { method: 'DELETE' }).catch(() => {});
    }

    // 5. Eliminar abonos vinculados a multas
    if (mulIds.length > 0) {
      await supabaseClient.request(`rubros_abonos?id_rubro=in.(${mulIds.join(',')})`, { method: 'DELETE' }).catch(() => {});
    }

    // 6. Eliminar facturas del socio
    await supabaseClient.request(`facturas?id_socio=eq.${id}`, { method: 'DELETE' }).catch(() => {});

    // 7. Eliminar multas del socio
    await supabaseClient.request(`multas_rubros?id_socio=eq.${id}`, { method: 'DELETE' }).catch(() => {});

    // 8. Eliminar lecturas del socio y de sus medidores
    await supabaseClient.request(`lecturas?id_socio=eq.${id}`, { method: 'DELETE' }).catch(() => {});
    if (medIds.length > 0) {
      await supabaseClient.request(`lecturas?id_medidor=in.(${medIds.join(',')})`, { method: 'DELETE' }).catch(() => {});
    }

    // 9. Eliminar medidores del socio
    await supabaseClient.request(`medidores?id_socio=eq.${id}`, { method: 'DELETE' }).catch(() => {});

    // 10. Eliminar socio definitivamente de la tabla socios
    const delRes = await supabaseClient.request(`socios?id=eq.${id}`, { method: 'DELETE' });

    if (delRes.error) {
      console.error('[WaterController] Error eliminando socio definitivamente:', delRes.error);
      res.status(400).json({ error: `Error eliminando socio: ${delRes.error}` });
      return;
    }

    res.json({
      success: true,
      message: 'Socio, medidores y registros asociados eliminados definitivamente.',
      socioId: id
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error eliminando socio.';
    res.status(400).json({ error: message });
  }
};

// ==========================================
// 3. MEDIDORES
// ==========================================

export const getMedidores = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { socioId } = req.query;
    const query = socioId ? `id_socio=eq.${socioId}&order=created_at.asc` : 'order=created_at.asc';
    const [resData, lecRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('medidores', query),
      supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', 'order=fecha_lectura.asc')
    ]);

    const lecturaInicialMap = new Map<string, number>();
    (lecRes.data || []).forEach((l) => {
      const mId = l.id_medidor as string;
      if (mId && !lecturaInicialMap.has(mId)) {
        lecturaInicialMap.set(mId, Number(l.lectura_anterior ?? l.lectura_actual ?? 0));
      }
    });

    const mapped = (resData.data || []).map((m) => {
      const lecIni = lecturaInicialMap.get(m.id as string) ?? Number(m.lectura_inicial ?? m.lecturaInicial ?? 0);
      return {
        id: m.id as string,
        idSocio: m.id_socio as string,
        id_socio: m.id_socio as string,
        idSector: m.id_sector as string,
        id_sector: m.id_sector as string,
        numeroMedidor: (m.numero_medidor || m.numeroMedidor || 'S/N') as string,
        numero_medidor: (m.numero_medidor || m.numeroMedidor || 'S/N') as string,
        alias: (m.alias as string) || 'Casa principal',
        direccion: (m.direccion as string) || '',
        tieneAlcantarillado: Boolean(m.tiene_alcantarillado ?? m.tieneAlcantarillado),
        tiene_alcantarillado: Boolean(m.tiene_alcantarillado ?? m.tieneAlcantarillado),
        lecturaInicial: lecIni,
        lectura_inicial: lecIni,
        estado: (m.estado as string) || 'ACTIVO',
        createdAt: m.created_at as string,
        updatedAt: m.updated_at as string
      };
    });
    res.json({ total: mapped.length, data: mapped });
  } catch (error) {
    console.error('[WaterController] Error obteniendo medidores:', error);
    res.status(500).json({ error: 'Error obteniendo medidores.' });
  }
};

export const getMedidoresBySocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [resData, lecRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id_socio=eq.${id}&order=created_at.asc`),
      supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id_socio=eq.${id}&order=fecha_lectura.asc`)
    ]);

    const lecturaInicialMap = new Map<string, number>();
    (lecRes.data || []).forEach((l) => {
      const mId = l.id_medidor as string;
      if (mId && !lecturaInicialMap.has(mId)) {
        lecturaInicialMap.set(mId, Number(l.lectura_anterior ?? l.lectura_actual ?? 0));
      }
    });

    const mapped = (resData.data || []).map((m) => {
      const lecIni = lecturaInicialMap.get(m.id as string) ?? Number(m.lectura_inicial ?? m.lecturaInicial ?? 0);
      return {
        id: m.id as string,
        idSocio: m.id_socio as string,
        id_socio: m.id_socio as string,
        idSector: m.id_sector as string,
        id_sector: m.id_sector as string,
        numeroMedidor: (m.numero_medidor || m.numeroMedidor || 'S/N') as string,
        numero_medidor: (m.numero_medidor || m.numeroMedidor || 'S/N') as string,
        alias: (m.alias as string) || 'Casa principal',
        direccion: (m.direccion as string) || '',
        tieneAlcantarillado: Boolean(m.tiene_alcantarillado ?? m.tieneAlcantarillado),
        tiene_alcantarillado: Boolean(m.tiene_alcantarillado ?? m.tieneAlcantarillado),
        lecturaInicial: lecIni,
        lectura_inicial: lecIni,
        estado: (m.estado as string) || 'ACTIVO',
        createdAt: m.created_at as string,
        updatedAt: m.updated_at as string
      };
    });
    res.json({ total: mapped.length, data: mapped });
  } catch (error) {
    console.error('[WaterController] Error obteniendo medidores del socio:', error);
    res.status(500).json({ error: 'Error obteniendo medidores del socio.' });
  }
};

export const getMedidorById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const target = decodeURIComponent(id).trim();

    let medidor: Record<string, any> | null = null;
    if (isValidUUID(target)) {
      const byId = await supabaseClient.fetchRecords<Record<string, any>>('medidores', `id=eq.${target}&limit=1`);
      if (byId.data && byId.data.length > 0) medidor = byId.data[0];
    }
    if (!medidor) {
      const byNum = await supabaseClient.fetchRecords<Record<string, any>>('medidores', `numero_medidor=eq.${encodeURIComponent(target)}&limit=1`);
      if (byNum.data && byNum.data.length > 0) medidor = byNum.data[0];
    }

    if (!medidor) {
      res.status(404).json({ error: `Medidor ${target} no encontrado.` });
      return;
    }

    const lecRes = await supabaseClient.fetchRecords<Record<string, any>>('lecturas', `id_medidor=eq.${medidor.id}&order=fecha_lectura.asc&limit=1`);
    const lecIni = (lecRes.data && lecRes.data.length > 0)
      ? Number(lecRes.data[0].lectura_anterior ?? lecRes.data[0].lectura_actual ?? 0)
      : Number(medidor.lectura_inicial ?? medidor.lecturaInicial ?? 0);

    const mapped = {
      id: medidor.id,
      idSocio: medidor.id_socio,
      id_socio: medidor.id_socio,
      idSector: medidor.id_sector,
      id_sector: medidor.id_sector,
      numeroMedidor: medidor.numero_medidor,
      numero_medidor: medidor.numero_medidor,
      alias: medidor.alias || 'Casa principal',
      direccion: medidor.direccion || '',
      tieneAlcantarillado: Boolean(medidor.tiene_alcantarillado),
      tiene_alcantarillado: Boolean(medidor.tiene_alcantarillado),
      estado: medidor.estado || 'ACTIVO',
      lecturaInicial: lecIni,
      lectura_inicial: lecIni,
      createdAt: medidor.created_at,
      updatedAt: medidor.updated_at
    };

    res.json({ data: mapped });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error obteniendo medidor.';
    res.status(500).json({ error: message });
  }
};

export const createMedidor = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const p = req.body || {};
    const medId = (p.id && isValidUUID(p.id)) ? p.id : crypto.randomUUID();
    const now = new Date().toISOString();
    const tieneAlcant = Boolean(p.tieneAlcantarillado ?? p.tiene_alcantarillado);
    const numMed = (p.numeroMedidor || p.numero_medidor || '').trim();
    const idSocio = p.idSocio || p.id_socio || null;

    if (!numMed) {
      res.status(400).json({ error: 'El número de medidor es obligatorio.' });
      return;
    }

    if (!idSocio) {
      res.status(400).json({ error: 'El idSocio es obligatorio para registrar un medidor.' });
      return;
    }

    const lecIni = Number(p.lecturaInicial ?? p.lectura_inicial ?? 0);

    const record = {
      id: medId,
      id_socio: idSocio,
      id_sector: p.idSector || p.id_sector || '11111111-0000-0000-0000-000000000001',
      numero_medidor: numMed,
      alias: p.alias || 'Casa principal',
      direccion: p.direccion || '',
      tiene_alcantarillado: tieneAlcant,
      estado: p.estado || 'ACTIVO',
      version: 1,
      created_at: now,
      updated_at: now
    };

    await supabaseClient.syncRecord('medidores', record);

    if (lecIni > 0) {
      const basePeriodId = await getBaselinePeriodId();
      await supabaseClient.syncRecord('lecturas', {
        id: crypto.randomUUID(),
        id_medidor: medId,
        id_socio: idSocio,
        id_periodo: basePeriodId,
        lectura_anterior: lecIni,
        lectura_actual: lecIni,
        consumo_total: 0,
        excedente_m3: 0,
        fecha_lectura: now,
        id_lector: '00000000-0000-0000-0000-000000000003',
        observaciones: 'Lectura inicial de apertura/instalación de medidor',
        version: 1,
        created_at: now,
        updated_at: now
      }).catch(() => {});
    }

    if (idSocio && tieneAlcant) {
      await supabaseClient.request(`socios?id=eq.${idSocio}`, {
        method: 'PATCH',
        body: { tiene_alcantarillado: true, updated_at: now }
      }).catch(() => {});
    }

    const mapped = {
      ...record,
      idSocio: record.id_socio,
      idSector: record.id_sector,
      numeroMedidor: record.numero_medidor,
      tieneAlcantarillado: record.tiene_alcantarillado,
      lecturaInicial: lecIni,
      lectura_inicial: lecIni
    };

    res.status(201).json({ message: 'Medidor registrado exitosamente.', data: mapped });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error registrando medidor.';
    res.status(400).json({ error: message });
  }
};

export const addMedidorToSocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const p = req.body || {};
    const medId = crypto.randomUUID();
    const now = new Date().toISOString();
    const tieneAlcant = Boolean(p.tieneAlcantarillado ?? p.tiene_alcantarillado);
    const numMed = p.numeroMedidor || p.numero_medidor;
    const lecIni = Number(p.lecturaInicial ?? p.lectura_inicial ?? 0);

    const record = {
      id: medId,
      id_socio: id,
      id_sector: p.idSector || p.id_sector || '11111111-0000-0000-0000-000000000001',
      numero_medidor: numMed,
      alias: p.alias || 'Acometida adicional',
      direccion: p.direccion || '',
      tiene_alcantarillado: tieneAlcant,
      estado: p.estado || 'ACTIVO',
      version: 1,
      created_at: now,
      updated_at: now
    };

    await supabaseClient.syncRecord('medidores', record);

    if (lecIni > 0) {
      const basePeriodId = await getBaselinePeriodId();
      await supabaseClient.syncRecord('lecturas', {
        id: crypto.randomUUID(),
        id_medidor: medId,
        id_socio: id,
        id_periodo: basePeriodId,
        lectura_anterior: lecIni,
        lectura_actual: lecIni,
        consumo_total: 0,
        excedente_m3: 0,
        fecha_lectura: now,
        id_lector: '00000000-0000-0000-0000-000000000003',
        observaciones: 'Lectura inicial de apertura/instalación de acometida',
        version: 1,
        created_at: now,
        updated_at: now
      }).catch(() => {});
    }

    // Sincronizar socio si el nuevo medidor tiene alcantarillado
    if (tieneAlcant) {
      await supabaseClient.request(`socios?id=eq.${id}`, {
        method: 'PATCH',
        body: { tiene_alcantarillado: true, updated_at: now }
      }).catch(() => {});
    }

    const mapped = {
      ...record,
      idSocio: record.id_socio,
      idSector: record.id_sector,
      numeroMedidor: record.numero_medidor,
      tieneAlcantarillado: record.tiene_alcantarillado,
      lecturaInicial: lecIni,
      lectura_inicial: lecIni
    };

    res.status(201).json({ message: 'Medidor asignado correctamente al socio.', data: mapped });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error agregando medidor.';
    res.status(400).json({ error: message });
  }
};

export const updateMedidor = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.medidorId || req.params.id;
    const p = req.body || {};
    const now = new Date().toISOString();

    const updatePayload: Record<string, unknown> = { updated_at: now };
    if (p.numeroMedidor || p.numero_medidor) updatePayload.numero_medidor = p.numeroMedidor || p.numero_medidor;
    if (p.alias !== undefined) updatePayload.alias = p.alias;
    if (p.direccion !== undefined) updatePayload.direccion = p.direccion;
    if (p.tieneAlcantarillado !== undefined || p.tiene_alcantarillado !== undefined) {
      updatePayload.tiene_alcantarillado = Boolean(p.tieneAlcantarillado ?? p.tiene_alcantarillado);
    }
    if (p.estado !== undefined) updatePayload.estado = p.estado;
    if (p.idSector || p.id_sector) updatePayload.id_sector = p.idSector || p.id_sector;

    await supabaseClient.request(`medidores?id=eq.${id}`, {
      method: 'PATCH',
      body: updatePayload
    });

    let finalLecIni: number | undefined = undefined;
    if (p.lecturaInicial !== undefined || p.lectura_inicial !== undefined) {
      finalLecIni = Number(p.lecturaInicial ?? p.lectura_inicial ?? 0);
      const basePeriodId = await getBaselinePeriodId();
      const lecFetch = await supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id_medidor=eq.${id}&order=fecha_lectura.asc&limit=1`);
      if (lecFetch.data && lecFetch.data.length > 0) {
        const baseLec = lecFetch.data[0];
        if (baseLec.id_periodo === basePeriodId || (Number(baseLec.consumo_total || 0) === 0 && Number(baseLec.lectura_anterior) === Number(baseLec.lectura_actual))) {
          await supabaseClient.request(`lecturas?id=eq.${baseLec.id}`, {
            method: 'PATCH',
            body: { lectura_anterior: finalLecIni, lectura_actual: finalLecIni, updated_at: now }
          }).catch(() => {});
        }
      } else if (finalLecIni > 0) {
        const medRes = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id=eq.${id}&limit=1`);
        const socioId = (medRes.data?.[0]?.id_socio as string) || '00000000-0000-0000-0000-000000000001';
        await supabaseClient.syncRecord('lecturas', {
          id: crypto.randomUUID(),
          id_medidor: id,
          id_socio: socioId,
          id_periodo: basePeriodId,
          lectura_anterior: finalLecIni,
          lectura_actual: finalLecIni,
          consumo_total: 0,
          excedente_m3: 0,
          fecha_lectura: now,
          id_lector: '00000000-0000-0000-0000-000000000003',
          observaciones: 'Lectura inicial de apertura/instalación de acometida',
          version: 1,
          created_at: now,
          updated_at: now
        }).catch(() => {});
      }
    }

    // Re-sincronizar el estado de alcantarillado y medidor principal en el socio propietario
    const medFetch = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id=eq.${id}&limit=1`);
    if (medFetch.data && medFetch.data[0]?.id_socio) {
      const socioId = medFetch.data[0].id_socio as string;
      const allMedsRes = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id_socio=eq.${socioId}`);
      const meds = allMedsRes.data || [];
      const hasAnyAlcant = meds.some((m) => Boolean(m.tiene_alcantarillado) && m.estado !== 'CORTADO');
      const socioPatch: Record<string, unknown> = { tiene_alcantarillado: hasAnyAlcant, updated_at: now };
      if (updatePayload.numero_medidor) {
        socioPatch.medidor_numero = updatePayload.numero_medidor;
      }
      await supabaseClient.request(`socios?id=eq.${socioId}`, {
        method: 'PATCH',
        body: socioPatch
      }).catch(() => {});
    }

    const mapped = {
      id,
      ...updatePayload,
      numeroMedidor: updatePayload.numero_medidor,
      tieneAlcantarillado: updatePayload.tiene_alcantarillado,
      lecturaInicial: finalLecIni,
      lectura_inicial: finalLecIni
    };

    res.json({ message: 'Medidor actualizado correctamente.', data: mapped });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error actualizando medidor.';
    res.status(400).json({ error: message });
  }
};

export const deleteMedidor = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.medidorId || req.params.id;
    const now = new Date().toISOString();

    const medFetch = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id=eq.${id}&limit=1`);
    if (!medFetch.data || medFetch.data.length === 0) {
      res.status(404).json({ error: 'Medidor no encontrado.' });
      return;
    }
    const med = medFetch.data[0];
    const socioId = med.id_socio as string;

    // Eliminar lecturas del medidor (incluida lectura inicial de base)
    await supabaseClient.request(`lecturas?id_medidor=eq.${id}`, { method: 'DELETE' }).catch(() => {});

    // Eliminar facturas pendientes asociadas al medidor
    await supabaseClient.request(`facturas?id_medidor=eq.${id}&estado_pago=eq.PENDIENTE`, { method: 'DELETE' }).catch(() => {});

    // Eliminar el medidor físicamente
    await supabaseClient.request(`medidores?id=eq.${id}`, { method: 'DELETE' });

    // Re-sincronizar alcantarillado del socio
    if (socioId) {
      const allMedsRes = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id_socio=eq.${socioId}`);
      const remainingMeds = allMedsRes.data || [];
      const hasAnyAlcant = remainingMeds.some((m) => Boolean(m.tiene_alcantarillado) && m.estado !== 'CORTADO');
      const firstActive = remainingMeds.find((m) => m.estado !== 'CORTADO') || remainingMeds[0];

      await supabaseClient.request(`socios?id=eq.${socioId}`, {
        method: 'PATCH',
        body: {
          tiene_alcantarillado: hasAnyAlcant,
          medidor_numero: (firstActive?.numero_medidor as string) || 'S/N',
          updated_at: now
        }
      }).catch(() => {});
    }

    res.json({ success: true, message: 'Medidor eliminado exitosamente.', id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error eliminando medidor.';
    res.status(400).json({ error: message });
  }
};

// ==========================================
// 3.1. CONSULTA UNIVERSAL DE DEUDAS Y CONSUMO POR MEDIDOR Y SOCIO
// ==========================================

export const getMedidorDeudas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const target = decodeURIComponent(id).trim();

    // 1. Buscar medidor por ID (UUID) o por numero_medidor
    let medidor: Record<string, any> | null = null;
    if (isValidUUID(target)) {
      const byId = await supabaseClient.fetchRecords<Record<string, any>>('medidores', `id=eq.${target}&limit=1`);
      if (byId.data && byId.data.length > 0) medidor = byId.data[0];
    }
    if (!medidor) {
      const byNum = await supabaseClient.fetchRecords<Record<string, any>>('medidores', `numero_medidor=eq.${encodeURIComponent(target)}&limit=1`);
      if (byNum.data && byNum.data.length > 0) medidor = byNum.data[0];
    }

    if (!medidor) {
      res.status(404).json({ error: `Medidor ${target} no encontrado en la base de datos.` });
      return;
    }

    const medId = medidor.id as string;
    const socioId = medidor.id_socio as string;

    // 2. Cargar socio, sector, lecturas, facturas, multas y periodos en paralelo
    const [socRes, secRes, lecRes, facRes, mulRes, perRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, any>>('socios', `id=eq.${socioId}&limit=1`),
      medidor.id_sector ? supabaseClient.fetchRecords<Record<string, any>>('sectores', `id=eq.${medidor.id_sector}&limit=1`) : Promise.resolve({ data: [] }),
      supabaseClient.fetchRecords<Record<string, any>>('lecturas', `id_medidor=eq.${medId}&order=fecha_lectura.desc&limit=10`),
      supabaseClient.fetchRecords<Record<string, any>>('facturas', `id_medidor=eq.${medId}&order=created_at.desc`),
      supabaseClient.fetchRecords<Record<string, any>>('multas_rubros', `id_socio=eq.${socioId}&estado=neq.PAGADO`),
      supabaseClient.fetchRecords<Record<string, any>>('periodos', 'order=fecha_inicio.desc')
    ]);

    const socio = socRes.data && socRes.data.length > 0 ? socRes.data[0] : { id: socioId, nombres: 'Socio', apellidos: '', cedula_ruc: '-' };
    const sector = secRes.data && secRes.data.length > 0 ? secRes.data[0] : null;
    const lecturas = lecRes.data || [];
    const facturas = facRes.data || [];
    const multas = mulRes.data || [];
    const periodosList = perRes.data || [];

    const periodosMap = new Map<string, Record<string, any>>();
    for (const p of periodosList) {
      if (p.id) periodosMap.set(p.id as string, p);
      if (p.periodo_codigo) periodosMap.set(p.periodo_codigo as string, p);
    }
    const activePeriod = periodosList.find((p) => p.estado === 'ABIERTO') || periodosList[0] || null;
    const activePeriodId = (activePeriod?.id as string) || '';
    const activePeriodCod = (activePeriod?.periodo_codigo || activePeriod?.codigo || '') as string;

    const esTercera = ValidationRules.calcularEsTerceraEdad(socio.fecha_nacimiento as string) || Boolean(socio.es_tercera_edad);
    const tarifaBase = esTercera ? 5.0 : 7.0;

    // Última lectura registrada para este medidor con desglose de consumo
    const ultimaLectura = lecturas[0] || null;
    const lecturaAnterior = Number(ultimaLectura?.lectura_anterior ?? medidor.lectura_anterior ?? medidor.lectura_inicial ?? 0);
    const lecturaActual = Number(ultimaLectura?.lectura_actual ?? lecturaAnterior);
    const consumoTotalM3 = Number(ultimaLectura?.consumo_total ?? ultimaLectura?.consumo_m3 ?? Math.max(0, lecturaActual - lecturaAnterior));
    const excedenteM3 = Math.max(0, consumoTotalM3 - 30);
    const valorExcedente = Number((excedenteM3 * 0.10).toFixed(2));

    const facturasPendientes = facturas.filter((f) => f.estado_pago === 'PENDIENTE');
    const facturasPagadas = facturas.filter((f) => f.estado_pago === 'PAGADO');

    let mesesAdeudados = 0;
    let totalDeuda = 0;
    let totalDeudaHistorica = 0;
    let totalMultas = 0;
    let totalAlcantarillado = 0;
    let totalBaseAgua = 0;
    let totalExcedente = 0;

    const facturasDetalladas = facturasPendientes.map((f) => {
      const vBase = Number(f.valor_base || 0);
      const vDeudaAnt = Number(f.valor_deuda_anterior || 0);
      const vMultas = Number(f.valor_multas || 0);
      const recargoAlcant = (medidor.tiene_alcantarillado && vBase > 0) ? 1.0 : 0.0;
      const vAlcant = Number(f.valor_alcantarillado || 0) > 1.0 ? recargoAlcant : Number(f.valor_alcantarillado || 0);
      const isCurrentPeriod = f.id_periodo === activePeriodId;
      const pObj = periodosMap.get(f.id_periodo);
      const pCod = (pObj?.periodo_codigo || pObj?.codigo || (isCurrentPeriod ? activePeriodCod : 'Anterior')) as string;

      let realConsumoM3 = Number(f.consumo_m3 || 0);
      let realExcedenteM3 = Number(f.excedente_m3 || 0);
      let vExc = Number(f.valor_excedente || 0);
      if (isCurrentPeriod && vBase > 0) {
        if (consumoTotalM3 > 0 && lecturaActual > lecturaAnterior) {
          realConsumoM3 = consumoTotalM3;
          realExcedenteM3 = excedenteM3;
          vExc = valorExcedente;
        } else if (f.consumo_m3 !== undefined && f.consumo_m3 !== null) {
          realConsumoM3 = Number(f.consumo_m3);
          realExcedenteM3 = Number(f.excedente_m3 || 0);
          vExc = Number(f.valor_excedente || 0);
        }
      }
      const totalMes = Number((vBase + vExc + vAlcant).toFixed(2));
      const totPagar = Number(f.saldo_pendiente !== undefined && f.saldo_pendiente !== null ? f.saldo_pendiente : (totalMes + vDeudaAnt + vMultas).toFixed(2));

      totalDeuda += totPagar;
      totalDeudaHistorica += vDeudaAnt;
      totalMultas += vMultas;
      totalAlcantarillado += vAlcant;
      totalBaseAgua += vBase;
      totalExcedente += vExc;

      let mFactura = 0;
      if (vBase > 0) mFactura += 1;
      if (vDeudaAnt > 0) mFactura += Math.max(1, Math.round(vDeudaAnt / tarifaBase));
      if (mFactura === 0 && totPagar > 0) mFactura = 1;
      mesesAdeudados += mFactura;

      return {
        id: f.id,
        numeroFactura: f.numero_factura || f.id,
        periodoCodigo: pCod,
        fechaEmision: f.fecha_emision || f.created_at,
        fechaVencimiento: f.fecha_vencimiento,
        consumoM3: realConsumoM3,
        excedenteM3: realExcedenteM3,
        valorBase: vBase,
        valorExcedente: vExc,
        valorAlcantarillado: vAlcant,
        valorMultas: vMultas,
        valorDeudaAnterior: vDeudaAnt,
        totalMes: totalMes,
        totalPagar: totPagar,
        saldoPendiente: totPagar,
        montoPagado: Number(f.monto_pagado || 0),
        estadoPago: f.estado_pago,
        mesesCalculados: mFactura
      };
    });

    const tienePagadoMes = facturasPagadas.some((f) => {
      const isPeriodo = f.id_periodo === activePeriodId;
      const cobroConsumo = Number(f.total_mes || 0) > 0 || Number(f.valor_base || 0) > 0;
      return isPeriodo && cobroConsumo;
    });
    const tieneAguaPendienteMes = facturasDetalladas.some((f) => {
      return f.periodoCodigo === activePeriodCod || (f.id_periodo === activePeriodId);
      return isPeriodo && f.estadoPago === 'PENDIENTE' && Number(f.valorBase || 0) > 0;
    });
    const yaPagadoMes = tienePagadoMes && !tieneAguaPendienteMes;

    const requiereCorte = mesesAdeudados >= 3 || facturasPendientes.length >= 3;

    res.json({
      medidor: {
        id: medidor.id,
        idMedidor: medidor.id,
        numeroMedidor: medidor.numero_medidor,
        numero_medidor: medidor.numero_medidor,
        alias: medidor.alias || 'Casa principal',
        direccion: medidor.direccion || socio.direccion || '',
        tieneAlcantarillado: Boolean(medidor.tiene_alcantarillado),
        estado: medidor.estado || 'ACTIVO',
        idSector: medidor.id_sector,
        nombreSector: sector?.nombre_sector || 'Sector General',
        lecturaInicial: lecturaAnterior,
        lectura_inicial: lecturaAnterior,
        yaPagadoMes: yaPagadoMes
      },
      socio: {
        id: socio.id,
        idSocio: socio.id,
        codigoSocio: socio.codigo_socio,
        nombreCompleto: `${socio.nombres || ''} ${socio.apellidos || ''}`.trim(),
        cedulaRuc: socio.cedula_ruc,
        telefono: socio.telefono || '',
        esTerceraEdad: esTercera,
        tarifaBaseAplicable: tarifaBase
      },
      consumoActual: {
        lecturaAnterior,
        lecturaActual,
        consumoTotalM3,
        excedenteM3,
        tarifaBase,
        valorExcedente,
        fechaLectura: ultimaLectura?.fecha_lectura || null,
        observaciones: ultimaLectura?.observaciones || null
      },
      resumenDeuda: {
        totalDeuda: Number(totalDeuda.toFixed(2)),
        totalDeudaHistorica: Number(totalDeudaHistorica.toFixed(2)),
        totalMultas: Number(totalMultas.toFixed(2)),
        totalAlcantarillado: Number(totalAlcantarillado.toFixed(2)),
        totalBaseAgua: Number(totalBaseAgua.toFixed(2)),
        totalExcedente: Number(totalExcedente.toFixed(2)),
        facturasPendientesCount: facturasPendientes.length,
        facturasPagadasCount: facturasPagadas.length,
        mesesAdeudados,
        requiereCorte
      },
      facturasPendientes: facturasDetalladas,
      facturasPagadas: facturasPagadas.slice(0, 10),
      multasPendientes: multas,
      lecturasHistorial: lecturas
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error consultando deudas del medidor.';
    res.status(500).json({ error: message });
  }
};

export const getMedidoresDeudas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { sectorId, minMeses, q } = req.query as Record<string, string>;
    const [medRes, socRes, facRes, lecRes, secRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, any>>('medidores'),
      supabaseClient.fetchRecords<Record<string, any>>('socios'),
      supabaseClient.fetchRecords<Record<string, any>>('facturas', 'estado_pago=eq.PENDIENTE'),
      supabaseClient.fetchRecords<Record<string, any>>('lecturas', 'order=fecha_lectura.desc'),
      supabaseClient.fetchRecords<Record<string, any>>('sectores')
    ]);

    const medidores = medRes.data || [];
    const socios = socRes.data || [];
    const facturas = facRes.data || [];
    const lecturas = lecRes.data || [];
    const sectores = secRes.data || [];

    const socMap = new Map(socios.map((s) => [s.id as string, s]));
    const secMap = new Map(sectores.map((s) => [s.id as string, s.nombre_sector as string]));

    const lecPorMedidor = new Map<string, any>();
    for (const l of lecturas) {
      if (l.id_medidor && !lecPorMedidor.has(l.id_medidor as string)) {
        lecPorMedidor.set(l.id_medidor as string, l);
      }
    }

    const facturasPorMedidor = new Map<string, any[]>();
    for (const f of facturas) {
      const mId = f.id_medidor as string;
      if (mId) {
        if (!facturasPorMedidor.has(mId)) facturasPorMedidor.set(mId, []);
        facturasPorMedidor.get(mId)!.push(f);
      }
    }

    let resultado = medidores.map((m) => {
      const s = socMap.get(m.id_socio as string) || { nombres: 'Socio', apellidos: '', cedula_ruc: '-', codigo_socio: 'S/N' };
      const esTercera = ValidationRules.calcularEsTerceraEdad(s.fecha_nacimiento as string) || Boolean(s.es_tercera_edad);
      const tarifaBase = esTercera ? 5.0 : 7.0;

      const medFacs = facturasPorMedidor.get(m.id as string) || [];
      const ultLec = lecPorMedidor.get(m.id as string) || null;

      const lecturaAnterior = Number(ultLec?.lectura_anterior ?? m.lectura_anterior ?? m.lectura_inicial ?? 0);
      const lecturaActual = Number(ultLec?.lectura_actual ?? lecturaAnterior);
      const consumoTotalM3 = Number(ultLec?.consumo_total ?? ultLec?.consumo_m3 ?? Math.max(0, lecturaActual - lecturaAnterior));
      const excedenteM3 = Math.max(0, consumoTotalM3 - 30);
      const valorExcedente = Number((excedenteM3 * 0.10).toFixed(2));

      let totalDeuda = 0;
      let mesesAdeudados = 0;

      medFacs.forEach((f) => {
        const vBase = Number(f.valor_base || 0);
        const vDeudaAnt = Number(f.valor_deuda_anterior || 0);
        const totP = Number(f.total_pagar || 0);
        totalDeuda += totP;

        let mF = 0;
        if (vBase > 0) mF += 1;
        if (vDeudaAnt > 0) mF += Math.max(1, Math.round(vDeudaAnt / tarifaBase));
        if (mF === 0 && totP > 0) mF = 1;
        mesesAdeudados += mF;
      });

      return {
        id: m.id,
        idMedidor: m.id,
        numeroMedidor: m.numero_medidor,
        alias: m.alias || 'Casa principal',
        direccion: m.direccion || s.direccion || '',
        tieneAlcantarillado: Boolean(m.tiene_alcantarillado),
        estado: m.estado || 'ACTIVO',
        idSector: m.id_sector,
        nombreSector: secMap.get(m.id_sector as string) || 'Sector General',
        socio: {
          id: s.id,
          codigoSocio: s.codigo_socio,
          nombreCompleto: `${s.nombres || ''} ${s.apellidos || ''}`.trim(),
          cedulaRuc: s.cedula_ruc,
          telefono: s.telefono || '',
          esTerceraEdad: esTercera
        },
        consumoActual: {
          lecturaAnterior,
          lecturaActual,
          consumoTotalM3,
          excedenteM3,
          tarifaBase,
          valorExcedente,
          fechaLectura: ultLec?.fecha_lectura || null,
          observaciones: ultLec?.observaciones || null
        },
        totalDeuda: Number(totalDeuda.toFixed(2)),
        mesesAdeudados,
        requiereCorte: mesesAdeudados >= 3,
        facturasPendientes: medFacs
      };
    }).filter((m) => m.totalDeuda > 0);

    if (sectorId && sectorId.trim()) {
      resultado = resultado.filter((m) => m.idSector === sectorId);
    }
    if (minMeses && !isNaN(parseInt(minMeses, 10))) {
      const min = parseInt(minMeses, 10);
      resultado = resultado.filter((m) => m.mesesAdeudados >= min);
    }
    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      resultado = resultado.filter(
        (m) =>
          m.numeroMedidor.toLowerCase().includes(term) ||
          m.socio.nombreCompleto.toLowerCase().includes(term) ||
          m.socio.cedulaRuc.toLowerCase().includes(term) ||
          m.socio.codigoSocio.toLowerCase().includes(term) ||
          m.nombreSector.toLowerCase().includes(term)
      );
    }

    resultado.sort((a, b) => b.mesesAdeudados - a.mesesAdeudados || b.totalDeuda - a.totalDeuda);

    res.json({
      total: resultado.length,
      deudaTotalAcumulada: Number(resultado.reduce((acc, m) => acc + m.totalDeuda, 0).toFixed(2)),
      casosCorte: resultado.filter((m) => m.requiereCorte).length,
      data: resultado
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error obteniendo deudas de medidores.';
    res.status(500).json({ error: message });
  }
};

export const getSocioDeudas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const target = decodeURIComponent(id).trim();

    let socio: Record<string, any> | null = null;
    if (isValidUUID(target)) {
      const byId = await supabaseClient.fetchRecords<Record<string, any>>('socios', `id=eq.${target}&limit=1`);
      if (byId.data && byId.data.length > 0) socio = byId.data[0];
    }
    if (!socio) {
      const byCed = await supabaseClient.fetchRecords<Record<string, any>>('socios', `cedula_ruc=eq.${encodeURIComponent(target)}&limit=1`);
      if (byCed.data && byCed.data.length > 0) socio = byCed.data[0];
    }
    if (!socio) {
      const byCod = await supabaseClient.fetchRecords<Record<string, any>>('socios', `codigo_socio=eq.${encodeURIComponent(target)}&limit=1`);
      if (byCod.data && byCod.data.length > 0) socio = byCod.data[0];
    }

    if (!socio) {
      res.status(404).json({ error: `Socio ${target} no encontrado.` });
      return;
    }

    const socioId = socio.id as string;
    const [medRes, facRes, mulRes, lecRes, secRes, perRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, any>>('medidores', `id_socio=eq.${socioId}`),
      supabaseClient.fetchRecords<Record<string, any>>('facturas', `id_socio=eq.${socioId}&order=created_at.desc`),
      supabaseClient.fetchRecords<Record<string, any>>('multas_rubros', `id_socio=eq.${socioId}&estado=neq.PAGADO`),
      supabaseClient.fetchRecords<Record<string, any>>('lecturas', `id_socio=eq.${socioId}&order=fecha_lectura.desc`),
      supabaseClient.fetchRecords<Record<string, any>>('sectores'),
      supabaseClient.fetchRecords<Record<string, any>>('periodos', 'order=fecha_inicio.desc')
    ]);

    const medidores = medRes.data || [];
    const facturas = facRes.data || [];
    const multas = mulRes.data || [];
    const lecturas = lecRes.data || [];
    const sectores = secRes.data || [];
    const periodosList = perRes.data || [];

    const periodosMap = new Map<string, Record<string, any>>();
    for (const p of periodosList) {
      if (p.id) periodosMap.set(p.id as string, p);
      if (p.periodo_codigo) periodosMap.set(p.periodo_codigo as string, p);
    }
    const activePeriod = periodosList.find((p) => p.estado === 'ABIERTO') || periodosList[0] || null;
    const activePeriodId = (activePeriod?.id as string) || '';
    const activePeriodCod = (activePeriod?.periodo_codigo || activePeriod?.codigo || '') as string;

    const secMap = new Map(sectores.map((s) => [s.id as string, s.nombre_sector as string]));

    const esTercera = ValidationRules.calcularEsTerceraEdad(socio.fecha_nacimiento as string) || Boolean(socio.es_tercera_edad);
    const tarifaBase = esTercera ? 5.0 : 7.0;

    const medidoresConDeudas = medidores.map((m) => {
      const mId = m.id as string;
      const medFacs = facturas.filter((f) => f.id_medidor === mId || (medidores.length === 1 && !f.id_medidor));
      const medPendientes = medFacs.filter((f) => f.estado_pago === 'PENDIENTE');
      const medPagadas = medFacs.filter((f) => f.estado_pago === 'PAGADO');
      const medLecs = lecturas.filter((l) => l.id_medidor === mId);
      const ultLec = medLecs[0] || null;

      const lecturaAnterior = Number(ultLec?.lectura_anterior ?? m.lectura_anterior ?? m.lectura_inicial ?? 0);
      const lecturaActual = Number(ultLec?.lectura_actual ?? lecturaAnterior);
      const consumoTotalM3 = Number(ultLec?.consumo_total ?? ultLec?.consumo_m3 ?? Math.max(0, lecturaActual - lecturaAnterior));
      const excedenteM3 = Math.max(0, consumoTotalM3 - 30);
      const valorExcedente = Number((excedenteM3 * 0.10).toFixed(2));
      const recargoAlcant = m.tiene_alcantarillado ? 1.0 : 0.0;
      const subtotalMesActual = Number((tarifaBase + valorExcedente + recargoAlcant).toFixed(2));

      let mTotalDeuda = 0;
      let mMeses = 0;

      const facturasDet = medPendientes.map((f) => {
        const vBase = Number(f.valor_base || 0);
        const vDeudaAnt = Number(f.valor_deuda_anterior || 0);
        const vMultas = Number(f.valor_multas || 0);
        const recargoAlcant = (m.tiene_alcantarillado && vBase > 0) ? 1.0 : 0.0;
        const vAlcant = Number(f.valor_alcantarillado || 0) > 1.0 ? recargoAlcant : Number(f.valor_alcantarillado || 0);
        const isCurrentPeriod = f.id_periodo === activePeriodId;
        const pObj = periodosMap.get(f.id_periodo);
        const pCod = (pObj?.periodo_codigo || pObj?.codigo || (isCurrentPeriod ? activePeriodCod : 'Anterior')) as string;
        const isCorte = isPeriodoCorte(pCod);

        let realConsumoM3 = Number(f.consumo_m3 || 0);
        let realExcedenteM3 = Number(f.excedente_m3 || 0);
        let vExc = Number(f.valor_excedente || 0);
        if (isCurrentPeriod && vBase > 0) {
          if (consumoTotalM3 > 0 && lecturaActual > lecturaAnterior) {
            realConsumoM3 = consumoTotalM3;
            realExcedenteM3 = excedenteM3;
            vExc = valorExcedente;
          } else if (f.consumo_m3 !== undefined && f.consumo_m3 !== null) {
            realConsumoM3 = Number(f.consumo_m3);
            realExcedenteM3 = Number(f.excedente_m3 || 0);
            vExc = Number(f.valor_excedente || 0);
          }
        }
        const totalMes = isCorte ? Number(f.total_mes || f.total_pagar || 0) : Number((vBase + vExc + vAlcant).toFixed(2));
        const totPagar = Number(f.saldo_pendiente !== undefined && f.saldo_pendiente !== null ? f.saldo_pendiente : (isCorte ? (f.total_pagar || totalMes) : (totalMes + vDeudaAnt + vMultas)).toFixed(2));
        const deudaAguaMed = totPagar;

        mTotalDeuda += deudaAguaMed;
        let mF = 0;
        if (vBase > 0) mF += 1;
        if (vDeudaAnt > 0) mF += Math.max(1, Math.round(vDeudaAnt / tarifaBase));
        if (mF === 0 && totPagar > 0) mF = 1;
        mMeses += mF;

        return {
          id: f.id,
          numeroFactura: f.numero_factura || f.id,
          periodoCodigo: pCod,
          fechaEmision: f.fecha_emision || f.created_at,
          consumoM3: realConsumoM3,
          excedenteM3: realExcedenteM3,
          valorBase: vBase,
          valorExcedente: vExc,
          valorAlcantarillado: vAlcant,
          valorMultas: vMultas,
          valorDeudaAnterior: vDeudaAnt,
          totalMes: totalMes,
          totalPagar: totPagar,
          saldoPendiente: totPagar,
          montoPagado: Number(f.monto_pagado || 0),
          estadoPago: f.estado_pago,
          mesesAdeudados: mF
        };
      });

      const tienePagadoMes = medPagadas.some((f) => {
        const isPeriodo = f.id_periodo === activePeriodId;
        const cobroConsumo = Number(f.total_mes || 0) > 0 || Number(f.valor_base || 0) > 0;
        return isPeriodo && cobroConsumo;
      });
      const tieneAguaPendienteMes = facturasDet.some((f) => {
        return f.periodoCodigo === activePeriodCod || (f.id_periodo === activePeriodId);
      });
      const yaPagadoMes = tienePagadoMes && !tieneAguaPendienteMes;

      if (mTotalDeuda === 0 && !yaPagadoMes) {
        mTotalDeuda = subtotalMesActual;
        if (mMeses === 0) mMeses = 1;
      }

      return {
        id: m.id,
        idMedidor: m.id,
        numeroMedidor: m.numero_medidor,
        alias: m.alias || 'Casa principal',
        direccion: m.direccion || socio.direccion || '',
        tieneAlcantarillado: Boolean(m.tiene_alcantarillado),
        estado: m.estado || 'ACTIVO',
        nombreSector: secMap.get(m.id_sector as string) || 'Sector General',
        consumoActual: {
          lecturaAnterior,
          lecturaActual,
          consumoTotalM3,
          excedenteM3,
          tarifaBase,
          valorExcedente,
          fechaLectura: ultLec?.fecha_lectura || null,
          observaciones: ultLec?.observaciones || null
        },
        totalDeuda: Number(mTotalDeuda.toFixed(2)),
        mesesAdeudados: mMeses,
        requiereCorte: mMeses >= 3,
        yaPagadoMes: yaPagadoMes,
        facturasPendientes: facturasDet,
        facturasPagadas: medPagadas.map((f) => ({
          id: f.id,
          numeroFactura: f.numero_factura || f.id,
          periodoCodigo: f.id_periodo || '2026-08',
          fechaPago: f.fecha_pago || f.updated_at || f.created_at,
          totalPagar: Number(f.total_pagar || 0),
          estadoPago: f.estado_pago
        }))
      };
    });

    const rubrosAlcantarillado = multas.filter((m) => m.tipo_rubro === 'ALCANTARILLADO');
    const deudaAlcantarillado = Number(
      rubrosAlcantarillado.reduce((acc, m) => acc + Number(m.saldo_pendiente ?? m.monto ?? 0), 0).toFixed(2)
    );
    const multasPendientes = multas.filter((m) => m.tipo_rubro !== 'ALCANTARILLADO');
    const totalMultasVal = Number(
      multasPendientes.reduce((acc, m) => acc + Number(m.saldo_pendiente ?? m.monto ?? 0), 0).toFixed(2)
    );

    const totalDeudaSocio = Number(medidoresConDeudas.reduce((acc, m) => acc + m.totalDeuda, 0).toFixed(2));
    const totalMesesSocio = Math.max(...medidoresConDeudas.map((m) => m.mesesAdeudados), 0);

    res.json({
      socio: {
        id: socio.id,
        codigoSocio: socio.codigo_socio,
        nombreCompleto: `${socio.nombres || ''} ${socio.apellidos || ''}`.trim(),
        cedulaRuc: socio.cedula_ruc,
        telefono: socio.telefono || '',
        direccion: socio.direccion || '',
        esTerceraEdad: esTercera,
        tarifaBaseAplicable: tarifaBase,
        deudaAlcantarillado,
        estado: socio.estado || 'ACTIVO'
      },
      resumenGeneral: {
        totalDeuda: Number((totalDeudaSocio + deudaAlcantarillado + totalMultasVal).toFixed(2)),
        totalDeudaAgua: totalDeudaSocio,
        deudaAlcantarillado,
        totalMultas: totalMultasVal,
        mesesAdeudados: totalMesesSocio,
        requiereCorte: totalMesesSocio >= 3,
        totalMedidores: medidores.length,
        multasPendientesCount: multasPendientes.length
      },
      medidores: medidoresConDeudas,
      multasPendientes,
      rubrosAlcantarillado
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error consultando deudas del socio.';
    res.status(500).json({ error: message });
  }
};

// ==========================================
// 4. PERIODOS DE FACTURACIÓN
// ==========================================

export const getPeriodos = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const resData = await supabaseClient.fetchRecords<Record<string, unknown>>('periodos', 'order=fecha_inicio.desc');
    res.json({ data: resData.data || [] });
  } catch (error) {
    console.error('[WaterController] Error obteniendo periodos:', error);
    res.status(500).json({ error: 'Error obteniendo periodos.' });
  }
};

export const createPeriodo = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { periodoCodigo, nombre, fechaInicio, fechaFin } = req.body || {};
    if (!periodoCodigo || !nombre || !fechaInicio || !fechaFin) {
      res.status(400).json({ error: 'periodoCodigo (YYYY-MM), nombre, fechaInicio y fechaFin son requeridos.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const record = {
      id,
      periodo_codigo: String(periodoCodigo).trim(),
      nombre: String(nombre).trim(),
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      estado: 'ABIERTO',
      created_at: now
    };

    await supabaseClient.syncRecord('periodos', record);
    res.status(201).json({ message: 'Período creado exitosamente.', data: record });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error creando período.';
    res.status(400).json({ error: message });
  }
};

export const cerrarPeriodo = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await supabaseClient.request(`periodos?id=eq.${id}`, {
      method: 'PATCH',
      body: { estado: 'CERRADO' }
    });
    res.json({ message: 'Período cerrado exitosamente.' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error cerrando período.';
    res.status(400).json({ error: message });
  }
};

export const avanzarPeriodo = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { idPeriodo } = req.body || req.params || {};
    const now = new Date().toISOString();

    // 1. Obtener todos los periodos
    const periodosRes = await supabaseClient.fetchRecords<Record<string, any>>('periodos', 'order=fecha_inicio.desc');
    const periodos = periodosRes.data || [];

    // Encontrar el periodo a cerrar (por id o el que esté ABIERTO)
    let currentPeriod: Record<string, any> | null = null;
    if (idPeriodo) {
      currentPeriod = periodos.find((p) => p.id === idPeriodo || p.periodo_codigo === idPeriodo) || null;
    }
    if (!currentPeriod) {
      currentPeriod = periodos.find((p) => p.estado === 'ABIERTO') || periodos[0] || null;
    }

    if (!currentPeriod) {
      res.status(400).json({ error: 'No se encontró un período activo para avanzar.' });
      return;
    }

    const currentCode = String(currentPeriod.periodo_codigo || '2026-08').trim();

    // Emitir facturas a Caja de las lecturas registradas en el período que se cierra (si existen)
    let facturasGeneradasPeriodoAnterior = 0;
    try {
      const resEmision = await ejecutarPasarLecturasACaja(currentPeriod.id);
      facturasGeneradasPeriodoAnterior = resEmision.facturasGeneradas;
    } catch (_e) {
      // Si no había lecturas tomadas o ya estaban facturadas, continúa normalmente
    }

    // Calcular siguiente código YYYY-MM
    const parts = currentCode.split('-');
    let year = parseInt(parts[0], 10) || new Date().getFullYear();
    let month = parseInt(parts[1], 10) || (new Date().getMonth() + 1);

    if (month >= 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }

    const nextCode = `${year}-${String(month).padStart(2, '0')}`;
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const nextNombre = `${meses[month - 1]} ${year}`;
    const fechaInicio = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const fechaFin = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // 2. Cerrar el periodo actual en Supabase
    await supabaseClient.request(`periodos?id=eq.${currentPeriod.id}`, {
      method: 'PATCH',
      body: { estado: 'CERRADO' }
    });

    // 3. Crear o activar el nuevo periodo
    let nextPeriod = periodos.find((p) => p.periodo_codigo === nextCode);
    let nextPeriodId: string;
    if (nextPeriod) {
      nextPeriodId = nextPeriod.id;
      await supabaseClient.request(`periodos?id=eq.${nextPeriodId}`, {
        method: 'PATCH',
        body: { estado: 'ABIERTO' }
      });
    } else {
      nextPeriodId = crypto.randomUUID();
      const newPeriodRecord = {
        id: nextPeriodId,
        periodo_codigo: nextCode,
        nombre: nextNombre,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        estado: 'ABIERTO',
        created_at: now
      };
      await supabaseClient.syncRecord('periodos', newPeriodRecord);
      nextPeriod = newPeriodRecord;
    }

    // 4. Rollover de lecturas y consolidación de deudas pendientes
    const [medRes, lecRes, existingNextLecRes, facRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, any>>('medidores', 'estado=neq.INACTIVO'),
      supabaseClient.fetchRecords<Record<string, any>>('lecturas', `id_periodo=eq.${currentPeriod.id}&order=created_at.desc`),
      supabaseClient.fetchRecords<Record<string, any>>('lecturas', `id_periodo=eq.${nextPeriodId}`),
      supabaseClient.fetchRecords<Record<string, any>>('facturas', 'estado_pago=eq.PENDIENTE')
    ]);

    const medidores = medRes.data || [];
    const lecturasCerradas = lecRes.data || [];
    const lecturasExistentesNext = existingNextLecRes.data || [];
    const facturasPendientes = facRes.data || [];

    const lecMap = new Map<string, Record<string, any>>();
    for (const l of lecturasCerradas) {
      if (l.id_medidor && !lecMap.has(l.id_medidor)) {
        lecMap.set(l.id_medidor, l);
      }
    }

    const nextLecMap = new Map<string, Record<string, any>>();
    for (const l of lecturasExistentesNext) {
      if (l.id_medidor && !nextLecMap.has(l.id_medidor)) {
        nextLecMap.set(l.id_medidor, l);
      }
    }

    let medidoresAvanzados = 0;
    let medidoresConDeuda = 0;
    let montoTotalDeudaAnterior = 0;

    for (const m of medidores) {
      const mId = m.id as string;
      const ultLec = lecMap.get(mId);

      let nuevaLecturaAnterior = 0;
      if (ultLec && ultLec.lectura_actual !== null && ultLec.lectura_actual !== undefined) {
        nuevaLecturaAnterior = Number(ultLec.lectura_actual);
      } else if (ultLec && ultLec.lectura_anterior !== null && ultLec.lectura_anterior !== undefined) {
        nuevaLecturaAnterior = Number(ultLec.lectura_anterior);
      } else {
        nuevaLecturaAnterior = Number(m.lectura_anterior ?? m.lectura_inicial ?? 0);
      }

      // Deudas acumuladas no pagadas de este medidor
      const facsMed = facturasPendientes.filter((f) => f.id_medidor === mId);
      if (facsMed.length > 0) {
        medidoresConDeuda++;
        const subtotal = facsMed.reduce((sum, f) => sum + Number(f.total_mes ?? f.total_pagar ?? 0), 0);
        montoTotalDeudaAnterior += subtotal;
      }

      // Actualizar lectura_anterior en tabla medidores
      await supabaseClient.request(`medidores?id=eq.${mId}`, {
        method: 'PATCH',
        body: {
          lectura_anterior: nuevaLecturaAnterior,
          updated_at: now
        }
      }).catch(() => {});

      // Crear o actualizar registro de lectura para el nuevo periodo
      const existingLec = nextLecMap.get(mId);
      const nuevaLecturaId = existingLec?.id || crypto.randomUUID();

      await supabaseClient.syncRecord('lecturas', {
        id: nuevaLecturaId,
        id_medidor: mId,
        id_socio: m.id_socio,
        id_periodo: nextPeriodId,
        lectura_anterior: nuevaLecturaAnterior,
        lectura_actual: existingLec?.lectura_actual ?? null,
        consumo_total: existingLec?.consumo_total ?? 0,
        excedente_m3: existingLec?.excedente_m3 ?? 0,
        fecha_lectura: existingLec?.fecha_lectura ?? null,
        id_lector: req.user?.id || null,
        observaciones: `Apertura automática del período ${nextCode}`,
        version: 1,
        created_at: existingLec?.created_at || now,
        updated_at: now
      }).catch(() => {});

      medidoresAvanzados++;
    }

    res.json({
      success: true,
      message: `Período ${currentCode} cerrado exitosamente. Período ${nextCode} habilitado con ${medidoresAvanzados} medidores preparados.${facturasGeneradasPeriodoAnterior > 0 ? ` Se emitieron ${facturasGeneradasPeriodoAnterior} facturas a Caja.` : ''}`,
      data: {
        periodoAnterior: {
          id: currentPeriod.id,
          codigo: currentCode,
          estado: 'CERRADO',
          facturasGeneradas: facturasGeneradasPeriodoAnterior
        },
        periodoNuevo: {
          id: nextPeriodId,
          codigo: nextCode,
          nombre: nextNombre,
          estado: 'ABIERTO',
          fechaInicio,
          fechaFin
        },
        medidoresAvanzados,
        medidoresConDeuda,
        montoTotalDeudaAnterior: Number(montoTotalDeudaAnterior.toFixed(2))
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al avanzar período.';
    console.error('[WaterController] Error avanzando período:', error);
    res.status(500).json({ error: message });
  }
};

// ==========================================
// 5. MICROMEDICIÓN Y LECTURAS
// ==========================================

export const getLecturas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { periodoId, periodoCodigo, socioId, medidorId, numeroMedidor } = req.query as Record<string, string>;
    let query = 'order=fecha_lectura.desc&limit=1000';

    let finalPeriodoId = periodoId;
    if (periodoCodigo && !finalPeriodoId) {
      const pRes = await supabaseClient.fetchRecords<Record<string, unknown>>('periodos', `periodo_codigo=eq.${periodoCodigo}&limit=1`);
      if (pRes.data && pRes.data.length > 0) finalPeriodoId = pRes.data[0].id as string;
    } else if (finalPeriodoId && (!finalPeriodoId.includes('-') || finalPeriodoId.length < 30)) {
      const pRes = await supabaseClient.fetchRecords<Record<string, unknown>>('periodos', `periodo_codigo=eq.${finalPeriodoId}&limit=1`);
      if (pRes.data && pRes.data.length > 0) finalPeriodoId = pRes.data[0].id as string;
    }

    if (finalPeriodoId) query += `&id_periodo=eq.${finalPeriodoId}`;
    if (socioId) query += `&id_socio=eq.${socioId}`;

    let finalMedidorId = medidorId;
    if (numeroMedidor && !finalMedidorId) {
      const mRes = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `numero_medidor=eq.${numeroMedidor}&limit=1`);
      if (mRes.data && mRes.data.length > 0) finalMedidorId = mRes.data[0].id as string;
    }
    if (finalMedidorId) query += `&id_medidor=eq.${finalMedidorId}`;

    const [resData, medRes, socRes, perRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', query),
      supabaseClient.fetchRecords<Record<string, unknown>>('medidores'),
      supabaseClient.fetchRecords<Record<string, unknown>>('socios'),
      supabaseClient.fetchRecords<Record<string, unknown>>('periodos')
    ]);

    const medMap = new Map((medRes.data || []).map((m) => [m.id as string, m]));
    const socMap = new Map((socRes.data || []).map((s) => [s.id as string, s]));
    const perMap = new Map((perRes.data || []).map((p) => [p.id as string, p]));

    const mapped = (resData.data || []).map((l) => {
      const m = l.id_medidor ? medMap.get(l.id_medidor as string) : null;
      const s = l.id_socio ? socMap.get(l.id_socio as string) : null;
      const p = l.id_periodo ? perMap.get(l.id_periodo as string) : null;
      const sName = s ? `${s.nombres || ''} ${s.apellidos || ''}`.trim() : '';

      return {
        ...l,
        id: l.id,
        idSocio: l.id_socio,
        clienteId: l.id_socio,
        nombreSocio: sName,
        idMedidor: l.id_medidor,
        numeroMedidor: m?.numero_medidor || l.id_medidor,
        medidorNumero: m?.numero_medidor || l.id_medidor,
        aliasMedidor: m?.alias || 'Casa principal',
        idPeriodo: l.id_periodo,
        periodo: p?.periodo_codigo || l.id_periodo,
        periodoCodigo: p?.periodo_codigo || l.id_periodo,
        lecturaAnterior: Number(l.lectura_anterior ?? 0),
        lecturaActual: Number(l.lectura_actual ?? 0),
        consumoM3: Number(l.consumo_total ?? 0),
        consumoTotal: Number(l.consumo_total ?? 0),
        excedenteM3: Number(l.excedente_m3 ?? 0),
        observaciones: l.observaciones || '',
        idLector: l.id_lector,
        fechaLectura: l.fecha_lectura,
        updatedAt: l.updated_at
      };
    });

    res.json({ data: mapped, total: mapped.length });
  } catch (error) {
    console.error('[WaterController] Error obteniendo lecturas:', error);
    res.status(500).json({ error: 'Error obteniendo lecturas.' });
  }
};

export const getLecturaById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const resData = await supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id=eq.${id}&limit=1`);
    if (!resData.data || resData.data.length === 0) {
      res.status(404).json({ error: 'Lectura no encontrada.' });
      return;
    }
    const l = resData.data[0];
    res.json({
      data: {
        ...l,
        id: l.id,
        idSocio: l.id_socio,
        clienteId: l.id_socio,
        idMedidor: l.id_medidor,
        idPeriodo: l.id_periodo,
        lecturaAnterior: Number(l.lectura_anterior ?? 0),
        lecturaActual: Number(l.lectura_actual ?? 0),
        consumoM3: Number(l.consumo_total ?? 0),
        excedenteM3: Number(l.excedente_m3 ?? 0),
        observaciones: l.observaciones || ''
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo lectura.' });
  }
};

export const registrarLectura = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (Array.isArray(req.body) || Array.isArray(req.body?.lecturas)) {
      return sincronizarLecturasBatch(req, res);
    }
    const { idSocio, idMedidor, medidorId, numeroMedidor, idPeriodo, periodo, lecturaActual, lecturaAnterior, observaciones } = req.body || {};
    
    if (lecturaActual === undefined || lecturaActual === null || isNaN(Number(lecturaActual))) {
      res.status(400).json({ error: 'lecturaActual es requerida y debe ser un valor numérico.' });
      return;
    }

    // 1. Resolver el medidor de forma universal
    const inputMedId = idMedidor || medidorId;
    let foundMedidor: Record<string, unknown> | null = null;

    if (inputMedId) {
      const mRes = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id=eq.${inputMedId}&limit=1`);
      if (mRes.data && mRes.data.length > 0) {
        foundMedidor = mRes.data[0];
      } else {
        const mByNum = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `numero_medidor=eq.${inputMedId}&limit=1`);
        if (mByNum.data && mByNum.data.length > 0) {
          foundMedidor = mByNum.data[0];
        }
      }
    }

    if (!foundMedidor && numeroMedidor) {
      const mByNum = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `numero_medidor=eq.${numeroMedidor}&limit=1`);
      if (mByNum.data && mByNum.data.length > 0) {
        foundMedidor = mByNum.data[0];
      }
    }

    if (!foundMedidor && idSocio) {
      const mBySoc = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id_socio=eq.${idSocio}&order=created_at.asc&limit=1`);
      if (mBySoc.data && mBySoc.data.length > 0) {
        foundMedidor = mBySoc.data[0];
      }
    }

    if (!foundMedidor) {
      res.status(400).json({ error: 'No se encontró un medidor válido para asociar la lectura. Cada lectura requiere un medidor existente.' });
      return;
    }

    const finalIdMedidor = foundMedidor.id as string;
    const finalIdSocio = (foundMedidor.id_socio as string) || idSocio;

    // 2. Resolver el período
    const inputPeriodo = idPeriodo || periodo;
    let finalIdPeriodo = inputPeriodo;

    if (!finalIdPeriodo || !finalIdPeriodo.includes('-') || finalIdPeriodo.length < 30) {
      const activeP = await getActivePeriod();
      if (finalIdPeriodo) {
        const pRes = await supabaseClient.fetchRecords<Record<string, unknown>>('periodos', `periodo_codigo=eq.${finalIdPeriodo}&limit=1`);
        finalIdPeriodo = (pRes.data?.[0]?.id as string) || (activeP?.id as string) || '';
      } else {
        finalIdPeriodo = (activeP?.id as string) || '';
      }
    }

    // 3. Resolver lectura anterior
    let lAnt = Number(lecturaAnterior);
    if (isNaN(lAnt) || lAnt <= 0) {
      const prevLec = await supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id_medidor=eq.${finalIdMedidor}&order=fecha_lectura.desc&limit=1`);
      if (prevLec.data && prevLec.data.length > 0 && prevLec.data[0].id_periodo !== finalIdPeriodo) {
        lAnt = Number(prevLec.data[0].lectura_actual || 0);
      } else {
        lAnt = Number(foundMedidor.lectura_inicial ?? foundMedidor.lectura_anterior ?? 0);
      }
    }

    const lAct = Number(lecturaActual);
    const consumo = Math.max(0, Number((lAct - lAnt).toFixed(3)));
    const excedente = Math.max(0, Number((consumo - 30).toFixed(3)));
    const now = new Date().toISOString();

    // 4. Buscar si ya existe lectura de este medidor en este período
    const existRes = await supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id_medidor=eq.${finalIdMedidor}&id_periodo=eq.${finalIdPeriodo}&limit=1`);
    const recordId = (existRes.data && existRes.data.length > 0) ? (existRes.data[0].id as string) : crypto.randomUUID();

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const finalLectorId = (req.user?.id && uuidRegex.test(req.user.id))
      ? req.user.id
      : '00000000-0000-0000-0000-000000000003';

    const record = {
      id: recordId,
      id_socio: finalIdSocio,
      id_medidor: finalIdMedidor,
      id_periodo: finalIdPeriodo,
      lectura_anterior: lAnt,
      lectura_actual: lAct,
      consumo_total: consumo,
      excedente_m3: excedente,
      fecha_lectura: now,
      id_lector: finalLectorId,
      observaciones: observaciones || (req.user?.rol === 'CAJERO' ? 'Modificado por Cajero' : 'Toma de lectura en campo'),
      updated_at: now
    };

    // 5. Guardar en Supabase y VERIFICAR resultado
    const syncRes = await supabaseClient.syncRecord('lecturas', record);
    if (!syncRes.success) {
      console.error('❌ [WaterController] Error en syncRecord lecturas:', syncRes.error);
      res.status(400).json({ error: `Error persistiendo lectura en Supabase: ${syncRes.error}` });
      return;
    }

    // 6. Sincronizar planilla pendiente en facturas si existe
    try {
      const facRes = await supabaseClient.fetchRecords<Record<string, unknown>>(
        'facturas',
        `id_socio=eq.${finalIdSocio}&id_periodo=eq.${finalIdPeriodo}&estado_pago=eq.PENDIENTE&limit=1`
      );
      if (facRes.data && facRes.data.length > 0) {
        const fac = facRes.data[0];
        const valBase = Number(fac.valor_base || 7.00);
        const valExc = Number((excedente * 0.10).toFixed(2));
        const valAlcant = Number(fac.valor_alcantarillado || 0);
        const totMes = Number((valBase + valExc + valAlcant).toFixed(2));
        const deudasAnt = Number(fac.total_deudas_anteriores || 0);
        const totPagar = Number((totMes + deudasAnt).toFixed(2));

        await supabaseClient.syncRecord('facturas', {
          id: fac.id,
          consumo_m3: consumo,
          excedente_m3: excedente,
          valor_excedente: valExc,
          total_mes: totMes,
          total_pagar: totPagar,
          updated_at: now
        });
      }
    } catch (facSyncErr) {
      console.warn('[WaterController] Aviso actualizando factura ligada:', facSyncErr);
    }

    res.status(201).json({
      message: 'Lectura registrada y calculada correctamente.',
      data: {
        ...record,
        idMedidor: finalIdMedidor,
        idSocio: finalIdSocio,
        idPeriodo: finalIdPeriodo,
        lecturaActual: lAct,
        lecturaAnterior: lAnt,
        consumoM3: consumo,
        excedenteM3: excedente
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error registrando lectura.';
    res.status(400).json({ error: message });
  }
};

export const sincronizarLecturasBatch = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rawLecturas = Array.isArray(req.body) ? req.body : (req.body?.lecturas || [req.body]);
    if (!Array.isArray(rawLecturas) || rawLecturas.length === 0) {
      res.status(400).json({ error: 'Se requiere una lista de lecturas válida.' });
      return;
    }

    const processed = [];
    const errors = [];

    for (const item of rawLecturas) {
      try {
        const { idSocio, idMedidor, medidorId, numeroMedidor, idPeriodo, periodo, lecturaActual, lecturaAnterior, observaciones, fecha_lectura } = item || {};
        if (lecturaActual === undefined || lecturaActual === null || isNaN(Number(lecturaActual))) {
          continue;
        }

        const inputMedId = idMedidor || medidorId;
        let foundMedidor: Record<string, unknown> | null = null;
        if (inputMedId) {
          const mRes = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id=eq.${inputMedId}&limit=1`);
          if (mRes.data && mRes.data.length > 0) {
            foundMedidor = mRes.data[0];
          } else {
            const mByNum = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `numero_medidor=eq.${inputMedId}&limit=1`);
            if (mByNum.data && mByNum.data.length > 0) foundMedidor = mByNum.data[0];
          }
        }
        if (!foundMedidor && numeroMedidor) {
          const mByNum = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `numero_medidor=eq.${numeroMedidor}&limit=1`);
          if (mByNum.data && mByNum.data.length > 0) foundMedidor = mByNum.data[0];
        }
        if (!foundMedidor && idSocio) {
          const mBySoc = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id_socio=eq.${idSocio}&order=created_at.asc&limit=1`);
          if (mBySoc.data && mBySoc.data.length > 0) foundMedidor = mBySoc.data[0];
        }

        if (!foundMedidor) {
          errors.push({ item, error: 'Medidor no encontrado' });
          continue;
        }

        const finalIdMedidor = foundMedidor.id as string;
        const finalIdSocio = (foundMedidor.id_socio as string) || idSocio;

        const inputPeriodo = idPeriodo || periodo;
        let finalIdPeriodo = inputPeriodo;
        if (!finalIdPeriodo || !finalIdPeriodo.includes('-') || finalIdPeriodo.length < 30) {
          const activeP = await getActivePeriod();
          if (finalIdPeriodo) {
            const pRes = await supabaseClient.fetchRecords<Record<string, unknown>>('periodos', `periodo_codigo=eq.${finalIdPeriodo}&limit=1`);
            finalIdPeriodo = (pRes.data?.[0]?.id as string) || (activeP?.id as string) || '';
          } else {
            finalIdPeriodo = (activeP?.id as string) || '';
          }
        }

        let lAnt = Number(lecturaAnterior);
        if (isNaN(lAnt) || lAnt <= 0) {
          const prevLec = await supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id_medidor=eq.${finalIdMedidor}&order=fecha_lectura.desc&limit=1`);
          if (prevLec.data && prevLec.data.length > 0 && prevLec.data[0].id_periodo !== finalIdPeriodo) {
            lAnt = Number(prevLec.data[0].lectura_actual || 0);
          } else {
            lAnt = Number(foundMedidor.lectura_inicial ?? foundMedidor.lectura_anterior ?? 0);
          }
        }

        const lAct = Number(lecturaActual);
        const consumo = Math.max(0, Number((lAct - lAnt).toFixed(3)));
        const excedente = Math.max(0, Number((consumo - 30).toFixed(3)));
        const now = new Date().toISOString();

        const existRes = await supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id_medidor=eq.${finalIdMedidor}&id_periodo=eq.${finalIdPeriodo}&limit=1`);
        const recordId = (existRes.data && existRes.data.length > 0) ? (existRes.data[0].id as string) : crypto.randomUUID();

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const finalLectorId = (req.user?.id && uuidRegex.test(req.user.id))
          ? req.user.id
          : '00000000-0000-0000-0000-000000000003';

        const record = {
          id: recordId,
          id_socio: finalIdSocio,
          id_medidor: finalIdMedidor,
          id_periodo: finalIdPeriodo,
          lectura_anterior: lAnt,
          lectura_actual: lAct,
          consumo_total: consumo,
          excedente_m3: excedente,
          fecha_lectura: fecha_lectura || now,
          id_lector: finalLectorId,
          observaciones: observaciones || (req.user?.rol === 'CAJERO' ? 'Modificado por Cajero' : 'Sincronización móvil directa'),
          updated_at: now
        };

        const syncRes = await supabaseClient.syncRecord('lecturas', record);
        if (syncRes.success) {
          await supabaseClient.request(`medidores?id=eq.${finalIdMedidor}`, {
            method: 'PATCH',
            body: { updated_at: now }
          }).catch(() => {});
          processed.push(record);
        } else {
          errors.push({ item, error: syncRes.error });
        }
      } catch (itemErr) {
        errors.push({ item, error: String(itemErr) });
      }
    }

    res.json({
      success: true,
      message: `Sincronización completada: ${processed.length} lecturas procesadas.`,
      procesadas: processed.length,
      errores: errors.length,
      data: processed
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error procesando lote de lecturas.';
    res.status(500).json({ error: msg });
  }
};

export const updateLectura = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { lecturaActual, lecturaAnterior, observaciones } = req.body || {};

    const existRes = await supabaseClient.fetchRecords<Record<string, unknown>>('lecturas', `id=eq.${id}&limit=1`);
    if (!existRes.data || existRes.data.length === 0) {
      res.status(404).json({ error: 'Lectura no encontrada.' });
      return;
    }

    const current = existRes.data[0];
    const lAnt = lecturaAnterior !== undefined ? Number(lecturaAnterior) : Number(current.lectura_anterior || 0);
    const lAct = lecturaActual !== undefined ? Number(lecturaActual) : Number(current.lectura_actual || 0);
    const consumo = Math.max(0, Number((lAct - lAnt).toFixed(3)));
    const excedente = Math.max(0, Number((consumo - 30).toFixed(3)));
    const now = new Date().toISOString();

    const updated = {
      ...current,
      lectura_anterior: lAnt,
      lectura_actual: lAct,
      consumo_total: consumo,
      excedente_m3: excedente,
      observaciones: observaciones !== undefined ? observaciones : current.observaciones,
      updated_at: now
    };

    const syncRes = await supabaseClient.syncRecord('lecturas', updated);
    if (!syncRes.success) {
      res.status(400).json({ error: `Error actualizando lectura: ${syncRes.error}` });
      return;
    }

    // Sincronizar factura si aplica
    if (current.id_socio && current.id_periodo) {
      try {
        const facRes = await supabaseClient.fetchRecords<Record<string, unknown>>(
          'facturas',
          `id_socio=eq.${current.id_socio}&id_periodo=eq.${current.id_periodo}&estado_pago=eq.PENDIENTE&limit=1`
        );
        if (facRes.data && facRes.data.length > 0) {
          const fac = facRes.data[0];
          const valBase = Number(fac.valor_base || 7.00);
          const valExc = Number((excedente * 0.10).toFixed(2));
          const valAlcant = Number(fac.valor_alcantarillado || 0);
          const totMes = Number((valBase + valExc + valAlcant).toFixed(2));
          const deudasAnt = Number(fac.total_deudas_anteriores || 0);
          const totPagar = Number((totMes + deudasAnt).toFixed(2));

          await supabaseClient.syncRecord('facturas', {
            id: fac.id,
            consumo_m3: consumo,
            excedente_m3: excedente,
            valor_excedente: valExc,
            total_mes: totMes,
            total_pagar: totPagar,
            updated_at: now
          });
        }
      } catch (_) {}
    }

    res.json({
      message: 'Lectura actualizada correctamente.',
      data: {
        ...updated,
        idMedidor: updated.id_medidor,
        idSocio: updated.id_socio,
        idPeriodo: updated.id_periodo,
        lecturaActual: lAct,
        lecturaAnterior: lAnt,
        consumoM3: consumo,
        excedenteM3: excedente
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error actualizando lectura.';
    res.status(400).json({ error: message });
  }
};

export const deleteLectura = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const delRes = await supabaseClient.deleteRecord('lecturas', id, 'id');
    if (!delRes.success) {
      res.status(400).json({ error: `Error eliminando lectura: ${delRes.error}` });
      return;
    }
    res.json({ message: 'Lectura eliminada exitosamente.' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error eliminando lectura.';
    res.status(400).json({ error: message });
  }
};

// ==========================================
// 6. FACTURACIÓN Y COBROS
// ==========================================

export const getFacturas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { socioId, periodoId, estadoPago } = req.query as Record<string, string>;
    let query = 'order=created_at.desc&limit=1000';
    if (socioId) query += `&id_socio=eq.${socioId}`;
    if (periodoId) query += `&id_periodo=eq.${periodoId}`;
    if (estadoPago) query += `&estado_pago=eq.${estadoPago}`;

    const [resData, medRes, socRes, perRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, unknown>>('facturas', query),
      supabaseClient.fetchRecords<Record<string, unknown>>('medidores'),
      supabaseClient.fetchRecords<Record<string, unknown>>('socios'),
      supabaseClient.fetchRecords<Record<string, unknown>>('periodos')
    ]);

    const facturas = resData.data || [];
    const medMap = new Map((medRes.data || []).map((m) => [m.id as string, m]));
    const socMap = new Map((socRes.data || []).map((s) => [s.id as string, s]));
    const perMap = new Map((perRes.data || []).map((p) => [p.id as string, p]));

    const enriched = facturas.map((f) => {
      const m = f.id_medidor ? medMap.get(f.id_medidor as string) : null;
      const s = f.id_socio ? socMap.get(f.id_socio as string) : null;
      const p = f.id_periodo ? perMap.get(f.id_periodo as string) : null;
      const fNum = (f.numero_factura as string) || (f.id as string);
      const isPagado = f.estado_pago === 'PAGADO';
      const totP = Number(f.total_pagar || 0);
      const pCod = (p?.periodo_codigo || p?.codigo || (f.periodo_codigo as string) || '') as string;

      return {
        ...f,
        id: f.id,
        numeroFactura: fNum,
        numero_factura: fNum,
        idSocio: f.id_socio,
        id_socio: f.id_socio,
        idMedidor: f.id_medidor,
        id_medidor: f.id_medidor,
        numeroMedidor: (m?.numero_medidor as string) || '',
        numero_medidor: (m?.numero_medidor as string) || '',
        aliasMedidor: (m?.alias as string) || '',
        socioNombre: s ? `${s.nombres || ''} ${s.apellidos || ''}`.trim() : '',
        socioCedula: (s?.cedula_ruc as string) || '',
        socioCodigo: (s?.codigo_socio as string) || '',
        idPeriodo: f.id_periodo,
        id_periodo: f.id_periodo,
        periodoCodigo: pCod,
        periodo_codigo: pCod,
        estadoPago: (f.estado_pago as string) || 'PENDIENTE',
        estado_pago: (f.estado_pago as string) || 'PENDIENTE',
        totalMes: Number(f.total_mes ?? totP),
        total_mes: Number(f.total_mes ?? totP),
        totalPagar: totP,
        total_pagar: totP,
        montoPagado: isPagado ? totP : Number(f.monto_pagado || 0),
        saldoPendiente: Number(f.saldo_pendiente !== undefined && f.saldo_pendiente !== null ? f.saldo_pendiente : (isPagado ? 0 : totP)),
        fechaPago: f.fecha_pago || f.updated_at || null,
        metodoPago: f.metodo_pago || 'EFECTIVO'
      };
    });

    res.json({ data: enriched, total: enriched.length });
  } catch (error) {
    console.error('[WaterController] Error obteniendo facturas:', error);
    res.status(500).json({ error: 'Error obteniendo facturas.' });
  }
};

export const getFacturaById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const resData = await supabaseClient.fetchRecords<Record<string, unknown>>('facturas', `id=eq.${id}&limit=1`);
    if (!resData.data || resData.data.length === 0) {
      res.status(404).json({ error: 'Factura no encontrada.' });
      return;
    }
    res.json({ data: resData.data[0] });
  } catch (error) {
    console.error('[WaterController] Error obteniendo factura:', error);
    res.status(500).json({ error: 'Error obteniendo factura.' });
  }
};

export const liquidarFactura = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const p = req.body || {};
    const id = p.id || crypto.randomUUID();
    const now = new Date().toISOString();

    const idSocio = p.idSocio || p.id_socio;
    if (!idSocio) {
      res.status(400).json({ error: 'idSocio es obligatorio para liquidar una factura.' });
      return;
    }

    // Resolver medidor si no viene provisto
    let idMedidor = p.idMedidor || p.id_medidor || null;
    if (!idMedidor) {
      const medRes = await supabaseClient.fetchRecords<Record<string, unknown>>('medidores', `id_socio=eq.${idSocio}&limit=1`);
      if (medRes.data && medRes.data.length > 0) {
        idMedidor = medRes.data[0].id;
      }
    }

    const valorBase = Number(p.valorBase ?? p.valor_base ?? (p.esTerceraEdad ? 5.0 : 7.0));
    const consumoM3 = Number(p.consumoM3 ?? p.consumo_m3 ?? 0);
    const excedenteM3 = Number(p.excedenteM3 ?? p.excedente_m3 ?? 0);
    const valorExcedente = Number(p.valorExcedente ?? p.valor_excedente ?? 0.0);
    const valorAlcantarillado = Number(p.valorAlcantarillado ?? p.valor_alcantarillado ?? 0.0);
    const valorMultas = Number(p.valorMultas ?? p.valor_multas ?? 0.0);
    const valorDeudaAnterior = Number(p.valorDeudaAnterior ?? p.valor_deuda_anterior ?? 0.0);
    const totalMes = Number(p.totalMes ?? p.total_mes ?? (valorBase + valorExcedente + valorAlcantarillado));
    const totalPagar = Number(p.totalPagar ?? p.total_pagar ?? (totalMes + valorMultas + valorDeudaAnterior));

    const record = {
      id,
      numero_factura: p.numeroFactura || p.numero_factura || `REC-${String(Date.now()).slice(-6)}`,
      id_socio: idSocio,
      id_medidor: idMedidor,
      id_periodo: p.idPeriodo || p.id_periodo || (await getActivePeriod())?.id || '00000000-0000-0000-0000-000000000000',
      id_lectura: p.idLectura || p.id_lectura || null,
      es_tercera_edad: Boolean(p.esTerceraEdad ?? p.es_tercera_edad ?? false),
      valor_base: valorBase,
      consumo_m3: consumoM3,
      excedente_m3: excedenteM3,
      valor_excedente: valorExcedente,
      valor_alcantarillado: valorAlcantarillado,
      valor_multas: valorMultas,
      valor_deuda_anterior: valorDeudaAnterior,
      total_mes: totalMes,
      total_pagar: totalPagar,
      estado_pago: 'PENDIENTE',
      fecha_vencimiento: p.fechaVencimiento || p.fecha_vencimiento || '2026-09-30',
      version: 1,
      created_at: now,
      updated_at: now
    };

    const syncRes = await supabaseClient.syncRecord('facturas', record);
    if (!syncRes.success) {
      console.error('[WaterController] Error guardando factura en Supabase:', syncRes.error);
      res.status(400).json({ error: syncRes.error || 'Error al guardar factura en Supabase.' });
      return;
    }

    res.status(201).json({ message: 'Planilla liquidada exitosamente.', data: record });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error liquidando factura.';
    res.status(400).json({ error: message });
  }
};

export async function ejecutarPasarLecturasACaja(idPeriodo?: string): Promise<{
  periodo: string;
  targetPeriodId: string;
  facturasGeneradas: number;
  totalM3: number;
  totalFacturadoMes: number;
  totalConDeudas: number;
  facturas: any[];
  sinLecturas: boolean;
}> {
  const now = new Date().toISOString();

  // 1. Obtener período objetivo (por ID, código o el que esté ABIERTO)
  const periodosRes = await supabaseClient.fetchRecords<Record<string, any>>('periodos', 'order=fecha_inicio.desc');
  const periodos = periodosRes.data || [];
  let targetPeriod: Record<string, any> | null = null;

  if (idPeriodo) {
    targetPeriod = periodos.find((p) => p.id === idPeriodo || p.periodo_codigo === idPeriodo) || null;
  }
  if (!targetPeriod) {
    targetPeriod = periodos.find((p) => p.estado === 'ABIERTO') || periodos[0] || null;
  }

  if (!targetPeriod) {
    throw new Error('No se encontró un período activo para pasar a caja.');
  }

  // 2. Obtener tarifas vigentes
  const tarifas = getCurrentTarifas();
  const cargoNormal = tarifas.cargoFijoNormal || 7.0;
  const cargoTercera = tarifas.cargoFijoTerceraEdad || 5.0;
  const recargoAlcant = tarifas.recargoAlcantarillado || 1.0;
  const limiteBase = tarifas.limiteBaseM3 || 30;
  const costoExc = tarifas.costoExcedenteM3 || 0.10;

  // 3. Obtener socios, medidores, lecturas del periodo, facturas existentes y multas
  const [sociosRes, medidoresRes, lecturasRes, facturasRes] = await Promise.all([
    supabaseClient.fetchRecords<Record<string, any>>('socios'),
    supabaseClient.fetchRecords<Record<string, any>>('medidores', 'estado=neq.INACTIVO'),
    supabaseClient.fetchRecords<Record<string, any>>('lecturas', `id_periodo=eq.${targetPeriod.id}`),
    supabaseClient.fetchRecords<Record<string, any>>('facturas')
  ]);

  const socios = sociosRes.data || [];
  const medidores = medidoresRes.data || [];
  const lecturas = lecturasRes.data || [];
  const facturas = facturasRes.data || [];

  const socioMap = new Map<string, Record<string, any>>(socios.map((s) => [s.id, s]));
  const medidorMap = new Map<string, Record<string, any>>(medidores.map((m) => [m.id, m]));

  // Filtrar lecturas válidas que tengan lectura_actual registrada
  const lecturasConToma = lecturas.filter(
    (l) => l.lectura_actual !== null && l.lectura_actual !== undefined && l.id_medidor
  );

  if (lecturasConToma.length === 0) {
    return {
      periodo: targetPeriod.periodo_codigo,
      targetPeriodId: targetPeriod.id,
      facturasGeneradas: 0,
      totalM3: 0,
      totalFacturadoMes: 0,
      totalConDeudas: 0,
      facturas: [],
      sinLecturas: true
    };
  }

  let facturasGeneradas = 0;
  let totalM3 = 0;
  let totalFacturadoMes = 0;
  let totalConDeudas = 0;
  const procesadas: any[] = [];

  const periodCodeClean = String(targetPeriod.periodo_codigo || '2026-08').replace(/-/g, '');
  let correlativo = 1;

  for (const lec of lecturasConToma) {
    const med = medidorMap.get(lec.id_medidor);
    if (!med) continue;
    const soc = socioMap.get(med.id_socio) || {};

    // Cálculos de consumo y tarifas
    const lAnt = Number(lec.lectura_anterior ?? med.lectura_anterior ?? 0);
    const lAct = Number(lec.lectura_actual);
    const consumoM3 = Math.max(0, Number((lAct - lAnt).toFixed(2)));
    const excedenteM3 = Math.max(0, Number((consumoM3 - limiteBase).toFixed(2)));
    const valorExcedente = Number((excedenteM3 * costoExc).toFixed(2));

    const esTercera = ValidationRules.calcularEsTerceraEdad(soc.fecha_nacimiento as string) || Boolean(soc.es_tercera_edad);
    const valorBase = esTercera ? cargoTercera : cargoNormal;
    const tieneAlcant = Boolean(med.tiene_alcantarillado ?? soc.tiene_alcantarillado);
    const valorAlcant = tieneAlcant ? recargoAlcant : 0.0;

    const totalMes = Number((valorBase + valorExcedente + valorAlcant).toFixed(2));

    // La factura mensual representa exclusivamente el devengo de su propio período.
    // Las deudas anteriores se liquidan contra sus propias facturas en caja y no se clonan aquí.
    const facturasPreviasImpagas = facturas.filter(
      (f) => f.id_medidor === med.id && f.id_periodo !== targetPeriod.id && f.estado_pago === 'PENDIENTE'
    );
    const valorDeudaAnterior = facturasPreviasImpagas.reduce((acc, f) => acc + Number(f.saldo_pendiente ?? f.total_pagar ?? f.total_mes ?? 0), 0);

    const totalPagar = totalMes;

    // Verificar si ya existe factura para este medidor en este período
    const facExistente = facturas.find(
      (f) => f.id_medidor === med.id && f.id_periodo === targetPeriod.id
    );

    // Si la factura ya fue cobrada y está PAGADA, es inmutable: no recalcular ni sobreescribir
    if (facExistente && facExistente.estado_pago === 'PAGADO') {
      continue;
    }

    const numFactura = facExistente?.numero_factura || `FAC-${periodCodeClean}-${String(correlativo++).padStart(4, '0')}`;

    const facturaRecord = {
      id: facExistente?.id || crypto.randomUUID(),
      numero_factura: numFactura,
      id_socio: soc.id || med.id_socio,
      id_medidor: med.id,
      id_periodo: targetPeriod.id,
      id_lectura: lec.id,
      es_tercera_edad: esTercera,
      valor_base: valorBase,
      consumo_m3: consumoM3,
      excedente_m3: excedenteM3,
      valor_excedente: valorExcedente,
      valor_alcantarillado: valorAlcant,
      valor_multas: 0.0,
      valor_deuda_anterior: 0.0,
      total_mes: totalMes,
      total_pagar: totalPagar,
      monto_pagado: Number(facExistente?.monto_pagado || 0.0),
      saldo_pendiente: Number(facExistente?.saldo_pendiente !== undefined ? facExistente.saldo_pendiente : totalMes),
      estado_pago: facExistente?.estado_pago === 'PAGADO' ? 'PAGADO' : 'PENDIENTE',
      fecha_vencimiento: targetPeriod.fecha_fin || `${targetPeriod.periodo_codigo}-28`,
      version: 1,
      created_at: facExistente?.created_at || now,
      updated_at: now
    };

    await supabaseClient.syncRecord('facturas', facturaRecord);

    facturasGeneradas++;
    totalM3 += consumoM3;
    totalFacturadoMes += totalMes;
    if (valorDeudaAnterior > 0) totalConDeudas++;
    procesadas.push(facturaRecord);
  }

  return {
    periodo: targetPeriod.periodo_codigo,
    targetPeriodId: targetPeriod.id,
    facturasGeneradas,
    totalM3: Number(totalM3.toFixed(2)),
    totalFacturadoMes: Number(totalFacturadoMes.toFixed(2)),
    totalConDeudas,
    facturas: procesadas,
    sinLecturas: false
  };
}

export const pasarLecturasACaja = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { idPeriodo } = req.body || {};
    const result = await ejecutarPasarLecturasACaja(idPeriodo);

    if (result.sinLecturas) {
      res.status(400).json({
        error: `No hay lecturas registradas para el período ${result.periodo}. El lector debe registrar y subir lecturas primero.`
      });
      return;
    }

    res.json({
      success: true,
      message: `¡Éxito! Se pasaron ${result.facturasGeneradas} facturas al Módulo de Caja para el período ${result.periodo}.`,
      data: result
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error pasando lecturas a caja.';
    console.error('[WaterController] Error pasando lecturas a caja:', error);
    res.status(500).json({ error: message });
  }
};

export const liquidarPeriodo = pasarLecturasACaja;

export const cobrarFactura = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const {
      metodoPago = 'EFECTIVO',
      fechaPago,
      abonos,
      multasCobradasIds,
      abonosFacturasAnteriores,
      montoRecibido,
      montoAbonado
    } = body;
    const now = new Date().toISOString();
    const idCajero = req.user?.id || body.idCajero || '00000000-0000-0000-0000-000000000002';

    // 1. Localizar la factura principal
    let factura: Record<string, any> | null = null;
    const byId = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `id=eq.${encodeURIComponent(id)}&limit=1`);
    if (byId.data && byId.data.length > 0) {
      factura = byId.data[0];
    } else {
      const byNum = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `numero_factura=eq.${encodeURIComponent(id)}&limit=1`);
      if (byNum.data && byNum.data.length > 0) {
        factura = byNum.data[0];
      }
    }

    if (!factura) {
      res.status(404).json({ error: `Factura ${id} no encontrada en Supabase.` });
      return;
    }

    const periodosMap = await getPeriodosMap();

    // Obtener nombre del socio para asientos contables
    let nombreSocio = 'Socio';
    if (factura.id_socio) {
      const soc = await supabaseClient.fetchRecords<Record<string, any>>('socios', `id=eq.${factura.id_socio}&limit=1`);
      if (soc.data && soc.data.length > 0) {
        nombreSocio = `${soc.data[0].nombres || ''} ${soc.data[0].apellidos || ''}`.trim() || soc.data[0].codigo_socio;
      }
    }

    const asientosGenerados: any[] = [];
    const abonosProcesados: any[] = [];
    const facturasActualizadas: any[] = [];

    // Helper interno para asentar en fondos_movimientos
    const asentarFondos = async (dist: Record<string, number>, numComprobante: string, conceptoPrefix: string, idFac: string) => {
      const items = [
        { idFondo: FONDO_IDS.OPERACION_MANT, monto: dist.OPERACION_MANT || 0, concepto: `${conceptoPrefix} - Operación y Mantenimiento ($${(dist.OPERACION_MANT || 0).toFixed(2)}) - ${nombreSocio}` },
        { idFondo: FONDO_IDS.PADRE_PARROQUIA, monto: dist.PADRE_PARROQUIA || 0, concepto: `${conceptoPrefix} - Aporte Parroquial ($${(dist.PADRE_PARROQUIA || 0).toFixed(2)}) - ${nombreSocio}` },
        { idFondo: FONDO_IDS.PAGO_LECTOR, monto: dist.PAGO_LECTOR || 0, concepto: `${conceptoPrefix} - Toma Lectura ($${(dist.PAGO_LECTOR || 0).toFixed(2)}) - ${nombreSocio}` },
        { idFondo: FONDO_IDS.MORTUORIO, monto: dist.MORTUORIO || 0, concepto: `${conceptoPrefix} - Fondo Mortuorio ($${(dist.MORTUORIO || 0).toFixed(2)}) - ${nombreSocio}` },
        { idFondo: FONDO_IDS.PRO_MEJORAS, monto: dist.PRO_MEJORAS || 0, concepto: `${conceptoPrefix} - Excedente Consumo ($${(dist.PRO_MEJORAS || 0).toFixed(2)}) - ${nombreSocio}` },
        { idFondo: FONDO_IDS.ALCANTARILLADO, monto: dist.ALCANTARILLADO || 0, concepto: `${conceptoPrefix} - Servicio Alcantarillado ($${(dist.ALCANTARILLADO || 0).toFixed(2)}) - ${nombreSocio}` },
        { idFondo: FONDO_IDS.MULTAS_EXTRAS, monto: dist.MULTAS_EXTRAS || 0, concepto: `${conceptoPrefix} - Multas y Extras ($${(dist.MULTAS_EXTRAS || 0).toFixed(2)}) - ${nombreSocio}` }
      ];

      for (const it of items) {
        if (it.monto > 0) {
          const asiento = {
            id: crypto.randomUUID(),
            id_fondo: it.idFondo,
            fecha: fechaPago || now,
            concepto: it.concepto,
            tipo: 'INGRESO',
            ingreso: it.monto,
            egreso: 0,
            saldo: it.monto,
            id_factura: idFac,
            numero_comprobante: numComprobante,
            id_responsable: idCajero,
            beneficiario: nombreSocio,
            created_at: now
          };
          await supabaseClient.syncRecord('fondos_movimientos', asiento);
          asientosGenerados.push(asiento);
        }
      }
    };

    // 2. Procesar abonos a Multas/Rubros
    if (Array.isArray(abonos) && abonos.length > 0) {
      for (const ab of abonos) {
        const idRubro = ab.idRubro || ab.id_rubro || ab.id;
        const montoAbonadoRubro = Number(ab.montoAbonado ?? ab.montoAbono ?? ab.monto ?? 0);
        if (!idRubro || montoAbonadoRubro <= 0) continue;

        const rubRes = await supabaseClient.fetchRecords<Record<string, any>>('multas_rubros', `id=eq.${idRubro}&limit=1`);
        if (rubRes.data && rubRes.data.length > 0) {
          const rubro = rubRes.data[0];
          const saldoAnterior = Number(rubro.saldo_pendiente ?? rubro.monto ?? 0);
          const montoAbonarReal = Math.min(montoAbonadoRubro, saldoAnterior);
          const saldoRestante = Number(Math.max(0, saldoAnterior - montoAbonarReal).toFixed(2));
          const montoPagadoNuevo = Number(((rubro.monto_pagado || 0) + montoAbonarReal).toFixed(2));
          const nuevoEstado = saldoRestante === 0 ? 'PAGADO' : 'PARCIAL';

          const abonoRecord = {
            id: crypto.randomUUID(),
            id_rubro: idRubro,
            id_factura: factura.id,
            monto_abonado: montoAbonarReal,
            saldo_anterior: saldoAnterior,
            saldo_restante: saldoRestante,
            fecha: fechaPago || now,
            id_cajero: idCajero,
            created_at: now
          };
          await supabaseClient.syncRecord('rubros_abonos', abonoRecord);
          abonosProcesados.push(abonoRecord);

          await supabaseClient.request(`multas_rubros?id=eq.${idRubro}`, {
            method: 'PATCH',
            body: {
              monto_pagado: montoPagadoNuevo,
              saldo_pendiente: saldoRestante,
              estado: nuevoEstado,
              pagado: saldoRestante === 0,
              id_factura: factura.id
            }
          });

          await asentarFondos(
            { MULTAS_EXTRAS: montoAbonarReal },
            factura.numero_factura || factura.id,
            `Cobro Multa (${rubro.motivo || rubro.tipo_rubro})`,
            factura.id
          );
        }
      }
    } else if (Array.isArray(multasCobradasIds) && multasCobradasIds.length > 0) {
      for (const mId of multasCobradasIds) {
        const rubRes = await supabaseClient.fetchRecords<Record<string, any>>('multas_rubros', `id=eq.${mId}&limit=1`);
        if (rubRes.data && rubRes.data.length > 0) {
          const rubro = rubRes.data[0];
          const saldoAnterior = Number(rubro.saldo_pendiente ?? rubro.monto ?? 0);
          if (saldoAnterior > 0) {
            const abonoRecord = {
              id: crypto.randomUUID(),
              id_rubro: mId,
              id_factura: factura.id,
              monto_abonado: saldoAnterior,
              saldo_anterior: saldoAnterior,
              saldo_restante: 0.00,
              fecha: fechaPago || now,
              id_cajero: idCajero,
              created_at: now
            };
            await supabaseClient.syncRecord('rubros_abonos', abonoRecord);
            abonosProcesados.push(abonoRecord);

            await supabaseClient.request(`multas_rubros?id=eq.${mId}`, {
              method: 'PATCH',
              body: {
                monto_pagado: Number((rubro.monto || saldoAnterior).toFixed(2)),
                saldo_pendiente: 0.00,
                estado: 'PAGADO',
                pagado: true,
                id_factura: factura.id
              }
            });

            await asentarFondos(
              { MULTAS_EXTRAS: saldoAnterior },
              factura.numero_factura || factura.id,
              `Cobro Multa (${rubro.motivo || rubro.tipo_rubro})`,
              factura.id
            );
          }
        }
      }
    }

    // 3. Procesar abonos a Facturas Anteriores (Históricas / Corte)
    if (Array.isArray(abonosFacturasAnteriores) && abonosFacturasAnteriores.length > 0) {
      for (const prevItem of abonosFacturasAnteriores) {
        const prevId = prevItem.idFactura || prevItem.id;
        const prevMonto = Number(prevItem.montoAbonado ?? prevItem.monto ?? 0);
        if (!prevId || prevMonto <= 0) continue;

        const prevRes = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `id=eq.${prevId}&limit=1`);
        if (prevRes.data && prevRes.data.length > 0) {
          const prevFac = prevRes.data[0];
          const pObj = periodosMap.get(prevFac.id_periodo);
          const pCod = pObj?.periodo_codigo || pObj?.codigo || '';
          const saldoPrevio = Number(prevFac.saldo_pendiente ?? prevFac.total_pagar ?? prevFac.total_mes ?? 0);
          const abonoRealPrev = Math.min(prevMonto, saldoPrevio);
          const saldoRestantePrev = Number(Math.max(0, saldoPrevio - abonoRealPrev).toFixed(2));
          const montoPagadoNuevoPrev = Number(((prevFac.monto_pagado || 0) + abonoRealPrev).toFixed(2));
          const estadoNuevoPrev = saldoRestantePrev <= 0.001 ? 'PAGADO' : 'PARCIAL';

          // Actualizar la factura anterior SIN BORRAR total_mes ni consumo
          const patchPrev: Record<string, any> = {
            monto_pagado: montoPagadoNuevoPrev,
            saldo_pendiente: saldoRestantePrev,
            estado_pago: estadoNuevoPrev,
            fecha_pago: fechaPago || now,
            metodo_pago: metodoPago,
            id_cajero: idCajero,
            updated_at: now
          };
          await supabaseClient.request(`facturas?id=eq.${prevFac.id}`, {
            method: 'PATCH',
            body: patchPrev
          });
          facturasActualizadas.push({ id: prevFac.id, numeroFactura: prevFac.numero_factura, ...patchPrev });

          // Distribuir a fondos según periodo (si <= 2026-07 -> 100% Operación; si > 2026-07 -> desglose exacto)
          const distPrev = calculateAbonoFundDistribution(prevFac, abonoRealPrev, pCod);
          const numCompPrev = prevFac.numero_factura || prevFac.id;
          await asentarFondos(distPrev, numCompPrev, `Abono Deuda Período ${pCod || 'Histórico'} (#${numCompPrev})`, prevFac.id);
        }
      }
    }

    // 4. Procesar la factura principal actual
    const totalMesActual = Number(factura.total_mes ?? factura.total_pagar ?? 0);
    const saldoActual = Number(factura.saldo_pendiente !== undefined && factura.saldo_pendiente !== null ? factura.saldo_pendiente : totalMesActual);
    const pagoFacturaActual = body.montoFacturaActual !== undefined 
      ? Number(body.montoFacturaActual)
      : (montoAbonado !== undefined ? Number(montoAbonado) : (body.montoRecibido !== undefined && (!abonosFacturasAnteriores || abonosFacturasAnteriores.length === 0) ? Number(body.montoRecibido) : saldoActual));

    if (pagoFacturaActual > 0) {
      const pObj = periodosMap.get(factura.id_periodo);
      const pCod = pObj?.periodo_codigo || pObj?.codigo || '';
      const abonoRealActual = Math.min(pagoFacturaActual, saldoActual);
      const saldoRestanteActual = Number(Math.max(0, saldoActual - abonoRealActual).toFixed(2));
      const montoPagadoNuevoActual = Number(((factura.monto_pagado || 0) + abonoRealActual).toFixed(2));
      const estadoNuevoActual = saldoRestanteActual <= 0.001 ? 'PAGADO' : 'PARCIAL';

      const updatePayload: Record<string, any> = {
        monto_pagado: montoPagadoNuevoActual,
        saldo_pendiente: saldoRestanteActual,
        estado_pago: estadoNuevoActual,
        fecha_pago: fechaPago || now,
        metodo_pago: metodoPago,
        id_cajero: idCajero,
        updated_at: now
      };

      await supabaseClient.request(`facturas?id=eq.${factura.id}`, {
        method: 'PATCH',
        body: updatePayload
      });
      facturasActualizadas.push({ id: factura.id, numeroFactura: factura.numero_factura, ...updatePayload });

      const distActual = calculateAbonoFundDistribution(factura, abonoRealActual, pCod);
      const numFac = factura.numero_factura || factura.id;
      await asentarFondos(distActual, numFac, `Cobro Factura #${numFac}`, factura.id);
    }

    res.json({
      success: true,
      message: `Cobro procesado exitosamente.`,
      data: {
        facturaPrincipal: factura.numero_factura,
        facturasActualizadas,
        abonos: abonosProcesados,
        movimientosFondos: asientosGenerados
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error cobrando factura.';
    console.error('[WaterController Cobrar Error]:', error);
    res.status(400).json({ error: message });
  }
};

export const updateFactura = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'ID o número de factura es requerido.' });
      return;
    }
    const body = req.body || {};

    let factura: Record<string, any> | null = null;
    if (isValidUUID(id)) {
      const byId = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `id=eq.${encodeURIComponent(id)}&limit=1`);
      if (byId.data && byId.data.length > 0) factura = byId.data[0];
    }
    if (!factura) {
      const byNum = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `numero_factura=eq.${encodeURIComponent(id)}&limit=1`);
      if (byNum.data && byNum.data.length > 0) factura = byNum.data[0];
    }

    if (!factura) {
      res.status(404).json({ error: `Factura ${id} no encontrada.` });
      return;
    }

    const patchPayload: Record<string, any> = {};
    if (body.estado_pago !== undefined || body.estadoPago !== undefined) {
      patchPayload.estado_pago = body.estado_pago || body.estadoPago;
    }
    if (body.total_pagar !== undefined || body.totalPagar !== undefined) {
      patchPayload.total_pagar = Number(body.total_pagar ?? body.totalPagar);
    }
    if (body.total_mes !== undefined || body.totalMes !== undefined) {
      patchPayload.total_mes = Number(body.total_mes ?? body.totalMes);
    }
    if (body.valor_deuda_anterior !== undefined || body.valorDeudaAnterior !== undefined) {
      patchPayload.valor_deuda_anterior = Number(body.valor_deuda_anterior ?? body.valorDeudaAnterior);
    }
    if (body.fecha_pago !== undefined || body.fechaPago !== undefined) {
      patchPayload.fecha_pago = body.fecha_pago || body.fechaPago;
    }
    if (body.metodo_pago !== undefined || body.metodoPago !== undefined) {
      patchPayload.metodo_pago = body.metodo_pago || body.metodoPago;
    }

    patchPayload.updated_at = new Date().toISOString();

    const result = await supabaseClient.request(`facturas?id=eq.${factura.id}`, {
      method: 'PATCH',
      body: patchPayload
    });

    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ success: true, data: result.data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error actualizando factura.';
    res.status(400).json({ error: message });
  }
};

export const deleteFactura = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'ID o número de factura es requerido.' });
      return;
    }

    // 1. Buscar la factura en Supabase por ID o por numero_factura
    let factura: Record<string, any> | null = null;
    if (isValidUUID(id)) {
      const byId = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `id=eq.${encodeURIComponent(id)}`);
      if (byId.data && byId.data.length > 0) {
        factura = byId.data[0];
      }
    }
    if (!factura) {
      const byNum = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `numero_factura=eq.${encodeURIComponent(id)}`);
      if (byNum.data && byNum.data.length > 0) {
        factura = byNum.data[0];
      }
    }

    if (factura) {
      const canonicalId = factura.id;
      const numFac = factura.numero_factura;

      // 2. Revertir abonos en rubros_abonos y restaurar saldos en multas_rubros
      const abonosRes = await supabaseClient.fetchRecords<Record<string, any>>(
        'rubros_abonos',
        `id_factura=eq.${encodeURIComponent(canonicalId)}`
      );
      for (const ab of abonosRes.data || []) {
        if (ab.id_rubro) {
          const rubRes = await supabaseClient.fetchRecords<Record<string, any>>('multas_rubros', `id=eq.${ab.id_rubro}&limit=1`);
          if (rubRes.data && rubRes.data.length > 0) {
            const rubro = rubRes.data[0];
            const nuevoSaldo = Number(((rubro.saldo_pendiente || 0) + Number(ab.monto_abonado || 0)).toFixed(2));
            const nuevoPagado = Math.max(0, Number(((rubro.monto_pagado || 0) - Number(ab.monto_abonado || 0)).toFixed(2)));
            await supabaseClient.request(`multas_rubros?id=eq.${ab.id_rubro}`, {
              method: 'PATCH',
              body: {
                saldo_pendiente: nuevoSaldo,
                monto_pagado: nuevoPagado,
                estado: nuevoSaldo > 0 ? (nuevoPagado > 0 ? 'PARCIAL' : 'PENDIENTE') : 'PAGADO',
                pagado: nuevoSaldo === 0,
                id_factura: null
              }
            });
          }
        }
      }

      // Eliminar registros de abonos dependientes para no violar clave foránea
      await supabaseClient.request(`rubros_abonos?id_factura=eq.${encodeURIComponent(canonicalId)}`, {
        method: 'DELETE'
      });

      // 3. Revertir multas vinculadas directamente
      const multasDirectas = await supabaseClient.fetchRecords<Record<string, any>>(
        'multas_rubros',
        `id_factura=eq.${encodeURIComponent(canonicalId)}`
      );
      for (const m of multasDirectas.data || []) {
        await supabaseClient.request(`multas_rubros?id=eq.${m.id}`, {
          method: 'PATCH',
          body: {
            saldo_pendiente: m.monto,
            monto_pagado: 0.00,
            estado: 'PENDIENTE',
            pagado: false,
            id_factura: null
          }
        });
      }

      // 4. Revertir asientos contables en fondos_movimientos
      await supabaseClient.request(`fondos_movimientos?id_factura=eq.${encodeURIComponent(canonicalId)}`, {
        method: 'DELETE'
      });
      if (numFac) {
        await supabaseClient.request(`fondos_movimientos?numero_comprobante=eq.${encodeURIComponent(numFac)}`, {
          method: 'DELETE'
        });
      }

      // 5. Eliminar la factura de Supabase Cloud
      await supabaseClient.request(`facturas?id=eq.${encodeURIComponent(canonicalId)}`, {
        method: 'DELETE'
      });

      res.json({
        success: true,
        message: `Factura #${numFac || id} eliminada y reversiones aplicadas exitosamente.`,
        factura: {
          id: canonicalId,
          numeroFactura: numFac,
          idSocio: factura.id_socio,
          totalPagar: factura.total_pagar,
          valorMultas: factura.valor_multas,
          valorAlcantarillado: factura.valor_alcantarillado
        }
      });
      return;
    }

    // Si no se encontró el objeto completo, intentar eliminación directa según tipo
    if (isValidUUID(id)) {
      await supabaseClient.deleteRecord('facturas', id);
    } else {
      await supabaseClient.request(`facturas?numero_factura=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    }
    res.json({ success: true, message: `Factura eliminada exitosamente.`, id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error eliminando factura.';
    console.error('[WaterController Delete Error]:', message);
    res.status(400).json({ error: message });
  }
};

export const sincronizarFacturas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const body = req.body || {};
    let records: Array<any> = body.records;

    if (!Array.isArray(records) || records.length === 0) {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const candidatePaths = [
        path.resolve(process.cwd(), 'excel_payments.json'),
        path.resolve(process.cwd(), '..', '..', 'excel_payments.json'),
        path.resolve(process.cwd(), '..', 'excel_payments.json'),
        path.resolve('c:/Users/andre/OneDrive/Escritorio/Proyectos/app_agua/excel_payments.json')
      ];
      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          const fileContent = fs.readFileSync(p, 'utf8');
          records = JSON.parse(fileContent);
          break;
        }
      }
    }

    if (!Array.isArray(records) || records.length === 0) {
      res.status(400).json({ error: 'No se encontraron registros para sincronizar.' });
      return;
    }

    const [socRes, medRes, facRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, any>>('socios'),
      supabaseClient.fetchRecords<Record<string, any>>('medidores'),
      supabaseClient.fetchRecords<Record<string, any>>('facturas', 'limit=1000')
    ]);

    const socios = socRes.data || [];
    const medidores = medRes.data || [];
    const facturas = facRes.data || [];

    const medByNum = new Map<string, any>();
    medidores.forEach((m) => {
      if (m.numero_medidor) medByNum.set(String(m.numero_medidor).trim().toUpperCase(), m);
    });

    const socById = new Map<string, any>();
    const socByCed = new Map<string, any>();
    socios.forEach((s) => {
      socById.set(s.id, s);
      if (s.cedula_ruc) socByCed.set(String(s.cedula_ruc).trim(), s);
    });

    const activePeriod = await getActivePeriod();
    const targetPeriodId = (activePeriod?.id as string) || '';
    const ahora = new Date().toISOString();
    const sincronizados: any[] = [];

    for (const r of records) {
      const pagoAgosto = Number(r.pago_agosto ?? r.pagoAgosto ?? 0);
      if (pagoAgosto <= 0) continue;

      const medStr = String(r.medidor || r.numeroMedidor || r.numero_medidor || '').trim().toUpperCase();
      const cedStr = String(r.cedula || r.cedula_ruc || r.cedulaRuc || '').trim();
      const nomStr = String(r.nombres || '').trim();
      const apeStr = String(r.apellidos || '').trim();

      // Resolver medidor y socio
      let med = medStr ? medByNum.get(medStr) : null;
      let soc = med ? socById.get(med.id_socio) : null;

      if (!soc && cedStr) {
        soc = socByCed.get(cedStr);
      }

      if (!soc && (nomStr || apeStr)) {
        soc = socios.find((s) => {
          const sNom = `${s.nombres || ''} ${s.apellidos || ''}`.trim().toLowerCase();
          const targetNom = `${nomStr} ${apeStr}`.trim().toLowerCase();
          return sNom === targetNom || (s.apellidos && s.nombres && targetNom.includes(s.apellidos.toLowerCase()) && targetNom.includes(s.nombres.toLowerCase()));
        });
      }

      if (!soc) {
        console.warn(`[SincronizarFacturas] Socio no encontrado para medidor ${medStr} / cédula ${cedStr}`);
        continue;
      }

      if (!med) {
        const socMeds = medidores.filter((m) => m.id_socio === soc.id);
        med = socMeds[0] || null;
      }

      // Comprobar si ya existe factura de período para este socio/medidor en Supabase
      const existingFac = facturas.find((f) => {
        const isTarget = targetPeriodId ? f.id_periodo === targetPeriodId : String(f.numero_factura || '').includes('202608');
        const isSoc = f.id_socio === soc.id;
        const isMed = med ? f.id_medidor === med.id : true;
        return isTarget && isSoc && isMed;
      });

      // Factura de deuda anterior (Julio): se conserva inmutable sin sobreescribir ni poner a cero su histórico

      if (existingFac) {
        if (existingFac.estado_pago === 'PAGADO') {
          if (!existingFac.id_medidor && med) {
            await supabaseClient.request(`facturas?id=eq.${existingFac.id}`, {
              method: 'PATCH',
              body: { id_medidor: med.id, updated_at: ahora }
            });
          }
          continue;
        }

        // Si existe pero estaba PENDIENTE, actualizar a PAGADO
        const updateBody = {
          estado_pago: 'PAGADO',
          id_medidor: med ? med.id : existingFac.id_medidor,
          fecha_pago: existingFac.fecha_pago || '2026-08-31T18:00:00.000Z',
          metodo_pago: 'EFECTIVO',
          updated_at: ahora
        };
        await supabaseClient.request(`facturas?id=eq.${existingFac.id}`, {
          method: 'PATCH',
          body: updateBody
        });
        sincronizados.push({ id: existingFac.id, numeroFactura: existingFac.numero_factura, accion: 'ACTUALIZADO_A_PAGADO', socio: soc.codigo_socio, monto: pagoAgosto });
      } else {
        // No existe: crear factura oficial PAGADA para Agosto
        const facId = crypto.randomUUID();
        const rowNum = r.row || Math.floor(1000 + Math.random() * 9000);
        let numeroFactura = `REC-2608-${String(rowNum).padStart(2, '0')}`;
        if (facturas.some((f) => f.numero_factura === numeroFactura) || sincronizados.some((s) => s.numeroFactura === numeroFactura)) {
          const sCode = (soc.codigo_socio || '').replace('SOC-', '') || String(rowNum);
          numeroFactura = `REC-2608-S${sCode.padStart(3, '0')}`;
        }
        const newRecord = {
          id: facId,
          numero_factura: numeroFactura,
          id_socio: soc.id,
          id_medidor: med ? med.id : null,
          id_periodo: PERIODO_AGOSTO_ID,
          es_tercera_edad: Boolean(soc.fecha_nacimiento && ValidationRules.calcularEsTerceraEdad(soc.fecha_nacimiento)),
          valor_base: pagoAgosto,
          consumo_m3: 0.0,
          excedente_m3: 0.0,
          valor_excedente: 0.0,
          valor_alcantarillado: 0.0,
          valor_multas: 0.0,
          valor_deuda_anterior: 0.0,
          total_mes: pagoAgosto,
          total_pagar: pagoAgosto,
          estado_pago: 'PAGADO',
          fecha_vencimiento: '2026-09-30',
          fecha_pago: '2026-08-31T18:00:00.000Z',
          metodo_pago: 'EFECTIVO',
          id_cajero: '00000000-0000-0000-0000-000000000002',
          version: 1,
          created_at: '2026-08-31T18:00:00.000Z',
          updated_at: ahora
        };

        await supabaseClient.syncRecord('facturas', newRecord);
        sincronizados.push({ id: facId, numeroFactura, accion: 'CREADO_PAGADO', socio: soc.codigo_socio, socioNombre: `${soc.nombres} ${soc.apellidos}`, monto: pagoAgosto });
      }
    }

    res.json({
      success: true,
      message: `Sincronización completada. ${sincronizados.length} facturas de Agosto actualizadas/creadas en Supabase Cloud.`,
      data: {
        totalSincronizados: sincronizados.length,
        sincronizados
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error sincronizando facturas.';
    console.error('[WaterController SincronizarFacturas Error]:', error);
    res.status(500).json({ error: message });
  }
};

// ==========================================
// 7. MULTAS Y RUBROS
// ==========================================

export const getMultas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { socioId } = req.query as { socioId?: string };
    const query = socioId ? `id_socio=eq.${socioId}&order=created_at.desc` : 'order=created_at.desc';
    const resData = await supabaseClient.fetchRecords<Record<string, unknown>>('multas_rubros', query);
    res.json({ data: resData.data || [], total: (resData.data || []).length });
  } catch (error) {
    console.error('[WaterController] Error obteniendo multas:', error);
    res.status(500).json({ error: 'Error obteniendo multas.' });
  }
};

/**
 * Recalcula y sincroniza el valor_multas y total_pagar de las prefacturas/facturas
 * pendientes de un socio con el total real de multas/rubros impagos en multas_rubros.
 */
export async function syncSocioPendingFacturas(idSocio: string): Promise<void> {
  if (!idSocio) return;
  try {
    // 1. Obtener todas las multas y rubros pendientes no pagados del socio
    const multasRes = await supabaseClient.fetchRecords<Record<string, any>>(
      'multas_rubros',
      `id_socio=eq.${encodeURIComponent(idSocio)}&pagado=eq.false`
    );
    const multas = multasRes.data || [];
    const nuevoValorMultas = Number(
      multas.reduce((sum, m) => sum + Number(m.saldo_pendiente ?? m.monto ?? 0), 0).toFixed(2)
    );

    // 2. Obtener prefacturas pendientes del socio
    const facsRes = await supabaseClient.fetchRecords<Record<string, any>>(
      'facturas',
      `id_socio=eq.${encodeURIComponent(idSocio)}&estado_pago=eq.PENDIENTE`
    );
    const pendingFacs = facsRes.data || [];
    const now = new Date().toISOString();

    for (const fac of pendingFacs) {
      const totMes = Number(fac.total_mes ?? 0);
      const vDeudaAnt = Number(fac.valor_deuda_anterior ?? 0);
      const nuevoTotalPagar = Number((totMes + vDeudaAnt + nuevoValorMultas).toFixed(2));

      await supabaseClient.request(`facturas?id=eq.${fac.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: {
          valor_multas: nuevoValorMultas,
          total_pagar: nuevoTotalPagar,
          updated_at: now
        }
      });
    }
  } catch (err) {
    console.warn(`[syncSocioPendingFacturas] Advertencia recalculando prefacturas para socio ${idSocio}:`, err);
  }
}

export const crearMulta = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { idSocio, tipoRubro, monto, motivo, idPeriodo } = req.body || {};
    if (!idSocio || !tipoRubro || monto === undefined || !motivo) {
      res.status(400).json({ error: 'idSocio, tipoRubro, monto y motivo son requeridos.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const numMonto = Number(Number(monto).toFixed(2));
    const record = {
      id,
      id_socio: idSocio,
      tipo_rubro: tipoRubro,
      monto: numMonto,
      monto_pagado: 0.00,
      saldo_pendiente: numMonto,
      estado: 'PENDIENTE',
      pagado: false,
      motivo: String(motivo).trim(),
      id_periodo: idPeriodo || null,
      created_at: now
    };

    const syncRes = await supabaseClient.syncRecord('multas_rubros', record);
    if (syncRes && syncRes.success === false) {
      res.status(400).json({ error: syncRes.error || 'Error al guardar multa en base de datos.' });
      return;
    }

    // Sincronizar prefacturas pendientes para incluir este nuevo valor
    await syncSocioPendingFacturas(idSocio);

    res.status(201).json({ message: 'Multa / Rubro registrado exitosamente.', data: record });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error registrando multa.';
    res.status(400).json({ error: message });
  }
};

export const updateMulta = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const p = req.body || {};
    const now = new Date().toISOString();

    // 1. Consultar la multa existente para obtener socio y montos actuales
    const existingRes = await supabaseClient.fetchRecords<Record<string, any>>(
      'multas_rubros',
      `id=eq.${encodeURIComponent(id)}&limit=1`
    );
    if (!existingRes.data || existingRes.data.length === 0) {
      res.status(404).json({ error: 'Multa / Rubro no encontrado.' });
      return;
    }
    const existing = existingRes.data[0];
    const idSocio = existing.id_socio;

    const updatePayload: Record<string, unknown> = { updated_at: now };
    if (p.monto !== undefined) {
      const numMonto = Number(Number(p.monto).toFixed(2));
      const montoPagado = Number(existing.monto_pagado || 0);
      updatePayload.monto = numMonto;
      const nuevoSaldo = Number(Math.max(0, numMonto - montoPagado).toFixed(2));
      updatePayload.saldo_pendiente = nuevoSaldo;
      if (nuevoSaldo === 0 && numMonto > 0) {
        updatePayload.pagado = true;
        updatePayload.estado = 'PAGADO';
      } else if (nuevoSaldo < numMonto && nuevoSaldo > 0) {
        updatePayload.pagado = false;
        updatePayload.estado = 'PARCIAL';
      } else {
        updatePayload.pagado = false;
        updatePayload.estado = 'PENDIENTE';
      }
    }
    if (p.motivo !== undefined) updatePayload.motivo = String(p.motivo).trim();
    if (p.tipoRubro !== undefined || p.tipo_rubro !== undefined) {
      updatePayload.tipo_rubro = p.tipoRubro || p.tipo_rubro;
    }
    if (p.estado !== undefined) {
      updatePayload.estado = String(p.estado);
      if (p.estado === 'PAGADO') updatePayload.pagado = true;
    }

    const patchResult = await supabaseClient.request(`multas_rubros?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: updatePayload
    });

    if (patchResult.error) {
      res.status(400).json({ error: `Error en base de datos: ${patchResult.error}` });
      return;
    }

    // Recalcular prefacturas pendientes del socio automáticamente
    if (idSocio) {
      await syncSocioPendingFacturas(idSocio);
    }

    res.json({ message: 'Multa actualizada exitosamente.', data: { id, ...existing, ...updatePayload } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error actualizando multa.';
    res.status(400).json({ error: message });
  }
};

export const deleteMulta = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // 1. Obtener socio antes de borrar
    const existingRes = await supabaseClient.fetchRecords<Record<string, any>>(
      'multas_rubros',
      `id=eq.${encodeURIComponent(id)}&limit=1`
    );
    const idSocio = existingRes.data?.[0]?.id_socio;

    const delResult = await supabaseClient.deleteRecord('multas_rubros', id);
    if (delResult && delResult.success === false) {
      res.status(400).json({ error: delResult.error || 'Error eliminando multa en base de datos.' });
      return;
    }

    // 2. Sincronizar prefacturas pendientes para restar el rubro eliminado
    if (idSocio) {
      await syncSocioPendingFacturas(idSocio);
    }

    res.json({ success: true, message: 'Multa eliminada exitosamente.', id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error eliminando multa.';
    res.status(400).json({ error: message });
  }
};

/**
 * REQUISITO 1: Inscripción oficial de nuevo socio con cobro obligatorio:
 * - $260.00 Acometida
 * - Costo Medidor (editable)
 * - $40.00 Instalación
 * Todo acreditado 100% al Fondo de Operación y Mantenimiento.
 */
export const inscribirSocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const p = req.body || {};
    const now = new Date().toISOString();
    const idCajero = (req as any).user?.id || '00000000-0000-0000-0000-000000000002';

    // 1. Valores a cobrar
    const costoAcometida = Number(p.costoAcometida !== undefined ? p.costoAcometida : 260.00);
    const costoMedidor = Number(p.costoMedidor !== undefined ? p.costoMedidor : 35.00);
    const costoInstalacion = Number(p.costoInstalacion !== undefined ? p.costoInstalacion : 40.00);
    const totalInscripcion = Number((costoAcometida + costoMedidor + costoInstalacion).toFixed(2));
    const metodoPago = String(p.metodoPago || 'EFECTIVO').toUpperCase();

    // 2. Crear Socio
    const socioId = (p.id && isValidUUID(p.id)) ? p.id : crypto.randomUUID();
    const primaryNumMed = String(p.medidorNumero || p.numeroMedidor || 'S/N').trim();
    const hasAlcant = Boolean(p.tieneAlcantarillado ?? p.tiene_alcantarillado);

    const socioRecord = {
      id: socioId,
      codigo_socio: p.codigoSocio || p.codigo_socio || `SOC-${String(Date.now()).slice(-4)}`,
      nombres: String(p.nombres || '').trim(),
      apellidos: String(p.apellidos || '').trim(),
      cedula_ruc: String(p.cedulaRuc || p.cedula_ruc || '').trim(),
      fecha_nacimiento: p.fechaNacimiento || p.fecha_nacimiento || '1985-01-01',
      fecha_union: p.fechaUnion || p.fechaAfiliacion || p.fecha_union || now.split('T')[0],
      id_sector: p.idSector || p.id_sector || p.sectorId || '11111111-0000-0000-0000-000000000001',
      medidor_numero: primaryNumMed,
      tiene_alcantarillado: hasAlcant,
      telefono: p.telefono || null,
      direccion: p.direccion || 'Comunidad',
      estado: 'ACTIVO',
      version: 1,
      created_at: now,
      updated_at: now
    };

    const socioRes = await supabaseClient.syncRecord('socios', socioRecord);
    if (socioRes && socioRes.success === false) {
      res.status(400).json({ error: `Error creando socio: ${socioRes.error}` });
      return;
    }

    // 3. Crear Medidor Inicial
    const medId = crypto.randomUUID();
    const lecIni = Number(p.lecturaInicial ?? p.lectura_inicial ?? 0);
    const medRecord = {
      id: medId,
      id_socio: socioId,
      id_sector: socioRecord.id_sector,
      numero_medidor: primaryNumMed,
      alias: 'Casa principal',
      direccion: socioRecord.direccion,
      tiene_alcantarillado: hasAlcant,
      estado: 'ACTIVO',
      version: 1,
      created_at: now,
      updated_at: now
    };
    await supabaseClient.syncRecord('medidores', medRecord);

    const activePeriod = await getActivePeriod();
    const initPeriod = (await getInitialPeriod()) || activePeriod;

    if (lecIni > 0) {
      await supabaseClient.syncRecord('lecturas', {
        id: crypto.randomUUID(),
        id_medidor: medId,
        id_socio: socioId,
        id_periodo: initPeriod?.id || activePeriod?.id || '00000000-0000-0000-0000-000000000000',
        lectura_anterior: lecIni,
        lectura_actual: lecIni,
        consumo_total: 0,
        excedente_m3: 0,
        fecha_lectura: now,
        id_lector: '00000000-0000-0000-0000-000000000003',
        observaciones: 'Lectura inicial de apertura/instalación de acometida',
        version: 1,
        created_at: now,
        updated_at: now
      }).catch(() => {});
    }

    // 4. Obtener período activo para asociar el comprobante
    const periodoId = activePeriod?.id || '00000000-0000-0000-0000-000000000000';

    // 5. Emitir Comprobante / Factura Oficial de Inscripción (PAGADO)
    const numRecibo = `REC-INS-${String(Date.now()).slice(-6)}`;
    const facturaInscripcion = {
      id: crypto.randomUUID(),
      numero_factura: numRecibo,
      id_socio: socioId,
      id_medidor: medId,
      id_periodo: periodoId,
      es_tercera_edad: false,
      valor_base: costoAcometida,
      consumo_m3: 0,
      excedente_m3: 0,
      valor_excedente: 0.0,
      valor_alcantarillado: 0.0,
      valor_multas: Number((costoMedidor + costoInstalacion).toFixed(2)),
      valor_deuda_anterior: 0.0,
      total_mes: totalInscripcion,
      total_pagar: totalInscripcion,
      monto_pagado: totalInscripcion,
      saldo_pendiente: 0.0,
      estado_pago: 'PAGADO',
      fecha_vencimiento: now.split('T')[0],
      fecha_pago: now,
      metodo_pago: metodoPago,
      id_cajero: idCajero,
      observaciones: `Inscripción y Nueva Acometida: Acometida $${costoAcometida.toFixed(2)} + Medidor $${costoMedidor.toFixed(2)} + Instalación $${costoInstalacion.toFixed(2)}`,
      version: 1,
      created_at: now,
      updated_at: now
    };
    await supabaseClient.syncRecord('facturas', facturaInscripcion);

    // 6. Asentar en el Libro Mayor (fondos_movimientos) 100% a Fondo Operación y Mantenimiento
    const nombreCompleto = `${socioRecord.nombres} ${socioRecord.apellidos}`.trim();
    const asientoFondo = {
      id: crypto.randomUUID(),
      id_fondo: FONDO_IDS.OPERACION_MANT,
      fecha: now,
      concepto: `Inscripción y Acometida #${numRecibo} - ${nombreCompleto} (Acometida $${costoAcometida.toFixed(2)} + Medidor $${costoMedidor.toFixed(2)} + Instalación $${costoInstalacion.toFixed(2)})`,
      tipo: 'INGRESO',
      ingreso: totalInscripcion,
      egreso: 0,
      saldo: totalInscripcion,
      id_factura: facturaInscripcion.id,
      numero_comprobante: numRecibo,
      id_responsable: idCajero,
      beneficiario: nombreCompleto,
      created_at: now
    };
    await supabaseClient.syncRecord('fondos_movimientos', asientoFondo);

    res.status(201).json({
      success: true,
      message: `Socio ${socioRecord.codigo_socio} inscrito exitosamente. Cobro de $${totalInscripcion.toFixed(2)} registrado en Fondo Operación y Mantenimiento.`,
      data: {
        socio: {
          ...socioRecord,
          codigoSocio: socioRecord.codigo_socio,
          cedulaRuc: socioRecord.cedula_ruc,
          tieneAlcantarillado: socioRecord.tiene_alcantarillado,
          medidorNumero: primaryNumMed,
          medidores: [{ ...medRecord, numeroMedidor: primaryNumMed }]
        },
        recibo: facturaInscripcion,
        movimientoFondo: asientoFondo,
        desgloseCobro: {
          costoAcometida,
          costoMedidor,
          costoInstalacion,
          totalInscripcion,
          metodoPago
        }
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error inscribiendo socio.';
    res.status(400).json({ error: message });
  }
};

/**
 * REQUISITO 2: Reconexión de cuenta cortada ($20.00 USD):
 * - Cambia estado a ACTIVO en socio y todos sus medidores
 * - Cobra $20.00 USD con destino 100% al Fondo de Operación y Mantenimiento
 * - Emite comprobante de reconexión REC-REC-...
 */
export const reconectarSocio = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const p = req.body || {};
    const now = new Date().toISOString();
    const idCajero = (req as any).user?.id || '00000000-0000-0000-0000-000000000002';

    // 1. Obtener socio existente
    const socRes = await supabaseClient.fetchRecords<Record<string, any>>('socios', `id=eq.${encodeURIComponent(id)}&limit=1`);
    if (!socRes.data || socRes.data.length === 0) {
      res.status(404).json({ error: 'Socio no encontrado.' });
      return;
    }
    const socio = socRes.data[0];
    const nombreCompleto = `${socio.nombres || ''} ${socio.apellidos || ''}`.trim() || socio.codigo_socio;

    // 2. Valores de reconexión
    const montoReconexion = Number(p.montoReconexion !== undefined ? p.montoReconexion : 20.00);
    const metodoPago = String(p.metodoPago || 'EFECTIVO').toUpperCase();

    // 3. Actualizar estado del socio a ACTIVO
    await supabaseClient.request(`socios?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { estado: 'ACTIVO', updated_at: now }
    });

    // 4. Actualizar estado de todos sus medidores a ACTIVO
    await supabaseClient.request(`medidores?id_socio=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { estado: 'ACTIVO', updated_at: now }
    });

    // 5. Obtener período activo y medidor para el recibo
    const [activeP, medRes] = await Promise.all([
      getActivePeriod(),
      supabaseClient.fetchRecords<Record<string, any>>('medidores', `id_socio=eq.${encodeURIComponent(id)}&limit=1`)
    ]);
    const periodoId = (activeP?.id as string) || '00000000-0000-0000-0000-000000000000';
    const medId = medRes.data?.[0]?.id || null;

    // 6. Emitir Comprobante Oficial de Reconexión
    const numRecibo = `REC-REC-${String(Date.now()).slice(-6)}`;
    const facturaReconexion = {
      id: crypto.randomUUID(),
      numero_factura: numRecibo,
      id_socio: id,
      id_medidor: medId,
      id_periodo: periodoId,
      es_tercera_edad: false,
      valor_base: 0.0,
      consumo_m3: 0,
      excedente_m3: 0,
      valor_excedente: 0.0,
      valor_alcantarillado: 0.0,
      valor_multas: montoReconexion,
      valor_deuda_anterior: 0.0,
      total_mes: montoReconexion,
      total_pagar: montoReconexion,
      monto_pagado: montoReconexion,
      saldo_pendiente: 0.0,
      estado_pago: 'PAGADO',
      fecha_vencimiento: now.split('T')[0],
      fecha_pago: now,
      metodo_pago: metodoPago,
      id_cajero: idCajero,
      observaciones: `Reconexión de servicio de agua potable (Cuenta reactivada de CORTADO a ACTIVO) - Tasa: $${montoReconexion.toFixed(2)}`,
      version: 1,
      created_at: now,
      updated_at: now
    };
    await supabaseClient.syncRecord('facturas', facturaReconexion);

    // 7. Asentar en el Libro Mayor (fondos_movimientos) 100% a Fondo Operación y Mantenimiento
    const asientoFondo = {
      id: crypto.randomUUID(),
      id_fondo: FONDO_IDS.OPERACION_MANT,
      fecha: now,
      concepto: `Tasa de Reconexión #${numRecibo} - ${nombreCompleto} ($${montoReconexion.toFixed(2)} USD)`,
      tipo: 'INGRESO',
      ingreso: montoReconexion,
      egreso: 0,
      saldo: montoReconexion,
      id_factura: facturaReconexion.id,
      numero_comprobante: numRecibo,
      id_responsable: idCajero,
      beneficiario: nombreCompleto,
      created_at: now
    };
    await supabaseClient.syncRecord('fondos_movimientos', asientoFondo);

    res.json({
      success: true,
      message: `Cuenta de ${nombreCompleto} reconectada y activada exitosamente. Tasa de $${montoReconexion.toFixed(2)} registrada en Fondo Operación y Mantenimiento.`,
      data: {
        socio: { ...socio, estado: 'ACTIVO', updated_at: now },
        recibo: facturaReconexion,
        movimientoFondo: asientoFondo,
        montoCobrado: montoReconexion,
        metodoPago
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al reconectar socio.';
    res.status(400).json({ error: message });
  }
};

export const getRubroAbonos = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const resData = await supabaseClient.fetchRecords<Record<string, unknown>>(
      'rubros_abonos',
      `id_rubro=eq.${encodeURIComponent(id)}&order=fecha.desc`
    );
    res.json({ data: resData.data || [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error consultando abonos del rubro.';
    res.status(500).json({ error: message });
  }
};

export const getFacturaAbonos = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const resData = await supabaseClient.fetchRecords<Record<string, unknown>>(
      'rubros_abonos',
      `id_factura=eq.${encodeURIComponent(id)}&order=fecha.desc`
    );
    res.json({ data: resData.data || [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error consultando abonos de la factura.';
    res.status(500).json({ error: message });
  }
};

// Aliases para compatibilidad
export const getClientes = getSocios;
export const getCobros = getFacturas;


