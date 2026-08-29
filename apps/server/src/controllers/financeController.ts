import { Request, Response } from 'express';

export const getMovimientosCaja = async (_req: Request, res: Response) => {
  res.json({ data: [] });
};

export const getBalanceResumen = async (_req: Request, res: Response) => {
  res.json({
    totalEntradas: 0,
    totalSalidas: 0,
    balanceNeto: 0,
    fechaInicio: new Date().toISOString(),
    fechaFin: new Date().toISOString(),
    conteoMovimientos: 0
  });
};
