export type EstadoServicio = 'ACTIVO' | 'SUSPENDIDO' | 'CORTADO';
export type EstadoCuenta = 'AL_DIA' | 'EN_MORA';

export interface Sector {
  id: string;
  nombre: string;
  codigo: string;
  descripcion?: string;
}

export interface SocioAgua {
  id: string; // UUIDv4
  codigoSocio: string; // Ej: "SEC-01-045"
  nombres: string;
  apellidos: string;
  nombreCompleto: string;
  cedulaRuc: string;
  fechaNacimiento: string; // "YYYY-MM-DD"
  edadCalculada: number;
  esTerceraEdad: boolean; // >= 65 años -> true ($5.00), else false ($7.00)
  fechaAfiliacion: string; // "YYYY-MM-DD"
  sectorId: string;
  nombreSector?: string;
  direccion?: string;
  telefono?: string;
  medidorNumero?: string;
  tieneAlcantarillado: boolean; // +$1.00/mes
  estadoServicio: EstadoServicio;
  estadoCuenta: EstadoCuenta;
  mesesAdeudados: number;
  montoTotalAdeudado: number;
  fechaDeudaAntigua?: string;
  tarifaBaseMensual: number; // 7.00 o 5.00 (+1.00 si tiene alcantarillado)
  createdAt: string; // ISO 8601
  updatedAt: string;
  version: number;
}

// Alias de compatibilidad
export type ClienteAgua = SocioAgua;

export interface LecturaMedidor {
  id: string;
  clienteId: string;
  periodo: string; // "YYYY-MM"
  lecturaAnterior: number;
  lecturaActual: number;
  consumoM3: number;
  fechaLectura: string;
  lectorResponsableId: string;
  observaciones?: string;
  fotoMedidorUrl?: string; // Cache local / blob encolado
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CobroRecibo {
  id: string;
  numeroRecibo: string;
  clienteId: string;
  lecturaId?: string;
  periodo: string; // "YYYY-MM"
  montoBase: number;
  montoExceso: number;
  montoMora: number;
  montoOtros: number;
  montoTotal: number;
  estado: 'PENDIENTE' | 'PAGADO' | 'ANULADO';
  fechaVencimiento: string;
  fechaPago?: string;
  metodoPago?: 'EFECTIVO' | 'TRANSFERENCIA' | 'MOVIL';
  cajeroResponsableId?: string;
  movimientoCajaId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TarifaAgua {
  id: string;
  nombre: string;
  cargoFijoBase: number;
  limiteBaseM3: number;
  costoM3Exceso: number;
  activo: boolean;
}

export const TARIFAS_CONFIG = {
  BASE_NORMAL: 7.00,
  BASE_TERCERA_EDAD: 5.00,
  RECARGO_ALCANTARILLADO: 1.00,
  EXCEDENTE_POR_M3: 0.10,
  LIMITE_BASE_M3: 30,
  EDAD_TERCERA_EDAD: 65,
} as const;

