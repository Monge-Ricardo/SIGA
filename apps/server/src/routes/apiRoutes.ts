import { Router } from '../core/http.ts';
import { syncRouter } from './syncRoutes.ts';
import { authenticateJWT, requireRoles } from '../middlewares/auth.ts';
import { login, register, getMe } from '../controllers/authController.ts';
import {
  getTarifasConfig,
  updateTarifasConfig,
  getUsuarios,
  createUsuario,
  updateUsuario,
  deleteUsuario,
  toggleUsuarioActivo
} from '../controllers/adminController.ts';
import {
  getSectores,
  createSector,
  updateSector,
  deleteSector,
  getSocios,
  getSocioById,
  getSocioEstadoCuenta,
  getSocioDeudas,
  createSocio,
  updateSocio,
  deleteSocio,
  getMedidores,
  getMedidoresBySocio,
  getMedidorById,
  createMedidor,
  getMedidorDeudas,
  getMedidoresDeudas,
  addMedidorToSocio,
  updateMedidor,
  deleteMedidor,
  getPeriodos,
  createPeriodo,
  cerrarPeriodo,
  avanzarPeriodo,
  getLecturas,
  getLecturaById,
  registrarLectura,
  sincronizarLecturasBatch,
  updateLectura,
  deleteLectura,
  getFacturas,
  getFacturaById,
  liquidarFactura,
  liquidarPeriodo,
  pasarLecturasACaja,
  cobrarFactura,
  deleteFactura,
  sincronizarFacturas,
  getMultas,
  crearMulta,
  updateMulta,
  deleteMulta,
  getRubroAbonos,
  getFacturaAbonos,
  inscribirSocio,
  reconectarSocio
} from '../controllers/waterController.ts';
import {
  getFondosCatalogo,
  getFondoById,
  updateFondo,
  getLibroMayor3Columnas,
  getMovimientoById,
  registrarEgreso,
  updateMovimiento,
  deleteMovimiento,
  getBalanceFondosResumen,
  getLiquidacionPadreParroquia,
  sincronizarAsientosContablesFacturas
} from '../controllers/financeController.ts';
import {
  getReporteMorosidad,
  getReportePorSector,
  getReporteConsolidado,
  getReporteAuditoria,
  getEstadoCuentaSocio
} from '../controllers/reportesController.ts';

import { supabaseClient } from '../db/supabase.ts';
export const apiRouter = new Router();

// ==========================================
// 1. HEALTH CHECK Y ESTADO
// ==========================================
apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    sistema: 'SIGA-Comunitario (App Agua Backend)',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    supabase: supabaseClient.isEnabled() ? 'CONNECTED' : 'DISCONNECTED'
  });
});

// ==========================================
// 2. AUTENTICACIÓN
// ==========================================
apiRouter.post('/auth/login', login);
apiRouter.get('/auth/me', authenticateJWT, getMe);
apiRouter.post('/auth/register', authenticateJWT, requireRoles('ADMIN'), register);

// ==========================================
// 3. ADMINISTRACIÓN Y GOBERNANZA (ADMIN ONLY)
// ==========================================
apiRouter.get('/admin/tarifas', authenticateJWT, requireRoles('ADMIN', 'CAJERO'), getTarifasConfig);
apiRouter.put('/admin/tarifas', authenticateJWT, requireRoles('ADMIN'), updateTarifasConfig);
apiRouter.get('/admin/usuarios', authenticateJWT, requireRoles('ADMIN'), getUsuarios);
apiRouter.post('/admin/usuarios', authenticateJWT, requireRoles('ADMIN'), createUsuario);
apiRouter.put('/admin/usuarios/:id', authenticateJWT, requireRoles('ADMIN'), updateUsuario);
apiRouter.delete('/admin/usuarios/:id', authenticateJWT, requireRoles('ADMIN'), deleteUsuario);
apiRouter.patch('/admin/usuarios/:id/toggle', authenticateJWT, requireRoles('ADMIN'), toggleUsuarioActivo);

