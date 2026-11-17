import { Router } from 'express';
import { all, billing, business, get } from './db.ts';
import { toDocx, toXlsx } from './export.ts';
import { CHANNELS, CHANNEL_LABEL, PAY_MODES, TYPE_LABEL, addDays, fmtDate, today } from '../shared/calc.ts';
import { HttpError, bad, date, oneOf, optId } from './util.ts';
import type { User } from './util.ts';

// Every report is one function that returns columns + rows. The Reports screen, the Excel and
// Word exports and the AI assistant all read reports through runReport(), so numbers always match.

export type ColType = 'text' | 'money' | 'num' | 'date' | 'pct';
export interface Col { key: string; label: string; type?: ColType }
export interface ReportResult {
  name: string; title: string; subtitle: string;
  columns: Col[];
  rows: Record<string, any>[];
  totals?: Record<string, any>;
  summary?: { label: string; value: number | string; type: ColType }[];
}
export interface Params { from: string; to: string; store: number | null; channel: string | null; party: number | null; owner: boolean }
type Body = Omit<ReportResult, 'name' | 'title' | 'subtitle'>;
interface Def { title: string; group: 'Sales' | 'Stock' | 'Money' | 'Profit'; about: string; filters: ('range' | 'store' | 'channel' | 'party')[]; ownerOnly?: boolean; hidden?: boolean; run(p: Params): Body }

const col = (key: string, label: string, type: ColType = 'text'): Col => ({ key, label, type });
const pct = (part: number, whole: number) => (whole ? +((part / whole) * 100).toFixed(1) : 0);
const sumOf = (rows: Record<string, any>[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)]));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);

function where(p: Params, a = '', o: { channel?: boolean } = {}): [string, any[]] {
  const c = [`${a}date BETWEEN ? AND ?`];
  const args: any[] = [p.from, p.to];
  if (p.store) { c.push(`${a}location_id = ?`); args.push(p.store); }
  if (o.channel && p.channel) { c.push(`${a}channel = ?`); args.push(p.channel); }
  return [c.join(' AND '), args];
}
const SALE = `status = 'final' AND type IN ('sale','sale_return')`;

function register(types: [string, string]): (p: Params) => Body {
  return (p) => {
    const [w, a] = where(p, 'v.', { channel: true });
    const gst = billing().gstEnabled;
    const rows = all(
      `SELECT v.date, v.number, v.type, COALESCE(pa.name, NULLIF(v.party_name, ''), 'Walk-in') AS party, l.name AS store, v.channel,
              (SELECT COALESCE(SUM(qty), 0) FROM voucher_lines WHERE voucher_id = v.id) AS units, v.taxable, v.cgst + v.sgst + v.igst AS tax, v.total,
              COALESCE((SELECT SUM(amount) FROM payments WHERE voucher_id = v.id), 0) AS paid, u.name AS by
       FROM vouchers v LEFT JOIN parties pa ON pa.id = v.party_id JOIN locations l ON l.id = v.location_id LEFT JOIN users u ON u.id = v.user_id
       WHERE v.status = 'final' AND v.type IN (?, ?) AND ${w} ORDER BY v.date, v.id`, ...types, ...a,
    ).map((r) => {
      const s = r.type === types[0] ? 1 : -1;
      return { ...r, kind: TYPE_LABEL[r.type], channel: CHANNEL_LABEL[r.channel], units: s * r.units, taxable: s * r.taxable, tax: s * r.tax, total: s * r.total, paid: s * r.paid, due: s * (r.total - r.paid) };
    });
    const sale = types[0] === 'sale';
    return {
      columns: [col('date', 'Date', 'date'), col('number', 'Bill no.'), col('kind', 'Type'), col('party', sale ? 'Customer' : 'Supplier'), col('store', 'Location'),
        ...(sale ? [col('channel', 'Channel')] : []), col('units', 'Qty', 'num'),
        ...(gst ? [col('taxable', 'Taxable', 'money'), col('tax', 'GST', 'money')] : []),
        col('total', 'Bill total', 'money'), col('paid', 'Paid', 'money'), col('due', 'Balance', 'money'), col('by', 'Made by')],
      rows,
      totals: { date: 'Total', ...sumOf(rows, ['units', 'taxable', 'tax', 'total', 'paid', 'due']) },
    };
  };
}

function pnl(p: Params) {
  const [w, a] = where(p);
  const s = get(`SELECT COALESCE(SUM(CASE WHEN sgn = 1 THEN taxable ELSE 0 END), 0) AS sales, COALESCE(SUM(CASE WHEN sgn = -1 THEN taxable ELSE 0 END), 0) AS returns,
                        COALESCE(SUM(sgn * qty * unit_cost), 0) AS cogs FROM v_sale_lines WHERE ${w}`, ...a)!;
  const v = get(`SELECT COALESCE(SUM((CASE type WHEN 'sale' THEN 1 ELSE -1 END) * (extra_charge + round_off)), 0) AS charges,
                        COALESCE(SUM(channel_fee), 0) AS fee, COALESCE(SUM(shipping_cost), 0) AS ship FROM vouchers WHERE ${SALE} AND ${w}`, ...a)!;
  const exp = all(`SELECT category, SUM(amount) AS amt FROM expenses WHERE ${w} GROUP BY category ORDER BY amt DESC`, ...a);
  const loss = Math.round(Number(get(`SELECT COALESCE(SUM(-qty * unit_cost), 0) AS x FROM stock_moves WHERE reason = 'adjust' AND ${w}`, ...a)!.x));
  const cogs = Math.round(s.cogs);
  const expenses = exp.reduce((t, e) => t + e.amt, 0);
  const revenue = s.sales - s.returns + v.charges;
  const gross = revenue - cogs;
  const net = gross - v.fee - v.ship - expenses - loss;
  return { sales: s.sales, returns: s.returns, charges: v.charges, revenue, cogs, gross, fee: v.fee, ship: v.ship, exp, expenses, loss, net };
}

