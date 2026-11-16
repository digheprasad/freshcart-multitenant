import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import { Server } from 'socket.io';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  },
});

const __dirname = path.resolve();
const dbPath = path.join(__dirname, 'data', 'freshcart.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const SITE_URL = (process.env.SITE_URL || 'http://localhost:4000').replace(/\/+$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'freshcart-dev-secret-change-me';
const PRODUCT_UNITS = [
  'g', 'mg', 'kg', 'liter', 'ml', 'piece', 'dozen', 'packet',
  'box', 'bottle', 'pouch', 'bundle', 'pair', 'set', 'pack',
  'carton', 'tray', 'roll', 'meter',
];
const FRACTIONAL_PRODUCT_UNITS = new Set(['g', 'mg', 'kg', 'liter', 'ml', 'meter']);
const DEFAULT_PAGE_TITLE = 'FreshCart | Buy Fresh Groceries Online';
const DEFAULT_PAGE_DESCRIPTION = 'Shop fresh groceries from neighborhood stores with FreshCart. Browse local shops, compare products, and order for delivery.';
const DEFAULT_SOCIAL_IMAGE = 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80';
const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(null, true);
    }
    return callback(new Error('Upload a JPG, PNG, or WebP image.'));
  },
});

function isValidStock(stock, unit) {
  if (!Number.isFinite(stock) || stock < 0) return false;
  return FRACTIONAL_PRODUCT_UNITS.has(unit)
    ? Math.abs(stock * 100 - Math.round(stock * 100)) < 1e-8
    : Number.isInteger(stock);
}

function isValidOrderQuantity(quantity, unit) {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  return FRACTIONAL_PRODUCT_UNITS.has(unit)
    ? Math.abs(quantity * 100 - Math.round(quantity * 100)) < 1e-8
    : Number.isInteger(quantity);
}

function getImageFileType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function getPublicImageUrl(image) {
  if (typeof image === 'string' && /^https?:\/\//i.test(image)) return image;
  if (typeof image === 'string' && image.startsWith('/')) return `${SITE_URL}${image}`;
  return DEFAULT_SOCIAL_IMAGE;
}

function getSeoMetadata(req) {
  let title = DEFAULT_PAGE_TITLE;
  let description = DEFAULT_PAGE_DESCRIPTION;
  let image = DEFAULT_SOCIAL_IMAGE;
  let structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'FreshCart',
    url: SITE_URL,
  };
  let noIndex = /^\/(admin|shop-admin|login|checkout)(?:\/|$)/.test(req.path);
  const shopMatch = req.path.match(/^\/shop\/([^/]+)$/);

  if (shopMatch) {
    const shop = db.prepare('SELECT * FROM shops WHERE slug = ? AND is_active = 1').get(shopMatch[1]);
    if (shop) {
      title = `${shop.name} | Fresh Groceries Online | FreshCart`;
      description = String(shop.description || `Shop fresh groceries from ${shop.name} on FreshCart.`).trim().slice(0, 160);
      image = getPublicImageUrl(shop.logo);
      const products = db.prepare(
        'SELECT name, description, price, discount_price, stock, image_url FROM products WHERE shop_id = ? AND is_active = 1 ORDER BY is_featured DESC, created_at DESC LIMIT 20'
      ).all(shop.id);
      structuredData = {
        '@context': 'https://schema.org',
        '@type': 'GroceryStore',
        name: shop.name,
        description,
        url: `${SITE_URL}${req.path}`,
        image,
        telephone: shop.phone || undefined,
        address: {
          '@type': 'PostalAddress',
          streetAddress: shop.address || undefined,
          addressCountry: 'IN',
        },
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: `${shop.name} products`,
          itemListElement: products.map((product) => ({
            '@type': 'Offer',
            priceCurrency: 'INR',
            price: Number(product.discount_price > 0 ? product.discount_price : product.price),
            availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            itemOffered: {
              '@type': 'Product',
              name: product.name,
              description: product.description || undefined,
              image: getPublicImageUrl(product.image_url),
            },
          })),
        },
      };
    } else {
      title = 'Shop not found | FreshCart';
      description = 'This shop is unavailable. Browse active neighborhood grocery stores on FreshCart.';
      noIndex = true;
      structuredData = null;
    }
  } else if (req.path !== '/') {
    noIndex = true;
    structuredData = null;
  }

  return {
    title,
    description,
    image,
    canonical: `${SITE_URL}${req.path}`,
    robots: noIndex ? 'noindex, nofollow' : 'index, follow',
    structuredData,
  };
}