// ==========================================
// 4. SECTORES
// ==========================================
apiRouter.get('/sectores', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getSectores);
apiRouter.get('/water/sectores', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getSectores);
apiRouter.post('/sectores', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), createSector);
apiRouter.put('/sectores/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), updateSector);
apiRouter.delete('/sectores/:id', authenticateJWT, requireRoles('ADMIN'), deleteSector);

// ==========================================
// 5. PADRÓN DE SOCIOS (CAJERO OPERADOR INTEGRAL)
// ==========================================
apiRouter.get('/socios', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getSocios);
apiRouter.get('/socios/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getSocioById);
apiRouter.get('/socios/:id/estado-cuenta', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), getSocioEstadoCuenta);
apiRouter.get('/socios/:id/deudas', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR', 'AUDITOR'), getSocioDeudas);
apiRouter.post('/socios/inscribir', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), inscribirSocio);
apiRouter.post('/socios/:id/reconectar', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), reconectarSocio);
apiRouter.post('/socios', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), createSocio);
apiRouter.put('/socios/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), updateSocio);
apiRouter.delete('/socios/:id', authenticateJWT, requireRoles('ADMIN'), deleteSocio);
apiRouter.get('/socios/:id/medidores', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getMedidoresBySocio);
apiRouter.post('/socios/:id/medidores', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), addMedidorToSocio);
apiRouter.put('/socios/:id/medidores/:medidorId', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), updateMedidor);

// ==========================================
// 5.1. MEDIDORES (ACOMETIDAS / MULTI-MEDIDOR / DEUDAS)
// ==========================================
apiRouter.get('/medidores', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getMedidores);
apiRouter.post('/medidores', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), createMedidor);
apiRouter.get('/medidores/deudas', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR', 'AUDITOR'), getMedidoresDeudas);
apiRouter.get('/medidores/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getMedidorById);
apiRouter.get('/medidores/:id/deudas', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR', 'AUDITOR'), getMedidorDeudas);
apiRouter.put('/medidores/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), updateMedidor);
apiRouter.delete('/medidores/:id', authenticateJWT, requireRoles('ADMIN'), deleteMedidor);
apiRouter.delete('/socios/:id/medidores/:medidorId', authenticateJWT, requireRoles('ADMIN'), deleteMedidor);

// ==========================================
// 6. PERÍODOS DE FACTURACIÓN
// ==========================================
apiRouter.get('/periodos', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getPeriodos);
apiRouter.post('/periodos', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), createPeriodo);
apiRouter.post('/periodos/avanzar', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), avanzarPeriodo);
apiRouter.post('/periodos/:id/avanzar', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), avanzarPeriodo);
apiRouter.post('/periodos/:id/cerrar', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), cerrarPeriodo);
apiRouter.post('/periodos/:id/cerrar-ciclo', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), cerrarPeriodo);

// ==========================================
// 7. MICROMEDICIÓN Y LECTURAS
// ==========================================
apiRouter.get('/lecturas', authenticateJWT, requireRoles('LECTOR', 'CAJERO', 'ADMIN'), getLecturas);
apiRouter.get('/lecturas/:id', authenticateJWT, requireRoles('LECTOR', 'CAJERO', 'ADMIN'), getLecturaById);
apiRouter.post('/lecturas', authenticateJWT, requireRoles('LECTOR', 'CAJERO', 'ADMIN'), registrarLectura);
apiRouter.post('/lecturas/sincronizar', authenticateJWT, requireRoles('LECTOR', 'CAJERO', 'ADMIN'), sincronizarLecturasBatch);
apiRouter.put('/lecturas/:id', authenticateJWT, requireRoles('LECTOR', 'CAJERO', 'ADMIN'), updateLectura);
apiRouter.delete('/lecturas/:id', authenticateJWT, requireRoles('ADMIN'), deleteLectura);

