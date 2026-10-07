import type { AnularCobroRequestDTO } from '../domain/CajaDTOs.ts';
import { SupabaseCajaRepository } from '../infrastructure/SupabaseCajaRepository.ts';

export class AnularCobroUseCase {
  private readonly repo: SupabaseCajaRepository;

  constructor(repo: SupabaseCajaRepository = new SupabaseCajaRepository()) {
    this.repo = repo;
  }

  /**
   * Anula un cobro previamente registrado y revierte el estado a PENDIENTE
   * Cumple con RF-CAJ-12, RN-15, RN-16
   */
  public async ejecutar(dto: AnularCobroRequestDTO): Promise<{
    success: boolean;
    mensaje: string;
    idFactura: string;
    numeroFactura: string;
    montoRevertido: number;
  }> {
    if (!dto.idFactura || !dto.idFactura.trim()) {
      throw new Error('Debe proporcionar el ID o número de factura a anular');
    }
    if (!dto.motivo || !dto.motivo.trim()) {
      throw new Error('Debe especificar una justificación obligatoria para la anulación');
    }

    // 1. Obtener la factura de la base de datos
    const factura = await this.repo.getFacturaPorIdONumero(dto.idFactura.trim());
    if (!factura) {
      // Verificar si es un número de comprobante registrado en fondos_movimientos (ej: REC-...)
      const movs = typeof this.repo.getMovimientosPorComprobante === 'function'
        ? await this.repo.getMovimientosPorComprobante(dto.idFactura.trim())
        : [];
      if (movs && movs.length > 0) {
        const montoRevertido = movs.reduce((sum, m) => sum + Number(m.ingreso || 0), 0);
        await this.repo.anularCobro({
          idFactura: dto.idFactura.trim(),
          numeroFactura: dto.idFactura.trim(),
          idAdmin: dto.idAdmin || 'admin-sistema',
          motivo: dto.motivo.trim()
        });

        return {
          success: true,
          mensaje: `Comprobante #${dto.idFactura.trim()} anulado con éxito y deudas restauradas`,
          idFactura: dto.idFactura.trim(),
          numeroFactura: dto.idFactura.trim(),
          montoRevertido
        };
      }

      throw new Error(`No se encontró ninguna factura o comprobante con el identificador: ${dto.idFactura}`);
    }

    // 2. Validar que la factura esté cobrada, tenga abonos o registre movimientos
    const estado = (factura.estado_pago || '').toUpperCase();
    const getMovs = typeof this.repo.getMovimientosPorComprobante === 'function'
      ? (idStr: string) => this.repo.getMovimientosPorComprobante(idStr)
      : async () => [];

    const movsPorId = factura.id ? await getMovs(factura.id) : [];
    const movsPorNum = factura.numero_factura ? await getMovs(factura.numero_factura) : [];
    const movsDirecto = (dto.idFactura.trim() !== factura.id && dto.idFactura.trim() !== factura.numero_factura)
      ? await getMovs(dto.idFactura.trim())
      : [];

    const mapMovs = new Map<string, any>();
    for (const m of [...movsPorId, ...movsPorNum, ...movsDirecto]) {
      if (m.id) mapMovs.set(m.id, m);
    }
    const movsAsociados = Array.from(mapMovs.values());

    const tieneCobros = estado === 'PAGADO' ||
      movsAsociados.length > 0 ||
      (factura.fecha_pago !== null && factura.fecha_pago !== undefined) ||
      Number(factura.monto_pagado || 0) > 0;

    if (!tieneCobros) {
      throw new Error(`La factura #${factura.numero_factura || factura.id} no puede anularse porque su estado actual es ${estado}`);
    }

    const totalMovs = movsAsociados.reduce((sum, m) => sum + Number(m.ingreso || 0), 0);
    const montoRevertido = totalMovs > 0
      ? totalMovs
      : Number(factura.monto_pagado ?? factura.total_pagar ?? factura.total ?? 0);

    // 3. Revertir transacción atómicamente en el repositorio
    await this.repo.anularCobro({
      idFactura: factura.id,
      numeroFactura: factura.numero_factura || factura.id,
      idAdmin: dto.idAdmin || 'admin-sistema',
      motivo: dto.motivo.trim()
    });

    return {
      success: true,
      mensaje: `Comprobante #${factura.numero_factura || factura.id} anulado con éxito y deuda restaurada`,
      idFactura: factura.id,
      numeroFactura: factura.numero_factura || factura.id,
      montoRevertido
    };
  }
}
