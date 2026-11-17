import { Router } from 'express';
import { all, billing, get, nextNumber, run, tx } from './db.ts';
import { requireOwner } from './auth.ts';
import { PAY_MODES } from '../shared/calc.ts';
import { HttpError, bad, entryDate, id, list, num, oneOf, optId, paise, str } from './util.ts';
import type { User } from './util.ts';

interface Move {
  date: string; variant_id: number; location_id: number; qty: number; unit_cost: number;
  reason: string; ref_type: string; ref_id: number | null; note?: string; user_id: number;
}

export const onHand = (variantId: number, locationId?: number | null): number =>
  locationId
    ? Number(get('SELECT COALESCE(SUM(qty), 0) q FROM stock_moves WHERE variant_id = ? AND location_id = ?', variantId, locationId)!.q)
    : Number(get('SELECT COALESCE(SUM(qty), 0) q FROM stock_moves WHERE variant_id = ?', variantId)!.q);

export function variant(variantId: number) {
  const v = get('SELECT * FROM v_variant WHERE variant_id = ?', variantId);
  if (!v) throw new HttpError(400, 'Item not found');
  return v;
}
export const variantName = (v: any) => [v.item, v.size, v.colour].filter(Boolean).join(' · ');
/** Shirts are counted, fabric is measured: items in pieces, pairs or sets take whole numbers only. */
export function wholeUnits(v: any, qty: number) {
  if (['pcs', 'pair', 'set'].includes(v.unit) && !Number.isInteger(qty)) bad(`${variantName(v)} is counted in whole ${v.unit}; ${qty} is not a whole number`);
}
export function location(locId: number) {
  const l = get('SELECT * FROM locations WHERE id = ? AND active = 1', locId);
  if (!l) throw new HttpError(400, 'Location not found');
  return l;
}

