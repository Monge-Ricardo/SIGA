import type { AuthenticatedRequest } from '../middlewares/auth.ts';
import type { Response } from '../core/http.ts';
import { supabaseClient } from '../db/supabase.ts';
import { ValidationRules } from '../shared.ts';

const NOMBRES_MESES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

const MESES_ABREV = [
  'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
  'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'
];

/**
 * Controller: Comprobante Oficial de Pago de Agua Potable
 * Principio de Responsabilidad Única (SRP):
 * Agrega, estructura y valida todos los datos necesarios para emitir
 * el comprobante físico/digital oficial de pago de la Junta Administradora.
 */
export const getFacturaComprobante = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'Identificador de factura o comprobante requerido.' });
      return;
    }

    // 1. Obtener la Factura (por UUID o por numero_factura) o movimientos de comprobante (REC-...)
    let factura: Record<string, any> | null = null;
    let movsComprobante: Record<string, any>[] = [];
    let linkedFacturas: Record<string, any>[] = [];

    const facById = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `id=eq.${encodeURIComponent(id)}&limit=1`);
    if (facById.data && facById.data.length > 0) {
      factura = facById.data[0];
    } else {
      const facByNum = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `numero_factura=eq.${encodeURIComponent(id)}&limit=1`);
      if (facByNum.data && facByNum.data.length > 0) {
        factura = facByNum.data[0];
      }
    }

    const isUuid = (val?: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val || '');

    // Buscar siempre los movimientos contables en fondos_movimientos vinculados a esta transacción o factura
    const movsRes = await supabaseClient.fetchRecords<Record<string, any>>(
      'fondos_movimientos',
      `numero_comprobante=eq.${encodeURIComponent(id)}&limit=100`
    );
    if (movsRes.data && movsRes.data.length > 0) {
      movsComprobante = movsRes.data;
    } else if (isUuid(id)) {
      // Fallback para UUIDs: buscar si corresponde a id_factura o id de fondos_movimientos
      const movsByFac = await supabaseClient.fetchRecords<Record<string, any>>(
        'fondos_movimientos',
        `id_factura=eq.${encodeURIComponent(id)}&limit=100`
      );
      if (movsByFac.data && movsByFac.data.length > 0) {
        movsComprobante = movsByFac.data;
      } else {
        const movById = await supabaseClient.fetchRecords<Record<string, any>>(
          'fondos_movimientos',
          `id=eq.${encodeURIComponent(id)}&limit=1`
        );
        if (movById.data && movById.data.length > 0 && movById.data[0].numero_comprobante) {
          const movsByNum = await supabaseClient.fetchRecords<Record<string, any>>(
            'fondos_movimientos',
            `numero_comprobante=eq.${encodeURIComponent(movById.data[0].numero_comprobante)}&limit=100`
          );
          if (movsByNum.data && movsByNum.data.length > 0) {
            movsComprobante = movsByNum.data;
          }
        }
      }
    }

    // Si aún no tenemos movimientos y factura existe (buscar por id_factura o numero_factura)
    if (movsComprobante.length === 0 && factura) {
      if (factura.id && isUuid(factura.id)) {
        const movsByFacId = await supabaseClient.fetchRecords<Record<string, any>>(
          'fondos_movimientos',
          `id_factura=eq.${encodeURIComponent(factura.id)}&limit=100`
        );
        if (movsByFacId.data && movsByFacId.data.length > 0) {
          movsComprobante = movsByFacId.data;
        }
      }
      if (movsComprobante.length === 0 && factura.numero_factura) {
        const movsByNum = await supabaseClient.fetchRecords<Record<string, any>>(
          'fondos_movimientos',
          `numero_comprobante=eq.${encodeURIComponent(factura.numero_factura)}&limit=100`
        );
        if (movsByNum.data && movsByNum.data.length > 0) {
          movsComprobante = movsByNum.data;
        } else {
          const movsByConcepto = await supabaseClient.fetchRecords<Record<string, any>>(
            'fondos_movimientos',
            `concepto=ilike.*${encodeURIComponent(factura.numero_factura)}*&limit=100`
          );
          if (movsByConcepto.data && movsByConcepto.data.length > 0) {
            movsComprobante = movsByConcepto.data;
          }
        }
      }
    }

    if (!factura && movsComprobante.length === 0) {
      res.status(404).json({ error: `Factura o comprobante "${id}" no encontrado.` });
      return;
    }

    // Si encontramos movimientos asociados a la factura pero pertenecen a un recibo consolidado (numero_comprobante),
    // expandir a TODOS los movimientos de ese recibo para incluir deudas anteriores y multas pagadas juntas
    const compNumEncontrado = movsComprobante.find(m => m.numero_comprobante && String(m.numero_comprobante).startsWith('REC-'))?.numero_comprobante;
    if (compNumEncontrado && (!id.startsWith('REC-') || movsComprobante.length < 2)) {
      const allTxMovs = await supabaseClient.fetchRecords<Record<string, any>>(
        'fondos_movimientos',
        `numero_comprobante=eq.${encodeURIComponent(compNumEncontrado)}&limit=100`
      );
      if (allTxMovs.data && allTxMovs.data.length > movsComprobante.length) {
        movsComprobante = allTxMovs.data;
      }
    }

    // Reconstruir contexto para comprobantes consolidados
    if (movsComprobante.length > 0) {
      const fids = [...new Set(movsComprobante.map(m => m.id_factura).filter(isUuid))];
      
      for (const m of movsComprobante) {
        const mFac = (m.concepto || '').match(/(FAC-[A-Za-z0-9-]+)/);
        if (mFac) {
          const fb = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `numero_factura=eq.${encodeURIComponent(mFac[1])}&limit=1`);
          if (fb.data?.[0] && !fids.includes(fb.data[0].id)) {
            fids.push(fb.data[0].id);
          }
        }
      }

      if (fids.length > 0) {
        const facsRes = await supabaseClient.fetchRecords<Record<string, any>>(
          'facturas',
          `id=in.(${fids.join(',')})`
        );
        linkedFacturas = facsRes.data || [];
      }

      if (!factura) {
        if (linkedFacturas.length > 0) {
          const mainWaterFac = linkedFacturas.find(f => Number(f.total_mes || 0) > 0 || Number(f.consumo_m3 || 0) > 0 || Boolean(f.id_lectura)) || linkedFacturas[0];
          factura = { ...mainWaterFac, numero_factura: id };
        } else {
          const socioNombre = movsComprobante[0].beneficiario || '';
          const sociosRes = await supabaseClient.fetchRecords<Record<string, any>>('socios', 'limit=500');
          const socioFound = (sociosRes.data || []).find(s => {
            const nom = `${s.nombres || ''} ${s.apellidos || ''}`.trim().toLowerCase();
            const ape = `${s.apellidos || ''} ${s.nombres || ''}`.trim().toLowerCase();
            const b = socioNombre.toLowerCase();
            return nom.includes(b) || b.includes(nom) || ape.includes(b) || b.includes(ape);
          });

          const totalRec = movsComprobante.reduce((s, m) => s + Number(m.ingreso || 0), 0);
          factura = {
            id: id,
            numero_factura: id,
            id_socio: socioFound?.id || (sociosRes.data?.[0]?.id || 'soc-desc'),
            id_periodo: null,
            fecha_pago: movsComprobante[0].fecha || new Date().toISOString(),
            metodo_pago: 'EFECTIVO',
            id_cajero: movsComprobante[0].id_responsable,
            total_pagar: totalRec,
            total_mes: 0,
            valor_base: 0,
            valor_excedente: 0,
            valor_alcantarillado: 0,
            estado_pago: 'PAGADO'
          };
        }
      } else if (linkedFacturas.length > 1 && !id.startsWith('REC-')) {
        // Si el usuario consultó por una factura de deuda anterior (sin consumo) pero la transacción
        // incluyó una factura de agua con consumo activo, priorizar la de agua para la cabecera y medidores
        const mainWaterFac = linkedFacturas.find(f => Number(f.total_mes || 0) > 0 || Number(f.consumo_m3 || 0) > 0 || Boolean(f.id_lectura));
        if (mainWaterFac && (!factura.total_mes || Number(factura.total_mes) === 0)) {
          factura = { ...mainWaterFac };
        }
      }
    }

    // 2. Obtener datos del Socio, Sector, Período, Cajero y Catálogo de Fondos en paralelo
    const [socioRes, periodoRes, cajeroRes, fondosCatalogoRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, any>>('socios', `id=eq.${factura.id_socio}&limit=1`),
      supabaseClient.fetchRecords<Record<string, any>>('periodos', `id=eq.${factura.id_periodo}&limit=1`),
      factura.id_cajero
        ? supabaseClient.fetchRecords<Record<string, any>>('usuarios', `id=eq.${factura.id_cajero}&limit=1`)
        : Promise.resolve({ data: [] }),
      supabaseClient.fetchRecords<Record<string, any>>('fondos_catalogo', 'activo=eq.true')
    ]);

    const socio = socioRes.data?.[0] || {};
    const periodo = periodoRes.data?.[0] || {};
    const cajero = cajeroRes.data?.[0] || null;
    const fondosCatalogo = fondosCatalogoRes.data || [];
    const fondosMap = new Map<string, Record<string, any>>();
    fondosCatalogo.forEach((f) => {
      if (f.id) fondosMap.set(f.id, f);
    });

    const esFondoAguaConsumo = (idFondo?: string) => {
      if (!idFondo) return false;
      const f = fondosMap.get(idFondo);
      const cod = String(f?.codigo || '').toUpperCase();
      return ['PADRE_PARROQUIA', 'OPERACION_MANT', 'PAGO_LECTOR', 'MORTUORIO', 'PRO_MEJORAS'].includes(cod);
    };

    const esFondoMultas = (idFondo?: string, concepto?: string) => {
      const f = idFondo ? fondosMap.get(idFondo) : null;
      const cod = String(f?.codigo || '').toUpperCase();
      const con = String(concepto || '').toLowerCase();
      return cod === 'MULTAS_EXTRAS' || con.includes('multa') || con.includes('minga');
    };

    const esFondoAlcantarillado = (idFondo?: string, concepto?: string) => {
      const f = idFondo ? fondosMap.get(idFondo) : null;
      const cod = String(f?.codigo || '').toUpperCase();
      const con = String(concepto || '').toLowerCase();
      return cod === 'ALCANTARILLADO' || con.includes('alcantarillado');
    };

    // 3. Obtener Medidores del socio y Lecturas del período
    const [medidoresRes, lecturasPeriodoRes, sectorRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, any>>('medidores', `id_socio=eq.${factura.id_socio}&estado=neq.INACTIVO`),
      supabaseClient.fetchRecords<Record<string, any>>('lecturas', `id_socio=eq.${factura.id_socio}&id_periodo=eq.${factura.id_periodo}`),
      socio.id_sector
        ? supabaseClient.fetchRecords<Record<string, any>>('sectores', `id=eq.${socio.id_sector}&limit=1`)
        : Promise.resolve({ data: [] })
    ]);

    const medidores = medidoresRes.data || [];
    let lecturasPeriodo = lecturasPeriodoRes.data || [];
    const sector = sectorRes.data?.[0] || null;

    // Si la factura tiene id_lectura específico pero no vino en lecturasPeriodo:
    if (factura.id_lectura && !lecturasPeriodo.some((l) => l.id === factura.id_lectura)) {
      const singleLec = await supabaseClient.fetchRecords<Record<string, any>>('lecturas', `id=eq.${factura.id_lectura}&limit=1`);
      if (singleLec.data?.[0]) {
        lecturasPeriodo.push(singleLec.data[0]);
      }
    }

    // 4. Formatear Período de Consumo conciso (ej: AGOSTO 2026)
    const pCodigoFallback = factura.created_at ? String(factura.created_at).slice(0, 7) : new Date().toISOString().slice(0, 7);
    const pCodigo = String(periodo.periodo_codigo || pCodigoFallback).trim();
    const [pAnioStr, pMesStr] = pCodigo.split('-');
    const pMesNum = parseInt(pMesStr || '8', 10);
    const pAnioNum = parseInt(pAnioStr || '2026', 10);
    const pMesNombre = NOMBRES_MESES[Math.max(0, Math.min(11, pMesNum - 1))];
    const periodoConsumoTexto = `${pMesNombre} ${pAnioNum}`;

    // 5. Formatear Fecha y Hora de Autorización / Pago (ej: 25 SEP 2026 / 14:30)
    const fechaPagoRaw = factura.fecha_pago || factura.updated_at || factura.created_at || new Date().toISOString();
    const fechaPagoObj = new Date(fechaPagoRaw);
    const diaPago = String(fechaPagoObj.getDate()).padStart(2, '0');
    const mesPagoAbrev = MESES_ABREV[fechaPagoObj.getMonth()];
    const anioPago = fechaPagoObj.getFullYear();
    const horaPago = String(fechaPagoObj.getHours()).padStart(2, '0');
    const minPago = String(fechaPagoObj.getMinutes()).padStart(2, '0');
    const fechaHoraFormateada = `${diaPago} ${mesPagoAbrev} ${anioPago} / ${horaPago}:${minPago}`;

    // 6. Construir lista de Medidores para la tabla
    const medidoresFiltrados = factura.id_medidor
      ? medidores.filter((m) => m.id === factura.id_medidor)
      : medidores;
    const medidoresToUse = medidoresFiltrados.length > 0 ? medidoresFiltrados : medidores;

    const medidoresTable = medidoresToUse.map((m) => {
      const lec = (factura.id_lectura ? lecturasPeriodo.find((l) => l.id === factura.id_lectura) : null) || lecturasPeriodo.find((l) => l.id_medidor === m.id) || null;
      let lAnt = Number(lec?.lectura_anterior ?? m.lectura_anterior ?? 0);
      let lAct = Number(lec?.lectura_actual ?? (factura.consumo_m3 ? lAnt + Number(factura.consumo_m3) : lAnt));

      const vExcFactura = Number(factura.valor_excedente || 0);
      let excedenteDirecto = Number(factura.excedente_m3 || (lec?.excedente_m3 !== undefined ? lec.excedente_m3 : 0));
      if (excedenteDirecto === 0 && vExcFactura > 0) {
        excedenteDirecto = Math.round(vExcFactura / 0.10);
      }

      const consumoPorLectura = (lAct > lAnt) ? Math.max(0, Number((lAct - lAnt).toFixed(2))) : 0;
      const consumoFactura = Number(factura.consumo_m3 || 0);

      // Si consumo_m3 es <= 30 y hay excedente, el consumo total real es básico + excedente
      const consumoCalculado = (consumoFactura <= 30 && excedenteDirecto > 0)
        ? consumoFactura + excedenteDirecto
        : consumoFactura;

      const consumoTotal = Math.max(consumoPorLectura, consumoCalculado);
      const excedenteFinal = excedenteDirecto > 0 ? excedenteDirecto : Math.max(0, Number((consumoTotal - 30).toFixed(2)));

      if (lAct <= lAnt && consumoTotal > 0) {
        lAct = lAnt + consumoTotal;
      } else if (lAct > lAnt && consumoTotal > (lAct - lAnt)) {
        lAct = lAnt + consumoTotal;
      }

      const tieneAlcant = Boolean(m.tiene_alcantarillado ?? socio.tiene_alcantarillado);

      return {
        id: m.id,
        numeroMedidor: m.numero_medidor || 'S/N',
        alias: m.alias || 'Acometida principal',
        basicoM3: 30,
        lecturaAnterior: Number(lAnt.toFixed(2)),
        lecturaActual: Number(lAct.toFixed(2)),
        consumoM3: consumoTotal,
        excedenteM3: excedenteFinal,
        tieneAlcantarillado: tieneAlcant,
        alcantarilladoTexto: tieneAlcant ? 'Si' : 'No'
      };
    });

    // Si no tiene registros en tabla medidores, crear fila fallback desde la factura
    if (medidoresTable.length === 0) {
      const lAnt = Number(factura.consumo_m3 ? 150 : 0);
      const consumo = Number(factura.consumo_m3 || 0);
      const lAct = lAnt + consumo;
      const excedente = Number(factura.excedente_m3 || Math.max(0, consumo - 30));
      const tieneAlcant = Number(factura.valor_alcantarillado || 0) > 0 || Boolean(socio.tiene_alcantarillado);

      medidoresTable.push({
        id: factura.id_medidor || 'med-default',
        numeroMedidor: socio.medidor_numero || socio.codigo_socio || 'S/N',
        alias: 'Acometida principal',
        basicoM3: 30,
        lecturaAnterior: lAnt,
        lecturaActual: lAct,
        consumoM3: consumo,
        excedenteM3: excedente,
        tieneAlcantarillado: tieneAlcant,
        alcantarilladoTexto: tieneAlcant ? 'Si' : 'No'
      });
    }

    // 7. Histórico de Consumo Mensual (últimos 5 períodos con lecturas)
    const [allLecturasRes, allPeriodosRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, any>>('lecturas', `id_socio=eq.${factura.id_socio}&order=created_at.desc&limit=12`),
      supabaseClient.fetchRecords<Record<string, any>>('periodos', 'order=fecha_inicio.asc')
    ]);

    const allLecturas = allLecturasRes.data || [];
    const allPeriodos = allPeriodosRes.data || [];
    const periodMap = new Map<string, string>();
    allPeriodos.forEach((p) => {
      if (p.id && p.periodo_codigo) periodMap.set(p.id, p.periodo_codigo);
    });

    // Consolidar consumo por período
    const consumoPorPeriodoMap = new Map<string, number>();
    for (const l of allLecturas) {
      const pCod = periodMap.get(l.id_periodo) || String(l.id_periodo);
      const cons = Number(l.consumo_total || l.consumo_m3 || 0);
      consumoPorPeriodoMap.set(pCod, (consumoPorPeriodoMap.get(pCod) || 0) + cons);
    }

    // Asegurar que el período actual esté en el mapa
    if (!consumoPorPeriodoMap.has(pCodigo)) {
      consumoPorPeriodoMap.set(pCodigo, Number(factura.consumo_m3 || 0));
    }

    // Ordenar períodos cronológicamente y tomar los últimos 5
    const periodosKeys = Array.from(consumoPorPeriodoMap.keys()).sort();
    const ultimosPeriodos = periodosKeys.slice(-5);

    const historicoMeses = ultimosPeriodos.map((pk) => {
      const parts = pk.split('-');
      const y = parts[0]?.slice(-2) || '26';
      const m = parseInt(parts[1] || '1', 10);
      const abrev = MESES_ABREV[Math.max(0, Math.min(11, m - 1))];
      return {
        periodo: `${abrev}/${y}`,
        periodoCodigo: pk,
        consumo: Number((consumoPorPeriodoMap.get(pk) || 0).toFixed(0))
      };
    });

    // Consumo promedio y consumo total acumulado
    const sumaConsumos = historicoMeses.reduce((sum, h) => sum + h.consumo, 0);
    const consumoPromedio = historicoMeses.length > 0 ? Math.round(sumaConsumos / historicoMeses.length) : Number(factura.consumo_m3 || 0);
    const consumoTotalAcumulado = medidoresTable.reduce((sum, m) => sum + m.lecturaActual, 0) || (consumoPromedio * 12);

    const allRelevantFacturaIds = [...new Set([factura?.id, ...linkedFacturas.map(f => f.id)].filter(isUuid))];
    const fechaTransaccionIso = factura.fecha_pago || movsComprobante[0]?.fecha || new Date().toISOString();
    const fechaDay = fechaTransaccionIso.slice(0, 10);
    const rubrosAbonosQuery = allRelevantFacturaIds.length > 0
      ? `id_factura=in.(${allRelevantFacturaIds.join(',')})&order=created_at.asc`
      : `id_factura=eq.${factura.id}&order=created_at.asc`;

    // 8. Consultar Rubros Pendientes (Deuda Alcantarillado, Deuda Anterior, Multas) y Abonos de esta Factura
    const [facturasImpagasRes, multasImpagasRes, rubrosAbonosRes, allSocioRubrosRes, rubrosAbonosDayRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, any>>('facturas', `id_socio=eq.${factura.id_socio}&id=neq.${factura.id}&estado_pago=eq.PENDIENTE`),
      supabaseClient.fetchRecords<Record<string, any>>('multas_rubros', `id_socio=eq.${factura.id_socio}&estado=neq.PAGADO`),
      supabaseClient.fetchRecords<Record<string, any>>('rubros_abonos', rubrosAbonosQuery),
      supabaseClient.fetchRecords<Record<string, any>>('multas_rubros', `id_socio=eq.${factura.id_socio}`),
      factura.id_socio
        ? supabaseClient.fetchRecords<Record<string, any>>('rubros_abonos', `fecha=gte.${fechaDay}T00:00:00.000Z&fecha=lte.${fechaDay}T23:59:59.999Z&order=created_at.asc`)
        : Promise.resolve({ data: [] })
    ]);

    const facturasImpagas = facturasImpagasRes.data || [];
    const multasImpagas = multasImpagasRes.data || [];
    const rubrosMap = new Map<string, Record<string, any>>();
    (allSocioRubrosRes.data || []).forEach((r) => { if (r.id) rubrosMap.set(r.id, r); });

    let rubrosAbonosFactura = rubrosAbonosRes.data || [];
    // Si no vinieron abonos por id_factura, revisar si hubo abonos de multas de este socio en la misma fecha
    if (rubrosAbonosFactura.length === 0 && rubrosAbonosDayRes.data && rubrosAbonosDayRes.data.length > 0) {
      rubrosAbonosFactura = rubrosAbonosDayRes.data.filter((ab) => {
        const r = rubrosMap.get(ab.id_rubro);
        return r && r.id_socio === factura.id_socio;
      });
    }

    // Determinar valores de la factura y si en este cobro se incluyó consumo del mes
    const valorBaseMes = Number(Number(factura.valor_base || 0).toFixed(2));
    const valorExcedenteMes = Number(Number(factura.valor_excedente || 0).toFixed(2));
    const valorAlcantMes = Number(Number(factura.valor_alcantarillado || 0).toFixed(2));
    const valorMultasFactura = Number(Number(factura.valor_multas || 0).toFixed(2));
    const valorDeudaAntFactura = Number(Number(factura.valor_deuda_anterior || 0).toFixed(2));
    const totalMesFactura = Number(Number(factura.total_mes || 0).toFixed(2));
    const consumoM3 = Number(factura.consumo_m3 || 0);

    // Si hubo abonos registrados en rubros_abonos
    const totalAbonadoRubros = rubrosAbonosFactura.reduce((sum, a) => sum + Number(a.monto_abonado || 0), 0);

    // Solo se cobra consumo de agua si la factura tiene lecturas o valores de consumo de agua (no en recibos exclusivos de deuda)
    const tieneConsumoRegistrado = consumoM3 > 0 || totalMesFactura > 0 || valorBaseMes > 0 || Boolean(factura.id_lectura);
    const hasLinkedWaterConsumption = linkedFacturas.some(f => Number(f.total_mes || 0) > 0 || Number(f.consumo_m3 || 0) > 0 || Number(f.valor_base || 0) > 0 || Boolean(f.id_lectura));
    const esSoloDeudaOHistorico = (valorDeudaAntFactura > 0 && totalMesFactura === 0 && valorBaseMes === 0 && !factura.id_lectura && !hasLinkedWaterConsumption);

    const tieneCobroConsumoAgua = !esSoloDeudaOHistorico && (tieneConsumoRegistrado || hasLinkedWaterConsumption) && (
      (factura.estado_pago === 'PAGADO') ||
      (factura.fecha_pago && totalMesFactura === 0 && Boolean(factura.id_lectura)) ||
      (factura.fecha_pago && totalMesFactura > 0 && totalAbonadoRubros === 0) ||
      hasLinkedWaterConsumption
    );

    const esTerceraEdadCalc = ValidationRules.calcularEsTerceraEdad(socio.fecha_nacimiento as string) || Boolean(socio.es_tercera_edad);
    const excM3Calc = medidoresTable.reduce((acc, m) => acc + Number(m.excedenteM3 || 0), 0);
    const tieneAlcantGeneral = medidoresTable.some(m => m.tieneAlcantarillado) || Boolean(socio.tiene_alcantarillado) || Number(factura.valor_alcantarillado || 0) > 0;

    const cobradoBase = tieneCobroConsumoAgua ? (valorBaseMes > 0 ? valorBaseMes : (esTerceraEdadCalc ? 5.00 : 7.00)) : 0;
    const cobradoExc = tieneCobroConsumoAgua ? (valorExcedenteMes > 0 ? valorExcedenteMes : Number((excM3Calc * 0.10).toFixed(2))) : 0;
    const cobradoAlcant = tieneCobroConsumoAgua
      ? (factura.valor_alcantarillado !== undefined && factura.valor_alcantarillado !== null
          ? valorAlcantMes
          : (tieneAlcantGeneral ? 1.00 : 0.00))
      : 0;

    const waterFacturas = linkedFacturas.filter(f => Number(f.total_mes || 0) > 0 || Number(f.consumo_m3 || 0) > 0 || Number(f.valor_base || 0) > 0 || Boolean(f.id_lectura));
    const consumoMesItems = [];
    if (waterFacturas.length > 1) {
      for (const lf of waterFacturas) {
        const med = medidores.find(m => m.id === lf.id_medidor);
        const medTxt = med?.numero_medidor ? ` (Medidor: ${med.numero_medidor})` : '';
        const vBase = Number(lf.valor_base || (esTerceraEdadCalc ? 5.00 : 7.00));
        consumoMesItems.push({
          cp: 'AP01',
          ca: '01',
          descripcion: `Consumo Agua Potable${medTxt} - Planilla #${lf.numero_factura || lf.id.slice(0, 8)}`,
          valorTotal: vBase,
          saldoRestante: 0,
          aPagarCobrado: vBase
        });
        if (Number(lf.valor_excedente || 0) > 0) {
          consumoMesItems.push({
            cp: 'EX01',
            ca: '01',
            descripcion: `Excedente de Consumo (${lf.excedente_m3 || Math.round(lf.valor_excedente / 0.10)} m³)${medTxt}`,
            valorTotal: Number(lf.valor_excedente),
            saldoRestante: 0,
            aPagarCobrado: Number(lf.valor_excedente)
          });
        }
        if (Number(lf.valor_alcantarillado || 0) > 0) {
          consumoMesItems.push({
            cp: 'AL01',
            ca: '01',
            descripcion: `Alcantarillado del Período${medTxt}`,
            valorTotal: Number(lf.valor_alcantarillado),
            saldoRestante: 0,
            aPagarCobrado: Number(lf.valor_alcantarillado)
          });
        }
      }
    } else if (tieneCobroConsumoAgua && (cobradoBase > 0 || cobradoExc > 0 || cobradoAlcant > 0)) {
      if (cobradoBase > 0) {
        consumoMesItems.push({
          cp: 'AP01',
          ca: '01',
          descripcion: 'Consumo Agua Potable (30 m³ básico)',
          valorTotal: cobradoBase,
          saldoRestante: 0,
          aPagarCobrado: cobradoBase
        });
      }

      if (cobradoExc > 0) {
        const totalExcedenteM3 = medidoresTable.reduce((acc, m) => acc + m.excedenteM3, 0) || Math.round(cobradoExc / 0.10);
        consumoMesItems.push({
          cp: 'EX01',
          ca: '01',
          descripcion: `Excedente de Consumo (${totalExcedenteM3} m³)`,
          valorTotal: cobradoExc,
          saldoRestante: 0,
          aPagarCobrado: cobradoExc
        });
      }

      if (cobradoAlcant > 0) {
        consumoMesItems.push({
          cp: 'AL01',
          ca: '01',
          descripcion: 'Alcantarillado del Período',
          valorTotal: cobradoAlcant,
          saldoRestante: 0,
          aPagarCobrado: cobradoAlcant
        });
      }
    }

    // Desglose de "Rubros Pendientes y Cuotas"
    const deudaAlcantTotal = Number(socio.deuda_alcantarillado || 0);
    const deudaAnteriorTotal = facturasImpagas.reduce((sum, f) => sum + Number(f.total_pagar ?? f.total_mes ?? 0), 0);
    const multasTotal = multasImpagas.reduce((sum, m) => sum + Number(m.saldo_pendiente ?? m.monto ?? 0), 0);

    const rubrosPendientesItems = [];

    // 1. Multas y Rubros con Abonos registrados en esta transacción
    if (rubrosAbonosFactura.length > 0) {
      for (const ab of rubrosAbonosFactura) {
        const rubroObj = rubrosMap.get(ab.id_rubro);
        const motivo = rubroObj?.motivo || rubroObj?.tipo_rubro || 'Rubro Comunitario';
        const tipo = String(rubroObj?.tipo_rubro || 'MULTA').toUpperCase();
        const cpCode = tipo === 'ALCANTARILLADO' ? 'AL01' : tipo === 'MINGA' ? 'MG01' : 'MU01';
        const saldoR = Number(Number(ab.saldo_restante ?? 0).toFixed(2));
        const saldoAnt = Number(Number(ab.saldo_anterior ?? (Number(ab.monto_abonado || 0) + saldoR)).toFixed(2));
        const mCobrado = Number(Number(ab.monto_abonado || 0).toFixed(2));
        const prefijo = saldoR <= 0.001 ? 'Pago Rubro: ' : 'Abono Rubro: ';

        rubrosPendientesItems.push({
          cp: cpCode,
          ca: '01',
          descripcion: `${prefijo}${motivo}`,
          valorTotal: saldoAnt,
          saldoRestante: saldoR,
          aPagarCobrado: mCobrado
        });
      }
    }

    // 2. Deuda Anterior / Facturas Históricas pagadas o abonadas en esta transacción
    const getDescDeudaAnterior = (facObj?: Record<string, any> | null, prefijo = 'Pago ') => {
      const numTxt = facObj?.numero_factura ? ` (#${facObj.numero_factura})` : '';
      const pCod = facObj?.id_periodo ? periodMap.get(facObj.id_periodo) : null;
      if (pCod) {
        return `${prefijo}Deuda Anterior Período ${pCod}${numTxt}`;
      }
      return `${prefijo}Deuda Anterior / Saldo Histórico${numTxt}`;
    };

    const movsDeudaAnt = movsComprobante.filter(m =>
      (m.concepto || '').toLowerCase().includes('deuda anterior')
    );

    if (movsDeudaAnt.length > 0) {
      for (const m of movsDeudaAnt) {
        const facLinked = linkedFacturas.find(f => f.id === m.id_factura) || (factura?.id === m.id_factura ? factura : null);
        const aCob = Number(Number(m.ingreso || 0).toFixed(2));
        const valFacturado = facLinked
          ? Number((Number(facLinked.valor_deuda_anterior || 0) || Number(facLinked.total_pagar || 0) || aCob).toFixed(2))
          : (valorDeudaAntFactura > 0 ? valorDeudaAntFactura : aCob);
        const sRest = Math.max(0, Number((valFacturado - aCob).toFixed(2)));
        const prefijo = sRest <= 0.001 ? 'Pago ' : 'Abono ';
        const desc = getDescDeudaAnterior(facLinked || factura, prefijo);

        rubrosPendientesItems.push({
          cp: 'MA01',
          ca: '01',
          descripcion: desc,
          valorTotal: valFacturado,
          saldoRestante: sRest,
          aPagarCobrado: aCob
        });
      }
    } else if (valorDeudaAntFactura > 0 && !rubrosPendientesItems.some(r => r.cp === 'MA01')) {
      const valFacturado = valorDeudaAntFactura;
      const sumConsumo = consumoMesItems.reduce((acc, c) => acc + c.aPagarCobrado, 0);
      let totalCobradoRecibo = 0;
      if (movsComprobante.length > 0) {
        const totalRecibo = movsComprobante.reduce((s, m) => s + Number(m.ingreso || 0), 0);
        totalCobradoRecibo = Math.max(0, Number((totalRecibo - sumConsumo).toFixed(2)));
      } else if (factura.estado_pago === 'PAGADO') {
        totalCobradoRecibo = valFacturado;
      } else {
        const saldoPend = Number(factura.saldo_pendiente ?? factura.total_pagar ?? valFacturado);
        totalCobradoRecibo = Number(factura.monto_pagado || 0) > 0
          ? Number(factura.monto_pagado)
          : Math.max(0, Number((valFacturado - saldoPend).toFixed(2)));
      }
      const aCob = Math.min(valFacturado, totalCobradoRecibo > 0 ? totalCobradoRecibo : (factura.estado_pago === 'PAGADO' ? valFacturado : 0));
      const sRest = Math.max(0, Number((valFacturado - aCob).toFixed(2)));
      const prefijo = sRest <= 0.001 ? 'Pago ' : 'Abono ';

      rubrosPendientesItems.push({
        cp: 'MA01',
        ca: '01',
        descripcion: getDescDeudaAnterior(factura, prefijo),
        valorTotal: valFacturado,
        saldoRestante: sRest,
        aPagarCobrado: aCob
      });
    }

    // Agregar cualquier factura anterior vinculada en esta transacción que no haya sido procesada
    // (Solo si la factura vinculada efectivamente fue pagada en esta transacción)
    for (const lf of linkedFacturas) {
      const esFacPagadaEstaTx = lf.id !== factura.id && lf.estado_pago === 'PAGADO' && (lf.fecha_pago === factura.fecha_pago || lf.numero_factura === factura.numero_factura || movsComprobante.some(m => m.id_factura === lf.id));
      const esDeudaHist = Number(lf.valor_deuda_anterior || 0) > 0 || (Number(lf.total_mes || 0) === 0 && Number(lf.total_pagar || 0) > 0);
      if (esFacPagadaEstaTx && esDeudaHist) {
        const lfNum = lf.numero_factura || lf.id.slice(0, 8);
        if (!rubrosPendientesItems.some(r => r.descripcion.includes(lfNum))) {
          const valLf = Number((lf.valor_deuda_anterior || lf.total_pagar || lf.total_mes || 0).toFixed(2));
          rubrosPendientesItems.push({
            cp: 'MA01',
            ca: '01',
            descripcion: getDescDeudaAnterior(lf, 'Pago '),
            valorTotal: valLf,
            saldoRestante: 0,
            aPagarCobrado: valLf
          });
        }
      }
    }

    // 3. Multas históricas si no vinieron en rubros_abonos
    if (valorMultasFactura > 0 && !rubrosPendientesItems.some(r => r.cp === 'MU01')) {
      rubrosPendientesItems.push({
        cp: 'MU01',
        ca: '01',
        descripcion: 'Multas y Sanciones',
        valorTotal: Number((valorMultasFactura + multasTotal).toFixed(2)),
        saldoRestante: Number(multasTotal.toFixed(2)),
        aPagarCobrado: Number(valorMultasFactura.toFixed(2))
      });
    }

    // 4. Si es un recibo consolidado y quedan fondos por asignar a rubros
    if (movsComprobante.length > 0) {
      const sumConsumo = consumoMesItems.reduce((acc, c) => acc + c.aPagarCobrado, 0);
      const sumRubrosAct = rubrosPendientesItems.reduce((acc, r) => acc + r.aPagarCobrado, 0);
      const totalRecibo = Math.round(movsComprobante.reduce((s, m) => s + Number(m.ingreso || 0), 0) * 100) / 100;
      const diferencia = Math.round((totalRecibo - sumConsumo - sumRubrosAct) * 100) / 100;

      if (diferencia > 0.01) {
        const idsFondosConsumidos = new Set<string>();
        if (movsDeudaAnt.length > 0) {
          movsDeudaAnt.forEach(m => idsFondosConsumidos.add(m.id));
        }
        if (sumConsumo > 0) {
          movsComprobante
            .filter(m => esFondoAguaConsumo(m.id_fondo))
            .forEach(m => idsFondosConsumidos.add(m.id));
        }
        if (consumoMesItems.some(c => c.cp === 'AL01') || rubrosPendientesItems.some(r => r.cp === 'AL01')) {
          movsComprobante
            .filter(m => esFondoAlcantarillado(m.id_fondo, m.concepto))
            .forEach(m => idsFondosConsumidos.add(m.id));
        }
        // Si ya existen multas o abonos a multas en rubrosPendientesItems, marcar como consumidos
        // los movimientos de fondos de multas para evitar duplicación fantasma con código RU01
        if (rubrosPendientesItems.some(r => r.cp === 'MU01' || r.cp === 'MG01' || r.descripcion.toLowerCase().includes('multa') || r.descripcion.toLowerCase().includes('minga'))) {
          movsComprobante
            .filter(m => esFondoMultas(m.id_fondo, m.concepto))
            .forEach(m => idsFondosConsumidos.add(m.id));
        }

        const fondosExtras = movsComprobante.filter(m => !idsFondosConsumidos.has(m.id));

        if (fondosExtras.length > 0) {
          const agrupados = new Map<string, { desc: string; monto: number }>();
          for (const fe of fondosExtras) {
            const key = fe.id_fondo || 'extra';
            const mVal = Number(fe.ingreso || 0);
            const fInfo = fe.id_fondo ? fondosMap.get(fe.id_fondo) : null;
            const descFondo = fInfo?.nombre || (fe.concepto || 'Rubro Comunitario').split(' - ')[1] || fe.concepto || 'Rubro Comunitario';
            const cleanDesc = descFondo.replace(/\(\$[0-9.]+\)/, '').trim();
            if (agrupados.has(key)) {
              agrupados.get(key)!.monto += mVal;
            } else {
              agrupados.set(key, { desc: cleanDesc, monto: mVal });
            }
          }
          for (const [_, val] of agrupados.entries()) {
            rubrosPendientesItems.push({
              cp: 'RU01',
              ca: '01',
              descripcion: `Pago Rubro: ${val.desc}`,
              valorTotal: Math.round(val.monto * 100) / 100,
              saldoRestante: 0,
              aPagarCobrado: Math.round(val.monto * 100) / 100
            });
          }
        }
      }
    }

    const subtotalConsumo = consumoMesItems.reduce((acc, c) => acc + c.aPagarCobrado, 0);
    const subtotalRubros = rubrosPendientesItems.reduce((acc, r) => acc + r.aPagarCobrado, 0);
    const totalCobrado = Number((subtotalConsumo + subtotalRubros).toFixed(2));
    const totalFactura = totalCobrado;
    const saldoRestanteFactura = (factura.estado_pago === 'PAGADO' || valorDeudaAntFactura > 0)
      ? 0
      : Number(factura.saldo_pendiente ?? factura.total_pagar ?? 0);
    const rubrosSaldoRestante = rubrosPendientesItems.reduce((acc, r) => acc + Number(r.saldoRestante || 0), 0);
    const hayAbonoRubroPendiente = rubrosPendientesItems.some(r => Number(r.saldoRestante || 0) > 0);
    const saldoPendienteTotal = Number((saldoRestanteFactura + rubrosSaldoRestante).toFixed(2));
    const haySaldoPendiente = saldoPendienteTotal > 0 || hayAbonoRubroPendiente;
    const esAbonoFactura = haySaldoPendiente || (factura.estado_pago !== 'PAGADO' && totalCobrado > 0);

    const periodoConsumoFinal = !tieneCobroConsumoAgua && valorDeudaAntFactura > 0
      ? 'DEUDA ANTERIOR / SALDO HISTÓRICO'
      : periodoConsumoTexto;

    const esTerceraEdad = esTerceraEdadCalc;
    const compNumFinal = movsComprobante[0]?.numero_comprobante || factura.numero_factura || `REC-${factura.id.slice(0, 8)}`;
    const codigoBarras = compNumFinal.replace(/[^a-zA-Z0-9]/g, '');

    res.json({
      success: true,
      data: {
        institucion: {
          nombre: 'AGUA POTABLE Y ALCANTARILLADO DE LA PARROQUIA PISHILATA',
          matriz: 'Vía a Quillán',
          provincia: 'Tungurahua',
          telefono: '0987370618'
        },
        comprobante: {
          id: factura.id,
          numeroFactura: factura.numero_factura || `FAC-${factura.id.slice(0, 8)}`,
          numeroComprobante: compNumFinal,
          fechaHoraAut: fechaHoraFormateada,
          codigoBarras: codigoBarras,
          metodoPago: factura.metodo_pago || 'EFECTIVO',
          cajeroNombre: cajero?.nombre_completo || req.user?.username || 'Cajero Responsable',
          esAbono: esAbonoFactura,
          estadoPago: factura.estado_pago || 'PENDIENTE',
          tipoTransaccion: esAbonoFactura ? 'ABONO REGISTRADO' : 'TOTAL CANCELADO'
        },
        socio: {
          id: socio.id || factura.id_socio,
          cuentaNo: socio.codigo_socio || `SOC-${String(socio.id || '').slice(-5)}`,
          razonSocial: `${socio.apellidos || ''} ${socio.nombres || ''}`.trim() || 'Abonado Comunitario',
          cedulaRuc: socio.cedula_ruc || '1800000000',
          telefono: socio.telefono || '0987370618',
          sector: sector?.nombre_sector || socio.sector || 'Parroquia Pishilata',
          tarifa: esTerceraEdad ? 'Tercera Edad ($5.00)' : 'Normal ($7.00)',
          esTerceraEdad,
          periodoConsumo: periodoConsumoFinal,
          periodoCodigo: pCodigo
        },
        medidores: medidoresTable,
        historicoConsumo: {
          meses: historicoMeses,
          consumoTotalAcumulado,
          consumoPromedio
        },
        detalleValores: {
          consumoMes: consumoMesItems,
          subtotalConsumoMes: Number(subtotalConsumo.toFixed(2)),
          rubrosPendientes: rubrosPendientesItems,
          subtotalRubrosPendientes: Number(subtotalRubros.toFixed(2)),
          totalFactura: Number(totalCobrado.toFixed(2)),
          totalCobrado: Number(totalCobrado.toFixed(2)),
          saldoPendienteTotal: Number(saldoPendienteTotal.toFixed(2))
        }
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error generando comprobante oficial.';
    console.error('[ComprobanteController] Error:', error);
    res.status(500).json({ error: message });
  }
};
