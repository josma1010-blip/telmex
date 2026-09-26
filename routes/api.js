const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const store = require('../db/store');
const clip = require('../services/clip');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ========== PÚBLICO ==========

router.get('/products', (req, res) => {
  const type = req.query.type;
  let products = store.products.filter(p => p.active);
  if (type === 'chip' || type === 'esim') {
    products = products.filter(p => p.type === type);
  }
  products.sort((a, b) => a.type.localeCompare(b.type) || a.price - b.price);
  res.json(products.map(({ id, name, slug, type, description, price, stock, image_url, features }) =>
    ({ id, name, slug, type, description, price, stock, image_url, features: features || [] })
  ));
});

router.get('/products/:slug', (req, res) => {
  const p = store.products.find(x => x.slug === req.params.slug && x.active);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json({
    id: p.id, name: p.name, slug: p.slug, type: p.type,
    description: p.description, price: p.price, stock: p.stock,
    image_url: p.image_url, features: p.features || []
  });
});

router.post('/checkout', async (req, res) => {
  try {
    const { items, customer } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Carrito vacío' });
    }
    if (!customer?.name || !customer?.email || !customer?.phone) {
      return res.status(400).json({ error: 'Datos de cliente incompletos' });
    }

    let total = 0;
    const lineItems = [];
    for (const item of items) {
      const product = store.products.find(p => p.id === item.productId && p.active);
      if (!product) return res.status(400).json({ error: `Producto ${item.productId} no existe` });
      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
      if (product.stock < qty) {
        return res.status(400).json({ error: `Stock insuficiente de ${product.name}` });
      }
      const subtotal = product.price * qty;
      total += subtotal;
      lineItems.push({
        product_id: product.id,
        product_name: product.name,
        product_type: product.type,
        quantity: qty,
        unit_price: product.price,
        subtotal
      });
    }

    const orderNumber = 'TC-' + Date.now().toString(36).toUpperCase() + '-' + uuidv4().slice(0, 6).toUpperCase();
    const orderId = store.nextId('order');
    const order = {
      id: orderId,
      order_number: orderNumber,
      customer_name: customer.name.trim(),
      customer_email: customer.email.trim().toLowerCase(),
      customer_phone: customer.phone.trim(),
      customer_address: customer.address || null,
      total,
      status: 'pending',
      payment_request_id: null,
      payment_request_url: null,
      receipt_no: null,
      clip_status: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    store.orders.push(order);

    for (const li of lineItems) {
      const itemId = store.nextId('order_item');
      store.order_items.push({ id: itemId, order_id: orderId, ...li });
    }
    store.save();

    if (!clip.isConfigured()) {
      order.status = 'paid';
      order.clip_status = 'DEMO';
      order.updated_at = new Date().toISOString();
      for (const li of lineItems) {
        const p = store.products.find(x => x.id === li.product_id);
        if (p) p.stock = Math.max(0, p.stock - li.quantity);
      }
      store.save();
      return res.json({
        success: true,
        demo: true,
        orderNumber,
        message: 'Clip no configurado. Orden marcada como pagada en modo demo.',
        redirectUrl: `/pago/exito?order=${orderNumber}`
      });
    }

    const description = lineItems.map(i => `${i.quantity}x ${i.product_name}`).join(', ');
    const payment = await clip.createPaymentLink({
      amount: total,
      description: `Orden ${orderNumber}: ${description}`,
      orderNumber,
      customer: { name: customer.name, email: customer.email, phone: customer.phone }
    });

    order.payment_request_id = payment.payment_request_id;
    order.payment_request_url = payment.payment_request_url;
    order.clip_status = payment.status;
    order.updated_at = new Date().toISOString();
    store.save();

    res.json({
      success: true,
      orderNumber,
      paymentRequestId: payment.payment_request_id,
      redirectUrl: payment.payment_request_url
    });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: err.message || 'Error al procesar el pago' });
  }
});

// ========== WEBHOOKS CLIP ==========
// Docs: https://developer.clip.mx/reference/webhookshxo
// Clip envía { id, origin, event_type } y debemos consultar GET /v2/checkout/{id}
const webhookService = require('../services/webhook');