/** Writes one stock movement. Going out is blocked when stock is short (unless the owner allows it). */
export function moveStock(m: Move) {
  if (!m.qty) return;
  if (m.qty < 0 && !billing().allowNegativeStock) {
    const have = onHand(m.variant_id, m.location_id);
    if (have + m.qty < -1e-6) bad(`Not enough stock of ${variantName(variant(m.variant_id))} at ${location(m.location_id).name}: have ${+have.toFixed(3)}, need ${-m.qty}`);
  }
  run(
    `INSERT INTO stock_moves(date, variant_id, location_id, qty, unit_cost, reason, ref_type, ref_id, note, user_id) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    m.date, m.variant_id, m.location_id, m.qty, m.unit_cost, m.reason, m.ref_type, m.ref_id, m.note ?? '', m.user_id,
  );
}

/** Stock coming in at a known cost: update the weighted-average cost, then record the movement. */
export function receiveStock(m: Move) {
  const cur = Number(get('SELECT avg_cost FROM variants WHERE id = ?', m.variant_id)!.avg_cost);
  const have = Math.max(onHand(m.variant_id), 0);
  const avg = have + m.qty > 0 ? (have * cur + m.qty * m.unit_cost) / (have + m.qty) : m.unit_cost;
  run('UPDATE variants SET avg_cost = ? WHERE id = ?', avg, m.variant_id);
  moveStock(m);
}

const qtyLines = (v: unknown, label: string, min = 1) =>
  list(v, label, { min }).map((l) => ({ variant_id: id(l.variant_id, 'Item'), qty: num(l.qty, 'Quantity', { min: 0.001 }) }));

// ---------- transfer & adjust ----------
export function transferStock(b: any, user: User) {
  const d = entryDate(b.date);
  const from = location(id(b.from, 'From')).id;
  const to = location(id(b.to, 'To')).id;
  if (from === to) bad('Pick two different locations');
  const lines = qtyLines(b.lines, 'Transfer');
  const note = str(b.note, 'Note');
  return tx(() => {
    const ref = Date.now();
    for (const l of lines) {
      const v = variant(l.variant_id);
      wholeUnits(v, l.qty);
      const cost = Number(v.avg_cost);
      const m = { date: d, variant_id: l.variant_id, unit_cost: cost, reason: 'transfer', ref_type: 'transfer', ref_id: ref, note, user_id: user.id };
      moveStock({ ...m, location_id: from, qty: -l.qty });
      moveStock({ ...m, location_id: to, qty: l.qty });
    }
    return { ref };
  });
}

export function adjustStock(b: any, user: User) {
  const qty = num(b.qty, 'Quantity');
  if (!qty) bad('Quantity cannot be zero');
  const vid = id(b.variant_id, 'Item');
  wholeUnits(variant(vid), qty);
  return tx(() =>
    moveStock({
      date: entryDate(b.date), variant_id: vid, location_id: location(id(b.location_id, 'Location')).id, qty,
      unit_cost: Number(variant(vid).avg_cost), reason: 'adjust', ref_type: 'adjust', ref_id: null,
      note: str(b.note, 'Reason', { req: true }), user_id: user.id,
    }),
  );
}

// ---------- production cost sheets ----------
// cost per piece = (raw material used at average cost + labour + factory other costs) ÷ pieces made
// ponytail: every piece on one sheet gets the same cost. Use separate sheets for very different garments.

function finish(pid: number, b: any, user: User) {
  const p = get('SELECT * FROM productions WHERE id = ?', pid);
  if (!p) throw new HttpError(404, 'Cost sheet not found');
  if (p.status !== 'open') bad('This cost sheet is already closed');
  const labour = b.labour_cost == null ? p.labour_cost : paise(b.labour_cost, 'Labour cost');
  const other = b.other_cost == null ? p.other_cost : paise(b.other_cost, 'Other cost');
  if (b.outputs) {
    run('DELETE FROM production_outputs WHERE production_id = ?', pid);
    for (const o of qtyLines(b.outputs, 'Pieces made')) {
      wholeUnits(variant(o.variant_id), o.qty);
      run('INSERT INTO production_outputs(production_id, variant_id, qty) VALUES(?,?,?)', pid, o.variant_id, o.qty);
    }
  }
  const outputs = all('SELECT * FROM production_outputs WHERE production_id = ?', pid);
  const pieces = outputs.reduce((a, o) => a + o.qty, 0);
  if (!(pieces > 0)) bad('Enter the pieces made');
  const total = p.material_cost + labour + other;
  const unit = total / pieces;
  const done = entryDate(b.done_date ?? p.date, 'Completion date');
  if (done < p.date) bad('The completion date cannot be before the start date of the cost sheet');
  for (const o of outputs) {
    run('UPDATE production_outputs SET unit_cost = ? WHERE id = ?', unit, o.id);
    receiveStock({ date: done, variant_id: o.variant_id, location_id: p.to_location_id, qty: o.qty, unit_cost: unit, reason: 'production_in', ref_type: 'production', ref_id: pid, user_id: user.id });
  }
  run(`UPDATE productions SET labour_cost = ?, other_cost = ?, total_cost = ?, status = 'done', done_date = ? WHERE id = ?`, labour, other, total, done, pid);
}

export function createProduction(b: any, user: User) {
  const d = entryDate(b.date);
  const from = location(id(b.from_location_id, 'Material location')).id;
  const to = location(id(b.to_location_id, 'Finished goods location')).id;
  const party = optId(b.party_id, 'Job worker');
  const labour = paise(b.labour_cost, 'Labour cost');
  const other = paise(b.other_cost, 'Other cost');
  const mode = oneOf(b.pay_mode ?? 'cash', PAY_MODES, 'Payment mode');
  const inputs = qtyLines(b.inputs ?? [], 'Materials', 0);
  const outputs = qtyLines(b.outputs, 'Pieces made');
  if (!inputs.length && !labour && !other) bad('Add materials or a cost');
  return tx(() => {
    const number = nextNumber('production');
    const pid = run(
      `INSERT INTO productions(number, date, from_location_id, to_location_id, party_id, labour_cost, other_cost, pay_mode, notes, user_id) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      number, d, from, to, party, labour, other, mode, str(b.notes, 'Notes', { max: 500 }), user.id,
    ).id;
    let material = 0;
    for (const l of inputs) {
      const v = variant(l.variant_id);
      wholeUnits(v, l.qty);
      const cost = Number(v.avg_cost);
      material += l.qty * cost;
      run('INSERT INTO production_inputs(production_id, variant_id, qty, unit_cost) VALUES(?,?,?,?)', pid, l.variant_id, l.qty, cost);
      moveStock({ date: d, variant_id: l.variant_id, location_id: from, qty: -l.qty, unit_cost: cost, reason: 'production_out', ref_type: 'production', ref_id: pid, user_id: user.id });
    }
    run('UPDATE productions SET material_cost = ?, total_cost = ? WHERE id = ?', Math.round(material), Math.round(material) + labour + other, pid);
    for (const o of outputs) {
      wholeUnits(variant(o.variant_id), o.qty);
      run('INSERT INTO production_outputs(production_id, variant_id, qty) VALUES(?,?,?)', pid, o.variant_id, o.qty);
    }
    if (b.complete) finish(pid, { done_date: d }, user);
    return { id: pid, number };
  });
}

export const completeProduction = (pid: number, b: any, user: User) => tx(() => finish(pid, b, user));

