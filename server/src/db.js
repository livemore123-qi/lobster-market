import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '..', 'lobster-market.db')

export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')

// ===== MIGRATIONS =====
const _migrations = [
  `ALTER TABLE agents ADD COLUMN role TEXT DEFAULT 'agent' CHECK(role IN ('agent','merchant'))`,
  `ALTER TABLE dataspaces ADD COLUMN owner_role TEXT DEFAULT 'merchant' CHECK(owner_role IN ('agent','merchant'))`,
  `CREATE TABLE IF NOT EXISTS consumers (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, phone TEXT DEFAULT '', nickname TEXT DEFAULT '', role TEXT DEFAULT 'consumer' CHECK(role IN ('consumer')), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
  `ALTER TABLE registration_requests ADD COLUMN role TEXT DEFAULT 'manual' CHECK(role IN ('agent','merchant','manual','consumer'))`,
]
for (const m of _migrations) {
  try { db.exec(m) } catch(e) { /* column/table may already exist */ }
}
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY,
  agent_name      TEXT NOT NULL,
  owner_name      TEXT NOT NULL,
  role            TEXT DEFAULT 'agent' CHECK(role IN ('agent','merchant')),
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
  parent_id   TEXT,
  sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listings (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  images          TEXT DEFAULT '[]',
  category_id     TEXT,
  condition       TEXT,
  price           INTEGER NOT NULL,
  price_unit      TEXT DEFAULT 'CNY',
  reserved_price  INTEGER,
  status          TEXT DEFAULT 'online',
  accepted_methods TEXT DEFAULT '[]',
  location        TEXT DEFAULT '',
  tags            TEXT DEFAULT '[]',
  view_count      INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS negotiations (
  id              TEXT PRIMARY KEY,
  listing_id      TEXT NOT NULL,
  buyer_agent_id  TEXT NOT NULL,
  seller_agent_id TEXT NOT NULL,
  current_price   INTEGER NOT NULL,
  status          TEXT DEFAULT 'active',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(listing_id, buyer_agent_id)
);

CREATE TABLE IF NOT EXISTS negotiation_messages (
  id              TEXT PRIMARY KEY,
  negotiation_id  TEXT NOT NULL,
  from_agent_id   TEXT NOT NULL,
  action          TEXT NOT NULL,
  price           INTEGER,
  message         TEXT DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id              TEXT PRIMARY KEY,
  listing_id      TEXT,
  initiator_id    TEXT NOT NULL,
  receiver_id     TEXT NOT NULL,
  status          TEXT DEFAULT 'active',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  from_agent_id   TEXT NOT NULL,
  content_encrypted TEXT NOT NULL,
  content_nonce    TEXT NOT NULL,
  content_tag      TEXT NOT NULL DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  negotiation_id  TEXT,
  listing_id      TEXT NOT NULL,
  buyer_agent_id  TEXT NOT NULL,
  seller_agent_id TEXT NOT NULL,
  final_price     INTEGER NOT NULL,
  status          TEXT DEFAULT 'pending',
  transaction_method TEXT,
  shipping_address TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL,
  from_agent_id   TEXT NOT NULL,
  to_agent_id     TEXT NOT NULL,
  rating          INTEGER NOT NULL,
  comment         TEXT DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  to_agent_id     TEXT NOT NULL,
  type            TEXT NOT NULL,
  payload         TEXT NOT NULL,
  read            INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  filters         TEXT NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dataspaces (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  owner_name      TEXT NOT NULL,
  contact_info    TEXT DEFAULT '',
  avatar          TEXT DEFAULT '',
  access_policy   TEXT DEFAULT 'public',
  tags            TEXT DEFAULT '[]',
  agent_id        TEXT,
  owner_role      TEXT DEFAULT 'merchant',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_entries (
  id              TEXT PRIMARY KEY,
  dataspace_id    TEXT NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT DEFAULT '',
  content_md      TEXT NOT NULL,
  category        TEXT DEFAULT '',
  tags            TEXT DEFAULT '[]',
  access_policy   TEXT DEFAULT 'public',
  access_token    TEXT DEFAULT '',
  api_endpoint    TEXT DEFAULT '',
  price           INTEGER DEFAULT 0,
  view_count      INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'online',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_agent ON listings(agent_id);
CREATE INDEX IF NOT EXISTS idx_negotiations_listing ON negotiations(listing_id);
CREATE INDEX IF NOT EXISTS idx_negotiations_buyer ON negotiations(buyer_agent_id);
CREATE INDEX IF NOT EXISTS idx_conv_receiver ON agent_conversations(receiver_id);
CREATE INDEX IF NOT EXISTS idx_notifications_agent ON notifications(to_agent_id, read);
CREATE INDEX IF NOT EXISTS idx_catalog_dataspace ON catalog_entries(dataspace_id);
CREATE INDEX IF NOT EXISTS idx_catalog_status ON catalog_entries(status);
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

export default db