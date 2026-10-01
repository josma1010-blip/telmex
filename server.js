const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Directorio donde se guardan las sesiones (persistente, no MemoryStore)
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Cargar store (inicializa JSON si no existe)
require('./db/store');

const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Necesario en Railway/proxy para cookies de sesión seguras
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false
}));

// Allow WebSocket and external script connections
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
  store: new FileStore({
    path: SESSIONS_DIR,
    ttl: 24 * 60 * 60,
    retries: 1,
    logFn: () => {} // silenciar logs internos del store
  }),
  secret: process.env.SESSION_SECRET || 'telcel-store-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRoutes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/pago/exito', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pago-exito.html')));
app.get('/pago/error', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pago-error.html')));
app.get('/carrito', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/producto/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'producto.html')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Telcel Store corriendo en http://0.0.0.0:${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin`);
  console.log(`   Clip configurado: ${require('./services/clip').isConfigured() ? 'SÍ' : 'NO (modo demo)'}`);
});
