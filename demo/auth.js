/**
 * SIGA-Comunitario • Módulo de Autenticación y Control de Roles (Offline-First)
 */

const USERS_SEED = [
  {
    id: 'usr-admin',
    nombre: 'Ing. Carlos Mendoza',
    email: 'admin@agua.com',
    password: 'admin',
    rol: 'ADMIN', // Control total
    cargo: 'Administrador General / Directiva'
  },
  {
    id: 'usr-tesorero',
    nombre: 'María Elena Morales',
    email: 'tesorero@agua.com',
    password: 'caja',
    rol: 'CAJERO', // Cobros, socios, caja y fondos
    cargo: 'Tesorera / Recaudadora'
  },
  {
    id: 'usr-lector',
    nombre: 'Pedro Suárez',
    email: 'lector@agua.com',
    password: 'lector',
    rol: 'LECTOR', // Exclusivo toma de lecturas
    cargo: 'Lector de Medidores de Campo'
  }
];

const AUTH_STORAGE_KEY = 'SIGA_AUTH_USER';

export function getCurrentUser() {
  const data = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

export function login(email, password) {
  const user = USERS_SEED.find(
    (u) => u.email.toLowerCase() === email.toLowerCase().trim() && u.password === password
  );

  if (!user) {
    throw new Error('Credenciales inválidas. Compruebe su correo y contraseña.');
  }

  const sessionUser = {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol,
    cargo: user.cargo,
    loggedAt: new Date().toISOString()
  };

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionUser));
  return sessionUser;
}

export function loginAsRole(rol) {
  const user = USERS_SEED.find((u) => u.rol === rol);
  if (!user) throw new Error('Rol no encontrado');
  return login(user.email, user.password);
}

export function logout() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  window.location.href = 'login.html';
}

/**
 * Guardia de autenticación para páginas MPA.
 * Si no está autenticado, redirige a login.html.
 * Si el rol no está permitido, redirige a su página autorizada.
 */
export function requireAuth(allowedRoles = []) {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.rol)) {
    alert(`Acceso Restringido: Tu rol de ${user.cargo} (${user.rol}) no tiene permisos para este módulo.`);
    if (user.rol === 'LECTOR') {
      window.location.href = 'lecturas.html';
    } else {
      window.location.href = 'socios.html';
    }
    return null;
  }

  return user;
}
