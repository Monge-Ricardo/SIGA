import type { Response } from '../core/http.ts';
import { sqliteDb } from '../db/sqlite.ts';
import { facturacionService } from '../services/facturacionService.ts';
import type { AuthenticatedRequest } from '../middlewares/auth.ts';
import type { TarifaConfig, Usuario } from '../shared.ts';

export const getTarifasConfig = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const config = facturacionService.getTarifasConfig();
    res.json({ data: config });
  } catch (error) {
    console.error('[AdminController] Error obteniendo tarifas:', error);
    res.status(500).json({ error: 'Error obteniendo tarifas.' });
  }
};

export const updateTarifasConfig = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const data = req.body as Partial<TarifaConfig>;
    const updated = facturacionService.updateTarifasConfig(data);
    res.json({ message: 'Tarifas actualizadas correctamente.', data: updated });
  } catch (error) {
    console.error('[AdminController] Error actualizando tarifas:', error);
    res.status(500).json({ error: 'Error actualizando tarifas.' });
  }
};

export const getUsuarios = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const db = sqliteDb.getRawDb();
    const rows = db.prepare('SELECT id, username, nombre_completo, rol, activo, created_at, updated_at FROM usuarios').all() as Record<string, unknown>[];

    const usuarios: Usuario[] = rows.map((r) => ({
      id: r.id as string,
      username: r.username as string,
      nombreCompleto: r.nombre_completo as string,
      rol: r.rol as Usuario['rol'],
      activo: Boolean(r.activo),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string
    }));

    res.json({ data: usuarios });
  } catch (error) {
    console.error('[AdminController] Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios.' });
  }
};

export const toggleUsuarioActivo = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const db = sqliteDb.getRawDb();
    const user = db.prepare('SELECT activo FROM usuarios WHERE id = ?').get(id) as { activo: number } | undefined;

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }

    const nuevoEstado = user.activo ? 0 : 1;
    const now = new Date().toISOString();

    db.prepare('UPDATE usuarios SET activo = ?, updated_at = ? WHERE id = ?').run(nuevoEstado, now, id);

    res.json({ message: `Usuario ${nuevoEstado ? 'activado' : 'desactivado'} exitosamente.` });
  } catch (error) {
    console.error('[AdminController] Error modificando usuario:', error);
    res.status(500).json({ error: 'Error modificando usuario.' });
  }
};
