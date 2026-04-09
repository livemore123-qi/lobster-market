import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '..', 'lobster-market.db')

export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Schema
db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY,
  agent_name      TEXT NOT NULL,
  owner_name      TEXT NOT NULL,
  meta            TEXT DEFAULT '',
  public_key      TEXT NOT NULL,
  status          TEXT DEFAULT 'offline',
  rating_sum      INTEGER DEFAULT 0,
  rating_cnt      INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES categories(id),
  sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listings (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agents(id),
  type            TEXT NOT NULL CHECK(type IN ('physical','skill','hybrid')),
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  images          TEXT DEFAULT '[]',
  category_id     TEXT,
  condition       TEXT,
  price           INTEGER NOT NULL,
  price_unit      TEXT DEFAULT 'CNY',
  reserved_price  INTEGER,
  status          TEXT DEFAULT 'online' CHECK(status IN ('online','negotiating','sold','offshelf')),
  accepted_methods TEXT DEFAULT '[]',
  location        TEXT DEFAULT '',
  tags            TEXT DEFAULT '[]',
  view_count      INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS negotiations (
  id              TEXT PRIMARY KEY,
  listing_id      TEXT NOT NULL REFERENCES listings(id),
  buyer_agent_id  TEXT NOT NULL REFERENCES agents(id),
  seller_agent_id TEXT NOT NULL REFERENCES agents(id),
  current_price   INTEGER NOT NULL,
  status          TEXT DEFAULT 'active' CHECK(status IN ('active','accepted','rejected','cancelled')),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(listing_id, buyer_agent_id)
);

CREATE TABLE IF NOT EXISTS negotiation_messages (
  id              TEXT PRIMARY KEY,
  negotiation_id  TEXT NOT NULL REFERENCES negotiations(id),
  from_agent_id   TEXT NOT NULL REFERENCES agents(id),
  action          TEXT NOT NULL CHECK(action IN ('offer','counter','accept','reject','bargain')),
  price           INTEGER,
  message         TEXT DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id              TEXT PRIMARY KEY,
  listing_id      TEXT REFERENCES listings(id),
  initiator_id    TEXT NOT NULL REFERENCES agents(id),
  receiver_id    TEXT NOT NULL REFERENCES agents(id),
  status          TEXT DEFAULT 'active',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES agent_conversations(id),
  from_agent_id   TEXT NOT NULL REFERENCES agents(id),
  content_encrypted TEXT NOT NULL,
  content_nonce    TEXT NOT NULL,
  content_tag      TEXT NOT NULL DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  negotiation_id  TEXT REFERENCES negotiations(id),
  listing_id      TEXT NOT NULL REFERENCES listings(id),
  buyer_agent_id  TEXT NOT NULL REFERENCES agents(id),
  seller_agent_id TEXT NOT NULL REFERENCES agents(id),
  final_price     INTEGER NOT NULL,
  status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed','shipped','received','completed','cancelled')),
  transaction_method TEXT,
  shipping_address TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id),
  from_agent_id   TEXT NOT NULL REFERENCES agents(id),
  to_agent_id     TEXT NOT NULL REFERENCES agents(id),
  rating          INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment         TEXT DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  to_agent_id     TEXT NOT NULL REFERENCES agents(id),
  type            TEXT NOT NULL,
  payload         TEXT NOT NULL,
  read            INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agents(id),
  filters         TEXT NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_agent ON listings(agent_id);
CREATE INDEX IF NOT EXISTS idx_negotiations_listing ON negotiations(listing_id);
CREATE INDEX IF NOT EXISTS idx_negotiations_buyer ON negotiations(buyer_agent_id);
CREATE INDEX IF NOT EXISTS idx_conv_receiver ON agent_conversations(receiver_id);
CREATE INDEX IF NOT EXISTS idx_notifications_agent ON notifications(to_agent_id, read);
`)

// Seed categories
const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (id, name, parent_id) VALUES (?, ?, ?)')
const categories = [
  ['数码', '数码', null],
  ['电脑', '电脑', '数码'],
  ['手机', '手机', '数码'],
  ['相机', '相机', '数码'],
  ['服装', '服装', null],
  ['图书', '图书', null],
  ['技能服务', '技能服务', null],
  ['设计', '设计', '技能服务'],
  ['编程', '编程', '技能服务'],
  ['写作', '写作', '技能服务'],
  ['其他', '其他', null],
]
categories.forEach(([id, name, parent]) => insertCategory.run(id, name, parent))

// Migration: add content_tag column if missing
try {
  db.exec("ALTER TABLE conversation_messages ADD COLUMN content_tag TEXT NOT NULL DEFAULT ''")
} catch (e) {
  // Column may already exist
}

export default db
