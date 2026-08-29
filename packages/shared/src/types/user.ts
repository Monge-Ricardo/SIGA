export type RolUsuario = 'ADMIN' | 'CAJERO' | 'LECTOR' | 'AUDITOR';

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  activo: boolean;
  ultimoAccesoOffline?: string;
}
