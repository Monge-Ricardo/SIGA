/**
 * Reglas y validaciones livianas para ejecución tanto en cliente como en backend
 */
export const ValidationRules = {
  isValidMonto: (monto: number): boolean => {
    return typeof monto === 'number' && !isNaN(monto) && monto >= 0;
  },

  isValidLectura: (actual: number, anterior: number): { valid: boolean; message?: string } => {
    if (actual < anterior) {
      return {
        valid: false,
        message: 'La lectura actual no puede ser menor a la lectura anterior registrada.'
      };
    }
    return { valid: true };
  },

  isValidUUID: (id: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
  }
};