export const REPORTS: Record<string, Def> = {
  // ---------------- Sales ----------------
  daily_sales: {
    title: 'Daily Sales', group: 'Sales', filters: ['range', 'store'],
    about: 'Day by day: number of bills, units sold, sales, returns, net sales, average bill value and money collected by cash / UPI / card / bank.',
    run(p) {
      const [w, a] = where(p);
      const days = new Map<string, Record<string, any>>();
      const day = (d: string) => days.get(d) ?? days.set(d, { date: d, bills: 0, units: 0, sales: 0, returns: 0, net: 0, cash: 0, upi: 0, card: 0, bank: 0 }).get(d)!;
      for (const r of all(`SELECT date, COUNT(CASE WHEN type = 'sale' THEN 1 END) AS bills, SUM(CASE WHEN type = 'sale' THEN total ELSE 0 END) AS sales,
                                  SUM(CASE WHEN type = 'sale_return' THEN total ELSE 0 END) AS returns FROM vouchers WHERE ${SALE} AND ${w} GROUP BY date`, ...a)) {
        Object.assign(day(r.date), { bills: r.bills, sales: r.sales, returns: r.returns, net: r.sales - r.returns });
      }
      for (const r of all(`SELECT date, SUM(sgn * qty) AS units FROM v_sale_lines WHERE ${w} GROUP BY date`, ...a)) day(r.date).units = r.units;
      const [pw, pa] = where(p, 'pm.');
      // Money from customers: paid on sale bills + on-account receipts − refunds on returns.
      for (const r of all(
        `SELECT pm.date, pm.mode, SUM(CASE pm.direction WHEN 'in' THEN pm.amount ELSE -pm.amount END) AS amt
         FROM payments pm LEFT JOIN vouchers v ON v.id = pm.voucher_id
         WHERE ${pw} AND ((v.id IS NULL AND pm.direction = 'in') OR v.type IN ('sale','sale_return')) GROUP BY pm.date, pm.mode`, ...pa)) {
        if (r.mode in day(r.date)) day(r.date)[r.mode] += r.amt;
      }
      const rows = [...days.values()].sort((x, y) => x.date.localeCompare(y.date)).map((r) => ({ ...r, avg: r.bills ? Math.round(r.sales / r.bills) : 0 }));
      const t = sumOf(rows, ['bills', 'units', 'sales', 'returns', 'net', 'cash', 'upi', 'card', 'bank']);
      return {
        columns: [col('date', 'Date', 'date'), col('bills', 'Bills', 'num'), col('units', 'Units', 'num'), col('sales', 'Sales', 'money'), col('returns', 'Returns', 'money'),
          col('net', 'Net sales', 'money'), col('avg', 'Avg bill', 'money'), col('cash', 'Cash', 'money'), col('upi', 'UPI', 'money'), col('card', 'Card', 'money'), col('bank', 'Bank', 'money')],
        rows,
        totals: { date: 'Total', ...t, avg: t.bills ? Math.round(t.sales / t.bills) : 0 },
        summary: [{ label: 'Net sales', value: t.net, type: 'money' }, { label: 'Bills', value: t.bills, type: 'num' }, { label: 'Units', value: t.units, type: 'num' },
          { label: 'Average bill', value: t.bills ? Math.round(t.sales / t.bills) : 0, type: 'money' }],
      };
    },
  },
  sales_register: {
    title: 'Sales Register', group: 'Sales', filters: ['range', 'store', 'channel'],
    about: 'Every sale bill and sale return in the period with customer, store, channel, total, paid and balance.',
    run: register(['sale', 'sale_return']),
  },
  store_comparison: {
    title: 'Store Comparison', group: 'Sales', filters: ['range', 'channel'], ownerOnly: true,
    about: 'Each store side by side: bills, units, sales, average bill, gross profit, store expenses and net profit.',
    run(p) {
      const args: any[] = [p.from, p.to];
      if (p.channel) args.push(p.channel);
      const exp = new Map(all('SELECT location_id, SUM(amount) AS amt FROM expenses WHERE date BETWEEN ? AND ? GROUP BY location_id', p.from, p.to).map((e) => [e.location_id, e.amt]));
      const rows = all(
        `SELECT l.id, l.name AS store, l.kind, COUNT(DISTINCT CASE WHEN s.sgn = 1 THEN s.voucher_id END) AS bills, COALESCE(SUM(s.sgn * s.qty), 0) AS units,
                COALESCE(SUM(s.sgn * s.taxable), 0) AS sales, COALESCE(SUM(s.sgn * s.qty * s.unit_cost), 0) AS cogs, COALESCE(SUM(s.sell_cost), 0) AS sell
         FROM locations l LEFT JOIN v_sale_lines s ON s.location_id = l.id AND s.date BETWEEN ? AND ? ${p.channel ? 'AND s.channel = ?' : ''}
         GROUP BY l.id ORDER BY sales DESC`, ...args,
      ).filter((r) => r.kind === 'store' || r.bills > 0 || exp.get(r.id)).map((r) => {
        const gross = r.sales - Math.round(r.cogs);
        const expenses = exp.get(r.id) ?? 0;
        return { store: r.store, bills: r.bills, units: r.units, sales: r.sales, avg: r.bills ? Math.round(r.sales / r.bills) : 0, gross, sell: Math.round(r.sell), expenses, net: gross - Math.round(r.sell) - expenses };
      });
      if (exp.get(null)) rows.push({ store: 'Common (not tied to a store)', bills: 0, units: 0, sales: 0, avg: 0, gross: 0, sell: 0, expenses: exp.get(null), net: -exp.get(null) });
      const t = sumOf(rows, ['bills', 'units', 'sales', 'gross', 'sell', 'expenses', 'net']);
      for (const r of rows) (r as any).share = pct(r.sales, t.sales);
      return {
        columns: [col('store', 'Store'), col('bills', 'Bills', 'num'), col('units', 'Units', 'num'), col('sales', 'Net sales', 'money'), col('share', 'Share %', 'pct'), col('avg', 'Avg bill', 'money'),
          col('gross', 'Gross profit', 'money'), col('sell', 'Fees + courier', 'money'), col('expenses', 'Expenses', 'money'), col('net', 'Net profit', 'money')],
        rows, totals: { store: 'Total', ...t, avg: t.bills ? Math.round(t.sales / t.bills) : 0, share: 100 },
      };
    },
  },
  channel_profit: {
    title: 'Channel-wise Sales & Profit', group: 'Sales', filters: ['range', 'store'], ownerOnly: true,
    about: 'Retail, wholesale, marketplace and own online compared: bills, units, sales, cost, marketplace fees, courier cost, contribution and margin %.',
    run(p) {
      const [w, a] = where(p);
      const fees = new Map(all(`SELECT channel, SUM(channel_fee) AS fee, SUM(shipping_cost) AS ship FROM vouchers WHERE ${SALE} AND ${w} GROUP BY channel`, ...a).map((f) => [f.channel, f]));
      const rows = all(`SELECT channel, COUNT(DISTINCT CASE WHEN sgn = 1 THEN voucher_id END) AS bills, SUM(sgn * qty) AS units, SUM(sgn * taxable) AS sales, SUM(sgn * qty * unit_cost) AS cogs
                        FROM v_sale_lines WHERE ${w} GROUP BY channel ORDER BY sales DESC`, ...a).map((r) => {
        const f = fees.get(r.channel) ?? { fee: 0, ship: 0 };
        const cogs = Math.round(r.cogs);
        const contribution = r.sales - cogs - f.fee - f.ship;
        return { channel: CHANNEL_LABEL[r.channel], bills: r.bills, units: r.units, sales: r.sales, cogs, gross: r.sales - cogs, fee: f.fee, ship: f.ship, contribution, margin: pct(contribution, r.sales) };
      });
      const t = sumOf(rows, ['bills', 'units', 'sales', 'cogs', 'gross', 'fee', 'ship', 'contribution']);
      return {
        columns: [col('channel', 'Channel'), col('bills', 'Bills', 'num'), col('units', 'Units', 'num'), col('sales', 'Net sales', 'money'), col('cogs', 'Cost of goods', 'money'), col('gross', 'Gross profit', 'money'),
          col('fee', 'Marketplace fees', 'money'), col('ship', 'Courier cost', 'money'), col('contribution', 'Contribution', 'money'), col('margin', 'Margin %', 'pct')],
        rows, totals: { channel: 'Total', ...t, margin: pct(t.contribution, t.sales) },
      };
    },
  },
  category_sales: {
    title: 'Category & Sub-category Sales', group: 'Sales', filters: ['range', 'store', 'channel'],
    about: 'Sales by category and sub-category (Shirt › Premium, Pant › Jeans …): units, sales, share of total and profit.',
    run(p) {
      const [w, a] = where(p, 's.', { channel: true });
      const rows = all(`SELECT vv.cat, vv.subcat, SUM(s.sgn * s.qty) AS units, SUM(s.sgn * s.taxable) AS sales, SUM(s.sgn * s.qty * s.unit_cost) AS cogs
                        FROM v_sale_lines s JOIN v_variant vv ON vv.variant_id = s.variant_id WHERE ${w} GROUP BY vv.cat, vv.subcat ORDER BY sales DESC`, ...a)
        .map((r) => ({ cat: r.cat, subcat: r.subcat, units: r.units, sales: r.sales, profit: r.sales - Math.round(r.cogs), margin: pct(r.sales - r.cogs, r.sales) }));
      const t = sumOf(rows, ['units', 'sales', 'profit']);
      for (const r of rows) (r as any).share = pct(r.sales, t.sales);
      return {
        columns: [col('cat', 'Category'), col('subcat', 'Sub-category'), col('units', 'Units', 'num'), col('sales', 'Net sales', 'money'), col('share', 'Share %', 'pct'),
          ...(p.owner ? [col('profit', 'Gross profit', 'money'), col('margin', 'Margin %', 'pct')] : [])],
        rows, totals: { cat: 'Total', ...t, share: 100, margin: pct(t.profit, t.sales) },
      };
    },
  },
  size_colour: {
    title: 'Size & Colour Sales', group: 'Sales', filters: ['range', 'store', 'channel'],
    about: 'Which sizes and colours sell in each category, with units sold, sales and stock on hand now. Use it to decide the size mix of the next order.',
    run(p) {
      const [w, a] = where(p, 's.', { channel: true });
      const key = (r: any) => `${r.cat}|${r.size}|${r.colour}`;
      const rows = new Map<string, Record<string, any>>();
      for (const r of all(`SELECT vv.cat, vv.size, vv.colour, SUM(s.sgn * s.qty) AS units, SUM(s.sgn * s.taxable) AS sales
                           FROM v_sale_lines s JOIN v_variant vv ON vv.variant_id = s.variant_id WHERE ${w} GROUP BY vv.cat, vv.size, vv.colour`, ...a)) rows.set(key(r), { ...r, stock: 0 });
      for (const r of all(`SELECT vv.cat, vv.size, vv.colour, SUM(k.qty) AS stock FROM v_stock k JOIN v_variant vv ON vv.variant_id = k.variant_id
                           WHERE vv.kind = 'finished' AND (? IS NULL OR k.location_id = ?) GROUP BY vv.cat, vv.size, vv.colour`, p.store, p.store)) {
        const row = rows.get(key(r));
        if (row) row.stock = r.stock;
        else if (r.stock > 0) rows.set(key(r), { ...r, units: 0, sales: 0 });
      }
      const list = [...rows.values()].sort((x, y) => x.cat.localeCompare(y.cat) || y.units - x.units);
      return {
        columns: [col('cat', 'Category'), col('size', 'Size'), col('colour', 'Colour'), col('units', 'Units sold', 'num'), col('sales', 'Net sales', 'money'), col('stock', 'Stock now', 'num')],
        rows: list, totals: { cat: 'Total', ...sumOf(list, ['units', 'sales', 'stock']) },
      };
    },
  },
  movers: {
    title: 'Best Sellers & Slow Movers', group: 'Sales', filters: ['range', 'store', 'channel'],
    about: 'Every item ranked by units sold, with stock on hand, days of stock left and a status: Best seller, Reorder soon, Slow or Not selling.',
    run(p) {
      const [w, a] = where(p, 's.', { channel: true });
      const days = daysBetween(p.from, p.to) + 1;
      const rows = all(
        `SELECT i.item_id, i.item, i.cat, i.subcat, COALESCE(s.units, 0) AS units, COALESCE(s.sales, 0) AS sales, COALESCE(k.stock, 0) AS stock
         FROM (SELECT DISTINCT item_id, item, cat, subcat FROM v_variant WHERE kind = 'finished' AND i_active = 1) i
         LEFT JOIN (SELECT vv.item_id, SUM(s.sgn * s.qty) AS units, SUM(s.sgn * s.taxable) AS sales FROM v_sale_lines s JOIN v_variant vv ON vv.variant_id = s.variant_id WHERE ${w} GROUP BY vv.item_id) s ON s.item_id = i.item_id
         LEFT JOIN (SELECT vv.item_id, SUM(k.qty) AS stock FROM v_stock k JOIN v_variant vv ON vv.variant_id = k.variant_id WHERE (? IS NULL OR k.location_id = ?) GROUP BY vv.item_id) k ON k.item_id = i.item_id
         ORDER BY units DESC, sales DESC`, ...a, p.store, p.store);
      const best = Math.max(1, Math.ceil(rows.filter((r) => r.units > 0).length * 0.2));
      const list = rows.map((r, i) => {
        const cover = r.units > 0 ? Math.round(r.stock / (r.units / days)) : null;
        const status = r.units <= 0 ? (r.stock > 0 ? 'Not selling' : 'No stock, no sale') : i < best ? (cover! < 14 ? 'Best seller · reorder' : 'Best seller') : cover! < 14 ? 'Reorder soon' : cover! > 120 ? 'Slow' : 'Steady';
        return { rank: i + 1, item: r.item, cat: [r.cat, r.subcat].filter(Boolean).join(' › '), units: r.units, sales: r.sales, stock: r.stock, cover, status };
      });
      return {
        columns: [col('rank', '#', 'num'), col('item', 'Item'), col('cat', 'Category'), col('units', 'Units sold', 'num'), col('sales', 'Net sales', 'money'), col('stock', 'Stock now', 'num'), col('cover', 'Days of stock', 'num'), col('status', 'Status')],
        rows: list, totals: { item: 'Total', ...sumOf(list, ['units', 'sales', 'stock']) },
      };
    },
  },
  staff_sales: {
    title: 'Staff-wise Sales', group: 'Sales', filters: ['range', 'store'], ownerOnly: true,
    about: 'Sales made by each user: bills, units, net sales and average bill.',
    run(p) {
      const [w, a] = where(p, 's.');
      const rows = all(`SELECT COALESCE(u.name, 'Unknown') AS staff, COUNT(DISTINCT CASE WHEN s.sgn = 1 THEN s.voucher_id END) AS bills, SUM(s.sgn * s.qty) AS units, SUM(s.sgn * s.taxable) AS sales
                        FROM v_sale_lines s LEFT JOIN users u ON u.id = s.user_id WHERE ${w} GROUP BY s.user_id ORDER BY sales DESC`, ...a)
        .map((r) => ({ ...r, avg: r.bills ? Math.round(r.sales / r.bills) : 0 }));
      return { columns: [col('staff', 'Staff'), col('bills', 'Bills', 'num'), col('units', 'Units', 'num'), col('sales', 'Net sales', 'money'), col('avg', 'Avg bill', 'money')], rows, totals: { staff: 'Total', ...sumOf(rows, ['bills', 'units', 'sales']) } };
    },
  },

  // ---------------- Stock ----------------
  stock_summary: {
    title: 'Stock Summary', group: 'Stock', filters: ['store'],
    about: 'Stock on hand right now for every item, size and colour, per location, with cost value and retail value.',
    run(p) {
      const locs = all('SELECT id, name FROM locations WHERE active = 1 AND (? IS NULL OR id = ?) ORDER BY kind, id', p.store, p.store);
      const by = new Map<number, Record<string, number>>();
      for (const s of all('SELECT * FROM v_stock WHERE (? IS NULL OR location_id = ?)', p.store, p.store)) {
        if (!by.has(s.variant_id)) by.set(s.variant_id, {});
        by.get(s.variant_id)![`loc_${s.location_id}`] = +Number(s.qty).toFixed(3);
      }
      const rows = all(`SELECT * FROM v_variant WHERE v_active = 1 AND i_active = 1 ORDER BY kind, cat, subcat, item, variant_id`).flatMap((v) => {
        const q = by.get(v.variant_id) ?? {};
        const total = +Object.values(q).reduce((x, y) => x + y, 0).toFixed(3);
        if (!total) return [];
        return [{ item: v.item, size: v.size, colour: v.colour, sku: v.sku, cat: [v.cat, v.subcat].filter(Boolean).join(' › '), unit: v.unit, ...q, total,
          cost: Math.round(v.avg_cost), value: Math.round(total * v.avg_cost), retail: v.kind === 'finished' ? Math.round(total * v.retail_price) : 0 }];
      });
      const lc = locs.map((l) => col(`loc_${l.id}`, l.name, 'num'));
      return {
        columns: [col('item', 'Item'), col('size', 'Size'), col('colour', 'Colour'), col('sku', 'SKU'), col('cat', 'Category'), col('unit', 'Unit'), ...lc, ...(locs.length > 1 ? [col('total', 'Total', 'num')] : []),
          ...(p.owner ? [col('cost', 'Cost / unit', 'money'), col('value', 'Stock value', 'money')] : []), col('retail', 'Retail value', 'money')],
        rows, totals: { item: 'Total', ...sumOf(rows, [...lc.map((c) => c.key), 'total', 'value', 'retail']) },
      };
    },
  },
  low_stock: {
    title: 'Low Stock', group: 'Stock', filters: ['store'],
    about: 'Items at or below their low-stock level, with how many pieces short.',
    run(p) {
      const rows = all(
        `SELECT vv.item, vv.size, vv.colour, vv.sku, vv.cat, vv.low_stock AS level, COALESCE(SUM(k.qty), 0) AS stock
         FROM v_variant vv LEFT JOIN v_stock k ON k.variant_id = vv.variant_id AND (? IS NULL OR k.location_id = ?)
         WHERE vv.v_active = 1 AND vv.i_active = 1 AND vv.low_stock > 0 GROUP BY vv.variant_id HAVING stock <= vv.low_stock ORDER BY stock - vv.low_stock, vv.item`, p.store, p.store)
        .map((r) => ({ ...r, short: r.level - r.stock }));
      return { columns: [col('item', 'Item'), col('size', 'Size'), col('colour', 'Colour'), col('sku', 'SKU'), col('cat', 'Category'), col('stock', 'Stock now', 'num'), col('level', 'Low-stock level', 'num'), col('short', 'Short by', 'num')], rows };
    },
  },
  stock_ageing: {
    title: 'Stock Ageing (dead stock)', group: 'Stock', filters: ['store'],
    about: 'Finished stock that has been lying unsold: last received date, last sold date, idle days and value. Oldest first.',
    run(p) {
      const t = today();
      const rows = all(
        `SELECT vv.item, vv.size, vv.colour, vv.sku, vv.avg_cost, SUM(m.qty) AS stock,
                MAX(CASE WHEN m.qty > 0 AND m.reason IN ('purchase','production_in','opening','transfer') THEN m.date END) AS last_in,
                (SELECT MAX(date) FROM stock_moves WHERE variant_id = vv.variant_id AND reason = 'sale' AND (? IS NULL OR location_id = ?)) AS last_sale
         FROM stock_moves m JOIN v_variant vv ON vv.variant_id = m.variant_id
         WHERE vv.kind = 'finished' AND (? IS NULL OR m.location_id = ?) GROUP BY vv.variant_id HAVING stock > 0.0005`, p.store, p.store, p.store, p.store)
        .map((r) => {
          const idle = Math.max(0, daysBetween(r.last_sale ?? r.last_in ?? t, t));
          return { item: r.item, size: r.size, colour: r.colour, sku: r.sku, stock: r.stock, last_in: r.last_in, last_sale: r.last_sale, idle,
            age: idle <= 30 ? '0–30 days' : idle <= 60 ? '31–60 days' : idle <= 90 ? '61–90 days' : 'Over 90 days', value: Math.round(r.stock * r.avg_cost) };
        }).sort((x, y) => y.idle - x.idle || y.value - x.value);
      return {
        columns: [col('item', 'Item'), col('size', 'Size'), col('colour', 'Colour'), col('sku', 'SKU'), col('stock', 'Stock', 'num'), col('last_in', 'Last received', 'date'), col('last_sale', 'Last sold', 'date'),
          col('idle', 'Idle days', 'num'), col('age', 'Age'), ...(p.owner ? [col('value', 'Value at cost', 'money')] : [])],
        rows, totals: { item: 'Total', ...sumOf(rows, ['stock', 'value']) },
      };
    },
  },

  // ---------------- Money ----------------
  party_outstanding: {
    title: 'Party Outstanding', group: 'Money', filters: [],
    about: "Who owes the business money (you'll get) and whom the business owes (you'll give): customers, suppliers and job workers.",
    run() {
      const rows = all(`SELECT p.name, p.kind, p.phone, b.balance FROM parties p JOIN v_party_balance b ON b.party_id = p.id WHERE p.active = 1 AND b.balance <> 0 ORDER BY b.balance DESC`)
        .map((r) => ({ name: r.name, kind: { customer: 'Customer', supplier: 'Supplier', jobworker: 'Job worker' }[r.kind as string], phone: r.phone, get: Math.max(r.balance, 0), give: Math.max(-r.balance, 0) }));
      const t = sumOf(rows, ['get', 'give']);
      return { columns: [col('name', 'Party'), col('kind', 'Type'), col('phone', 'Phone'), col('get', "You'll get", 'money'), col('give', "You'll give", 'money')], rows, totals: { name: 'Total', ...t },
        summary: [{ label: "You'll get", value: t.get, type: 'money' }, { label: "You'll give", value: t.give, type: 'money' }] };
    },
  },
  purchase_register: {
    title: 'Purchase Register', group: 'Money', filters: ['range', 'store'],
    about: 'Every purchase bill and purchase return in the period with supplier, total, paid and balance.',
    run: register(['purchase', 'purchase_return']),
  },
  expense_summary: {
    title: 'Expense Summary', group: 'Money', filters: ['range', 'store'], ownerOnly: true,
    about: 'Expenses by head (rent, salary, electricity …) with count, amount and share.',
    run(p) {
      const [w, a] = where(p);
      const rows = all(`SELECT category, COUNT(*) AS entries, SUM(amount) AS amount FROM expenses WHERE ${w} GROUP BY category ORDER BY amount DESC`, ...a);
      const t = sumOf(rows, ['entries', 'amount']);
      for (const r of rows) r.share = pct(r.amount, t.amount);
      return { columns: [col('category', 'Expense head'), col('entries', 'Entries', 'num'), col('amount', 'Amount', 'money'), col('share', 'Share %', 'pct')], rows, totals: { category: 'Total', ...t, share: 100 } };
    },
  },
  cash_bank: {
    title: 'Cash & Bank', group: 'Money', filters: ['range', 'store'], ownerOnly: true,
    about: 'Money in and out by mode (cash, UPI, card, bank): received, paid to parties, expenses, direct production costs and net.',
    run(p) {
      const [w, a] = where(p);
      const pay = all(`SELECT mode, direction, SUM(amount) AS amt FROM payments WHERE ${w} GROUP BY mode, direction`, ...a);
      const exp = all(`SELECT mode, SUM(amount) AS amt FROM expenses WHERE ${w} GROUP BY mode`, ...a);
      // Labour owed to a job worker is paid later through Payment Out; the rest of a cost sheet is paid directly.
      const prod = all(`SELECT pay_mode AS mode, SUM(other_cost + CASE WHEN party_id IS NULL THEN labour_cost ELSE 0 END) AS amt FROM productions
                        WHERE status = 'done' AND done_date BETWEEN ? AND ? AND (? IS NULL OR to_location_id = ?) GROUP BY pay_mode`, p.from, p.to, p.store, p.store);
      const rows = PAY_MODES.map((m) => {
        const pick = (list: any[], f: (r: any) => boolean = () => true) => list.find((r) => r.mode === m && f(r))?.amt ?? 0;
        const r = { mode: m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1), received: pick(pay, (x) => x.direction === 'in'), paid: pick(pay, (x) => x.direction === 'out'), expenses: pick(exp), production: pick(prod) };
        return { ...r, net: r.received - r.paid - r.expenses - r.production };
      });
      return { columns: [col('mode', 'Mode'), col('received', 'Received', 'money'), col('paid', 'Paid to parties', 'money'), col('expenses', 'Expenses', 'money'), col('production', 'Production costs', 'money'), col('net', 'Net', 'money')],
        rows, totals: { mode: 'Total', ...sumOf(rows, ['received', 'paid', 'expenses', 'production', 'net']) } };
    },
  },
  day_book: {
    title: 'Day Book', group: 'Money', filters: ['range', 'store'], ownerOnly: true,
    about: 'Everything recorded in the period in date order: bills, payments, expenses and production cost sheets.',
    run(p) {
      const [vw, va] = where(p, 'v.');
      const [pw, pa] = where(p, 'pm.');
      const [ew, ea] = where(p, 'e.');
      const rows: Record<string, any>[] = [
        ...all(`SELECT v.date, v.created_at, v.type, v.number AS ref, COALESCE(pa.name, NULLIF(v.party_name, ''), 'Walk-in') AS details, v.total AS amount, u.name AS by
                FROM vouchers v LEFT JOIN parties pa ON pa.id = v.party_id LEFT JOIN users u ON u.id = v.user_id WHERE v.status = 'final' AND ${vw}`, ...va).map((r) => ({ ...r, type: TYPE_LABEL[r.type] })),
        ...all(`SELECT pm.date, pm.created_at, pm.direction, COALESCE(v.number, '') AS ref, COALESCE(pa.name, 'Walk-in') || ' · ' || pm.mode AS details, pm.amount, u.name AS by
                FROM payments pm LEFT JOIN vouchers v ON v.id = pm.voucher_id LEFT JOIN parties pa ON pa.id = pm.party_id LEFT JOIN users u ON u.id = pm.user_id WHERE ${pw}`, ...pa)
          .map((r) => ({ ...r, type: r.direction === 'in' ? 'Payment In' : 'Payment Out' })),
        ...all(`SELECT e.date, e.created_at, 'Expense' AS type, '' AS ref, e.category || CASE WHEN e.note <> '' THEN ' · ' || e.note ELSE '' END AS details, e.amount, u.name AS by
                FROM expenses e LEFT JOIN users u ON u.id = e.user_id WHERE ${ew}`, ...ea),
        ...all(`SELECT pr.done_date AS date, pr.created_at, 'Production' AS type, pr.number AS ref, COALESCE(pa.name, 'In-house') AS details, pr.total_cost AS amount, u.name AS by
                FROM productions pr LEFT JOIN parties pa ON pa.id = pr.party_id LEFT JOIN users u ON u.id = pr.user_id
                WHERE pr.status = 'done' AND pr.done_date BETWEEN ? AND ? AND (? IS NULL OR pr.to_location_id = ?)`, p.from, p.to, p.store, p.store),
      ].sort((x: any, y: any) => x.date.localeCompare(y.date) || String(x.created_at).localeCompare(String(y.created_at)));
      return { columns: [col('date', 'Date', 'date'), col('type', 'Type'), col('ref', 'Ref no.'), col('details', 'Details'), col('amount', 'Amount', 'money'), col('by', 'Entered by')], rows };
    },
  },
  party_statement: {
    title: 'Party Statement', group: 'Money', filters: ['range', 'party'], hidden: true,
    about: 'All bills and payments of one party with a running balance.',
    run(p) {
      const party = p.party ? get('SELECT * FROM parties WHERE id = ?', p.party) : null;
      if (!party) throw new HttpError(400, 'Pick a party');
      // amount > 0 raises what the party owes the business; amount < 0 lowers it.
      const events: Record<string, any>[] = [
        ...all(`SELECT date, created_at, type, number AS ref, total FROM vouchers WHERE party_id = ? AND status = 'final'`, party.id)
          .map((v) => ({ ...v, type: TYPE_LABEL[v.type], amount: v.type === 'sale' || v.type === 'purchase_return' ? v.total : -v.total })),
        ...all(`SELECT pm.date, pm.created_at, pm.direction, pm.amount AS amt, pm.mode, v.number FROM payments pm LEFT JOIN vouchers v ON v.id = pm.voucher_id WHERE pm.party_id = ?`, party.id)
          .map((m) => ({ date: m.date, created_at: m.created_at, type: m.direction === 'in' ? 'Payment received' : 'Payment made', ref: [m.mode, m.number].filter(Boolean).join(' · '), amount: m.direction === 'in' ? -m.amt : m.amt })),
        ...all(`SELECT done_date AS date, created_at, number AS ref, labour_cost FROM productions WHERE party_id = ? AND status = 'done'`, party.id)
          .map((j) => ({ ...j, type: 'Job work charges', amount: -j.labour_cost })),
      ].sort((x: any, y: any) => x.date.localeCompare(y.date) || String(x.created_at).localeCompare(String(y.created_at)));
      let bal = party.opening_balance;
      for (const e of events) if (e.date < p.from) bal += e.amount;
      const rows: Record<string, any>[] = [{ date: p.from, type: 'Opening balance', ref: '', plus: 0, minus: 0, balance: bal, _bold: true }];
      for (const e of events) {
        if (e.date < p.from || e.date > p.to) continue;
        bal += e.amount;
        rows.push({ date: e.date, type: e.type, ref: e.ref, plus: Math.max(e.amount, 0), minus: Math.max(-e.amount, 0), balance: bal });
      }
      return {
        columns: [col('date', 'Date', 'date'), col('type', 'Entry'), col('ref', 'Ref'), col('plus', 'Billed / paid out (+)', 'money'), col('minus', 'Received / owed (−)', 'money'), col('balance', 'Balance', 'money')],
        rows, totals: { date: 'Closing', ...sumOf(rows, ['plus', 'minus']), balance: bal },
        summary: [{ label: party.name, value: bal >= 0 ? "You'll get" : "You'll give", type: 'text' }, { label: 'Closing balance', value: Math.abs(bal), type: 'money' }],
      };
    },
  },

  // ---------------- Profit ----------------
  pnl: {
    title: 'Profit & Loss', group: 'Profit', filters: ['range', 'store'], ownerOnly: true,
    about: 'Net profit for the period: sales, returns, cost of goods sold, gross profit, marketplace fees, courier cost, each expense head, stock write-offs and net profit.',
    run(p) {
      const x = pnl(p);
      const line = (particular: string, amount: number, bold = false) => ({ particular, amount, ...(bold ? { _bold: true } : {}) });
      return {
        columns: [col('particular', 'Particulars'), col('amount', 'Amount', 'money')],
        rows: [
          line('Sales', x.sales), line('Less: sales returns', -x.returns), line('Courier and other charges billed', x.charges), line('Net revenue', x.revenue, true),
          line('Less: cost of goods sold', -x.cogs), line('Gross profit', x.gross, true),
          line('Less: marketplace fees', -x.fee), line('Less: courier cost paid', -x.ship),
          ...x.exp.map((e) => line(`Less: ${e.category}`, -e.amt)), line('Less: stock write-offs', -x.loss), line('Net profit', x.net, true),
        ].filter((r) => r._bold || r.amount !== 0 || r.particular === 'Sales'),
        summary: [{ label: 'Net revenue', value: x.revenue, type: 'money' }, { label: 'Gross margin', value: pct(x.gross, x.revenue), type: 'pct' },
          { label: 'Net profit', value: x.net, type: 'money' }, { label: 'Net margin', value: pct(x.net, x.revenue), type: 'pct' }],
      };
    },
  },
  unit_economics: {
    title: 'Unit Economics', group: 'Profit', filters: ['range', 'store', 'channel'], ownerOnly: true,
    about: 'Per piece, for every item: selling price, cost, gross margin, selling cost (fees + courier), contribution, share of overheads and net profit per unit, plus break-even units.',
    run(p) {
      const [w, a] = where(p, 's.', { channel: true });
      const [ew, ea] = where(p);
      const expenses = Number(get(`SELECT COALESCE(SUM(amount), 0) AS x FROM expenses WHERE ${ew}`, ...ea)!.x);
      const raw = all(`SELECT vv.item, vv.cat, vv.subcat, SUM(s.sgn * s.qty) AS units, SUM(s.sgn * s.taxable) AS sales, SUM(s.sgn * s.qty * s.unit_cost) AS cogs, SUM(s.sell_cost) AS sell
                       FROM v_sale_lines s JOIN v_variant vv ON vv.variant_id = s.variant_id WHERE ${w} GROUP BY vv.item_id HAVING units > 0 ORDER BY sales DESC`, ...a);
      const T = sumOf(raw, ['units', 'sales', 'cogs', 'sell']);
      // Overheads are shared between items by their share of revenue.
      const per = (r: any) => {
        const u = r.units || 1;
        const overhead = T.sales ? (expenses * r.sales) / T.sales : 0;
        const net = r.sales - r.cogs - r.sell - overhead;
        return { units: r.units, price: Math.round(r.sales / u), cost: Math.round(r.cogs / u), gross: Math.round((r.sales - r.cogs) / u), sell: Math.round(r.sell / u),
          contribution: Math.round((r.sales - r.cogs - r.sell) / u), overhead: Math.round(overhead / u), net: Math.round(net / u), margin: pct(net, r.sales), net_total: Math.round(net) };
      };
      const rows = raw.map((r) => ({ item: r.item, cat: [r.cat, r.subcat].filter(Boolean).join(' › '), ...per(r) }));
      const tot = per(T);
      const days = daysBetween(p.from, p.to) + 1;
      const breakEven = tot.contribution > 0 ? Math.ceil(expenses / tot.contribution) : 0;
      return {
        columns: [col('item', 'Item'), col('cat', 'Category'), col('units', 'Units', 'num'), col('price', 'Price / unit', 'money'), col('cost', 'Cost / unit', 'money'), col('gross', 'Gross margin / unit', 'money'),
          col('sell', 'Selling cost / unit', 'money'), col('contribution', 'Contribution / unit', 'money'), col('overhead', 'Overhead / unit', 'money'), col('net', 'Net profit / unit', 'money'), col('margin', 'Net margin %', 'pct'), col('net_total', 'Net profit', 'money')],
        rows, totals: { item: 'All items', ...tot },
        summary: [{ label: 'Units sold', value: T.units, type: 'num' }, { label: 'Avg contribution / unit', value: tot.contribution, type: 'money' }, { label: 'Overheads in period', value: expenses, type: 'money' },
          { label: 'Break-even units (period)', value: breakEven, type: 'num' }, { label: 'Break-even units / month', value: Math.ceil((breakEven * 30) / days), type: 'num' }],
      };
    },
  },
  costing: {
    title: 'Costing (cost per piece)', group: 'Profit', filters: [], ownerOnly: true,
    about: 'Cost per piece of every finished item, whether purchased or manufactured, the split into raw material / labour / factory other costs, and the margin at retail and wholesale price.',
    run() {
      // ponytail: two small queries per item. Fine for a few hundred items; batch them if the catalogue grows past thousands.
      const rows = all(`SELECT item_id, item, cat, subcat, AVG(CASE WHEN avg_cost > 0 THEN avg_cost END) AS cost, AVG(retail_price) AS retail, AVG(NULLIF(wholesale_price, 0)) AS wholesale
                        FROM v_variant WHERE kind = 'finished' AND i_active = 1 AND v_active = 1 GROUP BY item_id ORDER BY cat, subcat, item`).map((i) => {
        const src = get(`SELECT m.reason FROM stock_moves m JOIN variants va ON va.id = m.variant_id WHERE va.item_id = ? AND m.reason IN ('purchase','production_in') ORDER BY m.date DESC, m.id DESC LIMIT 1`, i.item_id);
        const pr = get(`SELECT p.material_cost, p.labour_cost, p.other_cost, (SELECT SUM(qty) FROM production_outputs WHERE production_id = p.id) AS pieces FROM productions p
                        WHERE p.status = 'done' AND EXISTS (SELECT 1 FROM production_outputs o JOIN variants va ON va.id = o.variant_id WHERE o.production_id = p.id AND va.item_id = ?)
                        ORDER BY p.done_date DESC, p.id DESC LIMIT 1`, i.item_id);
        const cost = Math.round(i.cost ?? 0);
        const split = (x: number) => (pr?.pieces ? Math.round(x / pr.pieces) : null);
        return { item: i.item, cat: [i.cat, i.subcat].filter(Boolean).join(' › '), source: src ? (src.reason === 'purchase' ? 'Purchased' : 'Manufactured') : 'No stock yet',
          material: split(pr?.material_cost), labour: split(pr?.labour_cost), other: split(pr?.other_cost), cost,
          retail: Math.round(i.retail ?? 0), retail_margin: cost ? pct(i.retail - cost, i.retail) : null, wholesale: Math.round(i.wholesale ?? 0), wholesale_margin: cost && i.wholesale ? pct(i.wholesale - cost, i.wholesale) : null };
      });
      return { columns: [col('item', 'Item'), col('cat', 'Category'), col('source', 'Source'), col('material', 'Raw material / pc', 'money'), col('labour', 'Labour / pc', 'money'), col('other', 'Factory other / pc', 'money'),
        col('cost', 'Cost / pc', 'money'), col('retail', 'Retail price', 'money'), col('retail_margin', 'Retail margin %', 'pct'), col('wholesale', 'Wholesale price', 'money'), col('wholesale_margin', 'Wholesale margin %', 'pct')], rows };
    },
  },
  gst_summary: {
    title: 'GST Summary', group: 'Money', filters: ['range', 'store'], ownerOnly: true, hidden: true,
    about: 'Taxable value and GST by rate for sales and purchases.',
    run(p) {
      const [w, a] = where(p, 'v.');
      const rows = all(`SELECT v.type, l.gst_rate AS rate, SUM(l.taxable) AS taxable, SUM(CASE WHEN v.inter_state = 1 THEN 0 ELSE l.tax END) AS intra, SUM(CASE WHEN v.inter_state = 1 THEN l.tax ELSE 0 END) AS igst
                        FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.status = 'final' AND ${w} GROUP BY v.type, l.gst_rate ORDER BY v.type, l.gst_rate`, ...a)
        .map((r) => ({ type: TYPE_LABEL[r.type], rate: r.rate, taxable: r.taxable, cgst: Math.round(r.intra / 2), sgst: r.intra - Math.round(r.intra / 2), igst: r.igst, tax: r.intra + r.igst }));
      return { columns: [col('type', 'Type'), col('rate', 'GST %', 'pct'), col('taxable', 'Taxable value', 'money'), col('cgst', 'CGST', 'money'), col('sgst', 'SGST', 'money'), col('igst', 'IGST', 'money'), col('tax', 'Total GST', 'money')], rows };
    },
  },
};

