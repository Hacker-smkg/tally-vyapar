import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBill, rupeesInWords, toPaise, addDays } from './calc.ts';

const off = { gstEnabled: false, pricesIncludeTax: true, interState: false };

test('plain bill, GST off: discount, courier, round-off', () => {
  // 2 shirts @ ₹799 with 10% off, 1 pant @ ₹1,249.50, ₹50 off the bill, ₹60 courier
  const b = computeBill([{ qty: 2, rate: 79900, discPct: 10 }, { qty: 1, rate: 124950 }], { ...off, billDiscount: 5000, extraCharge: 6000 });
  assert.equal(b.subtotal, 284750);
  assert.equal(b.discount, 15980 + 5000);
  assert.equal(b.taxable, 263770);
  assert.equal(b.lines.reduce((a, l) => a + l.taxable, 0), b.taxable, 'bill discount fully shared across lines');
  assert.equal(b.cgst + b.sgst + b.igst, 0);
  assert.equal(b.total, 269800); // 2637.70 + 60 = 2697.70 → ₹2,698
  assert.equal(b.roundOff, 30);
});

test('GST on, prices include tax: garment slab 5% up to ₹2,500, 18% above', () => {
  const on = { gstEnabled: true, pricesIncludeTax: true, interState: false };
  const b = computeBill([{ qty: 1, rate: 105000, gstMode: 'apparel' }, { qty: 1, rate: 354000, gstMode: 'apparel' }], on);
  assert.deepEqual(b.lines.map((l) => [l.gstRate, l.taxable, l.tax]), [[5, 100000, 5000], [18, 300000, 54000]]);
  assert.equal(b.cgst, 29500);
  assert.equal(b.sgst, 29500);
  assert.equal(b.total, 459000);
  // ₹2,625 inclusive is exactly ₹2,500 before tax → still 5%
  assert.equal(computeBill([{ qty: 1, rate: 262500, gstMode: 'apparel' }], on).lines[0].gstRate, 5);
  assert.equal(computeBill([{ qty: 1, rate: 262600, gstMode: 'apparel' }], on).lines[0].gstRate, 18);
});

test('GST on, prices before tax, other state → IGST; fixed rate; exempt item', () => {
  const b = computeBill(
    [{ qty: 10, rate: 40000, gstMode: 'fixed', gstRate: 12 }, { qty: 2.5, rate: 20000, gstMode: 'none' }],
    { gstEnabled: true, pricesIncludeTax: false, interState: true },
  );
  assert.equal(b.taxable, 450000);
  assert.equal(b.igst, 48000);
  assert.equal(b.cgst + b.sgst, 0);
  assert.equal(b.total, 498000);
});

test('CGST and SGST are always equal, even when the tax works out to an odd paisa', () => {
  // ₹499 and ₹3,499 inclusive: exact tax 23.76 + 533.75 = 557.51, which cannot be split in two
  const b = computeBill([{ qty: 1, rate: 49900, gstMode: 'apparel' }, { qty: 1, rate: 349900, gstMode: 'apparel' }], { gstEnabled: true, pricesIncludeTax: true, interState: false });
  assert.equal(b.cgst, b.sgst);
  assert.equal(b.taxable + b.cgst + b.sgst, 399800);
  assert.equal(b.total, 399800);
  for (const l of b.lines) assert.equal(l.tax % 2, 0);
});

test('helpers', () => {
  assert.equal(toPaise('1249.5'), 124950);
  assert.equal(toPaise('abc'), 0);
  assert.equal(rupeesInWords(12345600), 'One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only');
  assert.equal(rupeesInWords(269800), 'Two Thousand Six Hundred Ninety Eight Rupees Only');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});
