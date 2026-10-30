const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const { put } = require('@vercel/blob');
require('dotenv').config();

if (process.env.VERCEL && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL wajib dikonfigurasi untuk deploy Vercel.');
}
if (process.env.VERCEL && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET wajib dikonfigurasi untuk deploy Vercel.');
}
if (process.env.VERCEL && (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD)) {
  throw new Error('ADMIN_USERNAME dan ADMIN_PASSWORD wajib dikonfigurasi untuk deploy Vercel.');
}

const { initializeDatabase, db, run, get, all, createOrderCode, hashText, usePostgres } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, 'public', 'uploads');
const isVercel = Boolean(process.env.VERCEL);
const makeUploadName = (file) => {
  const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '-');
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, fieldSize: 64 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Format file tidak didukung. Gunakan PNG, JPG, atau WEBP.'));
  },
});

async function persistUpload(file) {
  if (!file) return '';
  const fileName = makeUploadName(file);
  if (isVercel) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error('BLOB_READ_WRITE_TOKEN wajib dikonfigurasi untuk menyimpan gambar di Vercel.');
    }
    try {
      const blob = await put(`store-uploads/${fileName}`, file.buffer, {
        access: 'public',
        contentType: file.mimetype,
        addRandomSuffix: false,
      });
      return blob.url;
    } catch (error) {
      console.error('Vercel Blob upload failed:', error);
      throw new Error('Gagal mengunggah gambar. Periksa BLOB_READ_WRITE_TOKEN dan pastikan Blob store menggunakan akses publik.');
    }
  }

  fs.mkdirSync(uploadDir, { recursive: true });
  await fs.promises.writeFile(path.join(uploadDir, fileName), file.buffer);
  return `/uploads/${fileName}`;
}

function handleProductImageUpload(req, res, next) {
  upload.single('imageFile')(req, res, (error) => {
    if (!error) return next();

    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Ukuran gambar maksimal 4 MB.'
      : error.message || 'Gagal mengunggah gambar.';
    res.status(400).json({ success: false, message });
  });
}

function handleQrImageUpload(req, res, next) {
  upload.single('qrImage')(req, res, (error) => {
    if (!error) return next();

    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Ukuran gambar QR maksimal 4 MB.'
      : error.message || 'Gagal mengunggah gambar QR.';
    res.status(400).json({ success: false, message });
  });
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
if (!isVercel) app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));
if (isVercel) app.set('trust proxy', 1);
const sessionOptions = {
  secret: process.env.SESSION_SECRET || 'kris-design-shop-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,
    httpOnly: true,
    sameSite: 'lax',
    secure: isVercel,
  },
};
if (usePostgres) {
  const PgSession = require('connect-pg-simple')(session);
  sessionOptions.store = new PgSession({ pool: db, createTableIfMissing: true });
}
app.use(
  session({
    ...sessionOptions,
  })
);
let initializationPromise;
function initializeApp() {
  if (!initializationPromise) initializationPromise = initializeDatabase();
  return initializationPromise;
}
app.use((req, res, next) => {
  initializeApp().then(() => next()).catch((error) => {
    console.error('Database initialization failed:', error);
    res.status(503).json({ success: false, message: 'Database belum siap. Periksa konfigurasi database.' });
  });
});

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

function adminSessionUser(req) {
  return req.session && req.session.admin ? req.session.admin : null;
}

function parseItems(items) {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  try {
    const parsed = JSON.parse(items);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function buildOrderSummary(items) {
  return items.map((item) => ({
    productId: item.productId,
    name: item.name,
    quantity: Number(item.quantity || 1),
    price: Number(item.price || 0),
    subtotal: Number(item.price || 0) * Number(item.quantity || 1),
  }));
}

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok' });
});

app.get('/api/categories', async (req, res) => {
  try {
    const categories = await all('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, created_at ASC');
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memuat kategori.' });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const { category, q, sort, latest, featured } = req.query;
    let sql = 'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_active = 1';
    const params = [];

    if (category) {
      sql += ' AND p.category_id = ?';
      params.push(category);
    }

    if (q) {
      sql += ' AND (LOWER(p.name) LIKE LOWER(?) OR LOWER(p.description) LIKE LOWER(?) OR LOWER(p.short_description) LIKE LOWER(?))';
      const term = `%${String(q)}%`;
      params.push(term, term, term);
    }

    if (featured === '1') {
      sql += ' AND p.is_featured = 1';
    }

    if (latest === '1') {
      sql += ' ORDER BY p.created_at DESC';
    } else {
      sql += ' ORDER BY p.created_at DESC';
    }

    if (sort === 'price_asc') sql = `${sql.replace('ORDER BY p.created_at DESC', 'ORDER BY p.price ASC')}`;
    if (sort === 'price_desc') sql = `${sql.replace('ORDER BY p.created_at DESC', 'ORDER BY p.price DESC')}`;
    if (sort === 'newest') sql = `${sql.replace('ORDER BY p.created_at DESC', 'ORDER BY p.created_at DESC')}`;

    const products = await all(sql, params);
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memuat produk.' });
  }
});

