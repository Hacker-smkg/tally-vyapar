import { all, get, run, tx } from './db.ts';
import { addCategory, addExpense, saveItem, saveParty } from './masters.ts';
import { addPayment, createVoucher } from './vouchers.ts';
import { createProduction, transferStock } from './stock.ts';
import { addDays, today } from '../shared/calc.ts';
import type { User } from './util.ts';

// Demo data: a small clothing business with one godown and two stores, 40 days of activity.
// It is built through the same functions the screens use, so every number is "real".

export function seedDemo(user: User) {
  tx(() => {
    let s = 20261117;
    const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)];
    const R = (rupees: number) => Math.round(rupees * 100);
    const t = today();
    const day = (n: number) => addDays(t, -n);

    const locId = (kind: string, name: string) => {
      const have = all('SELECT id FROM locations WHERE kind = ? AND active = 1 ORDER BY id', kind);
      return (n: number) => have[n]?.id ?? run('INSERT INTO locations(name, kind) VALUES(?, ?)', `${name}${n ? ` ${n + 1}` : ''}`, kind).id;
    };
    const godown = locId('godown', 'Main Godown')(0);
    const stores = [locId('store', 'Store')(0), locId('store', 'Store')(1)];

    const party = (name: string, kind: string, phone = '', state = 'West Bengal') => saveParty({ name, kind, phone, state });
    const fabricMill = party('Surat Fabric Mills', 'supplier', '9825011122', 'Gujarat');
    const readyMade = party('Premium Garments Co.', 'supplier', '9830044556');
    const footwear = party('Agra Footwear Wholesale', 'supplier', '9412277889', 'Uttar Pradesh');
    const tailor = party('Rahim Tailoring Unit', 'jobworker', '9007711223');
    const wholesaleBuyers = [party('Sharma Garments', 'customer', '9433100200'), party('Trendz Retail', 'customer', '9831555666')];
    const marketplace = party('Meesho Settlements', 'customer');

    const cat = (parent: string, sub?: string) => {
      const p = addCategory(parent, null);
      return sub ? addCategory(sub, p) : p;
    };
    const item = (name: string, kind: 'finished' | 'raw', category: number, unit: string, sizes: string[], colours: string[], retail = 0, wholesale = 0) => {
      const id = saveItem({ name, kind, category_id: category, unit, gst_mode: kind === 'raw' ? 'fixed' : 'apparel', gst_rate: kind === 'raw' ? 5 : 0,
        variants: sizes.flatMap((size) => colours.map((colour) => ({ size, colour, retail_price: R(retail), wholesale_price: R(wholesale), low_stock: kind === 'raw' ? 50 : 6 }))) }, user);
      return all('SELECT id FROM variants WHERE item_id = ? ORDER BY id', id).map((v) => v.id as number);
    };

    const fabricCat = cat('Raw Material', 'Fabric');
    const [cotton] = item('Cotton Shirting Fabric', 'raw', fabricCat, 'mtr', [''], ['']);
    const [denim] = item('Denim Fabric', 'raw', fabricCat, 'mtr', [''], ['']);
    const [fleece] = item('Fleece Fabric', 'raw', fabricCat, 'mtr', [''], ['']);
    const [trims] = item('Buttons, Labels & Poly Bag', 'raw', cat('Raw Material', 'Trims & Packing'), 'set', [''], ['']);

    const premiumShirt = item('Premium Linen Shirt', 'finished', cat('Shirt', 'Premium'), 'pcs', ['M', 'L', 'XL'], ['White', 'Sky Blue'], 1499, 1050);
    const offerShirt = item('Offer Check Shirt', 'finished', cat('Shirt', 'Offer (Normal)'), 'pcs', ['S', 'M', 'L', 'XL'], ['Red Check', 'Blue Check'], 499, 340);
    const denimShirt = item('Denim Jeans Shirt', 'finished', cat('Shirt', 'Jeans Shirt'), 'pcs', ['M', 'L', 'XL'], ['Indigo'], 899, 620);
    const formalPant = item('Formal Trouser', 'finished', cat('Pant', 'Formal'), 'pcs', ['30', '32', '34', '36'], ['Black', 'Grey'], 999, 700);
    const chino = item('Cotton Chino', 'finished', cat('Pant', 'Cotton'), 'pcs', ['30', '32', '34', '36'], ['Khaki'], 799, 560);
    const track = item('Track Pant', 'finished', cat('Pant', 'Track'), 'pcs', ['M', 'L', 'XL'], ['Black'], 449, 300);
    const jeans = item('Slim Fit Jeans', 'finished', cat('Pant', 'Jeans'), 'pcs', ['30', '32', '34', '36'], ['Blue'], 1099, 780);
    const hoodie = item('Pullover Hoodie', 'finished', cat('Hoodie'), 'pcs', ['M', 'L', 'XL'], ['Charcoal', 'Maroon'], 1199, 820);
    const blazer = item('Classic Blazer', 'finished', cat('Blazer'), 'pcs', ['38', '40', '42'], ['Navy'], 3499, 2500);
    const sneakers = item('Canvas Sneakers', 'finished', cat('Shoes'), 'pcs', ['7', '8', '9', '10'], ['White'], 1299, 850);

    const buy = (n: number, supplier: number, lines: [number[], number, number][], freight: number, paid: number) =>
      createVoucher({ type: 'purchase', date: day(n), party_id: supplier, location_id: godown, extra_charge: R(freight), paid: R(paid), pay_mode: 'bank',
        lines: lines.flatMap(([vs, qty, rate]) => vs.map((variant_id) => ({ variant_id, qty, rate: R(rate) }))) }, user);

    // 1. Buying: raw material, custom-purchased premium garments, shoes at wholesale.
    buy(40, fabricMill, [[[cotton], 600, 95], [[denim], 350, 180], [[fleece], 300, 160], [[trims], 1000, 8]], 2500, 120000);
    buy(38, readyMade, [[premiumShirt, 30, 720], [formalPant, 25, 520], [blazer, 12, 1900]], 1800, 150000);
    buy(37, footwear, [[sneakers, 30, 620]], 900, 75300);

    // 2. Manufacturing cost sheets: raw material + labour (job worker) + factory other costs → cost per piece.
    const make = (n: number, out: number[], each: number, fabric: number, perPiece: number, labour: number, other: number, complete = true) => {
      const pieces = out.length * each;
      return createProduction({ date: day(n), from_location_id: godown, to_location_id: godown, party_id: tailor, labour_cost: R(labour * pieces), other_cost: R(other * pieces), pay_mode: 'cash', complete,
        inputs: [{ variant_id: fabric, qty: +(perPiece * pieces).toFixed(2) }, { variant_id: trims, qty: pieces }], outputs: out.map((variant_id) => ({ variant_id, qty: each })) }, user);
    };
    make(35, offerShirt, 35, cotton, 1.4, 55, 12);
    make(35, chino, 30, cotton, 1.5, 70, 14);
    make(34, denimShirt, 30, denim, 1.5, 65, 12);
    make(34, jeans, 35, denim, 1.3, 85, 15);
    make(33, track, 40, fleece, 1.1, 40, 10);
    make(33, hoodie, 25, fleece, 1.1, 75, 14);

    // 3. Godown → stores. The godown keeps the rest for wholesale and online orders.
    const finished = [premiumShirt, offerShirt, denimShirt, formalPant, chino, track, jeans, hoodie, blazer, sneakers].flat();
    stores.forEach((to, i) => transferStock({ date: day(31), from: godown, to, lines: finished.map((variant_id) => {
      const have = Number(get('SELECT COALESCE(SUM(qty), 0) q FROM stock_moves WHERE variant_id = ? AND location_id = ?', variant_id, godown)!.q);
      return { variant_id, qty: Math.max(1, Math.floor(have * (i === 0 ? 0.3 : 0.36))) };
    }) }, user));

    // 4. Thirty-one days of selling on all four channels.
    const inStock = (loc: number, min: number) => all(
      `SELECT k.variant_id AS id, vv.retail_price, vv.wholesale_price FROM v_stock k JOIN v_variant vv ON vv.variant_id = k.variant_id WHERE k.location_id = ? AND vv.kind = 'finished' AND k.qty >= ?`, loc, min);
    // Cheaper items sell more often than costly ones.
    const choose = (list: any[]) => { const a = pick(list), b = pick(list); return rnd() < 0.7 ? (a.retail_price <= b.retail_price ? a : b) : a; };
    const marketOrders: { variant_id: number; rate: number }[] = [];

    for (let n = 30; n >= 0; n--) {
      const d = day(n);
      const weekend = [0, 6].includes(new Date(`${d}T12:00:00`).getDay());
      stores.forEach((store, i) => {
        for (let b = between(i ? 3 : 4, (i ? 5 : 7) + (weekend ? 2 : 0)); b > 0; b--) {
          const have = inStock(store, 2);
          if (have.length < 3) break;
          const lines = [...new Set(Array.from({ length: between(1, 3) }, () => choose(have)))].map((v) => ({ variant_id: v.id, qty: rnd() < 0.12 ? 2 : 1, rate: v.retail_price, disc_pct: rnd() < 0.2 ? pick([5, 10]) : 0 }));
          const total = lines.reduce((x, l) => x + Math.round((l.qty * l.rate * (100 - l.disc_pct)) / 100), 0);
          createVoucher({ type: 'sale', date: d, location_id: store, channel: 'retail', lines, paid: Math.round(total / 100) * 100, pay_mode: pick(['cash', 'cash', 'upi', 'upi', 'upi', 'card']) }, user);
        }
      });
      if (n % 3 === 0) {
        const have = inStock(godown, 8);
        if (have.length >= 4) {
          const lines = [...new Set(Array.from({ length: between(3, 5) }, () => choose(have)))].map((v) => ({ variant_id: v.id, qty: between(3, 6), rate: v.wholesale_price }));
          const total = lines.reduce((x, l) => x + l.qty * l.rate, 0);
          createVoucher({ type: 'sale', date: d, party_id: pick(wholesaleBuyers), location_id: godown, channel: 'wholesale', lines, paid: Math.round((total * pick([0, 0.3, 0.5])) / 10000) * 10000, pay_mode: 'bank' }, user);
        }
      }
      for (let m = between(1, 3); m > 0; m--) {
        const have = inStock(godown, 2);
        if (!have.length) break;
        const v = choose(have);
        createVoucher({ type: 'sale', date: d, party_id: marketplace, location_id: godown, channel: 'marketplace', lines: [{ variant_id: v.id, qty: 1, rate: v.retail_price }], paid: 0, channel_fee: Math.round(v.retail_price * 0.18), shipping_cost: R(65) }, user);
        marketOrders.push({ variant_id: v.id, rate: v.retail_price });
      }
      if (rnd() < 0.6) {
        const have = inStock(godown, 2);
        if (have.length) {
          const v = choose(have);
          createVoucher({ type: 'sale', date: d, party_name: 'Instagram order', location_id: godown, channel: 'online', lines: [{ variant_id: v.id, qty: 1, rate: v.retail_price }], extra_charge: R(60), paid: v.retail_price + R(60), pay_mode: 'upi', shipping_cost: R(55) }, user);
        }
      }
      // Marketplace returns come back a few days later; settlements arrive weekly.
      if (n % 6 === 2 && marketOrders.length) {
        const back = marketOrders.shift()!;
        createVoucher({ type: 'sale_return', date: d, party_id: marketplace, location_id: godown, channel: 'marketplace', lines: [{ variant_id: back.variant_id, qty: 1, rate: back.rate }], paid: 0, shipping_cost: R(65) }, user);
      }
      if (n % 7 === 1) {
        const due = Number(get('SELECT balance FROM v_party_balance WHERE party_id = ?', marketplace)!.balance);
        if (due > 0) addPayment({ date: d, party_id: marketplace, direction: 'in', amount: Math.round((due * 0.8) / 100) * 100, mode: 'bank', note: 'Weekly settlement' }, user);
      }
    }

    // 5. A second lot of shirts is still with the tailor (shows as "in production").
    buy(6, fabricMill, [[[cotton], 300, 98], [[trims], 500, 8]], 1200, 0);
    make(3, offerShirt, 25, cotton, 1.4, 55, 12, false);

    // 6. Running costs and payments.
    const spend = (n: number, category: string, rupees: number, store: number | null, mode = 'bank', note = '') => addExpense({ date: day(n), category, amount: R(rupees), mode, location_id: store, note }, user);
    for (const n of [12, 42]) { spend(n, 'Rent', 18000, stores[0]); spend(n, 'Rent', 14000, stores[1]); }
    for (const n of [2, 32]) { spend(n, 'Salary', 24000, stores[0]); spend(n, 'Salary', 16000, stores[1]); spend(n, 'Salary', 12000, null, 'bank', 'Godown helper'); }
    spend(8, 'Electricity', 3200, stores[0]); spend(8, 'Electricity', 2400, stores[1]);
    spend(6, 'Advertising', 6000, null, 'upi', 'Instagram ads'); spend(20, 'Advertising', 4500, null, 'upi', 'Instagram ads');
    spend(4, 'Packing', 2800, null, 'cash', 'Courier bags'); spend(15, 'Transport', 1900, null, 'cash', 'Godown to stores');
    for (let n = 28; n >= 0; n -= 4) spend(n, 'Tea & Misc', between(120, 320), pick(stores), 'cash');

    addPayment({ date: day(20), party_id: fabricMill, direction: 'out', amount: R(40000), mode: 'bank' }, user);
    addPayment({ date: day(18), party_id: tailor, direction: 'out', amount: R(45000), mode: 'cash', note: 'Part payment for stitching' }, user);
    for (const buyer of wholesaleBuyers) {
      const due = Number(get('SELECT balance FROM v_party_balance WHERE party_id = ?', buyer)!.balance);
      if (due > R(5000)) addPayment({ date: day(5), party_id: buyer, direction: 'in', amount: Math.round((due * 0.4) / 10000) * 10000, mode: 'upi' }, user);
    }
  });
}
