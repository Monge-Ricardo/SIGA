/**
 * Reglas de validación de negocio y utilitarios compartidos entre frontend y backend
 */
export const ValidationRules = {
  isValidMonto: (monto: number): boolean => {
    return typeof monto === 'number' && !isNaN(monto) && monto >= 0;
  },

  isValidLectura: (actual: number, anterior: number): { valid: boolean; message?: string } => {
    if (typeof actual !== 'number' || isNaN(actual) || actual < 0) {
      return { valid: false, message: 'La lectura actual debe ser un número válido mayor o igual a 0.' };
    }
    if (typeof anterior !== 'number' || isNaN(anterior) || anterior < 0) {
      return { valid: false, message: 'La lectura anterior debe ser un número válido mayor o igual a 0.' };
    }
    if (actual < anterior) {
      return {
        valid: false,
        message: `La lectura actual (${actual}) no puede ser menor a la lectura anterior (${anterior}). Verifique posible cambio de medidor o error de digitación.`
      };
    }
    return { valid: true };
  },

  isValidUUID: (id: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
  },

  /**
   * Validador oficial de Cédula de Identidad Ecuatoriana (Algoritmo Módulo 10)
   */
  isValidCedulaEcuatoriana: (cedula: string): boolean => {
    if (!cedula || typeof cedula !== 'string') return false;
    const clean = cedula.trim();
    if (clean.length !== 10 || !/^\d{10}$/.test(clean)) return false;

    const provincia = parseInt(clean.substring(0, 2), 10);
    if ((provincia < 1 || provincia > 24) && provincia !== 30) {
      return false;
    }

    const tercerDigito = parseInt(clean.charAt(2), 10);
    if (tercerDigito >= 6) {
      return false; // Cédulas de personas naturales tienen tercer dígito < 6
    }

    const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
    let suma = 0;

    for (let i = 0; i < 9; i++) {
      let valor = parseInt(clean.charAt(i), 10) * coeficientes[i];
      if (valor >= 10) {
        valor -= 9;
      }
      suma += valor;
    }

    const digitoVerificador = parseInt(clean.charAt(9), 10);
    const decenaSuperior = Math.ceil(suma / 10) * 10;
    let digitoCalculado = decenaSuperior - suma;
    if (digitoCalculado === 10) digitoCalculado = 0;

    return digitoCalculado === digitoVerificador;
  },

  /**
   * Cálculo dinámico de Tercera Edad (>= 65 años)
   */
  calcularEsTerceraEdad: (fechaNacimiento: string | Date, fechaReferencia: string | Date = new Date()): boolean => {
    if (!fechaNacimiento) return false;
    const birth = new Date(fechaNacimiento);
    const ref = new Date(fechaReferencia);
    if (isNaN(birth.getTime()) || isNaN(ref.getTime())) return false;

    let age = ref.getFullYear() - birth.getFullYear();
    const monthDiff = ref.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birth.getDate())) {
      age--;
    }

    return age >= 65;
  }
};
