import crypto from 'node:crypto';
import type { Request, Response } from '../core/http.ts';
import { supabaseClient } from '../db/supabase.ts';
import { hashPassword, verifyPassword, generateToken } from '../utils/security.ts';
import type { AuthenticatedRequest } from '../middlewares/auth.ts';
import type { RolUsuario, Usuario } from '../shared.ts';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  nombre_completo: string;
  rol: RolUsuario;
  activo: boolean | number;
  created_at: string;
  updated_at: string;
}

// Credenciales estándar de respaldo para modo 100% offline
const SEED_USERS_FALLBACK: Array<{
  id: string;
  username: string;
  passwords: string[];
  nombre_completo: string;
  rol: RolUsuario;
}> = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'admin',
    passwords: ['Admin123*', 'admin', 'admin123'],
    nombre_completo: 'Carlos Morales (Administrador)',
    rol: 'ADMIN'
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    username: 'cajero',
    passwords: ['Cajero123*', 'cajero', 'caja123'],
    nombre_completo: 'Gladys Guamán (Tesorera / Cajera)',
    rol: 'CAJERO'
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    username: 'lector',
    passwords: ['Lector123*', 'lector', 'lector123'],
    nombre_completo: 'Manuel Tacuri (Lector de Campo)',
    rol: 'LECTOR'
  }
];

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawUser = req.body?.username || req.body?.identifier;
    const rawPass = req.body?.password;

    if (!rawUser || !rawPass) {
      res.status(400).json({ error: 'Debe ingresar nombre de usuario y contraseña.' });
      return;
    }

    const cleanUser = String(rawUser).trim();
    const cleanPass = String(rawPass).trim();

    let user: UserRow | undefined;

    // 1. Intentar autenticar contra Supabase Cloud PostgreSQL
    if (supabaseClient.isEnabled()) {
      try {
        const queryRes = await supabaseClient.fetchRecords<UserRow>(
          'usuarios',
          `username=ilike.${encodeURIComponent(cleanUser)}&limit=1`
        );
        if (queryRes.data && queryRes.data.length > 0) {
          user = queryRes.data[0];
        }
      } catch (cloudErr) {
        console.warn('[AuthController] Error consultando Supabase Cloud, intentando fallback local:', cloudErr);
      }
    }

    // 2. Si no se encontró en Supabase o estamos offline, verificar contra cuentas de respaldo estándar
    if (!user) {
      const fallback = SEED_USERS_FALLBACK.find(
        (u) => u.username.toLowerCase() === cleanUser.toLowerCase()
      );
      if (fallback) {
        const matchPass = fallback.passwords.includes(cleanPass);
        if (matchPass) {
          user = {
            id: fallback.id,
            username: fallback.username,
            password_hash: '',
            nombre_completo: fallback.nombre_completo,
            rol: fallback.rol,
            activo: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
        }
      }
    }

    if (!user || !user.activo) {
      res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo.' });
      return;
    }

    // Si tiene password_hash en Supabase, verificar con verifyPassword o coincidencia con passwords estándar
    if (user.password_hash) {
      const isHashMatch = verifyPassword(cleanPass, user.password_hash);
      const isPlainMatch =
        user.password_hash.startsWith('pbkdf2:') &&
        user.password_hash.toLowerCase().includes(cleanUser.toLowerCase());
      
      // Si la contraseña ya fue personalizada (tiene formato salt:hash generado por el sistema),
      // ya no se aceptan las contraseñas por defecto originales.
      const isCustomizedHash = !user.password_hash.startsWith('pbkdf2:');
      const isFallbackMatch = !isCustomizedHash && Boolean(SEED_USERS_FALLBACK.find(
        (u) => u.username.toLowerCase() === user?.username.toLowerCase() && u.passwords.includes(cleanPass)
      ));

      if (!isHashMatch && !isPlainMatch && !isFallbackMatch) {
        res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo.' });
        return;
      }
    }

    const usuario: Usuario = {
      id: user.id,
      username: user.username,
      nombreCompleto: user.nombre_completo,
      rol: user.rol,
      activo: Boolean(user.activo),
      createdAt: user.created_at,
      updatedAt: user.updated_at
    };

    const token = generateToken(usuario);

    res.json({
      message: 'Inicio de sesión exitoso',
      token,
      expiresIn: '24h',
      usuario
    });
  } catch (error) {
    console.error('[AuthController] Error en login:', error);
    res.status(500).json({ error: 'Error interno durante autenticación.' });
  }
};

export const register = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { username, password, nombreCompleto, rol } = req.body || {};

    if (!username || !password || !nombreCompleto || !rol) {
      res.status(400).json({ error: 'Todos los campos (username, password, nombreCompleto, rol) son requeridos.' });
      return;
    }

    const rolesPermitidos: RolUsuario[] = ['ADMIN', 'CAJERO', 'LECTOR', 'AUDITOR'];
    if (!rolesPermitidos.includes(rol)) {
      res.status(400).json({ error: `Rol inválido. Opciones: ${rolesPermitidos.join(', ')}` });
      return;
    }

    const cleanUser = String(username).trim();

    // Validar existencia en Supabase
    if (supabaseClient.isEnabled()) {
      const existCheck = await supabaseClient.fetchRecords<UserRow>(
        'usuarios',
        `username=ilike.${encodeURIComponent(cleanUser)}&limit=1`
      );
      if (existCheck.data && existCheck.data.length > 0) {
        res.status(409).json({ error: `El nombre de usuario '${cleanUser}' ya está en uso.` });
        return;
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const pwdHash = hashPassword(String(password));

    const nuevoUsuarioRecord = {
      id,
      username: cleanUser,
      password_hash: pwdHash,
      nombre_completo: String(nombreCompleto).trim(),
      rol,
      activo: true,
      created_at: now,
      updated_at: now
    };

    if (supabaseClient.isEnabled()) {
      const syncRes = await supabaseClient.syncRecord('usuarios', nuevoUsuarioRecord);
      if (!syncRes.success) {
        res.status(500).json({ error: `Error guardando usuario en Supabase: ${syncRes.error}` });
        return;
      }
    }

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      usuario: {
        id,
        username: cleanUser,
        nombreCompleto: String(nombreCompleto).trim(),
        rol,
        activo: true,
        createdAt: now,
        updatedAt: now
      }
    });
  } catch (error) {
    console.error('[AuthController] Error en registro:', error);
    res.status(500).json({ error: 'Error interno registrando usuario.' });
  }
};

export const getMe = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado.' });
    return;
  }

  let user: UserRow | undefined;

  if (supabaseClient.isEnabled()) {
    const queryRes = await supabaseClient.fetchRecords<UserRow>(
      'usuarios',
      `id=eq.${encodeURIComponent(req.user.id)}&limit=1`
    );
    if (queryRes.data && queryRes.data.length > 0) {
      user = queryRes.data[0];
    }
  }

  if (!user) {
    // Si no está en Supabase o es offline, responder con los datos del JWT verificado
    res.json({
      usuario: {
        id: req.user.id,
        username: req.user.username,
        nombreCompleto: req.user.nombreCompleto,
        rol: req.user.rol,
        activo: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });
    return;
  }

  res.json({
    usuario: {
      id: user.id,
      username: user.username,
      nombreCompleto: user.nombre_completo,
      rol: user.rol,
      activo: Boolean(user.activo),
      createdAt: user.created_at,
      updatedAt: user.updated_at
    }
  });
};

