import crypto from 'node:crypto';
import type { Response } from '../core/http.ts';
import { supabaseClient } from '../db/supabase.ts';
import type { AuthenticatedRequest } from '../middlewares/auth.ts';
import type { RolUsuario, TarifaConfig, Usuario } from '../shared.ts';
import { hashPassword } from '../utils/security.ts';

const DEFAULT_USERS: Usuario[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'admin',
    nombreCompleto: 'Carlos Morales (Administrador)',
    rol: 'ADMIN',
    activo: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    username: 'cajero',
    nombreCompleto: 'Gladys Guamán (Tesorera / Cajera)',
    rol: 'CAJERO',
    activo: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    username: 'lector',
    nombreCompleto: 'Manuel Tacuri (Lector de Campo)',
    rol: 'LECTOR',
    activo: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  }
];

// Configuración por defecto de tarifas (SIGA Comunitario)
let currentTarifas: TarifaConfig = {
  id: 'eb3d0642-36c2-49fc-8ad4-547a49eaa9b7',
  cargoFijoNormal: 7.0,
  cargoFijoTerceraEdad: 5.0,
  limiteBaseM3: 30,
  costoExcedenteM3: 0.1,
  recargoAlcantarillado: 1.0,
  repartoNormalPadre: 2.0,
  repartoNormalOperacion: 4.0,
  repartoNormalLector: 0.5,
  repartoNormalMortuorio: 0.5,
  activo: true,
  createdAt: '2026-09-04T03:20:34.603394+00:00'
};

export const getCurrentTarifas = (): TarifaConfig => currentTarifas;

export const getTarifasConfig = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (supabaseClient.isEnabled()) {
      const dbRes = await supabaseClient.fetchRecords<Record<string, any>>('tarifas_config', 'activo=eq.true&limit=1');
      if (dbRes.data && dbRes.data.length > 0) {
        const row = dbRes.data[0];
        currentTarifas = {
          id: row.id || currentTarifas.id,
          cargoFijoNormal: Number(row.cargo_fijo_normal ?? currentTarifas.cargoFijoNormal),
          cargoFijoTerceraEdad: Number(row.cargo_fijo_tercera_edad ?? currentTarifas.cargoFijoTerceraEdad),
          limiteBaseM3: Number(row.limite_base_m3 ?? currentTarifas.limiteBaseM3),
          costoExcedenteM3: Number(row.costo_excedente_m3 ?? currentTarifas.costoExcedenteM3),
          recargoAlcantarillado: Number(row.recargo_alcantarillado ?? currentTarifas.recargoAlcantarillado),
          repartoNormalPadre: Number(row.reparto_normal_padre ?? currentTarifas.repartoNormalPadre),
          repartoNormalOperacion: Number(row.reparto_normal_operacion ?? currentTarifas.repartoNormalOperacion),
          repartoNormalLector: Number(row.reparto_normal_lector ?? currentTarifas.repartoNormalLector),
          repartoNormalMortuorio: Number(row.reparto_normal_mortuorio ?? currentTarifas.repartoNormalMortuorio),
          activo: Boolean(row.activo),
          createdAt: row.created_at || currentTarifas.createdAt
        };
      }
    }
    res.json({
      data: {
        ...currentTarifas,
        // Compatibilidad con contratos y vistas
        tarifaNormal: currentTarifas.cargoFijoNormal,
        tarifaTerceraEdad: currentTarifas.cargoFijoTerceraEdad,
        limiteBasicoM3: currentTarifas.limiteBaseM3,
        valorExcedenteM3: currentTarifas.costoExcedenteM3,
        valorAlcantarillado: currentTarifas.recargoAlcantarillado
      }
    });
  } catch (error) {
    console.error('[AdminController] Error obteniendo tarifas:', error);
    res.json({ data: currentTarifas });
  }
};