function renderSeoHtml(html, metadata) {
  const replacements = {
    __SEO_TITLE__: escapeHtml(metadata.title),
    __SEO_DESCRIPTION__: escapeHtml(metadata.description),
    __SEO_CANONICAL__: escapeHtml(metadata.canonical),
    __SEO_IMAGE__: escapeHtml(metadata.image),
    __SEO_ROBOTS__: metadata.robots,
    __SEO_JSONLD__: metadata.structuredData
      ? JSON.stringify(metadata.structuredData).replace(/</g, '\\u003c')
      : '',
  };
  return html.replace(/__SEO_(TITLE|DESCRIPTION|CANONICAL|IMAGE|ROBOTS|JSONLD)__/g, (token) => replacements[token]);
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      logo TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      opening_hours TEXT DEFAULT '9:00 AM - 9:00 PM',
      closing_hours TEXT,
      delivery_charges REAL DEFAULT 0,
      minimum_order REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_approved INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      shop_id INTEGER,
      phone TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(shop_id) REFERENCES shops(id)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      shop_id INTEGER,
      full_name TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(shop_id) REFERENCES shops(id)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      image_url TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(shop_id) REFERENCES shops(id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      category_id INTEGER,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      discount_price REAL,
      stock REAL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'piece',
      sku TEXT,
      image_url TEXT,
      is_featured INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(shop_id) REFERENCES shops(id),
      FOREIGN KEY(category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      customer_user_id INTEGER,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      delivery_address TEXT,
      payment_method TEXT,
      total_amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(shop_id) REFERENCES shops(id),
      FOREIGN KEY(customer_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'piece',
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER,
      user_id INTEGER,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(shop_id) REFERENCES shops(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      plan TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      start_date TEXT DEFAULT CURRENT_TIMESTAMP,
      end_date TEXT,
      amount REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(shop_id) REFERENCES shops(id)
    );
  `);

  const productColumns = db.pragma('table_info(products)');
  if (!productColumns.some((column) => column.name === 'unit')) {
    db.exec("ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'piece'");
  }
  const orderItemColumns = db.pragma('table_info(order_items)');
  if (!orderItemColumns.some((column) => column.name === 'unit')) {
    db.exec("ALTER TABLE order_items ADD COLUMN unit TEXT NOT NULL DEFAULT 'piece'");
  }
}

function getSafeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    shopId: user.shop_id,
    phone: user.phone,
    isActive: Boolean(user.is_active),
    createdAt: user.created_at,
  };
}

function createNotification({ shopId = null, userId = null, type, message }) {
  db.prepare(
    `INSERT INTO notifications (shop_id, user_id, type, message) VALUES (?, ?, ?, ?)`
  ).run(shopId, userId, type, message);

  io.emit('notification', {
    shopId,
    userId,
    type,
    message,
    createdAt: new Date().toISOString(),
  });
}

async function sendEmailNotification({ to, subject, text }) {
  const emailHost = process.env.EMAIL_HOST;
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (!emailHost || !emailUser || !emailPass) {
    console.warn('Email credentials missing; skipping outbound email notification.');
    return { success: false, reason: 'missing_env' };
  }

  const transporter = nodemailer.createTransport({
    host: emailHost,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: false,
    auth: { user: emailUser, pass: emailPass },
  });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || emailUser,
      to,
      subject,
      text,
    });
    return { success: true };
  } catch (error) {
    console.error('Email notification failed:', error.message);
    return { success: false, reason: error.message };
  }
}

async function sendWhatsAppNotification({ phone, message }) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneNumberId || !phone) {
    console.warn('WhatsApp configuration missing; skipping outbound notification.');
    return { success: false, reason: 'missing_env' };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone.replace(/\D/g, ''),
          type: 'text',
          text: { body: message },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'WhatsApp request failed');
    }

    return { success: true, data };
  } catch (error) {
    console.error('WhatsApp notification failed:', error.message);
    return { success: false, reason: error.message };
  }
}

function bootstrapSuperAdmin() {
  const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1").get();
  if (existingAdmin) return;

  const email = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || '');
  if (!email || !password) {
    throw new Error('No super admin exists. Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD before starting FreshCart.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('SUPER_ADMIN_EMAIL must be a valid email address.');
  }
  if (password.length < 12) {
    throw new Error('SUPER_ADMIN_PASSWORD must be at least 12 characters long.');
  }

  db.prepare(
    `INSERT INTO users (name, email, password_hash, role, shop_id, phone, is_active)
     VALUES (?, ?, ?, 'super_admin', NULL, NULL, 1)`
  ).run(
    String(process.env.SUPER_ADMIN_NAME || 'Platform Admin').trim(),
    email,
    bcrypt.hashSync(password, 12)
  );
}

function authUser(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const tokenFromHeader = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = req.cookies?.token || tokenFromHeader;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token.' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'You do not have permission for this action.' });
    }
    return next();
  };
}

function getCurrentShopId(req) {
  if (req.user.role === 'super_admin') {
    return Number(req.query.shopId || req.body?.shopId || 0) || null;
  }
  return req.user.shopId ?? null;
}

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })
);
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false,
  })
);

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Try again later.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again later.' },
});

app.use('/api', generalLimiter);

app.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/auth/register', loginLimiter, (req, res) => {
  const { name, email, password, phone } = req.body || {};
  const normalizedName = String(name || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '');
  const normalizedPhone = String(phone || '').trim();

  if (!normalizedName || !normalizedEmail || !normalizedPassword || !normalizedPhone) {
    return res.status(400).json({ success: false, error: 'Name, email, phone and password are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
  }
  if (normalizedPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ success: false, error: 'User already exists.' });
  }

  const passwordHash = bcrypt.hashSync(normalizedPassword, 10);
  const user = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, shop_id, phone, is_active)
     VALUES (?, ?, ?, 'customer', NULL, ?, 1)`
  ).run(normalizedName, normalizedEmail, passwordHash, normalizedPhone);

  const createdUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.lastInsertRowid);
  const token = jwt.sign(
    { id: createdUser.id, name: createdUser.name, email: createdUser.email, role: createdUser.role, shopId: createdUser.shop_id },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  });

  return res.status(201).json({
    success: true,
    user: getSafeUser(createdUser),
    token,
  });
});

