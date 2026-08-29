export type RolUsuario = 'ADMIN' | 'CAJERO' | 'LECTOR' | 'AUDITOR';

export interface Usuario {
  id: string;
  username: string;
  nombreCompleto: string;
  rol: RolUsuario;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  token: string;
  expiresIn: string;
  usuario: Usuario;
}
