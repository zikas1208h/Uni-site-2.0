/**
 * University Portal System - Backend Server
 *
 * Copyright (c) 2026 Mazen Hossam. All Rights Reserved.
 * Licensed under the MIT License. See LICENSE file in the project root for full license information.
 *
 * @author Mazen Hossam <Zikas1208h@gmail.com>
 * @file Main server file for the University Portal backend
 * @version 1.0.0
 */

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

dotenv.config();

const app = express();

// Gzip all responses — dramatically reduces payload size
app.use(compression());

// Remove "X-Powered-By: Express" header — hides tech stack
app.disable('x-powered-by');

// Security headers via Helmet
app.use(helmet({
  contentSecurityPolicy: false,         // CSP managed by frontend
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff: true,                        // X-Content-Type-Options: nosniff
  frameguard: { action: 'deny' },       // X-Frame-Options: DENY
  xssFilter: true,                      // X-XSS-Protection
  hidePoweredBy: true,
}));

// Strip internal headers that reveal infrastructure info
app.use((req, res, next) => {
  res.removeHeader('Server');
  res.removeHeader('X-Powered-By');
  next();
});

// Rate limiting — raised to avoid blocking fast usage
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: false,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

// Data sanitization
app.use(mongoSanitize());

// CORS — allow all origins to avoid preflight round-trip delays
app.use(cors({
  origin: true,
  credentials: true,
  optionsSuccessStatus: 200
}));
app.options('*', cors({ origin: true, credentials: true }));

// Basic Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

// MongoDB Connection — cached for Vercel serverless warm reuse
let cachedConn = null;
const connectDB = async () => {
  if (cachedConn && mongoose.connection.readyState === 1) return cachedConn;
  if (mongoose.connection.readyState === 1) { cachedConn = mongoose.connection; return cachedConn; }
  cachedConn = await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,   // per worker — 8 workers × 5 = 40 total connections (safe for M10/M20)
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 20000,
    connectTimeoutMS: 5000,
    bufferCommands: false,
    heartbeatFrequencyMS: 60000,
  });
  console.log('✓ MongoDB connected');
  return cachedConn;
};

// Pre-connect on cold start
connectDB().catch(err => console.error('✗ MongoDB pre-connect error:', err.message));

// Connect middleware — runs before every API request
app.use(async (req, res, next) => {
  if (req.path === '/health' || req.path === '/') return next();
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('DB connect error:', err.message);
    res.status(503).json({ success: false, message: 'Database unavailable, please retry' });
  }
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/students', require('./routes/students'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/grades', require('./routes/grades'));
app.use('/api/registration', require('./routes/registration'));
app.use('/api/assignments',   require('./routes/assignments'));
app.use('/api/submissions',   require('./routes/submissions'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/schedule',      require('./routes/schedule'));
app.use('/api/import',        require('./routes/import'));

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'HNU Portal API', version: '1.0.1', status: 'running' });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global Error Handler — NEVER expose stack traces or internal errors to client
app.use((err, req, res, next) => {
  // Always log internally
  console.error('[Global Error]', err.stack || err.message);
  const isProd = process.env.NODE_ENV === 'production';
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    // In production: generic message only. In dev: include actual error.
    message: isProd && status === 500 ? 'An internal error occurred' : (err.message || 'Internal Server Error'),
    ...(isProd ? {} : { stack: err.stack }),
  });
});

// Listen always — except on Vercel (which uses serverless, not a persistent process)
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}\n`);
  });
}

module.exports = app;

