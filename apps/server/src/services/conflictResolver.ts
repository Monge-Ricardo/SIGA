import type { SyncMutation, SyncAck } from '../shared.ts';
import { socioService } from './socioService.ts';
import { lecturaService } from './lecturaService.ts';
import { facturacionService } from './facturacionService.ts';
import { fondosService } from './fondosService.ts';

export interface ConflictResolution<T = unknown> {
  ack: SyncAck;
  finalState?: T;
}

export class ConflictResolver {
  public static processMutation(mutation: SyncMutation): SyncAck {
    try {
      const { entity, action, entityId, payload, version } = mutation;
      const record = payload as Record<string, unknown>;

      switch (entity) {
        case 'clientes': {
          if (action === 'CREATE') {
            socioService.createSocio({
              codigoSocio: (record.codigoCliente || record.codigoSocio) as string,
              nombres: record.nombres as string || (record.nombreCompleto as string)?.split(' ')[0] || '',
              apellidos: record.apellidos as string || (record.nombreCompleto as string)?.split(' ').slice(1).join(' ') || '',
              cedulaRuc: (record.identificacion || record.cedulaRuc) as string,
              fechaNacimiento: (record.fechaNacimiento as string) || '1980-01-01',
              idSector: (record.sectorId || record.idSector) as string,
              medidorNumero: (record.medidorNumero as string) || `MED-${entityId.slice(-4)}`,
              tieneAlcantarillado: Boolean(record.tieneAlcantarillado),
              telefono: record.telefono as string,
              direccion: (record.direccion as string) || 'Comunidad'
            });
          } else if (action === 'UPDATE') {
            socioService.updateSocio(entityId, {
              nombres: record.nombres as string,
              apellidos: record.apellidos as string,
              direccion: record.direccion as string,
              telefono: record.telefono as string
            });
          }
          break;
        }

        case 'lecturas': {
          if (action === 'CREATE' || action === 'UPDATE') {
            lecturaService.registrarLectura({
              idSocio: (record.clienteId || record.idSocio) as string,
              idPeriodo: (record.periodo || record.idPeriodo) as string,
              lecturaActual: (record.lecturaActual as number) || 0,
              lecturaAnterior: record.lecturaAnterior as number,
              idLector: (record.lectorResponsableId || record.idLector) as string || 'offline-lector',
              observaciones: record.observaciones as string
            });
          }
          break;
        }

        case 'cobros': {
          if (action === 'CREATE' || action === 'UPDATE') {
            const facturaId = (record.id || entityId) as string;
            const facturaExistente = facturacionService.getFacturaById(facturaId);
            if (facturaExistente && facturaExistente.estadoPago !== 'PAGADO') {
              facturacionService.cobrarFactura(facturaId, {
                metodoPago: (record.metodoPago as 'EFECTIVO' | 'TRANSFERENCIA' | 'MOVIL') || 'EFECTIVO',
                idCajero: (record.cajeroResponsableId || record.idCajero) as string || 'offline-cajero',
                fechaPago: record.fechaPago as string
              });
            }
          }
          break;
        }

        case 'movimientos_caja': {
          if (action === 'CREATE') {
            const fondo = fondosService.getFondoByCodigo('OPERACION_MANT');
            if (fondo) {
              fondosService.registrarMovimiento({
                idFondo: fondo.id,
                concepto: (record.descripcion as string) || 'Movimiento offline',
                tipo: (record.tipo as 'ENTRADA' | 'SALIDA') === 'SALIDA' ? 'EGRESO' : 'INGRESO',
                monto: (record.monto as number) || 0,
                idResponsable: (record.responsableId as string) || 'offline-user',
                fecha: record.fecha as string
              });
            }
          }
          break;
        }
      }

      return {
        mutationId: mutation.id,
        entityId: mutation.entityId,
        status: 'ACCEPTED',
        serverVersion: version || 1
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al procesar mutación';
      console.warn(`[ConflictResolver] Advertencia procesando mutación ${mutation.id}:`, message);
      return {
        mutationId: mutation.id,
        entityId: mutation.entityId,
        status: 'CONFLICT_RESOLVED',
        serverVersion: mutation.version || 1,
        error: message
      };
    }
  }

  public static resolveLWW<T = unknown>(clientMutation: SyncMutation<T>, _serverState?: T): ConflictResolution<T> {
    const ack = this.processMutation(clientMutation as SyncMutation);
    return {
      ack,
      finalState: clientMutation.payload
    };
  }
}
