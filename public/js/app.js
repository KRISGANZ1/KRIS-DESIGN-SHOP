const app = document.getElementById('app');

const state = {
  products: [],
  categories: [],
  paymentMethods: [],
  galleryImages: [],
  cart: JSON.parse(localStorage.getItem('kds-cart') || '[]'),
  selectedCategory: '',
  searchTerm: '',
  sortBy: 'newest',
  currentPage: 1,
  pageSize: 8,
  currentRoute: window.location.pathname || '/',
  orderCode: localStorage.getItem('kds-last-order-code') || '',
  adminSession: null,
  adminOrders: [],
  editingCategoryId: '',
  editingProductId: '',
  editingPaymentMethodId: '',
  orderPollTimer: null,
};

const routes = {
  '/': 'home',
  '/products': 'products',
  '/product': 'product',
  '/cart': 'cart',
  '/checkout': 'checkout',
  '/payment': 'payment',
  '/orders': 'orders',
  '/about': 'about',
  '/contact': 'contact',
  '/privacy': 'privacy',
  '/terms': 'terms',
  '/login/admin': 'admin',
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatPrice(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function showToast(message, type = 'success') {
  const container = document.querySelector('.toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2600);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

function setRoute(path) {
  const normalized = path || '/';
  const nextUrl = new URL(normalized, window.location.origin);
  const nextRoute = `${nextUrl.pathname}${nextUrl.search}`;
  if (nextRoute === state.currentRoute) {
    render();
    return;
  }
  if (state.orderPollTimer) {
    window.clearInterval(state.orderPollTimer);
    state.orderPollTimer = null;
  }
  document.querySelector('.route-loader')?.remove();
  const loader = document.createElement('div');
  loader.className = 'route-loader';
  document.body.appendChild(loader);
  window.history.pushState({}, '', nextRoute);
  state.currentRoute = nextRoute;
  window.setTimeout(() => {
    render();
    loader.classList.add('complete');
    window.setTimeout(() => loader.remove(), 300);
  }, 140);
}

function getCurrentRouteInfo() {
  const url = new URL(state.currentRoute || window.location.pathname, window.location.origin);
  return {
    pathname: url.pathname,
    searchParams: url.searchParams,
  };
}

function getProductBySlug(slug) {
  return state.products.find((product) => product.slug === slug) || null;
}

function dedupeCart() {
  const map = new Map();
  state.cart.forEach((item) => {
    const key = item.productId;
    if (!map.has(key)) map.set(key, item);
    else {
      map.get(key).quantity += Number(item.quantity || 1);
    }
  });
  state.cart = Array.from(map.values());
  localStorage.setItem('kds-cart', JSON.stringify(state.cart));
}

function addToCart(productId, productName, price, imageUrl, quantity = 1) {
  const existing = state.cart.find((item) => item.productId === productId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    state.cart.push({ productId, productName, price, imageUrl, quantity });
  }
  dedupeCart();
  showToast(`${productName} ditambahkan ke keranjang.`, 'success');
  render();
}

function updateCartQuantity(productId, delta) {
  const item = state.cart.find((entry) => entry.productId === productId);
  if (!item) return;
  item.quantity = Math.max(1, Number(item.quantity || 1) + delta);
  localStorage.setItem('kds-cart', JSON.stringify(state.cart));
  render();
}

function removeFromCart(productId) {
  state.cart = state.cart.filter((item) => item.productId !== productId);
  localStorage.setItem('kds-cart', JSON.stringify(state.cart));
  render();
}

function getCartTotal() {
  return state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
}

function getCartCount() {
  return state.cart.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(data.message || 'Permintaan gagal.');
  }
  return data;
}

async function readJsonResponse(response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    const contentType = response.headers.get('content-type') || '';
    const message = contentType.includes('text/html')
      ? 'Server mengembalikan halaman, bukan respons API. Muat ulang halaman dan coba lagi.'
      : 'Respons server tidak valid. Coba lagi beberapa saat.';
    throw new Error(message);
  }
}

async function loadProducts() {
  try {
    const data = await fetchJson('/api/products');
    state.products = data.products || [];
  } catch (error) {
    showToast(error.message || 'Gagal memuat produk.', 'error');
  }
}

async function loadCategories() {
  try {
    const data = await fetchJson('/api/categories');
    state.categories = data.categories || [];
  } catch (error) {
    console.error(error);
  }
}

async function loadPaymentMethods() {
  try {
    const data = await fetchJson('/api/payment-methods');
    state.paymentMethods = data.methods || [];
  } catch (error) {
    console.error(error);
    state.paymentMethods = [];
  }
}

async function loadGalleryImages() {
  try {
    const data = await fetchJson('/api/gallery-images');
    state.galleryImages = data.images && data.images.length ? data.images : [
      { id: 'placeholder', name: 'Placeholder', url: '/assets/placeholder-product.svg' },
    ];
  } catch (error) {
    console.error(error);
    state.galleryImages = [{ id: 'placeholder', name: 'Placeholder', url: '/assets/placeholder-product.svg' }];
  }
}

async function loadAdminDashboard() {
  if (!state.adminSession) return;
  const data = await fetchJson('/api/admin/dashboard');
  state.categories = data.categories || [];
  state.products = data.products || [];
  state.adminOrders = data.orders || [];
  state.paymentMethods = data.paymentMethods || [];
}

async function loadAdminSession() {
  try {
    const data = await fetchJson('/api/admin/session');
    return data.admin;
  } catch (error) {
    return null;
  }
}

function renderHeader() {
  const cartCount = getCartCount();
  return `
    <header class="site-header">
      <div class="container header-inner">
        <a class="brand" href="/" data-navigate="/">
          <span class="brand-mark">
            <svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-label="brand logo">
              <path d="M38 28h18l18 20V28h16v72H74L38 58V28zm24 22l10 12-10 12h8l8-10 8 10h8l-10-12 10-12h-8l-8 10-8-10h-8z" fill="#fff"/>
            </svg>
          </span>
          <span>KRIS DESIGN SHOP</span>
        </a>
        <nav class="nav">
          <a href="/" data-navigate="/">Beranda</a>
          <a href="/products" data-navigate="/products">Semua Produk</a>
          <a href="/about" data-navigate="/about">Tentang Kami</a>
          <a href="/contact" data-navigate="/contact">Kontak</a>
          <a href="/orders" data-navigate="/orders">Cek Pesanan</a>
        </nav>
        <div class="header-actions">
          <button class="icon-button" data-navigate="/cart" aria-label="Keranjang">🛒 <span>${cartCount}</span></button>
          <button class="secondary-button" data-navigate="/checkout">Checkout</button>
        </div>
      </div>
    </header>
  `;
}

function renderFooter() {
  return `
    <footer class="site-footer">
      <div class="container footer-grid">
        <div class="footer-block">
          <h3>KRIS DESIGN SHOP</h3>
          <p>Kebutuhan Gaming dan Kreativitas Digital, Semua Ada di Sini.</p>
        </div>
        <div class="footer-block">
          <h3>Navigasi</h3>
          <ul>
            <li><a href="/products" data-navigate="/products">Semua Produk</a></li>
            <li><a href="/about" data-navigate="/about">Tentang Kami</a></li>
            <li><a href="/privacy" data-navigate="/privacy">Kebijakan Privasi</a></li>
            <li><a href="/terms" data-navigate="/terms">Syarat & Ketentuan</a></li>
          </ul>
        </div>
        <div class="footer-block">
          <h3>Kontak</h3>
          <ul>
            <li>Instagram: @krisdesignreal23</li>
            <li>WhatsApp: +6285782554720</li>
            <li>Email: krisdesign0@gmail.com</li>
          </ul>
        </div>
        <div class="footer-block">
          <h3>Bantuan</h3>
          <ul>
            <li><a href="/contact" data-navigate="/contact">Kontak & Bantuan</a></li>
            <li><a href="/orders" data-navigate="/orders">Cek Pesanan</a></li>
            <li><a href="/payment" data-navigate="/payment">Pembayaran</a></li>
          </ul>
        </div>
      </div>
    </footer>
  `;
}

function renderHero() {
  const featureProduct = state.products.find((product) => product.is_featured) || state.products[0];
  return `
    <section class="hero">
      <div class="container hero-grid">
        <div class="hero-card">
          <span class="eyebrow">Premium Digital Store</span>
          <h1>Kebutuhan Gaming dan Kreativitas Digital, <span>Semua Ada di Sini.</span></h1>
          <p class="lead">Temukan akun game, diamond, jasa desain logo, banner, grafis, hingga produk digital premium dengan proses cepat dan aman.</p>
          <div class="hero-actions">
            <button class="primary-button" data-navigate="/products">Belanja Sekarang</button>
            <button class="secondary-button" data-navigate="/about">Kenali Kami</button>
          </div>
          <div class="stats-row">
            <div class="stat-box"><strong>100%</strong><span>Proses aman</span></div>
            <div class="stat-box"><strong>Fast</strong><span>Respons cepat</span></div>
            <div class="stat-box"><strong>IDR</strong><span>Payment fleksibel</span></div>
          </div>
        </div>
        <div class="hero-visual">
          <div class="product-spotlight">
            <img src="${featureProduct ? featureProduct.image_url : '/assets/placeholder-product.svg'}" alt="${escapeHtml(featureProduct ? featureProduct.name : 'Produk unggulan')}" />
            <div class="product-pricing">
              <div>
                <div class="product-tag">Produk unggulan</div>
                <h3 style="margin: 12px 0 0;">${escapeHtml(featureProduct ? featureProduct.name : 'Produk premium')}</h3>
              </div>
              <strong>${formatPrice(featureProduct ? featureProduct.sale_price || featureProduct.price : 0)}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderCategories() {
  const activeCategories = state.categories.filter((category) => Number(category.is_active ?? 1));
  const cats = activeCategories.length ? activeCategories : [
    { name: 'Akun Free Fire', icon: 'FF' },
    { name: 'Akun Mobile Legends', icon: 'ML' },
    { name: 'Akun Game Lainnya', icon: 'G' },
    { name: 'Diamond & Top Up Game', icon: 'D' },
    { name: 'Desain Logo', icon: 'L' },
    { name: 'Desain Banner', icon: 'B' },
    { name: 'Jasa Desain Grafis', icon: 'GS' },
    { name: 'Produk Digital Lainnya', icon: 'PD' },
  ];

  return `
    <section class="section">
      <div class="container">
        <div class="section-header">
          <h2>Kategori Produk</h2>
        </div>
        <div class="category-grid">
          ${cats.map((category) => `
            <button class="category-card" data-category="${escapeHtml(category.id || category.slug || category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}" data-navigate="/products?category=${encodeURIComponent(category.id || category.slug || category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">
              <div class="category-icon">${escapeHtml(category.icon || category.name.slice(0,2).toUpperCase())}</div>
              <h3>${escapeHtml(category.name)}</h3>
              <p>${escapeHtml(category.description || 'Koleksi produk premium dan siap pakai.')}</p>
            </button>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderProductCard(product) {
  const price = product.sale_price && Number(product.sale_price) < Number(product.price) ? product.sale_price : product.price;
  const regularPrice = Number(product.price || 0);
  return `
    <article class="product-card">
      <a href="/product/${encodeURIComponent(product.slug)}" data-navigate="/product/${encodeURIComponent(product.slug)}">
        <img src="${product.image_url || '/assets/placeholder-product.svg'}" alt="${escapeHtml(product.name)}" />
      </a>
      <div class="product-body">
        <div class="meta-row">
          <span class="stock-badge">${Number(product.stock) > 0 ? 'Stok tersedia' : 'Stok habis'}</span>
          ${product.is_new ? '<span class="product-tag">Baru</span>' : ''}
        </div>
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.short_description || product.description || 'Produk digital premium.')}</p>
        <div class="price-box">
          <strong>${formatPrice(price)}</strong>
          ${regularPrice > Number(price) ? `<small>${formatPrice(regularPrice)}</small>` : ''}
        </div>
        <div class="product-actions">
          <button class="secondary-button" data-navigate="/product/${encodeURIComponent(product.slug)}">Lihat</button>
          <button class="primary-button" data-add-to-cart="${encodeURIComponent(product.id)}">Tambah</button>
        </div>
      </div>
    </article>
  `;
}

function renderProducts() {
  const filteredProducts = state.products.filter((product) => {
    if (state.selectedCategory && product.category_id !== state.selectedCategory) return false;
    if (state.searchTerm) {
      const term = state.searchTerm.toLowerCase();
      const content = `${product.name} ${product.description || ''} ${product.short_description || ''}`.toLowerCase();
      if (!content.includes(term)) return false;
    }
    return product.is_active !== 0;
  });

  const sorted = [...filteredProducts].sort((a, b) => {
    switch (state.sortBy) {
      case 'price_asc': return Number(a.sale_price || a.price) - Number(b.sale_price || b.price);
      case 'price_desc': return Number(b.sale_price || b.price) - Number(a.sale_price || a.price);
      default: return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }
  });

  const start = (state.currentPage - 1) * state.pageSize;
  const paginated = sorted.slice(start, start + state.pageSize);
  const totalPages = Math.max(1, Math.ceil(sorted.length / state.pageSize));

  return `
    <section class="section">
      <div class="container">
        <div class="page-shell">
          <div class="page-hero">
            <span class="eyebrow">Katalog Produk</span>
            <h1>Semua Produk</h1>
          </div>
          <div class="filter-panel">
            <div class="filter-row">
              <div class="field" style="flex: 2; min-width: 220px;">
                <label for="search-product">Cari produk</label>
                <input id="search-product" type="text" placeholder="Cari akun, desain, atau digital..." value="${escapeHtml(state.searchTerm)}" />
              </div>
              <div class="field">
                <label for="category-filter">Kategori</label>
                <select id="category-filter">
                  <option value="">Semua Kategori</option>
                  ${state.categories.map((category) => `
                    <option value="${escapeHtml(category.id)}" ${state.selectedCategory === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>
                  `).join('')}
                </select>
              </div>
              <div class="field">
                <label for="sort-filter">Urutkan</label>
                <select id="sort-filter">
                  <option value="newest" ${state.sortBy === 'newest' ? 'selected' : ''}>Terbaru</option>
                  <option value="price_asc" ${state.sortBy === 'price_asc' ? 'selected' : ''}>Harga Terendah</option>
                  <option value="price_desc" ${state.sortBy === 'price_desc' ? 'selected' : ''}>Harga Tertinggi</option>
                </select>
              </div>
            </div>
          </div>

          <div class="products-toolbar" style="margin-top: 20px;">
            <div class="results-label">Menampilkan ${sorted.length} produk</div>
          </div>

          <div class="product-grid">
            ${paginated.length ? paginated.map(renderProductCard).join('') : '<div class="empty-state">Produk tidak tersedia untuk filter saat ini.</div>'}
          </div>

          <div class="pagination">
            <button class="ghost-button" data-page-change="prev" ${state.currentPage <= 1 ? 'disabled' : ''}>Sebelumnya</button>
            <span class="results-label">Halaman ${state.currentPage} / ${totalPages}</span>
            <button class="ghost-button" data-page-change="next" ${state.currentPage >= totalPages ? 'disabled' : ''}>Berikutnya</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderProductDetail(slug) {
  const product = getProductBySlug(slug);
  if (!product) {
    return `
      <section class="section"><div class="container"><div class="page-hero"><h1>Produk tidak ditemukan</h1><p>Produk yang Anda cari tidak tersedia atau telah dihapus.</p></div></div></section>
    `;
  }
  return `
    <section class="section">
      <div class="container">
        <div class="page-shell">
          <div class="page-hero">
            <span class="eyebrow">Detail Produk</span>
            <h1>${escapeHtml(product.name)}</h1>
          </div>
          <div class="product-detail" style="margin-top: 22px;">
            <div class="detail-image">
              <img src="${product.image_url || '/assets/placeholder-product.svg'}" alt="${escapeHtml(product.name)}" />
            </div>
            <div class="detail-body">
              <div class="price-box">
                <strong>${formatPrice(product.sale_price || product.price)}</strong>
                ${product.sale_price && Number(product.sale_price) < Number(product.price) ? `<small>${formatPrice(product.price)}</small>` : ''}
              </div>
              <div class="detail-meta">
                <div class="stock-badge">${Number(product.stock) > 0 ? 'Stok tersedia' : 'Stok habis'}</div>
                <div class="product-tag">${escapeHtml(product.category_name || 'Produk Digital')}</div>
              </div>
              <p style="color: var(--muted); margin-top: 12px;">${escapeHtml(product.description || 'Tidak ada deskripsi')}</p>
              <div class="product-actions" style="margin-top: 16px;">
                <button class="primary-button" data-add-to-cart="${encodeURIComponent(product.id)}">Tambah ke Keranjang</button>
                <button class="secondary-button" data-navigate="/checkout">Beli Sekarang</button>
              </div>
              <ul class="detail-points">
                <li>Nama game: ${escapeHtml(product.category_name || '-')}</li>
                <li>Stok: ${Number(product.stock) || 0}</li>
                <li>Informasi penting: ${escapeHtml(product.info || 'Silakan hubungi admin untuk detail lengkap.')}</li>
                <li>Ketentuan serah terima: sesuai informasi penjual, tanpa meminta password akun melalui form publik.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderCart() {
  const total = getCartTotal();
  return `
    <section class="section">
      <div class="container">
        <div class="page-shell">
          <div class="page-hero"><span class="eyebrow">Keranjang</span><h1>Daftar Belanja</h1></div>
          <div class="grid-two" style="margin-top: 22px;">
            <div class="checkout-panel">
              ${state.cart.length ? `
                <div class="cart-list">
                  ${state.cart.map((item) => `
                    <div class="cart-item">
                      <img src="${item.imageUrl || '/assets/placeholder-product.svg'}" alt="${escapeHtml(item.productName)}" />
                      <div>
                        <h3 style="margin: 0 0 4px;">${escapeHtml(item.productName)}</h3>
                        <div class="price-box"><strong>${formatPrice(item.price)}</strong></div>
                        <div class="qty-control" style="margin-top: 10px;">
                          <button data-cart-qty="decrease" data-product-id="${item.productId}">-</button>
                          <span>${item.quantity}</span>
                          <button data-cart-qty="increase" data-product-id="${item.productId}">+</button>
                        </div>
                      </div>
                      <button class="ghost-button" data-cart-remove="${item.productId}">Hapus</button>
                    </div>
                  `).join('')}
                </div>
              ` : '<p>Keranjang Anda masih kosong.</p>'}
            </div>
            <aside class="summary-card">
              <h3>Ringkasan Belanja</h3>
              <div class="summary-row"><span>Jumlah item</span><strong>${getCartCount()}</strong></div>
              <div class="summary-row"><span>Subtotal</span><strong>${formatPrice(total)}</strong></div>
              <div class="summary-row summary-total"><span>Total</span><strong>${formatPrice(total)}</strong></div>
              <div class="product-actions" style="margin-top: 16px;">
                <button class="primary-button" data-navigate="/checkout" ${state.cart.length ? '' : 'disabled'}>Checkout</button>
                <button class="secondary-button" data-navigate="/products">Lanjut Belanja</button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderCheckout() {
  const paymentOptions = (state.paymentMethods.length ? state.paymentMethods : [
    { id: 'bank-bca', name: 'Bank BCA', account_name: 'KRIS DESIGN SHOP', account_number: '1234567890' },
    { id: 'bank-mandiri', name: 'Bank Mandiri', account_name: 'KRIS DESIGN SHOP', account_number: '101234567890' },
    { id: 'ewallet-dana', name: 'DANA', account_name: 'KRIS DESIGN SHOP', account_number: '085782554720' },
  ]).map((method) => `<option value="${escapeHtml(method.id)}">${escapeHtml(method.name)}</option>`).join('');

  return `
    <section class="section">
      <div class="container">
        <div class="page-shell">
          <div class="page-hero"><span class="eyebrow">Checkout</span><h1>Formulir Pembelian</h1></div>
          <div class="grid-two" style="margin-top: 22px;">
            <form id="checkout-form" class="checkout-panel">
              <div class="field"><label>Nama Pembeli</label><input name="customerName" required /></div>
              <div class="field"><label>Nomor WhatsApp aktif</label><input name="whatsapp" required /></div>
              <div class="field"><label>Email opsional</label><input name="email" type="email" /></div>
              <div class="field"><label>Catatan pesanan</label><textarea name="notes"></textarea></div>
              <div class="field"><label>Metode pembayaran</label>
                <select name="paymentMethod">
                  ${paymentOptions}
                </select>
              </div>
              <div class="product-actions" style="margin-top: 16px;">
                <button type="submit" class="primary-button">Buat Pesanan</button>
              </div>
            </form>
            <aside class="summary-card">
              <h3>Ringkasan Produk</h3>
              ${state.cart.length ? state.cart.map((item) => `
                <div class="summary-row">
                  <span>${escapeHtml(item.productName)} x ${item.quantity}</span>
                  <strong>${formatPrice(Number(item.price) * Number(item.quantity))}</strong>
                </div>
              `).join('') : '<p>Keranjang kosong.</p>'}
              <div class="summary-row summary-total"><span>Total</span><strong>${formatPrice(getCartTotal())}</strong></div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderPayment() {
  const methods = state.paymentMethods.length ? state.paymentMethods : [
    { name: 'Bank BCA', account_name: 'KRIS DESIGN SHOP', account_number: '1234567890', instructions: 'Transfer sesuai nominal total pembayaran.' },
    { name: 'Bank Mandiri', account_name: 'KRIS DESIGN SHOP', account_number: '101234567890', instructions: 'Transfer ke rekening Mandiri lalu kirim bukti.' },
    { name: 'DANA', account_name: 'KRIS DESIGN SHOP', account_number: '085782554720', instructions: 'Bayar via DANA dan kirim screenshot untuk verifikasi.' },
    { name: 'QRIS', account_name: 'KRIS DESIGN SHOP', account_number: '', instructions: 'Scan QRIS untuk membayar.' },
  ];

  return `
    <section class="section">
      <div class="container">
        <div class="page-shell">
          <div class="page-hero"><span class="eyebrow">Pembayaran</span><h1>Instruksi Pembayaran</h1></div>
          <div class="grid-two" style="margin-top: 22px;">
            <div class="checkout-panel">
              <p>Silakan transfer sesuai total pembayaran dan konfirmasi via WhatsApp admin.</p>
              <ul class="detail-points">
                <li>Nomor WhatsApp: +6285782554720</li>
                <li>Email kontak: krisdesign0@gmail.com</li>
                <li>Instruksi: Pastikan nominal transfer sesuai total akhir.</li>
              </ul>
            </div>
            <aside class="summary-card">
              <h3>Metode Pembayaran</h3>
              <ul class="detail-points payment-method-list">
                ${methods.map((method) => `<li><strong>${escapeHtml(method.name)}</strong>${method.account_number ? `: ${escapeHtml(method.account_number)}` : ''} ${method.account_name ? `a.n ${escapeHtml(method.account_name)}` : ''} — ${escapeHtml(method.instructions || 'Silakan ikuti instruksi pembayaran.')}${method.name.toLowerCase().includes('qris') && method.qr_code ? `<img class="payment-qr" src="${escapeHtml(method.qr_code)}" alt="QR ${escapeHtml(method.name)}" />` : ''}</li>`).join('')}
              </ul>
              ${state.orderCode ? `<div class="order-code-card"><span>Kode pesanan</span><strong>${escapeHtml(state.orderCode)}</strong><a class="text-link" href="/orders" data-navigate="/orders">Cek status konfirmasi pembayaran</a></div>` : ''}
            </aside>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderOrders() {
  return `
    <section class="section">
      <div class="container">
        <div class="page-shell">
          <div class="page-hero"><span class="eyebrow">Cek Pesanan</span><h1>Tracking Pesanan</h1></div>
          <div class="checkout-panel" style="margin-top: 22px;">
            <div class="field"><label>Kode pesanan</label><input id="order-code-input" placeholder="KDS-..." value="${escapeHtml(state.orderCode)}" /></div>
            <div class="product-actions" style="margin-top: 14px;"><button class="primary-button" id="check-order-button">Cek Pesanan</button></div>
            <div id="order-result" style="margin-top: 18px;"></div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderOrderResult(order) {
  const result = document.getElementById('order-result');
  if (!result) return;
  result.innerHTML = `
    <div class="summary-card">
      <h3>Detail Pesanan</h3>
      <p><strong>Kode:</strong> ${escapeHtml(order.orderCode)}</p>
      <p><strong>Nama:</strong> ${escapeHtml(order.customerName)}</p>
      <p><strong>Status:</strong> ${escapeHtml(order.orderStatus)}</p>
      <p><strong>Pembayaran:</strong> ${escapeHtml(order.paymentStatus)}</p>
      <p><strong>Total:</strong> ${formatPrice(order.total)}</p>
      ${order.paymentStatus === 'paid' ? `<a class="whatsapp-button" href="https://wa.me/6285782554720?text=${encodeURIComponent(`Halo admin, pembayaran pesanan ${order.orderCode} sudah dikonfirmasi. Mohon bantu proses pesanan saya.`)}" target="_blank" rel="noopener noreferrer">Chat WhatsApp Admin</a>` : '<p class="muted-copy">Status akan diperbarui otomatis. Tombol WhatsApp muncul setelah admin mengonfirmasi pembayaran.</p>'}
    </div>
  `;
}

function renderAbout() {
  return `
    <section class="section">
      <div class="container">
        <div class="page-hero"><span class="eyebrow">Tentang Kami</span><h1>Tentang KRIS DESIGN SHOP</h1></div>
        <div class="grid-two" style="margin-top: 22px;">
          <div class="checkout-panel">
            <p>KRIS DESIGN SHOP adalah toko digital yang bergerak di bidang kebutuhan gaming, item game, grafis, dan desain premium. Kami fokus pada kualitas, kecepatan proses, dan komunikasi yang jelas kepada pelanggan.</p>
            <p>Dalam melayani kebutuhan pelanggan, kami menjaga transparansi produk, jalur transaksi yang terukur, dan pelayanan yang mudah dihubungi melalui WhatsApp serta email.</p>
          </div>
          <div class="summary-card">
            <h3>Keunggulan Toko</h3>
            <ul class="detail-points">
              <li>Produk premium dan siap pakai</li>
              <li>Proses Serah Terima jelas</li>
              <li>Komunikasi cepat via WhatsApp</li>
              <li>Desain digital berkualitas</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderContact() {
  return `
    <section class="section">
      <div class="container">
        <div class="page-hero"><span class="eyebrow">Kontak & Bantuan</span><h1>Hubungi Kami</h1></div>
        <div class="grid-two" style="margin-top: 22px;">
          <div class="checkout-panel">
            <p>Instagram: @krisdesignreal23</p>
            <p>WhatsApp admin: +6285782554720</p>
            <p>Email: krisdesign0@gmail.com</p>
            <p>Email alternatif: krisstore32@gmail.com</p>
          </div>
          <div class="summary-card">
            <h3>FAQ Sederhana</h3>
            <ul class="detail-points">
              <li>Apakah bisa beli tanpa akun? Ya, pembeli dapat membeli tanpa membuat akun.</li>
              <li>Apakah password akun diminta? Tidak, kami tidak meminta password akun melalui form publik.</li>
              <li>Bagaimana cek pesanan? Gunakan kode pesanan yang diberikan setelah checkout.</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderPrivacy() {
  return `<section class="section"><div class="container"><div class="page-hero"><span class="eyebrow">Kebijakan Privasi</span><h1>Kebijakan Privasi</h1></div><div class="checkout-panel" style="margin-top:22px;"><p>Data pelanggan hanya digunakan untuk kebutuhan pemesanan, kontak, dan proses transaksi. Kami tidak membagikan data pelanggan kepada pihak ketiga tanpa izin jelas, kecuali untuk kebutuhan administrasi yang diwajibkan.</p></div></div></section>`;
}

function renderTerms() {
  return `<section class="section"><div class="container"><div class="page-hero"><span class="eyebrow">Syarat & Ketentuan</span><h1>Syarat & Ketentuan</h1></div><div class="checkout-panel" style="margin-top:22px;"><p>Setiap transaksi di KRIS DESIGN SHOP tunduk pada kesepakatan antara pembeli dan penjual. Pelanggan diminta membaca detail produk, ketentuan serah terima, dan informasi pembayaran sebelum melakukan checkout.</p></div></div></section>`;
}

function renderAdminCategoryList() {
  return state.categories.length ? state.categories.map((category) => `
    <article class="admin-list-item">
      <div><strong>${escapeHtml(category.name)}</strong><small>${escapeHtml(category.slug)} · ${Number(category.is_active) ? 'Aktif' : 'Nonaktif'}</small></div>
      <div class="admin-row-actions">
        <button class="ghost-button compact-button" type="button" data-edit-category="${escapeHtml(category.id)}">Ubah</button>
        <button class="danger-button compact-button" type="button" data-delete-category="${escapeHtml(category.id)}">Hapus</button>
      </div>
    </article>
  `).join('') : '<p>Belum ada kategori.</p>';
}

function renderAdminPaymentMethodList() {
  return state.paymentMethods.length ? state.paymentMethods.map((method) => `
    <article class="admin-list-item">
      <div class="payment-admin-summary">
        <strong>${escapeHtml(method.name)}</strong>
        <small>${escapeHtml(method.account_number || 'QR / tanpa nomor rekening')} · ${Number(method.is_active) ? 'Aktif' : 'Nonaktif'}</small>
        ${method.qr_code ? `<img src="${escapeHtml(method.qr_code)}" alt="QR ${escapeHtml(method.name)}" />` : ''}
      </div>
      <div class="admin-row-actions">
        <button class="ghost-button compact-button" type="button" data-edit-payment="${escapeHtml(method.id)}">Ubah</button>
        <button class="danger-button compact-button" type="button" data-delete-payment="${escapeHtml(method.id)}">Hapus</button>
      </div>
    </article>
  `).join('') : '<p>Belum ada metode pembayaran.</p>';
}

function renderAdminProductList() {
  return state.products.length ? state.products.map((product) => `
    <article class="admin-list-item product-admin-item">
      <img src="${escapeHtml(product.image_url || '/assets/placeholder-product.svg')}" alt="" />
      <div class="admin-product-summary"><strong>${escapeHtml(product.name)}</strong><small>${formatPrice(product.sale_price || product.price)} · Stok ${Number(product.stock)}</small></div>
      <div class="admin-row-actions">
        <button class="ghost-button compact-button" type="button" data-edit-product="${escapeHtml(product.id)}">Ubah</button>
        <button class="danger-button compact-button" type="button" data-delete-product="${escapeHtml(product.id)}">Hapus</button>
      </div>
    </article>
  `).join('') : '<p>Belum ada produk.</p>';
}

function renderGalleryPicker(currentValue = '/assets/placeholder-product.svg') {
  const gallery = state.galleryImages.length ? state.galleryImages : [{ id: 'placeholder', name: 'Placeholder', url: '/assets/placeholder-product.svg' }];
  return `
    <div class="field">
      <label>Galeri foto produk</label>
      <div class="gallery-picker">
        ${gallery.map((item) => `
          <button type="button" class="gallery-option ${item.url === currentValue ? 'selected' : ''}" data-gallery-image="${escapeHtml(item.url)}" title="${escapeHtml(item.name)}">
            <img src="${item.url}" alt="${escapeHtml(item.name)}" />
          </button>
        `).join('')}
      </div>
    </div>
    <div class="field">
      <label>URL foto produk</label>
      <input id="product-image-url" name="imageUrl" value="${escapeHtml(currentValue)}" />
    </div>
    <div class="field">
      <label>Atau unggah foto</label>
      <input type="file" id="product-image-upload" accept="image/png,image/jpeg,image/webp" />
    </div>
  `;
}

function renderQrGalleryPicker(currentValue = '') {
  const gallery = state.galleryImages;
  return `
    <div class="field">
      <label>Pilih gambar QRIS dari galeri</label>
      <div class="gallery-picker">
        ${gallery.map((item) => `
          <button type="button" class="gallery-option ${item.url === currentValue ? 'selected' : ''}" data-qr-gallery-image="${escapeHtml(item.url)}" title="${escapeHtml(item.name)}">
            <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.name)}" />
          </button>
        `).join('')}
      </div>
    </div>
    <div class="field"><label>URL gambar QR</label><input id="payment-qr-url" name="qrCode" value="${escapeHtml(currentValue)}" /></div>
    <div class="field"><label>Atau unggah gambar QRIS (PNG/JPG/WEBP, maks. 4 MB)</label><input type="file" id="payment-qr-upload" accept="image/png,image/jpeg,image/webp" /></div>
    ${currentValue ? `<img class="qr-preview" src="${escapeHtml(currentValue)}" alt="Preview QR" />` : ''}
  `;
}

function renderAdminOrders() {
  return state.adminOrders.length ? state.adminOrders.map((order) => `
    <article class="admin-order-item" data-admin-order="${escapeHtml(order.id)}">
      <div class="admin-order-heading"><div><strong>${escapeHtml(order.order_code)}</strong><small>${escapeHtml(order.customer_name)} · ${formatPrice(order.total)}</small></div><small>${escapeHtml(order.created_at || '')}</small></div>
      <div class="admin-order-controls">
        <label class="field"><span>Status pembayaran</span><select name="paymentStatus">
          ${['pending', 'paid', 'failed'].map((value) => `<option value="${value}" ${order.payment_status === value ? 'selected' : ''}>${value === 'paid' ? 'Dikonfirmasi' : value === 'failed' ? 'Gagal' : 'Menunggu'}</option>`).join('')}
        </select></label>
        <label class="field"><span>Status pesanan</span><select name="orderStatus">
          ${['waiting_payment', 'processing', 'completed', 'cancelled'].map((value) => `<option value="${value}" ${order.order_status === value ? 'selected' : ''}>${value === 'waiting_payment' ? 'Menunggu pembayaran' : value === 'processing' ? 'Diproses' : value === 'completed' ? 'Selesai' : 'Dibatalkan'}</option>`).join('')}
        </select></label>
        <button class="primary-button compact-button" type="button" data-save-order="${escapeHtml(order.id)}">Simpan status</button>
      </div>
    </article>
  `).join('') : '<p>Belum ada pesanan.</p>';
}

function renderAdmin() {
  return `
    <section class="section">
      <div class="container">
        <div class="page-hero"><span class="eyebrow">Admin Dashboard</span><h1>Login Admin</h1></div>
        <div class="checkout-panel" style="margin-top: 22px; max-width: 480px; margin-inline: auto;">
          <form id="admin-login-form">
            <div class="field"><label>Username</label><input name="username" required /></div>
            <div class="field"><label>Password</label><input name="password" type="password" required /></div>
            <div class="product-actions" style="margin-top: 14px;"><button class="primary-button" type="submit">Masuk</button></div>
          </form>
        </div>
      </div>
    </section>
  `;
}

function renderDashboardAdmin() {
  const category = state.categories.find((item) => item.id === state.editingCategoryId);
  const product = state.products.find((item) => item.id === state.editingProductId);
  const paymentMethod = state.paymentMethods.find((item) => item.id === state.editingPaymentMethodId);
  return `
    <section class="section">
      <div class="container">
        <div class="page-hero">
          <span class="eyebrow">Admin Dashboard</span>
          <h1>Kelola Toko</h1>
          <div class="product-actions" style="margin-top: 16px;">
            <button class="ghost-button" id="logout-admin">Logout</button>
          </div>
        </div>
        <div class="grid-two" style="margin-top: 22px;">
          <div class="admin-card">
            <h3>${category ? 'Ubah Kategori' : 'Tambah Kategori'}</h3>
            <form id="category-form">
              <input type="hidden" name="id" value="${escapeHtml(category?.id || '')}" />
              <div class="field"><label>Nama Kategori</label><input name="name" value="${escapeHtml(category?.name || '')}" required /></div>
              <div class="field"><label>Deskripsi</label><textarea name="description">${escapeHtml(category?.description || '')}</textarea></div>
              <div class="field"><label>Urutan</label><input name="sortOrder" type="number" value="${escapeHtml(category?.sort_order ?? 0)}" /></div>
              <div class="product-actions" style="margin-top: 14px;"><button class="primary-button" type="submit">${category ? 'Simpan Perubahan' : 'Tambah Kategori'}</button>${category ? '<button class="ghost-button" type="button" data-cancel-category-edit>Batal</button>' : ''}</div>
            </form>
            <div class="admin-list" style="margin-top: 18px;">${renderAdminCategoryList()}</div>
          </div>
          <div class="admin-card">
            <h3>${product ? 'Ubah Produk' : 'Tambah Produk'}</h3>
            <form id="product-form">
              <input type="hidden" name="id" value="${escapeHtml(product?.id || '')}" />
              <div class="field"><label>Nama Produk</label><input name="name" value="${escapeHtml(product?.name || '')}" required /></div>
              <div class="field"><label>Kategori</label><select name="categoryId" required>${state.categories.filter((item) => Number(item.is_active)).map((item) => `<option value="${escapeHtml(item.id)}" ${product?.category_id === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></div>
              <div class="field"><label>Harga</label><input name="price" type="number" min="0" value="${escapeHtml(product?.price ?? '')}" required /></div>
              <div class="field"><label>Harga Promo</label><input name="salePrice" type="number" min="0" value="${escapeHtml(product?.sale_price ?? '')}" /></div>
              <div class="field"><label>Stok</label><input name="stock" type="number" min="0" value="${escapeHtml(product?.stock ?? 0)}" /></div>
              <div class="field"><label>Deskripsi</label><textarea name="description">${escapeHtml(product?.description || '')}</textarea></div>
              <div class="field"><label>Info Produk</label><textarea name="info">${escapeHtml(product?.info || '')}</textarea></div>
              ${renderGalleryPicker(product?.image_url || '/assets/placeholder-product.svg')}
              <div class="product-actions" style="margin-top: 14px;"><button class="primary-button" type="submit">${product ? 'Simpan Perubahan' : 'Tambah Produk'}</button>${product ? '<button class="ghost-button" type="button" data-cancel-product-edit>Batal</button>' : ''}</div>
            </form>
            <div class="admin-list" style="margin-top: 18px;">${renderAdminProductList()}</div>
          </div>
        </div>
        <div class="admin-card" style="margin-top: 22px;">
          <h3>${paymentMethod ? 'Ubah Metode Pembayaran' : 'Tambah Metode Pembayaran'}</h3>
          <form id="payment-method-form">
            <input type="hidden" name="id" value="${escapeHtml(paymentMethod?.id || '')}" />
            <div class="field"><label>Nama Metode</label><input name="name" value="${escapeHtml(paymentMethod?.name || '')}" placeholder="Contoh: QRIS" required /></div>
            <div class="field"><label>Nama Rekening (opsional)</label><input name="accountName" value="${escapeHtml(paymentMethod?.account_name || '')}" /></div>
            <div class="field"><label>Nomor Rekening (opsional untuk QRIS)</label><input name="accountNumber" value="${escapeHtml(paymentMethod?.account_number || '')}" /></div>
            <div class="field"><label>Instruksi</label><textarea name="instructions">${escapeHtml(paymentMethod?.instructions || '')}</textarea></div>
            ${renderQrGalleryPicker(paymentMethod?.qr_code || '')}
            <label class="checkbox-field"><input name="isActive" type="checkbox" ${paymentMethod && !Number(paymentMethod.is_active) ? '' : 'checked'} /> Tampilkan sebagai metode aktif</label>
            <div class="product-actions" style="margin-top: 14px;"><button class="primary-button" type="submit">${paymentMethod ? 'Simpan Perubahan' : 'Tambah Metode'}</button>${paymentMethod ? '<button class="ghost-button" type="button" data-cancel-payment-edit>Batal</button>' : ''}</div>
          </form>
          <div class="admin-list" style="margin-top: 18px;">${renderAdminPaymentMethodList()}</div>
        </div>
        <div class="admin-card" style="margin-top: 22px;">
          <h3>Pesanan & Konfirmasi Pembayaran</h3>
          <p class="muted-copy">Ubah status pembayaran menjadi “Dikonfirmasi” setelah dana diterima. Pelanggan akan melihat tombol WhatsApp pada halaman cek pesanan.</p>
          <div class="admin-list">${renderAdminOrders()}</div>
        </div>
      </div>
    </section>
  `;
}

function renderPage() {
  const { pathname, searchParams } = getCurrentRouteInfo();
  const route = Object.keys(routes).find((key) => pathname === key || pathname.startsWith(key + '/')) || '/';

  if (route === '/products' && searchParams.get('category')) {
    state.selectedCategory = searchParams.get('category');
  }

  let content = '';
  if (route === '/') content = renderHero() + renderCategories() + renderProducts();
  else if (route === '/products') content = renderProducts();
  else if (route === '/product') content = renderProductDetail(pathname.split('/product/')[1] || '');
  else if (route === '/cart') content = renderCart();
  else if (route === '/checkout') content = renderCheckout();
  else if (route === '/payment') content = renderPayment();
  else if (route === '/orders') content = renderOrders();
  else if (route === '/about') content = renderAbout();
  else if (route === '/contact') content = renderContact();
  else if (route === '/privacy') content = renderPrivacy();
  else if (route === '/terms') content = renderTerms();
  else if (route === '/login/admin') content = state.adminSession ? renderDashboardAdmin() : renderAdmin();

  app.innerHTML = `${renderHeader()}<main class="page-content">${content}</main>${renderFooter()}`;
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll('[data-navigate]').forEach((button) => {
    button.addEventListener('click', (event) => {
      const target = event.currentTarget.dataset.navigate;
      if (target) setRoute(target);
    });
  });

  document.querySelectorAll('[data-edit-category]').forEach((button) => {
      button.addEventListener('click', () => {
        state.editingCategoryId = button.dataset.editCategory;
        render();
      });
    });
    document.querySelectorAll('[data-delete-category]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!window.confirm('Hapus atau nonaktifkan kategori ini?')) return;
        try {
          const result = await fetchJson(`/api/admin/categories/${encodeURIComponent(button.dataset.deleteCategory)}`, { method: 'DELETE' });
          state.editingCategoryId = '';
          await loadAdminDashboard();
          showToast(result.message, 'success');
          render();
        } catch (error) {
          showToast(error.message || 'Gagal menghapus kategori.', 'error');
        }
      });
    });
    document.querySelectorAll('[data-edit-product]').forEach((button) => {
      button.addEventListener('click', () => {
        state.editingProductId = button.dataset.editProduct;
        render();
      });
    });
    document.querySelectorAll('[data-delete-product]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!window.confirm('Yakin ingin menghapus produk ini?')) return;
        try {
          await fetchJson(`/api/admin/products/${encodeURIComponent(button.dataset.deleteProduct)}`, { method: 'DELETE' });
          state.editingProductId = '';
          await loadAdminDashboard();
          showToast('Produk berhasil dihapus.', 'success');
          render();
        } catch (error) {
          showToast(error.message || 'Gagal menghapus produk.', 'error');
        }
      });
    });
    document.querySelectorAll('[data-edit-payment]').forEach((button) => {
      button.addEventListener('click', () => {
        state.editingPaymentMethodId = button.dataset.editPayment;
        render();
      });
    });
    document.querySelectorAll('[data-delete-payment]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!window.confirm('Yakin ingin menghapus metode pembayaran ini?')) return;
        try {
          await fetchJson(`/api/admin/payment-methods/${encodeURIComponent(button.dataset.deletePayment)}`, { method: 'DELETE' });
          state.editingPaymentMethodId = '';
          await loadAdminDashboard();
          showToast('Metode pembayaran berhasil dihapus.', 'success');
          render();
        } catch (error) {
          showToast(error.message || 'Gagal menghapus metode pembayaran.', 'error');
        }
      });
    });
    document.querySelectorAll('[data-cancel-category-edit]').forEach((button) => button.addEventListener('click', () => { state.editingCategoryId = ''; render(); }));
    document.querySelectorAll('[data-cancel-product-edit]').forEach((button) => button.addEventListener('click', () => { state.editingProductId = ''; render(); }));
    document.querySelectorAll('[data-cancel-payment-edit]').forEach((button) => button.addEventListener('click', () => { state.editingPaymentMethodId = ''; render(); }));

    document.querySelectorAll('[data-qr-gallery-image]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.getElementById('payment-qr-url');
        if (input) input.value = button.dataset.qrGalleryImage;
        document.querySelectorAll('[data-qr-gallery-image]').forEach((item) => item.classList.toggle('selected', item === button));
      });
    });

  document.querySelectorAll('[data-add-to-cart]').forEach((button) => {
    button.addEventListener('click', async () => {
      const productId = decodeURIComponent(button.dataset.addToCart);
      const product = state.products.find((item) => item.id === productId);
      if (!product) return;
      addToCart(product.id, product.name, product.sale_price || product.price, product.image_url, 1);
    });
  });

  document.querySelectorAll('[data-page-change]').forEach((button) => {
    button.addEventListener('click', () => {
      const direction = button.dataset.pageChange;
      const max = Math.max(1, Math.ceil(state.products.length / state.pageSize));
      if (direction === 'next' && state.currentPage < max) state.currentPage += 1;
      if (direction === 'prev' && state.currentPage > 1) state.currentPage -= 1;
      render();
    });
  });

  document.querySelectorAll('[data-cart-qty]').forEach((button) => {
    button.addEventListener('click', () => {
      const productId = button.dataset.productId;
      const delta = button.dataset.cartQty === 'increase' ? 1 : -1;
      updateCartQuantity(productId, delta);
    });
  });

  document.querySelectorAll('[data-cart-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      removeFromCart(button.dataset.cartRemove);
    });
  });

  const searchInput = document.getElementById('search-product');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      state.searchTerm = event.target.value.trim();
      state.currentPage = 1;
      render();
    });
  }

  const categoryFilter = document.getElementById('category-filter');
  if (categoryFilter) {
    categoryFilter.addEventListener('change', (event) => {
      state.selectedCategory = event.target.value;
      state.currentPage = 1;
      render();
    });
  }

  const sortFilter = document.getElementById('sort-filter');
  if (sortFilter) {
    sortFilter.addEventListener('change', (event) => {
      state.sortBy = event.target.value;
      state.currentPage = 1;
      render();
    });
  }

  const checkoutForm = document.getElementById('checkout-form');
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.cart.length) {
        showToast('Keranjang masih kosong.', 'error');
        return;
      }
      const formData = new FormData(checkoutForm);
      try {
        const payload = {
          customerName: formData.get('customerName'),
          whatsapp: formData.get('whatsapp'),
          email: formData.get('email'),
          notes: formData.get('notes'),
          paymentMethod: formData.get('paymentMethod'),
          items: state.cart.map((item) => ({ productId: item.productId, name: item.productName, price: item.price, quantity: item.quantity, subtotal: Number(item.price) * Number(item.quantity) })),
          cartTotal: getCartTotal(),
        };
        const result = await fetchJson('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
        localStorage.removeItem('kds-cart');
        state.cart = [];
        state.orderCode = result.order.orderCode;
        localStorage.setItem('kds-last-order-code', state.orderCode);
        showToast('Pesanan berhasil dibuat. Silakan bayar.', 'success');
        setRoute('/payment');
      } catch (error) {
        showToast(error.message || 'Kesalahan saat checkout.', 'error');
      }
    });
  }

  const adminLoginForm = document.getElementById('admin-login-form');
  if (adminLoginForm) {
    adminLoginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(adminLoginForm);
      try {
        const response = await fetchJson('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ username: formData.get('username'), password: formData.get('password') })
        });
        if (response.success) {
          state.adminSession = response.user;
          await loadAdminDashboard();
          showToast('Login admin berhasil.', 'success');
          setRoute('/login/admin');
        }
      } catch (error) {
        showToast(error.message || 'Login gagal.', 'error');
      }
    });
  }

  const logoutButton = document.getElementById('logout-admin');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      try {
        await fetchJson('/api/admin/logout', { method: 'POST' });
        state.adminSession = null;
        setRoute('/');
      } catch (error) {
        showToast(error.message || 'Logout gagal.', 'error');
      }
    });
  }

  const categoryForm = document.getElementById('category-form');
  if (categoryForm) {
    categoryForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(categoryForm);
      try {
        const categoryId = fd.get('id');
        await fetchJson(categoryId ? `/api/admin/categories/${encodeURIComponent(categoryId)}` : '/api/admin/categories', {
          method: categoryId ? 'PUT' : 'POST',
          body: JSON.stringify({
            name: fd.get('name'),
            description: fd.get('description'),
            sortOrder: fd.get('sortOrder') || 0,
            isActive: 1,
          }),
        });
        state.editingCategoryId = '';
        await loadAdminDashboard();
        showToast(categoryId ? 'Kategori berhasil diperbarui.' : 'Kategori berhasil ditambahkan.', 'success');
        render();
      } catch (error) {
        showToast(error.message || 'Gagal menambahkan kategori.', 'error');
      }
    });
  }

  const productForm = document.getElementById('product-form');
  if (productForm) {
    const imageInput = productForm.querySelector('#product-image-url');
    const uploadInput = productForm.querySelector('#product-image-upload');

    productForm.querySelectorAll('.gallery-option').forEach((button) => {
      button.addEventListener('click', () => {
        const selectedUrl = button.dataset.galleryImage;
        if (imageInput) imageInput.value = selectedUrl;
        productForm.querySelectorAll('.gallery-option').forEach((item) => item.classList.toggle('selected', item === button));
      });
    });

    if (uploadInput) {
      uploadInput.addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) {
          uploadInput.value = '';
          showToast('Ukuran gambar maksimal 4 MB.', 'error');
          return;
        }
        productForm.querySelectorAll('.gallery-option').forEach((item) => item.classList.remove('selected'));
      });
    }

    productForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(productForm);
      const uploadedFile = productForm.querySelector('#product-image-upload')?.files?.[0];
      const productId = fd.get('id');

      if (uploadedFile) {
        fd.set('imageFile', uploadedFile);
      }

      try {
        const response = await fetch(productId ? `/api/admin/products/${encodeURIComponent(productId)}` : '/api/admin/products', {
          method: productId ? 'PUT' : 'POST',
          body: fd,
        });
        const data = await readJsonResponse(response);
        if (!response.ok) {
          throw new Error(data.message || 'Gagal menambahkan produk.');
        }
        state.editingProductId = '';
        await loadAdminDashboard();
        showToast(productId ? 'Produk berhasil diperbarui.' : 'Produk berhasil ditambahkan.', 'success');
        render();
      } catch (error) {
        showToast(error.message || 'Gagal menambahkan produk.', 'error');
      }
    });
  }

  const paymentMethodForm = document.getElementById('payment-method-form');
  if (paymentMethodForm) {
    const qrUpload = paymentMethodForm.querySelector('#payment-qr-upload');
    qrUpload?.addEventListener('change', () => {
      if (qrUpload.files?.[0]?.size > 4 * 1024 * 1024) {
        qrUpload.value = '';
        showToast('Ukuran gambar QR maksimal 4 MB.', 'error');
      }
    });

    paymentMethodForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(paymentMethodForm);
      const methodId = fd.get('id');
      fd.set('isActive', paymentMethodForm.querySelector('[name="isActive"]').checked ? '1' : '0');
      if (qrUpload?.files?.[0]) fd.set('qrImage', qrUpload.files[0]);
      try {
        const response = await fetch(methodId ? `/api/admin/payment-methods/${encodeURIComponent(methodId)}` : '/api/admin/payment-methods', {
          method: methodId ? 'PUT' : 'POST',
          body: fd,
        });
        const result = await readJsonResponse(response);
        if (!response.ok) throw new Error(result.message || 'Gagal menyimpan metode pembayaran.');
        state.editingPaymentMethodId = '';
        await loadAdminDashboard();
        showToast(methodId ? 'Metode pembayaran berhasil diperbarui.' : 'Metode pembayaran berhasil ditambahkan.', 'success');
        render();
      } catch (error) {
        showToast(error.message || 'Gagal menyimpan metode pembayaran.', 'error');
      }
    });
  }

  document.querySelectorAll('[data-save-order]').forEach((button) => {
    button.addEventListener('click', async () => {
      const row = button.closest('[data-admin-order]');
      try {
        await fetchJson(`/api/admin/orders/${encodeURIComponent(button.dataset.saveOrder)}`, {
          method: 'PUT',
          body: JSON.stringify({
            paymentStatus: row.querySelector('[name="paymentStatus"]').value,
            orderStatus: row.querySelector('[name="orderStatus"]').value,
          }),
        });
        await loadAdminDashboard();
        showToast('Status pesanan berhasil diperbarui.', 'success');
        render();
      } catch (error) {
        showToast(error.message || 'Gagal memperbarui status pesanan.', 'error');
      }
    });
  });

  const checkOrderButton = document.getElementById('check-order-button');
  if (checkOrderButton) {
    checkOrderButton.addEventListener('click', async () => {
      if (state.orderPollTimer) {
        window.clearInterval(state.orderPollTimer);
        state.orderPollTimer = null;
      }
      const input = document.getElementById('order-code-input');
      if (!input || !input.value.trim()) {
        showToast('Masukkan kode pesanan.', 'error');
        return;
      }
      try {
        const response = await fetchJson(`/api/orders/${encodeURIComponent(input.value.trim())}`);
        state.orderCode = response.order.orderCode;
        renderOrderResult(response.order);
        if (response.order.paymentStatus !== 'paid') {
          const orderCode = response.order.orderCode;
          state.orderPollTimer = window.setInterval(async () => {
            try {
              const latest = await fetchJson(`/api/orders/${encodeURIComponent(orderCode)}`);
              renderOrderResult(latest.order);
              if (latest.order.paymentStatus === 'paid') {
                window.clearInterval(state.orderPollTimer);
                state.orderPollTimer = null;
                showToast('Pembayaran dikonfirmasi. Anda dapat menghubungi admin via WhatsApp.', 'success');
              }
            } catch (error) {
              window.clearInterval(state.orderPollTimer);
              state.orderPollTimer = null;
              showToast(error.message || 'Gagal memperbarui status pesanan.', 'error');
            }
          }, 10000);
        }
      } catch (error) {
        document.getElementById('order-result').innerHTML = `<div class="summary-card"><p>${escapeHtml(error.message || 'Pesanan tidak ditemukan.')}</p></div>`;
      }
    });
  }
}

window.addEventListener('popstate', () => {
  if (state.orderPollTimer) {
    window.clearInterval(state.orderPollTimer);
    state.orderPollTimer = null;
  }
  state.currentRoute = window.location.pathname + window.location.search;
  render();
});

function render() {
  state.currentRoute = state.currentRoute || (window.location.pathname + window.location.search);
  renderPage();
}

(async function initialize() {
  state.currentRoute = window.location.pathname + window.location.search;
  state.adminSession = await loadAdminSession();
  await loadCategories();
  await loadProducts();
  await loadPaymentMethods();
  await loadGalleryImages();
  if (state.adminSession) {
    try {
      await loadAdminDashboard();
    } catch (error) {
      showToast(error.message || 'Gagal memuat dashboard admin.', 'error');
    }
  }
  render();
})();
