// Money and bill maths. Used by the screens (live preview) AND the server (the real numbers).
// All money is whole paise (₹1 = 100), so totals never drift.

export type GstMode = 'none' | 'fixed' | 'apparel';
export type VoucherType = 'sale' | 'purchase' | 'sale_return' | 'purchase_return';
export type Channel = 'retail' | 'wholesale' | 'marketplace' | 'online';

export const VOUCHER_TYPES: readonly VoucherType[] = ['sale', 'purchase', 'sale_return', 'purchase_return'];
export const CHANNELS: readonly Channel[] = ['retail', 'wholesale', 'marketplace', 'online'];
export const PAY_MODES = ['cash', 'upi', 'card', 'bank'] as const;
export const CHANNEL_LABEL: Record<string, string> = { retail: 'Retail shop', wholesale: 'Wholesale', marketplace: 'Marketplace', online: 'Own online' };
export const TYPE_LABEL: Record<string, string> = { sale: 'Sale', purchase: 'Purchase', sale_return: 'Sale Return', purchase_return: 'Purchase Return' };

export interface LineIn {
  qty: number;
  rate: number; // paise per unit
  discPct?: number; // line discount %
  gstMode?: GstMode;
  gstRate?: number;
}
export interface BillOpts {
  gstEnabled: boolean;
  pricesIncludeTax: boolean;
  interState: boolean;
  billDiscount?: number; // paise off the whole bill, shared across lines by value
  extraCharge?: number; // courier / freight billed, paise
}
export interface LineOut { gross: number; discount: number; taxable: number; gstRate: number; tax: number; total: number }
export interface BillOut {
  lines: LineOut[];
  subtotal: number; discount: number; taxable: number;
  cgst: number; sgst: number; igst: number;
  extraCharge: number; roundOff: number; total: number;
}

// Garments (HSN 61/62) since 22 Sep 2025: 5% up to ₹2,500 per piece, 18% above.
const APPAREL_LIMIT = 2500_00;

export function gstRateFor(mode: GstMode | undefined, fixed: number | undefined, unitNet: number, inclusive: boolean, gstEnabled: boolean): number {
  if (!gstEnabled || !mode || mode === 'none') return 0;
  if (mode === 'fixed') return fixed || 0;
  const limit = inclusive ? Math.round(APPAREL_LIMIT * 1.05) : APPAREL_LIMIT;
  return unitNet <= limit ? 5 : 18;
}

export function computeBill(lines: LineIn[], o: BillOpts): BillOut {
  const gross = lines.map((l) => Math.round(l.qty * l.rate));
  const lineDisc = lines.map((l, i) => Math.round((gross[i] * Math.min(Math.max(l.discPct || 0, 0), 100)) / 100));
  const afterLine = gross.map((g, i) => g - lineDisc[i]);
  const base = afterLine.reduce((a, b) => a + b, 0);
  const billDisc = Math.min(Math.max(o.billDiscount || 0, 0), base);

  // Share the bill discount across lines by value; the last line takes the leftover paise.
  let left = billDisc;
  const share = afterLine.map((v, i) => {
    const s = i === afterLine.length - 1 ? left : base ? Math.round((billDisc * v) / base) : 0;
    left -= s;
    return s;
  });

  const out: LineOut[] = lines.map((l, i) => {
    const net = afterLine[i] - share[i];
    const rate = gstRateFor(l.gstMode, l.gstRate, l.qty ? net / l.qty : 0, o.pricesIncludeTax, o.gstEnabled);
    const exact = o.pricesIncludeTax ? net - (net * 100) / (100 + rate) : (net * rate) / 100;
    // Within a state the tax is two equal halves (CGST = SGST), so each line's tax is kept even to the paisa.
    const tax = o.interState ? Math.round(exact) : Math.round(exact / 2) * 2;
    const taxable = o.pricesIncludeTax ? net - tax : net;
    return { gross: gross[i], discount: lineDisc[i] + share[i], taxable, gstRate: rate, tax, total: taxable + tax };
  });

  const sum = (f: (l: LineOut) => number) => out.reduce((a, l) => a + f(l), 0);
  const tax = sum((l) => l.tax);
  const cgst = o.interState ? 0 : tax / 2;
  const extraCharge = Math.max(o.extraCharge || 0, 0);
  const exact = sum((l) => l.total) + extraCharge;
  const total = Math.round(exact / 100) * 100;
  return {
    lines: out,
    subtotal: sum((l) => l.gross),
    discount: sum((l) => l.discount),
    taxable: sum((l) => l.taxable),
    cgst, sgst: o.interState ? 0 : tax - cgst, igst: o.interState ? tax : 0,
    extraCharge, roundOff: total - exact, total,
  };
}

// ---------- formatting ----------
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
export const fmtMoney = (paise: number | null | undefined) => inr.format((paise || 0) / 100);
export const fmtMoney0 = (paise: number | null | undefined) => inr0.format(Math.round((paise || 0) / 100));
export const fmtNum = (n: number | null | undefined) => plain.format(n || 0);
export const toPaise = (rupees: string | number | null | undefined) => {
  const n = Number(rupees);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
export const toRupees = (paise: number | null | undefined) => (paise || 0) / 100;

// ---------- dates (local time of the office PC) ----------
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => ymd(new Date());
export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const fmtDate = (date: string | null | undefined) =>
  date ? new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

// ---------- amount in words (Indian system) ----------
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n: number) => `${n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' : ''}` : ''}${below100(n % 100)}`;
export function rupeesInWords(paise: number): string {
  let n = Math.round(Math.abs(paise) / 100);
  if (!n) return 'Zero Rupees Only';
  const parts: string[] = [];
  for (const [size, name] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']] as const) {
    if (n >= size) {
      parts.push(`${below1000(Math.floor(n / size)).trim()} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(below1000(n));
  return `${parts.join(' ')} Rupees Only`;
}
