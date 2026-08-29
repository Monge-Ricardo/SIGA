import crypto from 'node:crypto';
import type { RolUsuario, Usuario } from '../shared.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'siga-comunitario-super-secret-key-2026-offline-first';
const JWT_EXPIRES_IN_MS = 24 * 60 * 60 * 1000; // 24 horas

export interface JWTPayload {
  id: string;
  username: string;
  nombreCompleto: string;
  rol: RolUsuario;
  exp: number;
  iat: number;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
  } catch {
    return false;
  }
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function generateToken(usuario: Omit<Usuario, 'createdAt' | 'updatedAt'>): string {
  const header = JSON.stringify({ alg: 'HS256', typ: 'JWT' });
  const now = Date.now();
  const payload: JWTPayload = {
    id: usuario.id,
    username: usuario.username,
    nombreCompleto: usuario.nombreCompleto,
    rol: usuario.rol,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + JWT_EXPIRES_IN_MS) / 1000)
  };

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signature}`;
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const data = `${header}.${payload}`;

    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(data)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    if (signature !== expectedSignature) {
      return null;
    }

    const decodedPayload: JWTPayload = JSON.parse(base64UrlDecode(payload));
    const nowInSeconds = Math.floor(Date.now() / 1000);

    if (decodedPayload.exp < nowInSeconds) {
      return null;
    }

    return decodedPayload;
  } catch {
    return null;
  }
}
