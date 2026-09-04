export type EstadoSocio = 'ACTIVO' | 'SUSPENDIDO' | 'CORTADO';
export type EstadoServicio = EstadoSocio;
export type EstadoCuenta = 'AL_DIA' | 'EN_MORA';

export interface Medidor {
  id: string; // UUIDv4
  idSocio: string;
  idSector: string;
  numeroMedidor: string;
  alias?: string; // Ej: "Casa principal", "Terreno", "Local comercial", "M1"
  direccion?: string;
  tieneAlcantarillado: boolean;
  estado: EstadoSocio;
  nombreSector?: string;
  codigoSector?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type MedidorAgua = Medidor;

export interface Socio {
  id: string; // UUIDv4
  codigoSocio: string; // Ej: "SOC-0012"
  nombres: string;
  apellidos: string;
  nombreCompleto?: string;
  cedulaRuc: string;
  fechaNacimiento: string; // "YYYY-MM-DD"
  edadCalculada?: number;
  esTerceraEdad?: boolean; // Calculado dinámicamente: edad >= 65
  fechaUnion: string; // "YYYY-MM-DD"
  fechaAfiliacion?: string;
  telefono?: string;
  direccion: string;
  estado: EstadoSocio;
  estadoServicio?: EstadoServicio;
  estadoCuenta?: EstadoCuenta;
  mesesAdeudados?: number;
  montoTotalAdeudado?: number;
  fechaDeudaAntigua?: string;
  tarifaBaseMensual?: number;
  medidores?: Medidor[]; // Lista de medidores asociados (1:N)
  // Campos de compatibilidad hacia atrás
  idSector?: string;
  sectorId?: string;
  nombreSector?: string;
  medidorNumero?: string;
  tieneAlcantarillado?: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Alias para compatibilidad
export type SocioAgua = Socio;
export type ClienteAgua = Socio;

export interface Sector {
  id: string;
  codigo?: string;
  codigoSector: string;
  nombre?: string;
  nombreSector: string;
  descripcion?: string;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

export type EstadoPeriodo = 'ABIERTO' | 'CERRADO' | 'FACTURADO';

export interface Periodo {
  id: string;
  periodoCodigo: string; // "YYYY-MM"
  nombre: string; // "Agosto 2026"
  fechaInicio: string;
  fechaFin: string;
  estado: EstadoPeriodo;
  createdAt: string;
}

export interface Lectura {
  id: string;
  idMedidor: string; // Acometida física
  idSocio: string;
  idPeriodo: string;
  numeroMedidor?: string;
  aliasMedidor?: string;
  lecturaAnterior: number;
  lecturaActual: number;
  consumoTotal: number; // lecturaActual - lecturaAnterior
  excedenteM3: number; // max(0, consumoTotal - 30)
  fechaLectura: string;
  idLector: string;
  observaciones?: string;
  fotoMedidorUrl?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Alias para compatibilidad
export type LecturaMedidor = Lectura;

export type TipoMultaRubro = 'MINGA' | 'ASAMBLEA' | 'RECONEXION' | 'CUOTA_EXTRA' | 'OTRO';

export interface MultaRubro {
  id: string;
  idSocio: string;
  idPeriodo?: string;
  tipoRubro: TipoMultaRubro;
  monto: number;
  motivo: string;
  pagado: boolean;
  idFactura?: string;
  createdAt: string;
}

export type EstadoPagoFactura = 'PENDIENTE' | 'PAGADO' | 'ANULADO';
export type MetodoPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'MOVIL';

export interface Factura {
  id: string;
  numeroFactura: string; // Ej: "FAC-2026-0001"
  idSocio: string;
  idMedidor?: string;
  numeroMedidor?: string;
  aliasMedidor?: string;
  socioNombre?: string;
  socioCedula?: string;
  idPeriodo: string;
  periodoCodigo?: string;
  idLectura?: string;
  esTerceraEdad: boolean;
  valorBase: number; // $7.00 o $5.00
  consumoM3: number;
  excedenteM3: number;
  valorExcedente: number; // excedenteM3 * $0.10
  valorAlcantarillado: number; // $1.00 o $0.00
  valorMultas: number;
  valorDeudaAnterior: number;
  totalMes: number; // valorBase + valorExcedente + valorAlcantarillado
  totalPagar: number; // totalMes + valorMultas + valorDeudaAnterior
  estadoPago: EstadoPagoFactura;
  fechaVencimiento: string;
  fechaPago?: string;
  metodoPago?: MetodoPago;
  idCajero?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Alias para compatibilidad
export type CobroRecibo = Factura;

export interface TarifaConfig {
  id: string;
  cargoFijoNormal: number; // $7.00
  cargoFijoTerceraEdad: number; // $5.00
  limiteBaseM3: number; // 30.00 m³
  costoExcedenteM3: number; // $0.10
  recargoAlcantarillado: number; // $1.00
  repartoNormalPadre: number; // $2.00
  repartoNormalOperacion: number; // $4.00
  repartoNormalLector: number; // $0.50
  repartoNormalMortuorio: number; // $0.50
  activo: boolean;
  createdAt: string;
}

export interface EstadoCuentaSocio {
  socio: Socio;
  alDia: boolean;
  mesesAdeudados: number;
  deudaTotalPendiente: number;
  fechaDeudaMasAntigua?: string;
  facturasPendientes: Factura[];
  multasPendientes: MultaRubro[];
  historialFacturas: Factura[];
}

export const TARIFAS_CONFIG = {
  BASE_NORMAL: 7.00,
  BASE_TERCERA_EDAD: 5.00,
  RECARGO_ALCANTARILLADO: 1.00,
  EXCEDENTE_POR_M3: 0.10,
  LIMITE_BASE_M3: 30,
  EDAD_TERCERA_EDAD: 65,
} as const;
