import { db } from '../db/indexedDB.ts';
import { syncEngine } from './outboxEngine.ts';
import type {
  SocioAgua,
  Sector,
  EstadoServicio,
  EstadoCuenta
} from '@app-agua/shared';
import { TARIFAS_CONFIG } from '@app-agua/shared';

export interface SocioFiltros {
  busqueda?: string; // Por cédula o nombre
  sectorId?: string;
  estadoServicio?: EstadoServicio | 'TODOS';
  esTerceraEdad?: boolean | 'TODOS';
  estadoCuenta?: EstadoCuenta | 'TODOS';
  tieneAlcantarillado?: boolean | 'TODOS';
}

export interface EstadisticasSocios {
  total: number;
  activos: number;
  suspendidos: number;
  cortados: number;
  terceraEdad: number;
  conAlcantarillado: number;
  enMora: number;
  alDia: number;
  montoTotalCarteraVencida: number;
}

/**
 * Calcula la edad en años completos a partir de la fecha de nacimiento (YYYY-MM-DD).
 */
export function calcularEdad(fechaNacimiento: string): number {
  if (!fechaNacimiento) return 0;
  const hoy = new Date();
  const fechaNac = new Date(fechaNacimiento);
  if (isNaN(fechaNac.getTime())) return 0;

  let edad = hoy.getFullYear() - fechaNac.getFullYear();
  const mesActual = hoy.getMonth();
  const mesNac = fechaNac.getMonth();

  if (mesActual < mesNac || (mesActual === mesNac && hoy.getDate() < fechaNac.getDate())) {
    edad--;
  }
  return Math.max(0, edad);
}

/**
 * Evalúa si una persona es considerada de la Tercera Edad (>= 65 años).
 */
export function esTerceraEdad(fechaNacimiento: string): boolean {
  const edad = calcularEdad(fechaNacimiento);
  return edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
}

/**
 * Calcula la tarifa base mensual según condición de 3ra edad y alcantarillado:
 * - Normal: $7.00
 * - 3ra Edad: $5.00
 * - Alcantarillado: +$1.00
 */
export function calcularTarifaBaseEstimada(
  esTerceraEdadFlag: boolean,
  tieneAlcantarilladoFlag: boolean
): number {
  const base = esTerceraEdadFlag ? TARIFAS_CONFIG.BASE_TERCERA_EDAD : TARIFAS_CONFIG.BASE_NORMAL;
  const alcantarillado = tieneAlcantarilladoFlag ? TARIFAS_CONFIG.RECARGO_ALCANTARILLADO : 0;
  return Number((base + alcantarillado).toFixed(2));
}

/**
 * Validador básico de formato de cédula ecuatoriana (10 dígitos numéricos con algoritmo módulo 10).
 */
export function validarCedulaEcuatoriana(cedula: string): { valida: boolean; mensaje?: string } {
  const limpia = (cedula || '').trim();
  if (!limpia) return { valida: false, mensaje: 'La cédula es obligatoria' };
  if (!/^\d{10}$/.test(limpia)) {
    return { valida: false, mensaje: 'La cédula debe contener exactamente 10 dígitos numéricos' };
  }

  const digitoRegion = parseInt(limpia.substring(0, 2), 10);
  if (digitoRegion < 1 || (digitoRegion > 24 && digitoRegion !== 30)) {
    return { valida: false, mensaje: 'Código de provincia/región no válido' };
  }

  const tercerDigito = parseInt(limpia.charAt(2), 10);
  if (tercerDigito >= 6) {
    // Para personas naturales el 3er dígito debe ser < 6
    return { valida: false, mensaje: 'Formato de cédula de persona natural inválido' };
  }

  // Algoritmo Módulo 10
  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  const digitoVerificador = parseInt(limpia.charAt(9), 10);
  let suma = 0;

  for (let i = 0; i < 9; i++) {
    let valor = parseInt(limpia.charAt(i), 10) * coeficientes[i];
    if (valor >= 10) valor -= 9;
    suma += valor;
  }

  const digitoCalculado = (10 - (suma % 10)) % 10;
  if (digitoCalculado !== digitoVerificador) {
    return { valida: false, mensaje: 'El número de cédula no supera el dígito verificador' };
  }

  return { valida: true };
}