app.post('/api/auth/customer/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required.' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE email = ? AND is_active = 1')
    .get(normalizedEmail);

  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ success: false, error: 'Invalid email or password.' });
  }
  if (user.role !== 'customer') {
    return res.status(403).json({ success: false, error: 'Use the store or admin sign-in page for this account.' });
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, shopId: user.shop_id },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  });

  return res.json({ success: true, user: getSafeUser(user), token });
});

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required.' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE email = ? AND is_active = 1')
    .get(String(email).trim().toLowerCase());

  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ success: false, error: 'Invalid credentials.' });
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, shopId: user.shop_id },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  });

  return res.json({ success: true, user: getSafeUser(user), token });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  return res.json({ success: true, message: 'Logged out successfully.' });
});

app.get('/api/auth/me', authUser, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  return res.json({ success: true, user: getSafeUser(user) });
});

app.patch('/api/auth/credentials', authUser, requireRoles('super_admin'), loginLimiter, (req, res) => {
  const { currentPassword, email, newPassword } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const password = String(newPassword || '');
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND role = ? AND is_active = 1')
    .get(req.user.id, 'super_admin');

  if (!user || !currentPassword || !bcrypt.compareSync(String(currentPassword), user.password_hash)) {
    return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ success: false, error: 'Enter a valid admin email address.' });
  }
  if (password.length < 12) {
    return res.status(400).json({ success: false, error: 'New password must be at least 12 characters long.' });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, user.id);
  if (existingUser) {
    return res.status(409).json({ success: false, error: 'That email address is already in use.' });
  }

  db.prepare('UPDATE users SET email = ?, password_hash = ? WHERE id = ?')
    .run(normalizedEmail, bcrypt.hashSync(password, 12), user.id);
  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const token = jwt.sign(
    { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, role: updatedUser.role, shopId: updatedUser.shop_id },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  });

  return res.json({ success: true, user: getSafeUser(updatedUser), token });
});

app.get('/api/public/shops', (req, res) => {
  const shops = db.prepare('SELECT * FROM shops WHERE is_active = 1 ORDER BY created_at DESC').all();
  return res.json({ success: true, shops });
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /shop-admin',
    'Disallow: /login',
    'Disallow: /checkout',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n'));
});

app.get('/sitemap.xml', (req, res) => {
  const shops = db.prepare('SELECT slug, created_at FROM shops WHERE is_active = 1 ORDER BY created_at DESC').all();
  const shopUrls = shops.map((shop) => {
    const lastModified = String(shop.created_at || '').slice(0, 10);
    return `<url><loc>${escapeHtml(`${SITE_URL}/shop/${encodeURIComponent(shop.slug)}`)}</loc>${lastModified ? `<lastmod>${escapeHtml(lastModified)}</lastmod>` : ''}</url>`;
  });
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<url><loc>${escapeHtml(`${SITE_URL}/`)}</loc></url>`,
    ...shopUrls,
    '</urlset>',
  ].join('');
  res.type('application/xml').send(sitemap);
});

app.get('/api/public/shops/:slug', (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE slug = ? AND is_active = 1').get(req.params.slug);
  if (!shop) {
    return res.status(404).json({ success: false, error: 'Shop not found.' });
  }

  return res.json({ success: true, shop });
});

app.get('/api/public/shops/:slug/products', (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE slug = ? AND is_active = 1').get(req.params.slug);
  if (!shop) {
    return res.status(404).json({ success: false, error: 'Shop not found.' });
  }

  const categories = db
    .prepare('SELECT id, name, slug, image_url FROM categories WHERE shop_id = ? AND is_active = 1 ORDER BY name')
    .all(shop.id);
  const products = db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.image_url AS category_image_url
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.shop_id = ? AND p.is_active = 1
       ORDER BY p.is_featured DESC, p.created_at DESC`
    )
    .all(shop.id);

  return res.json({ success: true, shop, categories, products });
});

app.get('/api/dashboard/summary', authUser, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  if (user.role === 'super_admin') {
    const totals = {
      shops: db.prepare('SELECT COUNT(*) AS total FROM shops').get().total,
      products: db.prepare('SELECT COUNT(*) AS total FROM products').get().total,
      customers: db.prepare('SELECT COUNT(*) AS total FROM users WHERE role = ?').get('customer').total,
      orders: db.prepare('SELECT COUNT(*) AS total FROM orders').get().total,
      revenue: db.prepare('SELECT COALESCE(SUM(total_amount), 0) AS total FROM orders').get().total,
    };
    const recentOrders = db
      .prepare(
        `SELECT o.*, s.name AS shop_name
         FROM orders o
         LEFT JOIN shops s ON s.id = o.shop_id
         ORDER BY o.created_at DESC LIMIT 5`
      )
      .all();
    return res.json({ success: true, totals, recentOrders });
  }

  if (user.role === 'shop_owner') {
    const shopId = user.shop_id;
    const totals = {
      products: db.prepare('SELECT COUNT(*) AS total FROM products WHERE shop_id = ?').get(shopId).total,
      orders: db.prepare('SELECT COUNT(*) AS total FROM orders WHERE shop_id = ?').get(shopId).total,
      revenue: db.prepare('SELECT COALESCE(SUM(total_amount), 0) AS total FROM orders WHERE shop_id = ?').get(shopId).total,
      pending: db.prepare('SELECT COUNT(*) AS total FROM orders WHERE shop_id = ? AND status = ?').get(shopId, 'pending').total,
      stockAlerts: db.prepare('SELECT COUNT(*) AS total FROM products WHERE shop_id = ? AND stock <= 10').get(shopId).total,
    };
    const recentOrders = db
      .prepare(
        `SELECT * FROM orders WHERE shop_id = ? ORDER BY created_at DESC LIMIT 5`
      )
      .all(shopId);
    return res.json({ success: true, totals, recentOrders });
  }

  const userOrders = db.prepare('SELECT * FROM orders WHERE customer_user_id = ? ORDER BY created_at DESC LIMIT 5').all(user.id);
  return res.json({ success: true, totals: { orders: userOrders.length }, recentOrders: userOrders });
});

