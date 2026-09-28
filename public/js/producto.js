(() => {
  const cart = JSON.parse(localStorage.getItem('telcel_cart') || '[]');
  let product = null;

  const $ = (sel) => document.querySelector(sel);

  function getSlugFromUrl() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    // Expect ['producto', 'slug']
    const idx = parts.indexOf('producto');
    if (idx !== -1 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]);
    return parts[parts.length - 1] || '';
  }

  function saveCart() {
    localStorage.setItem('telcel_cart', JSON.stringify(cart));
    updateCartUI();
  }

  function formatPrice(n) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
  }

  function showToast(msg, type = '') {
    const t = $('#toast');
    if (!t) return;
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

  function addToCart(p) {
    const existing = cart.find(i => i.productId === p.id);
    if (existing) {
      if (existing.quantity >= p.stock) {
        showToast('Stock insuficiente', 'error');
        return;
      }
      existing.quantity++;
    } else {
      cart.push({
        productId: p.id,
        name: p.name,
        price: p.price,
        type: p.type,
        quantity: 1,
        stock: p.stock
      });
    }
    saveCart();
    showToast('Agregado al carrito', 'success');
  }

  function renderProduct(p) {
    document.getElementById('productoLoading').style.display = 'none';
    document.getElementById('productoDetail').style.display = 'block';

    const title = `${p.name} — Telcel Store`;
    document.title = title;
    document.getElementById('pageTitle').textContent = title;
    const desc = p.description || 'Compra chips Telcel y eSIM Telcel en línea.';
    document.getElementById('pageDescription').setAttribute('content', desc);
    document.getElementById('ogTitle').setAttribute('content', title);
    document.getElementById('ogDescription').setAttribute('content', desc);
    document.getElementById('ogImage').setAttribute('content', p.image_url || '/img/chip.svg');
    document.getElementById('ogUrl').setAttribute('content', window.location.href);

    $('#productoName').textContent = p.name;
    $('#productoDescription').textContent = p.description || '';
    $('#productoPrice').textContent = formatPrice(p.price);
    $('#productoStock').textContent = p.stock > 0 ? '✓ Disponible' : '✕ Agotado';
    $('#productoStock').style.color = p.stock > 0 ? 'var(--success)' : 'var(--danger)';

    const typeTag = $('#productoType');
    typeTag.textContent = p.type === 'esim' ? 'eSIM' : 'CHIP';
    typeTag.className = 'type-tag ' + p.type;

    const img = $('#productoImage');
    img.src = p.image_url || '/img/chip.svg';
    img.alt = p.name;

    const featuresEl = $('#productoFeatures');
    if (p.features && p.features.length) {
      featuresEl.innerHTML = p.features.map(f => `<li>${f}</li>`).join('');
    } else {
      featuresEl.innerHTML = '';
    }

    const addBtn = $('#addToCartBtn');
    if (p.stock <= 0) {
      addBtn.disabled = true;
      addBtn.textContent = 'Agotado';
    } else {
      addBtn.disabled = false;
      addBtn.textContent = 'Agregar al carrito';
    }
    addBtn.addEventListener('click', () => {
      if (product) addToCart(product);
    });
  }

  function showError() {
    document.getElementById('productoLoading').style.display = 'none';
    document.getElementById('productoError').style.display = 'block';
  }

  async function loadProduct() {
    const slug = getSlugFromUrl();
    if (!slug) {
      showError();
      return;
    }
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        showError();
        return;
      }
      if (!res.ok) throw new Error('Error al cargar el producto');
      product = await res.json();
      renderProduct(product);
    } catch (e) {
      showError();
    }
  }

  // Cart drawer events
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
    // El checkout se completa en la tienda principal
    window.location.href = '/#productos';
  });

  // Init
  updateCartUI();
  loadProduct();
})();