const allowed = (name: string, d: Def, owner: boolean) => (!d.ownerOnly || owner) && (name !== 'gst_summary' || billing().gstEnabled);

export function runReport(name: string, q: Record<string, any>, user: User): ReportResult {
  const def = Object.hasOwn(REPORTS, name) ? REPORTS[name] : undefined;
  const owner = user.role === 'owner';
  if (!def || !allowed(name, def, owner)) throw new HttpError(404, 'Report not found');
  const t = today();
  const p: Params = {
    from: date(q.from || `${t.slice(0, 8)}01`, 'From'), to: date(q.to || t, 'To'),
    store: !owner && user.location_id ? user.location_id : optId(q.store, 'Store'),
    channel: q.channel ? oneOf(q.channel, CHANNELS, 'Channel') : null,
    party: optId(q.party, 'Party'), owner,
  };
  if (p.from > p.to) bad('The From date is after the To date');
  const bits = [def.filters.includes('range') ? `${fmtDate(p.from)} to ${fmtDate(p.to)}` : `As of ${fmtDate(t)}`];
  if (p.store && def.filters.includes('store')) bits.push(get('SELECT name FROM locations WHERE id = ?', p.store)?.name ?? '');
  if (p.channel && def.filters.includes('channel')) bits.push(CHANNEL_LABEL[p.channel]);
  return { name, title: def.title, subtitle: bits.filter(Boolean).join(' · '), ...def.run(p) };
}

