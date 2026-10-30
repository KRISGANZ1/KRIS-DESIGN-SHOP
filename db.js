const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'krisdesign.db');
const usePostgres = Boolean(process.env.DATABASE_URL);

let db;
if (usePostgres) {
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true },
    max: Number(process.env.DATABASE_POOL_SIZE || 5),
  });
} else {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite3 = require('sqlite3').verbose();
  db = new sqlite3.Database(DB_PATH);
}

function prepareSql(sql) {
  if (!usePostgres) return sql;
  return sql.replace(/\?/g, (_, offset) => {
    const prefix = sql.slice(0, offset);
    return `$${(prefix.match(/\?/g) || []).length + 1}`;
  });
}

function run(sql, params = []) {
  if (usePostgres) {
    return db.query(prepareSql(sql), params).then((result) => ({ id: null, changes: result.rowCount }));
  }
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  if (usePostgres) {
    return db.query(prepareSql(sql), params).then((result) => result.rows[0]);
  }
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  if (usePostgres) {
    return db.query(prepareSql(sql), params).then((result) => result.rows);
  }
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initializeSchema() {
  const schemaSql = (sql) => usePostgres
    ? sql.replace('INTEGER PRIMARY KEY AUTOINCREMENT', 'BIGSERIAL PRIMARY KEY')
      .replace(/TEXT DEFAULT CURRENT_TIMESTAMP/g, 'TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP')
    : sql;
  await run(schemaSql(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `));

  await run(schemaSql(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `));

  await run(schemaSql(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      image_url TEXT,
      description TEXT,
      short_description TEXT,
      price INTEGER NOT NULL,
      sale_price INTEGER,
      stock INTEGER DEFAULT 0,
      status TEXT DEFAULT 'available',
      info TEXT,
      is_active INTEGER DEFAULT 1,
      is_featured INTEGER DEFAULT 0,
      is_new INTEGER DEFAULT 0,
      is_promo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )
  `));

  await run(schemaSql(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_code TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      email TEXT,
      notes TEXT,
      items TEXT NOT NULL,
      total INTEGER NOT NULL,
      payment_method TEXT,
      payment_status TEXT DEFAULT 'pending',
      order_status TEXT DEFAULT 'waiting_payment',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `));

  await run(schemaSql(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      account_name TEXT,
      account_number TEXT,
      instructions TEXT,
      qr_code TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `));

}

async function initializeDatabaseInternal() {
  await initializeSchema();
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminUser = await get('SELECT * FROM admin_users WHERE username = ?', [adminUsername]);
  const password = process.env.ADMIN_PASSWORD || 'change-me-in-env';
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

  if (!adminUser) {
    await run(
      'INSERT INTO admin_users (username, password_hash, full_name) VALUES (?, ?, ?)',
      [process.env.ADMIN_USERNAME || 'admin', passwordHash, 'Admin KRIS DESIGN SHOP']
    );
  } else if (adminUser.password_hash !== passwordHash) {
    await run('UPDATE admin_users SET password_hash = ? WHERE username = ?', [passwordHash, process.env.ADMIN_USERNAME || 'admin']);
  }

  const categoryCount = await get('SELECT COUNT(*) as count FROM categories');
  if (!categoryCount || Number(categoryCount.count) === 0) {
    const defaults = [
      ['ff', 'Akun Free Fire', 'akun-free-fire', 'Akun game Free Fire dengan rank, skin, dan item premium.', 1],
      ['ml', 'Akun Mobile Legends', 'akun-mobile-legends', 'Akun Mobile Legends ready untuk langsung digunakan.', 2],
      ['others', 'Akun Game Lainnya', 'akun-game-lainnya', 'Akun game lain seperti Valorant, PUBG, dan game digital lainnya.', 3],
      ['diamond', 'Diamond & Top Up Game', 'diamond-top-up-game', 'Top up diamond dan voucher game dengan proses cepat.', 4],
      ['logo', 'Desain Logo', 'desain-logo', 'Jasa desain logo brand, gaming, dan bisnis modern.', 5],
      ['banner', 'Desain Banner', 'desain-banner', 'Desain banner promosi, event, dan produk digital.', 6],
      ['graphics', 'Jasa Desain Grafis', 'jasa-desain-grafis', 'Jasa desain sosial media, poster, flyer, dan branding.', 7],
      ['digital', 'Produk Digital Lainnya', 'produk-digital-lainnya', 'Produk digital untuk kebutuhan bisnis dan kreatif.', 8],
    ];

    for (const [id, name, slug, description, order] of defaults) {
      await run(
        'INSERT INTO categories (id, name, slug, description, sort_order) VALUES (?, ?, ?, ?, ?)',
        [id, name, slug, description, order]
      );
    }
  }

  const productCount = await get('SELECT COUNT(*) as count FROM products');
  if (!productCount || Number(productCount.count) === 0) {
    const now = new Date().toISOString();
    const seedProducts = [
      {
        id: 'prod-ff-01',
        category_id: 'ff',
        name: 'Akun FF Rank Mythic + Starlight',
        slug: 'akun-ff-rank-mythic-starlight',
        image_url: '/assets/placeholder-product.svg',
        description: 'Akun Free Fire dengan rank Mythic, skin premium, starlight, dan status aman untuk digunakan.',
        short_description: 'Akun FF premium siap pakai.',
        price: 260000,
        sale_price: 220000,
        stock: 5,
        status: 'available',
        info: 'Bind akun sesuai keterangan penjual. Item dan skin sudah dicatat. Proses serah terima via chat WhatsApp.',
        is_active: 1,
        is_featured: 1,
        is_new: 1,
        is_promo: 1,
        created_at: now,
      },
      {
        id: 'prod-ml-01',
        category_id: 'ml',
        name: 'Akun ML Elite + Skin Hero',
        slug: 'akun-ml-elite-skin-hero',
        image_url: '/assets/placeholder-product.svg',
        description: 'Akun Mobile Legends dengan hero eksklusif, skin premium, dan level tinggi.',
        short_description: 'Akun ML ready untuk top up dan naik rank.',
        price: 300000,
        sale_price: 270000,
        stock: 3,
        status: 'available',
        info: 'Bind akun menggunakan nomor yang aktif. Status login dan data akun akan dijelaskan sebelum transaksi selesai.',
        is_active: 1,
        is_featured: 1,
        is_new: 0,
        is_promo: 1,
        created_at: now,
      },
      {
        id: 'prod-diamond-01',
        category_id: 'diamond',
        name: 'Top Up Diamond Mobile Legends',
        slug: 'top-up-diamond-mobile-legends',
        image_url: '/assets/placeholder-product.svg',
        description: 'Voucher top up diamond game resmi untuk kebutuhan harian maupun event.',
        short_description: 'Diamond cepat dan aman.',
        price: 120000,
        sale_price: 99000,
        stock: 50,
        status: 'available',
        info: 'Proses kirim via ID game dan server. Mohon kirim data akun sesuai kebutuhan.',
        is_active: 1,
        is_featured: 0,
        is_new: 1,
        is_promo: 1,
        created_at: now,
      },
      {
        id: 'prod-logo-01',
        category_id: 'logo',
        name: 'Jasa Desain Logo Esports',
        slug: 'jasa-desain-logo-esports',
        image_url: '/assets/placeholder-product.svg',
        description: 'Desain logo premium untuk brand gaming, komunitas, atau usaha digital yang ingin tampil modern.',
        short_description: 'Logo premium untuk brand dan komunitas.',
        price: 450000,
        sale_price: null,
        stock: 99,
        status: 'available',
        info: 'Paket termasuk konsep awal, revisi, dan file siap pakai.',
        is_active: 1,
        is_featured: 1,
        is_new: 0,
        is_promo: 0,
        created_at: now,
      },
      {
        id: 'prod-banner-01',
        category_id: 'banner',
        name: 'Desain Banner Promosi',
        slug: 'desain-banner-promosi',
        image_url: '/assets/placeholder-product.svg',
        description: 'Banner digital untuk promo, event, contest, atau kebutuhan campaign online.',
        short_description: 'Banner untuk promosi dan branding.',
        price: 180000,
        sale_price: 150000,
        stock: 30,
        status: 'available',
        info: 'Paket mencakup desain utama, ukuran yang disesuaikan, dan file export siap upload.',
        is_active: 1,
        is_featured: 0,
        is_new: 1,
        is_promo: 1,
        created_at: now,
      },
      {
        id: 'prod-digital-01',
        category_id: 'digital',
        name: 'Template Branding Digital',
        slug: 'template-branding-digital',
        image_url: '/assets/placeholder-product.svg',
        description: 'Template desain siap edit untuk branding usaha, konten sosial media, dan kebutuhan promosi.',
        short_description: 'Template digital siap edit.',
        price: 95000,
        sale_price: 80000,
        stock: 40,
        status: 'available',
        info: 'File dikirim dalam format siap edit. Cocok untuk kebutuhan promosi dan branding cepat.',
        is_active: 1,
        is_featured: 0,
        is_new: 0,
        is_promo: 1,
        created_at: now,
      }
    ];

    for (const product of seedProducts) {
      const category = await get('SELECT id FROM categories WHERE id = ?', [product.category_id]);
      if (!category) continue;

      await run(
        `INSERT INTO products (
          id, category_id, name, slug, image_url, description, short_description, price, sale_price, stock, status, info, is_active, is_featured, is_new, is_promo, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          product.id,
          product.category_id,
          product.name,
          product.slug,
          product.image_url,
          product.description,
          product.short_description,
          product.price,
          product.sale_price,
          product.stock,
          product.status,
          product.info,
          product.is_active,
          product.is_featured,
          product.is_new,
          product.is_promo,
          product.created_at,
        ]
      );
    }
  }

  const paymentCount = await get('SELECT COUNT(*) as count FROM payment_methods');
  if (!paymentCount || Number(paymentCount.count) === 0) {
    const methods = [
      [
        'bank-bca',
        'Bank BCA',
        'KRIS DESIGN SHOP',
        '1234567890',
        'Transfer sesuai nominal total pembayaran. Konfirmasi setelah transfer melalui WhatsApp admin.',
        '/assets/qr-placeholder.svg',
      ],
      [
        'bank-mandiri',
        'Bank Mandiri',
        'KRIS DESIGN SHOP',
        '101234567890',
        'Transfer ke rekening Mandiri lalu kirim bukti pembayaran ke WhatsApp admin.',
        '/assets/qr-placeholder.svg',
      ],
      [
        'ewallet-dana',
        'DANA',
        'KRIS DESIGN SHOP',
        '085782554720',
        'Bayar via DANA dan kirim bukti screenshot untuk verifikasi pesanan.',
        '',
      ],
      [
        'qris',
        'QRIS',
        'KRIS DESIGN SHOP',
        '',
        'Scan QRIS untuk membayar. Setelah pembayaran, tunggu konfirmasi admin.',
        '/assets/qr-placeholder.svg',
      ],
    ];

    for (const [id, name, accountName, accountNumber, instructions, qrCode] of methods) {
      await run(
        'INSERT INTO payment_methods (id, name, account_name, account_number, instructions, qr_code) VALUES (?, ?, ?, ?, ?, ?)',
        [id, name, accountName, accountNumber, instructions, qrCode]
      );
    }
  }

  const qrisMethod = await get('SELECT id FROM payment_methods WHERE id = ?', ['qris']);
  if (!qrisMethod) {
    await run(
      'INSERT INTO payment_methods (id, name, account_name, account_number, instructions, qr_code) VALUES (?, ?, ?, ?, ?, ?)',
      ['qris', 'QRIS', 'KRIS DESIGN SHOP', '', 'Scan QRIS untuk membayar. Setelah pembayaran, tunggu konfirmasi admin.', '/assets/qr-placeholder.svg']
    );
  }
}

async function initializeDatabase() {
  if (!usePostgres) return initializeDatabaseInternal();

  const client = await db.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [73120481]);
    locked = true;
    await initializeDatabaseInternal();
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [73120481]);
    client.release();
  }
}

module.exports = {
  db,
  usePostgres,
  run,
  get,
  all,
  initializeSchema,
  initializeDatabase,
  createOrderCode() {
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    return `KDS-${datePart}-${randomPart}`;
  },
  hashText(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
  },
};
