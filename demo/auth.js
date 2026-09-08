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
  if (!data) {
    if (window.location.protocol === 'file:' || navigator.userAgent.includes('SIGALector') || navigator.userAgent.includes('SIGA')) {
      const defaultLector = {
        id: 'usr-lector',
        username: 'lector',
        email: 'lector@agua.com',
        nombre: 'Operador de Micromedición (Lector)',
        rol: 'LECTOR',
        cargo: 'Lector de Medidores de Campo',
        loggedAt: new Date().toISOString()
      };
      try {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(defaultLector));
        localStorage.setItem(TOKEN_STORAGE_KEY, 'android-local-token');
      } catch (e) {}
      return defaultLector;
    }
    return null;
  }
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

export function getAuthToken() {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(TOKEN_STORAGE_KEY) || 'android-local-token';
}

export function getServerBaseUrl() {
  const configured = (localStorage.getItem('SIGA_SERVER_URL') || '').trim();
  if (configured) return configured;

  // Si estamos en un APK WebView o protocolo file:, evitar ruta relativa appassets
  if (
    typeof window !== 'undefined' &&
    (window.location.origin.includes('appassets.androidplatform.net') ||
      window.location.protocol === 'file:' ||
      navigator.userAgent.includes('SIGALector'))
  ) {
    return localStorage.getItem('SIGA_SERVER_URL') || '';
  }

  // En navegador web tradicional (localhost:4000 o servidor remoto)
  return typeof window !== 'undefined' ? window.location.origin : '';
}

export function resolveApiUrl(path) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const base = getServerBaseUrl();
  if (base) {
    return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  }
  return path;
}

export async function apiFetch(url, options = {}) {
  const token = getAuthToken();
  const fullUrl = resolveApiUrl(url);

  // Si estamos en WebView y no hay servidor configurado, y es ruta relativa que iría a appassets, no disparar fetch fallido
  if (
    typeof window !== 'undefined' &&
    window.location.origin.includes('appassets.androidplatform.net') &&
    !getServerBaseUrl() &&
    !fullUrl.startsWith('http')
  ) {
    throw new Error('Servidor central no configurado en ajustes del lector.');
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(fullUrl, { ...options, headers });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const isOfflineToken = token === 'android-local-token' || token === 'local-session-jwt';
    const isWebView = typeof window !== 'undefined' && (window.location.origin.includes('appassets.androidplatform.net') || window.location.protocol === 'file:');

    // Solo redirigir a login si NO estamos en WebView y NO estamos en token local offline
    if (res.status === 401 && !url.includes('/auth/login') && !isWebView && !isOfflineToken) {
      console.warn('[Auth] Token inválido o expirado. Limpiando credenciales y redirigiendo a login...');
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setTimeout(() => {
        window.location.replace('login.html?expired=1');
      }, 500);
      throw new Error(errorData.error || 'Token inválido o expirado.');
    }
    throw new Error(errorData.error || `Error en la petición (${res.status})`);
  }
  return res.json();
}

export async function login(identifier, password) {
  const cleanId = (identifier || '').trim();
  const cleanPass = (password || '').trim();

  if (!cleanId || !cleanPass) {
    throw new Error('Por favor ingrese su usuario o correo y contraseña.');
  }

  // 1. Intento de autenticación contra la API REST (/api/v1/auth/login)
  try {
    const loginUrl = resolveApiUrl('/api/v1/auth/login');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(loginUrl, {
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
    } else {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Credenciales incorrectas o usuario no activo.');
    }
  } catch (err) {
    // Si la API devolvió un error explícito (ej: 401 Credenciales incorrectas), no enmascarar
    if (err.message && !err.name?.includes('Abort') && !err.message.includes('fetch') && !err.message.includes('Failed to fetch')) {
      throw err;
    }
    console.warn('[Auth] No fue posible conectar con el servidor API, intentando modo offline de respaldo...', err);
  }

  // 2. Respaldo exclusivo para entorno PWA desconectado (Offline sin backend)
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
    if (user.rol === 'LECTOR') {
      window.location.replace('lecturas.html');
    } else if (user.rol === 'CAJERO') {
      window.location.replace('caja.html');
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