export function cancelProduction(pid: number) {
  return tx(() => {
    const p = get('SELECT * FROM productions WHERE id = ?', pid);
    if (!p) throw new HttpError(404, 'Cost sheet not found');
    if (p.status === 'cancelled') bad('Already cancelled');
    if (p.status === 'done' && !billing().allowNegativeStock) {
      for (const o of all('SELECT * FROM production_outputs WHERE production_id = ?', pid)) {
        if (onHand(o.variant_id, p.to_location_id) < o.qty - 1e-6) bad(`Cannot cancel: some ${variantName(variant(o.variant_id))} from this sheet is already sold or moved`);
      }
    }
    // ponytail: average cost is not rolled back on cancel; the next receipt re-averages it.
    run(`DELETE FROM stock_moves WHERE ref_type = 'production' AND ref_id = ?`, pid);
    run(`UPDATE productions SET status = 'cancelled' WHERE id = ?`, pid);
  });
}

export function getProduction(pid: number) {
  const p = get(
    `SELECT p.*, pa.name AS party, lf.name AS from_location, lt.name AS to_location, u.name AS user
     FROM productions p LEFT JOIN parties pa ON pa.id = p.party_id
     JOIN locations lf ON lf.id = p.from_location_id JOIN locations lt ON lt.id = p.to_location_id
     LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?`, pid);
  if (!p) throw new HttpError(404, 'Cost sheet not found');
  const lines = (table: string) =>
    all(`SELECT x.variant_id, x.qty, x.unit_cost, vv.item, vv.size, vv.colour, vv.sku, vv.unit FROM ${table} x JOIN v_variant vv ON vv.variant_id = x.variant_id WHERE x.production_id = ? ORDER BY x.id`, pid);
  return { ...p, inputs: lines('production_inputs'), outputs: lines('production_outputs') };
}

// ---------- routes ----------
export const stockRoutes = Router();

stockRoutes.get('/stock', (_req, res) => {
  const stock = new Map<number, Record<number, number>>();
  for (const s of all('SELECT * FROM v_stock')) {
    if (!stock.has(s.variant_id)) stock.set(s.variant_id, {});
    stock.get(s.variant_id)![s.location_id] = +Number(s.qty).toFixed(3);
  }
  const rows = all(
    `SELECT variant_id, item_id, item, kind, unit, size, colour, sku, cat, subcat, avg_cost, retail_price, wholesale_price, low_stock
     FROM v_variant WHERE v_active = 1 AND i_active = 1 ORDER BY kind, cat, subcat, item, variant_id`,
  ).map((r) => {
    const by = stock.get(r.variant_id) ?? {};
    return { ...r, by, total: +Object.values(by).reduce((a, b) => a + b, 0).toFixed(3) };
  });
  res.json({ rows, wip: Number(get(`SELECT COALESCE(SUM(material_cost), 0) v FROM productions WHERE status = 'open'`)!.v) });
});

stockRoutes.get('/stock/moves', (req, res) => {
  res.json(all(
    `SELECT m.id, m.date, m.qty, m.unit_cost, m.reason, m.note, l.name AS location, u.name AS user,
            CASE m.ref_type WHEN 'voucher' THEN (SELECT number FROM vouchers WHERE id = m.ref_id)
                            WHEN 'production' THEN (SELECT number FROM productions WHERE id = m.ref_id) ELSE '' END AS ref
     FROM stock_moves m JOIN locations l ON l.id = m.location_id LEFT JOIN users u ON u.id = m.user_id
     WHERE m.variant_id = ? ORDER BY m.date DESC, m.id DESC LIMIT 200`,
    id(req.query.variant, 'Item'),
  ));
});

stockRoutes.post('/stock/transfer', (req, res) => res.json(transferStock(req.body, req.user)));
stockRoutes.post('/stock/adjust', requireOwner, (req, res) => {
  adjustStock(req.body, req.user);
  res.json({ ok: true });
});

stockRoutes.get('/productions', (_req, res) => {
  res.json(all(
    `SELECT p.id, p.number, p.date, p.done_date, p.status, p.material_cost, p.labour_cost, p.other_cost, p.total_cost,
            pa.name AS party, lt.name AS to_location,
            (SELECT COALESCE(SUM(qty), 0) FROM production_outputs WHERE production_id = p.id) AS pieces,
            (SELECT GROUP_CONCAT(DISTINCT vv.item) FROM production_outputs o JOIN v_variant vv ON vv.variant_id = o.variant_id WHERE o.production_id = p.id) AS items
     FROM productions p LEFT JOIN parties pa ON pa.id = p.party_id JOIN locations lt ON lt.id = p.to_location_id
     ORDER BY p.date DESC, p.id DESC LIMIT 300`,
  ));
});
stockRoutes.get('/productions/:id', (req, res) => res.json(getProduction(id(req.params.id, 'Cost sheet'))));
stockRoutes.post('/productions', (req, res) => res.json(createProduction(req.body, req.user)));
stockRoutes.post('/productions/:id/complete', (req, res) => {
  completeProduction(id(req.params.id, 'Cost sheet'), req.body, req.user);
  res.json({ ok: true });
});
stockRoutes.post('/productions/:id/cancel', requireOwner, (req, res) => {
  cancelProduction(id(req.params.id, 'Cost sheet'));
  res.json({ ok: true });
});