router.post('/webhooks/clip', async (req, res) => {
  // Siempre responder 200 rápido para que Clip no reintente en vano
  // El procesamiento se hace en background (pero awaiteamos para logs consistentes)
  try {
    const payload = req.body || {};
    console.log('[webhook/clip] recibido:', JSON.stringify(payload));

    const result = await webhookService.handleClipWebhook(payload, {
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress
    });

    console.log('[webhook/clip] resultado:', result.message, result.order?.order_number || '');
    // Clip solo espera HTTP 200; el cuerpo no se valida
    res.status(200).json({ received: true });
  } catch (e) {
    console.error('[webhook/clip] error no controlado:', e);
    // Aun así 200 para no provocar reintentos infinitos por errores nuestros
    res.status(200).json({ received: true, error: 'internal' });
  }
});

/**
 * Sincroniza el estado de una orden consultando Clip (útil en /pago/exito
 * por si el webhook aún no llegó, o desde el admin).
 * Público solo con order_number (no expone datos sensibles de más).
 */
router.post('/orders/:orderNumber/sync', async (req, res) => {
  try {
    const order = store.orders.find(o => o.order_number === req.params.orderNumber);
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    if (!order.payment_request_id) {
      return res.json({
        success: true,
        status: order.status,
        message: 'Sin payment_request_id (modo demo o pendiente de link)'
      });
    }
    if (!clip.isConfigured()) {
      return res.json({ success: true, status: order.status, message: 'Clip no configurado' });
    }

    const result = await webhookService.processPaymentRequest(
      order.payment_request_id,
      'sync-endpoint'
    );

    // Releer orden actualizada
    const updated = store.orders.find(o => o.id === order.id);
    res.json({
      success: result.ok,
      status: updated?.status || order.status,
      clip_status: updated?.clip_status || null,
      receipt_no: updated?.receipt_no || null,
      message: result.message
    });
  } catch (e) {
    console.error('sync error:', e);
    res.status(500).json({ error: e.message });
  }
});

/** Admin: listar últimos eventos de webhook */
router.get('/admin/webhooks', requireAdmin, (req, res) => {
  try {
    const events = webhookService.getWebhookEvents();
    res.json(events.slice(0, 50));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/orders/:orderNumber', (req, res) => {
  const order = store.orders.find(o => o.order_number === req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
  const items = store.order_items
    .filter(i => i.order_id === order.id)
    .map(({ product_name, product_type, quantity, unit_price, subtotal }) =>
      ({ product_name, product_type, quantity, unit_price, subtotal }));
  res.json({
    order_number: order.order_number,
    customer_name: order.customer_name,
    total: order.total,
    status: order.status,
    created_at: order.created_at,
    receipt_no: order.receipt_no,
    items
  });
});

// ========== ADMIN ==========

router.post('/admin/login', (req, res) => {
  const { email, password } = req.body;
  const admin = store.admins.find(a => a.email === email);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  req.session.adminId = admin.id;
  req.session.adminEmail = admin.email;
  res.json({ success: true, name: admin.name });
});

router.post('/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get('/admin/me', requireAdmin, (req, res) => {
  const admin = store.admins.find(a => a.id === req.session.adminId);
  if (!admin) return res.status(401).json({ error: 'No autorizado' });
  res.json({ id: admin.id, email: admin.email, name: admin.name });
});

router.get('/admin/stats', requireAdmin, (req, res) => {
  const totalOrders = store.orders.length;
  const paidOrders = store.orders.filter(o => o.status === 'paid').length;
  const revenue = store.orders
    .filter(o => ['paid', 'processing', 'shipped', 'delivered'].includes(o.status))
    .reduce((s, o) => s + o.total, 0);
  const pending = store.orders.filter(o => o.status === 'pending').length;
  const lowStock = store.products.filter(p => p.active && p.stock < 10).length;
  res.json({ totalOrders, paidOrders, revenue, pending, lowStock });
});


// Subir imagen de producto (base64 → public/uploads)
router.post('/admin/upload', requireAdmin, (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { filename, data, mime } = req.body || {};
    if (!data || typeof data !== 'string' || !data.startsWith('data:')) {
      return res.status(400).json({ error: 'Imagen inválida' });
    }
    const match = data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Formato de imagen no soportado' });
    }
    const mimeType = mime || match[1];
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (!allowed.includes(mimeType)) {
      return res.status(400).json({ error: 'Solo se permiten JPG, PNG, WebP, GIF o SVG' });
    }
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 3 * 1024 * 1024) {
      return res.status(400).json({ error: 'La imagen no debe superar 3 MB' });
    }
    const extMap = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg'
    };
    let ext = extMap[mimeType] || '.jpg';
    if (filename && /\.(jpe?g|png|webp|gif|svg)$/i.test(filename)) {
      ext = path.extname(filename).toLowerCase();
    }
    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const safeName = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.writeFileSync(path.join(uploadsDir, safeName), buffer);
    res.json({ success: true, url: '/uploads/' + safeName });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message || 'Error al subir imagen' });
  }
});

