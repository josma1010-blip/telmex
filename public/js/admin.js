(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function formatPrice(n) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n || 0);
  }

  function showToast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 3000);
  }

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts
    });
    if (res.status === 401) {
      window.location.href = '/admin/login';
      throw new Error('No autorizado');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error');
    return data;
  }

  // —— Navegación ——
  $$('.sidebar nav a[data-panel]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      $$('.sidebar nav a').forEach(x => x.classList.remove('active'));
      a.classList.add('active');
      $$('.panel').forEach(p => p.classList.remove('active'));
      const panel = $('#panel-' + a.dataset.panel);
      if (panel) panel.classList.add('active');
      if (a.dataset.panel === 'orders') loadOrders();
      if (a.dataset.panel === 'products') loadProducts();
      if (a.dataset.panel === 'dashboard') loadDashboard();
      if (a.dataset.panel === 'webhooks') loadWebhooks();
    });
  });

  $('#logoutBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/admin/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  });

  // —— Dashboard ——
  async function loadDashboard() {
    try {
      const stats = await api('/admin/stats');
      $('#statOrders').textContent = stats.totalOrders;
      $('#statPaid').textContent = stats.paidOrders;
      $('#statRevenue').textContent = formatPrice(stats.revenue);
      $('#statPending').textContent = stats.pending;
      $('#statLow').textContent = stats.lowStock;
      const orders = await api('/admin/orders');
      renderOrdersTable(orders.slice(0, 8), '#recentOrders');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  function statusBadge(s) {
    return `<span class="status ${s}">${s}</span>`;
  }

  function renderOrdersTable(orders, containerSel) {
    const el = $(containerSel);
    if (!orders.length) {
      el.innerHTML = '<p style="color:var(--muted)">No hay órdenes</p>';
      return;
    }
    el.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Orden</th>
            <th>Cliente</th>
            <th>Total</th>
            <th>Estado</th>
            <th>Fecha</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${orders.map(o => `
            <tr>
              <td><strong>${o.order_number}</strong></td>
              <td>${o.customer_name}<br><small style="color:var(--muted)">${o.customer_email}</small></td>
              <td>${formatPrice(o.total)}</td>
              <td>${statusBadge(o.status)}</td>
              <td>${new Date(o.created_at).toLocaleString('es-MX')}</td>
              <td><button class="btn btn-outline btn-sm" data-order="${o.id}">Ver</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // —— Órdenes ——
  async function loadOrders() {
    const status = $('#orderFilter')?.value || '';
    const q = status ? `?status=${status}` : '';
    try {
      const orders = await api('/admin/orders' + q);
      renderOrdersTable(orders, '#ordersTable');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  $('#orderFilter')?.addEventListener('change', loadOrders);
  $('#refreshOrders')?.addEventListener('click', loadOrders);

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-order]');
    if (!btn) return;
    try {
      const order = await api('/admin/orders/' + btn.dataset.order);
      $('#orderDetail').innerHTML = `
        <p><strong>Número:</strong> ${order.order_number}</p>
        <p><strong>Cliente:</strong> ${order.customer_name}</p>
        <p><strong>Email:</strong> ${order.customer_email}</p>
        <p><strong>Teléfono:</strong> ${order.customer_phone}</p>
        ${order.customer_address ? `<p><strong>Dirección:</strong> ${order.customer_address}</p>` : ''}
        <p><strong>Total:</strong> ${formatPrice(order.total)}</p>
        <p><strong>Estado:</strong> ${statusBadge(order.status)}</p>
        <p><strong>Clip:</strong> ${order.clip_status || '—'} ${order.receipt_no ? '· Recibo: ' + order.receipt_no : ''}</p>
        <p><strong>Fecha:</strong> ${new Date(order.created_at).toLocaleString('es-MX')}</p>
        <h3 style="margin:1rem 0 0.5rem;font-size:1rem">Productos</h3>
        <ul style="margin-bottom:1rem">
          ${(order.items || []).map(i => `<li>${i.quantity}× ${i.product_name} (${i.product_type}) — ${formatPrice(i.subtotal)}</li>`).join('')}
        </ul>
        <div class="form-group">
          <label>Cambiar estado</label>
          <select id="newStatus">
            ${['pending','paid','processing','shipped','delivered','cancelled','failed'].map(s =>
              `<option value="${s}" ${s===order.status?'selected':''}>${s}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Notas</label>
          <textarea id="orderNotes" rows="2">${order.notes || ''}</textarea>
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="saveOrderBtn" data-id="${order.id}">Guardar</button>
          ${order.payment_request_id ? `<button class="btn btn-outline btn-sm" id="syncClipBtn" data-id="${order.id}">Sincronizar Clip</button>` : ''}
        </div>
      `;
      $('#orderModal').classList.add('open');
    } catch (ex) {
      showToast(ex.message, 'error');
    }
  });

  $('#orderModalBg')?.addEventListener('click', () => $('#orderModal').classList.remove('open'));

  document.addEventListener('click', async (e) => {
    if (e.target.id === 'saveOrderBtn') {
      const id = e.target.dataset.id;
      try {
        await api('/admin/orders/' + id, {
          method: 'PATCH',
          body: JSON.stringify({
            status: $('#newStatus').value,
            notes: $('#orderNotes').value
          })
        });
        showToast('Orden actualizada', 'success');
        $('#orderModal').classList.remove('open');
        loadOrders();
        loadDashboard();
      } catch (ex) {
        showToast(ex.message, 'error');
      }
    }
    if (e.target.id === 'syncClipBtn') {
      try {
        const data = await api('/admin/orders/' + e.target.dataset.id + '/sync-clip', { method: 'POST' });
        showToast('Sincronizado: ' + (data.clip?.status || data.orderStatus), 'success');
        loadOrders();
      } catch (ex) {
        showToast(ex.message, 'error');
      }
    }
  });

  // —— Productos ——
  function setImagePreview(url) {
    const box = $('#imgPreview');
    if (url) {
      box.innerHTML = `<img src="${url}" alt="preview" onerror="this.parentElement.innerHTML='<span style=color:#aaa>Error al cargar</span>'" />`;
    } else {
      box.innerHTML = '<span style="color:#aaa;font-size:0.85rem;text-align:center;padding:0.5rem">Sin imagen</span>';
    }
  }

  function openProductModal(product) {
    $('#productForm').reset();
    $('#pImageFile').value = '';
    if (product) {
      $('#productModalTitle').textContent = 'Editar producto';
      $('#productId').value = product.id;
      $('#pName').value = product.name || '';
      $('#pSlug').value = product.slug || '';
      $('#pType').value = product.type || 'chip';
      $('#pPrice').value = product.price ?? '';
      $('#pStock').value = product.stock ?? 0;
      $('#pDesc').value = product.description || '';
      $('#pFeatures').value = (product.features || []).join('\n');
      $('#pActive').checked = product.active !== false && product.active !== 0;
      $('#pImageUrl').value = product.image_url || '';
      setImagePreview(product.image_url || '');
    } else {
      $('#productModalTitle').textContent = 'Nuevo producto';
      $('#productId').value = '';
      $('#pImageUrl').value = '';
      $('#pActive').checked = true;
      $('#pStock').value = 0;
      setImagePreview('');
    }
    $('#productModal').classList.add('open');
  }

  async function loadProducts() {
    try {
      const products = await api('/admin/products');
      window._products = products;
      const el = $('#productsTable');
      if (!products.length) {
        el.innerHTML = '<p style="color:var(--muted)">No hay productos. Crea el primero.</p>';
        return;
      }
      el.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Imagen</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Precio</th>
              <th>Stock</th>
              <th>Activo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${products.map(p => `
              <tr data-product-row="${p.id}">
                <td>
                  <img class="prod-thumb" src="${p.image_url || '/img/chip.svg'}" alt=""
                    onerror="this.src='/img/chip.svg'" />
                </td>
                <td>
                  <strong>${escapeHtml(p.name)}</strong>
                  <br><small style="color:var(--muted)">${escapeHtml(p.slug)}</small>
                </td>
                <td>${p.type === 'esim' ? 'eSIM' : 'Chip'}</td>
                <td>
                  <input type="number" class="price-input" data-quick-price="${p.id}"
                    value="${Number(p.price).toFixed(2)}" step="0.01" min="0" title="Cambia y pulsa Enter o Guarda" />
                </td>
                <td>
                  <input type="number" class="stock-input" data-quick-stock="${p.id}"
                    value="${p.stock}" min="0" />
                </td>
                <td>
                  <label style="cursor:pointer">
                    <input type="checkbox" data-quick-active="${p.id}" ${p.active ? 'checked' : ''} />
                  </label>
                </td>
                <td style="white-space:nowrap">
                  <button class="btn btn-primary btn-sm" data-quick-save="${p.id}">Guardar</button>
                  <button class="btn btn-outline btn-sm" data-edit="${p.id}">Editar</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (e) {
      showToast(e.message, 'error');
      $('#productsTable').innerHTML = `<p style="color:var(--danger)">Error: ${e.message}</p>`;
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  $('#newProductBtn')?.addEventListener('click', () => openProductModal(null));
  $('#refreshProducts')?.addEventListener('click', loadProducts);
  $('#cancelProductBtn')?.addEventListener('click', () => $('#productModal').classList.remove('open'));
  $('#productModalBg')?.addEventListener('click', () => $('#productModal').classList.remove('open'));

  // Vista previa al elegir archivo
  $('#pImageFile')?.addEventListener('change', () => {
    const file = $('#pImageFile').files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      showToast('La imagen no debe superar 3 MB', 'error');
      $('#pImageFile').value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  });

  // Editar completo
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit]');
    if (!btn) return;
    const p = (window._products || []).find(x => x.id === Number(btn.dataset.edit));
    if (p) openProductModal(p);
  });

  // Guardar rápido precio/stock/activo desde la tabla
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-quick-save]');
    if (!btn) return;
    const id = btn.dataset.quickSave;
    const row = document.querySelector(`[data-product-row="${id}"]`);
    if (!row) return;
    const price = Number(row.querySelector('[data-quick-price]').value);
    const stock = Number(row.querySelector('[data-quick-stock]').value);
    const active = row.querySelector('[data-quick-active]').checked;
    if (isNaN(price) || price < 0) {
      showToast('Precio inválido', 'error');
      return;
    }
    btn.disabled = true;
    btn.textContent = '...';
    try {
      await api('/admin/products/' + id, {
        method: 'PUT',
        body: JSON.stringify({ price, stock, active })
      });
      showToast('Producto actualizado', 'success');
      loadProducts();
    } catch (ex) {
      showToast(ex.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });

  // Enter en precio/stock = guardar
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const priceEl = e.target.closest('[data-quick-price]');
    const stockEl = e.target.closest('[data-quick-stock]');
    if (!priceEl && !stockEl) return;
    e.preventDefault();
    const id = (priceEl || stockEl).dataset.quickPrice || (priceEl || stockEl).dataset.quickStock;
    const saveBtn = document.querySelector(`[data-quick-save="${id}"]`);
    if (saveBtn) saveBtn.click();
  });

  // Formulario completo (crear / editar)
  $('#productForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = $('#saveProductBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    try {
      let imageUrl = $('#pImageUrl').value || '';
      const file = $('#pImageFile').files?.[0];

      // Subir imagen si eligió un archivo nuevo
      if (file) {
        const base64 = await fileToBase64(file);
        const upload = await api('/admin/upload', {
          method: 'POST',
          body: JSON.stringify({
            filename: file.name,
            data: base64,
            mime: file.type
          })
        });
        imageUrl = upload.url;
      }

      const id = $('#productId').value;
      const body = {
        name: $('#pName').value.trim(),
        slug: $('#pSlug').value.trim(),
        type: $('#pType').value,
        price: Number($('#pPrice').value),
        stock: Number($('#pStock').value) || 0,
        description: $('#pDesc').value.trim(),
        features: $('#pFeatures').value.split('\n').map(s => s.trim()).filter(Boolean),
        active: $('#pActive').checked,
        image_url: imageUrl
      };

      if (!body.name || !body.slug) throw new Error('Nombre y slug son obligatorios');
      if (isNaN(body.price) || body.price < 0) throw new Error('Precio inválido');

      if (id) {
        await api('/admin/products/' + id, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/admin/products', { method: 'POST', body: JSON.stringify(body) });
      }

      showToast('Producto guardado correctamente', 'success');
      $('#productModal').classList.remove('open');
      loadProducts();
    } catch (ex) {
      showToast(ex.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar producto';
    }
  });

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Auto slug al escribir nombre (solo en productos nuevos)
  $('#pName')?.addEventListener('input', () => {
    if ($('#productId').value) return;
    $('#pSlug').value = $('#pName').value
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  });

  // —— Webhooks ——
  async function loadWebhooks() {
    try {
      const events = await api('/admin/webhooks');
      const el = $('#webhooksTable');
      if (!events.length) {
        el.innerHTML = '<p style="color:var(--muted)">Aún no hay eventos de webhook.</p>';
        return;
      }
      el.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Evento</th>
              <th>Payment Request ID</th>
              <th>Resultado</th>
              <th>Orden</th>
            </tr>
          </thead>
          <tbody>
            ${events.map(e => `
              <tr>
                <td>${new Date(e.received_at).toLocaleString('es-MX')}</td>
                <td><code>${e.event_type || '—'}</code></td>
                <td style="font-size:0.75rem;word-break:break-all">${e.payment_request_id || '—'}</td>
                <td>${e.result?.ok ? '✓ ' + (e.result.clipStatus || '') : '✗ ' + (e.result?.message || '')}</td>
                <td>${e.result?.order?.order_number || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  $('#refreshWebhooks')?.addEventListener('click', loadWebhooks);

  // Init
  loadDashboard();
})();
