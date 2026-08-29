import { Router } from '../core/http.ts';
import { syncRouter } from './syncRoutes.ts';
import { authenticateJWT, requireRoles } from '../middlewares/auth.ts';
import { login, register, getMe } from '../controllers/authController.ts';
import {
  getTarifasConfig,
  updateTarifasConfig,
  getUsuarios,
  toggleUsuarioActivo
} from '../controllers/adminController.ts';
import {
  getSectores,
  createSector,
  getSocios,
  getSocioById,
  getSocioEstadoCuenta,
  createSocio,
  updateSocio,
  getPeriodos,
  createPeriodo,
  cerrarPeriodo,
  getLecturas,
  registrarLectura,
  getFacturas,
  getFacturaById,
  liquidarFactura,
  liquidarPeriodo,
  cobrarFactura,
  getMultas,
  crearMulta
} from '../controllers/waterController.ts';
import {
  getFondosCatalogo,
  getLibroMayor3Columnas,
  registrarEgreso,
  getBalanceFondosResumen,
  getLiquidacionPadreParroquia
} from '../controllers/financeController.ts';
import {
  getReporteMorosidad,
  getReportePorSector,
  getReporteConsolidado
} from '../controllers/reportesController.ts';

export const apiRouter = new Router();

// ==========================================
// 1. HEALTH CHECK Y ESTADO
// ==========================================
apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    sistema: 'SIGA-Comunitario (App Agua Backend)',
    version: '1.0.0',
    timestamp: new Date().toISOString()
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
apiRouter.patch('/admin/usuarios/:id/toggle', authenticateJWT, requireRoles('ADMIN'), toggleUsuarioActivo);

// ==========================================
// 4. SECTORES
// ==========================================
apiRouter.get('/sectores', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getSectores);
apiRouter.post('/sectores', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), createSector);

// ==========================================
// 5. PADRÓN DE SOCIOS (CAJERO OPERADOR INTEGRAL)
// ==========================================
apiRouter.get('/socios', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getSocios);
apiRouter.get('/socios/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getSocioById);
apiRouter.get('/socios/:id/estado-cuenta', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), getSocioEstadoCuenta);
apiRouter.post('/socios', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), createSocio);
apiRouter.put('/socios/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), updateSocio);

// ==========================================
// 6. PERÍODOS DE FACTURACIÓN
// ==========================================
apiRouter.get('/periodos', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'LECTOR'), getPeriodos);
apiRouter.post('/periodos', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), createPeriodo);
apiRouter.post('/periodos/:id/cerrar', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), cerrarPeriodo);

// ==========================================
// 7. MICROMEDICIÓN Y LECTURAS
// ==========================================
apiRouter.get('/lecturas', authenticateJWT, requireRoles('LECTOR', 'CAJERO', 'ADMIN'), getLecturas);
apiRouter.post('/lecturas', authenticateJWT, requireRoles('LECTOR', 'CAJERO', 'ADMIN'), registrarLectura);

// ==========================================
// 8. FACTURACIÓN Y COBROS EN CAJA
// ==========================================
apiRouter.get('/facturas', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), getFacturas);
apiRouter.get('/facturas/:id', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), getFacturaById);
apiRouter.post('/facturas/liquidar', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), liquidarFactura);
apiRouter.post('/facturas/liquidar-periodo', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), liquidarPeriodo);
apiRouter.post('/facturas/:id/cobrar', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), cobrarFactura);

// ==========================================
// 9. MULTAS Y CUOTAS EXTRAORDINARIAS
// ==========================================
apiRouter.get('/multas', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), getMultas);
apiRouter.post('/multas', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), crearMulta);

// ==========================================
// 10. CONTRALORÍA Y LIBRO MAYOR (3 COLUMNAS)
// ==========================================
apiRouter.get('/fondos', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getFondosCatalogo);
apiRouter.get('/fondos/libro-mayor', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getLibroMayor3Columnas);
apiRouter.post('/fondos/egresos', authenticateJWT, requireRoles('CAJERO', 'ADMIN'), registrarEgreso);
apiRouter.get('/fondos/balance', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getBalanceFondosResumen);
apiRouter.get('/fondos/liquidacion-padre', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getLiquidacionPadreParroquia);

// ==========================================
// 11. REPORTES Y AUDITORÍA
// ==========================================
apiRouter.get('/reportes/morosidad', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getReporteMorosidad);
apiRouter.get('/reportes/por-sector', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getReportePorSector);
apiRouter.get('/reportes/consolidado', authenticateJWT, requireRoles('CAJERO', 'ADMIN', 'AUDITOR'), getReporteConsolidado);

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
