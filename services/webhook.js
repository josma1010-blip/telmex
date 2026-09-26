/**
 * Procesador de webhooks de Clip Checkout
 * Docs: https://developer.clip.mx/reference/webhookshxo
 *
 * Clip envía notificaciones mínimas:
 *   { "id": "<payment_request_id>", "origin": "checkout-api", "event_type": "INSERT"|"UPDATE" }
 *
 * Luego hay que consultar GET /v2/checkout/{id} para obtener el estado real:
 *   CHECKOUT_CREATED | CHECKOUT_PENDING | CHECKOUT_COMPLETED | CHECKOUT_CANCELLED | CHECKOUT_EXPIRED
 */

const store = require('../db/store');
const clip = require('./clip');

const STATUS_MAP = {
  CHECKOUT_CREATED: 'pending',
  CHECKOUT_PENDING: 'pending',
  CHECKOUT_COMPLETED: 'paid',
  CHECKOUT_CANCELLED: 'failed',
  CHECKOUT_EXPIRED: 'failed'
};

/**
 * Asegura que exista el array de logs de webhooks en el store
 */
function ensureWebhookLog() {
  const data = store;
  // store es un módulo con getters; trabajamos sobre el cache interno vía save
  if (!Array.isArray(require('../db/store')._webhook_events)) {
    // se inicializa en processWebhook la primera vez
  }
}

function getWebhookEvents() {
  // Acceso al cache real del store
  const raw = require('../db/store');
  // El store.js no expone webhook_events todavía; lo añadimos en runtime
  const fs = require('fs');
  const path = require('path');
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'store.json');
  if (!fs.existsSync(dbPath)) return [];
  const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  return data.webhook_events || [];
}

function appendWebhookEvent(event) {
  const fs = require('fs');
  const path = require('path');
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'store.json');
  let data;
  if (fs.existsSync(dbPath)) {
    data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } else {
    data = { products: [], orders: [], order_items: [], admins: [], counters: {}, webhook_events: [] };
  }
  if (!data.webhook_events) data.webhook_events = [];
  data.webhook_events.unshift(event);
  // Mantener solo los últimos 200 eventos
  if (data.webhook_events.length > 200) {
    data.webhook_events = data.webhook_events.slice(0, 200);
  }
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  // Recargar cache del store
  store.reload();
}

/**
 * Descuenta stock de los productos de una orden (solo una vez)
 */
function deductStock(orderId) {
  const items = store.order_items.filter(i => i.order_id === orderId);
  for (const item of items) {
    const product = store.products.find(p => p.id === item.product_id);
    if (product) {
      product.stock = Math.max(0, product.stock - item.quantity);
    }
  }
}

/**
 * Procesa un payment_request_id: consulta Clip y actualiza la orden local
 * @returns {{ ok: boolean, order?: object, clipStatus?: string, message: string }}
 */
async function processPaymentRequest(paymentRequestId, source = 'webhook') {
  if (!paymentRequestId) {
    return { ok: false, message: 'Sin payment_request_id' };
  }

  if (!clip.isConfigured()) {
    return { ok: false, message: 'Clip no configurado' };
  }

  let statusData;
  try {
    statusData = await clip.getPaymentStatus(paymentRequestId);
  } catch (err) {
    console.error(`[webhook] Error consultando Clip ${paymentRequestId}:`, err.message);
    return { ok: false, message: err.message };
  }

  const clipStatus = statusData.status; // CHECKOUT_*
  const orderStatus = STATUS_MAP[clipStatus] || null;

  const order = store.orders.find(o => o.payment_request_id === paymentRequestId);
  if (!order) {
    console.warn(`[webhook] Orden no encontrada para payment_request_id=${paymentRequestId}`);
    return {
      ok: false,
      message: 'Orden no encontrada',
      clipStatus,
      paymentRequestId
    };
  }

  const previousStatus = order.status;
  const wasAlreadyPaid = previousStatus === 'paid';

  // Actualizar campos de Clip siempre
  order.clip_status = clipStatus;
  if (statusData.receipt_no) {
    order.receipt_no = statusData.receipt_no;
  }
  order.updated_at = new Date().toISOString();

  // Guardar info extra útil
  order.clip_amount = statusData.amount != null ? statusData.amount : order.clip_amount;
  order.clip_last_message = statusData.last_status_message || null;

  if (orderStatus && orderStatus !== previousStatus) {
    // Solo avanzar a "paid" o "failed"; no bajar de paid a pending
    if (orderStatus === 'paid' && !wasAlreadyPaid) {
      order.status = 'paid';
      deductStock(order.id);
      console.log(`[webhook] Orden ${order.order_number} → paid (recibo: ${order.receipt_no || 'n/a'})`);
    } else if (orderStatus === 'failed' && !wasAlreadyPaid) {
      order.status = 'failed';
      console.log(`[webhook] Orden ${order.order_number} → failed (${clipStatus})`);
    } else if (orderStatus === 'pending' && previousStatus === 'pending') {
      // sin cambio relevante
    }
  }

  store.save();

  return {
    ok: true,
    order: {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
      previous_status: previousStatus,
      receipt_no: order.receipt_no
    },
    clipStatus,
    message: `Procesado desde ${source}: ${clipStatus}`
  };
}

/**
 * Maneja el payload crudo del webhook de Clip
 */
async function handleClipWebhook(payload, meta = {}) {
  const paymentRequestId = payload?.id || payload?.payment_request_id;
  const eventType = payload?.event_type || 'UNKNOWN';
  const origin = payload?.origin || 'unknown';

  const logEntry = {
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    received_at: new Date().toISOString(),
    payment_request_id: paymentRequestId || null,
    event_type: eventType,
    origin,
    payload,
    ip: meta.ip || null,
    result: null
  };

  if (!paymentRequestId) {
    logEntry.result = { ok: false, message: 'Payload sin id' };
    try { appendWebhookEvent(logEntry); } catch (_) {}
    return { ok: false, message: 'Payload inválido: falta id' };
  }

  // INSERT = link creado; UPDATE = cambio de estado (pago, cancelación, etc.)
  // En ambos casos consultamos el estado actual en Clip para no depender del payload.
  const result = await processPaymentRequest(paymentRequestId, `webhook:${eventType}`);
  logEntry.result = result;

  try {
    appendWebhookEvent(logEntry);
  } catch (e) {
    console.error('[webhook] No se pudo guardar log:', e.message);
  }

  return result;
}

module.exports = {
  handleClipWebhook,
  processPaymentRequest,
  STATUS_MAP,
  getWebhookEvents
};