router.get('/admin/products', requireAdmin, (req, res) => {
  res.json([...store.products].sort((a, b) => b.id - a.id));
});

router.post('/admin/products', requireAdmin, (req, res) => {
  const { name, slug, type, description, price, stock, image_url, features, active } = req.body;
  if (!name || !slug || !type || price == null) {
    return res.status(400).json({ error: 'Campos requeridos faltantes' });
  }
  if (store.products.some(p => p.slug === slug)) {
    return res.status(400).json({ error: 'Slug ya existe' });
  }
  const id = store.nextId('product');
  store.products.push({
    id, name, slug, type,
    description: description || '',
    price: Number(price),
    stock: Number(stock) || 0,
    image_url: image_url || '',
    features: features || [],
    active: active !== false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  store.save();
  res.json({ id, success: true });
});

router.put('/admin/products/:id', requireAdmin, (req, res) => {
  const p = store.products.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const { name, slug, type, description, price, stock, image_url, features, active } = req.body;
  if (name != null) p.name = name;
  if (slug != null) p.slug = slug;
  if (type != null) p.type = type;
  if (description != null) p.description = description;
  if (price != null) p.price = Number(price);
  if (stock != null) p.stock = Number(stock);
  if (image_url != null) p.image_url = image_url;
  if (features != null) p.features = features;
  if (active != null) p.active = !!active;
  p.updated_at = new Date().toISOString();
  store.save();
  res.json({ success: true });
});

router.delete('/admin/products/:id', requireAdmin, (req, res) => {
  const p = store.products.find(x => x.id === Number(req.params.id));
  if (p) {
    p.active = false;
    p.updated_at = new Date().toISOString();
    store.save();
  }
  res.json({ success: true });
});

router.get('/admin/orders', requireAdmin, (req, res) => {
  let orders = [...store.orders];
  if (req.query.status) orders = orders.filter(o => o.status === req.query.status);
  orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(orders.slice(0, 200));
});

router.get('/admin/orders/:id', requireAdmin, (req, res) => {
  const order = store.orders.find(o => o.id === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'No encontrada' });
  const items = store.order_items.filter(i => i.order_id === order.id);
  res.json({ ...order, items });
});

router.patch('/admin/orders/:id', requireAdmin, (req, res) => {
  const order = store.orders.find(o => o.id === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'No encontrada' });
  const { status, notes } = req.body;
  const allowed = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'failed'];
  if (status && !allowed.includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }
  if (status) order.status = status;
  if (notes != null) order.notes = notes;
  order.updated_at = new Date().toISOString();
  store.save();
  res.json({ success: true });
});

router.post('/admin/orders/:id/sync-clip', requireAdmin, async (req, res) => {
  try {
    const order = store.orders.find(o => o.id === Number(req.params.id));
    if (!order || !order.payment_request_id) {
      return res.status(400).json({ error: 'Sin payment_request_id' });
    }
    const data = await clip.getPaymentStatus(order.payment_request_id);
    if (data.status === 'CHECKOUT_COMPLETED' && order.status !== 'paid') {
      order.status = 'paid';
      const items = store.order_items.filter(i => i.order_id === order.id);
      for (const item of items) {
        const p = store.products.find(x => x.id === item.product_id);
        if (p) p.stock = Math.max(0, p.stock - item.quantity);
      }
    }
    order.clip_status = data.status;
    order.receipt_no = data.receipt_no || null;
    order.updated_at = new Date().toISOString();
    store.save();
    res.json({ success: true, clip: data, orderStatus: order.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
