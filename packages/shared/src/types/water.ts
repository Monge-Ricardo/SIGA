export interface ClienteAgua {
  id: string; // UUIDv4 o CUID generado localmente
  codigoCliente: string; // Ej: "SEC-01-045"
  nombreCompleto: string;
  identificacion: string;
  telefono?: string;
  direccion: string;
  sectorId: string;
  tarifaId: string;
  medidorNumero: string;
  estado: 'ACTIVO' | 'SUSPENDIDO' | 'INACTIVO';
  createdAt: string; // ISO 8601
  updatedAt: string;
  version: number;
}

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