app.get('/api/notifications', authUser, (req, res) => {
  let rows;
  if (req.user.role === 'super_admin') {
    rows = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20').all();
  } else {
    rows = db
      .prepare('SELECT * FROM notifications WHERE shop_id = ? OR user_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(req.user.shopId, req.user.id);
  }

  return res.json({ success: true, notifications: rows });
});

app.get('/api/admin/shops', authUser, requireRoles('super_admin'), (req, res) => {
  const shops = db.prepare('SELECT * FROM shops ORDER BY created_at DESC').all();
  return res.json({ success: true, shops });
});

app.patch('/api/admin/shops/:id/status', authUser, requireRoles('super_admin'), (req, res) => {
  const shopId = Number(req.params.id);
  const { isActive } = req.body || {};
  if (!Number.isInteger(shopId) || shopId <= 0 || ![true, false, 0, 1].includes(isActive)) {
    return res.status(400).json({ success: false, error: 'A valid shop and active status are required.' });
  }

  const shop = db.prepare('SELECT id, name FROM shops WHERE id = ?').get(shopId);
  if (!shop) {
    return res.status(404).json({ success: false, error: 'Shop not found.' });
  }

  const active = Number(Boolean(isActive));
  db.prepare('UPDATE shops SET is_active = ? WHERE id = ?').run(active, shopId);
  createNotification({
    shopId,
    type: active ? 'shop_activated' : 'shop_deactivated',
    message: `Shop ${shop.name} was ${active ? 'activated' : 'deactivated'}.`,
  });

  return res.json({ success: true, isActive: Boolean(active) });
});

app.post('/api/admin/shops', authUser, requireRoles('super_admin'), (req, res) => {
  const {
    name,
    slug,
    description,
    address,
    email,
    phone,
    deliveryCharges,
    minimumOrder,
    owners,
    ownerName,
    ownerEmail,
    ownerPassword,
  } = req.body || {};
  const shopName = String(name || '').trim();
  const shopSlug = String(slug || '').trim().toLowerCase();
  const ownerAccounts = (Array.isArray(owners) ? owners : [{
    name: ownerName,
    email: ownerEmail || email,
    password: ownerPassword,
    phone,
  }]).map((owner) => ({
    name: String(owner?.name || '').trim(),
    email: String(owner?.email || '').trim().toLowerCase(),
    password: String(owner?.password || ''),
    phone: String(owner?.phone || '').trim(),
  }));
  const primaryOwner = ownerAccounts[0];
  const charges = Number(deliveryCharges || 0);
  const orderMinimum = Number(minimumOrder || 0);

  if (!shopName || !shopSlug || ownerAccounts.length === 0 || ownerAccounts.some((owner) => (
    !owner.name || !owner.email || !owner.password || !owner.phone
  ))) {
    return res.status(400).json({ success: false, error: 'Shop details and at least one complete shop owner account are required.' });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shopSlug)) {
    return res.status(400).json({ success: false, error: 'Shop URL must use lowercase letters, numbers and hyphens.' });
  }
  if (ownerAccounts.some((owner) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email))) {
    return res.status(400).json({ success: false, error: 'Enter a valid email address for each shop owner.' });
  }
  if (ownerAccounts.some((owner) => owner.password.length < 8)) {
    return res.status(400).json({ success: false, error: 'Each shop owner password must be at least 8 characters.' });
  }
  if (!Number.isFinite(charges) || charges < 0 || !Number.isFinite(orderMinimum) || orderMinimum < 0) {
    return res.status(400).json({ success: false, error: 'Delivery charges and minimum order must be zero or greater.' });
  }
  if (db.prepare('SELECT id FROM shops WHERE slug = ?').get(shopSlug)) {
    return res.status(409).json({ success: false, error: 'A shop with this URL already exists.' });
  }
  const ownerEmails = ownerAccounts.map((owner) => owner.email);
  if (new Set(ownerEmails).size !== ownerEmails.length) {
    return res.status(400).json({ success: false, error: 'Each shop owner must have a different email address.' });
  }
  const findUserByEmail = db.prepare('SELECT id FROM users WHERE email = ?');
  if (ownerEmails.some((ownerEmail) => findUserByEmail.get(ownerEmail))) {
    return res.status(409).json({ success: false, error: 'A user with one of these owner email addresses already exists.' });
  }

  const ownersWithPasswordHashes = ownerAccounts.map((owner) => ({
    ...owner,
    passwordHash: bcrypt.hashSync(owner.password, 10),
  }));
  const createShop = db.transaction(() => {
    const shop = db.prepare(
      `INSERT INTO shops (name, slug, description, address, email, phone, delivery_charges, minimum_order, is_active, is_approved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`
    ).run(
      shopName,
      shopSlug,
      String(description || '').trim(),
      String(address || '').trim(),
      primaryOwner.email,
      primaryOwner.phone,
      charges,
      orderMinimum
    );

    const insertOwner = db.prepare(
      `INSERT INTO users (name, email, password_hash, role, shop_id, phone, is_active)
       VALUES (?, ?, ?, 'shop_owner', ?, ?, 1)`
    );
    for (const owner of ownersWithPasswordHashes) {
      insertOwner.run(owner.name, owner.email, owner.passwordHash, shop.lastInsertRowid, owner.phone);
    }

    return shop.lastInsertRowid;
  });

  let shopId;
  try {
    shopId = createShop();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ success: false, error: 'A shop or user with these details already exists.' });
    }
    throw error;
  }

  createNotification({ type: 'shop_created', message: `Shop ${shopName} was created successfully.` });
  return res.status(201).json({
    success: true,
    shopId,
    ownerEmail: primaryOwner.email,
    ownerEmails,
  });
});

