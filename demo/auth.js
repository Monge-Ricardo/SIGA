/**
 * SIGA-Comunitario • Módulo de Autenticación y Manejo de Tokens
 */

export const USERS_SEED = [
  {
    id: 'usr-cajero',
    username: 'cajero',
    email: 'cajero@agua.com',
    nombre: 'Tesorero / Cobrador General',
    passwords: ['Cajero123*', 'cajero', 'caja'],
    rol: 'CAJERO',
    cargo: 'Tesorero / Recaudador Integral'
  },
  {
    id: 'usr-admin',
    username: 'admin',
    email: 'admin@agua.com',
    nombre: 'Administrador Directiva',
    passwords: ['Admin123*', 'admin'],
    rol: 'ADMIN',
    cargo: 'Administrador General / Gobernanza'
  },
  {
    id: 'usr-lector',
    username: 'lector',
    email: 'lector@agua.com',
    nombre: 'Operador de Micromedición',
    passwords: ['Lector123*', 'lector'],
    rol: 'LECTOR',
    cargo: 'Lector de Medidores de Campo'
  }
];

const AUTH_STORAGE_KEY = 'SIGA_AUTH_USER';
const TOKEN_STORAGE_KEY = 'SIGA_AUTH_TOKEN';

export function getCurrentUser() {
  const data = sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

export function getAuthToken() {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

export async function login(identifier, password) {
  const cleanId = (identifier || '').trim();
  const cleanPass = (password || '').trim();

  if (!cleanId || !cleanPass) {
    throw new Error('Por favor ingrese su usuario o correo y contraseña.');
  }

  // 1. Intento de autenticación contra la API REST (/api/v1/auth/login)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cleanId, password: cleanPass }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const sessionUser = {
        id: data.usuario.id,
        nombre: data.usuario.nombreCompleto,
        username: data.usuario.username,
        rol: data.usuario.rol,
        cargo: data.usuario.rol === 'ADMIN' ? 'Administrador General' : data.usuario.rol === 'CAJERO' ? 'Tesorero / Recaudador' : 'Lector de Campo',
        loggedAt: new Date().toISOString()
      };
      
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionUser));
      sessionStorage.setItem(TOKEN_STORAGE_KEY, data.token || '');
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionUser));
      localStorage.setItem(TOKEN_STORAGE_KEY, data.token || '');
      return sessionUser;
    }
  } catch (netErr) {
    console.warn('[Auth] Servidor local o timeout, validando credenciales locales:', netErr);
  }

  // 2. Respaldo de autenticación local
  const localUser = USERS_SEED.find((u) => {
    const matchUser = u.username.toLowerCase() === cleanId.toLowerCase() || u.email.toLowerCase() === cleanId.toLowerCase();
    const matchPass = u.passwords.includes(cleanPass);
    return matchUser && matchPass;
  });

  if (!localUser) {
    throw new Error('Credenciales incorrectas. Verifique su usuario y contraseña.');
  }

  const sessionUser = {
    id: localUser.id,
    nombre: localUser.nombre,
    username: localUser.username,
    email: localUser.email,
    rol: localUser.rol,
    cargo: localUser.cargo,
    loggedAt: new Date().toISOString()
  };

  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionUser));
  sessionStorage.setItem(TOKEN_STORAGE_KEY, 'local-session-jwt');
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionUser));
  localStorage.setItem(TOKEN_STORAGE_KEY, 'local-session-jwt');
  return sessionUser;
}

export function logout() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.clear();
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.location.replace('login.html');
}

/**
 * Guardia de autenticación para páginas protegidas.
 * Se asegura de que no se pueda volver atrás con el botón 'Atrás' del navegador tras cerrar sesión.
 */
export function requireAuth(allowedRoles = []) {
  const user = getCurrentUser();
  if (!user) {
    window.location.replace('login.html');
    return null;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.rol)) {
    alert(`Acceso Restringido: Tu rol (${user.rol}) no tiene permisos para este módulo.`);
    if (user.rol === 'LECTOR') {
      window.location.replace('lecturas.html');
    } else {
      window.location.replace('socios.html');
    }
    return null;
  }

  // Prevención de bfcache (Back-Forward Cache del navegador)
  window.addEventListener('pageshow', (event) => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      window.location.replace('login.html');
    }
  });

  return user;
}
