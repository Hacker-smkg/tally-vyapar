// One end-to-end check with hand-worked numbers:
// buy (with freight) → manufacture → transfer → sell on 4 channels → return → expense → write-off
// then stock per location, cost per piece, party balances, net profit, exports and the AI pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.DB_PATH = ':memory:';
const { all, get, run, tx, seedBasics, setSetting } = await import('./db.ts');
const { saveItem, saveParty, addExpense } = await import('./masters.ts');
const { createVoucher, cancelVoucher, addPayment } = await import('./vouchers.ts');
const { createProduction, transferStock, adjustStock, onHand } = await import('./stock.ts');
const { runReport, dashboard } = await import('./reports.ts');
const { toXlsx, toDocx } = await import('./export.ts');
const { askAI, looseJson, salvageList } = await import('./ai.ts');
const { today } = await import('../shared/calc.ts');

const R = (rupees: number) => Math.round(rupees * 100);
const d = today();
tx(seedBasics);
run(`INSERT INTO users(name, username, pass_hash, role) VALUES('Owner', 'owner', 'x', 'owner')`);
const user = { id: 1, name: 'Owner', username: 'owner', role: 'owner' as const, location_id: null };
const godown = get(`SELECT id FROM locations WHERE kind = 'godown'`)!.id;
const store = get(`SELECT id FROM locations WHERE kind = 'store'`)!.id;

const supplier = saveParty({ name: 'Fabric Mill', kind: 'supplier' });
const tailor = saveParty({ name: 'Tailor', kind: 'jobworker' });
const buyer = saveParty({ name: 'Wholesale Buyer', kind: 'customer', phone: '9876543210' });
const market = saveParty({ name: 'Marketplace', kind: 'customer' });

const variantsOf = (item: number) => Object.fromEntries(all('SELECT id, size FROM variants WHERE item_id = ?', item).map((v) => [v.size || 'one', v.id]));
const fabric = variantsOf(saveItem({ name: 'Fabric', kind: 'raw', unit: 'mtr', variants: [{}] }, user)).one;
const offer = variantsOf(saveItem({ name: 'Offer Shirt', kind: 'finished', variants: [{ size: 'M', retail_price: R(500), wholesale_price: R(350) }, { size: 'L', retail_price: R(500), wholesale_price: R(350) }] }, user));
const premium = variantsOf(saveItem({ name: 'Premium Shirt', kind: 'finished', variants: [{ size: 'L', retail_price: R(1500), wholesale_price: R(1000) }] }, user)).L;
const cost = (v: number) => Number(get('SELECT avg_cost FROM variants WHERE id = ?', v)!.avg_cost);
const balance = (p: number) => Number(get('SELECT balance FROM v_party_balance WHERE party_id = ?', p)!.balance);
const sale = (b: any) => createVoucher({ type: 'sale', date: d, ...b }, user);
let retailBill = 0;

test('purchase: freight is shared into cost per unit', () => {
  // fabric 100 m @ ₹100 + premium shirts 10 @ ₹700 + ₹340 freight = ₹17,340; ₹5,000 paid
  createVoucher({ type: 'purchase', date: d, party_id: supplier, location_id: godown, extra_charge: R(340), paid: R(5000),
    lines: [{ variant_id: fabric, qty: 100, rate: R(100) }, { variant_id: premium, qty: 10, rate: R(700) }] }, user);
  assert.equal(cost(fabric), R(102)); // (10,000 + 200) / 100
  assert.equal(cost(premium), R(714)); // (7,000 + 140) / 10
  assert.equal(balance(supplier), -R(12340));
});

test('manufacturing: raw material + labour + other costs ÷ pieces', () => {
  // 60 m fabric (₹6,120) + labour ₹2,000 + other ₹480 = ₹8,600 → 40 shirts → ₹215 each
  createProduction({ date: d, from_location_id: godown, to_location_id: godown, party_id: tailor, labour_cost: R(2000), other_cost: R(480), complete: true,
    inputs: [{ variant_id: fabric, qty: 60 }], outputs: [{ variant_id: offer.M, qty: 20 }, { variant_id: offer.L, qty: 20 }] }, user);
  assert.equal(cost(offer.M), R(215));
  assert.equal(onHand(fabric, godown), 40);
  assert.equal(balance(tailor), -R(2000), 'labour is owed to the job worker');
});