app.get('/api/categories', authUser, (req, res) => {
  const shopId = getCurrentShopId(req);
  if (!shopId) {
    return res.status(403).json({ success: false, error: 'Shop scope missing.' });
  }

  const categories = db
    .prepare('SELECT * FROM categories WHERE shop_id = ? AND is_active = 1 ORDER BY created_at DESC')
    .all(shopId);
  return res.json({ success: true, categories });
});

app.post(
  '/api/categories/upload-image',
  authUser,
  requireRoles('super_admin', 'shop_owner'),
  (req, res, next) => {
    productImageUpload.single('image')(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, error: 'Image must be 5 MB or smaller.' });
      }
      return res.status(400).json({ success: false, error: error.message || 'Image upload failed.' });
    });
  },
  async (req, res) => {
    const shopId = getCurrentShopId(req);
    if (!shopId) {
      return res.status(403).json({ success: false, error: 'Shop scope missing.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Choose an image to upload.' });
    }

    const imageType = getImageFileType(req.file.buffer);
    if (!imageType || imageType.mimeType !== req.file.mimetype) {
      return res.status(400).json({ success: false, error: 'The selected file is not a valid JPG, PNG, or WebP image.' });
    }

    const imageDirectory = path.join(__dirname, 'uploads', 'categories', String(shopId));
    const filename = `${randomUUID()}.${imageType.extension}`;
    await fs.promises.mkdir(imageDirectory, { recursive: true });
    await fs.promises.writeFile(path.join(imageDirectory, filename), req.file.buffer, { flag: 'wx' });

    return res.status(201).json({
      success: true,
      imageUrl: `/uploads/categories/${shopId}/${filename}`,
    });
  }
);

app.post('/api/categories', authUser, requireRoles('super_admin', 'shop_owner'), (req, res) => {
  const shopId = getCurrentShopId(req);
  const { name, imageUrl } = req.body || {};
  if (!name) {
    return res.status(400).json({ success: false, error: 'Category name is required.' });
  }

  const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const category = db.prepare(
    `INSERT INTO categories (shop_id, name, slug, image_url, is_active)
     VALUES (?, ?, ?, ?, 1)`
  ).run(shopId, String(name).trim(), slug, imageUrl || '');

  return res.status(201).json({ success: true, categoryId: category.lastInsertRowid });
});

app.patch('/api/categories/:id', authUser, requireRoles('super_admin', 'shop_owner'), (req, res) => {
  const shopId = getCurrentShopId(req);
  const category = db.prepare('SELECT * FROM categories WHERE id = ? AND shop_id = ?').get(Number(req.params.id), shopId);
  if (!category) {
    return res.status(404).json({ success: false, error: 'Category not found.' });
  }

  const { name, imageUrl, isActive } = req.body || {};
  const nextName = name ? String(name).trim() : category.name;
  const nextSlug = (name ? String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : category.slug);
  db.prepare(
    `UPDATE categories SET name = ?, slug = ?, image_url = ?, is_active = ? WHERE id = ? AND shop_id = ?`
  ).run(nextName, nextSlug, imageUrl !== undefined ? imageUrl : category.image_url, isActive !== undefined ? Number(isActive) : category.is_active, Number(req.params.id), shopId);

  return res.json({ success: true, message: 'Category updated.' });
});

app.delete('/api/categories/:id', authUser, requireRoles('super_admin', 'shop_owner'), (req, res) => {
  const shopId = getCurrentShopId(req);
  const category = db.prepare('SELECT * FROM categories WHERE id = ? AND shop_id = ?').get(Number(req.params.id), shopId);
  if (!category) {
    return res.status(404).json({ success: false, error: 'Category not found.' });
  }

  db.prepare('UPDATE categories SET is_active = 0 WHERE id = ? AND shop_id = ?').run(Number(req.params.id), shopId);
  return res.json({ success: true, message: 'Category deleted.' });
});

app.get('/api/products', authUser, requireRoles('super_admin', 'shop_owner'), (req, res) => {
  const shopId = getCurrentShopId(req);
  if (!shopId) {
    return res.status(403).json({ success: false, error: 'Shop scope missing.' });
  }

  const products = db
    .prepare(
      `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.shop_id = ?
       ORDER BY p.created_at DESC`
    )
    .all(shopId);

  return res.json({ success: true, products });
});

app.post(
  '/api/products/upload-image',
  authUser,
  requireRoles('super_admin', 'shop_owner'),
  (req, res, next) => {
    productImageUpload.single('image')(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, error: 'Image must be 5 MB or smaller.' });
      }
      return res.status(400).json({ success: false, error: error.message || 'Image upload failed.' });
    });
  },
  async (req, res) => {
    const shopId = getCurrentShopId(req);
    if (!shopId) {
      return res.status(403).json({ success: false, error: 'Shop scope missing.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Choose an image to upload.' });
    }

    const imageType = getImageFileType(req.file.buffer);
    if (!imageType || imageType.mimeType !== req.file.mimetype) {
      return res.status(400).json({ success: false, error: 'The selected file is not a valid JPG, PNG, or WebP image.' });
    }

    const imageDirectory = path.join(__dirname, 'uploads', 'products', String(shopId));
    const filename = `${randomUUID()}.${imageType.extension}`;
    await fs.promises.mkdir(imageDirectory, { recursive: true });
    await fs.promises.writeFile(path.join(imageDirectory, filename), req.file.buffer, { flag: 'wx' });

    return res.status(201).json({
      success: true,
      imageUrl: `/uploads/products/${shopId}/${filename}`,
    });
  }
);

