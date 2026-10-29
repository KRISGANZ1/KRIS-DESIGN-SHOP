require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { put } = require('@vercel/blob');

if (!process.env.DATABASE_URL) {
  throw new Error('Set DATABASE_URL to the destination PostgreSQL database before running this migration.');
}

const sourcePath = path.resolve(process.env.SOURCE_SQLITE_PATH || path.join(__dirname, '..', 'data', 'krisdesign.db'));
if (!fs.existsSync(sourcePath)) {
  throw new Error(`SQLite source database not found: ${sourcePath}`);
}

const { db: pg, initializeSchema } = require('../db');
const source = new sqlite3.Database(sourcePath, sqlite3.OPEN_READONLY);
const tableColumns = {
  admin_users: ['id', 'username', 'password_hash', 'full_name', 'created_at'],
  categories: ['id', 'name', 'slug', 'description', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  products: ['id', 'category_id', 'name', 'slug', 'image_url', 'description', 'short_description', 'price', 'sale_price', 'stock', 'status', 'info', 'is_active', 'is_featured', 'is_new', 'is_promo', 'created_at', 'updated_at'],
  payment_methods: ['id', 'name', 'account_name', 'account_number', 'instructions', 'qr_code', 'is_active', 'created_at', 'updated_at'],
  orders: ['id', 'order_code', 'customer_name', 'whatsapp', 'email', 'notes', 'items', 'total', 'payment_method', 'payment_status', 'order_status', 'created_at', 'updated_at'],
};

function readAll(table) {
  return new Promise((resolve, reject) => {
    source.all(`SELECT * FROM ${table}`, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

function closeSource() {
  return new Promise((resolve) => source.close(() => resolve()));
}

function guessImageType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  })[extension];
}

async function moveLocalUploadToBlob(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('/uploads/')) return imageUrl;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(`BLOB_READ_WRITE_TOKEN is required to migrate uploaded image ${imageUrl}`);
  }

  const fileName = path.basename(imageUrl);
  const filePath = path.join(__dirname, '..', 'public', 'uploads', fileName);
  if (!fs.existsSync(filePath)) throw new Error(`Uploaded image is missing locally: ${filePath}`);

  const contentType = guessImageType(filePath);
  if (!contentType) throw new Error(`Unsupported uploaded image type: ${filePath}`);
  const content = await fs.promises.readFile(filePath);
  const digest = crypto.createHash('sha256').update(content).digest('hex').slice(0, 20);
  const blob = await put(`store-uploads/migrated/${digest}-${fileName}`, content, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob.url;
}

async function migrate() {
  await initializeSchema();

  const rowsByTable = {};
  for (const table of ['admin_users', 'categories', 'products', 'payment_methods', 'orders']) {
    rowsByTable[table] = await readAll(table);
  }

  if (rowsByTable.products.length + rowsByTable.payment_methods.length > 0) {
    if (rowsByTable.products.some((row) => row.image_url?.startsWith('/uploads/')) ||
        rowsByTable.payment_methods.some((row) => row.qr_code?.startsWith('/uploads/'))) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        throw new Error('Local uploads exist. Set BLOB_READ_WRITE_TOKEN before migrating to preserve product/QR images.');
      }
    }

    for (const product of rowsByTable.products) {
      product.image_url = await moveLocalUploadToBlob(product.image_url);
    }
    for (const method of rowsByTable.payment_methods) {
      method.qr_code = await moveLocalUploadToBlob(method.qr_code);
    }
  }

  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    for (const table of ['admin_users', 'categories', 'products', 'payment_methods', 'orders']) {
      const columns = tableColumns[table];
      for (const row of rowsByTable[table]) {
        const values = columns.map((column) => row[column] ?? null);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const updates = columns.filter((column) => column !== 'id')
          .map((column) => `${column} = EXCLUDED.${column}`)
          .join(', ');
        await client.query(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
          values
        );
      }
    }

    if (rowsByTable.admin_users.length) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('admin_users', 'id'), (SELECT MAX(id) FROM admin_users), true)`
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const counts = Object.fromEntries(Object.entries(rowsByTable).map(([table, rows]) => [table, rows.length]));
  console.log(`Migrated SQLite data from ${sourcePath}:`);
  console.log(JSON.stringify(counts, null, 2));
}

migrate()
  .catch((error) => {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeSource();
    await pg.end();
  });