test('transfer, then sales on all four channels, a return, an expense and a write-off', () => {
  transferStock({ date: d, from: godown, to: store, lines: [{ variant_id: offer.M, qty: 10 }, { variant_id: offer.L, qty: 10 }, { variant_id: premium, qty: 4 }] }, user);

  // a) retail walk-in: 2 offer @ ₹500 less 10% + 1 premium @ ₹1,500, ₹100 off the bill = ₹2,300 cash
  const a = sale({ location_id: store, channel: 'retail', bill_discount: R(100), paid: R(2300),
    lines: [{ variant_id: offer.M, qty: 2, rate: R(500), disc_pct: 10 }, { variant_id: premium, qty: 1, rate: R(1500) }] });
  retailBill = a.id;
  assert.equal(get('SELECT total FROM vouchers WHERE id = ?', a.id)!.total, R(2300));
  // b) wholesale on credit: 10 offer @ ₹350 = ₹3,500, ₹1,000 paid
  sale({ party_id: buyer, location_id: godown, channel: 'wholesale', paid: R(1000), pay_mode: 'upi', lines: [{ variant_id: offer.L, qty: 10, rate: R(350) }] });
  // c) marketplace: 1 premium @ ₹1,500, fee ₹270, courier ₹65, settled later
  sale({ party_id: market, location_id: godown, channel: 'marketplace', paid: 0, channel_fee: R(270), shipping_cost: R(65), lines: [{ variant_id: premium, qty: 1, rate: R(1500) }] });
  // d) own online order: 1 offer @ ₹500 + ₹60 courier billed, courier cost ₹55
  const dd = sale({ location_id: godown, channel: 'online', extra_charge: R(60), paid: R(560), pay_mode: 'upi', shipping_cost: R(55), lines: [{ variant_id: offer.M, qty: 1, rate: R(500) }] });
  assert.deepEqual([a.number, dd.number], ['INV-0001', 'INV-0004'], 'bill numbers run in order');
  // the marketplace order comes back
  createVoucher({ type: 'sale_return', date: d, party_id: market, location_id: godown, channel: 'marketplace', paid: 0, shipping_cost: R(65), lines: [{ variant_id: premium, qty: 1, rate: R(1500) }] }, user);
  addExpense({ date: d, category: 'Rent', amount: R(1000), location_id: store }, user);
  adjustStock({ date: d, location_id: store, variant_id: offer.L, qty: -1, note: 'Damaged' }, user);

  assert.deepEqual([onHand(offer.M, godown), onHand(offer.M, store)], [9, 8]);
  assert.deepEqual([onHand(offer.L, godown), onHand(offer.L, store)], [0, 9]);
  assert.deepEqual([onHand(premium, godown), onHand(premium, store)], [6, 3]);
  assert.deepEqual([balance(buyer), balance(market)], [R(2500), 0]);
});

test('guards: no overselling, no unpaid walk-in bill, no overpaying', () => {
  assert.throws(() => sale({ location_id: store, paid: R(150000), lines: [{ variant_id: premium, qty: 100, rate: R(1500) }] }), /Not enough stock/);
  assert.throws(() => sale({ location_id: store, paid: 0, lines: [{ variant_id: premium, qty: 1, rate: R(1500) }] }), /paid in full/);
  assert.throws(() => addPayment({ date: d, voucher_id: retailBill, amount: R(10) }, user), /more than the balance/);
  assert.equal(onHand(premium, store), 3, 'failed bills leave no trace');
  assert.equal(get(`SELECT COUNT(*) n FROM vouchers WHERE type = 'sale'`)!.n, 4);
});

const range = { from: d, to: d };
const amount = (rows: any[], label: string) => rows.find((r) => r.particular === label)?.amount;

test('reports: net profit, daily sales, unit economics, costing', () => {
  const pnl = runReport('pnl', range, user).rows;
  assert.equal(amount(pnl, 'Sales'), R(7800)); // 2,300 + 3,500 + 1,500 + 500
  assert.equal(amount(pnl, 'Net revenue'), R(6360)); // − 1,500 returned + 60 courier billed
  assert.equal(amount(pnl, 'Less: cost of goods sold'), -R(3509)); // 1,144 + 2,150 + 714 + 215 − 714
  assert.equal(amount(pnl, 'Gross profit'), R(2851));
  assert.equal(amount(pnl, 'Net profit'), R(1181)); // − 270 fee − 185 courier − 1,000 rent − 215 write-off

  const day = runReport('daily_sales', range, user).rows[0];
  assert.deepEqual([day.bills, day.sales, day.returns, day.net, day.cash, day.upi], [4, R(7860), R(1500), R(6360), R(2300), R(1560)]);

  const ue = runReport('unit_economics', range, user);
  assert.equal(ue.totals!.units, 14);
  assert.ok(Math.abs(ue.rows.reduce((t, r) => t + r.net_total, 0) - R(1336)) <= 100, 'item profits add up'); // 6,300 − 3,509 − 455 − 1,000

  const costing = runReport('costing', range, user).rows;
  const made = costing.find((r) => r.item === 'Offer Shirt')!;
  assert.deepEqual([made.source, made.material, made.labour, made.other, made.cost], ['Manufactured', R(153), R(50), R(12), R(215)]);
  assert.equal(costing.find((r) => r.item === 'Premium Shirt')!.source, 'Purchased');

  const stores = runReport('store_comparison', range, user).rows;
  assert.equal(stores.find((r) => r.store === 'Store 1')!.net, R(2300) - R(1144) - R(1000));
  assert.equal(dashboard(user, null).monthProfit, R(1181));
  assert.throws(() => runReport('pnl', range, { ...user, role: 'staff' }), /not found/, 'staff cannot open profit reports');
});