app.get('/api/products/:slug', async (req, res) => {
  try {
    const product = await get(
      'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.slug = ? AND p.is_active = 1',
      [req.params.slug]
    );
    if (!product) {
      return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });
    }
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memuat detail produk.' });
  }
});

app.get('/api/payment-methods', async (req, res) => {
  try {
    const methods = await all('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY created_at ASC');
    res.json({ success: true, methods });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memuat metode pembayaran.' });
  }
});

app.get('/api/gallery-images', (req, res) => {
  const galleryDir = path.join(__dirname, 'public', 'assets', 'gallery');
  const images = [];

  if (fs.existsSync(galleryDir)) {
    const files = fs.readdirSync(galleryDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /\.(png|jpe?g|webp|svg)$/i.test(name))
      .sort();

    for (const fileName of files) {
      const baseName = fileName.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ');
      images.push({
        id: fileName.replace(/\.[^/.]+$/, ''),
        name: baseName.trim() || 'Gallery image',
        url: `/assets/gallery/${fileName}`,
      });
    }
  }

  res.json({ success: true, images });
});

app.get('/api/admin/payment-methods', requireAdmin, async (req, res) => {
  try {
    const methods = await all('SELECT * FROM payment_methods ORDER BY created_at ASC');
    res.json({ success: true, methods });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memuat metode pembayaran admin.' });
  }
});

