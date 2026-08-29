export type CodigoFondo =
  | 'PADRE_PARROQUIA'
  | 'OPERACION_MANT'
  | 'PAGO_LECTOR'
  | 'MORTUORIO'
  | 'PRO_MEJORAS'
  | 'MULTAS_EXTRAS'
  | 'ALCANTARILLADO';

export type TipoMovimientoFondo = 'INGRESO' | 'EGRESO';

export interface FondoCatalogo {
  id: string;
  codigo: CodigoFondo;
  nombre: string;
  descripcion: string;
  activo: boolean;
}

export interface MovimientoFondo3Columnas {
  id: string;
  idFondo: string;
  codigoFondo?: CodigoFondo;
  nombreFondo?: string;
  fecha: string; // ISO 8601
  concepto: string;
  tipo: TipoMovimientoFondo;
  ingreso: number; // Columna 1 (+)
  egreso: number; // Columna 2 (-)
  saldo: number; // Columna 3 (= Saldo Acumulado)
  idFactura?: string;
  numeroComprobante?: string;
  idResponsable: string;
  responsableNombre?: string;
  beneficiario?: string;
  createdAt: string;
}

// Alias para compatibilidad con código existente
export type MovimientoCaja = MovimientoFondo3Columnas;

export interface ResumenFondo3Columnas {
  idFondo: string;
  codigoFondo: CodigoFondo;
  nombreFondo: string;
  totalIngresos: number;
  totalEgresos: number;
  saldoActual: number;
  conteoMovimientos: number;
}

export interface LiquidacionPadreParroquia {
  periodoCodigo: string;
  totalRecaudadoMes: number; // Aportes cobrados destinados al Padre en el mes
  totalEntregadoPadre: number; // Egresos registrados entregados al Padre
  saldoDisponibleFondoPadre: number; // Saldo acumulado en el fondo
  totalSociosAportaron: number;
  totalSociosMorosos: number;
  montoPendienteCobro: number; // Dinero que falta cobrar por socios morosos
}

export interface BalanceGeneralFondos {
  fechaCorte: string;
  fondos: ResumenFondo3Columnas[];
  granTotalIngresos: number;
  granTotalEgresos: number;
  saldoGlobalDisponible: number;
}
