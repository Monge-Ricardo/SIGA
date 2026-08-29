import type { Request, Response } from '../core/http.ts';
import { verifyToken, type JWTPayload } from '../utils/security.ts';
import type { RolUsuario } from '../shared.ts';

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

export const authenticateJWT = async (req: AuthenticatedRequest, res: Response, next: (err?: any) => void): Promise<void> => {
  const authHeader = req.headers.authorization || (req.headers['Authorization'] as string);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'No autorizado. Se requiere token Bearer en el encabezado Authorization.'
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);

  if (!payload) {
    res.status(401).json({
      error: 'Token inválido o expirado. Por favor inicie sesión nuevamente.'
    });
    return;
  }

  req.user = payload;
  next();
};

export const requireRoles = (...allowedRoles: RolUsuario[]) => {
  return async (req: AuthenticatedRequest, res: Response, next: (err?: any) => void): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }

    if (!allowedRoles.includes(req.user.rol)) {
      res.status(403).json({
        error: `Acceso denegado. El rol '${req.user.rol}' no tiene permisos para esta acción. Roles requeridos: ${allowedRoles.join(', ')}.`
      });
      return;
    }

    next();
  };
};
