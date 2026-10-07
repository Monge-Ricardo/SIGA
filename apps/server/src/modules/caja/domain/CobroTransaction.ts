import type { MetodoPago, ItemCobroRequestDTO, AsientoFondoDTO } from './CajaDTOs.ts';

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

export class CobroTransaction {
  private readonly _id: string;
  private readonly _idSocio: string;
  private readonly _idCajero: string;
  private readonly _metodoPago: MetodoPago;
  private readonly _montoTotalRecibido: number;
  private readonly _referenciaBancaria?: string;
  private readonly _items: ItemCobroRequestDTO[];
  private readonly _fecha: string;

  constructor(
    paramsOrIdSocio: {
      id?: string;
      idSocio: string;
      idCajero: string;
      metodoPago: MetodoPago;
      montoTotalRecibido: number;
      referenciaBancaria?: string;
      items: ItemCobroRequestDTO[];
      fecha?: string;
    } | string,
    idCajero?: string,
    metodoPago?: MetodoPago,
    montoTotalRecibido?: number,
    items?: ItemCobroRequestDTO[],
    referenciaBancaria?: string
  ) {
    if (typeof paramsOrIdSocio === 'object') {
      this._id = paramsOrIdSocio.id || `TX-${Date.now()}`;
      this._idSocio = (paramsOrIdSocio.idSocio || (paramsOrIdSocio as any).id_socio || (paramsOrIdSocio as any).socioId || '').trim();
      this._idCajero = (paramsOrIdSocio.idCajero || (paramsOrIdSocio as any).id_cajero || (paramsOrIdSocio as any).cajeroId || '').trim();
      this._metodoPago = paramsOrIdSocio.metodoPago;
      this._montoTotalRecibido = Number(Number(paramsOrIdSocio.montoTotalRecibido).toFixed(2));
      this._referenciaBancaria = paramsOrIdSocio.referenciaBancaria?.trim();
      this._items = paramsOrIdSocio.items || [];
      this._fecha = paramsOrIdSocio.fecha || new Date().toISOString();
    } else {
      this._id = `TX-${Date.now()}`;
      this._idSocio = paramsOrIdSocio;
      this._idCajero = idCajero || 'cajero';
      this._metodoPago = metodoPago || 'EFECTIVO';
      this._montoTotalRecibido = Number(Number(montoTotalRecibido || 0).toFixed(2));
      this._items = items || [];
      this._referenciaBancaria = referenciaBancaria?.trim();
      this._fecha = new Date().toISOString();
    }

    this.validarInvariantes();
  }

  public get id(): string { return this._id; }
  public get idSocio(): string { return this._idSocio; }
  public get idCajero(): string { return this._idCajero; }
  public get metodoPago(): MetodoPago { return this._metodoPago; }
  public get montoTotalRecibido(): number { return this._montoTotalRecibido; }
  public get referenciaBancaria(): string | undefined { return this._referenciaBancaria; }
  public get items(): ItemCobroRequestDTO[] { return [...this._items]; }
  public get fecha(): string { return this._fecha; }

  public get totalACobrar(): number {
    return Number(this._items.reduce((acc, it) => acc + it.montoACobrar, 0).toFixed(2));
  }

  public get cambioVuelto(): number {
    if (this._metodoPago === 'TRANSFERENCIA') return 0.00;
    return Number((this._montoTotalRecibido - this.totalACobrar).toFixed(2));
  }

  public getTotalCobrado(): number {
    return this.totalACobrar;
  }

  public getMontoRecibido(): number {
    return this.montoTotalRecibido;
  }

  public getCambioVuelto(): number {
    return this.cambioVuelto;
  }

  /**
   * Valida las reglas de negocio e invariantes matemáticas estrictas
   */
  private validarInvariantes(): void {
    if (!this._idSocio) {
      throw new DomainValidationError('El ID del socio es mandatorio para procesar el cobro.');
    }
    if (!this._idCajero) {
      throw new DomainValidationError('El ID del cajero responsable es mandatorio.');
    }
    if (!Array.isArray(this._items) || this._items.length === 0) {
      throw new DomainValidationError('Debe incluir al menos un rubro o factura a liquidar.');
    }

    for (const it of this._items) {
      if (!it.idReferencia) {
        throw new DomainValidationError('Todo item a cobrar debe tener un ID de referencia válido.');
      }
      if (typeof it.montoACobrar !== 'number' || isNaN(it.montoACobrar) || it.montoACobrar <= 0) {
        throw new DomainValidationError(`Monto inválido para el rubro ${it.tipo}: debe ser mayor a 0.`);
      }
    }

    const totalCobro = this.totalACobrar;

    if (this._metodoPago === 'EFECTIVO') {
      if (this._montoTotalRecibido < totalCobro) {
        throw new DomainValidationError(
          `Efectivo insuficiente: el total a pagar es $${totalCobro.toFixed(2)} pero se recibió $${this._montoTotalRecibido.toFixed(2)}.`
        );
      }
    } else if (this._metodoPago === 'TRANSFERENCIA') {
      if (!this._referenciaBancaria) {
        throw new DomainValidationError('Para transferencias bancarias es obligatorio ingresar el número de referencia / comprobante.');
      }
      if (Math.abs(this._montoTotalRecibido - totalCobro) > 0.001) {
        throw new DomainValidationError(
          `En transferencias el monto recibido ($${this._montoTotalRecibido.toFixed(2)}) debe coincidir exactamente con el total liquidado ($${totalCobro.toFixed(2)}).`
        );
      }
    } else {
      throw new DomainValidationError(`Método de pago no soportado: ${this._metodoPago}`);
    }
  }

  /**
   * Garantiza que la suma de asientos contables coincide exactamente con el dinero cobrado
   */
  public validarAsientosContables(asientos: AsientoFondoDTO[]): void {
    const sumaAsientos = Number(asientos.reduce((acc, a) => acc + a.monto, 0).toFixed(2));
    const totalCobrado = this.totalACobrar;

    if (Math.abs(sumaAsientos - totalCobrado) > 0.001) {
      throw new DomainValidationError(
        `Descuadre en libro diario: la suma de asientos a fondos ($${sumaAsientos.toFixed(2)}) no coincide con el total cobrado ($${totalCobrado.toFixed(2)}).`
      );
    }
  }
}
