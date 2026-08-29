import Dexie, { type Table } from 'dexie';
import type {
  SocioAgua,
  Sector,
  LecturaMedidor,
  CobroRecibo,
  MovimientoCaja,
  SyncMutation
} from '@app-agua/shared';

export interface AppMetadata {
  key: string;
  value: unknown;
}

export class AppAguaDatabase extends Dexie {
  socios!: Table<SocioAgua, string>;
  sectores!: Table<Sector, string>;
  lecturas!: Table<LecturaMedidor, string>;
  cobros!: Table<CobroRecibo, string>;
  movimientos_caja!: Table<MovimientoCaja, string>;
  sync_queue!: Table<SyncMutation, string>;
  metadata!: Table<AppMetadata, string>;

  // Alias para retrocompatibilidad
  get clientes(): Table<SocioAgua, string> {
    return this.socios;
  }

  constructor() {
    super('AppAguaLocalDB');

    // Esquema de persistencia local optimizado para bajo consumo (<50ms)
    this.version(2).stores({
      socios: 'id, codigoSocio, cedulaRuc, nombreCompleto, sectorId, estadoServicio, esTerceraEdad, estadoCuenta, updatedAt',
      sectores: 'id, codigo, nombre',
      lecturas: 'id, clienteId, periodo, fechaLectura, updatedAt',
      cobros: 'id, numeroRecibo, clienteId, periodo, estado, fechaVencimiento',
      movimientos_caja: 'id, tipo, categoria, fecha, responsableId',
      sync_queue: 'id, entity, status, localTimestamp, retryCount',
      metadata: 'key'
    });
  }
}

export const db = new AppAguaDatabase();

export async function seedInitialDatabaseIfEmpty() {
  const countSectores = await db.sectores.count();
  if (countSectores === 0) {
    const sectoresIniciales: Sector[] = [
      { id: 'sec-01', codigo: 'SEC-01', nombre: 'Sector Centro', descripcion: 'Zona urbana central' },
      { id: 'sec-02', codigo: 'SEC-02', nombre: 'Sector Loma Alta', descripcion: 'Zona alta con bombeo secundario' },
      { id: 'sec-03', codigo: 'SEC-03', nombre: 'Sector El Carmen', descripcion: 'Zona residencial' },
      { id: 'sec-04', codigo: 'SEC-04', nombre: 'Sector Río Blanco', descripcion: 'Zona baja ribereña' },
      { id: 'sec-05', codigo: 'SEC-05', nombre: 'Sector San José', descripcion: 'Zona rural extendida' }
    ];
    await db.sectores.bulkAdd(sectoresIniciales);
    console.log('[DB] Sectores comunitarios sembrados.');
  }

  const countSocios = await db.socios.count();
  if (countSocios === 0) {
    const sociosEjemplo: SocioAgua[] = [
      {
        id: 'soc-001',
        codigoSocio: 'SEC-01-001',
        nombres: 'José Alberto',
        apellidos: 'Luna Morales',
        nombreCompleto: 'José Alberto Luna Morales',
        cedulaRuc: '0923456781',
        fechaNacimiento: '1984-05-14', // 42 años -> Normal ($7.00)
        edadCalculada: 42,
        esTerceraEdad: false,
        fechaAfiliacion: '2018-03-10',
        sectorId: 'sec-01',
        nombreSector: 'Sector Centro',
        direccion: 'Calle Principal y Av. Central #102',
        telefono: '0991234567',
        medidorNumero: 'MED-10492',
        tieneAlcantarillado: true, // +$1.00 -> Base $8.00
        estadoServicio: 'ACTIVO',
        estadoCuenta: 'EN_MORA',
        mesesAdeudados: 2,
        montoTotalAdeudado: 16.00,
        fechaDeudaAntigua: '2026-06-01',
        tarifaBaseMensual: 8.00,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      },
      {
        id: 'soc-002',
        codigoSocio: 'SEC-01-002',
        nombres: 'Rosa María',
        apellidos: 'Gómez Zambrano',
        nombreCompleto: 'Rosa María Gómez Zambrano',
        cedulaRuc: '0912345678',
        fechaNacimiento: '1954-11-20', // 71 años -> 3ra Edad ($5.00)
        edadCalculada: 71,
        esTerceraEdad: true,
        fechaAfiliacion: '2015-01-15',
        sectorId: 'sec-01',
        nombreSector: 'Sector Centro',
        direccion: 'Av. Las Palmas #45',
        telefono: '0987654321',
        medidorNumero: 'MED-10493',
        tieneAlcantarillado: true, // +$1.00 -> Base $6.00
        estadoServicio: 'ACTIVO',
        estadoCuenta: 'AL_DIA',
        mesesAdeudados: 0,
        montoTotalAdeudado: 0.00,
        tarifaBaseMensual: 6.00,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      },
      {
        id: 'soc-003',
        codigoSocio: 'SEC-02-015',
        nombres: 'Carlos Manuel',
        apellidos: 'Vera Benítez',
        nombreCompleto: 'Carlos Manuel Vera Benítez',
        cedulaRuc: '1723456789',
        fechaNacimiento: '1990-08-10', // 36 años -> Normal ($7.00)
        edadCalculada: 36,
        esTerceraEdad: false,
        fechaAfiliacion: '2021-06-20',
        sectorId: 'sec-02',
        nombreSector: 'Sector Loma Alta',
        direccion: 'Loma Alta s/n',
        telefono: '0978901234',
        medidorNumero: 'MED-20114',
        tieneAlcantarillado: false, // $0.00 -> Base $7.00
        estadoServicio: 'ACTIVO',
        estadoCuenta: 'AL_DIA',
        mesesAdeudados: 0,
        montoTotalAdeudado: 0.00,
        tarifaBaseMensual: 7.00,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      },
      {
        id: 'soc-004',
        codigoSocio: 'SEC-03-008',
        nombres: 'Manuel Antonio',
        apellidos: 'Mendoza Castillo',
        nombreCompleto: 'Manuel Antonio Mendoza Castillo',
        cedulaRuc: '0908765432',
        fechaNacimiento: '1950-02-18', // 76 años -> 3ra Edad ($5.00)
        edadCalculada: 76,
        esTerceraEdad: true,
        fechaAfiliacion: '2012-09-05',
        sectorId: 'sec-03',
        nombreSector: 'Sector El Carmen',
        direccion: 'Barrio El Carmen, Manzana D',
        telefono: '0965432109',
        medidorNumero: 'MED-30045',
        tieneAlcantarillado: false, // $0.00 -> Base $5.00
        estadoServicio: 'SUSPENDIDO',
        estadoCuenta: 'EN_MORA',
        mesesAdeudados: 4,
        montoTotalAdeudado: 20.00,
        fechaDeudaAntigua: '2026-04-01',
        tarifaBaseMensual: 5.00,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      }
    ];
    await db.socios.bulkAdd(sociosEjemplo);
    console.log('[DB] Socios de ejemplo sembrados.');
  }
}