// ==========================================
// 8. FACTURACIÓN Y COBROS EN CAJA
// ==========================================
apiRouter.get('/facturas', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), getFacturas);
apiRouter.get('/facturas/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), getFacturaById);
apiRouter.post('/facturas/liquidar', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), liquidarFactura);
apiRouter.post('/facturas/liquidar-periodo', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), liquidarPeriodo);
apiRouter.post('/facturas/pasar-a-caja', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), pasarLecturasACaja);
apiRouter.post('/facturas/:id/cobrar', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), cobrarFactura);
apiRouter.post('/caja/cobrar/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), cobrarFactura);
apiRouter.post('/caja/liquidar', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), liquidarFactura);
apiRouter.post('/facturas/sincronizar', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), sincronizarFacturas);
apiRouter.delete('/facturas/:id', authenticateJWT, requireRoles('ADMIN'), deleteFactura);
apiRouter.get('/facturas/:id/abonos', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getFacturaAbonos);

// ==========================================
// 9. MULTAS Y CUOTAS EXTRAORDINARIAS
// ==========================================
apiRouter.get('/multas', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), getMultas);
apiRouter.post('/multas', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), crearMulta);
apiRouter.put('/multas/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), updateMulta);
apiRouter.delete('/multas/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), deleteMulta);
apiRouter.get('/multas/:id/abonos', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getRubroAbonos);
apiRouter.get('/rubros/:id/abonos', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getRubroAbonos);

// ==========================================
// 10. CONTRALORÍA Y LIBRO MAYOR (3 COLUMNAS)
// ==========================================
apiRouter.get('/fondos', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getFondosCatalogo);
apiRouter.get('/fondos/balance', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getBalanceFondosResumen);
apiRouter.get('/fondos/liquidacion-padre', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getLiquidacionPadreParroquia);
apiRouter.get('/fondos/libro-mayor', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getLibroMayor3Columnas);
apiRouter.post('/fondos/sincronizar-asientos', authenticateJWT, requireRoles('ADMIN'), sincronizarAsientosContablesFacturas);
apiRouter.post('/fondos/movimientos/sincronizar-asientos', authenticateJWT, requireRoles('ADMIN'), sincronizarAsientosContablesFacturas);
apiRouter.get('/fondos/movimientos', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getLibroMayor3Columnas);
apiRouter.post('/fondos/movimientos', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), registrarEgreso);
apiRouter.post('/fondos/egreso', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), registrarEgreso);
apiRouter.post('/fondos/egresos', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), registrarEgreso);
apiRouter.get('/fondos/movimientos/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getMovimientoById);
apiRouter.put('/fondos/movimientos/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), updateMovimiento);
apiRouter.delete('/fondos/movimientos/:id', authenticateJWT, requireRoles('ADMIN'), deleteMovimiento);
apiRouter.get('/fondos/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getFondoById);
apiRouter.put('/fondos/:id', authenticateJWT, requireRoles('ADMIN'), updateFondo);

// ==========================================
// 11. REPORTES Y AUDITORÍA
// ==========================================
apiRouter.get('/reportes/morosidad', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getReporteMorosidad);
apiRouter.get('/reportes/por-sector', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getReportePorSector);
apiRouter.get('/reportes/consolidado', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getReporteConsolidado);
apiRouter.get('/reportes/auditoria', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getReporteAuditoria);
apiRouter.get('/reportes/socio/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getEstadoCuentaSocio);

// ==========================================
// 12. SINCRONIZACIÓN OFFLINE-FIRST (OUTBOX BATCH)
// ==========================================
apiRouter.use('/sync', syncRouter);

// Compatibilidad con contratos iniciales
apiRouter.get('/water/clientes', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getSocios);
apiRouter.get('/water/lecturas', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getLecturas);
apiRouter.get('/water/cobros', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), getFacturas);
apiRouter.get('/finance/movimientos', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getLibroMayor3Columnas);
apiRouter.get('/finance/balance', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getBalanceFondosResumen);