test('exports produce real Excel and Word files', async () => {
  const r = runReport('sales_register', range, user);
  const brand = { name: 'Test Shop', brandColor: '#4f46e5' };
  for (const buf of [await toXlsx(r, brand), await toDocx(r, brand)]) {
    assert.equal(buf.subarray(0, 2).toString(), 'PK');
    assert.ok(buf.length > 2000);
  }
});

test('AI: the model picks reports, the server fetches them, phone numbers never leave', async () => {
  assert.deepEqual(looseJson('<think>hmm</think>```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(looseJson('{"findings":["Cash ₹1,97,668 was the largest mode.\u201D,"second"]}'), { findings: ['Cash ₹1,97,668 was the largest mode.', 'second'] }, 'a curly closing quote from the model is repaired');
  assert.equal(looseJson('no json here'), null);
  // a real reply from a free model: curly quote AND a missing ] after the first list
  const broken = '{"findings":["Net sales were ₹7,84,630.","UPI was ₹3,68,740, the largest mode.\u201D,"actions":["Reorder Offer Check Shirt.","Collect ₹59,749 from customers."]}';
  assert.equal(looseJson(broken), null);
  assert.deepEqual(salvageList(broken, 'findings', 'actions'), ['Net sales were ₹7,84,630.', 'UPI was ₹3,68,740, the largest mode.']);
  assert.deepEqual(salvageList(broken, 'actions'), ['Reorder Offer Check Shirt.', 'Collect ₹59,749 from customers.']);
  const seen: any[] = [];
  const stub = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ auth: req.headers.authorization, ...JSON.parse(body) });
      const content = seen.length === 1
        ? `Sure!\n{"calls":[{"report":"movers","from":"${d}","to":"${d}","store":null,"channel":null},{"report":"party_outstanding"},{"report":"DROP TABLE users"}]}`
        : 'Offer Shirt sold the most.';
      res.setHeader('Content-Type', 'application/json').end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((ok) => stub.listen(0, '127.0.0.1', ok));
  setSetting('ai', { provider: 'custom', baseUrl: `http://127.0.0.1:${(stub.address() as any).port}/v1/`, model: 'stub', apiKey: 'test-key' });
  try {
    const out = await askAI('Kaun sa shirt sabse zyada bika?', [], user);
    assert.equal(out.answer, 'Offer Shirt sold the most.');
    assert.deepEqual(out.used.map((u) => u.name), ['movers', 'party_outstanding'], 'unknown report names are dropped');
    const sent = seen[1].messages[0].content;
    assert.match(sent, /Best Sellers & Slow Movers/);
    assert.match(sent, /Offer Shirt/);
    assert.match(sent, /Wholesale Buyer/);
    assert.doesNotMatch(JSON.stringify(seen), /9876543210/, 'phone numbers are not sent to the model');
    assert.equal(seen[0].auth, 'Bearer test-key');
  } finally {
    stub.close();
  }
});

test('cancelling a bill puts stock and money back and keeps the number', () => {
  cancelVoucher(retailBill, user);
  assert.deepEqual([onHand(offer.M, store), onHand(premium, store)], [10, 4]);
  assert.equal(get('SELECT COUNT(*) n FROM payments WHERE voucher_id = ?', retailBill)!.n, 0);
  assert.equal(amount(runReport('pnl', range, user).rows, 'Sales'), R(5500));
  assert.equal(sale({ location_id: store, paid: R(500), lines: [{ variant_id: offer.M, qty: 1, rate: R(500) }] }).number, 'INV-0005');
});
