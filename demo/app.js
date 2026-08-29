/**
 * Demostrador Offline-First con IndexedDB y Outbox Sync Queue
 */

// 1. Inicialización de Base de Datos Local IndexedDB (Nativa de navegador)
const DB_NAME = 'AppAguaDemoDB';
const DB_VERSION = 1;
let db = null;
let isOnline = true;

function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      if (!dbInstance.objectStoreNames.contains('cobros')) {
        dbInstance.createObjectStore('cobros', { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains('movimientos_caja')) {
        dbInstance.createObjectStore('movimientos_caja', { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains('sync_queue')) {
        const queueStore = dbInstance.createObjectStore('sync_queue', { keyPath: 'id' });
        queueStore.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      console.log('✓ IndexedDB inicializada correctamente en el navegador.');
      resolve(db);
    };

    request.onerror = (event) => {
      console.error('Error al inicializar IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

// 2. Operaciones de Persistencia Local
async function saveCobroLocal(cobroData) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cobros', 'sync_queue'], 'readwrite');
    const cobrosStore = tx.objectStore('cobros');
    const queueStore = tx.objectStore('sync_queue');

    const id = 'cobro-' + Date.now();
    const cobroRecord = { id, ...cobroData, createdAt: new Date().toISOString() };
    cobrosStore.add(cobroRecord);

    // Encolar en Outbox pattern
    const outboxMutation = {
      id: 'mut-' + crypto.randomUUID().slice(0, 8),
      entity: 'cobros',
      entityId: id,
      action: 'CREATE',
      payload: cobroRecord,
      localTimestamp: new Date().toLocaleTimeString(),
      status: isOnline ? 'SYNCED' : 'PENDING'
    };
    queueStore.add(outboxMutation);

    tx.oncomplete = () => {
      const latency = (performance.now() - start).toFixed(1);
      updateLatencyMeter(latency);
      resolve(cobroRecord);
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function saveCajaLocal(cajaData) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['movimientos_caja', 'sync_queue'], 'readwrite');
    const cajaStore = tx.objectStore('movimientos_caja');
    const queueStore = tx.objectStore('sync_queue');

    const id = 'caja-' + Date.now();
    const cajaRecord = { id, ...cajaData, createdAt: new Date().toISOString() };
    cajaStore.add(cajaRecord);

    const outboxMutation = {
      id: 'mut-' + crypto.randomUUID().slice(0, 8),
      entity: 'movimientos_caja',
      entityId: id,
      action: 'CREATE',
      payload: cajaRecord,
      localTimestamp: new Date().toLocaleTimeString(),
      status: isOnline ? 'SYNCED' : 'PENDING'
    };
    queueStore.add(outboxMutation);

    tx.oncomplete = () => {
      const latency = (performance.now() - start).toFixed(1);
      updateLatencyMeter(latency);
      resolve(cajaRecord);
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllFromStore(storeName) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve([]);
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 3. Sincronización Outbox (Simulación de POST /api/v1/sync)
async function flushOutbox() {
  if (!isOnline) {
    alert('No se puede sincronizar: El simulador está en MODO FUERA DE LÍNEA.');
    return;
  }

  const mutations = await getAllFromStore('sync_queue');
  const pending = mutations.filter((m) => m.status === 'PENDING');

  if (pending.length === 0) {
    alert('Todo al día. No hay mutaciones pendientes por sincronizar.');
    return;
  }

  // Marcar como SYNCED
  const tx = db.transaction('sync_queue', 'readwrite');
  const store = tx.objectStore('sync_queue');
  pending.forEach((m) => {
    m.status = 'SYNCED';
    store.put(m);
  });

  tx.oncomplete = () => {
    renderUI();
  };
}

// 4. Actualización de Interfaz de Usuario
function updateLatencyMeter(ms) {
  const meter = document.querySelector('#perfMeter span');
  if (meter) {
    meter.textContent = `${ms} ms (Local <50ms)`;
  }
}

async function renderUI() {
  const cobros = await getAllFromStore('cobros');
  const caja = await getAllFromStore('movimientos_caja');
  const queue = await getAllFromStore('sync_queue');

  // Cálculos métricos
  let totalAgua = cobros.reduce((acc, c) => acc + Number(c.monto), 0);
  let totalEntradas = totalAgua + caja.filter((m) => m.tipo === 'ENTRADA').reduce((acc, m) => acc + Number(m.monto), 0);
  let totalSalidas = caja.filter((m) => m.tipo === 'SALIDA').reduce((acc, m) => acc + Number(m.monto), 0);
  let balance = totalEntradas - totalSalidas;

  document.getElementById('totalAgua').textContent = `$${totalAgua.toFixed(2)}`;
  document.getElementById('countCobros').textContent = `${cobros.length} recibos cobrados`;
  document.getElementById('totalEntradas').textContent = `$${totalEntradas.toFixed(2)}`;
  document.getElementById('totalSalidas').textContent = `$${totalSalidas.toFixed(2)}`;
  document.getElementById('balanceNeto').textContent = `$${balance.toFixed(2)}`;

  const pendingCount = queue.filter((q) => q.status === 'PENDING').length;
  document.getElementById('queueBadge').textContent = `${pendingCount} pendientes en Outbox`;

  // Tabla Outbox
  const outboxBody = document.getElementById('outboxTableBody');
  if (queue.length === 0) {
    outboxBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No hay mutaciones en cola</td></tr>`;
  } else {
    outboxBody.innerHTML = queue.slice(-8).reverse().map((item) => `
      <tr>
        <td><strong>${item.entity}</strong></td>
        <td>${item.action}</td>
        <td>${item.localTimestamp}</td>
        <td><span class="status-tag ${item.status === 'SYNCED' ? 'tag-synced' : 'tag-pending'}">${item.status}</span></td>
      </tr>
    `).join('');
  }

  // Tabla Registros Recientes
  const recordsBody = document.getElementById('recordsTableBody');
  const allRecords = [
    ...cobros.map((c) => ({ type: '💧 Cobro Agua', desc: `${c.cliente} (${c.recibo})`, amount: `+$${c.monto.toFixed(2)}`, color: 'text-blue', time: c.createdAt })),
    ...caja.map((m) => ({ type: m.tipo === 'ENTRADA' ? '📥 Entrada Caja' : '📤 Salida Caja', desc: m.desc, amount: (m.tipo === 'ENTRADA' ? '+' : '-') + `$${m.monto.toFixed(2)}`, color: m.tipo === 'ENTRADA' ? 'text-green' : 'text-red', time: m.createdAt }))
  ].sort((a, b) => new Date(b.time) - new Date(a.time));

  if (allRecords.length === 0) {
    recordsBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Sin registros recientes</td></tr>`;
  } else {
    recordsBody.innerHTML = allRecords.slice(0, 6).map((r) => `
      <tr>
        <td>${r.type}</td>
        <td>${r.desc}</td>
        <td class="${r.color}"><strong>${r.amount}</strong></td>
        <td>${new Date(r.time).toLocaleTimeString()}</td>
      </tr>
    `).join('');
  }
}

// 5. Manejadores de Eventos
document.getElementById('formCobro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cliente = document.getElementById('clienteNombre').value;
  const recibo = document.getElementById('numeroRecibo').value;
  const consumo = Number(document.getElementById('consumoM3').value);
  const monto = Number(document.getElementById('montoCobro').value);

  await saveCobroLocal({ cliente, recibo, consumo, monto });
  e.target.reset();
  renderUI();
});

document.getElementById('formCaja').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tipo = document.getElementById('tipoMovimiento').value;
  const categoria = document.getElementById('categoriaCaja').value;
  const monto = Number(document.getElementById('montoCaja').value);
  const desc = document.getElementById('descripcionCaja').value;

  await saveCajaLocal({ tipo, categoria, monto, desc });
  e.target.reset();
  renderUI();
});

document.getElementById('toggleNetworkBtn').addEventListener('click', () => {
  isOnline = !isOnline;
  const btn = document.getElementById('toggleNetworkBtn');
  const banner = document.getElementById('networkBanner');
  const statusText = document.getElementById('networkStatusText');
  const bannerTitle = document.getElementById('bannerTitle');
  const bannerDesc = document.getElementById('bannerDesc');

  if (isOnline) {
    btn.className = 'btn-network online';
    banner.className = 'status-banner banner-online';
    statusText.textContent = 'Simulador: EN LÍNEA';
    bannerTitle.textContent = 'Conexión Activa';
    bannerDesc.textContent = 'Los cambios se guardan localmente en IndexedDB y se sincronizan en segundo plano.';
    // Flush outbox al reconectar
    flushOutbox();
  } else {
    btn.className = 'btn-network offline';
    banner.className = 'status-banner banner-offline';
    statusText.textContent = 'Simulador: MODO OFFLINE';
    bannerTitle.textContent = 'Modo Fuera de Línea Activado';
    bannerDesc.textContent = 'Todas las operaciones se siguen guardando a <50ms en IndexedDB y se encolan como PENDING.';
  }
  renderUI();
});

document.getElementById('btnManualSync').addEventListener('click', () => {
  flushOutbox();
});

// Inicializar al cargar la página
window.addEventListener('DOMContentLoaded', async () => {
  await initIndexedDB();
  renderUI();
});
