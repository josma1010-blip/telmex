const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'store.json');
const dir = path.dirname(dbPath);

function ensureDir() {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function defaultData() {
  return {
    products: [
      {
        id: 1,
        name: 'Chip Telcel Prepago',
        slug: 'chip-telcel-prepago',
        type: 'chip',
        description: 'Chip físico Telcel listo para activar. Ideal para línea nueva o portabilidad.',
        price: 50,
        stock: 100,
        image_url: '/img/chip.svg',
        active: true,
        features: ['Chip nano/micro/standard', 'Activación inmediata', 'Recargas desde $20', 'Cobertura nacional'],
        created_at: new Date().toISOString()
      },
      {
        id: 2,
        name: 'Chip Telcel con $100 de saldo',
        slug: 'chip-telcel-100',
        type: 'chip',
        description: 'Chip físico Telcel con $100 de saldo incluido. Perfecto para empezar a usar de inmediato.',
        price: 149,
        stock: 50,
        image_url: '/img/chip.svg',
        active: true,
        features: ['$100 de saldo incluido', 'Chip nano/micro', 'Activación el mismo día', 'Portabilidad disponible'],
        created_at: new Date().toISOString()
      },
      {
        id: 3,
        name: 'eSIM Telcel Prepago',
        slug: 'esim-telcel-prepago',
        type: 'esim',
        description: 'eSIM digital Telcel. Se entrega por correo en minutos. Compatible con iPhone, Samsung, Google Pixel y más.',
        price: 80,
        stock: 200,
        image_url: '/img/esim.svg',
        active: true,
        features: ['Entrega digital inmediata', 'Compatible iOS y Android', 'Sin chip físico', 'Activación por QR'],
        created_at: new Date().toISOString()
      },
      {
        id: 4,
        name: 'eSIM Telcel + Paquete Amigo Sin Límite',
        slug: 'esim-telcel-amigo',
        type: 'esim',
        description: 'eSIM Telcel con paquete Amigo Sin Límite de 3 GB + redes sociales ilimitadas por 30 días.',
        price: 199,
        stock: 80,
        image_url: '/img/esim.svg',
        active: true,
        features: ['3 GB + redes sociales', 'eSIM digital', 'Válido 30 días', 'Activación rápida'],
        created_at: new Date().toISOString()
      },
      {
        id: 5,
        name: 'Chip Telcel Portabilidad',
        slug: 'chip-telcel-portabilidad',
        type: 'chip',
        description: 'Chip especial para portabilidad. Conserva tu número actual de cualquier compañía.',
        price: 30,
        stock: 60,
        image_url: '/img/chip.svg',
        active: true,
        features: ['Portabilidad gratuita', 'Conserva tu número', 'Proceso guiado', 'Chip dual SIM'],
        created_at: new Date().toISOString()
      },
      {
        id: 6,
        name: 'eSIM Telcel Empresarial',
        slug: 'esim-telcel-empresarial',
        type: 'esim',
        description: 'eSIM para empresas y freelancers. Ideal para segunda línea o dispositivos IoT.',
        price: 120,
        stock: 40,
        image_url: '/img/esim.svg',
        active: true,
        features: ['Uso empresarial', 'Facturación disponible', 'Soporte prioritario', 'Múltiples eSIM'],
        created_at: new Date().toISOString()
      }
    ],
    orders: [],
    order_items: [],
    admins: [],
    counters: { product: 6, order: 0, order_item: 0, admin: 0 },
    webhook_events: []
  };
}

function load() {
  ensureDir();
  if (!fs.existsSync(dbPath)) {
    const data = defaultData();
    const email = process.env.ADMIN_EMAIL || 'admin@telcel.store';
    const pass = process.env.ADMIN_PASSWORD || 'Admin123!';
    data.admins.push({
      id: 1,
      email,
      password_hash: bcrypt.hashSync(pass, 10),
      name: 'Administrador',
      created_at: new Date().toISOString()
    });
    data.counters.admin = 1;
    save(data);
    console.log(`Admin creado: ${email}`);
    return data;
  }
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function save(data) {
  ensureDir();
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

let cache = null;

function db() {
  if (!cache) cache = load();
  return cache;
}

function persist() {
  save(cache);
}

module.exports = {
  get products() {
    return db().products;
  },
  get orders() {
    return db().orders;
  },
  get order_items() {
    return db().order_items;
  },
  get admins() {
    return db().admins;
  },
  nextId(entity) {
    const d = db();
    d.counters[entity] = (d.counters[entity] || 0) + 1;
    return d.counters[entity];
  },
  save: persist,
  reload() {
    cache = load();
  }
};
