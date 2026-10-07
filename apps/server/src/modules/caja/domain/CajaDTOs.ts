/**
 * DTOs y Contratos de Tipos Estrictos para el Módulo 3: Caja y Cobros
 * Cumple con IEEE 830 / SRS: docs/caso_uso_modulo3.md
 */

export const FONDO_IDS = {
  PADRE_PARROQUIA: '22222222-2222-2222-2222-222222220001',
  OPERACION_MANT: '22222222-2222-2222-2222-222222220002',
  PAGO_LECTOR: '22222222-2222-2222-2222-222222220003',
  MORTUORIO: '22222222-2222-2222-2222-222222220004',
  PRO_MEJORAS: '22222222-2222-2222-2222-222222220005',
  MULTAS_EXTRAS: '22222222-2222-2222-2222-222222220006',
  ALCANTARILLADO: '22222222-2222-2222-2222-222222220007'
} as const;

export type MetodoPago = 'EFECTIVO' | 'TRANSFERENCIA';

export type TipoRubroCobro = 
  | 'AGUA_PERIODO_ACTIVO'
  | 'AGUA_PERIODO_ANTERIOR'
  | 'DEUDA_HISTORICA_CORTE'
  | 'ALCANTARILLADO'
  | 'MULTA_COMUNITARIA';

export interface ItemCobroRequestDTO {
  tipo: TipoRubroCobro;
  idReferencia: string; // id de factura o id de multa_rubro
  numeroComprobante?: string;
  montoACobrar: number;
  descripcion?: string;
}

export interface RegistrarCobroRequestDTO {
  idSocio: string;
  idCajero: string;
  metodoPago: MetodoPago;
  montoTotalRecibido: number;
  referenciaBancaria?: string; // Mandatorio si es TRANSFERENCIA
  items: ItemCobroRequestDTO[];
}

export interface AsientoFondoDTO {
  idFondo: string;
  nombreFondo: string;
  monto: number;
  concepto: string;
  idReferencia?: string;
  idFactura?: string | null;
}

export interface RegistrarCobroResponseDTO {
  success: boolean;
  transaccionId: string;
  numeroRecibo: string;
  fechaEmision: string;
  socio: {
    id: string;
    nombreCompleto: string;
    cedulaRuc: string;
    codigoSocio: string;
  };
  totalCobrado: number;
  montoRecibido: number;
  cambioVuelto: number;
  metodoPago: MetodoPago;
  referenciaBancaria?: string;
  asientosFondos: AsientoFondoDTO[];
  rubrosLiquidados: {
    tipo: TipoRubroCobro;
    idReferencia: string;
    montoPagado: number;
    saldoRestante: number;
    estadoFinal: 'PAGADO' | 'PARCIAL' | 'PENDIENTE';
  }[];
  saldoPendienteRestanteTotal: number;
}

export interface RubroPendienteSocioDTO {
  id: string;
  tipo: TipoRubroCobro;
  idReferencia: string;
  periodo?: string;
  numeroFactura?: string;
  numeroMedidor?: string;
  concepto: string;
  fechaVencimiento?: string;
  montoOriginal: number;
  montoPagadoPrevio: number;
  saldoPendiente: number;
  esTerceraEdad: boolean;
  detallesAgua?: {
    lecturaAnterior: number;
    lecturaActual: number;
    consumoM3: number;
    excedenteM3: number;
    valorBase: number;
    valorExcedente: number;
    valorAlcantarillado: number;
  };
}

export interface ConsultarDeudasSocioResponseDTO {
  socio: {
    id: string;
    codigoSocio: string;
    nombres: string;
    apellidos: string;
    nombreCompleto: string;
    cedulaRuc: string;
    esTerceraEdad: boolean;
    tieneAlcantarillado: boolean;
    sector: string;
    numeroMedidor: string;
    medidores?: {
      id: string;
      numeroMedidor: string;
      alias?: string;
    }[];
  };
  rubrosPendientes: RubroPendienteSocioDTO[];
  totalDeudaPendiente: number;
  totalPeriodosImpagos: number;
}

export interface RegistrarEgresoRequestDTO {
  idCajero: string;
  monto: number;
  motivo: string;
  beneficiario: string;
  comprobanteRespaldo?: string;
}

export interface RegistrarEgresoResponseDTO {
  id: string;
  fecha: string;
  monto: number;
  motivo: string;
  beneficiario: string;
  comprobanteRespaldo?: string;
}

export interface CuadreCajaDiarioResponseDTO {
  fecha: string;
  cajero: {
    id: string;
    nombre: string;
  };
  resumenOperaciones: {
    totalRecibosEmitidos: number;
    totalCobrosEfectivo: number;
    totalCobrosTransferencia: number;
    totalEgresosCajaChica: number;
    saldoNetoEfectivo: number;
  };
  distribucionPorFondos: {
    idFondo: string;
    nombreFondo: string;
    totalRecaudado: number;
  }[];
  recibosDetalle: {
    id?: string;
    numeroRecibo: string;
    hora: string;
    socio: string;
    socioCedula?: string;
    socioCodigo?: string;
    numeroMedidor?: string;
    metodoPago: MetodoPago;
    monto: number;
  }[];
  egresosDetalle: {
    id: string;
    hora: string;
    beneficiario: string;
    motivo: string;
    monto: number;
  }[];
  balanceGeneral?: {
    totalRecaudadoHistorico: number;
    totalEgresosHistorico: number;
    saldoNetoDisponible: number;
    totalRecibosHistoricos: number;
    totalEgresosCount: number;
  };
}

export interface AnularCobroRequestDTO {
  idFactura: string;
  idAdmin: string;
  motivo: string;
}
