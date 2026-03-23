import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/runink.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS gift_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    tier TEXT NOT NULL,
    purchaser_email TEXT,
    recipient_name TEXT,
    recipient_email TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    redeemed_at TEXT,
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT UNIQUE NOT NULL,
    gift_code TEXT REFERENCES gift_codes(code),
    type TEXT NOT NULL DEFAULT 'direct',
    tier TEXT NOT NULL,
    poster_config TEXT,
    png_url TEXT,
    printful_order_id TEXT,
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    shipping_name TEXT,
    shipping_address_1 TEXT,
    shipping_address_2 TEXT,
    shipping_city TEXT,
    shipping_state TEXT,
    shipping_country TEXT,
    shipping_zip TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_gift_codes_code ON gift_codes(code);
  CREATE INDEX IF NOT EXISTS idx_gift_codes_status ON gift_codes(status);
  CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
  CREATE INDEX IF NOT EXISTS idx_orders_gift_code ON orders(gift_code);
`);

// === Gift Codes ===

function generateGiftCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
  let code = 'RUNINK-';
  for (let i = 0; i < 6; i++) {
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}

export interface GiftCode {
  code: string;
  tier: string;
  purchaser_email: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  status: 'active' | 'redeemed' | 'expired';
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  created_at: string;
  redeemed_at: string | null;
}

export function createGiftCode(params: {
  tier: string;
  purchaserEmail?: string;
  recipientName?: string;
  recipientEmail?: string;
  stripeSessionId?: string;
  stripePaymentIntent?: string;
}): GiftCode {
  const code = generateGiftCode();

  db.prepare(`
    INSERT INTO gift_codes (code, tier, purchaser_email, recipient_name, recipient_email, stripe_session_id, stripe_payment_intent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+1 year'))
  `).run(
    code,
    params.tier,
    params.purchaserEmail || null,
    params.recipientName || null,
    params.recipientEmail || null,
    params.stripeSessionId || null,
    params.stripePaymentIntent || null,
  );

  return getGiftCode(code)!;
}

export function getGiftCode(code: string): GiftCode | null {
  return db.prepare('SELECT * FROM gift_codes WHERE code = ?').get(code) as GiftCode | null;
}

export function redeemGiftCode(code: string): boolean {
  const result = db.prepare(`
    UPDATE gift_codes SET status = 'redeemed', redeemed_at = datetime('now')
    WHERE code = ? AND status = 'active'
  `).run(code);
  return result.changes > 0;
}

// === Orders ===

export interface Order {
  order_id: string;
  gift_code: string | null;
  type: 'direct' | 'gift';
  tier: string;
  poster_config: string | null;
  png_url: string | null;
  printful_order_id: string | null;
  stripe_session_id: string | null;
  shipping_name: string | null;
  shipping_city: string | null;
  shipping_country: string | null;
  status: string;
  created_at: string;
}

function generateOrderId(): string {
  return 'ORD-' + crypto.randomUUID().slice(0, 8).toUpperCase();
}

export function createOrder(params: {
  giftCode?: string;
  type: 'direct' | 'gift';
  tier: string;
  posterConfig?: string;
  stripeSessionId?: string;
}): Order {
  const orderId = generateOrderId();

  db.prepare(`
    INSERT INTO orders (order_id, gift_code, type, tier, poster_config, stripe_session_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    orderId,
    params.giftCode || null,
    params.type,
    params.tier,
    params.posterConfig || null,
    params.stripeSessionId || null,
  );

  return getOrder(orderId)!;
}

export function getOrder(orderId: string): Order | null {
  return db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId) as Order | null;
}

export function updateOrder(orderId: string, updates: Partial<{
  png_url: string;
  printful_order_id: string;
  shipping_name: string;
  shipping_address_1: string;
  shipping_address_2: string;
  shipping_city: string;
  shipping_state: string;
  shipping_country: string;
  shipping_zip: string;
  status: string;
  stripe_payment_intent: string;
}>): boolean {
  const fields = Object.entries(updates).filter(([_, v]) => v !== undefined);
  if (fields.length === 0) return false;

  const setClause = fields.map(([k]) => `${k} = ?`).join(', ');
  const values = fields.map(([_, v]) => v);

  const result = db.prepare(`
    UPDATE orders SET ${setClause}, updated_at = datetime('now')
    WHERE order_id = ?
  `).run(...values, orderId);

  return result.changes > 0;
}

export default db;
