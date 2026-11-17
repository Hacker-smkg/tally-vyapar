import { Router } from 'express';
import { all, billing, business, get, must, nextNumber, run, tx } from './db.ts';
import { requireOwner } from './auth.ts';
import { location, moveStock, onHand, receiveStock, variant, variantName, wholeUnits } from './stock.ts';
import { CHANNELS, PAY_MODES, VOUCHER_TYPES, computeBill, today } from '../shared/calc.ts';
import { HttpError, bad, date, entryDate, id, list, num, oneOf, optId, paise, str } from './util.ts';
import type { User } from './util.ts';

// One record type for sale, purchase and both returns (Tally's "voucher" idea).

export function createVoucher(b: any, user: User) {
  const type = oneOf(b.type, VOUCHER_TYPES, 'Bill type');
  const isSale = type === 'sale' || type === 'sale_return';
  const d = entryDate(b.date);
  // Staff bill only from their own store.
  const locId = location(user.role === 'staff' && user.location_id ? user.location_id : id(b.location_id, 'Store')).id;
  const partyId = optId(b.party_id, 'Party');
  const party = partyId ? get('SELECT * FROM parties WHERE id = ? AND active = 1', partyId) : null;
  if (partyId && !party) bad('Party not found');
  if (!isSale && !party) bad('Pick the supplier');

  const bill = billing();
  const inclusive = b.prices_include_tax == null ? bill.pricesIncludeTax : !!b.prices_include_tax;
  const myState = business().state.trim().toLowerCase();
  const interState = bill.gstEnabled && !!party?.state && !!myState && party.state.trim().toLowerCase() !== myState;

  const lines = list(b.lines, 'Items', { min: 1, max: 300 }).map((l) => ({
    variant_id: id(l.variant_id, 'Item'),
    qty: num(l.qty, 'Quantity', { min: 0.001 }),
    rate: paise(l.rate, 'Rate'),
    discPct: num(l.disc_pct ?? 0, 'Discount %', { min: 0, max: 100 }),
  }));
  const vs = lines.map((l) => variant(l.variant_id));
  lines.forEach((l, i) => wholeUnits(vs[i], l.qty));

  // A return made against a bill can take back only what that bill moved, less what was already returned.
  const refId = type.endsWith('_return') ? optId(b.ref_voucher_id, 'Original bill') : null;
  // A refund with no bill behind it is the owner's call. Staff open the bill and press Return.
  if (type === 'sale_return' && !refId && user.role !== 'owner') throw new HttpError(403, 'Open the original bill and press Return. Only the owner can take a return without a bill.');
  if (refId) {
    const orig = get(`SELECT id, number, party_id FROM vouchers WHERE id = ? AND status = 'final' AND type = ?`, refId, type === 'sale_return' ? 'sale' : 'purchase');
    if (!orig) bad('Original bill not found');
    if ((orig!.party_id ?? null) !== partyId) bad(`The return must be for the same party as ${orig!.number}`);
    const asked = new Map<number, number>();
    for (const l of lines) asked.set(l.variant_id, (asked.get(l.variant_id) ?? 0) + l.qty);
    for (const [vid, qty] of asked) {
      const billed = Number(get('SELECT COALESCE(SUM(qty), 0) q FROM voucher_lines WHERE voucher_id = ? AND variant_id = ?', refId, vid)!.q);
      const back = Number(get(`SELECT COALESCE(SUM(l.qty), 0) q FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.ref_voucher_id = ? AND v.status = 'final' AND l.variant_id = ?`, refId, vid)!.q);
      if (qty > billed - back + 1e-6) bad(`Only ${+(billed - back).toFixed(3)} of ${variantName(variant(vid))} can be returned against ${orig!.number}`);
    }
  }
  // The server works out every total itself. Numbers sent by the browser are only a preview.
  const calc = computeBill(
    lines.map((l, i) => ({ ...l, gstMode: vs[i].gst_mode, gstRate: vs[i].gst_rate })),
    { gstEnabled: bill.gstEnabled, pricesIncludeTax: inclusive, interState, billDiscount: paise(b.bill_discount, 'Discount'), extraCharge: paise(b.extra_charge, 'Extra charge') },
  );

  const paid = paise(b.paid, 'Amount paid');
  if (paid > calc.total) bad('Paid amount is more than the bill total');
  if (!party && paid !== calc.total) bad('A walk-in bill must be paid in full. Pick a customer to keep a balance.');
  const mode = oneOf(b.pay_mode ?? 'cash', PAY_MODES, 'Payment mode');
  const channel = isSale ? oneOf(b.channel ?? 'retail', CHANNELS, 'Channel') : 'retail';

  return tx(() => {
    const number = nextNumber(type);
    const vid = run(
      `INSERT INTO vouchers(type, number, date, party_id, party_name, location_id, channel, prices_include_tax, inter_state,
         subtotal, discount, taxable, cgst, sgst, igst, extra_charge, round_off, total, channel_fee, shipping_cost, notes, user_id, ref_voucher_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      type, number, d, partyId, party ? '' : str(b.party_name, 'Customer name', { max: 80 }), locId, channel, inclusive ? 1 : 0, interState ? 1 : 0,
      calc.subtotal, calc.discount, calc.taxable, calc.cgst, calc.sgst, calc.igst, calc.extraCharge, calc.roundOff, calc.total,
      isSale ? paise(b.channel_fee, 'Marketplace fee') : 0, isSale ? paise(b.shipping_cost, 'Courier cost') : 0, str(b.notes, 'Notes', { max: 500 }), user.id, refId,
    ).id;

    lines.forEach((l, i) => {
      const c = calc.lines[i];
      // Purchase cost per unit = price + this line's share of freight. Everything else moves at average cost.
      const unitCost = type === 'purchase'
        ? (c.taxable + (calc.taxable ? (calc.extraCharge * c.taxable) / calc.taxable : 0)) / l.qty
        : Number(get('SELECT avg_cost FROM variants WHERE id = ?', l.variant_id)!.avg_cost);
      run(
        `INSERT INTO voucher_lines(voucher_id, variant_id, qty, rate, disc_pct, discount, taxable, gst_rate, tax, total, unit_cost) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        vid, l.variant_id, l.qty, l.rate, l.discPct, c.discount, c.taxable, c.gstRate, c.tax, c.total, unitCost,
      );
      const m = { date: d, variant_id: l.variant_id, location_id: locId, unit_cost: unitCost, reason: type, ref_type: 'voucher', ref_id: vid, user_id: user.id };
      if (type === 'purchase') receiveStock({ ...m, qty: l.qty });
      else moveStock({ ...m, qty: type === 'sale_return' ? l.qty : -l.qty });
    });

    if (paid > 0) {
      run('INSERT INTO payments(date, party_id, direction, amount, mode, voucher_id, location_id, user_id) VALUES(?,?,?,?,?,?,?,?)',
        d, partyId, type === 'sale' || type === 'purchase_return' ? 'in' : 'out', paid, mode, vid, locId, user.id);
    }
    return { id: vid, number };
  });
}

