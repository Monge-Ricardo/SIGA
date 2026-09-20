import { requireAuth, apiFetch, normalizeSearchText, matchesSearchTokens } from './auth.js';
import { injectAppLayout } from './shared-layout.js';
import { Swal } from './sweetalert.js';
import { syncEngine } from './sync-engine.js';

// Guard de autenticación (Accesible por ADMIN, CAJERO y LECTOR)
const currentUser = requireAuth(['ADMIN', 'CAJERO', 'LECTOR']);
if (currentUser) {
  injectAppLayout('lecturas');
}

let db = null;

async function initIndexedDB() {
  try {
    db = await syncEngine.getDb();
    await seedLecturasIfEmpty();
    return db;
  } catch (err) {
    console.warn('Error inicializando base de datos local:', err);
    return null;
  }
}

async function seedLecturasIfEmpty() {
  if (!db) return;
  await syncEngine.ensureDataSeeded();
}

async function getAllSocios() {
  // 1. Consultar IndexedDB local (Offline-first inmediato)
  if (db) {
    const localSocios = await new Promise((resolve) => {
      try {
        const tx = db.transaction(['socios'], 'readonly');
        const req = tx.objectStore('socios').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });

    if (localSocios && localSocios.length > 0) {
      return normalizeSociosList(localSocios);
    }
  }

  return [];
}

function formatLecturaM3(val) {
  if (val === undefined || val === null || isNaN(val)) return '0.00';
  const num = Number(val);
  const str = String(val);
  if (str.includes('.') && str.split('.')[1].length >= 3) {
    return num.toFixed(3);
  }
  return num.toFixed(2);
}

function normalizeSociosList(rawList) {
  return rawList.map((s) => {
    const nom = s.nombres || '';
    const ape = s.apellidos || '';
    const computedName = `${nom} ${ape}`.trim();
    return {
      id: s.id,
      codigoSocio: s.codigoSocio || s.codigo_socio,
      nombres: nom,
      apellidos: ape,
      nombreCompleto: computedName || s.nombreCompleto || s.codigoSocio,
      cedulaRuc: s.cedulaRuc || s.cedula_ruc,
    sectorId: s.idSector || s.sectorId || s.id_sector,
    nombreSector: s.nombreSector || s.nombre_sector || 'Sector General',
    medidorNumero: s.medidorNumero || s.medidor_numero || 'MED-0000',
    medidores: (s.medidores || []).map((m) => ({
      id: m.id || m.idMedidor,
      idMedidor: m.id || m.idMedidor,
      idSocio: m.idSocio || m.id_socio || s.id,
      idSector: m.idSector || m.id_sector,
      numeroMedidor: m.numeroMedidor || m.numero_medidor || m.medidorNumero,
      medidorNumero: m.numeroMedidor || m.numero_medidor || m.medidorNumero,
      alias: m.alias || 'Casa principal',
      aliasMedidor: m.alias || 'Casa principal',
      lecturaInicial: Number(m.lecturaInicial ?? m.lectura_inicial ?? m.lecturaAnterior ?? m.lectura_anterior ?? 0),
      lecturaAnterior: Number(m.lecturaAnterior ?? m.lectura_anterior ?? m.lecturaInicial ?? m.lectura_inicial ?? 0),
      deudaPendiente: Number(m.deudaPendiente ?? m.deuda_pendiente ?? 0),
      mesesAdeudados: Number(m.mesesAdeudados ?? m.meses_adeudados ?? 0),
      tieneAlcantarillado: Boolean(m.tieneAlcantarillado ?? m.tiene_alcantarillado),
      estado: m.estado || 'ACTIVO'
    })),
      tieneAlcantarillado: Boolean(s.tieneAlcantarillado ?? s.tiene_alcantarillado),
      estadoServicio: s.estadoServicio || s.estado || 'ACTIVO'
    };
  });
}

async function getAllSectores() {
  if (db) {
    const localSectores = await new Promise((resolve) => {
      try {
        const tx = db.transaction(['sectores'], 'readonly');
        const req = tx.objectStore('sectores').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });

    if (localSectores.length > 0) {
      return localSectores.map((s) => ({
        id: s.id,
        codigo: s.codigoSector || s.codigo || s.codigo_sector,
        nombre: s.nombreSector || s.nombre || s.nombre_sector,
        descripcion: s.descripcion || ''
      }));
    }
  }

  return [];
}

async function getAllPeriodos() {
  if (db) {
    const localPeriodos = await new Promise((resolve) => {
      try {
        const tx = db.transaction(['periodos'], 'readonly');
        const req = tx.objectStore('periodos').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
    if (localPeriodos.length > 0) return localPeriodos;
  }

  return [
    { id: '33333333-0000-0000-0000-000000000001', periodoCodigo: '2026-08', nombre: 'Período Agosto 2026', estado: 'ABIERTO' },
    { id: '33333333-0000-0000-0000-000000000000', periodoCodigo: '2026-07', nombre: 'Período Julio 2026', estado: 'CERRADO' }
  ];
}

function populatePeriodosSelect(periodos, preferredPeriodo = null) {
  const select = document.getElementById('selectPeriodo');
  if (!select) return;

  const currentVal = preferredPeriodo || select.value;
  select.innerHTML = '';

  periodos.forEach((p) => {
    const opt = document.createElement('option');
    const cod = p.periodoCodigo || p.periodo_codigo || p.id;
    const nom = p.nombre || `Período ${cod}`;
    const est = p.estado || 'ABIERTO';
    opt.value = cod;
    opt.textContent = `${cod} (${nom} - ${est === 'ABIERTO' ? 'Activo' : 'Cerrado'})`;
    if (est === 'ABIERTO') {
      opt.style.fontWeight = '700';
      opt.style.color = '#0284c7';
    }
    select.appendChild(opt);
  });

  if (currentVal && Array.from(select.options).some((o) => o.value === currentVal)) {
    select.value = currentVal;
  } else {
    const abierto = periodos.find((p) => p.estado === 'ABIERTO');
    if (abierto) {
      select.value = abierto.periodoCodigo || abierto.periodo_codigo;
    }
  }
}

async function getLecturasPeriodo(periodo) {
  // 1. Consultar IndexedDB local (Offline-first inmediato)
  if (db) {
    const localLecturas = await new Promise((resolve) => {
      const tx = db.transaction(['lecturas'], 'readonly');
      const store = tx.objectStore('lecturas');
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(all.filter((l) =>
          l.periodo === periodo ||
          l.periodo_codigo === periodo ||
          l.periodoCodigo === periodo ||
          l.id_periodo === periodo ||
          l.idPeriodo === periodo ||
          (periodo === '2026-08' && (!l.periodo || l.periodo === '2026-08'))
        ));
      };
      req.onerror = () => resolve([]);
    });

    if (localLecturas.length > 0) {
      return localLecturas.map((l) => ({
        id: l.id,
        idMedidor: l.idMedidor || l.id_medidor,
        numeroMedidor: l.numeroMedidor || l.numero_medidor || l.medidorNumero,
        aliasMedidor: l.aliasMedidor || l.alias_medidor || l.alias || 'Casa principal',
        clienteId: l.idSocio || l.id_socio || l.clienteId,
        idSocio: l.idSocio || l.id_socio || l.clienteId,
        periodo: l.periodo || l.periodo_codigo || l.periodoCodigo || periodo,
        lecturaAnterior: Number(l.lecturaAnterior ?? l.lectura_anterior ?? 0),
        lecturaActual: (l.lecturaActual !== undefined && l.lecturaActual !== null)
          ? Number(l.lecturaActual)
          : ((l.lectura_actual !== undefined && l.lectura_actual !== null) ? Number(l.lectura_actual) : undefined),
        consumoM3: Number(l.consumoM3 ?? l.consumoTotal ?? l.consumo_total ?? 0),
        excedenteM3: Number(l.excedenteM3 ?? l.excedente_m3 ?? 0),
        observaciones: l.observaciones || '',
        origen: l.origen || 'LECTOR',
        updatedAt: l.updatedAt || l.updated_at
      }));
    }
  }

  return [];
}

async function saveLecturaLocal(lecturaData) {
  const start = performance.now();

  const idMedidor = lecturaData.idMedidor || lecturaData.medidorId;
  const numeroMedidor = lecturaData.numeroMedidor || lecturaData.medidorNumero;
  const idSocio = lecturaData.idSocio || lecturaData.clienteId;
  const id = lecturaData.id || `lec-${idMedidor || idSocio}-${lecturaData.periodo}`;

  const rec = {
    id,
    idMedidor,
    medidorId: idMedidor,
    id_medidor: idMedidor,
    numeroMedidor,
    medidorNumero: numeroMedidor,
    numero_medidor: numeroMedidor,
    clienteId: idSocio,
    idSocio,
    id_socio: idSocio,
    periodo: lecturaData.periodo,
    idPeriodo: lecturaData.periodo,
    id_periodo: lecturaData.periodo,
    lecturaAnterior: Number(lecturaData.lecturaAnterior || 0),
    lectura_anterior: Number(lecturaData.lecturaAnterior || 0),
    lecturaActual: Number(lecturaData.lecturaActual),
    lectura_actual: Number(lecturaData.lecturaActual),
    consumoM3: Number(lecturaData.consumoM3 || 0),
    consumo_total: Number(lecturaData.consumoM3 || 0),
    excedenteM3: Number(lecturaData.excedenteM3 || 0),
    excedente_m3: Number(lecturaData.excedenteM3 || 0),
    observaciones: lecturaData.observaciones || (currentUser?.rol === 'CAJERO' ? 'Modificado por Cajero' : 'Toma de lectura en campo'),
    origen: lecturaData.origen || (currentUser?.rol === 'CAJERO' ? 'CAJERO' : 'LECTOR'),
    updatedAt: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // 1. Guardar en IndexedDB local (Garantía offline inmediata <20 ms)
  if (db) {
    try {
      const tx = db.transaction(['lecturas'], 'readwrite');
      tx.objectStore('lecturas').put(rec);
    } catch (e) {
      console.warn('[Lecturas] Error guardando en IndexedDB:', e);
    }
  }

  // 2. Registrar en cola outbox y disparar subida si hay red
  await syncEngine.enqueueMutation('lecturas', id, 'UPSERT', rec);
  syncEngine.pushPending().catch(() => {});

  return rec;
}

// Variables del Módulo
let cachedSocios = [];
let cachedSectores = [];
let cachedLecturas = [];
const rowStateMap = new Map();

async function renderLecturasUI() {
  const isCajeroOAdmin = currentUser?.rol === 'CAJERO' || currentUser?.rol === 'ADMIN';

  const titleEl = document.getElementById('moduleTitleLecturas');
  const subEl = document.getElementById('moduleSubtitleLecturas');
  const btnAvanzar = document.getElementById('btnAvanzarPeriodo');
  const btnActualizar = document.getElementById('btnActualizarDatos');
  const btnPasarACaja = document.getElementById('btnPasarACaja');
  const btnSubir = document.getElementById('btnSubirLecturas');

  // Actualizar Datos siempre disponible
  if (btnActualizar) btnActualizar.style.display = 'inline-flex';

  if (isCajeroOAdmin) {
    if (titleEl) titleEl.innerHTML = '📋 Módulo 2: Revisión de Lecturas y Facturación';
    if (subEl) {
      subEl.textContent = 'Auditoría de micromedición, corrección de consumos, emisión masiva a Caja y control de períodos.';
    }
    if (btnAvanzar) btnAvanzar.style.display = 'inline-flex';
    if (btnPasarACaja) btnPasarACaja.style.display = 'inline-flex';
    // El cajero NO toma lecturas en la calle; solo el admin o lector pueden subir
    if (btnSubir) btnSubir.style.display = currentUser?.rol === 'ADMIN' ? 'inline-flex' : 'none';
  } else {
    // Rol LECTOR (en campo)
    if (titleEl) titleEl.innerHTML = '⏱️ Módulo 2: Toma de Lecturas en Campo';
    if (subEl) {
      subEl.textContent = 'Captura rápida de lecturas en ruta por sector. Actualiza el padrón y sube tus lecturas a la nube.';
    }
    if (btnSubir) btnSubir.style.display = 'inline-flex';
    if (btnPasarACaja) btnPasarACaja.style.display = 'none';
    if (btnAvanzar) btnAvanzar.style.display = 'none';
  }

  // Cargar períodos dinámicamente si el select solo tiene opciones estáticas
  const selectPeriodoEl = document.getElementById('selectPeriodo');
  if (selectPeriodoEl && (!selectPeriodoEl.dataset.dynamicLoaded || selectPeriodoEl.options.length <= 3)) {
    const periodos = await getAllPeriodos();
    populatePeriodosSelect(periodos);
    selectPeriodoEl.dataset.dynamicLoaded = 'true';
  }

  const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';

  // Si hay conexión, sincronizar padrón y deltas con Supabase Cloud para incorporar nuevos socios
  if (navigator.onLine && !syncEngine.isSyncing) {
    try {
      console.log('🔄 [Lecturas UI] Sincronizando padrón de socios con el servidor central...');
      await syncEngine.pullDeltas();
    } catch (e) {
      console.warn('[Lecturas UI] Aviso en sincronización inicial:', e);
    }
  }

  // Cargar datos consolidados en paralelo desde IndexedDB
  const [socios, sectores, lecturas] = await Promise.all([
    getAllSocios(),
    getAllSectores(),
    getLecturasPeriodo(periodo)
  ]);

  cachedSocios = socios;
  cachedSectores = sectores;
  cachedLecturas = lecturas;

  populateSectorSelect(cachedSectores);
  await renderTableAndMetrics();
}

// Actualización quirúrgica del nombre de socio en el DOM sin recargar la tabla ni borrar inputs
async function updateSocioNameInDOM(socioId, newFullName = null) {
  if (!socioId) return;
  if (!newFullName && db) {
    try {
      const sRec = await new Promise((resolve) => {
        const tx = db.transaction(['socios'], 'readonly');
        const req = tx.objectStore('socios').get(socioId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (sRec) {
        newFullName = sRec.nombreCompleto || `${sRec.nombres || ''} ${sRec.apellidos || ''}`.trim();
      }
    } catch (e) {}
  }
  if (!newFullName) return;

  const s = cachedSocios.find((x) => x.id === socioId);
  if (s) {
    s.nombreCompleto = newFullName;
    const parts = newFullName.trim().split(' ');
    s.nombres = parts[0] || '';
    s.apellidos = parts.slice(1).join(' ') || '';
  }
  document.querySelectorAll(`tr[data-socio-id="${socioId}"] .socio-cell-name`).forEach((el) => {
    el.textContent = newFullName;
  });
}

if (typeof BroadcastChannel !== 'undefined') {
  try {
    const bc = new BroadcastChannel('siga_sync_channel');
    bc.onmessage = async (ev) => {
      if (ev.data?.type === 'SOCIO_UPDATED' && ev.data?.id) {
        const socio = ev.data.socio || {};
        const nombreCompleto = socio.nombreCompleto || `${socio.nombres || ''} ${socio.apellidos || ''}`.trim();
        await updateSocioNameInDOM(ev.data.id, nombreCompleto);
      }
    };
  } catch (e) {}
}

window.addEventListener('storage', async (e) => {
  if (e.key === 'siga_last_socio_update') {
    try {
      const data = JSON.parse(e.newValue || '{}');
      const sId = data.id || data.socio?.id;
      if (sId) {
        const sObj = data.socio || data;
        const nombre = sObj.nombreCompleto || `${sObj.nombres || ''} ${sObj.apellidos || ''}`.trim();
        await updateSocioNameInDOM(sId, nombre || null);
      }
    } catch (err) {}
  }
});

function populateSectorSelect(sectores) {
  const select = document.getElementById('selectSectorRuta');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="TODOS">Todos los sectores comunitarios</option>';

  sectores.forEach((sec) => {
    const opt = document.createElement('option');
    opt.value = sec.id;
    const cod = sec.codigo || sec.codigoSector;
    const nom = sec.nombre || sec.nombreSector;
    opt.textContent = `${cod ? cod + ' - ' : ''}${nom}`;
    select.appendChild(opt);
  });

  if (currentVal && Array.from(select.options).some((o) => o.value === currentVal)) {
    select.value = currentVal;
  }
}

function renderTableAndMetrics() {
  const isCajeroOAdmin = currentUser?.rol === 'CAJERO' || currentUser?.rol === 'ADMIN';
  const sectorFilter = document.getElementById('selectSectorRuta')?.value || 'TODOS';
  const searchFilter = document.getElementById('searchSocioLectura')?.value || '';
  const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';

  let filtrados = cachedSocios.filter((s) => s.estadoServicio !== 'CORTADO');

  if (sectorFilter !== 'TODOS') {
    filtrados = filtrados.filter((s) => s.sectorId === sectorFilter);
  }

  if (searchFilter.trim()) {
    filtrados = filtrados.filter((s) => {
      const composite = `${s.nombreCompleto || ''} ${s.cedulaRuc || ''} ${s.codigoSocio || ''} ${s.medidorNumero || ''} ${s.nombreSector || ''}`;
      return matchesSearchTokens(composite, searchFilter);
    });
  }

  const tbody = document.getElementById('lecturasTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  rowStateMap.clear();

  let totalTomadas = 0;
  let totalConsumoM3 = 0;
  let totalExcedenteM3 = 0;

  if (filtrados.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 2.5rem; color: #64748b;">
          No se encontraron abonados en la ruta o sector seleccionado.
        </td>
      </tr>
    `;
    updateMetrics(0, 0, 0, 0);
    return;
  }

  // Desglosar socios en acometidas / medidores individuales (Multi-Medidor)
  const listaAcometidas = [];
  filtrados.forEach((socio) => {
    if (socio.medidores && socio.medidores.length > 0) {
      socio.medidores.forEach((m) => {
        listaAcometidas.push({
          rowKey: `${socio.id}_${m.id || m.numeroMedidor}`,
          socioId: socio.id,
          medidorId: m.id || m.idMedidor,
          medidorNumero: m.numeroMedidor || m.medidorNumero,
          aliasMedidor: m.alias || m.aliasMedidor || 'Casa principal',
          nombreCompleto: socio.nombreCompleto,
          codigoSocio: socio.codigoSocio,
          cedulaRuc: socio.cedulaRuc,
          nombreSector: m.nombreSector || socio.nombreSector,
          sectorId: m.idSector || socio.sectorId,
          lecturaAnterior: Number(m.lecturaAnterior ?? m.lecturaInicial ?? 0),
          lecturaInicial: Number(m.lecturaInicial ?? m.lecturaAnterior ?? 0)
        });
      });
    } else {
      listaAcometidas.push({
        rowKey: `${socio.id}_principal`,
        socioId: socio.id,
        medidorId: socio.medidorNumero || 'MED-00000',
        medidorNumero: socio.medidorNumero || 'MED-00000',
        aliasMedidor: 'Casa principal',
        nombreCompleto: socio.nombreCompleto,
        codigoSocio: socio.codigoSocio,
        cedulaRuc: socio.cedulaRuc,
        nombreSector: socio.nombreSector,
        sectorId: socio.sectorId,
        lecturaAnterior: 0,
        lecturaInicial: 0
      });
    }
  });

  listaAcometidas.forEach((item) => {
    const isSinMedidor = Boolean((item.medidorNumero || '').toUpperCase().includes('SN'));

    const candidatas = cachedLecturas.filter((l) =>
      (l.idMedidor && (l.idMedidor === item.medidorId || l.id_medidor === item.medidorId)) ||
      (l.numeroMedidor && (l.numeroMedidor === item.medidorNumero || l.medidorNumero === item.medidorNumero)) ||
      (l.clienteId && l.clienteId === item.socioId && !l.idMedidor && !l.numeroMedidor)
    );

    let lecturaExistente = null;
    if (candidatas.length > 0) {
      candidatas.sort((a, b) => {
        const aVal = (a.lecturaActual !== undefined && a.lecturaActual !== null && !a.observaciones?.startsWith('Punto de partida')) ? 1 : 0;
        const bVal = (b.lecturaActual !== undefined && b.lecturaActual !== null && !b.observaciones?.startsWith('Punto de partida')) ? 1 : 0;
        if (bVal !== aVal) return bVal - aVal;
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      });
      lecturaExistente = candidatas[0];
    }

    // Lectura anterior real: se toma de la base del medidor o de la lectura registrada
    let lant = Number(lecturaExistente?.lecturaAnterior ?? item.lecturaAnterior ?? item.lecturaInicial ?? 0);

    if (isSinMedidor) {
      lant = 0;
    } else if (item.medidorNumero === '8896620') {
      // Regla específica: Delia Moreta medidor 8896620 lectura anterior 1891
      lant = 1891;
    } else if (item.medidorNumero === '1211034231') {
      // Regla específica: Delia Moreta medidor 1211034231 lectura anterior 7036
      lant = 7036;
    } else if (periodo === '2026-09' && (item.medidorNumero === '1208020366' || item.codigoSocio === 'SOC-0024')) {
      // Regla específica: Juan Guerrero comienza con 2397 en período 09
      lant = 2397;
    } else if (item.medidorNumero === '21052411' && (lant === 0 || isNaN(lant))) {
      // Regla específica: Moreta Oswaldo segundo medidor 21052411 base 7442.111
      lant = 7442.111;
    } else if (item.medidorNumero === '1211034233' && (lant === 0 || isNaN(lant))) {
      // Regla específica: Moreta Oswaldo primer medidor 1211034233 base 4144
      lant = 4144;
    } else if (lant === 0) {
      const hist = cachedLecturas.find((l) =>
        ((l.idMedidor && (l.idMedidor === item.medidorId || l.id_medidor === item.medidorId)) ||
         (l.numeroMedidor && l.numeroMedidor === item.medidorNumero)) &&
        l.lecturaActual !== undefined && l.lecturaActual > 0
      );
      if (hist) lant = Number(hist.lecturaActual);
    }

    if (isSinMedidor) {
      totalTomadas++;
      const tr = document.createElement('tr');
      tr.id = `row-${item.rowKey}`;
      tr.dataset.socioId = item.socioId;
      tr.innerHTML = `
        <td>
          <div class="socio-cell-name">${item.nombreCompleto}</div>
          <div class="socio-cell-sub">${item.codigoSocio || '-'} &bull; ${item.cedulaRuc || '-'}</div>
        </td>
        <td>
          <span class="badge-tag">${item.nombreSector || item.sectorId}</span>
        </td>
        <td>
          <code class="medidor-code" style="background:#fef3c7; color:#92400e; border:1px solid #fcd34d;">${item.medidorNumero}</code>
          <span style="font-size:0.72rem; color:#92400e; background:#fef3c7; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:600;">Sin Medidor</span>
        </td>
        <td style="text-align: right;">
          <span class="lectura-ant-badge" style="background:#f1f5f9; color:#64748b;">0.00 m³</span>
        </td>
        <td style="text-align: right;">
          <div style="display: inline-flex; flex-direction: column; align-items: flex-end; gap: 2px;">
            <input 
              type="text" 
              class="input-lectura-actual input-saved input-locked" 
              id="input-lact-${item.rowKey}"
              value="0.00"
              readonly
              disabled
              style="width: 85px; text-align: right; font-weight: 700; background: #f8fafc; color: #64748b; cursor: not-allowed;"
              title="Acometida sin micromedidor (Tarifa fija)"
            />
            <span style="font-size: 0.70rem; color: #059669; font-weight: 700;">✓ Tarifa Fija Mensual</span>
          </div>
        </td>
        <td style="text-align: right;" id="consumo-cell-${item.rowKey}">
          <span class="consumption-pill" style="background:#f8fafc; color:#64748b; border: 1px solid #e2e8f0;">0.00 m³</span>
        </td>
        <td style="text-align: center;" id="action-cell-${item.rowKey}">
          <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.75rem; color: #059669; font-weight: 700; background: #ecfdf5; padding: 4px 10px; border-radius: 6px; border: 1px solid #a7f3d0;">
            ✓ Tarifa Fija
          </span>
        </td>
      `;

      tbody.appendChild(tr);

      rowStateMap.set(item.rowKey, {
        clienteId: item.socioId,
        medidorId: item.medidorId,
        medidorNumero: item.medidorNumero,
        nombreSocio: item.nombreCompleto,
        sectorId: item.sectorId,
        periodo,
        lecturaAnterior: 0,
        lecturaActual: 0,
        consumoM3: 0,
        excedenteM3: 0,
        observaciones: 'Sin medidor - Tarifa fija',
        origen: 'SISTEMA_TARIFA_FIJA',
        valid: true
      });
      return;
    }

    const lactRaw = lecturaExistente?.lecturaActual;
    const isBaseline = Boolean(
      lecturaExistente?.observaciones?.startsWith('Punto de partida') ||
      lecturaExistente?.observaciones === 'Alta inicial de socio'
    );
    const esModificadoPorCajero = Boolean(lecturaExistente?.observaciones?.includes('Cajero'));
    const esDigitadoEnCampo = Boolean(
      lecturaExistente?.observaciones?.includes('campo') ||
      lecturaExistente?.origen === 'LECTOR' ||
      lecturaExistente?.origen === 'LECTOR_DIGITADO'
    );
    const hasLectorReading = Boolean(
      lactRaw !== undefined &&
      lactRaw !== null &&
      !isBaseline &&
      (
        lactRaw > lant ||
        esModificadoPorCajero ||
        esDigitadoEnCampo ||
        Boolean(lecturaExistente?.observaciones) ||
        Boolean(lecturaExistente?.id && /^[0-9a-f-]{36}$/i.test(lecturaExistente.id))
      )
    );
    const lact = hasLectorReading ? Number(lactRaw) : undefined;

    let consumo = 0;
    let excedente = 0;

    if (hasLectorReading && lact !== undefined) {
      consumo = Number(Math.max(0, lact - lant).toFixed(3));
      excedente = Number(Math.max(0, consumo - 30).toFixed(3));
      totalTomadas++;
      totalConsumoM3 += consumo;
      totalExcedenteM3 += excedente;
    }

    const tr = document.createElement('tr');
    tr.id = `row-${item.rowKey}`;
    tr.dataset.socioId = item.socioId;

    tr.innerHTML = `
      <td>
        <div class="socio-cell-name">${item.nombreCompleto}</div>
        <div class="socio-cell-sub">${item.codigoSocio || '-'} &bull; ${item.cedulaRuc || '-'}</div>
      </td>
      <td>
        <span class="badge-tag">${item.nombreSector || item.sectorId}</span>
      </td>
      <td>
        <code class="medidor-code">${item.medidorNumero}</code>
        <span style="font-size:0.72rem; color:#0284c7; background:#e0f2fe; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:600;">${item.aliasMedidor}</span>
      </td>
      <td style="text-align: right;">
        <span class="lectura-ant-badge">${formatLecturaM3(lant)} m³</span>
      </td>
      <td style="text-align: right;">
        <div style="display: inline-flex; flex-direction: column; align-items: flex-end; gap: 2px;">
          <input 
            type="number" 
            inputmode="decimal"
            step="0.001"
            class="input-lectura-actual ${hasLectorReading ? 'input-saved input-locked' : ''}" 
            id="input-lact-${item.rowKey}"
            value="${hasLectorReading ? formatLecturaM3(lact) : ''}"
            min="${lant}"
            placeholder="${formatLecturaM3(lant)}"
            ${hasLectorReading ? 'readonly' : ''}
            title="${hasLectorReading ? 'Lectura guardada' : 'Ingrese lectura actual del medidor'}"
          />
          <span id="hint-lact-${item.rowKey}" style="font-size: 0.72rem; color: ${esModificadoPorCajero ? '#059669' : hasLectorReading ? '#0284c7' : '#94a3b8'}; font-weight: 600;">
            ${
              hasLectorReading 
                ? (esModificadoPorCajero ? '✓ Modificado por Cajero' : '✓ Digitado en Campo') 
                : '⏳ Pendiente'
            }
          </span>
        </div>
      </td>
      <td style="text-align: right;" id="consumo-cell-${item.rowKey}">
        ${
          hasLectorReading
            ? `<span class="consumption-pill">${formatLecturaM3(consumo)} m³</span> ${
                excedente > 0 ? `<span class="excess-pill">+${formatLecturaM3(excedente)} exc</span>` : ''
              }`
            : '<span class="text-subtle">-</span>'
        }
      </td>
      <td style="text-align: center;" id="action-cell-${item.rowKey}">
        <button 
          class="btn btn-sm ${hasLectorReading ? 'btn-outline' : 'btn-success'} btn-toggle-edit" 
          id="btn-action-${item.rowKey}" 
          style="font-weight: 700; padding: 0.35rem 0.8rem; display: inline-flex; align-items: center; gap: 4px;"
          ${!hasLectorReading ? 'disabled' : ''}
        >
          ${hasLectorReading ? '✏️ Editar' : '💾 Guardar'}
        </button>
      </td>
    `;

    tbody.appendChild(tr);

    const inputLact = tr.querySelector(`#input-lact-${item.rowKey}`);
    const btnAction = tr.querySelector(`#btn-action-${item.rowKey}`);
    const consumoCell = tr.querySelector(`#consumo-cell-${item.rowKey}`);
    const hintLact = tr.querySelector(`#hint-lact-${item.rowKey}`);

    let isEditing = !hasLectorReading;
    let valorOriginal = hasLectorReading ? lact : '';

    const enterEditMode = () => {
      isEditing = true;
      inputLact.readOnly = false;
      inputLact.classList.remove('input-locked', 'input-saved');
      inputLact.classList.add('input-editing');
      btnAction.innerHTML = '💾 Guardar';
      btnAction.className = 'btn btn-sm btn-success btn-toggle-edit';
      btnAction.disabled = false;
      hintLact.textContent = '✏️ Editando lectura...';
      hintLact.style.color = '#b45309';
      inputLact.focus();
      inputLact.select();
    };

    const exitEditMode = (isSavedSuccess = false, updatedVal = null) => {
      isEditing = false;
      inputLact.readOnly = true;
      inputLact.classList.remove('input-editing', 'input-invalid', 'input-valid');
      inputLact.classList.add('input-saved', 'input-locked');
      btnAction.innerHTML = '✏️ Editar';
      btnAction.className = 'btn btn-sm btn-outline btn-toggle-edit';
      btnAction.disabled = false;
      if (isSavedSuccess) {
        valorOriginal = updatedVal;
        hintLact.textContent = isCajeroOAdmin ? '✓ Modificado por Cajero' : '✓ Digitado en Campo';
        hintLact.style.color = '#059669';
      } else {
        inputLact.value = valorOriginal !== '' && valorOriginal !== undefined ? valorOriginal : '';
        hintLact.textContent = hasLectorReading ? (esModificadoPorCajero ? '✓ Modificado por Cajero' : '✓ Digitado en Campo') : '⏳ Pendiente';
        hintLact.style.color = hasLectorReading ? '#0284c7' : '#94a3b8';
      }
    };

    const validateInput = () => {
      const valStr = inputLact.value.trim();
      if (valStr === '') {
        inputLact.classList.remove('input-valid');
        inputLact.classList.add('input-invalid');
        btnAction.disabled = true;
        consumoCell.innerHTML = '<span class="text-subtle">-</span>';
        rowStateMap.delete(item.rowKey);
        return null;
      }

      const valNum = Number(parseFloat(valStr));
      if (isNaN(valNum) || valNum < lant) {
        inputLact.classList.remove('input-valid');
        inputLact.classList.add('input-invalid');
        btnAction.disabled = true;
        consumoCell.innerHTML = `<span style="color:#dc2626; font-size:0.75rem; font-weight:700;">⚠️ Lact < Lant</span>`;
        rowStateMap.delete(item.rowKey);
        return null;
      }

      inputLact.classList.remove('input-invalid');
      inputLact.classList.add('input-valid');
      btnAction.disabled = false;

      const cons = Number(Math.max(0, valNum - lant).toFixed(3));
      const exc = Number(Math.max(0, cons - 30).toFixed(3));
      consumoCell.innerHTML = `
        <span class="consumption-pill" style="color:#0284c7; font-weight:700;">${formatLecturaM3(cons)} m³</span>
        ${exc > 0 ? `<span class="excess-pill">+${formatLecturaM3(exc)} exc</span>` : ''}
      `;

      const lecturaRecord = {
        id: lecturaExistente?.id || undefined,
        clienteId: item.socioId,
        medidorId: item.medidorId,
        medidorNumero: item.medidorNumero,
        nombreSocio: item.nombreCompleto,
        sectorId: item.sectorId,
        periodo,
        lecturaAnterior: lant,
        lecturaActual: valNum,
        consumoM3: cons,
        excedenteM3: exc,
        observaciones: isCajeroOAdmin ? 'Modificado por Cajero' : 'Toma de lectura en campo',
        origen: isCajeroOAdmin ? 'CAJERO' : 'LECTOR',
        valid: true
      };
      rowStateMap.set(item.rowKey, lecturaRecord);

      return { valNum, cons, exc, lecturaRecord };
    };

    const saveCurrentRow = async () => {
      const valid = validateInput();
      if (!valid) return;

      btnAction.disabled = true;
      btnAction.textContent = '⏳ ...';

      try {
        await saveLecturaLocal(valid.lecturaRecord);
        cachedLecturas = await getLecturasPeriodo(periodo);

        exitEditMode(true, valid.valNum);
        recalcOverallMetrics(filtrados);

        // Toast feedback
        const toast = document.createElement('div');
        toast.className = 'save-toast-mini';
        toast.textContent = `✓ Lectura de ${item.nombreCompleto.split(' ')[0]} guardada (${valid.valNum} m³) y sincronizada`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
      } catch (err) {
        console.error('[Lecturas] Error guardando lectura:', err);
        btnAction.disabled = false;
        btnAction.textContent = '💾 Guardar';
        Swal.fire({
          icon: 'error',
          title: 'Error al Guardar Lectura',
          text: err.message || 'No se pudo registrar la lectura localmente.'
        });
      }
    };

    btnAction.addEventListener('click', async () => {
      if (!isEditing) {
        enterEditMode();
      } else {
        await saveCurrentRow();
      }
    });

    inputLact.addEventListener('input', () => {
      validateInput();
    });

    inputLact.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isEditing) await saveCurrentRow();
      } else if (e.key === 'Escape') {
        if (hasLectorReading) exitEditMode(false);
      }
    });
  });

  updateMetrics(listaAcometidas.length, totalTomadas, totalConsumoM3, totalExcedenteM3);
}

function updateMetrics(totalSocios, tomadas, consumo, excedente) {
  const pendientes = Math.max(0, totalSocios - tomadas);
  const pct = totalSocios > 0 ? Math.round((tomadas / totalSocios) * 100) : 0;

  const elTotal = document.getElementById('metricTotalMedidores');
  if (elTotal) elTotal.textContent = totalSocios;
  const elTomadas = document.getElementById('metricLecturasTomadas');
  if (elTomadas) elTomadas.textContent = tomadas;
  const elPendientes = document.getElementById('metricLecturasPendientes');
  if (elPendientes) elPendientes.textContent = pendientes;
  const elProgresoBar = document.getElementById('metricProgresoBar');
  if (elProgresoBar) elProgresoBar.style.width = `${pct}%`;
  const elProgresoLabel = document.getElementById('metricProgresoLabel');
  if (elProgresoLabel) elProgresoLabel.textContent = `${pct}% revisado / tomado`;
  const elConsumo = document.getElementById('metricConsumoTotal');
  if (elConsumo) elConsumo.textContent = `${consumo.toFixed(2)} m³`;
  const elExcedente = document.getElementById('metricExcedenteTotal');
  if (elExcedente) elExcedente.textContent = `${excedente.toFixed(2)} m³ de excedente ($${(excedente * 0.10).toFixed(2)})`;
}

async function recalcOverallMetrics(sociosRuta) {
  const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';
  const lecturas = await getLecturasPeriodo(periodo);

  let tomadas = 0, consumo = 0, excedente = 0;
  let totalAcometidas = 0;

  sociosRuta.forEach((s) => {
    const meds = (s.medidores && s.medidores.length > 0) ? s.medidores : [{ id: s.medidorNumero, numeroMedidor: s.medidorNumero }];
    totalAcometidas += meds.length;

    meds.forEach((m) => {
      const isSN = (m.numeroMedidor || m.medidorNumero || '').toUpperCase().includes('SN');
      if (isSN) {
        tomadas++;
        return;
      }
      const l = lecturas.find((item) =>
        (item.idMedidor && (item.idMedidor === m.id || item.idMedidor === m.idMedidor)) ||
        (item.numeroMedidor && (item.numeroMedidor === m.numeroMedidor || item.numeroMedidor === m.medidorNumero)) ||
        (item.clienteId === s.id && !item.idMedidor && meds.length === 1)
      );
      if (l && l.lecturaActual !== undefined && (l.lecturaActual > (l.lecturaAnterior || 0) || l.observaciones?.includes('campo') || l.observaciones?.includes('Cajero'))) {
        tomadas++;
        consumo += Number(l.consumoM3 || 0);
        excedente += Number(l.excedenteM3 || 0);
      }
    });
  });

  updateMetrics(totalAcometidas, tomadas, consumo, excedente);
}

// Guardar Todo el Lote
async function guardarTodoElLote() {
  const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';
  const rows = document.querySelectorAll('#lecturasTableBody tr');
  if (!rows || rows.length === 0) return;

  const btnGuardarLote = document.getElementById('btnGuardarLote');
  if (btnGuardarLote) {
    btnGuardarLote.disabled = true;
    btnGuardarLote.textContent = '⏳ Guardando lote...';
  }

  let guardadosCount = 0;
  let erroresCount = 0;

  for (const tr of rows) {
    const rowKey = tr.id?.replace('row-', '');
    if (!rowKey) continue;

    const medCode = tr.querySelector('.medidor-code')?.textContent?.trim() || '';
    const isSinMedidor = Boolean(medCode.toUpperCase().includes('SN'));
    if (isSinMedidor) {
      const state = rowStateMap.get(rowKey);
      const itemRecord = {
        clienteId: state?.clienteId || tr.querySelector('.socio-cell-sub')?.textContent?.split('•')?.[0]?.trim(),
        medidorId: state?.medidorId,
        medidorNumero: medCode,
        periodo,
        lecturaAnterior: 0,
        lecturaActual: 0,
        consumoM3: 0,
        excedenteM3: 0,
        observaciones: 'Sin medidor - Tarifa fija',
        origen: 'SISTEMA_TARIFA_FIJA'
      };
      try {
        await saveLecturaLocal(itemRecord);
        guardadosCount++;
      } catch (e) {}
      continue;
    }

    const inputLact = tr.querySelector('.input-lectura-actual');
    if (!inputLact) continue;

    const valStr = inputLact.value.trim();
    if (valStr === '') continue; // Fila sin lectura digitada

    const valNum = Number(parseFloat(valStr));
    const lantText = tr.querySelector('.lectura-ant-badge')?.textContent || '0';
    const lant = Number(parseFloat(lantText));

    if (isNaN(valNum) || valNum < lant) {
      erroresCount++;
      continue;
    }

    const state = rowStateMap.get(rowKey);
    const cons = Number(Math.max(0, valNum - lant).toFixed(3));
    const exc = Number(Math.max(0, cons - 30).toFixed(3));

    const itemRecord = {
      clienteId: state?.clienteId || tr.querySelector('.socio-cell-sub')?.textContent?.split('•')?.[0]?.trim(),
      medidorId: state?.medidorId,
      medidorNumero: state?.medidorNumero || medCode,
      periodo,
      lecturaAnterior: lant,
      lecturaActual: valNum,
      consumoM3: cons,
      excedenteM3: exc,
      observaciones: currentUser?.rol === 'CAJERO' ? 'Modificado por Cajero' : 'Toma de lectura en campo',
      origen: currentUser?.rol === 'CAJERO' ? 'CAJERO' : 'LECTOR'
    };

    try {
      await saveLecturaLocal(itemRecord);
      guardadosCount++;

      inputLact.readOnly = true;
      inputLact.classList.remove('input-editing', 'input-invalid');
      inputLact.classList.add('input-saved', 'input-locked');
      const hint = tr.querySelector(`#hint-lact-${rowKey}`);
      if (hint) {
        hint.textContent = currentUser?.rol === 'CAJERO' ? '✓ Modificado por Cajero' : '✓ Digitado en Campo';
        hint.style.color = '#059669';
      }
      const btnAction = tr.querySelector(`#btn-action-${rowKey}`);
      if (btnAction) {
        btnAction.innerHTML = '✏️ Editar';
        btnAction.className = 'btn btn-sm btn-outline btn-toggle-edit';
        btnAction.disabled = false;
      }
    } catch (e) {
      erroresCount++;
    }
  }

  // Refrescar lecturas cacheadas y métricas
  cachedLecturas = await getLecturasPeriodo(periodo);
  await renderTableAndMetrics();

  // Intentar push inmediato en segundo plano
  syncEngine.pushPending().catch(() => {});

  if (btnGuardarLote) {
    btnGuardarLote.disabled = false;
    btnGuardarLote.innerHTML = '💾 Guardar Todo el Lote';
  }

  if (guardadosCount > 0) {
    Swal.fire({
      icon: 'success',
      title: '¡Lote Guardado!',
      html: `
        <p>Se guardaron y sincronizaron <strong>${guardadosCount} lecturas</strong> correctamente.</p>
        ${erroresCount > 0 ? `<p style="color:#dc2626; font-size:0.85rem;">⚠️ ${erroresCount} filas fueron omitidas por valor menor a la lectura anterior.</p>` : ''}
      `,
      timer: 2500,
      showConfirmButton: false
    });
  } else {
    Swal.fire({
      icon: 'info',
      title: 'Sin Cambios en Lote',
      text: 'No se encontraron lecturas nuevas o pendientes válidas para guardar.'
    });
  }
}

// Cierre de Ciclo
document.getElementById('btnCierreCiclo')?.addEventListener('click', async () => {
  const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';
  const lecturas = await getLecturasPeriodo(periodo);

  let totalMedidores = 0;
  let tomadas = 0;

  cachedSocios.forEach((s) => {
    const meds = (s.medidores && s.medidores.length > 0) ? s.medidores : [{ id: s.medidorNumero, numeroMedidor: s.medidorNumero }];
    totalMedidores += meds.length;

    meds.forEach((m) => {
      const isSN = (m.numeroMedidor || m.medidorNumero || '').toUpperCase().includes('SN');
      if (isSN) {
        tomadas++;
        return;
      }
      const l = lecturas.find((item) =>
        (item.idMedidor && (item.idMedidor === m.id || item.idMedidor === m.idMedidor)) ||
        (item.numeroMedidor && (item.numeroMedidor === m.numeroMedidor || item.numeroMedidor === m.medidorNumero)) ||
        (item.clienteId === s.id && !item.idMedidor && meds.length === 1)
      );
      if (l && l.lecturaActual !== undefined && l.lecturaActual !== null && !l.observaciones?.startsWith('Punto de partida')) {
        tomadas++;
      }
    });
  });

  const pendientes = Math.max(0, totalMedidores - tomadas);

  let confirmHtml = `<p>Se cerrará el período <strong>${periodo}</strong>, emitiendo las planillas del mes directamente a cuenta corriente en Caja.</p>`;
  if (pendientes === 0) {
    confirmHtml += `<div style="background:#f0fdf4; border:1px solid #86efac; padding:8px 12px; border-radius:6px; margin-top:8px; color:#166534; font-size:0.85rem;">
      ✅ <strong>¡Excelente!</strong> Todas las <strong>${totalMedidores} acometidas</strong> han sido registradas para este ciclo.
    </div>`;
  } else {
    confirmHtml += `<div style="background:#fff7ed; border:1px solid #fdba74; padding:8px 12px; border-radius:6px; margin-top:8px; color:#9a3412; font-size:0.85rem;">
      ⚠️ <strong>Atención:</strong> Aún existen <strong>${pendientes} lecturas pendientes</strong> en este período.
    </div>`;
  }

  const result = await Swal.fire({
    icon: 'question',
    title: `¿Cerrar Ciclo ${periodo} y Liquidar a Caja?`,
    html: confirmHtml,
    showCancelButton: true,
    confirmButtonText: '🔒 Sí, Cerrar Ciclo y Liquidar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#7c3aed'
  });

  if (!result.isConfirmed) return;

  const btnCierre = document.getElementById('btnCierreCiclo');
  btnCierre.disabled = true;
  btnCierre.textContent = '⏳ Liquidando y cerrando ciclo...';

  try {
    const data = await syncEngine.cerrarCicloSupabase(periodo);
    const nuevoPeriodoCodigo = data?.nuevoPeriodo || '2026-09';

    await Swal.fire({
      icon: 'success',
      title: '¡Ciclo Cerrado y Liquidado Exitosamente!',
      html: `
        <div style="text-align: left; font-size: 0.9rem; line-height: 1.5;">
          <p>✅ <strong>${data?.totalFacturasLiquidadas || 0} planillas</strong> emitidas a cuenta corriente listas para cobro en Caja.</p>
          <p>✅ <strong>${data?.totalLecturasMovilizadas || 0} lecturas</strong> movilizadas como punto de partida.</p>
          <p>✅ Nuevo período habilitado: <strong style="color: #0284c7;">${nuevoPeriodoCodigo}</strong>.</p>
          <p style="margin-top: 8px; font-size: 0.8rem; color: #64748b;">Los cambios han sido respaldados localmente y sincronizados con la nube.</p>
        </div>
      `,
      showDenyButton: true,
      confirmButtonText: '➡️ Continuar con Período ' + nuevoPeriodoCodigo,
      denyButtonText: '💵 Ir a Caja y Cobros'
    }).then((r) => {
      if (r.isDenied) {
        window.location.href = 'caja.html';
      }
    });

    // Recargar períodos y seleccionar el nuevo período activo
    const freshPeriodos = await getAllPeriodos();
    populatePeriodosSelect(freshPeriodos, nuevoPeriodoCodigo);
    await renderLecturasUI();
  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'Error al cerrar ciclo',
      text: err.message || 'No se pudo completar el cierre de ciclo.'
    });
  } finally {
    btnCierre.disabled = false;
    btnCierre.textContent = '🔒 Cerrar Ciclo y Liquidar a Caja';
  }
});

// Sincronización Directa Móvil <-> Nube (Actualizar / Subir)
async function actualizarDatosDesdeNube() {
  Swal.fire({
    title: '🔄 Actualizando Datos...',
    text: 'Consultando socios, medidores y lecturas desde la base de datos central...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const res = await syncEngine.pullDeltas();
    if (res.success) {
      cachedSocios = await getAllSocios();
      cachedSectores = await getAllSectores();
      const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';
      cachedLecturas = await getLecturasPeriodo(periodo);

      renderTableAndMetrics();

      if (window.AndroidBridge && typeof window.AndroidBridge.vibrate === 'function') {
        window.AndroidBridge.vibrate(60);
      }

      Swal.fire({
        icon: 'success',
        title: '¡Datos Actualizados!',
        html: `
          <div style="text-align: left; font-size: 0.9rem;">
            <p>✅ Padrón actualizado: <strong>${cachedSocios.length}</strong> socios vigentes.</p>
            <p>✅ Los socios o medidores modificados o eliminados se han sincronizado correctamente.</p>
          </div>
        `
      });
    } else {
      Swal.fire({
        icon: 'warning',
        title: 'Aviso de Conexión',
        text: res.error || res.reason || 'No se pudo consultar el servidor central.'
      });
    }
  } catch (err) {
    console.error('[Lecturas] Error al actualizar datos:', err);
    Swal.fire({
      icon: 'error',
      title: 'Error de Red',
      text: err.message || 'Error actualizando desde la nube.'
    });
  }
}

async function subirLecturasALaNube() {
  Swal.fire({
    title: '⬆️ Subiendo Lecturas a la Nube...',
    text: 'Enviando lecturas registradas en este celular a la base de datos...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const res = await syncEngine.pushPending(true);
    const p = res.pushed || 0;
    const tot = res.total || 0;

    if (window.AndroidBridge && typeof window.AndroidBridge.vibrate === 'function') {
      window.AndroidBridge.vibrate(100);
    }
    if (window.AndroidBridge && typeof window.AndroidBridge.showToast === 'function') {
      window.AndroidBridge.showToast(p > 0 ? `${p} lecturas subidas a la nube` : 'Sin lecturas pendientes');
    }

    if (tot === 0) {
      Swal.fire({
        icon: 'info',
        title: 'Al Día',
        text: 'No hay lecturas locales pendientes por subir.'
      });
    } else if (res.rejected === 0 && p > 0) {
      Swal.fire({
        icon: 'success',
        title: '¡Lecturas Subidas con Éxito!',
        html: `<p>Se subieron las <strong>${p}</strong> lecturas a la base de datos en la nube.</p>`
      });
    } else if (p > 0 && res.rejected > 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Subida Parcial',
        html: `<p>Se subieron <strong>${p}</strong> de ${tot} lecturas. Quedan <strong>${res.rejected}</strong> pendientes.</p>`
      });
    } else {
      Swal.fire({
        icon: 'warning',
        title: 'Aviso de Sincronización',
        text: res.reason || res.error || 'No se pudo conectar. Las lecturas permanecen seguras en el celular.'
      });
    }

    const periodo = document.getElementById('selectPeriodo')?.value || '2026-08';
    cachedLecturas = await getLecturasPeriodo(periodo);
    renderTableAndMetrics();
  } catch (err) {
    console.error('[Lecturas] Error subiendo lecturas:', err);
    Swal.fire({
      icon: 'error',
      title: 'Error de Red',
      text: err.message || 'Error enviando lecturas a la nube.'
    });
  }
}

async function exportLecturasCSV(periodo) {
  const lecturas = await getLecturasPeriodo(periodo);
  if (lecturas.length === 0) {
    Swal.fire({ icon: 'info', title: 'Sin Lecturas', text: 'No hay lecturas registradas para exportar.' });
    return;
  }

  let csvContent = 'CodigoSocio,Nombre,Cedula,Sector,Medidor,LecturaAnterior,LecturaActual,ConsumoM3,ExcedenteM3,Observaciones,Fecha\n';

  cachedSocios.forEach((s) => {
    const l = lecturas.find((item) => item.clienteId === s.id || item.idSocio === s.id);
    const lant = l ? Number(l.lecturaAnterior || 0).toFixed(2) : '0.00';
    const lact = l && l.lecturaActual !== undefined ? Number(l.lecturaActual).toFixed(2) : '';
    const cons = l && l.consumoM3 !== undefined ? Number(l.consumoM3).toFixed(2) : '';
    const exc = l && l.excedenteM3 !== undefined ? Number(l.excedenteM3).toFixed(2) : '';
    const obs = (l?.observaciones || '').replace(/,/g, ';');
    const fecha = l?.updatedAt || '';

    csvContent += `"${s.codigoSocio}","${s.nombreCompleto}","${s.cedulaRuc}","${s.nombreSector}","${s.medidorNumero}",${lant},${lact},${cons},${exc},"${obs}","${fecha}"\n`;
  });

  const filename = `SIGA_Lecturas_${periodo}.csv`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();

  Swal.fire({
    icon: 'success',
    title: 'Archivo Generado',
    text: `Se descargó el archivo ${filename} correctamente.`
  });
}

async function avanzarSiguientePeriodo() {
  const selectPeriodoEl = document.getElementById('selectPeriodo');
  const currentPeriodoCodigo = selectPeriodoEl?.value || '2026-08';

  const confirmResult = await Swal.fire({
    title: '⏩ ¿Pasar al Siguiente Período?',
    html: `
      <div style="text-align: left; font-size: 0.92rem; color: #334155; line-height: 1.5;">
        <p>Esta acción realizará las siguientes operaciones:</p>
        <ul style="padding-left: 1.2rem; margin: 0.5rem 0;">
          <li>Cerrará oficialmente el ciclo del período actual.</li>
          <li>Habilitará el nuevo período siguiente en el calendario.</li>
          <li>Las <strong>lecturas actuales</strong> se convertirán automáticamente en las <strong>lecturas anteriores</strong> de cada medidor.</li>
          <li>La ruta quedará lista para que el <strong>lector móvil</strong> descargue y empiece a registrar las nuevas mediciones en campo.</li>
        </ul>
        <p style="color: #6b21a8; font-weight: 700; margin-top: 0.5rem;">¿Desea continuar?</p>
      </div>
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#7c3aed',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Sí, avanzar período',
    cancelButtonText: 'Cancelar'
  });

  if (!confirmResult.isConfirmed) return;

  Swal.fire({
    title: 'Avanzando Período...',
    text: 'Cerrando ciclo y migrando lecturas hacia el nuevo mes...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const res = await apiFetch('/api/v1/periodos/avanzar', {
      method: 'POST',
      body: JSON.stringify({ idPeriodo: currentPeriodoCodigo })
    });

    if (res && res.success) {
      const nuevoCodigo = res.data?.periodoNuevo?.codigo || 'Nuevo';
      const cantMeds = res.data?.medidoresAvanzados || 0;

      const periodos = await getAllPeriodos();
      populatePeriodosSelect(periodos, nuevoCodigo);
      if (selectPeriodoEl && nuevoCodigo) {
        selectPeriodoEl.value = nuevoCodigo;
      }
      await renderLecturasUI();

      Swal.fire({
        icon: 'success',
        title: '¡Período Avanzado con Éxito!',
        html: `
          <div style="text-align: left; font-size: 0.9rem;">
            <p>✅ El nuevo período <strong>${nuevoCodigo}</strong> ya se encuentra <strong>ABIERTO</strong>.</p>
            <p>✅ Se prepararon <strong>${cantMeds}</strong> medidores con sus lecturas anteriores consolidadas.</p>
            <p>📱 El lector ya puede pulsar <em>"Descargar Lecturas"</em> en su móvil para tomar los nuevos consumos.</p>
          </div>
        `
      });
    } else {
      throw new Error(res?.error || 'No se pudo avanzar el período.');
    }
  } catch (err) {
    console.error('[Lecturas] Error al avanzar período:', err);
    Swal.fire({
      icon: 'error',
      title: 'Error al Avanzar Período',
      text: err.message || 'Ocurrió un error inesperado al cerrar y avanzar el ciclo.'
    });
  }
}

async function pasarLecturasACajaUI() {
  const selectPeriodoEl = document.getElementById('selectPeriodo');
  const periodoActual = selectPeriodoEl?.value || '2026-08';

  // Contar lecturas tomadas
  const tomadas = (cachedLecturas || []).filter((l) => l.lecturaActual !== null && l.lecturaActual !== undefined);

  if (tomadas.length === 0) {
    Swal.fire({
      icon: 'info',
      title: 'Sin Lecturas Registradas',
      text: `No hay lecturas registradas para el período ${periodoActual}. El lector debe registrar y subir lecturas antes de pasar a Caja.`
    });
    return;
  }

  const confirm = await Swal.fire({
    title: '📥 ¿Pasar Lecturas a Caja?',
    html: `
      <div style="text-align: left; font-size: 0.92rem; color: #334155; line-height: 1.5;">
        <p>Se procesarán <strong>${tomadas.length}</strong> lecturas registradas para el período <strong>${periodoActual}</strong>.</p>
        <ul style="padding-left: 1.2rem; margin: 0.5rem 0;">
          <li>Se calculará el consumo neto y excedentes de cada medidor.</li>
          <li>Se consolidarán las tarifas ($7.00 normal / $5.00 tercera edad + $1.00 alcantarillado).</li>
          <li>Se arrastrarán deudas anteriores no pagadas y multas pendientes.</li>
          <li>Se generarán oficialmente las facturas en estado <strong>PENDIENTE</strong> para su cobro en ventanilla.</li>
        </ul>
        <p style="color: #d97706; font-weight: 700; margin-top: 0.5rem;">¿Desea emitir las planillas a Caja ahora?</p>
      </div>
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#d97706',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Sí, pasar a Caja',
    cancelButtonText: 'Cancelar'
  });

  if (!confirm.isConfirmed) return;

  Swal.fire({
    title: 'Emitiendo Facturas...',
    text: 'Calculando consumos y generando planillas de cobro en Supabase...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const res = await apiFetch('/api/v1/facturas/pasar-a-caja', {
      method: 'POST',
      body: JSON.stringify({ idPeriodo: periodoActual })
    });

    if (res && res.success) {
      const d = res.data || {};
      Swal.fire({
        icon: 'success',
        title: '¡Facturación Emitida a Caja!',
        html: `
          <div style="text-align: left; font-size: 0.92rem;">
            <p>✅ <strong>${d.facturasGeneradas || tomadas.length}</strong> facturas generadas exitosamente para el período <strong>${d.periodo || periodoActual}</strong>.</p>
            <p>💧 Consumo total facturado: <strong>${d.totalM3 || 0} m³</strong>.</p>
            <p>💵 Total mes a recaudar: <strong>$${Number(d.totalFacturadoMes || 0).toFixed(2)}</strong>.</p>
            ${d.totalConDeudas > 0 ? `<p style="color: #ea580c;">⚠️ <strong>${d.totalConDeudas}</strong> medidores arrastran deudas de meses anteriores.</p>` : ''}
            <div style="margin-top: 1rem; text-align: center;">
              <a href="caja.html" class="btn btn-sm btn-primary" style="text-decoration: none; display: inline-block; padding: 0.5rem 1rem;">
                Ir al Módulo de Caja (Cobros) ➡️
              </a>
            </div>
          </div>
        `
      });
    } else {
      throw new Error(res?.error || 'No se pudo emitir la facturación.');
    }
  } catch (err) {
    console.error('[Lecturas] Error pasando a caja:', err);
    Swal.fire({
      icon: 'error',
      title: 'Error al Pasar a Caja',
      text: err.message || 'Ocurrió un error al generar las facturas en la base de datos.'
    });
  }
}

// Listeners de filtros y acciones
document.getElementById('selectPeriodo')?.addEventListener('change', async () => {
  const periodo = document.getElementById('selectPeriodo').value;
  cachedLecturas = await getLecturasPeriodo(periodo);
  renderTableAndMetrics();
});

document.getElementById('selectSectorRuta')?.addEventListener('change', renderTableAndMetrics);
document.getElementById('searchSocioLectura')?.addEventListener('input', renderTableAndMetrics);
document.getElementById('btnActualizarDatos')?.addEventListener('click', actualizarDatosDesdeNube);
document.getElementById('btnSubirLecturas')?.addEventListener('click', subirLecturasALaNube);
document.getElementById('btnAvanzarPeriodo')?.addEventListener('click', avanzarSiguientePeriodo);
document.getElementById('btnPasarACaja')?.addEventListener('click', pasarLecturasACajaUI);
document.getElementById('btnGuardarLote')?.addEventListener('click', guardarTodoElLote);

// Inicializar PWA
initIndexedDB().then(renderLecturasUI);
