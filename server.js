const express = require('express');
const session = require('express-session');
const FileStore = require('express-session-file-store')(session);
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Cargar store (inicializa JSON si no existe)
require('./db/store');

const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Necesario en Railway/proxy para cookies de sesión seguras
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(session({
  store: new FileStore({
    path: process.env.SESSION_DIR || '/tmp/sessions',
    ttl: 24 * 60 * 60,
    retries: 1,
    logFn: function () {}
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Telcel Store corriendo en http://0.0.0.0:${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin`);
  console.log(`   Clip configurado: ${require('./services/clip').isConfigured() ? 'SÍ' : 'NO (modo demo)'}`);
});
