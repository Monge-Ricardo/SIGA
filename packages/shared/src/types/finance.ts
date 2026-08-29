export type TipoMovimientoCaja = 'ENTRADA' | 'SALIDA';

export type CategoriaMovimiento =
  | 'COBRO_AGUA'
  | 'RECONEXION'
  | 'NUEVO_CONTRATO'
  | 'COMPRA_MATERIALES'
  | 'PAGO_ENERGIA_BOMBAS'
  | 'MANTENIMIENTO_RED'
  | 'PAGO_PERSONAL'
  | 'FONDO_EMERGENCIA'
  | 'OTRO';

export interface MovimientoCaja {
  id: string; // UUIDv4
  tipo: TipoMovimientoCaja;
  categoria: CategoriaMovimiento;
  monto: number;
  descripcion: string;
  fecha: string; // ISO 8601
  responsableId: string;
  comprobanteNumero?: string;
  reciboAguaId?: string;
  saldoPosteriorCalculado?: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface BalanceCajaResumen {
  totalEntradas: number;
  totalSalidas: number;
  balanceNeto: number;
  fechaInicio: string;
  fechaFin: string;
  conteoMovimientos: number;
}
