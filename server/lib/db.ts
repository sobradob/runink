import postgres from 'postgres';
import crypto from 'crypto';

const sql = postgres(process.env.DATABASE_URL || 'postgres://localhost:5432/runink');

// Create tables on startup
export async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS gift_codes (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      tier TEXT NOT NULL,
      purchaser_email TEXT,
      recipient_name TEXT,
      recipient_email TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      stripe_session_id TEXT,
      stripe_payment_intent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      redeemed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      gift_code TEXT REFERENCES gift_codes(code),
      type TEXT NOT NULL DEFAULT 'direct',
      tier TEXT NOT NULL,
      poster_config TEXT,
      png_url TEXT,
      gelato_order_id TEXT,
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_gift_codes_code ON gift_codes(code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_gift_codes_status ON gift_codes(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_gift_code ON orders(gift_code)`;

  await sql`
    CREATE TABLE IF NOT EXISTS exports (
      id SERIAL PRIMARY KEY,
      export_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      poster_config TEXT,
      png_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      verify_token TEXT,
      marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      rendered_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_exports_export_id ON exports(export_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_exports_verify_token ON exports(verify_token) WHERE verify_token IS NOT NULL`;

  // Backfill columns for existing tables
  await sql`ALTER TABLE exports ADD COLUMN IF NOT EXISTS verify_token TEXT`.catch(() => {});
  await sql`ALTER TABLE exports ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE`.catch(() => {});

  console.log('[db] Tables initialized');
}

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

export async function createGiftCode(params: {
  tier: string;
  purchaserEmail?: string;
  recipientName?: string;
  recipientEmail?: string;
  stripeSessionId?: string;
  stripePaymentIntent?: string;
}): Promise<GiftCode> {
  const code = generateGiftCode();

  await sql`
    INSERT INTO gift_codes (code, tier, purchaser_email, recipient_name, recipient_email, stripe_session_id, stripe_payment_intent, expires_at)
    VALUES (${code}, ${params.tier}, ${params.purchaserEmail || null}, ${params.recipientName || null}, ${params.recipientEmail || null}, ${params.stripeSessionId || null}, ${params.stripePaymentIntent || null}, NOW() + INTERVAL '1 year')
  `;

  return (await getGiftCode(code))!;
}

export async function createGiftCodeWithCode(params: {
  code: string;
  tier: string;
  purchaserEmail?: string;
  recipientName?: string;
}): Promise<GiftCode> {
  await sql`
    INSERT INTO gift_codes (code, tier, purchaser_email, recipient_name, status, expires_at)
    VALUES (${params.code}, ${params.tier}, ${params.purchaserEmail || null}, ${params.recipientName || null}, 'active', NOW() + INTERVAL '1 year')
  `;
  return (await getGiftCode(params.code))!;
}

export async function getGiftCode(code: string): Promise<GiftCode | null> {
  const rows = await sql<GiftCode[]>`SELECT * FROM gift_codes WHERE code = ${code}`;
  return rows[0] || null;
}

export async function redeemGiftCode(code: string): Promise<boolean> {
  const result = await sql`
    UPDATE gift_codes SET status = 'redeemed', redeemed_at = NOW()
    WHERE code = ${code} AND status = 'active'
  `;
  return result.count > 0;
}

// === Orders ===

export interface Order {
  order_id: string;
  gift_code: string | null;
  type: 'direct' | 'gift';
  tier: string;
  poster_config: string | null;
  png_url: string | null;
  gelato_order_id: string | null;
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

export async function createOrder(params: {
  giftCode?: string;
  type: 'direct' | 'gift';
  tier: string;
  posterConfig?: string;
  stripeSessionId?: string;
}): Promise<Order> {
  const orderId = generateOrderId();

  await sql`
    INSERT INTO orders (order_id, gift_code, type, tier, poster_config, stripe_session_id)
    VALUES (${orderId}, ${params.giftCode || null}, ${params.type}, ${params.tier}, ${params.posterConfig || null}, ${params.stripeSessionId || null})
  `;

  return (await getOrder(orderId))!;
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const rows = await sql<Order[]>`SELECT * FROM orders WHERE order_id = ${orderId}`;
  return rows[0] || null;
}

export async function updateOrder(orderId: string, updates: Partial<{
  png_url: string;
  gelato_order_id: string;
  shipping_name: string;
  shipping_address_1: string;
  shipping_address_2: string;
  shipping_city: string;
  shipping_state: string;
  shipping_country: string;
  shipping_zip: string;
  status: string;
  stripe_payment_intent: string;
}>): Promise<boolean> {
  const fields = Object.entries(updates).filter(([_, v]) => v !== undefined);
  if (fields.length === 0) return false;

  // Build dynamic update using postgres.js helpers
  const setObj: Record<string, string | null> = {};
  for (const [k, v] of fields) {
    setObj[k] = v as string;
  }
  setObj.updated_at = new Date().toISOString();

  const result = await sql`
    UPDATE orders SET ${sql(setObj, ...Object.keys(setObj))}
    WHERE order_id = ${orderId}
  `;

  return result.count > 0;
}

// === Exports (HD email delivery) ===

export interface Export {
  export_id: string;
  email: string;
  poster_config: string | null;
  png_url: string | null;
  status: string;
  verify_token: string | null;
  marketing_opt_in: boolean;
  created_at: string;
  rendered_at: string | null;
  expires_at: string;
}

function generateExportId(): string {
  return 'EXP-' + crypto.randomUUID().slice(0, 8).toUpperCase();
}

export async function createExport(params: {
  email: string;
  posterConfig: string;
  verifyToken: string;
  marketingOptIn?: boolean;
}): Promise<Export> {
  const exportId = generateExportId();
  await sql`
    INSERT INTO exports (export_id, email, poster_config, verify_token, marketing_opt_in)
    VALUES (${exportId}, ${params.email}, ${params.posterConfig}, ${params.verifyToken}, ${params.marketingOptIn ?? false})
  `;
  return (await getExport(exportId))!;
}

export async function getExportByToken(token: string): Promise<Export | null> {
  const rows = await sql<Export[]>`SELECT * FROM exports WHERE verify_token = ${token}`;
  return rows[0] || null;
}

export async function getExport(exportId: string): Promise<Export | null> {
  const rows = await sql<Export[]>`SELECT * FROM exports WHERE export_id = ${exportId}`;
  return rows[0] || null;
}

export async function updateExport(exportId: string, updates: Partial<{
  png_url: string;
  status: string;
  rendered_at: string;
}>): Promise<boolean> {
  const fields = Object.entries(updates).filter(([_, v]) => v !== undefined);
  if (fields.length === 0) return false;
  const setObj: Record<string, string | null> = {};
  for (const [k, v] of fields) {
    setObj[k] = v as string;
  }
  const result = await sql`
    UPDATE exports SET ${sql(setObj, ...Object.keys(setObj))}
    WHERE export_id = ${exportId}
  `;
  return result.count > 0;
}

/** Raw SQL access for admin queries */
export { sql };

export default sql;