export const updateTarifasConfig = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const body = req.body || {};
    const cargoFijoNormal = Number(body.cargoFijoNormal ?? body.tarifaNormal ?? currentTarifas.cargoFijoNormal);
    const cargoFijoTerceraEdad = Number(body.cargoFijoTerceraEdad ?? body.tarifaTerceraEdad ?? currentTarifas.cargoFijoTerceraEdad);
    const limiteBaseM3 = Number(body.limiteBaseM3 ?? body.limiteBasicoM3 ?? currentTarifas.limiteBaseM3);
    const costoExcedenteM3 = Number(body.costoExcedenteM3 ?? body.valorExcedenteM3 ?? currentTarifas.costoExcedenteM3);
    const recargoAlcantarillado = Number(body.recargoAlcantarillado ?? body.valorAlcantarillado ?? currentTarifas.recargoAlcantarillado);
    const repartoNormalPadre = Number(body.repartoNormalPadre ?? currentTarifas.repartoNormalPadre);
    const repartoNormalOperacion = Number(body.repartoNormalOperacion ?? currentTarifas.repartoNormalOperacion);
    const repartoNormalLector = Number(body.repartoNormalLector ?? currentTarifas.repartoNormalLector);
    const repartoNormalMortuorio = Number(body.repartoNormalMortuorio ?? currentTarifas.repartoNormalMortuorio);

    currentTarifas = {
      ...currentTarifas,
      cargoFijoNormal,
      cargoFijoTerceraEdad,
      limiteBaseM3,
      costoExcedenteM3,
      recargoAlcantarillado,
      repartoNormalPadre,
      repartoNormalOperacion,
      repartoNormalLector,
      repartoNormalMortuorio
    };

    if (supabaseClient.isEnabled()) {
      await supabaseClient.request(`tarifas_config?id=eq.${currentTarifas.id}`, {
        method: 'PATCH',
        body: {
          cargo_fijo_normal: cargoFijoNormal,
          cargo_fijo_tercera_edad: cargoFijoTerceraEdad,
          limite_base_m3: limiteBaseM3,
          costo_excedente_m3: costoExcedenteM3,
          recargo_alcantarillado: recargoAlcantarillado,
          reparto_normal_padre: repartoNormalPadre,
          reparto_normal_operacion: repartoNormalOperacion,
          reparto_normal_lector: repartoNormalLector,
          reparto_normal_mortuorio: repartoNormalMortuorio
        }
      });
    }

    res.json({
      message: 'Tarifas actualizadas correctamente.',
      data: {
        ...currentTarifas,
        tarifaNormal: currentTarifas.cargoFijoNormal,
        tarifaTerceraEdad: currentTarifas.cargoFijoTerceraEdad,
        limiteBasicoM3: currentTarifas.limiteBaseM3,
        valorExcedenteM3: currentTarifas.costoExcedenteM3,
        valorAlcantarillado: currentTarifas.recargoAlcantarillado
      }
    });
  } catch (error) {
    console.error('[AdminController] Error actualizando tarifas:', error);
    res.status(500).json({ error: 'Error actualizando tarifas.' });
  }
};

export const getUsuarios = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (supabaseClient.isEnabled()) {
      const queryRes = await supabaseClient.fetchRecords<Record<string, unknown>>(
        'usuarios',
        'select=id,username,nombre_completo,rol,activo,created_at,updated_at&order=created_at.asc'
      );
      if (queryRes.data && queryRes.data.length > 0) {
        const usuarios: Usuario[] = queryRes.data.map((r) => ({
          id: r.id as string,
          username: r.username as string,
          nombreCompleto: (r.nombre_completo as string) || (r.username as string),
          rol: r.rol as Usuario['rol'],
          activo: Boolean(r.activo),
          createdAt: r.created_at as string,
          updatedAt: r.updated_at as string
        }));
        res.json({ data: usuarios });
        return;
      }
    }

    // Respaldo por defecto
    res.json({ data: DEFAULT_USERS });
  } catch (error) {
    console.error('[AdminController] Error obteniendo usuarios:', error);
    res.json({ data: DEFAULT_USERS });
  }
};

export const createUsuario = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
      const existCheck = await supabaseClient.fetchRecords<Record<string, unknown>>(
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

    const createdUser: Usuario = {
      id,
      username: cleanUser,
      nombreCompleto: String(nombreCompleto).trim(),
      rol,
      activo: true,
      createdAt: now,
      updatedAt: now
    };

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      data: createdUser
    });
  } catch (error) {
    console.error('[AdminController] Error creando usuario:', error);
    res.status(500).json({ error: 'Error creando usuario.' });
  }
};