/** A bill is never edited. Cancelling removes its stock and payment effects but keeps the bill and its number. */
export function cancelVoucher(vid: number, user: User) {
  return tx(() => {
    const v = get('SELECT * FROM vouchers WHERE id = ?', vid);
    if (!v) throw new HttpError(404, 'Bill not found');
    if (v.status === 'cancelled') bad('Already cancelled');
    if (user.role !== 'owner' && !(v.user_id === user.id && v.date === today())) throw new HttpError(403, 'Staff can cancel only their own bills of today. Ask the owner.');
    const ret = get(`SELECT number FROM vouchers WHERE ref_voucher_id = ? AND status = 'final' LIMIT 1`, vid);
    if (ret) bad(`This bill has a return against it. Cancel the return ${ret.number} first.`);
    if ((v.type === 'purchase' || v.type === 'sale_return') && !billing().allowNegativeStock) {
      for (const l of all('SELECT variant_id, SUM(qty) qty FROM voucher_lines WHERE voucher_id = ? GROUP BY variant_id', vid)) {
        if (onHand(l.variant_id, v.location_id) < l.qty - 1e-6) bad(`Cannot cancel: ${variantName(variant(l.variant_id))} from this bill is already sold or moved`);
      }
    }
    // ponytail: average cost is not rolled back when a purchase is cancelled; the next purchase re-averages it.
    run(`DELETE FROM stock_moves WHERE ref_type = 'voucher' AND ref_id = ?`, vid);
    run('DELETE FROM payments WHERE voucher_id = ?', vid);
    run(`UPDATE vouchers SET status = 'cancelled' WHERE id = ?`, vid);
  });
}

export function addPayment(b: any, user: User): number {
  const amount = paise(b.amount, 'Amount');
  if (!amount) bad('Enter the amount');
  const voucherId = optId(b.voucher_id, 'Bill');
  let partyId = optId(b.party_id, 'Party');
  let direction = b.direction;
  let locId = user.location_id ?? optId(b.location_id, 'Store');
  if (voucherId) {
    const v = get(`SELECT v.*, COALESCE((SELECT SUM(amount) FROM payments WHERE voucher_id = v.id), 0) AS paid FROM vouchers v WHERE v.id = ? AND v.status = 'final'`, voucherId);
    if (!v) bad('Bill not found');
    if (amount > v!.total - v!.paid) bad('That is more than the balance due on this bill');
    partyId = v!.party_id;
    direction = v!.type === 'sale' || v!.type === 'purchase_return' ? 'in' : 'out';
    locId = v!.location_id;
  }
  if (!partyId || !get('SELECT 1 FROM parties WHERE id = ?', partyId)) bad('Pick the party');
  return run('INSERT INTO payments(date, party_id, direction, amount, mode, voucher_id, location_id, note, user_id) VALUES(?,?,?,?,?,?,?,?,?)',
    entryDate(b.date), partyId, oneOf(direction, ['in', 'out'] as const, 'Direction'), amount, oneOf(b.mode ?? 'cash', PAY_MODES, 'Payment mode'),
    voucherId, locId, str(b.note, 'Note', { max: 300 }), user.id).id;
}

