import { Request, Response } from 'express';

export const getClientes = async (_req: Request, res: Response) => {
  res.json({ data: [] });
};

export const getLecturas = async (_req: Request, res: Response) => {
  res.json({ data: [] });
};

export const getCobros = async (_req: Request, res: Response) => {
  res.json({ data: [] });
};
