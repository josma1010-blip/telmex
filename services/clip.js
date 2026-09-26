require('dotenv').config();

const CLIP_API_KEY = process.env.CLIP_API_KEY || '';
const CLIP_API_SECRET = process.env.CLIP_API_SECRET || '';
const CLIP_SANDBOX = process.env.CLIP_SANDBOX !== 'false';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const API_BASE = 'https://api.payclip.com';

function getAuthHeader() {
  if (!CLIP_API_KEY || !CLIP_API_SECRET) {
    throw new Error('CLIP_API_KEY y CLIP_API_SECRET no están configurados');
  }
  const token = Buffer.from(`${CLIP_API_KEY}:${CLIP_API_SECRET}`).toString('base64');
  return `Basic ${token}`;
}

/**
 * Crea un link de pago en Clip Checkout (redireccionado)
 * Docs: https://developer.clip.mx/reference/createnewpaymentlink
 */
async function createPaymentLink({ amount, description, orderNumber, customer, webhookUrl }) {
  const body = {
    amount: Number(amount.toFixed(2)),
    currency: 'MXN',
    purchase_description: description.slice(0, 250),
    redirection_url: {
      success: `${BASE_URL}/pago/exito?order=${orderNumber}`,
      error: `${BASE_URL}/pago/error?order=${orderNumber}`,
      default: `${BASE_URL}/`
    },
    webhook_url: webhookUrl || `${BASE_URL}/api/webhooks/clip`,
    metadata: {
      external_reference: orderNumber,
      customer_info: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone
      }
    },
    override_settings: {
      locale: 'es-MX',
      tip_enabled: false
    }
  };

  const res = await fetch(`${API_BASE}/v2/checkout`, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data.message || data.detail || data.error || JSON.stringify(data);
    throw new Error(`Clip error ${res.status}: ${msg}`);
  }

  return {
    payment_request_id: data.payment_request_id,
    payment_request_url: data.payment_request_url,
    status: data.status,
    qr_image_url: data.qr_image_url,
    expires_at: data.expires_at
  };
}

/**
 * Consulta el estado de un link de pago
 */
async function getPaymentStatus(paymentRequestId) {
  const res = await fetch(`${API_BASE}/v2/checkout/${paymentRequestId}`, {
    method: 'GET',
    headers: {
      Authorization: getAuthHeader(),
      Accept: 'application/json'
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Clip status error ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function isConfigured() {
  return Boolean(CLIP_API_KEY && CLIP_API_SECRET);
}

module.exports = {
  createPaymentLink,
  getPaymentStatus,
  isConfigured,
  CLIP_SANDBOX
};
