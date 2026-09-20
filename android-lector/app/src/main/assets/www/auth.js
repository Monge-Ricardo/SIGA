/**
 * SIGA-Comunitario • Módulo de Autenticación y Manejo de Tokens
 */

/**
 * Normaliza texto eliminando acentos, tildes y diacríticos (ej: Ángel -> angel)
 */
export function normalizeSearchText(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Comprueba si todos los términos/tokens de la búsqueda están presentes en el texto destino
 * ignorando acentos, mayúsculas y orden de palabras.
 */
export function matchesSearchTokens(targetText, query) {
  if (!query) return true;
  const cleanTarget = normalizeSearchText(targetText);
  const cleanQuery = normalizeSearchText(query);
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => cleanTarget.includes(token));
}

export const USERS_SEED = [
  {
    id: 'usr-cajero',
    username: 'cajero',
    email: 'cajero@agua.com',
    nombre: 'Operador de Caja',
    passwords: ['Cajero123*', 'cajero', 'caja'],
    rol: 'CAJERO',
    cargo: 'Cajera'
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
    const user = JSON.parse(data);
    if (user) {
      const nom = user.nombreCompleto || user.nombre_completo || user.nombre || user.username || '';
      user.nombre = nom;
      user.nombreCompleto = nom;
      user.nombre_completo = nom;
    }
    return user;
  } catch (e) {
    return null;
  }
}

export async function refreshCurrentUserProfile() {
  try {
    const token = getAuthToken();
    if (!token || token === 'android-local-token' || token === 'local-session-jwt') {
      return getCurrentUser();
    }
    const res = await apiFetch('/api/v1/auth/me');
    if (res && res.usuario) {
      const u = res.usuario;
      const cur = getCurrentUser() || {};
      const nom = u.nombreCompleto || u.nombre_completo || u.username;
      const updated = {
        ...cur,
        id: u.id,
        username: u.username,
        nombre: nom,
        nombreCompleto: nom,
        nombre_completo: nom,
        rol: u.rol || cur.rol,
        cargo: u.rol === 'ADMIN' ? 'Administrador General' : u.rol === 'CAJERO' ? 'Cajera' : 'Lector de Campo',
        activo: u.activo
      };
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updated));
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    }
  } catch (err) {
    // Si estamos offline o falla la red, usar perfil en caché
  }
  return getCurrentUser();
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
    return localStorage.getItem('SIGA_SERVER_URL') || 'http://10.0.2.2:4000';
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

function xhrFetch(fullUrl, options = {}, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      const method = (options.method || 'GET').toUpperCase();
      xhr.open(method, fullUrl, true);

      Object.entries(headers).forEach(([k, v]) => {
        try {
          xhr.setRequestHeader(k, v);
        } catch (_) {}
      });

      xhr.onload = () => {
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          statusText: xhr.statusText,
          json: async () => {
            try {
              return JSON.parse(xhr.responseText);
            } catch {
              return {};
            }
          },
          text: async () => xhr.responseText
        });
      };

      xhr.onerror = () => reject(new Error('Error de red en XHR'));
      xhr.ontimeout = () => reject(new Error('Tiempo de espera agotado en XHR'));

      if (options.body) {
        xhr.send(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      } else {
        xhr.send();
      }
    } catch (err) {
      reject(err);
    }
  });
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

  let res;
  // Usar xhrFetch directamente para evitar interferencia de extensiones de navegador (ej. 200.js TypeError M_ID)
  try {
    res = await xhrFetch(fullUrl, options, headers);
  } catch (xhrErr) {
    console.warn('[apiFetch] XHR falló, intentando fetch fallback:', xhrErr);
    try {
      res = await fetch(fullUrl, { cache: options.method && options.method !== 'GET' ? 'no-store' : 'default', ...options, headers });
    } catch (fetchErr) {
      throw xhrErr;
    }
  }

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
      const nom = data.usuario.nombreCompleto || data.usuario.nombre_completo || data.usuario.username;
      const sessionUser = {
        id: data.usuario.id,
        nombre: nom,
        nombreCompleto: nom,
        nombre_completo: nom,
        username: data.usuario.username,
        rol: data.usuario.rol,
        cargo: data.usuario.rol === 'ADMIN' ? 'Administrador General' : data.usuario.rol === 'CAJERO' ? 'Cajera' : 'Lector de Campo',
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