export function getVoucher(vid: number) {
  const v = get(
    `SELECT v.*, p.name AS party, p.phone AS party_phone, p.address AS party_address, p.gstin AS party_gstin, p.state AS party_state,
            l.name AS location, u.name AS user, COALESCE((SELECT SUM(amount) FROM payments WHERE voucher_id = v.id), 0) AS paid
     FROM vouchers v LEFT JOIN parties p ON p.id = v.party_id JOIN locations l ON l.id = v.location_id LEFT JOIN users u ON u.id = v.user_id
     WHERE v.id = ?`, vid);
  if (!v) throw new HttpError(404, 'Bill not found');
  return {
    ...v,
    lines: all(
      `SELECT l.*, vv.item, vv.size, vv.colour, vv.sku, vv.unit, vv.hsn, vv.retail_price, vv.wholesale_price
       FROM voucher_lines l JOIN v_variant vv ON vv.variant_id = l.variant_id WHERE l.voucher_id = ? ORDER BY l.id`, vid),
    payments: all('SELECT id, date, amount, mode, direction, note FROM payments WHERE voucher_id = ? ORDER BY id', vid),
  };
}

// ---------- routes ----------
export const voucherRoutes = Router();

voucherRoutes.get('/vouchers', (req, res) => {
  const types = String(req.query.type ?? 'sale').split(',').map((t) => oneOf(t, VOUCHER_TYPES, 'Bill type'));
  const from = date(req.query.from ?? '2000-01-01', 'From');
  const to = date(req.query.to ?? '2999-12-31', 'To');
  const store = req.user.role === 'staff' && req.user.location_id ? req.user.location_id : optId(req.query.store, 'Store');
  const q = `%${str(req.query.q, 'Search', { max: 60 })}%`;
  res.json(all(
    `SELECT v.id, v.type, v.number, v.date, v.channel, v.total, v.status, COALESCE(p.name, NULLIF(v.party_name, ''), 'Walk-in') AS party,
            l.name AS location, u.name AS user,
            COALESCE((SELECT SUM(amount) FROM payments WHERE voucher_id = v.id), 0) AS paid,
            (SELECT COALESCE(SUM(qty), 0) FROM voucher_lines WHERE voucher_id = v.id) AS units
     FROM vouchers v LEFT JOIN parties p ON p.id = v.party_id JOIN locations l ON l.id = v.location_id LEFT JOIN users u ON u.id = v.user_id
     WHERE v.type IN (${types.map(() => '?').join(',')}) AND v.date BETWEEN ? AND ? AND (? IS NULL OR v.location_id = ?)
       AND (v.number LIKE ? OR COALESCE(p.name, v.party_name) LIKE ?)
     ORDER BY v.date DESC, v.id DESC LIMIT 500`,
    ...types, from, to, store, store, q, q,
  ));
});
voucherRoutes.get('/vouchers/:id', (req, res) => {
  const v: Record<string, any> = getVoucher(id(req.params.id, 'Bill'));
  // Staff tied to a store see only that store's bills, here as in the list.
  if (req.user.role === 'staff' && req.user.location_id && v.location_id !== req.user.location_id) throw new HttpError(404, 'Bill not found');
  res.json(v);
});
voucherRoutes.post('/vouchers', (req, res) => res.json(createVoucher(req.body, req.user)));
voucherRoutes.post('/vouchers/:id/cancel', (req, res) => {
  cancelVoucher(id(req.params.id, 'Bill'), req.user);
  res.json({ ok: true });
});
voucherRoutes.post('/payments', (req, res) => res.json({ id: addPayment(req.body, req.user) }));
voucherRoutes.delete('/payments/:id', requireOwner, (req, res) => {
  const pay = must('payments', id(req.params.id, 'Payment'), 'Payment');
  // A walk-in bill has no customer account to carry a balance, so its payment goes only when the bill is cancelled.
  if (pay.voucher_id && !pay.party_id) bad('This payment belongs to a walk-in bill. Cancel the bill instead.');
  run('DELETE FROM payments WHERE id = ?', pay.id);
  res.json({ ok: true });
});