app.post('/api/admin/payment-methods', requireAdmin, handleQrImageUpload, async (req, res) => {
  try {
    const { name, accountName, accountNumber, instructions, qrCode, isActive } = req.body;
    const imageUrl = req.file ? await persistUpload(req.file) : qrCode;
    if (!name || (!accountNumber && !imageUrl)) {
      return res.status(400).json({ success: false, message: 'Isi nama metode dan nomor rekening atau gambar QR.' });
    }

    const id = `pm-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    await run(
      'INSERT INTO payment_methods (id, name, account_name, account_number, instructions, qr_code, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, String(name).trim(), accountName ? String(accountName).trim() : '', accountNumber ? String(accountNumber).trim() : '', instructions ? String(instructions).trim() : '', imageUrl || '', Number(isActive ?? 1)]
    );

    res.json({ success: true, message: 'Metode pembayaran berhasil ditambahkan.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message || 'Gagal menambahkan metode pembayaran.' });
  }
});

app.put('/api/admin/payment-methods/:id', requireAdmin, handleQrImageUpload, async (req, res) => {
  try {
    const { name, accountName, accountNumber, instructions, qrCode, isActive } = req.body;
    const existing = await get('SELECT * FROM payment_methods WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Metode pembayaran tidak ditemukan.' });
    const imageUrl = req.file ? await persistUpload(req.file) : (qrCode ?? existing.qr_code);
    if (!name || (!accountNumber && !imageUrl)) {
      return res.status(400).json({ success: false, message: 'Isi nama metode dan nomor rekening atau gambar QR.' });
    }

    await run(
      'UPDATE payment_methods SET name = ?, account_name = ?, account_number = ?, instructions = ?, qr_code = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [String(name).trim(), accountName ? String(accountName).trim() : '', accountNumber ? String(accountNumber).trim() : '', instructions ? String(instructions).trim() : '', imageUrl || '', Number(isActive ?? existing.is_active), req.params.id]
    );

    res.json({ success: true, message: 'Metode pembayaran berhasil diperbarui.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message || 'Gagal memperbarui metode pembayaran.' });
  }
});

app.delete('/api/admin/payment-methods/:id', requireAdmin, async (req, res) => {
  try {
    const method = await get('SELECT id FROM payment_methods WHERE id = ?', [req.params.id]);
    if (!method) return res.status(404).json({ success: false, message: 'Metode pembayaran tidak ditemukan.' });
    await run('DELETE FROM payment_methods WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Metode pembayaran berhasil dihapus.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal menghapus metode pembayaran.' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, whatsapp, email, notes, items, paymentMethod, cartTotal } = req.body;

    if (!customerName || !whatsapp || !items || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'Data pembeli dan produk wajib diisi.' });
    }

    const cleanItems = items.map((item) => ({
      productId: item.productId,
      name: item.name,
      quantity: Number(item.quantity || 1),
      price: Number(item.price || 0),
      subtotal: Number(item.subtotal || item.price * item.quantity || 0),
    }));

    const total = Number(cartTotal || cleanItems.reduce((sum, item) => sum + item.subtotal, 0));
    const orderCode = createOrderCode();
    const orderId = `ord-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    await run(
      `INSERT INTO orders (id, order_code, customer_name, whatsapp, email, notes, items, total, payment_method, payment_status, order_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'waiting_payment')`,
      [orderId, orderCode, String(customerName).trim(), String(whatsapp).trim(), email ? String(email).trim() : null, notes ? String(notes).trim() : null, JSON.stringify(cleanItems), total, paymentMethod || 'bank-transfer']
    );

    const paymentMethodRow = await get('SELECT * FROM payment_methods WHERE id = ? AND is_active = 1', [paymentMethod || 'bank-bca']);
    res.json({
      success: true,
      order: {
        id: orderId,
        orderCode,
        customerName: String(customerName).trim(),
        whatsapp: String(whatsapp).trim(),
        total,
        paymentMethod: paymentMethodRow ? paymentMethodRow.name : (paymentMethod || 'Bank Transfer'),
        status: 'waiting_payment',
      },
      instructions: paymentMethodRow ? paymentMethodRow.instructions : 'Silakan transfer sesuai total pembayaran dan kirim bukti transfer ke WhatsApp admin.',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal membuat pesanan.' });
  }
});

app.get('/api/orders/:orderCode', async (req, res) => {
  try {
    const order = await get('SELECT * FROM orders WHERE order_code = ?', [req.params.orderCode]);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Kode pesanan tidak ditemukan.' });
    }

    const parsedItems = parseItems(order.items);
    res.json({
      success: true,
      order: {
        id: order.id,
        orderCode: order.order_code,
        customerName: order.customer_name,
        whatsapp: order.whatsapp,
        email: order.email,
        notes: order.notes,
        total: Number(order.total),
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status,
        orderStatus: order.order_status,
        createdAt: order.created_at,
        items: parsedItems,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memuat pesanan.' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
    }

    const user = await get('SELECT * FROM admin_users WHERE username = ?', [String(username).trim()]);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Username atau password salah.' });
    }

    const hash = hashText(password);
    if (user.password_hash !== hash) {
      return res.status(401).json({ success: false, message: 'Username atau password salah.' });
    }

    req.session.admin = { id: user.id, username: user.username, fullName: user.full_name };
    res.json({ success: true, message: 'Login berhasil.', user: req.session.admin });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Login gagal.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true, message: 'Logout berhasil.' }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ success: true, admin: adminSessionUser(req) || null });
});

app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const categories = await all('SELECT * FROM categories ORDER BY sort_order ASC');
    const products = await all('SELECT * FROM products ORDER BY created_at DESC');
    const orders = await all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 20');
    const paymentMethods = await all('SELECT * FROM payment_methods ORDER BY created_at ASC');
    const stats = {
      products: Number((await get('SELECT COUNT(*) as count FROM products')).count),
      orders: Number((await get('SELECT COUNT(*) as count FROM orders')).count),
      pending: Number((await get('SELECT COUNT(*) as count FROM orders WHERE order_status = ?', ['waiting_payment'])).count),
    };

    res.json({ success: true, categories, products, orders, paymentMethods, stats });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memuat dashboard.' });
  }
});