export const updateUsuario = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { username, nombreCompleto, rol, activo, password } = req.body || {};

    if (!id) {
      res.status(400).json({ error: 'ID de usuario es requerido.' });
      return;
    }

    let existingUser: Record<string, unknown> | undefined;
    if (supabaseClient.isEnabled()) {
      const checkRes = await supabaseClient.fetchRecords<Record<string, unknown>>(
        'usuarios',
        `id=eq.${encodeURIComponent(id)}&limit=1`
      );
      if (!checkRes.data || checkRes.data.length === 0) {
        res.status(404).json({ error: 'Usuario no encontrado.' });
        return;
      }
      existingUser = checkRes.data[0];
    } else {
      existingUser = DEFAULT_USERS.find((u) => u.id === id) as any;
      if (!existingUser) {
        res.status(404).json({ error: 'Usuario no encontrado.' });
        return;
      }
    }

    // Regla de seguridad: Si es el admin principal, evitar cambio de rol, nombre de usuario o desactivación
    if (id === '00000000-0000-0000-0000-000000000001') {
      if (rol && rol !== 'ADMIN') {
        res.status(400).json({ error: 'No se puede cambiar el rol del administrador principal del sistema.' });
        return;
      }
      if (activo === false) {
        res.status(400).json({ error: 'No se puede desactivar al administrador principal del sistema.' });
        return;
      }
      if (username && String(username).trim() !== existingUser?.username) {
        res.status(400).json({ error: 'No se puede modificar el identificador del administrador principal.' });
        return;
      }
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      updated_at: now
    };

    if (username !== undefined && String(username).trim().length > 0) {
      const cleanUsername = String(username).trim().toLowerCase();
      if (cleanUsername !== String(existingUser?.username).toLowerCase()) {
        if (supabaseClient.isEnabled()) {
          const existCheck = await supabaseClient.fetchRecords<Record<string, unknown>>(
            'usuarios',
            `username=ilike.${encodeURIComponent(cleanUsername)}&id=neq.${encodeURIComponent(id)}&limit=1`
          );
          if (existCheck.data && existCheck.data.length > 0) {
            res.status(409).json({ error: `El nombre de usuario '${cleanUsername}' ya está en uso por otra cuenta.` });
            return;
          }
        }
        updates.username = cleanUsername;
      }
    }

    if (nombreCompleto !== undefined) {
      updates.nombre_completo = String(nombreCompleto).trim();
    }

    if (rol !== undefined) {
      const rolesPermitidos: RolUsuario[] = ['ADMIN', 'CAJERO', 'LECTOR', 'AUDITOR'];
      if (!rolesPermitidos.includes(rol)) {
        res.status(400).json({ error: `Rol inválido. Opciones permitidas: ${rolesPermitidos.join(', ')}` });
        return;
      }
      updates.rol = rol;
    }

    if (activo !== undefined) {
      updates.activo = Boolean(activo);
    }

    if (password && String(password).trim().length > 0) {
      updates.password_hash = hashPassword(String(password).trim());
    }

    if (supabaseClient.isEnabled()) {
      const patchRes = await supabaseClient.request(`usuarios?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: updates
      });
      if (patchRes.error) {
        res.status(500).json({ error: `Error en base de datos: ${patchRes.error}` });
        return;
      }
    }

    // Actualizar también en caché en memoria DEFAULT_USERS para consistencia offline
    const defIdx = DEFAULT_USERS.findIndex((u) => u.id === id);
    if (defIdx !== -1) {
      DEFAULT_USERS[defIdx] = {
        ...DEFAULT_USERS[defIdx],
        username: (updates.username as string) || DEFAULT_USERS[defIdx].username,
        nombreCompleto: (updates.nombre_completo as string) || DEFAULT_USERS[defIdx].nombreCompleto,
        rol: (updates.rol as RolUsuario) || DEFAULT_USERS[defIdx].rol,
        activo: updates.activo !== undefined ? Boolean(updates.activo) : DEFAULT_USERS[defIdx].activo,
        updatedAt: now
      };
    }

    res.json({
      message: 'Usuario actualizado exitosamente.',
      data: {
        id,
        username: updates.username ?? existingUser?.username,
        nombreCompleto: updates.nombre_completo ?? existingUser?.nombre_completo,
        rol: updates.rol ?? existingUser?.rol,
        activo: updates.activo !== undefined ? updates.activo : Boolean(existingUser?.activo),
        updatedAt: now
      }
    });
  } catch (error) {
    console.error('[AdminController] Error actualizando usuario:', error);
    res.status(500).json({ error: 'Error actualizando usuario.' });
  }
};

export const deleteUsuario = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ error: 'ID de usuario es requerido.' });
      return;
    }

    // Regla 1: No puedes eliminar tu propia cuenta en sesión
    if (req.user && req.user.id === id) {
      res.status(400).json({ error: 'No puedes eliminar tu propia cuenta de usuario en sesión.' });
      return;
    }

    // Regla 2: No se puede eliminar el administrador raíz principal
    if (id === '00000000-0000-0000-0000-000000000001') {
      res.status(400).json({ error: 'No se puede eliminar el usuario administrador principal del sistema.' });
      return;
    }

    if (supabaseClient.isEnabled()) {
      const checkUser = await supabaseClient.fetchRecords<Record<string, unknown>>(
        'usuarios',
        `id=eq.${encodeURIComponent(id)}&limit=1`
      );
      if (!checkUser.data || checkUser.data.length === 0) {
        res.status(404).json({ error: 'Usuario no encontrado.' });
        return;
      }

      // Regla 3: Si es ADMIN, verificar que no sea el último ADMIN activo
      if (checkUser.data[0].rol === 'ADMIN') {
        const admins = await supabaseClient.fetchRecords<Record<string, unknown>>(
          'usuarios',
          'rol=eq.ADMIN&activo=eq.true'
        );
        if (admins.data && admins.data.length <= 1) {
          res.status(400).json({
            error: 'No se puede eliminar el único administrador activo del sistema.'
          });
          return;
        }
      }

      await supabaseClient.request(`usuarios?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
    }

    res.json({ message: 'Usuario eliminado exitosamente.' });
  } catch (error) {
    console.error('[AdminController] Error eliminando usuario:', error);
    res.status(500).json({ error: 'Error eliminando usuario.' });
  }
};

