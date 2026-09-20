import type { Usuario, RolUsuario } from '@app-agua/shared';

export interface UserSession extends Usuario {
  cargo: string;
  loggedAt: string;
}

export const USERS_SEED: Array<Usuario & { password: string; cargo: string }> = [
  {
    id: 'usr-admin',
    nombre: 'Ing. Carlos Mendoza',
    email: 'admin@agua.com',
    password: 'admin',
    rol: 'ADMIN',
    activo: true,
    cargo: 'Administrador General / Directiva'
  },
  {
    id: 'usr-cajero',
    nombre: 'Maribel Miño',
    email: 'cajero@agua.com',
    password: 'caja',
    rol: 'CAJERO',
    activo: true,
    cargo: 'Cajera'
  },
  {
    id: 'usr-lector',
    nombre: 'Pedro Suárez',
    email: 'lector@agua.com',
    password: 'lector',
    rol: 'LECTOR',
    activo: true,
    cargo: 'Lector de Medidores de Campo'
  }
];

const AUTH_STORAGE_KEY = 'SIGA_AUTH_USER';

export class AuthService {
  public getCurrentUser(): UserSession | null {
    const data = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  public login(email: string, pass: string): UserSession {
    const user = USERS_SEED.find(
      (u) => u.email.toLowerCase() === email.toLowerCase().trim() && u.password === pass
    );

    if (!user) {
      throw new Error('Credenciales incorrectas');
    }

    const session: UserSession = {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
      activo: user.activo,
      cargo: user.cargo,
      loggedAt: new Date().toISOString()
    };

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  public loginAsRole(rol: RolUsuario): UserSession {
    const user = USERS_SEED.find((u) => u.rol === rol);
    if (!user) throw new Error('Rol no encontrado');
    return this.login(user.email, user.password);
  }

  public logout(): void {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

export const authService = new AuthService();
