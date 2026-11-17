import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Printer, Save, ScanLine, Trash2 } from 'lucide-react';
import { api, useData } from '../api.ts';
import { Badge, Button, Card, Combo, ErrorNote, Field, Input, Money, MoneyInput, Segmented, Select, Spinner, cx, fieldCls, inputCls, useApp, useLocations } from '../ui.tsx';
import { PartyModal, MODE_LABEL } from './Parties.tsx';
import type { Party } from './Parties.tsx';
import { CHANNELS, CHANNEL_LABEL, PAY_MODES, TYPE_LABEL, computeBill, fmtMoney, fmtNum, today } from '../../shared/calc.ts';
import type { Channel, GstMode, VoucherType } from '../../shared/calc.ts';

export interface Variant { id: number; item: string; kind: string; unit: string; size: string; colour: string; sku: string; retail_price: number; wholesale_price: number; avg_cost: number; gst_mode: GstMode; gst_rate: number; stock: number }
interface Line { key: number; id: number; qty: string; rate: number; disc: string }
export const variantLabel = (v: { item: string; size: string; colour: string }) => [v.item, v.size, v.colour].filter(Boolean).join(' · ');
let seq = 0;

export default function VoucherForm({ kind }: { kind: 'sale' | 'purchase' }) {
  const { user, billing, business, toast } = useApp();
  const locs = useLocations();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const isSale = kind === 'sale';
  const isReturn = sp.get('type') === 'return';
  const type = (isReturn ? `${kind}_return` : kind) as VoucherType;
  const fromId = sp.get('from');

  const [locId, setLocId] = useState(String(user.location_id ?? locs.find((l) => l.kind === (isSale ? 'store' : 'godown'))?.id ?? locs[0]?.id ?? ''));
  const [date, setDate] = useState(today());
  const [party, setParty] = useState<Party | null>(null);
  const [walkin, setWalkin] = useState('');
  const [channel, setChannel] = useState<Channel>('retail');
  const [lines, setLines] = useState<Line[]>([]);
  const [billDisc, setBillDisc] = useState(0);
  const [extra, setExtra] = useState(0);
  const [fee, setFee] = useState(0);
  const [ship, setShip] = useState(0);
  const [paid, setPaid] = useState<number | null>(null); // null = follow the usual default
  const [mode, setMode] = useState('cash');
  const [notes, setNotes] = useState('');
  const [newParty, setNewParty] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const variants = useData<Variant[]>(locId ? `/variants?location=${locId}` : null);
  const parties = useData<Party[]>('/parties');
  const source = useData<any>(fromId ? `/vouchers/${fromId}` : null);
  const byId = useMemo(() => new Map((variants.data ?? []).map((v) => [v.id, v])), [variants.data]);

  const priceFor = (v: Variant, ch: Channel = channel) => (isSale ? (ch === 'wholesale' && v.wholesale_price ? v.wholesale_price : v.retail_price) : Math.round(v.avg_cost));

  // Duplicate a bill, or start a return from one.
  const filled = useRef(false);
  useEffect(() => {
    const s = source.data;
    if (!s || !variants.data || !parties.data || filled.current) return;
    if (!user.location_id && String(s.location_id) !== locId) return setLocId(String(s.location_id));
    filled.current = true;
    setParty(parties.data.find((p) => p.id === s.party_id) ?? null);
    setWalkin(s.party_name ?? '');
    setChannel(s.channel);
    setLines(s.lines.map((l: any) => ({ key: ++seq, id: l.variant_id, qty: String(l.qty), rate: l.rate, disc: l.disc_pct ? String(l.disc_pct) : '' })));
    if (!isReturn) { setExtra(s.extra_charge); setFee(s.channel_fee); setShip(s.shipping_cost); }
  }, [source.data, variants.data, parties.data, locId]);

  const add = (v: Variant) => setLines((ls) => {
    const at = ls.findIndex((l) => l.id === v.id);
    if (at >= 0) return ls.map((l, i) => (i === at ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l));
    return [...ls, { key: ++seq, id: v.id, qty: '1', rate: priceFor(v), disc: '' }];
  });
  const edit = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickChannel = (ch: Channel) => {
    // Lines still at the old channel's list price move to the new channel's price; hand-typed rates stay.
    setLines((ls) => ls.map((l) => { const v = byId.get(l.id); return v && l.rate === priceFor(v) ? { ...l, rate: priceFor(v, ch) } : l; }));
    setChannel(ch);
  };

  const shown = lines.filter((l) => byId.has(l.id));
  const interState = billing.gstEnabled && !!party?.state && !!business.state && party.state.trim().toLowerCase() !== business.state.trim().toLowerCase();
  const calc = computeBill(
    shown.map((l) => { const v = byId.get(l.id)!; return { qty: Number(l.qty) || 0, rate: l.rate, discPct: Number(l.disc) || 0, gstMode: v.gst_mode, gstRate: v.gst_rate }; }),
    { gstEnabled: billing.gstEnabled, pricesIncludeTax: billing.pricesIncludeTax, interState, billDiscount: billDisc, extraCharge: extra },
  );
  const credit = !!party && (!isSale || isReturn || channel === 'wholesale' || channel === 'marketplace');
  const paidNow = Math.min(paid ?? (credit ? 0 : calc.total), calc.total);
  const units = shown.reduce((t, l) => t + (Number(l.qty) || 0), 0);

  async function save(print: boolean) {
    if (!shown.length) return setError('Add at least one item');
    setBusy(true); setError('');
    try {
      const r = await api.post('/vouchers', {
        type, date, location_id: Number(locId), party_id: party?.id, party_name: walkin, channel, ref_voucher_id: isReturn && source.data ? (String(source.data.type).endsWith('_return') ? source.data.ref_voucher_id ?? undefined : source.data.id) : undefined,
        lines: shown.map((l) => ({ variant_id: l.id, qty: Number(l.qty), rate: l.rate, disc_pct: Number(l.disc) || 0 })),
        bill_discount: billDisc, extra_charge: extra, channel_fee: fee, shipping_cost: ship, paid: paidNow, pay_mode: mode, notes,
      });
      toast(`${TYPE_LABEL[type]} ${r.number} saved`);
      nav(`/vouchers/${r.id}${print ? '?print=1' : ''}`, { replace: true });
    } catch (e: any) { setError(e.message); setBusy(false); }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) { e.preventDefault(); saveRef.current(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!variants.data || !parties.data) return variants.error || parties.error ? <ErrorNote>{variants.error || parties.error}</ErrorNote> : <Spinner />;
  const pickable = variants.data.filter((v) => !isSale || v.kind === 'finished');
  const partyKind = isSale ? 'customer' : 'supplier';
  const row = (label: string, value: number, strong = false) => (
    <div className={cx('flex items-center justify-between', strong ? 'text-base font-semibold text-slate-900' : 'text-sm text-slate-600')}><span>{label}</span><Money value={value} /></div>
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => nav(-1)} aria-label="Back" className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-200/60"><ArrowLeft className="size-5" /></button>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">New {TYPE_LABEL[type].toLowerCase()}</h1>
        {fromId && source.data && <Badge tone="brand">{isReturn && !String(source.data.type).endsWith('_return') ? 'Return against' : 'Copied from'} {source.data.number}</Badge>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
          <Card className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={isSale ? 'Customer' : 'Supplier'} hint={isSale && !party ? 'Leave empty for a walk-in cash sale.' : undefined}>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <Combo items={parties.data.filter((p) => p.kind === partyKind)} text={(p) => `${p.name} ${p.phone}`} value={party?.name} onClear={() => setParty(null)} onPick={setParty}
                      placeholder={isSale ? 'Search customer' : 'Search supplier'}
                      render={(p) => <div className="flex justify-between gap-3"><span className="font-medium">{p.name}</span><span className="text-xs text-slate-500">{p.phone}</span></div>} />
                  </div>
                  <Button icon={Plus} onClick={() => setNewParty(true)} aria-label={`New ${partyKind}`} className="px-3" />
                </div>
              </Field>
              {isSale && !party ? <Field label="Walk-in name (optional)"><Input value={walkin} onChange={(e) => setWalkin(e.target.value)} /></Field> : <div className="hidden sm:block" />}
              <Field label="Date"><Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label={isSale ? 'Sold from' : 'Stock goes to'}>
                <Select value={locId} disabled={!!user.location_id} onChange={(e) => setLocId(e.target.value)}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
              </Field>
              {isSale && (
                <Field label="Channel" className="sm:col-span-2">
                  <Segmented value={channel} onChange={pickChannel} options={CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))} />
                </Field>
              )}
            </div>
          </Card>

          <Card>
            <div className="p-5 pb-3">
              <Combo items={pickable} autoFocus text={(v) => `${v.item} ${v.size} ${v.colour} ${v.sku}`} onPick={add} limit={40}
                exact={(q) => pickable.find((v) => v.sku.toLowerCase() === q.toLowerCase())}
                placeholder="Type an item name or size, or scan a barcode"
                render={(v) => (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="truncate font-medium">{variantLabel(v)}</p><p className="text-xs text-slate-500">{v.sku}</p></div>
                    <div className="shrink-0 text-right"><p className="num font-medium">{fmtMoney(priceFor(v))}</p><p className={cx('text-xs', v.stock > 0 ? 'text-slate-500' : 'text-rose-600')}>{fmtNum(v.stock)} {v.unit} in stock</p></div>
                  </div>
                )} />
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><ScanLine className="size-3.5" />A USB barcode scanner works here: scan a price tag and the item is added.</p>
            </div>
            {shown.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-y border-slate-200 text-xs text-slate-500">
                    <th className="min-w-44 px-5 py-2.5 text-left font-medium">Item</th><th className="w-20 px-2 py-2.5 text-right font-medium">Qty</th><th className="w-28 px-2 py-2.5 text-right font-medium">Rate</th>
                    <th className="w-16 px-2 py-2.5 text-right font-medium">Disc %</th><th className="w-28 px-2 py-2.5 text-right font-medium">Amount</th><th className="w-10" />
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map((l, i) => {
                      const v = byId.get(l.id)!;
                      const short = isSale && !isReturn && (Number(l.qty) || 0) > v.stock;
                      return (
                        <tr key={l.key}>
                          <td className="px-5 py-2.5">
                            <p className="font-medium text-slate-900">{variantLabel(v)}</p>
                            <p className={cx('text-xs', short ? 'font-medium text-rose-600' : 'text-slate-500')}>{short ? `Only ${fmtNum(v.stock)} in stock here` : `${v.sku} · ${fmtNum(v.stock)} ${v.unit} in stock`}{calc.lines[i].gstRate ? ` · GST ${calc.lines[i].gstRate}%` : ''}</p>
                          </td>
                          <td className="px-2 py-2.5"><input type="number" min="0" step="any" value={l.qty} onChange={(e) => edit(l.key, { qty: e.target.value })} onFocus={(e) => e.target.select()} className={fieldCls('num h-9 text-right')} aria-label="Quantity" /></td>
                          <td className="px-2 py-2.5"><MoneyInput value={l.rate} onChange={(rate) => edit(l.key, { rate })} className="h-9" aria-label="Rate" /></td>
                          <td className="px-2 py-2.5"><input type="number" min="0" max="100" step="any" value={l.disc} placeholder="0" onChange={(e) => edit(l.key, { disc: e.target.value })} className={fieldCls('num h-9 text-right')} aria-label="Discount percent" /></td>
                          <td className="num px-2 py-2.5 text-right font-medium text-slate-900">{fmtMoney(calc.lines[i].gross - Math.round((calc.lines[i].gross * (Number(l.disc) || 0)) / 100))}</td>
                          <td className="pr-3 text-right"><button type="button" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="border-t border-slate-100 px-5 py-10 text-center text-sm text-slate-500">No items yet. Search above to add the first one.</p>}
          </Card>
        </div>

        <Card className="h-fit space-y-4 p-5 xl:sticky xl:top-0">
          <div className="space-y-2">
            {row(`Subtotal (${fmtNum(units)} ${units === 1 ? 'unit' : 'units'})`, calc.subtotal)}
            {calc.discount > 0 && row('Discount', -calc.discount)}
            {billing.gstEnabled && <>{row('Taxable value', calc.taxable)}{calc.igst ? row('IGST', calc.igst) : <>{row('CGST', calc.cgst)}{row('SGST', calc.sgst)}</>}</>}
            {extra > 0 && row(isSale ? 'Courier / other charge' : 'Freight', calc.extraCharge)}
            {calc.roundOff !== 0 && row('Round off', calc.roundOff)}
            <div className="border-t border-slate-200 pt-3">{row(isReturn ? 'Return total' : 'Bill total', calc.total, true)}</div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
            <Field label="Bill discount"><MoneyInput value={billDisc} onChange={setBillDisc} /></Field>
            <Field label={isSale ? 'Courier charge' : 'Freight'}><MoneyInput value={extra} onChange={setExtra} /></Field>
          </div>

          {isSale && (channel === 'marketplace' || channel === 'online' || fee > 0 || ship > 0) && (
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="mb-2 text-xs font-medium text-slate-600">Your selling costs (not printed on the bill)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Marketplace fee"><MoneyInput value={fee} onChange={setFee} /></Field>
                <Field label="Courier cost"><MoneyInput value={ship} onChange={setShip} /></Field>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
            <Field label={isSale !== isReturn ? 'Received now' : 'Paid now'}><MoneyInput value={paidNow} onChange={setPaid} /></Field>
            <Field label="By"><Select value={mode} onChange={(e) => setMode(e.target.value)}>{PAY_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</Select></Field>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">Balance {party ? `on ${party.name}` : ''}</span>
            <span className={cx('num font-medium', calc.total - paidNow > 0 ? 'text-amber-700' : 'text-emerald-700')}>{fmtMoney(calc.total - paidNow)}</span>
          </div>
          {party && <div className="flex gap-2"><Button size="sm" onClick={() => setPaid(calc.total)}>Full payment</Button><Button size="sm" onClick={() => setPaid(0)}>On credit</Button></div>}

          <Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
          <ErrorNote>{error}</ErrorNote>
          <div className="space-y-2">
            <Button variant="primary" icon={Printer} busy={busy} onClick={() => save(true)} className="w-full">Save & print</Button>
            <Button icon={Save} busy={busy} onClick={() => save(false)} className="w-full">Save without printing</Button>
          </div>
          <p className="text-center text-xs text-slate-400">Ctrl + S saves the bill</p>
        </Card>
      </div>

      <PartyModal open={newParty} kind={partyKind} onClose={() => setNewParty(false)} onSaved={async (id) => {
        setNewParty(false);
        setParty(((await api.get('/parties')) as Party[]).find((p) => p.id === id) ?? null);
        parties.reload();
      }} />
    </>
  );
}