export const toggleUsuarioActivo = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (req.user && req.user.id === id) {
      res.status(400).json({ error: 'No puedes desactivar tu propia cuenta en sesión.' });
      return;
    }

    if (id === '00000000-0000-0000-0000-000000000001') {
      res.status(400).json({ error: 'No se puede desactivar al administrador principal del sistema.' });
      return;
    }

    const now = new Date().toISOString();

    if (supabaseClient.isEnabled()) {
      const checkUser = await supabaseClient.fetchRecords<Record<string, unknown>>(
        'usuarios',
        `id=eq.${encodeURIComponent(id)}&limit=1`
      );
      if (!checkUser.data || checkUser.data.length === 0) {
        res.status(404).json({ error: 'Usuario no encontrado.' });
        return;
      }
      const nuevoEstado = !Boolean(checkUser.data[0].activo);

      // Si se va a desactivar un ADMIN, verificar que quede al menos otro ADMIN activo
      if (!nuevoEstado && checkUser.data[0].rol === 'ADMIN') {
        const admins = await supabaseClient.fetchRecords<Record<string, unknown>>(
          'usuarios',
          'rol=eq.ADMIN&activo=eq.true'
        );
        if (admins.data && admins.data.length <= 1) {
          res.status(400).json({
            error: 'No se puede desactivar el único administrador activo del sistema.'
          });
          return;
        }
      }

      await supabaseClient.request(`usuarios?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { activo: nuevoEstado, updated_at: now }
      });
      res.json({ message: `Usuario ${nuevoEstado ? 'activado' : 'desactivado'} exitosamente.`, activo: nuevoEstado });
      return;
    }

    const fallback = DEFAULT_USERS.find((u) => u.id === id);
    if (!fallback) {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }
    fallback.activo = !fallback.activo;
    res.json({ message: `Usuario ${fallback.activo ? 'activado' : 'desactivado'} exitosamente.`, activo: fallback.activo });
  } catch (error) {
    console.error('[AdminController] Error modificando usuario:', error);
    res.status(500).json({ error: 'Error modificando usuario.' });
  }
};


