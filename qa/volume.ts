// Volume check: one year of trading (20,000 bills by default) in a throwaway copy, then every
// screen's data call and every report is timed over HTTP.   npm run qa:volume [bills]
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BILLS = Number(process.argv[2]) || 20000;
const dir = mkdtempSync(join(tmpdir(), 'vastra-vol-'));
process.env.DATA_DIR = dir;
const { run, get, tx, seedBasics, db } = await import('../server/db.ts');
const { hashPassword } = await import('../server/auth.ts');
const { saveItem, saveParty, addExpense } = await import('../server/masters.ts');
const { createVoucher, addPayment } = await import('../server/vouchers.ts');
const { addDays, today } = await import('../shared/calc.ts');

const R = (r: number) => Math.round(r * 100);
const D = today();
const pw = `Vol-${randomBytes(9).toString('hex')}`;
let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

const t0 = performance.now();
tx(() => {
  seedBasics();
  run(`INSERT INTO locations(name, kind) VALUES('Store 2', 'store'), ('Store 3', 'store')`);
  run('INSERT INTO users(name, username, pass_hash, role) VALUES(?,?,?,?)', 'Owner', 'vol_owner', hashPassword(pw), 'owner');
});
const user = { id: 1, name: 'Owner', username: 'vol_owner', role: 'owner' as const, location_id: null };
const stores = [2, 3, 4], godown = 1;
const buyers = Array.from({ length: 40 }, (_, i) => saveParty({ name: `Buyer ${i + 1}`, kind: 'customer', phone: `90000${String(i).padStart(5, '0')}` }));
const variants: { id: number; price: number; loc: number }[] = [];
tx(() => {
  for (let i = 0; i < 60; i++) {
    const price = 300 + (i % 12) * 150;
    for (const loc of [godown, ...stores]) {
      const id = saveItem({ name: `Style ${i + 1}${loc === godown ? '' : ` (S${loc})`}`, kind: 'finished', variants: ['S', 'M', 'L', 'XL'].map((size) => ({ size, colour: 'Blue', retail_price: R(price), wholesale_price: R(price * 0.7), low_stock: 5, opening_qty: 100000, opening_cost: R(price * 0.45), opening_location: loc })) }, user);
      for (const v of db.prepare('SELECT id FROM variants WHERE item_id = ?').all(id) as any[]) variants.push({ id: v.id, price: R(price), loc });
    }
  }
});
const byLoc = new Map<number, typeof variants>();
for (const v of variants) byLoc.set(v.loc, [...(byLoc.get(v.loc) ?? []), v]);
tx(() => {
  for (let i = 0; i < BILLS; i++) {
    const date = addDays(D, -Math.floor((i / BILLS) * 365));
    const kind = rnd();
    const loc = kind < 0.8 ? pick(stores) : godown;
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(byLoc.get(loc)!)).filter((v, j, a) => a.findIndex((x) => x.id === v.id) === j).map((v) => ({ variant_id: v.id, qty: 1 + Math.floor(rnd() * 2), rate: v.price }));
    const total = lines.reduce((s, l) => s + l.qty * l.rate, 0);
    if (kind < 0.8) createVoucher({ type: 'sale', date, location_id: loc, channel: 'retail', lines, paid: total, pay_mode: pick(['cash', 'upi', 'upi', 'card']) }, user);
    else if (kind < 0.9) createVoucher({ type: 'sale', date, location_id: loc, channel: 'wholesale', party_id: pick(buyers), lines, paid: Math.round(total / 2 / 100) * 100, pay_mode: 'bank' }, user);
    else createVoucher({ type: 'sale', date, location_id: loc, channel: pick(['marketplace', 'online']), lines, paid: total, pay_mode: 'upi', channel_fee: Math.round(total * 0.15), shipping_cost: R(60) }, user);
    if (i % 40 === 0) addExpense({ date, category: pick(['Rent', 'Salary', 'Electricity', 'Packing']), amount: R(5000 + Math.floor(rnd() * 20000)), mode: 'bank', location_id: pick([...stores, null]) }, user);
    if (i % 25 === 0) addPayment({ date, party_id: pick(buyers), direction: 'in', amount: R(500), mode: 'upi' }, user);
  }
});
const buildMs = performance.now() - t0;
const counts = Object.fromEntries(['vouchers', 'voucher_lines', 'stock_moves', 'payments', 'variants'].map((t) => [t, get(`SELECT COUNT(*) n FROM ${t}`)!.n]));
db.close();

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts', `--data=${dir}`, '--port=4051'], { cwd: join(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await new Promise<void>((ok, no) => { let o = ''; const t = setTimeout(() => no(new Error(o)), 20000); server.stdout!.on('data', (d) => { o += d; if (o.includes('is running')) { clearTimeout(t); ok(); } }); });
  const base = 'http://127.0.0.1:4051';
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'vol_owner', password: pw }) });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const time = async (path: string) => { const t = performance.now(); const r = await fetch(base + path, { headers: { Cookie: cookie } }); const b = await r.arrayBuffer(); return { path: path.split('?')[0].replace('/api/', ''), status: r.status, ms: Math.round(performance.now() - t), kb: Math.round(b.byteLength / 1024) }; };
  const year = `from=${addDays(D, -364)}&to=${D}`, month = `from=${D.slice(0, 8)}01&to=${D}`;
  const reports = ['daily_sales', 'sales_register', 'store_comparison', 'channel_profit', 'category_sales', 'size_colour', 'movers', 'staff_sales', 'stock_summary', 'low_stock', 'stock_ageing', 'party_outstanding', 'purchase_register', 'expense_summary', 'cash_bank', 'day_book', 'pnl', 'unit_economics', 'costing'];
  const out = [];
  for (const p of ['/api/dashboard', '/api/bootstrap', '/api/parties', '/api/items', '/api/variants?location=2', '/api/stock', `/api/vouchers?type=sale&${month}`, `/api/vouchers?type=sale&${year}`, `/api/expenses?${year}`]) out.push({ ...(await time(p)), scope: p.includes(year) ? 'year' : '' });
  for (const r of reports) out.push({ ...(await time(`/api/reports/${r}?${year}`)), scope: 'year' });
  for (const r of ['sales_register', 'day_book', 'pnl']) out.push({ ...(await time(`/api/reports/${r}?${month}`)), scope: 'month' });
  out.push({ ...(await time(`/api/reports/sales_register?${year}&format=xlsx`)), scope: 'year xlsx' }, { ...(await time(`/api/reports/sales_register?${year}&format=docx`)), scope: 'year docx' }, { ...(await time('/api/backup')), scope: 'backup' });
  const tb = performance.now();
  const one = await fetch(`${base}/api/vouchers`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ type: 'sale', date: D, location_id: 2, lines: [{ variant_id: byLoc.get(2)![0].id, qty: 1, rate: R(300) }], paid: R(300) }) });
  console.log(JSON.stringify({ bills: BILLS, counts, buildSeconds: Math.round(buildMs / 1000), dbMB: +(statSync(join(dir, 'app.db')).size / 1048576).toFixed(1), saveOneBillMs: Math.round(performance.now() - tb), saveStatus: one.status }));
  for (const o of out.sort((a, b) => b.ms - a.ms)) console.log(`${String(o.ms).padStart(6)} ms ${String(o.kb).padStart(6)} KB  ${o.status}  ${o.path}  ${o.scope}`);
} finally { server.kill(); rmSync(dir, { recursive: true, force: true }); }