app.post('/api/products', authUser, requireRoles('super_admin', 'shop_owner'), (req, res) => {
  const shopId = getCurrentShopId(req);
  const { name, description, price, discountPrice, categoryId, stock, unit = 'piece', sku, imageUrl, isFeatured } = req.body || {};
  const productPrice = Number(price);
  const productDiscount = Number(discountPrice || 0);
  const productStock = Number(stock || 0);

  if (!name || !Number.isFinite(productPrice) || productPrice <= 0) {
    return res.status(400).json({ success: false, error: 'Product name and price are required.' });
  }
  if (!PRODUCT_UNITS.includes(unit)) {
    return res.status(400).json({ success: false, error: 'Choose a supported product unit.' });
  }
  if (!Number.isFinite(productDiscount) || productDiscount < 0 || !isValidStock(productStock, unit)) {
    return res.status(400).json({ success: false, error: 'Enter a valid discount and stock quantity for this unit.' });
  }

  const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const product = db.prepare(
    `INSERT INTO products (shop_id, category_id, name, slug, description, price, discount_price, stock, unit, sku, image_url, is_featured, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    shopId,
    categoryId || null,
    String(name).trim(),
    slug,
    description || '',
    productPrice,
    productDiscount,
    productStock,
    unit,
    sku || '',
    imageUrl || '',
    isFeatured ? 1 : 0
  );

  createNotification({
    shopId,
    userId: req.user.id,
    type: 'product_added',
    message: `Product ${name} was added to the catalog.`,
  });

  return res.status(201).json({ success: true, productId: product.lastInsertRowid });
});

app.patch('/api/products/:id', authUser, requireRoles('super_admin', 'shop_owner'), (req, res) => {
  const shopId = getCurrentShopId(req);
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND shop_id = ?').get(Number(req.params.id), shopId);

  if (!product) {
    return res.status(404).json({ success: false, error: 'Product not found for your shop.' });
  }

  const { name, description, price, discountPrice, stock, unit, sku, imageUrl, isFeatured, isActive } = req.body || {};
  const nextUnit = unit !== undefined ? unit : (product.unit || 'piece');
  const nextPrice = price !== undefined ? Number(price) : product.price;
  const nextDiscount = discountPrice !== undefined ? Number(discountPrice) : Number(product.discount_price || 0);
  const nextStock = stock !== undefined ? Number(stock) : product.stock;
  if (!PRODUCT_UNITS.includes(nextUnit)) {
    return res.status(400).json({ success: false, error: 'Choose a supported product unit.' });
  }
  if (!Number.isFinite(nextPrice) || nextPrice <= 0 || !Number.isFinite(nextDiscount) || nextDiscount < 0 || !isValidStock(nextStock, nextUnit)) {
    return res.status(400).json({ success: false, error: 'Enter a valid price, discount, and stock quantity for this unit.' });
  }
  db.prepare(
    `UPDATE products
     SET name = ?, description = ?, price = ?, discount_price = ?, stock = ?, unit = ?, sku = ?, image_url = ?, is_featured = ?, is_active = ?
     WHERE id = ? AND shop_id = ?`
  ).run(
    name ? String(name).trim() : product.name,
    description ?? product.description,
    nextPrice,
    nextDiscount,
    nextStock,
    nextUnit,
    sku !== undefined ? String(sku) : product.sku,
    imageUrl !== undefined ? String(imageUrl) : product.image_url,
    isFeatured !== undefined ? Number(isFeatured) : product.is_featured,
    isActive !== undefined ? Number(isActive) : product.is_active,
    Number(req.params.id),
    shopId
  );

  return res.json({ success: true, message: 'Product updated.' });
});

app.delete('/api/products/:id', authUser, requireRoles('super_admin', 'shop_owner'), (req, res) => {
  const shopId = getCurrentShopId(req);
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND shop_id = ?').get(Number(req.params.id), shopId);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Product not found.' });
  }

  db.prepare('UPDATE products SET is_active = 0 WHERE id = ? AND shop_id = ?').run(Number(req.params.id), shopId);
  return res.json({ success: true, message: 'Product deleted.' });
});

app.get('/api/customer/orders', authUser, requireRoles('customer'), (req, res) => {
  const orders = db.prepare(
    `SELECT o.*, s.name AS shop_name
     FROM orders o
     JOIN shops s ON s.id = o.shop_id
     WHERE o.customer_user_id = ?
     ORDER BY o.created_at DESC, o.id DESC`
  ).all(req.user.id);
  const getItems = db.prepare(
    `SELECT product_id, product_name, quantity, unit, unit_price, subtotal
     FROM order_items WHERE order_id = ? ORDER BY id ASC`
  );

  return res.json({
    success: true,
    orders: orders.map((order) => {
      const items = getItems.all(order.id);
      const itemsSubtotal = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
      return {
        ...order,
        items,
        delivery_charge: Number((Number(order.total_amount) - itemsSubtotal).toFixed(2)),
      };
    }),
  });
});

app.post('/api/customer/orders/:id/cancel', authUser, requireRoles('customer'), (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return res.status(400).json({ success: false, error: 'Invalid order ID.' });
  }

  const result = db.transaction(() => {
    const order = db.prepare(
      'SELECT id, shop_id, status FROM orders WHERE id = ? AND customer_user_id = ?'
    ).get(orderId, req.user.id);
    if (!order) return { reason: 'not_found' };
    if (order.status !== 'pending') return { reason: 'not_pending' };

    const update = db.prepare(
      `UPDATE orders SET status = 'cancelled'
       WHERE id = ? AND customer_user_id = ? AND status = 'pending'`
    ).run(orderId, req.user.id);
    if (update.changes !== 1) return { reason: 'not_pending' };

    const items = db.prepare(
      'SELECT product_id, quantity FROM order_items WHERE order_id = ?'
    ).all(orderId);
    const restoreStock = db.prepare(
      'UPDATE products SET stock = stock + ? WHERE id = ? AND shop_id = ?'
    );
    for (const item of items) {
      restoreStock.run(item.quantity, item.product_id, order.shop_id);
    }

    return { reason: 'cancelled', shopId: order.shop_id };
  })();

  if (result.reason === 'not_found') {
    return res.status(404).json({ success: false, error: 'Order not found.' });
  }
  if (result.reason === 'not_pending') {
    return res.status(409).json({ success: false, error: 'Only pending orders can be cancelled.' });
  }

  const message = `Order #${orderId} was cancelled by the customer.`;
  const owners = db.prepare('SELECT id FROM users WHERE role = ? AND shop_id = ?').all('shop_owner', result.shopId);
  for (const owner of owners) {
    createNotification({
      shopId: result.shopId,
      userId: owner.id,
      type: 'order_cancelled',
      message,
    });
  }
  createNotification({
    shopId: result.shopId,
    userId: req.user.id,
    type: 'order_cancelled',
    message: `Your order #${orderId} was cancelled.`,
  });

  return res.json({ success: true, message: 'Order cancelled.' });
});

app.get('/api/orders', authUser, (req, res) => {
  let rows;
  if (req.user.role === 'super_admin') {
    rows = db
      .prepare(
        `SELECT o.*, s.name AS shop_name
         FROM orders o
         LEFT JOIN shops s ON s.id = o.shop_id
         ORDER BY o.created_at DESC`
      )
      .all();
  } else if (req.user.role === 'shop_owner') {
    rows = db.prepare('SELECT * FROM orders WHERE shop_id = ? ORDER BY created_at DESC').all(req.user.shopId);
  } else {
    rows = db.prepare('SELECT * FROM orders WHERE customer_user_id = ? ORDER BY created_at DESC').all(req.user.id);
  }

  return res.json({ success: true, orders: rows });
});

app.get('/api/orders/:id', authUser, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found.' });
  }

  if (req.user.role === 'customer' && req.user.id !== order.customer_user_id) {
    return res.status(403).json({ success: false, error: 'You cannot view this order.' });
  }

  if (req.user.role === 'shop_owner' && req.user.shopId !== order.shop_id) {
    return res.status(403).json({ success: false, error: 'You cannot view this order.' });
  }

  const items = db.prepare(
    `SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC`
  ).all(Number(req.params.id));

  return res.json({ success: true, order: { ...order, items } });
});

