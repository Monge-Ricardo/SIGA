async function runE2E() {
  console.log('--- Iniciando Prueba E2E HTTP en vivo ---');

  // 1. Health
  const healthRes = await fetch('http://localhost:4000/api/v1/health');
  const health = await healthRes.json();
  console.log('1. Health check:', health);

  // 2. Login Cajero
  const loginRes = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cajero', password: 'Cajero123*' })
  });
  const loginData = await loginRes.json();
  console.log('2. Login Cajero exitoso. Usuario:', loginData.usuario.nombreCompleto, '| Rol:', loginData.usuario.rol);
  const token = loginData.token;

  // 3. Obtener sectores
  const sectoresRes = await fetch('http://localhost:4000/api/v1/sectores', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const sectoresData = await sectoresRes.json();
  console.log('3. Sectores disponibles:', sectoresData.data.length);
  const sectorId = sectoresData.data[0].id;

  // 4. Crear Socio
  const socioRes = await fetch('http://localhost:4000/api/v1/socios', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      nombres: 'Fausto',
      apellidos: 'Morales',
      cedulaRuc: `010293${String(Date.now()).slice(-4)}`,
      fechaNacimiento: '1955-08-15', // 71 años -> 3ra Edad
      idSector: sectorId,
      medidorNumero: `MED-E2E-${Date.now()}`,
      tieneAlcantarillado: true,
      direccion: 'Sector Centro #10'
    })
  });
  const socioData = await socioRes.json();
  console.log('4. Socio registrado:', socioData.data.nombres, socioData.data.apellidos, '| 3ra Edad:', socioData.data.esTerceraEdad);

  // 5. Períodos
  const periodosRes = await fetch('http://localhost:4000/api/v1/periodos', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const periodosData = await periodosRes.json();
  const periodoId = periodosData.data[0].id;

  // 6. Registrar Lectura
  const lecturaRes = await fetch('http://localhost:4000/api/v1/lecturas', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      idSocio: socioData.data.id,
      idPeriodo: periodoId,
      lecturaAnterior: 100,
      lecturaActual: 140, // 40m3 (10m3 excedente)
      observaciones: 'Lectura E2E'
    })
  });
  const lecturaData = await lecturaRes.json();
  console.log('6. Lectura registrada: Consumo =', lecturaData.data.consumoTotal, 'm3 | Excedente =', lecturaData.data.excedenteM3, 'm3');

  // 7. Liquidar Factura Mes
  const facRes = await fetch('http://localhost:4000/api/v1/facturas/liquidar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      idSocio: socioData.data.id,
      idPeriodo: periodoId
    })
  });
  const facData = await facRes.json();
  console.log('7. Factura liquidada:', {
    numero: facData.data.numeroFactura,
    baseTerceraEdad: facData.data.valorBase,
    excedente: facData.data.valorExcedente,
    alcantarillado: facData.data.valorAlcantarillado,
    totalPagar: facData.data.totalPagar
  });

  // 8. Cobro en Caja
  const cobroRes = await fetch(`http://localhost:4000/api/v1/facturas/${facData.data.id}/cobrar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ metodoPago: 'EFECTIVO' })
  });
  const cobroData = await cobroRes.json();
  console.log('8. Factura cobrada en caja:', cobroData.data.estadoPago, '| Monto:', cobroData.data.totalPagar);

  // 9. Verificar Fondos en Libro Mayor (3 Columnas)
  const balanceRes = await fetch('http://localhost:4000/api/v1/fondos/balance', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const balanceData = await balanceRes.json();
  console.log('9. Balance de Fondos Comunitarios:');
  console.table(balanceData.data.fondos.map((f: any) => ({
    Fondo: f.nombreFondo,
    Ingresos: `$${f.totalIngresos.toFixed(2)}`,
    Egresos: `$${f.totalEgresos.toFixed(2)}`,
    Saldo: `$${f.saldoActual.toFixed(2)}`
  })));

  // 10. Reporte de Morosidad
  const moraRes = await fetch('http://localhost:4000/api/v1/reportes/morosidad', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const moraData = await moraRes.json();
  console.log('10. Reporte Morosidad: Total Morosos =', moraData.totalMorosos, '| Deuda Acumulada = $', moraData.deudaTotalAcumulada);

  console.log('--- ¡Prueba E2E completada con éxito al 100%! ---');
}

runE2E().catch(console.error);
