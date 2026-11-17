import { Router } from 'express';
import { all, billing, business, get, getSetting, must, run, setSetting, tx, DEFAULT_AI, DEFAULT_BILLING, DEFAULT_BUSINESS } from './db.ts';
import { requireOwner } from './auth.ts';
import { receiveStock } from './stock.ts';
import { PAY_MODES, today } from '../shared/calc.ts';
import { HttpError, bad, date, entryDate, id, list, num, oneOf, optId, paise, str } from './util.ts';
import type { User } from './util.ts';

export const masterRoutes = Router();

// Everything the screens need at start, in one call.
masterRoutes.get('/bootstrap', (req, res) => {
  const ai = getSetting('ai', DEFAULT_AI);
  res.json({
    business: business(),
    billing: billing(),
    locations: all('SELECT * FROM locations ORDER BY active DESC, kind, id'),
    categories: all('SELECT * FROM categories ORDER BY parent_id IS NOT NULL, id'),
    aiReady: req.user.role === 'owner' && !!(ai.baseUrl && ai.model),
  });
});

// ---------- settings (owner) ----------
masterRoutes.put('/settings/business', requireOwner, (req, res) => {
  const b = req.body;
  const logo = str(b.logo, 'Logo', { max: 400_000 });
  if (logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) bad('Logo must be a PNG, JPG or WebP image');
  const brandColor = str(b.brandColor, 'Brand colour', { max: 7 });
  if (!/^#[0-9a-fA-F]{6}$/.test(brandColor)) bad('Brand colour is not valid');
  setSetting('business', {
    ...DEFAULT_BUSINESS,
    name: str(b.name, 'Business name', { req: true }), tagline: str(b.tagline, 'Tagline'), address: str(b.address, 'Address', { max: 400 }),
    phone: str(b.phone, 'Phone', { max: 40 }), email: str(b.email, 'Email'), state: str(b.state, 'State', { max: 60 }),
    gstin: str(b.gstin, 'GSTIN', { max: 15 }).toUpperCase(), logo, brandColor,
  });
  res.json({ ok: true });
});

masterRoutes.put('/settings/billing', requireOwner, (req, res) => {
  const b = req.body;
  const prefixes: Record<string, string> = {};
  for (const k of Object.keys(DEFAULT_BILLING.prefixes)) prefixes[k] = str(b.prefixes?.[k], 'Prefix', { max: 20 });
  const cats = list(b.expenseCategories ?? [], 'Expense heads', { max: 60 }).map((c) => str(c, 'Expense head', { req: true, max: 40 }));
  if (b.gstEnabled && !business().gstin) bad('Add your GSTIN under Brand before switching GST on');
  setSetting('billing', {
    gstEnabled: !!b.gstEnabled, pricesIncludeTax: !!b.pricesIncludeTax, allowNegativeStock: !!b.allowNegativeStock, prefixes,
    terms: str(b.terms, 'Terms', { max: 600 }), footer: str(b.footer, 'Footer', { max: 200 }),
    upiId: str(b.upiId, 'UPI ID', { max: 80 }), bankDetails: str(b.bankDetails, 'Bank details', { max: 300 }),
    expenseCategories: [...new Set(cats)],
  });
  res.json({ ok: true });
});

// ---------- locations ----------
const locFields = (b: any) => ({
  name: str(b.name, 'Name', { req: true, max: 60 }),
  kind: oneOf(b.kind, ['godown', 'store', 'factory'] as const, 'Type'),
  active: b.active === false || b.active === 0 ? 0 : 1,
});
const unique = (fn: () => any, message: string) => {
  try {
    return fn();
  } catch (e: any) {
    if (String(e?.message).includes('UNIQUE')) bad(message);
    throw e;
  }
};
masterRoutes.post('/locations', requireOwner, (req, res) => {
  const f = locFields(req.body);
  res.json(unique(() => run('INSERT INTO locations(name, kind) VALUES(?, ?)', f.name, f.kind), 'A location with that name already exists'));
});
masterRoutes.put('/locations/:id', requireOwner, (req, res) => {
  const f = locFields(req.body);
  const lid = id(req.params.id, 'Location');
  must('locations', lid, 'Location');
  if (!f.active && Number(get('SELECT COALESCE(SUM(qty), 0) q FROM stock_moves WHERE location_id = ?', lid)!.q) > 0.0005) bad('Move the stock out of this location before switching it off');
  unique(() => run('UPDATE locations SET name = ?, kind = ?, active = ? WHERE id = ?', f.name, f.kind, f.active, lid), 'A location with that name already exists');
  res.json({ ok: true });
});

// ---------- categories (two levels) ----------
export function addCategory(name: string, parentId: number | null): number {
  const found = parentId
    ? get('SELECT id FROM categories WHERE name = ? AND parent_id = ?', name, parentId)
    : get('SELECT id FROM categories WHERE name = ? AND parent_id IS NULL', name);
  return found ? found.id : run('INSERT INTO categories(name, parent_id) VALUES(?, ?)', name, parentId).id;
}
masterRoutes.post('/categories', requireOwner, (req, res) => {
  const parent = optId(req.body.parent_id, 'Category');
  if (parent && get('SELECT parent_id FROM categories WHERE id = ?', parent)?.parent_id) bad('Only two levels: category and sub-category');
  res.json({ id: addCategory(str(req.body.name, 'Name', { req: true, max: 60 }), parent) });
});
masterRoutes.put('/categories/:id', requireOwner, (req, res) => {
  must('categories', id(req.params.id, 'Category'), 'Category');
  run('UPDATE categories SET name = ? WHERE id = ?', str(req.body.name, 'Name', { req: true, max: 60 }), id(req.params.id, 'Category'));
  res.json({ ok: true });
});
masterRoutes.delete('/categories/:id', requireOwner, (req, res) => {
  const cid = id(req.params.id, 'Category');
  must('categories', cid, 'Category');
  if (get('SELECT 1 FROM categories WHERE parent_id = ?', cid)) bad('Remove its sub-categories first');
  if (get('SELECT 1 FROM items WHERE category_id = ? AND active = 1', cid)) bad('Some items still use this category');
  run('UPDATE items SET category_id = NULL WHERE category_id = ?', cid);
  run('DELETE FROM categories WHERE id = ?', cid);
  res.json({ ok: true });
});

// ---------- parties ----------
const partyFields = (b: any) => ({
  name: str(b.name, 'Name', { req: true }),
  kind: oneOf(b.kind, ['customer', 'supplier', 'jobworker'] as const, 'Type'),
  phone: str(b.phone, 'Phone', { max: 40 }), address: str(b.address, 'Address', { max: 400 }), state: str(b.state, 'State', { max: 60 }),
  gstin: str(b.gstin, 'GSTIN', { max: 15 }).toUpperCase(),
  opening_balance: int0(b.opening_balance),
});
const int0 = (v: unknown) => Math.round(num(v ?? 0, 'Opening balance'));
export function saveParty(b: any, pid?: number): number {
  const f = partyFields(b);
  if (pid) {
    must('parties', pid, 'Party');
    run('UPDATE parties SET name = ?, kind = ?, phone = ?, address = ?, state = ?, gstin = ?, opening_balance = ? WHERE id = ?', f.name, f.kind, f.phone, f.address, f.state, f.gstin, f.opening_balance, pid);
    return pid;
  }
  return run('INSERT INTO parties(name, kind, phone, address, state, gstin, opening_balance) VALUES(?,?,?,?,?,?,?)', f.name, f.kind, f.phone, f.address, f.state, f.gstin, f.opening_balance).id;
}
masterRoutes.get('/parties', (_req, res) => {
  res.json(all('SELECT p.*, b.balance FROM parties p JOIN v_party_balance b ON b.party_id = p.id WHERE p.active = 1 ORDER BY p.name COLLATE NOCASE'));
});
masterRoutes.post('/parties', (req, res) => res.json({ id: saveParty(req.body) }));
masterRoutes.put('/parties/:id', (req, res) => res.json({ id: saveParty(req.body, id(req.params.id, 'Party')) }));
masterRoutes.delete('/parties/:id', requireOwner, (req, res) => {
  const pid = id(req.params.id, 'Party');
  must('parties', pid, 'Party');
  if (Number(get('SELECT balance FROM v_party_balance WHERE party_id = ?', pid)?.balance ?? 0) !== 0) bad('Settle the balance before removing this party');
  run('UPDATE parties SET active = 0 WHERE id = ?', pid);
  res.json({ ok: true });
});

// ---------- items & variants ----------
export function saveItem(b: any, user: User, itemId?: number): number {
  const f = {
    name: str(b.name, 'Item name', { req: true }),
    kind: oneOf(b.kind, ['finished', 'raw'] as const, 'Type'),
    category_id: optId(b.category_id, 'Category'),
    unit: str(b.unit || 'pcs', 'Unit', { max: 10 }),
    hsn: str(b.hsn, 'HSN', { max: 10 }),
    gst_mode: oneOf(b.gst_mode ?? 'apparel', ['none', 'fixed', 'apparel'] as const, 'GST type'),
    gst_rate: num(b.gst_rate ?? 0, 'GST rate', { min: 0, max: 40 }),
  };
  const variants = list(b.variants, 'Sizes / colours', { min: 1, max: 300 }).map((v) => ({
    id: optId(v.id, 'Variant'),
    sku: str(v.sku, 'SKU', { max: 40 }),
    size: str(v.size, 'Size', { max: 30 }), colour: str(v.colour, 'Colour', { max: 40 }),
    retail_price: paise(v.retail_price, 'Retail price'), wholesale_price: paise(v.wholesale_price, 'Wholesale price'),
    low_stock: num(v.low_stock ?? 0, 'Low stock level', { min: 0 }),
    opening_qty: num(v.opening_qty ?? 0, 'Opening stock', { min: 0 }),
    opening_cost: paise(v.opening_cost, 'Cost'),
    opening_location: optId(v.opening_location, 'Location'),
  }));
  if (itemId) must('items', itemId, 'Item');
  return unique(() => tx(() => {
    const iid = itemId ?? run('INSERT INTO items(name, kind) VALUES(?, ?)', f.name, f.kind).id;
    run('UPDATE items SET name = ?, kind = ?, category_id = ?, unit = ?, hsn = ?, gst_mode = ?, gst_rate = ? WHERE id = ?', f.name, f.kind, f.category_id, f.unit, f.hsn, f.gst_mode, f.gst_rate, iid);
    const keep = new Set<number>();
    for (const v of variants) {
      let vid = v.id;
      if (vid) {
        if (!get('SELECT 1 FROM variants WHERE id = ? AND item_id = ?', vid, iid)) throw new HttpError(400, 'Variant does not belong to this item');
        run('UPDATE variants SET size = ?, colour = ?, retail_price = ?, wholesale_price = ?, low_stock = ?, active = 1 WHERE id = ?', v.size, v.colour, v.retail_price, v.wholesale_price, v.low_stock, vid);
        if (v.sku) run('UPDATE variants SET sku = ? WHERE id = ?', v.sku, vid);
      } else {
        vid = run('INSERT INTO variants(item_id, sku, size, colour, retail_price, wholesale_price, low_stock, avg_cost) VALUES(?,?,?,?,?,?,?,?)',
          iid, v.sku || null, v.size, v.colour, v.retail_price, v.wholesale_price, v.low_stock, v.opening_cost).id;
        // The SKU is also the barcode. Numbers scan fastest.
        if (!v.sku) run('UPDATE variants SET sku = ? WHERE id = ?', String(100000 + vid), vid);
        if (v.opening_qty > 0) {
          if (!v.opening_location) throw new HttpError(400, 'Pick where the opening stock is kept');
          receiveStock({ date: today(), variant_id: vid, location_id: v.opening_location, qty: v.opening_qty, unit_cost: v.opening_cost, reason: 'opening', ref_type: 'opening', ref_id: null, user_id: user.id });
        }
      }
      keep.add(vid);
    }
    // Sizes removed from the form: delete if never used, otherwise just hide.
    for (const old of all('SELECT id FROM variants WHERE item_id = ?', iid)) {
      if (keep.has(old.id)) continue;
      const used = get('SELECT 1 FROM stock_moves WHERE variant_id = ? UNION SELECT 1 FROM voucher_lines WHERE variant_id = ? LIMIT 1', old.id, old.id);
      if (used) run('UPDATE variants SET active = 0 WHERE id = ?', old.id);
      else run('DELETE FROM variants WHERE id = ?', old.id);
    }
    return iid;
  }), 'That SKU / barcode is already used by another item');
}

masterRoutes.get('/items', (_req, res) => {
  res.json(all(
    `SELECT i.id, i.name, i.kind, i.unit, i.category_id, i.hsn, i.gst_mode, i.gst_rate,
            COALESCE(pc.name, c.name, '') AS cat, CASE WHEN pc.id IS NULL THEN '' ELSE c.name END AS subcat,
            (SELECT COUNT(*) FROM variants WHERE item_id = i.id AND active = 1) AS n_variants,
            (SELECT COALESCE(SUM(m.qty), 0) FROM stock_moves m JOIN variants v ON v.id = m.variant_id WHERE v.item_id = i.id) AS stock,
            (SELECT MIN(retail_price) FROM variants WHERE item_id = i.id AND active = 1) AS min_price,
            (SELECT MAX(retail_price) FROM variants WHERE item_id = i.id AND active = 1) AS max_price,
            (SELECT AVG(avg_cost) FROM variants WHERE item_id = i.id AND active = 1) AS avg_cost
     FROM items i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
     WHERE i.active = 1 ORDER BY i.kind, cat, subcat, i.name COLLATE NOCASE`,
  ));
});
masterRoutes.get('/items/:id', (req, res) => {
  const iid = id(req.params.id, 'Item');
  const item = get('SELECT * FROM items WHERE id = ?', iid);
  if (!item) throw new HttpError(404, 'Item not found');
  res.json({
    ...item,
    variants: all(`SELECT v.*, COALESCE((SELECT SUM(qty) FROM stock_moves WHERE variant_id = v.id), 0) AS stock FROM variants v WHERE v.item_id = ? AND v.active = 1 ORDER BY v.id`, iid),
  });
});
masterRoutes.post('/items', (req, res) => res.json({ id: saveItem(req.body, req.user) }));
masterRoutes.put('/items/:id', (req, res) => res.json({ id: saveItem(req.body, req.user, id(req.params.id, 'Item')) }));
masterRoutes.delete('/items/:id', requireOwner, (req, res) => {
  const iid = id(req.params.id, 'Item');
  must('items', iid, 'Item');
  if (Number(get('SELECT COALESCE(SUM(m.qty), 0) q FROM stock_moves m JOIN variants v ON v.id = m.variant_id WHERE v.item_id = ?', iid)!.q) > 0.0005) bad('This item still has stock. Sell, transfer or adjust it first.');
  run('UPDATE items SET active = 0 WHERE id = ?', iid);
  res.json({ ok: true });
});

// Flat list for the item search box on bills. `stock` is for one location when given.
masterRoutes.get('/variants', (req, res) => {
  const loc = optId(req.query.location, 'Location');
  res.json(all(
    `SELECT vv.variant_id AS id, vv.item_id, vv.item, vv.kind, vv.unit, vv.size, vv.colour, vv.sku, vv.cat, vv.subcat,
            vv.retail_price, vv.wholesale_price, vv.avg_cost, vv.gst_mode, vv.gst_rate, vv.hsn,
            COALESCE((SELECT SUM(qty) FROM stock_moves WHERE variant_id = vv.variant_id AND (? IS NULL OR location_id = ?)), 0) AS stock
     FROM v_variant vv WHERE vv.v_active = 1 AND vv.i_active = 1 ORDER BY vv.item COLLATE NOCASE, vv.variant_id`,
    loc, loc,
  ));
});

// ---------- expenses ----------
export function addExpense(b: any, user: User): number {
  const amount = paise(b.amount, 'Amount');
  if (!amount) bad('Enter the amount');
  return run('INSERT INTO expenses(date, category, amount, mode, location_id, note, user_id) VALUES(?,?,?,?,?,?,?)',
    entryDate(b.date), str(b.category, 'Expense head', { req: true, max: 40 }), amount, oneOf(b.mode ?? 'cash', PAY_MODES, 'Payment mode'),
    optId(b.location_id, 'Store'), str(b.note, 'Note', { max: 300 }), user.id).id;
}
masterRoutes.get('/expenses', (req, res) => {
  const from = date(req.query.from ?? '2000-01-01', 'From');
  const to = date(req.query.to ?? '2999-12-31', 'To');
  const store = req.user.role === 'staff' ? req.user.location_id : optId(req.query.store, 'Store');
  res.json(all(
    `SELECT e.*, l.name AS location, u.name AS user FROM expenses e LEFT JOIN locations l ON l.id = e.location_id LEFT JOIN users u ON u.id = e.user_id
     WHERE e.date BETWEEN ? AND ? AND (? IS NULL OR e.location_id = ?) ORDER BY e.date DESC, e.id DESC LIMIT 1000`,
    from, to, store, store,
  ));
});
masterRoutes.post('/expenses', (req, res) => {
  const body = req.user.role === 'staff' && req.user.location_id ? { ...req.body, location_id: req.user.location_id } : req.body;
  res.json({ id: addExpense(body, req.user) });
});
masterRoutes.delete('/expenses/:id', requireOwner, (req, res) => {
  run('DELETE FROM expenses WHERE id = ?', must('expenses', id(req.params.id, 'Expense'), 'Expense').id);
  res.json({ ok: true });
});
