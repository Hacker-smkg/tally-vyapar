import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { today } from '../shared/calc.ts';
import { SCHEMA } from './schema.ts';

/** `--name=value` from the command line (works the same on Windows, macOS and Linux). */
export const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
/** Demo copy: its own data folder with sample data, so nobody practises on the real books. */
export const DEMO = process.argv.includes('--demo') || process.env.DEMO === 'true' || !!process.env.VERCEL;
export const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : (arg('data') || join(import.meta.dirname, '..', DEMO ? 'data-demo' : 'data')));
const file = process.env.DB_PATH || join(DATA_DIR, 'app.db');
const onDisk = file !== ':memory:';
if (onDisk) mkdirSync(join(DATA_DIR, 'backups'), { recursive: true });

export const db = new DatabaseSync(file);
db.exec(`${process.env.VERCEL ? 'PRAGMA journal_mode = MEMORY;' : 'PRAGMA journal_mode = WAL;'} PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`);
db.exec(SCHEMA);

type Row = Record<string, any>;
export const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
export const get = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
export const run = (sql: string, ...p: any[]) => {
  const r = db.prepare(sql).run(...p);
  return { id: Number(r.lastInsertRowid), changes: Number(r.changes) };
};

/** The row with this id, or a clean "not found" (404) for the caller. */
export function must(table: 'users' | 'parties' | 'locations' | 'categories' | 'items' | 'expenses' | 'payments', rowId: number, label: string): Row {
  const r = get(`SELECT * FROM ${table} WHERE id = ?`, rowId);
  if (!r) throw Object.assign(new Error(`${label} not found`), { status: 404 });
  return r;
}

// Columns added after the first release. Each step runs once; PRAGMA user_version remembers how far a database is.
if (Number(get('PRAGMA user_version')!.user_version) < 1) {
  if (!all('PRAGMA table_info(vouchers)').some((c) => c.name === 'ref_voucher_id')) db.exec('ALTER TABLE vouchers ADD COLUMN ref_voucher_id INTEGER REFERENCES vouchers(id)');
  db.exec('PRAGMA user_version = 1');
}

/** Everything inside fn is saved together or not at all. A tx() inside another joins the outer one. */
let inTx = false;
export function tx<T>(fn: () => T): T {
  if (inTx) return fn();
  inTx = true;
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    inTx = false;
  }
}

// ---------- settings (key → JSON) ----------
export function getSetting<T>(key: string, fallback: T): T {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  if (!r) return fallback;
  const v = JSON.parse(r.value);
  return v && typeof v === 'object' && !Array.isArray(v) && fallback && typeof fallback === 'object' ? { ...fallback, ...v } : v;
}
export const setSetting = (key: string, value: unknown) =>
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));

export const DEFAULT_BUSINESS = { name: 'My Clothing Store', tagline: '', address: '', phone: '', email: '', state: '', gstin: '', logo: '', brandColor: '#4f46e5' };
export const DEFAULT_BILLING = {
  gstEnabled: false,
  pricesIncludeTax: true,
  allowNegativeStock: false,
  prefixes: { sale: 'INV-', purchase: 'PUR-', sale_return: 'SR-', purchase_return: 'PR-', production: 'PRD-' } as Record<string, string>,
  terms: 'Goods once sold can be exchanged within 7 days with the bill.',
  footer: 'Thank you! Visit again.',
  upiId: '',
  bankDetails: '',
  expenseCategories: ['Rent', 'Salary', 'Electricity', 'Packing', 'Transport', 'Advertising', 'Repairs', 'Tea & Misc'],
};
export const DEFAULT_AI = { provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: '', apiKey: '' };
export const business = () => getSetting('business', DEFAULT_BUSINESS);
export const billing = () => getSetting('billing', DEFAULT_BILLING);

/** Next running number for a document type. Call inside tx(). */
export function nextNumber(kind: string): string {
  const n = getSetting(`seq_${kind}`, 0) + 1;
  setSetting(`seq_${kind}`, n);
  return `${billing().prefixes[kind] ?? ''}${String(n).padStart(4, '0')}`;
}

/** First-run basics: two locations and the owner's own category list. Call inside tx(). */
export function seedBasics() {
  setSetting('billing', DEFAULT_BILLING);
  run(`INSERT INTO locations(name, kind) VALUES('Main Godown', 'godown'), ('Store 1', 'store')`);
  const tree: Record<string, string[]> = {
    Shirt: ['Premium', 'Offer (Normal)', 'Jeans Shirt'],
    Pant: ['Formal', 'Cotton', 'Track', 'Jeans'],
    Hoodie: [], Blazer: [], Shoes: [],
    'Raw Material': ['Fabric', 'Trims & Packing'],
  };
  for (const [name, subs] of Object.entries(tree)) {
    const parent = run('INSERT INTO categories(name) VALUES(?)', name).id;
    for (const s of subs) run('INSERT INTO categories(name, parent_id) VALUES(?, ?)', s, parent);
  }
}

// ---------- backup ----------
/** Writes a consistent copy of the whole database to a file and returns its path. */
export function backupTo(path: string): string {
  if (existsSync(path)) unlinkSync(path);
  db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
  return path;
}
export function dailyBackup() {
  if (!onDisk) return;
  const dir = join(DATA_DIR, 'backups');
  const f = join(dir, `app-${today()}.db`);
  try {
    if (!existsSync(f)) backupTo(f);
    const old = readdirSync(dir).filter((n) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort().slice(0, -14);
    for (const n of old) unlinkSync(join(dir, n));
  } catch (e) {
    console.error('Backup failed:', e);
  }
}
