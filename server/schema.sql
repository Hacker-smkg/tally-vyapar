-- Vastra Books database. Money is whole paise. Stock on hand = SUM(stock_moves.qty).
-- Columns added after the first release are applied by migrate() in db.ts.

CREATE TABLE IF NOT EXISTS locations(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL CHECK(kind IN ('godown','store','factory')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','staff')),
  location_id INTEGER REFERENCES locations(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  parent_id INTEGER REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS parties(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('customer','supplier','jobworker')),
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  opening_balance INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('finished','raw')),
  category_id INTEGER REFERENCES categories(id),
  unit TEXT NOT NULL DEFAULT 'pcs',
  hsn TEXT NOT NULL DEFAULT '',
  gst_mode TEXT NOT NULL DEFAULT 'apparel' CHECK(gst_mode IN ('none','fixed','apparel')),
  gst_rate REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS variants(
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  sku TEXT UNIQUE COLLATE NOCASE,
  size TEXT NOT NULL DEFAULT '',
  colour TEXT NOT NULL DEFAULT '',
  retail_price INTEGER NOT NULL DEFAULT 0,
  wholesale_price INTEGER NOT NULL DEFAULT 0,
  avg_cost REAL NOT NULL DEFAULT 0,
  low_stock REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vouchers(
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('sale','purchase','sale_return','purchase_return')),
  number TEXT NOT NULL,
  date TEXT NOT NULL,
  party_id INTEGER REFERENCES parties(id),
  party_name TEXT NOT NULL DEFAULT '',
  location_id INTEGER NOT NULL REFERENCES locations(id),
  channel TEXT NOT NULL DEFAULT 'retail' CHECK(channel IN ('retail','wholesale','marketplace','online')),
  prices_include_tax INTEGER NOT NULL DEFAULT 1,
  inter_state INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL, discount INTEGER NOT NULL, taxable INTEGER NOT NULL,
  cgst INTEGER NOT NULL DEFAULT 0, sgst INTEGER NOT NULL DEFAULT 0, igst INTEGER NOT NULL DEFAULT 0,
  extra_charge INTEGER NOT NULL DEFAULT 0, round_off INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
  channel_fee INTEGER NOT NULL DEFAULT 0, shipping_cost INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'final' CHECK(status IN ('final','cancelled')),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ref_voucher_id INTEGER REFERENCES vouchers(id), -- the bill a return is made against
  UNIQUE(type, number)
);

CREATE TABLE IF NOT EXISTS voucher_lines(
  id INTEGER PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id),
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  qty REAL NOT NULL, rate INTEGER NOT NULL, disc_pct REAL NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL, taxable INTEGER NOT NULL,
  gst_rate REAL NOT NULL DEFAULT 0, tax INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  party_id INTEGER REFERENCES parties(id),
  direction TEXT NOT NULL CHECK(direction IN ('in','out')),
  amount INTEGER NOT NULL CHECK(amount > 0),
  mode TEXT NOT NULL DEFAULT 'cash',
  voucher_id INTEGER REFERENCES vouchers(id),
  location_id INTEGER REFERENCES locations(id),
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS expenses(
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  mode TEXT NOT NULL DEFAULT 'cash',
  location_id INTEGER REFERENCES locations(id),
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS productions(
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  from_location_id INTEGER NOT NULL REFERENCES locations(id),
  to_location_id INTEGER NOT NULL REFERENCES locations(id),
  party_id INTEGER REFERENCES parties(id),
  material_cost INTEGER NOT NULL DEFAULT 0,
  labour_cost INTEGER NOT NULL DEFAULT 0,
  other_cost INTEGER NOT NULL DEFAULT 0,
  total_cost INTEGER NOT NULL DEFAULT 0,
  pay_mode TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','cancelled')),
  done_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS production_inputs(
  id INTEGER PRIMARY KEY,
  production_id INTEGER NOT NULL REFERENCES productions(id),
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  qty REAL NOT NULL, unit_cost REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS production_outputs(
  id INTEGER PRIMARY KEY,
  production_id INTEGER NOT NULL REFERENCES productions(id),
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  qty REAL NOT NULL, unit_cost REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_moves(
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS ix_moves_variant ON stock_moves(variant_id, location_id);
CREATE INDEX IF NOT EXISTS ix_moves_ref ON stock_moves(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS ix_vouchers_date ON vouchers(type, date);
CREATE INDEX IF NOT EXISTS ix_vouchers_party ON vouchers(party_id);
CREATE INDEX IF NOT EXISTS ix_lines_voucher ON voucher_lines(voucher_id);
CREATE INDEX IF NOT EXISTS ix_lines_variant ON voucher_lines(variant_id);
CREATE INDEX IF NOT EXISTS ix_pay_party ON payments(party_id);
CREATE INDEX IF NOT EXISTS ix_pay_voucher ON payments(voucher_id);
CREATE INDEX IF NOT EXISTS ix_variants_item ON variants(item_id);

-- Views are rebuilt on every start so a code update can change them safely.
DROP VIEW IF EXISTS v_variant;
CREATE VIEW v_variant AS
SELECT va.id AS variant_id, va.sku, va.size, va.colour, va.retail_price, va.wholesale_price,
       va.avg_cost, va.low_stock, va.active AS v_active,
       i.id AS item_id, i.name AS item, i.kind, i.unit, i.hsn, i.gst_mode, i.gst_rate, i.active AS i_active,
       COALESCE(pc.name, c.name, 'Uncategorised') AS cat,
       CASE WHEN pc.id IS NULL THEN '' ELSE c.name END AS subcat
FROM variants va
JOIN items i ON i.id = va.item_id
LEFT JOIN categories c ON c.id = i.category_id
LEFT JOIN categories pc ON pc.id = c.parent_id;

DROP VIEW IF EXISTS v_stock;
CREATE VIEW v_stock AS
SELECT variant_id, location_id, SUM(qty) AS qty FROM stock_moves GROUP BY variant_id, location_id;

-- One row per sold line; sgn = +1 sale, -1 sale return. sell_cost = this line's share of
-- marketplace fee + courier cost paid by the business.
DROP VIEW IF EXISTS v_sale_lines;
CREATE VIEW v_sale_lines AS
SELECT v.id AS voucher_id, v.date, v.location_id, v.channel, v.user_id, v.party_id,
       CASE v.type WHEN 'sale' THEN 1 ELSE -1 END AS sgn,
       l.variant_id, l.qty, l.taxable, l.tax, l.total, l.unit_cost,
       CASE WHEN v.taxable > 0 THEN (v.channel_fee + v.shipping_cost) * 1.0 * l.taxable / v.taxable ELSE 0 END AS sell_cost
FROM voucher_lines l
JOIN vouchers v ON v.id = l.voucher_id
WHERE v.status = 'final' AND v.type IN ('sale','sale_return');

-- Positive = the party owes the business ("you'll get"); negative = the business owes them.
DROP VIEW IF EXISTS v_party_balance;
CREATE VIEW v_party_balance AS
SELECT p.id AS party_id,
  p.opening_balance
  + COALESCE((SELECT SUM(CASE WHEN type IN ('sale','purchase_return') THEN total ELSE -total END)
              FROM vouchers WHERE party_id = p.id AND status = 'final'), 0)
  - COALESCE((SELECT SUM(CASE direction WHEN 'in' THEN amount ELSE -amount END)
              FROM payments WHERE party_id = p.id), 0)
  - COALESCE((SELECT SUM(labour_cost) FROM productions WHERE party_id = p.id AND status = 'done'), 0) AS balance
FROM parties p;
