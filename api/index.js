const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const compression = require('compression');
const path = require('path');

// Load .env for local dev; on Vercel env vars are injected automatically
dotenv.config({ path: path.join(process.cwd(), '.env') });
// Fallback: also try cwd-based .env (Railway / other hosts)
if (!process.env.MONGODB_URI) dotenv.config();

const app = express();

// Gzip everything — cuts JSON payloads 60-80%
app.use(compression({ level: 6, threshold: 512 }));

app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
  hidePoweredBy: true,
}));

// Strip server-identifying headers
app.use((req, res, next) => {
  res.removeHeader('Server');
  res.removeHeader('X-Powered-By');
  next();
});
app.use(mongoSanitize());

// Open CORS — allow all origins (Vercel preview URLs change every deploy)
app.use(cors({ origin: true, credentials: true, optionsSuccessStatus: 200 }));
app.options('*', cors({ origin: true, credentials: true }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── No-cache for all API responses — data must always be fresh ───────────────
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  next();
});

// ── Cached DB connection (survives warm Vercel invocations) ──────────────────
let connectionPromise = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) return;
  if (connectionPromise) return connectionPromise;

  connectionPromise = mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000, // give Atlas more time on cold start
    socketTimeoutMS: 30000,
    connectTimeoutMS: 15000,
    bufferCommands: true,            // queue ops while connecting — prevents "not connected" errors
    maxPoolSize: 5,
    minPoolSize: 1,
    waitQueueTimeoutMS: 15000,
    heartbeatFrequencyMS: 10000,
    maxIdleTimeMS: 270000,
  }).then(() => {
    connectionPromise = null;
    console.log('✓ MongoDB connected');
  }).catch(err => {
    connectionPromise = null;
    throw err;
  });

  return connectionPromise;
};

// ── Pre-connect at module load (cold start) ───────────────────────────────────
// This runs when Vercel imports this file, so the DB connection is being
// established in the background while the first request is still in transit.
connectDB().catch(() => {});

// Connect before every request — with retry
app.use(async (req, res, next) => {
  // Skip health check
  if (req.path === '/health' || req.path === '/') return next();
  try {
    await connectDB();
    next();
  } catch (err) {
    // Retry once with short delay
    try {
      await new Promise(r => setTimeout(r, 200));
      await connectDB();
      next();
    } catch (err2) {
      console.error('DB error:', err2.message);
      res.status(503).json({ success: false, message: 'Database temporarily unavailable, please retry' });
    }
  }
});

// Routes — use __dirname so path is always relative to THIS file (api/index.js)
// On Vercel: __dirname = /var/task/api  →  routes are at /var/task/routes/
// Locally:   __dirname = .../backend/api  →  routes are at .../backend/routes/
const routeMap = {
  '/api/auth':          path.join(__dirname, '../routes/auth'),
  '/api/students':      path.join(__dirname, '../routes/students'),
  '/api/courses':       path.join(__dirname, '../routes/courses'),
  '/api/dashboard':     path.join(__dirname, '../routes/dashboard'),
  '/api/materials':     path.join(__dirname, '../routes/materials'),
  '/api/grades':        path.join(__dirname, '../routes/grades'),
  '/api/registration':  path.join(__dirname, '../routes/registration'),
  '/api/assignments':   path.join(__dirname, '../routes/assignments'),
  '/api/submissions':   path.join(__dirname, '../routes/submissions'),
  '/api/notifications': path.join(__dirname, '../routes/notifications'),
  '/api/schedule':      path.join(__dirname, '../routes/schedule'),
  '/api/import':        path.join(__dirname, '../routes/import'),
};

for (const [prefix, file] of Object.entries(routeMap)) {
  try {
    app.use(prefix, require(file));
    console.log(`✓ Route loaded: ${prefix}`);
  } catch(e) {
    console.error(`✗ Route FAILED: ${prefix} — ${e.message}`);
    // Never expose e.message to clients — log only
    app.use(prefix, (req, res) => res.status(503).json({ success: false, message: 'Route temporarily unavailable' }));
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.get('/', (req, res) => {
  res.json({ message: 'HNU Portal API', version: '1.0.0', status: 'running' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('[Global Error]', err.stack || err.message);
  const isProd = process.env.NODE_ENV === 'production';
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: isProd && status === 500 ? 'An internal error occurred' : (err.message || 'Internal Server Error'),
  });
});

module.exports = app;
