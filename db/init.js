const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DB_PATH || './data/store.db';
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('chip', 'esim')),
    description TEXT,
    price REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    image_url TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    features TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_address TEXT,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'failed')),
    payment_request_id TEXT,
    payment_request_url TEXT,
    receipt_no TEXT,
    clip_status TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    product_type TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL,
    subtotal REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Productos de ejemplo
const products = [
  {
    name: 'Chip Telcel Prepago',
    slug: 'chip-telcel-prepago',
    type: 'chip',
    description: 'Chip físico Telcel listo para activar. Ideal para línea nueva o portabilidad. Incluye número nuevo o portabilidad gratuita.',
    price: 50,
    stock: 100,
    image_url: '/img/chip.svg',
    features: JSON.stringify(['Chip nano/micro/standard', 'Activación inmediata', 'Recargas desde $20', 'Cobertura nacional'])
  },
  {
    name: 'Chip Telcel con $100 de saldo',
    slug: 'chip-telcel-100',
    type: 'chip',
    description: 'Chip físico Telcel con $100 de saldo incluido. Perfecto para empezar a usar de inmediato.',
    price: 149,
    stock: 50,
    image_url: '/img/chip.svg',
    features: JSON.stringify(['$100 de saldo incluido', 'Chip nano/micro', 'Activación el mismo día', 'Portabilidad disponible'])
  },
  {
    name: 'eSIM Telcel Prepago',
    slug: 'esim-telcel-prepago',
    type: 'esim',
    description: 'eSIM digital Telcel. Se entrega por correo en minutos. Compatible con iPhone, Samsung, Google Pixel y más.',
    price: 80,
    stock: 200,
    image_url: '/img/esim.svg',
    features: JSON.stringify(['Entrega digital inmediata', 'Compatible iOS y Android', 'Sin chip físico', 'Activación por QR'])
  },
  {
    name: 'eSIM Telcel + Paquete Amigo Sin Límite',
    slug: 'esim-telcel-amigo',
    type: 'esim',
    description: 'eSIM Telcel con paquete Amigo Sin Límite de 3 GB + redes sociales ilimitadas por 30 días.',
    price: 199,
    stock: 80,
    image_url: '/img/esim.svg',
    features: JSON.stringify(['3 GB + redes sociales', 'eSIM digital', 'Válido 30 días', 'Activación rápida'])
  },
  {
    name: 'Chip Telcel Portabilidad',
    slug: 'chip-telcel-portabilidad',
    type: 'chip',
    description: 'Chip especial para portabilidad. Conserva tu número actual de cualquier compañía.',
    price: 30,
    stock: 60,
    image_url: '/img/chip.svg',
    features: JSON.stringify(['Portabilidad gratuita', 'Conserva tu número', 'Proceso guiado', 'Chip dual SIM'])
  },
  {
    name: 'eSIM Telcel Empresarial',
    slug: 'esim-telcel-empresarial',
    type: 'esim',
    description: 'eSIM para empresas y freelancers. Ideal para segunda línea o dispositivos IoT.',
    price: 120,
    stock: 40,
    image_url: '/img/esim.svg',
    features: JSON.stringify(['Uso empresarial', 'Facturación disponible', 'Soporte prioritario', 'Múltiples eSIM'])
  }
];

const insertProduct = db.prepare(`
  INSERT OR IGNORE INTO products (name, slug, type, description, price, stock, image_url, features)
  VALUES (@name, @slug, @type, @description, @price, @stock, @image_url, @features)
`);

const insertMany = db.transaction((items) => {
  for (const p of items) insertProduct.run(p);
});
insertMany(products);

// Admin inicial
const adminEmail = process.env.ADMIN_EMAIL || 'admin@telcel.store';
const adminPass = process.env.ADMIN_PASSWORD || 'Admin123!';
const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(adminEmail);
if (!existing) {
  const hash = bcrypt.hashSync(adminPass, 10);
  db.prepare('INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)').run(
    adminEmail,
    hash,
    'Administrador'
  );
  console.log(`Admin creado: ${adminEmail} / ${adminPass}`);
}

console.log('Base de datos inicializada correctamente en', dbPath);
db.close();