export class SocioService {
  /**
   * Obtiene la lista completa de sectores comunitarios.
   */
  public async getSectores(): Promise<Sector[]> {
    return await db.sectores.toArray();
  }

  /**
   * Obtiene todos los socios aplicando filtros en memoria indexada local.
   */
  public async getSocios(filtros: SocioFiltros = {}): Promise<SocioAgua[]> {
    let socios = await db.socios.toArray();

    // Actualización dinámica: reevaluar edad y condición de 3ra edad al consultar
    socios = socios.map((s) => {
      const edad = calcularEdad(s.fechaNacimiento);
      const terceraEdad = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
      const tarifa = calcularTarifaBaseEstimada(terceraEdad, s.tieneAlcantarillado);
      return {
        ...s,
        edadCalculada: edad,
        esTerceraEdad: terceraEdad,
        tarifaBaseMensual: tarifa
      };
    });

    if (filtros.busqueda && filtros.busqueda.trim() !== '') {
      const q = filtros.busqueda.toLowerCase().trim();
      socios = socios.filter(
        (s) =>
          s.nombreCompleto.toLowerCase().includes(q) ||
          s.cedulaRuc.toLowerCase().includes(q) ||
          s.codigoSocio.toLowerCase().includes(q) ||
          (s.medidorNumero && s.medidorNumero.toLowerCase().includes(q))
      );
    }

    if (filtros.sectorId && filtros.sectorId !== 'TODOS') {
      socios = socios.filter((s) => s.sectorId === filtros.sectorId);
    }

    if (filtros.estadoServicio && filtros.estadoServicio !== 'TODOS') {
      socios = socios.filter((s) => s.estadoServicio === filtros.estadoServicio);
    }

    if (filtros.esTerceraEdad !== undefined && filtros.esTerceraEdad !== 'TODOS') {
      socios = socios.filter((s) => s.esTerceraEdad === filtros.esTerceraEdad);
    }

    if (filtros.estadoCuenta && filtros.estadoCuenta !== 'TODOS') {
      socios = socios.filter((s) => s.estadoCuenta === filtros.estadoCuenta);
    }

    if (filtros.tieneAlcantarillado !== undefined && filtros.tieneAlcantarillado !== 'TODOS') {
      socios = socios.filter((s) => s.tieneAlcantarillado === filtros.tieneAlcantarillado);
    }

    return socios.sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto));
  }

  /**
   * Obtiene un socio por ID.
   */
  public async getSocioById(id: string): Promise<SocioAgua | undefined> {
    const socio = await db.socios.get(id);
    if (!socio) return undefined;

    const edad = calcularEdad(socio.fechaNacimiento);
    const terceraEdad = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
    const tarifa = calcularTarifaBaseEstimada(terceraEdad, socio.tieneAlcantarillado);

    return {
      ...socio,
      edadCalculada: edad,
      esTerceraEdad: terceraEdad,
      tarifaBaseMensual: tarifa
    };
  }

  /**
   * Registra un nuevo socio localmente y encola la mutación para sincronización.
   */
  public async crearSocio(
    datos: Omit<SocioAgua, 'id' | 'edadCalculada' | 'esTerceraEdad' | 'tarifaBaseMensual' | 'createdAt' | 'updatedAt' | 'version'>
  ): Promise<SocioAgua> {
    // Validar cédula única
    const existente = await db.socios.where('cedulaRuc').equals(datos.cedulaRuc.trim()).first();
    if (existente) {
      throw new Error(`Ya existe un socio registrado con la cédula ${datos.cedulaRuc}`);
    }

    const id = crypto.randomUUID();
    const edad = calcularEdad(datos.fechaNacimiento);
    const terceraEdad = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
    const tarifa = calcularTarifaBaseEstimada(terceraEdad, datos.tieneAlcantarillado);
    const now = new Date().toISOString();

    const nuevoSocio: SocioAgua = {
      ...datos,
      id,
      nombreCompleto: `${datos.nombres.trim()} ${datos.apellidos.trim()}`,
      edadCalculada: edad,
      esTerceraEdad: terceraEdad,
      tarifaBaseMensual: tarifa,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    await db.socios.add(nuevoSocio);
    await syncEngine.enqueueMutation('CLIENT', id, 'CREATE', nuevoSocio);

    return nuevoSocio;
  }

  /**
   * Actualiza un socio existente.
   */
  public async actualizarSocio(
    id: string,
    datos: Partial<Omit<SocioAgua, 'id' | 'createdAt' | 'version'>>
  ): Promise<SocioAgua> {
    const actual = await db.socios.get(id);
    if (!actual) throw new Error('Socio no encontrado');

    if (datos.cedulaRuc && datos.cedulaRuc !== actual.cedulaRuc) {
      const duplicado = await db.socios.where('cedulaRuc').equals(datos.cedulaRuc.trim()).first();
      if (duplicado && duplicado.id !== id) {
        throw new Error(`Ya existe otro socio registrado con la cédula ${datos.cedulaRuc}`);
      }
    }

    const fechaNac = datos.fechaNacimiento || actual.fechaNacimiento;
    const edad = calcularEdad(fechaNac);
    const terceraEdad = edad >= TARIFAS_CONFIG.EDAD_TERCERA_EDAD;
    const tieneAlcant = datos.tieneAlcantarillado !== undefined ? datos.tieneAlcantarillado : actual.tieneAlcantarillado;
    const tarifa = calcularTarifaBaseEstimada(terceraEdad, tieneAlcant);
    const nombres = datos.nombres || actual.nombres;
    const apellidos = datos.apellidos || actual.apellidos;
    const now = new Date().toISOString();

    const actualizado: SocioAgua = {
      ...actual,
      ...datos,
      nombres,
      apellidos,
      nombreCompleto: `${nombres.trim()} ${apellidos.trim()}`,
      edadCalculada: edad,
      esTerceraEdad: terceraEdad,
      tarifaBaseMensual: tarifa,
      updatedAt: now,
      version: actual.version + 1
    };

    await db.socios.put(actualizado);
    await syncEngine.enqueueMutation('CLIENT', id, 'UPDATE', actualizado);

    return actualizado;
  }

  /**
   * Cambia el estado del servicio del socio (ACTIVO, SUSPENDIDO, CORTADO).
   */
  public async cambiarEstadoServicio(id: string, nuevoEstado: EstadoServicio): Promise<void> {
    const socio = await db.socios.get(id);
    if (!socio) throw new Error('Socio no encontrado');

    socio.estadoServicio = nuevoEstado;
    socio.updatedAt = new Date().toISOString();
    socio.version += 1;

    await db.socios.put(socio);
    await syncEngine.enqueueMutation('CLIENT', id, 'UPDATE', socio);
  }

  /**
   * Calcula estadísticas y métricas del padrón de socios.
   */
  public async getEstadisticas(): Promise<EstadisticasSocios> {
    const socios = await this.getSocios();

    let activos = 0;
    let suspendidos = 0;
    let cortados = 0;
    let terceraEdad = 0;
    let conAlcantarillado = 0;
    let enMora = 0;
    let alDia = 0;
    let montoTotalCarteraVencida = 0;

    for (const s of socios) {
      if (s.estadoServicio === 'ACTIVO') activos++;
      if (s.estadoServicio === 'SUSPENDIDO') suspendidos++;
      if (s.estadoServicio === 'CORTADO') cortados++;

      if (s.esTerceraEdad) terceraEdad++;
      if (s.tieneAlcantarillado) conAlcantarillado++;

      if (s.estadoCuenta === 'EN_MORA') {
        enMora++;
        montoTotalCarteraVencida += s.montoTotalAdeudado || 0;
      } else {
        alDia++;
      }
    }

    return {
      total: socios.length,
      activos,
      suspendidos,
      cortados,
      terceraEdad,
      conAlcantarillado,
      enMora,
      alDia,
      montoTotalCarteraVencida: Number(montoTotalCarteraVencida.toFixed(2))
    };
  }
}

export const socioService = new SocioService();
