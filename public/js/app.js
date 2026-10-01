(() => {
  const cart = JSON.parse(localStorage.getItem('telcel_cart') || '[]');
  let products = [];
  let currentFilter = 'all';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function saveCart() {
    localStorage.setItem('telcel_cart', JSON.stringify(cart));
    updateCartUI();
  }

  function formatPrice(n) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
  }

  function showToast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 3000);
  }

  function updateCartUI() {
    const count = cart.reduce((s, i) => s + i.quantity, 0);
    $('#cartCount').textContent = count;
    const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    $('#cartTotal').textContent = formatPrice(total);
    $('#checkoutBtn').disabled = cart.length === 0;

    const container = $('#cartItems');
    if (cart.length === 0) {
      container.innerHTML = '<div class="empty-cart">Tu carrito está vacío</div>';
      return;
    }
    container.innerHTML = cart.map((item, idx) => `
      <div class="cart-item">
        <div class="cart-item-info">
          <h4>${item.name}</h4>
          <div class="meta">${item.type === 'esim' ? 'eSIM digital' : 'Chip físico'} · ${formatPrice(item.price)}</div>
          <div class="qty-controls">
            <button data-action="dec" data-idx="${idx}">−</button>
            <span>${item.quantity}</span>
            <button data-action="inc" data-idx="${idx}">+</button>
            <button data-action="rm" data-idx="${idx}" style="margin-left:auto;color:var(--danger);border-color:transparent">✕</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  function addToCart(product) {
    const existing = cart.find(i => i.productId === product.id);
    if (existing) {
      if (existing.quantity >= product.stock) {
        showToast('Stock insuficiente', 'error');
        return;
      }
      existing.quantity++;
    } else {
      cart.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        type: product.type,
        quantity: 1,
        stock: product.stock
      });
    }
    saveCart();
    showToast('Agregado al carrito', 'success');
  }

  function renderProducts() {
    const grid = $('#productsGrid');
    const filtered = currentFilter === 'all'
      ? products
      : products.filter(p => p.type === currentFilter);

    if (filtered.length === 0) {
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--muted)">No hay productos en esta categoría</p>';
      return;
    }

    grid.innerHTML = filtered.map(p => `
      <article class="product-card">
        <div class="product-image">
          <span class="type-tag ${p.type}">${p.type === 'esim' ? 'eSIM' : 'CHIP'}</span>
          <img src="${p.image_url || '/img/chip.svg'}" alt="${p.name}" onerror="this.src='/img/chip.svg'" />
        </div>
        <div class="product-body">
          <h3>${p.name}</h3>
          <p>${p.description || ''}</p>
          ${p.features && p.features.length ? `
            <ul class="features-list">
              ${p.features.slice(0, 3).map(f => `<li>${f}</li>`).join('')}
            </ul>
          ` : ''}
          <div class="product-footer">
            <div class="price">${formatPrice(p.price)} <span>${p.stock > 0 ? '· Disponible' : '· Agotado'}</span></div>
            <button class="btn btn-primary" data-add="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>
              Agregar
            </button>
          </div>
        </div>
      </article>
    `).join('');
  }

  async function loadProducts() {
    try {
      const res = await fetch('/api/products');
      products = await res.json();
      renderProducts();
    } catch (e) {
      showToast('Error al cargar productos', 'error');
    }
  }

  // Events
  $$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderProducts();
    });
  });

  $('#productsGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    const product = products.find(p => p.id === Number(btn.dataset.add));
    if (product) addToCart(product);
  });

  $('#cartItems').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    const action = btn.dataset.action;
    if (action === 'inc') {
      if (cart[idx].quantity < cart[idx].stock) cart[idx].quantity++;
      else showToast('Stock insuficiente', 'error');
    } else if (action === 'dec') {
      cart[idx].quantity--;
      if (cart[idx].quantity <= 0) cart.splice(idx, 1);
    } else if (action === 'rm') {
      cart.splice(idx, 1);
    }
    saveCart();
  });

  $('#openCart').addEventListener('click', () => {
    $('#cartDrawer').classList.add('open');
    $('#cartOverlay').classList.add('open');
  });
  $('#closeCart').addEventListener('click', closeCart);
  $('#cartOverlay').addEventListener('click', closeCart);
  function closeCart() {
    $('#cartDrawer').classList.remove('open');
    $('#cartOverlay').classList.remove('open');
  }

  $('#checkoutBtn').addEventListener('click', () => {
    closeCart();
    $('#checkoutModal').classList.add('open');
  });
  $('#modalBackdrop').addEventListener('click', () => {
    $('#checkoutModal').classList.remove('open');
  });

  $('#checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payBtn = $('#payBtn');
    payBtn.disabled = true;
    payBtn.innerHTML = '<span class="spinner"></span> Procesando...';

    const selectedLada = $('#lada').value;
    if (!selectedLada) {
      showToast('Selecciona una clave LADA (obligatoria para chips físicos y eSIM)', 'error');
      $('#lada').focus();
      payBtn.disabled = false;
      payBtn.textContent = 'Continuar al pago';
      return;
    }

    const customer = {
      name: $('#name').value.trim(),
      email: $('#email').value.trim(),
      phone: $('#phone').value.trim(),
      address: $('#address').value.trim(),
      lada: selectedLada
    };

    const items = cart.map(i => ({
      productId: i.productId,
      quantity: i.quantity
    }));

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, customer })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error en el checkout');

      // Vaciar carrito
      cart.length = 0;
      saveCart();

      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        showToast(data.message || 'Orden creada', 'success');
        $('#checkoutModal').classList.remove('open');
      }
    } catch (err) {
      showToast(err.message, 'error');
      payBtn.disabled = false;
      payBtn.textContent = 'Continuar al pago';
    }
  });

  // Init
  updateCartUI();
  loadProducts();
})();
