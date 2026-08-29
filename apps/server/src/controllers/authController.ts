import crypto from 'node:crypto';
import type { Request, Response } from '../core/http.ts';
import { sqliteDb } from '../db/sqlite.ts';
import { hashPassword, verifyPassword, generateToken } from '../utils/security.ts';
import type { AuthenticatedRequest } from '../middlewares/auth.ts';
import type { RolUsuario, Usuario } from '../shared.ts';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  nombre_completo: string;
  rol: RolUsuario;
  activo: number;
  created_at: string;
  updated_at: string;
}

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      res.status(400).json({ error: 'Debe ingresar nombre de usuario y contraseña.' });
      return;
    }

    const db = sqliteDb.getRawDb();
    const user = db.prepare('SELECT * FROM usuarios WHERE username = ?').get(String(username).trim()) as UserRow | undefined;

    if (!user || !user.activo) {
      res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo.' });
      return;
    }

    const isMatch = verifyPassword(String(password), user.password_hash);
    if (!isMatch) {
      res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo.' });
      return;
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

    const db = sqliteDb.getRawDb();
    const existe = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(String(username).trim());
    if (existe) {
      res.status(409).json({ error: `El nombre de usuario '${username}' ya está en uso.` });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const pwdHash = hashPassword(String(password));

    db.prepare(`
      INSERT INTO usuarios (id, username, password_hash, nombre_completo, rol, activo, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, String(username).trim(), pwdHash, String(nombreCompleto).trim(), rol, now, now);

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      usuario: {
        id,
        username: String(username).trim(),
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

  const db = sqliteDb.getRawDb();
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id) as UserRow | undefined;

  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado.' });
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