app.post('/api/admin/categories', requireAdmin, async (req, res) => {
  try {
    const { name, description, sortOrder } = req.body;
    const slug = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `category-${Date.now()}`;
    const id = `cat-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

    await run(
      'INSERT INTO categories (id, name, slug, description, sort_order) VALUES (?, ?, ?, ?, ?)',
      [id, String(name).trim(), slug, description ? String(description).trim() : '', Number(sortOrder || 0)]
    );

    res.json({ success: true, message: 'Kategori berhasil ditambahkan.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menambahkan kategori.' });
  }
});

app.put('/api/admin/categories/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description, sortOrder, isActive } = req.body;
    const slug = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `category-${Date.now()}`;

    await run(
      'UPDATE categories SET name = ?, slug = ?, description = ?, sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [String(name).trim(), slug, description ? String(description).trim() : '', Number(sortOrder || 0), Number(isActive ?? 1), req.params.id]
    );

    res.json({ success: true, message: 'Kategori berhasil diperbarui.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui kategori.' });
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (req, res) => {
  try {
    const category = await get('SELECT id FROM categories WHERE id = ?', [req.params.id]);
    if (!category) return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan.' });
    const products = await get('SELECT COUNT(*) AS count FROM products WHERE category_id = ?', [req.params.id]);
    if (Number(products.count) > 0) {
      await run('UPDATE categories SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
      return res.json({ success: true, message: 'Kategori dinonaktifkan karena masih digunakan produk.' });
    }
    await run('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Kategori berhasil dihapus.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal menghapus kategori.' });
  }
});

app.post('/api/admin/products', requireAdmin, handleProductImageUpload, async (req, res) => {
  try {
    const { categoryId, name, description, shortDescription, price, salePrice, stock, status, info, imageUrl, isActive, isFeatured, isNew, isPromo } = req.body;
    const slug = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `product-${Date.now()}`;
    const id = `prod-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const generatedImageUrl = req.file ? await persistUpload(req.file) : (imageUrl || '/assets/placeholder-product.svg');

    await run(
      `INSERT INTO products (id, category_id, name, slug, image_url, description, short_description, price, sale_price, stock, status, info, is_active, is_featured, is_new, is_promo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        categoryId,
        String(name).trim(),
        slug,
        generatedImageUrl,
        description || '',
        shortDescription || '',
        Number(price || 0),
        salePrice ? Number(salePrice) : null,
        Number(stock || 0),
        status || 'available',
        info || '',
        Number(isActive ?? 1),
        Number(isFeatured ?? 0),
        Number(isNew ?? 0),
        Number(isPromo ?? 0),
      ]
    );

    res.json({ success: true, message: 'Produk berhasil ditambahkan.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message || 'Gagal menambahkan produk.' });
  }
});

app.put('/api/admin/products/:id', requireAdmin, handleProductImageUpload, async (req, res) => {
  try {
    const { categoryId, name, description, shortDescription, price, salePrice, stock, status, info, imageUrl, isActive, isFeatured, isNew, isPromo } = req.body;
    const slug = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `product-${Date.now()}`;
    const existing = await get('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });
    const generatedImageUrl = req.file ? await persistUpload(req.file) : (imageUrl || existing.image_url);

    await run(
      `UPDATE products SET category_id = ?, name = ?, slug = ?, image_url = ?, description = ?, short_description = ?, price = ?, sale_price = ?, stock = ?, status = ?, info = ?, is_active = ?, is_featured = ?, is_new = ?, is_promo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [categoryId, String(name).trim(), slug, generatedImageUrl, description || '', shortDescription || '', Number(price || 0), salePrice ? Number(salePrice) : null, Number(stock || 0), status || 'available', info || '', Number(isActive ?? 1), Number(isFeatured ?? 0), Number(isNew ?? 0), Number(isPromo ?? 0), req.params.id]
    );

    res.json({ success: true, message: 'Produk berhasil diperbarui.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal memperbarui produk.' });
  }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Produk berhasil dihapus.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghapus produk.' });
  }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await all('SELECT * FROM orders ORDER BY created_at DESC');
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memuat pesanan.' });
  }
});

app.put('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    const { paymentStatus, orderStatus } = req.body;
    const allowedPaymentStatuses = ['pending', 'paid', 'failed'];
    const allowedOrderStatuses = ['waiting_payment', 'processing', 'completed', 'cancelled'];
    if (!allowedPaymentStatuses.includes(paymentStatus) || !allowedOrderStatuses.includes(orderStatus)) {
      return res.status(400).json({ success: false, message: 'Status pembayaran atau pesanan tidak valid.' });
    }
    await run(
      'UPDATE orders SET payment_status = ?, order_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [paymentStatus || 'pending', orderStatus || 'waiting_payment', req.params.id]
    );
    res.json({ success: true, message: 'Status pesanan berhasil diperbarui.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui status pesanan.' });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  initializeApp().then(() => {
    app.listen(PORT, () => {
    console.log(`KRIS DESIGN SHOP running on http://localhost:${PORT}`);
    });
  }).catch((error) => {
    console.error('Database initialization failed:', error);
    process.exit(1);
  });
}

module.exports = app;