app.post('/api/orders', authUser, requireRoles('customer'), async (req, res) => {
  const { shopSlug, items, deliveryAddress, paymentMethod, customerPhone } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND role = ? AND is_active = 1')
    .get(req.user.id, 'customer');
  if (!user) {
    return res.status(401).json({ success: false, error: 'Your customer account is unavailable.' });
  }

  const phone = String(customerPhone || '').trim();
  const address = String(deliveryAddress || '').trim();
  if (!shopSlug || !Array.isArray(items) || items.length === 0 || !address || !phone) {
    return res.status(400).json({ success: false, error: 'Shop, items, customer phone and delivery address are required.' });
  }

  const shop = db.prepare('SELECT * FROM shops WHERE slug = ? AND is_active = 1').get(String(shopSlug));
  if (!shop) {
    return res.status(404).json({ success: false, error: 'Shop not found.' });
  }

  let total = 0;
  const orderItems = [];

  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND shop_id = ? AND is_active = 1').get(Number(item.productId), shop.id);
    if (!product) {
      return res.status(400).json({ success: false, error: `Product ${item.productId} not available.` });
    }

    const quantity = Number(item.quantity || 0);
    const unit = PRODUCT_UNITS.includes(product.unit) ? product.unit : 'piece';
    if (!isValidOrderQuantity(quantity, unit) || quantity > product.stock) {
      return res.status(400).json({ success: false, error: `Insufficient stock for ${product.name}.` });
    }

    const unitPrice = Number(product.discount_price > 0 ? product.discount_price : product.price);
    const subtotal = Number((unitPrice * quantity).toFixed(2));
    total += subtotal;
    orderItems.push({ productId: product.id, productName: product.name, quantity, unit, unitPrice, subtotal });
  }

  const itemsSubtotal = Number(total.toFixed(2));
  const deliveryCharge = Number(shop.delivery_charges || 0);
  total = Number((itemsSubtotal + deliveryCharge).toFixed(2));

  const customer = { id: user.id, name: user.name, email: user.email, phone };
  const orderRecord = db.transaction(() => {
    db.prepare('UPDATE users SET phone = ? WHERE id = ? AND role = ?')
      .run(phone, user.id, 'customer');
    const orderId = db.prepare(
      `INSERT INTO orders (shop_id, customer_user_id, customer_name, customer_email, customer_phone, delivery_address, payment_method, total_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(
      shop.id,
      customer.id,
      customer.name,
      customer.email,
      customer.phone || '',
      address,
      paymentMethod || 'cash_on_delivery',
      total
    ).lastInsertRowid;

    for (const item of orderItems) {
      db.prepare(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(orderId, item.productId, item.productName, item.quantity, item.unit, item.unitPrice, item.subtotal);

      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND shop_id = ?').run(item.quantity, item.productId, shop.id);
    }

    return { orderId, itemsSubtotal, deliveryCharge, total };
  })();

  createNotification({
    shopId: shop.id,
    userId: customer.id,
    type: 'order_created',
    message: `New order #${orderRecord.orderId} received for ${shop.name}.`,
  });

  const owners = db.prepare('SELECT * FROM users WHERE role = ? AND shop_id = ? ORDER BY id ASC').all('shop_owner', shop.id);
  for (const owner of owners) {
    createNotification({
      shopId: shop.id,
      userId: owner.id,
      type: 'order_created',
      message: `New order #${orderRecord.orderId} was placed by ${customer.name}.`,
    });
  }

  const notificationRecipients = owners.length > 0 ? owners : [{
    email: shop.email,
    phone: shop.phone,
  }];
  const orderMessage = `New order #${orderRecord.orderId} for ${shop.name}. Total: ₹${total}.`;
  await Promise.all(notificationRecipients.flatMap((owner) => [
    sendEmailNotification({
      to: owner.email,
      subject: `New order #${orderRecord.orderId}`,
      text: `Customer ${customer.name} placed a new order in ${shop.name}. Total: ₹${total}.`,
    }),
    sendWhatsAppNotification({ phone: owner.phone, message: orderMessage }),
  ]));

  return res.status(201).json({
    success: true,
    orderId: orderRecord.orderId,
    itemsSubtotal: orderRecord.itemsSubtotal,
    deliveryCharge: orderRecord.deliveryCharge,
    total: orderRecord.total,
  });
});

