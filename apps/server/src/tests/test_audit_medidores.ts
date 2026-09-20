import assert from 'node:assert';

async function testAudit() {
  console.log('=== Iniciando Auditoría E2E de Socios y Medidores ===');

  // 1. Login Cajero
  const resLoginCajero = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cajero', password: 'Cajero123*' })
  });
  const dataLoginCajero = await resLoginCajero.json();
  const tokenCajero = dataLoginCajero.token;
  console.log('✔ Login Cajero exitoso');

  // 2. Login Admin
  const resLoginAdmin = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin123*' })
  });
  const dataLoginAdmin = await resLoginAdmin.json();
  const tokenAdmin = dataLoginAdmin.token;
  console.log('✔ Login Admin exitoso');

  // 3. Obtener sectores para asignar
  const secRes = await fetch('http://localhost:4000/api/v1/sectores', {
    headers: { Authorization: `Bearer ${tokenCajero}` }
  });
  const secData = await secRes.json();
  const idSector = secData.data[0]?.id;
  console.log('✔ Sector obtenido:', idSector);

  // 4. Crear Socio de prueba con 2 acometidas (uno con alcantarillado y otro sin alcantarillado)
  const medidor1Num = `TEST-ALC-SI-${Date.now()}`;
  const medidor2Num = `TEST-ALC-NO-${Date.now()}`;
  const nuevoSocio = {
    nombres: 'Prueba Auditoria',
    apellidos: 'Alcantarillado Check',
    cedulaRuc: `0105${String(Date.now()).slice(-6)}`,
    fechaNacimiento: '1985-05-10',
    idSector: idSector,
    tieneAlcantarillado: true,
    medidorNumero: medidor1Num,
    medidores: [
      {
        id: crypto.randomUUID(),
        numeroMedidor: medidor1Num,
        alias: 'Casa Principal',
        tieneAlcantarillado: true,
        direccion: 'Calle Principal 101'
      },
      {
        id: crypto.randomUUID(),
        numeroMedidor: medidor2Num,
        alias: 'Taller Lateral',
        tieneAlcantarillado: false,
        direccion: 'Calle Lateral 102'
      }
    ]
  };

  console.log('Creando socio con 2 medidores...');
  const createRes = await fetch('http://localhost:4000/api/v1/socios', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenCajero}`
    },
    body: JSON.stringify(nuevoSocio)
  });
  const createData = await createRes.json();
  assert.strictEqual(createRes.status, 201, 'Debe crear socio exitosamente');
  const socioCreado = createData.data;
  console.log('✔ Socio creado ID:', socioCreado.id);

  try {
    // 5. Consultar medidores del socio via GET /api/v1/socios/:id/medidores
    const getMedRes = await fetch(`http://localhost:4000/api/v1/socios/${socioCreado.id}/medidores`, {
      headers: { Authorization: `Bearer ${tokenCajero}` }
    });
    const medidoresList = await getMedRes.json();
    console.log('✔ GET /api/v1/socios/:id/medidores retornó:', medidoresList.data.length, 'medidores');
    
    assert.strictEqual(medidoresList.data.length, 2, 'Debe tener 2 medidores');
    const med1 = medidoresList.data.find((m: any) => m.numeroMedidor === medidor1Num);
    const med2 = medidoresList.data.find((m: any) => m.numeroMedidor === medidor2Num);

    assert.ok(med1, 'Medidor 1 encontrado');
    assert.strictEqual(med1.tieneAlcantarillado, true, 'Medidor 1 debe tener alcantarillado = true');
    assert.strictEqual(med1.tiene_alcantarillado, true, 'Medidor 1 tiene_alcantarillado = true');
    assert.strictEqual(med1.numeroMedidor, medidor1Num, 'Medidor 1 numeroMedidor coincide');
    assert.strictEqual(med1.numero_medidor, medidor1Num, 'Medidor 1 numero_medidor coincide');

    assert.ok(med2, 'Medidor 2 encontrado');
    assert.strictEqual(med2.tieneAlcantarillado, false, 'Medidor 2 debe tener alcantarillado = false');
    assert.strictEqual(med2.tiene_alcantarillado, false, 'Medidor 2 tiene_alcantarillado = false');
    assert.strictEqual(med2.numeroMedidor, medidor2Num, 'Medidor 2 numeroMedidor coincide');

    console.log('✔ Verificación de campos dual-key (camelCase y snake_case) exitosa!');

    // 6. Actualizar Socio: cambiar Medidor 1 a alcantarillado = false
    console.log('Actualizando Medidor 1 a alcantarillado = false...');
    const updatePayload = {
      ...socioCreado,
      medidores: [
        {
          ...med1,
          tieneAlcantarillado: false,
          tiene_alcantarillado: false
        },
        med2
      ]
    };

    const putRes = await fetch(`http://localhost:4000/api/v1/socios/${socioCreado.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCajero}`
      },
      body: JSON.stringify(updatePayload)
    });
    assert.strictEqual(putRes.status, 200, 'PUT /socios/:id debe responder 200');

    // Re-verificar medidores del socio tras el update
    const getMedResAfter = await fetch(`http://localhost:4000/api/v1/socios/${socioCreado.id}/medidores`, {
      headers: { Authorization: `Bearer ${tokenCajero}` }
    });
    const medidoresAfter = await getMedResAfter.json();
    const med1After = medidoresAfter.data.find((m: any) => m.id === med1.id);
    assert.strictEqual(med1After.tieneAlcantarillado, false, 'Medidor 1 ahora debe ser false');
    console.log('✔ Actualización y persistencia de medidores en Supabase confirmada!');

    // 7. Probar Permisos de Eliminación: Cajero intenta borrar un medidor -> 403 Forbidden
    console.log('Probando eliminación con rol CAJERO (debe ser bloqueado con 403)...');
    const delCajeroRes = await fetch(`http://localhost:4000/api/v1/medidores/${med2.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenCajero}` }
    });
    assert.strictEqual(delCajeroRes.status, 403, 'Cajero no puede eliminar medidores (403)');
    console.log('✔ Bloqueo por rol verificado: CAJERO recibió 403 Forbidden correctamente');

    // 8. Probar Permisos de Eliminación: Admin elimina el medidor -> 200 OK
    console.log('Probando eliminación con rol ADMIN (debe ser permitido)...');
    const delAdminRes = await fetch(`http://localhost:4000/api/v1/medidores/${med2.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenAdmin}` }
    });
    assert.strictEqual(delAdminRes.status, 200, 'Admin puede eliminar medidores (200)');
    console.log('✔ ADMIN eliminó el medidor con éxito');
  } finally {
    // 9. Limpieza garantizada: Admin elimina el socio de prueba
    try {
      await fetch(`http://localhost:4000/api/v1/socios/${socioCreado.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenAdmin}` }
      });
      console.log('✔ Socio de prueba eliminado correctamente por ADMIN');
    } catch (_cleanupErr) {}
  }

  console.log('\n=========================================');
  console.log('🎉 TODAS LAS PRUEBAS DE AUDITORÍA PASARON!');
  console.log('=========================================\n');
}

testAudit().catch(err => {
  console.error('❌ Error en prueba de auditoría:', err);
  process.exit(1);
});