export function dashboard(user: User, storeParam: number | null) {
  const owner = user.role === 'owner';
  const store = !owner && user.location_id ? user.location_id : storeParam;
  const t = today();
  const tot = (from: string, to: string) => get(
    `SELECT COUNT(CASE WHEN type = 'sale' THEN 1 END) AS bills, COALESCE(SUM(CASE WHEN type = 'sale' THEN total ELSE -total END), 0) AS sales
     FROM vouchers WHERE ${SALE} AND date BETWEEN ? AND ? AND (? IS NULL OR location_id = ?)`, from, to, store, store)!;
  const d30 = addDays(t, -29);
  const p30: Params = { from: d30, to: t, store, channel: null, party: null, owner };
  const [w, a] = where(p30, 's.');
  const trendMap = new Map(all(`SELECT date, SUM(CASE WHEN type = 'sale' THEN total ELSE -total END) AS sales FROM vouchers WHERE ${SALE} AND date BETWEEN ? AND ? AND (? IS NULL OR location_id = ?) GROUP BY date`, addDays(t, -13), t, store, store).map((r) => [r.date, r.sales]));
  const bal = get(`SELECT COALESCE(SUM(CASE WHEN b.balance > 0 THEN b.balance END), 0) AS receivable, COALESCE(SUM(CASE WHEN b.balance < 0 THEN -b.balance END), 0) AS payable FROM v_party_balance b JOIN parties p ON p.id = b.party_id WHERE p.active = 1`)!;
  const stock = get(`SELECT COALESCE(SUM(k.qty), 0) AS units, COALESCE(SUM(k.qty * vv.avg_cost), 0) AS value FROM v_stock k JOIN v_variant vv ON vv.variant_id = k.variant_id WHERE vv.kind = 'finished' AND (? IS NULL OR k.location_id = ?)`, store, store)!;
  const low = REPORTS.low_stock.run({ ...p30 }).rows;
  return {
    today: tot(t, t), yesterday: tot(addDays(t, -1), addDays(t, -1)), month: tot(`${t.slice(0, 8)}01`, t),
    monthProfit: owner ? pnl({ ...p30, from: `${t.slice(0, 8)}01` }).net : null,
    receivable: bal.receivable, payable: bal.payable,
    stockUnits: stock.units, stockValue: owner ? Math.round(stock.value) : null,
    lowStock: low.slice(0, 6), lowStockCount: low.length,
    trend: Array.from({ length: 14 }, (_, i) => addDays(t, i - 13)).map((d) => ({ date: d, sales: trendMap.get(d) ?? 0 })),
    topItems: all(`SELECT vv.item, SUM(s.sgn * s.qty) AS units, SUM(s.sgn * s.taxable) AS sales FROM v_sale_lines s JOIN v_variant vv ON vv.variant_id = s.variant_id WHERE ${w} GROUP BY vv.item_id ORDER BY units DESC LIMIT 5`, ...a),
    channels: all(`SELECT s.channel, SUM(s.sgn * s.taxable) AS sales FROM v_sale_lines s WHERE ${w} GROUP BY s.channel ORDER BY sales DESC`, ...a).map((c) => ({ ...c, label: CHANNEL_LABEL[c.channel] })),
    stores: owner && !store ? all(`SELECT l.name, COALESCE(SUM(s.sgn * s.taxable), 0) AS sales FROM locations l LEFT JOIN v_sale_lines s ON s.location_id = l.id AND s.date BETWEEN ? AND ? WHERE l.active = 1 GROUP BY l.id HAVING l.kind = 'store' OR sales > 0 ORDER BY sales DESC`, d30, t) : [],
    recent: all(`SELECT v.id, v.number, v.date, v.total, v.channel, COALESCE(p.name, NULLIF(v.party_name, ''), 'Walk-in') AS party FROM vouchers v LEFT JOIN parties p ON p.id = v.party_id
                 WHERE v.status = 'final' AND v.type = 'sale' AND (? IS NULL OR v.location_id = ?) ORDER BY v.date DESC, v.id DESC LIMIT 6`, store, store),
  };
}

export const reportRoutes = Router();

reportRoutes.get('/dashboard', (req, res) => res.json(dashboard(req.user, optId(req.query.store, 'Store'))));

reportRoutes.get('/reports', (req, res) => {
  const owner = req.user.role === 'owner';
  res.json(Object.entries(REPORTS).filter(([n, d]) => allowed(n, d, owner) && (!d.hidden || n === 'gst_summary'))
    .map(([name, d]) => ({ name, title: d.title, group: d.group, about: d.about, filters: d.filters })));
});

reportRoutes.get('/reports/:name', async (req, res) => {
  const r = runReport(req.params.name, req.query, req.user);
  const format = String(req.query.format ?? 'json');
  if (format === 'json') return void res.json(r);
  const file = `${r.title} ${r.subtitle}`.replace(/[^\w\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (format === 'xlsx') {
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`${file}.xlsx`).send(await toXlsx(r, business()));
  } else if (format === 'docx') {
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').attachment(`${file}.docx`).send(await toDocx(r, business()));
  } else bad('Unknown format');
});