app.patch('/api/orders/:id/status', authUser, (req, res) => {
  const { status } = req.body || {};
  const allowedStatuses = ['pending', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'];
  if (!status || !allowedStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: 'Valid order status is required.' });
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found.' });
  }

  if (req.user.role !== 'super_admin' && req.user.shopId !== order.shop_id) {
    return res.status(403).json({ success: false, error: 'You cannot update this order.' });
  }

  if (order.status === 'cancelled' && status !== 'cancelled') {
    return res.status(409).json({ success: false, error: 'Cancelled orders cannot be reopened.' });
  }

  db.transaction(() => {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
    if (status === 'cancelled' && order.status !== 'cancelled') {
      const items = db.prepare(
        'SELECT product_id, quantity FROM order_items WHERE order_id = ?'
      ).all(order.id);
      const restoreStock = db.prepare(
        'UPDATE products SET stock = stock + ? WHERE id = ? AND shop_id = ?'
      );
      for (const item of items) {
        restoreStock.run(item.quantity, item.product_id, order.shop_id);
      }
    }
  })();

  const customer = db.prepare('SELECT * FROM users WHERE id = ?').get(order.customer_user_id);
  createNotification({
    shopId: order.shop_id,
    userId: customer?.id || null,
    type: 'order_status_updated',
    message: `Your order #${order.id} status has changed to ${status}.`,
  });

  return res.json({ success: true, message: 'Order status updated.' });
});

app.get('/api/shops/:id', authUser, requireRoles('super_admin', 'shop_owner'), (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(Number(req.params.id));
  if (!shop) {
    return res.status(404).json({ success: false, error: 'Shop not found.' });
  }

  if (req.user.role !== 'super_admin' && req.user.shopId !== shop.id) {
    return res.status(403).json({ success: false, error: 'Unauthorized shop access.' });
  }

  return res.json({ success: true, shop });
});

app.get('/api/admin/subscriptions', authUser, requireRoles('super_admin'), (req, res) => {
  const subscriptions = db.prepare('SELECT s.*, sh.name AS shop_name FROM subscriptions s LEFT JOIN shops sh ON sh.id = s.shop_id ORDER BY s.created_at DESC').all();
  return res.json({ success: true, subscriptions });
});

app.post('/api/admin/subscriptions', authUser, requireRoles('super_admin'), (req, res) => {
  const { shopId, plan, status, amount, endDate } = req.body || {};
  const row = db.prepare(
    `INSERT INTO subscriptions (shop_id, plan, status, amount, end_date)
     VALUES (?, ?, ?, ?, ?)`
  ).run(Number(shopId), String(plan || 'Starter'), String(status || 'active'), Number(amount || 0), endDate || null);

  return res.status(201).json({ success: true, subscriptionId: row.lastInsertRowid });
});

app.use((error, req, res, next) => {
  console.error('[Unhandled error]', error);
  if (res.headersSent) return next(error);
  return res.status(500).json({ success: false, error: 'Something went wrong on the server.' });
});

createTables();
bootstrapSuperAdmin();

const distPath = path.join(__dirname, 'dist');
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { fallthrough: false, index: false }));
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { index: false }));
  app.get(/^(?!\/api).*/, (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    fs.readFile(path.join(distPath, 'index.html'), 'utf8', (error, html) => {
      if (error) return next(error);
      return res.type('html').send(renderSeoHtml(html, getSeoMetadata(req)));
    });
  });
}

io.on('connection', (socket) => {
  socket.emit('welcome', { message: 'Connected to FreshCart notifications.' });
  socket.on('join-shop', (shopId) => {
    if (shopId) socket.join(`shop-${shopId}`);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`FreshCart server listening on http://localhost:${PORT} (bound to ${HOST})`);
});

export { app, db, io };
