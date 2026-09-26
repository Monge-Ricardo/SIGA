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

    // 1. Obtener la Factura (por UUID o por numero_factura)
    let factura: Record<string, any> | null = null;
    const facById = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `id=eq.${encodeURIComponent(id)}&limit=1`);
    if (facById.data && facById.data.length > 0) {
      factura = facById.data[0];
    } else {
      const facByNum = await supabaseClient.fetchRecords<Record<string, any>>('facturas', `numero_factura=eq.${encodeURIComponent(id)}&limit=1`);
      if (facByNum.data && facByNum.data.length > 0) {
        factura = facByNum.data[0];
      }
    }

    if (!factura) {
      res.status(404).json({ error: `Factura o comprobante "${id}" no encontrado.` });
      return;
    }

    // 2. Obtener datos del Socio, Sector, Período y Usuario Cajero en paralelo
    const [socioRes, periodoRes, cajeroRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, any>>('socios', `id=eq.${factura.id_socio}&limit=1`),
      supabaseClient.fetchRecords<Record<string, any>>('periodos', `id=eq.${factura.id_periodo}&limit=1`),
      factura.id_cajero
        ? supabaseClient.fetchRecords<Record<string, any>>('usuarios', `id=eq.${factura.id_cajero}&limit=1`)
        : Promise.resolve({ data: [] })
    ]);

    const socio = socioRes.data?.[0] || {};
    const periodo = periodoRes.data?.[0] || {};
    const cajero = cajeroRes.data?.[0] || null;

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
    const pCodigo = String(periodo.periodo_codigo || '2026-08').trim();
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
        numeroMedidor: socio.medidor_numero || '1211036816',
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

    // 8. Consultar Rubros Pendientes (Deuda Alcantarillado, Deuda Anterior, Multas)
    const [facturasImpagasRes, multasImpagasRes] = await Promise.all([
      supabaseClient.fetchRecords<Record<string, any>>('facturas', `id_socio=eq.${factura.id_socio}&id=neq.${factura.id}&estado_pago=eq.PENDIENTE`),
      supabaseClient.fetchRecords<Record<string, any>>('multas_rubros', `id_socio=eq.${factura.id_socio}&estado=neq.PAGADO`)
    ]);

    const facturasImpagas = facturasImpagasRes.data || [];
    const multasImpagas = multasImpagasRes.data || [];

    // Determinar si en este cobro se incluyó consumo del mes
    const valorBaseMes = Number(Number(factura.valor_base || 0).toFixed(2));
    const valorExcedenteMes = Number(Number(factura.valor_excedente || 0).toFixed(2));
    const valorAlcantMes = Number(Number(factura.valor_alcantarillado || 0).toFixed(2));
    const valorMultasFactura = Number(Number(factura.valor_multas || 0).toFixed(2));
    const valorDeudaAntFactura = Number(Number(factura.valor_deuda_anterior || 0).toFixed(2));
    const totalMesFactura = Number(Number(factura.total_mes || 0).toFixed(2));
    const subtotalMes = totalMesFactura > 0 ? totalMesFactura : Number((valorBaseMes + valorExcedenteMes + valorAlcantMes).toFixed(2));

    // Se cobra consumo del mes si totalMes > 0 o valorBase > 0 o valorExcedente > 0
    const cobroConsumoMes = (totalMesFactura > 0 || valorBaseMes > 0 || valorExcedenteMes > 0);

    // Determinar si este cobro es una liquidación total o abono
    const montoPagado = Number(factura.monto_pagado || factura.total_pagar || (subtotalMes + valorDeudaAntFactura + valorMultasFactura));
    const saldoPendienteFactura = Number(factura.saldo_pendiente !== undefined ? factura.saldo_pendiente : 0);
    const esAbonoFactura = saldoPendienteFactura > 0 || factura.estado_pago === 'PENDIENTE';

    // Desglose de "Consumo del Mes" (SOLO si formó parte de la transacción)
    const cobradoBase = cobroConsumoMes ? (esAbonoFactura ? Math.min(montoPagado, valorBaseMes) : valorBaseMes) : 0;
    let remAbono = Math.max(0, montoPagado - cobradoBase);
    const cobradoExc = cobroConsumoMes ? (esAbonoFactura ? Math.min(remAbono, valorExcedenteMes) : valorExcedenteMes) : 0;
    remAbono = Math.max(0, remAbono - cobradoExc);
    const cobradoAlcant = cobroConsumoMes ? (esAbonoFactura ? Math.min(remAbono, valorAlcantMes) : valorAlcantMes) : 0;

    const consumoMesItems = [];
    if (cobroConsumoMes) {
      if (valorBaseMes > 0 || cobradoBase > 0) {
        consumoMesItems.push({
          cp: 'AP01',
          ca: '01',
          descripcion: 'Consumo Agua Potable (30 m³ básico)',
          valorTotal: valorBaseMes,
          saldoRestante: Number(Math.max(0, valorBaseMes - cobradoBase).toFixed(2)),
          aPagarCobrado: Number(cobradoBase.toFixed(2))
        });
      }
      if (valorExcedenteMes > 0 || cobradoExc > 0) {
        const totalExcedenteM3 = medidoresTable.reduce((acc, m) => acc + m.excedenteM3, 0) || Math.round(valorExcedenteMes / 0.10);
        consumoMesItems.push({
          cp: 'EX01',
          ca: '01',
          descripcion: `Excedente de Consumo (${totalExcedenteM3} m³)`,
          valorTotal: valorExcedenteMes,
          saldoRestante: Number(Math.max(0, valorExcedenteMes - cobradoExc).toFixed(2)),
          aPagarCobrado: Number(cobradoExc.toFixed(2))
        });
      }
      if (valorAlcantMes > 0 || cobradoAlcant > 0) {
        consumoMesItems.push({
          cp: 'AL01',
          ca: '01',
          descripcion: 'Alcantarillado del Período',
          valorTotal: valorAlcantMes,
          saldoRestante: Number(Math.max(0, valorAlcantMes - cobradoAlcant).toFixed(2)),
          aPagarCobrado: Number(cobradoAlcant.toFixed(2))
        });
      }
    }

    // Desglose de "Rubros Pendientes y Cuotas"
    const deudaAlcantTotal = Number(socio.deuda_alcantarillado || 0);
    const deudaAnteriorTotal = facturasImpagas.reduce((sum, f) => sum + Number(f.saldo_pendiente ?? f.total_pagar ?? f.total_mes ?? 0), 0);
    const multasTotal = multasImpagas.reduce((sum, m) => sum + Number(m.saldo_pendiente ?? m.monto ?? 0), 0);

    const rubrosPendientesItems = [];
    if (!cobroConsumoMes && valorAlcantMes > 0) {
      rubrosPendientesItems.push({
        cp: 'SA01',
        ca: '01',
        descripcion: 'Alcantarillado Pendiente Acumulado',
        valorTotal: Number((valorAlcantMes + deudaAlcantTotal).toFixed(2)),
        saldoRestante: Number(deudaAlcantTotal.toFixed(2)),
        aPagarCobrado: Number(valorAlcantMes.toFixed(2))
      });
    }

    if (valorDeudaAntFactura > 0) {
      rubrosPendientesItems.push({
        cp: 'MA01',
        ca: '01',
        descripcion: 'Saldo Anterior / Deuda Histórica',
        valorTotal: Number((valorDeudaAntFactura + deudaAnteriorTotal).toFixed(2)),
        saldoRestante: Number(deudaAnteriorTotal.toFixed(2)),
        aPagarCobrado: Number(valorDeudaAntFactura.toFixed(2))
      });
    }

    if (valorMultasFactura > 0) {
      rubrosPendientesItems.push({
        cp: 'MU01',
        ca: '01',
        descripcion: 'Multas y Sanciones',
        valorTotal: Number((valorMultasFactura + multasTotal).toFixed(2)),
        saldoRestante: Number(multasTotal.toFixed(2)),
        aPagarCobrado: Number(valorMultasFactura.toFixed(2))
      });
    }

    const subtotalConsumo = consumoMesItems.reduce((acc, c) => acc + c.aPagarCobrado, 0);
    const subtotalRubros = rubrosPendientesItems.reduce((acc, r) => acc + r.aPagarCobrado, 0);
    const totalCobrado = Number((subtotalConsumo + subtotalRubros).toFixed(2)) || Number(montoPagado.toFixed(2));
    const totalFactura = totalCobrado;
    const saldoPendienteTotal = Number((saldoPendienteFactura + deudaAlcantTotal + deudaAnteriorTotal + multasTotal).toFixed(2));

    const periodoConsumoFinal = !cobroConsumoMes && valorDeudaAntFactura > 0
      ? 'DEUDA ANTERIOR / SALDO HISTÓRICO'
      : periodoConsumoTexto;

    const esTerceraEdad = ValidationRules.calcularEsTerceraEdad(socio.fecha_nacimiento as string) || Boolean(socio.es_tercera_edad);
    const codigoBarras = (factura.numero_factura || 'FAC-202608-0001').replace(/[^a-zA-Z0-9]/g, '');

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
          numeroComprobante: factura.numero_factura || `1211036816-01`,
          fechaHoraAut: fechaHoraFormateada,
          codigoBarras: codigoBarras || 'ABC0123456789ABC',
          metodoPago: factura.metodo_pago || 'EFECTIVO',
          cajeroNombre: cajero?.nombre_completo || req.user?.username || 'Cajero Responsable',
          esAbono: esAbonoFactura,
          estadoPago: factura.estado_pago || 'PENDIENTE',
          tipoTransaccion: esAbonoFactura ? 'ABONO REGISTRADO' : 'CANCELADO'
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
          subtotalConsumoMes: Number((cobradoBase + cobradoExc + cobradoAlcant).toFixed(2)),
          rubrosPendientes: rubrosPendientesItems,
          subtotalRubrosPendientes: subtotalRubros,
          totalFactura: Number(totalFactura.toFixed(2)),
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
