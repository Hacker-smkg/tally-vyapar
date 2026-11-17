import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Boxes, Printer, Scissors, SlidersHorizontal, Trash2, TriangleAlert, Wallet, X } from 'lucide-react';
import { api, useData } from '../api.ts';
import { Badge, Button, Card, Combo, DataTable, Empty, ErrorNote, Field, Input, Modal, PageHeader, SearchBox, Segmented, Select, Spinner, Stat, Toggle, cx, fieldCls, inputCls, useApp, useLocations } from '../ui.tsx';
import { variantLabel } from './VoucherForm.tsx';
import type { Variant } from './VoucherForm.tsx';
import { fmtDate, fmtMoney, fmtNum, today } from '../../shared/calc.ts';

const REASON: Record<string, string> = { opening: 'Opening stock', purchase: 'Purchase', sale: 'Sale', sale_return: 'Sale return', purchase_return: 'Purchase return', transfer: 'Transfer', adjust: 'Adjustment', production_in: 'Made in production', production_out: 'Used in production' };
interface Slip { date: string; from: string; to: string; note: string; lines: { name: string; sku: string; qty: number }[] }

function TransferModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (slip: Slip) => void }) {
  const locs = useLocations();
  const { toast } = useApp();
  const [f, setF] = useState({ date: today(), from: '', to: '', note: '' });
  const [lines, setLines] = useState<{ v: Variant; qty: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const from = locs.find((l) => l.kind === 'godown') ?? locs[0];
    setF({ date: today(), from: String(from?.id ?? ''), to: String(locs.find((l) => l.id !== from?.id)?.id ?? ''), note: '' });
    setLines([]); setError('');
  }, [open]);
  const variants = useData<Variant[]>(open && f.from ? `/variants?location=${f.from}` : null);
  const name = (id: string) => locs.find((l) => String(l.id) === id)?.name ?? '';

  async function save() {
    setBusy(true); setError('');
    try {
      await api.post('/stock/transfer', { ...f, from: Number(f.from), to: Number(f.to), lines: lines.map((l) => ({ variant_id: l.v.id, qty: Number(l.qty) })) });
      toast('Stock transferred');
      onDone({ date: f.date, from: name(f.from), to: name(f.to), note: f.note, lines: lines.map((l) => ({ name: variantLabel(l.v), sku: l.v.sku, qty: Number(l.qty) })) });
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Transfer stock"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!lines.length} onClick={save}>Transfer {lines.reduce((t, l) => t + (Number(l.qty) || 0), 0) || ''} units</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="From"><Select value={f.from} onChange={(e) => { setF({ ...f, from: e.target.value }); setLines([]); }}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="To"><Select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>{locs.filter((l) => String(l.id) !== f.from).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <div className="mt-4">
        <Combo items={(variants.data ?? []).filter((v) => v.stock > 0 && !lines.some((l) => l.v.id === v.id))} text={(v) => `${v.item} ${v.size} ${v.colour} ${v.sku}`}
          exact={(q) => variants.data?.find((v) => v.sku.toLowerCase() === q.toLowerCase())}
          onPick={(v) => setLines((ls) => (ls.some((l) => l.v.id === v.id) ? ls : [...ls, { v, qty: '1' }]))} placeholder={`Search or scan items in ${name(f.from)}`}
          render={(v) => <div className="flex justify-between gap-3"><span className="font-medium">{variantLabel(v)}</span><span className="text-xs text-slate-500">{fmtNum(v.stock)} {v.unit} here</span></div>} />
      </div>
      <div className="mt-3 divide-y divide-slate-100">
        {lines.map((l, i) => (
          <div key={l.v.id} className="flex items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-900">{variantLabel(l.v)}</p><p className={cx('text-xs', Number(l.qty) > l.v.stock ? 'font-medium text-rose-600' : 'text-slate-500')}>{fmtNum(l.v.stock)} {l.v.unit} in {name(f.from)}</p></div>
            <input type="number" min="0" step="any" value={l.qty} onFocus={(e) => e.target.select()} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className={fieldCls('num h-9 w-24 text-right')} aria-label="Quantity" />
            <Button size="sm" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: String(x.v.stock) } : x)))}>All</Button>
            <button type="button" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></button>
          </div>
        ))}
      </div>
      <Field label="Note" className="mt-3"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Optional, e.g. vehicle or person carrying" /></Field>
      <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>
    </Modal>
  );
}

function AdjustModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const locs = useLocations();
  const { toast } = useApp();
  const [loc, setLoc] = useState('');
  const [v, setV] = useState<Variant | null>(null);
  const [how, setHow] = useState('remove');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setLoc(String(locs[0]?.id ?? '')); setV(null); setHow('remove'); setQty(''); setNote(''); setError(''); } }, [open]);
  const variants = useData<Variant[]>(open && loc ? `/variants?location=${loc}` : null);
  const n = Number(qty) || 0;
  const change = how === 'remove' ? -n : how === 'add' ? n : n - (v?.stock ?? 0);
  async function save() {
    setBusy(true); setError('');
    try {
      await api.post('/stock/adjust', { date: today(), location_id: Number(loc), variant_id: v?.id, qty: change, note });
      toast('Stock adjusted'); onDone();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Adjust stock" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!v || !change} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Location"><Select value={loc} onChange={(e) => { setLoc(e.target.value); setV(null); }}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Item" hint={v ? `${fmtNum(v.stock)} ${v.unit} in stock here now` : undefined}>
          <Combo items={variants.data ?? []} text={(x) => `${x.item} ${x.size} ${x.colour} ${x.sku}`} value={v ? variantLabel(v) : undefined} onClear={() => setV(null)} onPick={setV} placeholder="Search item"
            render={(x) => <div className="flex justify-between gap-3"><span className="font-medium">{variantLabel(x)}</span><span className="text-xs text-slate-500">{fmtNum(x.stock)} {x.unit}</span></div>} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="What happened"><Select value={how} onChange={(e) => setHow(e.target.value)}><option value="remove">Remove (damaged, lost)</option><option value="add">Add (found extra)</option><option value="count">I counted the stock</option></Select></Field>
          <Field label={how === 'count' ? 'Counted quantity' : 'Quantity'} hint={v && change ? `Stock will change by ${change > 0 ? '+' : ''}${fmtNum(change)}` : undefined}><Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        </div>
        <Field label="Reason" hint="Removed stock is counted as a loss in Profit & Loss."><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Torn in transit" /></Field>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

function History({ row, onClose }: { row: any | null; onClose: () => void }) {
  const { data, error } = useData<any[]>(row ? `/stock/moves?variant=${row.variant_id}` : null);
  return (
    <Modal open={!!row} onClose={onClose} size="lg" title={row ? `${variantLabel(row)} · stock history` : ''}>
      <ErrorNote>{error}</ErrorNote>
      {!data ? <Spinner /> : (
        <DataTable rows={data} columns={[
          { key: 'date', label: 'Date', className: 'whitespace-nowrap', render: (m) => fmtDate(m.date) },
          { key: 'reason', label: 'What', render: (m) => <span>{REASON[m.reason] ?? m.reason}{m.ref && <span className="text-slate-500"> · {m.ref}</span>}{m.note && <span className="text-slate-500"> · {m.note}</span>}</span> },
          { key: 'location', label: 'Location' },
          { key: 'qty', label: 'Change', right: true, render: (m) => <span className={m.qty > 0 ? 'text-emerald-700' : 'text-rose-600'}>{m.qty > 0 ? '+' : ''}{fmtNum(m.qty)}</span> },
          { key: 'user', label: 'By', className: 'text-slate-500' },
        ]} />
      )}
    </Modal>
  );
}

export default function Stock() {
  const { owner } = useApp();
  const locs = useLocations();
  const { data, error, reload } = useData<{ rows: any[]; wip: number }>('/stock');
  const [kind, setKind] = useState<'finished' | 'raw'>('finished');
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [modal, setModal] = useState<'transfer' | 'adjust' | null>(null);
  const [history, setHistory] = useState<any | null>(null);
  const [slip, setSlip] = useState<Slip | null>(null);

  const isLow = (r: any) => r.low_stock > 0 && r.total <= r.low_stock;
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => r.kind === kind && (!lowOnly || isLow(r)) && `${r.item} ${r.size} ${r.colour} ${r.sku} ${r.cat} ${r.subcat}`.toLowerCase().includes(q.toLowerCase())), [data, kind, q, lowOnly]);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner />;
  const fin = data.rows.filter((r) => r.kind === 'finished');
  const value = data.rows.reduce((t, r) => t + r.total * r.avg_cost, 0);

  return (
    <>
      {slip && (
        <Card className="print-plain mb-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-lg font-semibold text-slate-900">Stock transfer slip</p><p className="text-sm text-slate-600">{fmtDate(slip.date)} · {slip.from} → {slip.to}{slip.note && ` · ${slip.note}`}</p></div>
            <div className="no-print flex gap-2"><Button icon={Printer} onClick={() => window.print()}>Print slip</Button><Button icon={X} variant="ghost" onClick={() => setSlip(null)}>Close</Button></div>
          </div>
          <table className="mt-4 w-full text-sm">
            <thead><tr className="border-y border-slate-200 text-left text-xs text-slate-500"><th className="py-2 font-medium">#</th><th className="py-2 font-medium">Item</th><th className="py-2 font-medium">SKU</th><th className="py-2 text-right font-medium">Qty</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{slip.lines.map((l, i) => <tr key={i}><td className="py-2 text-slate-500">{i + 1}</td><td className="py-2">{l.name}</td><td className="py-2 text-slate-600">{l.sku}</td><td className="num py-2 text-right">{fmtNum(l.qty)}</td></tr>)}</tbody>
            <tfoot><tr className="border-t border-slate-300 font-semibold"><td className="py-2" colSpan={3}>Total</td><td className="num py-2 text-right">{fmtNum(slip.lines.reduce((t, l) => t + l.qty, 0))}</td></tr></tfoot>
          </table>
          <div className="print-only mt-12 text-sm text-slate-600"><div className="flex justify-between"><span>Sent by: ____________</span><span>Received by: ____________</span></div></div>
        </Card>
      )}

      <div className={cx(slip && 'no-print')}>
        <PageHeader title="Stock" subtitle="What is lying where: godown, each store and goods still in production.">
          {owner && <Button icon={SlidersHorizontal} onClick={() => setModal('adjust')}>Adjust</Button>}
          <Button variant="primary" icon={ArrowLeftRight} onClick={() => setModal('transfer')}>Transfer stock</Button>
        </PageHeader>
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Clothes & shoes in stock" value={`${fmtNum(fin.reduce((t, r) => t + r.total, 0))} pcs`} sub={`${fin.filter((r) => r.total > 0).length} sizes/colours`} icon={Boxes} />
          {owner && <Stat label="Stock value at cost" value={fmtMoney(Math.round(value))} sub="Including raw material" icon={Wallet} tone="green" />}
          {owner && <Stat label="In production" value={fmtMoney(data.wip)} sub="Raw material with tailors" icon={Scissors} tone="amber" />}
          <Stat label="Running low" value={data.rows.filter(isLow).length} sub="At or below alert level" icon={TriangleAlert} tone="red" />
        </div>
        <Card>
          <div className="flex flex-wrap items-center gap-4 p-4">
            <Segmented value={kind} onChange={setKind} options={[{ value: 'finished', label: 'Clothes & shoes' }, { value: 'raw', label: 'Raw material' }]} />
            <Toggle checked={lowOnly} onChange={setLowOnly} label="Low stock only" />
            <div className="ml-auto"><SearchBox value={q} onChange={setQ} placeholder="Item, size, colour or SKU" /></div>
          </div>
          {rows.length ? (
            <DataTable rows={rows} rowKey={(r) => r.variant_id} onRow={setHistory} columns={[
              { key: 'item', label: 'Item', render: (r) => <div><p className="font-medium text-slate-900">{variantLabel(r)}</p><p className="text-xs text-slate-500">{r.sku} · {[r.cat, r.subcat].filter(Boolean).join(' › ')}</p></div> },
              ...locs.map((l) => ({ key: `l${l.id}`, label: l.name, right: true, render: (r: any) => (r.by[l.id] ? fmtNum(r.by[l.id]) : <span className="text-slate-300">–</span>) })),
              { key: 'total', label: 'Total', right: true, render: (r) => <span className="font-medium text-slate-900">{fmtNum(r.total)} <span className="text-xs font-normal text-slate-500">{r.unit}</span>{isLow(r) && <span className="ml-2"><Badge tone="amber">Low</Badge></span>}</span> },
              ...(owner ? [{ key: 'value', label: 'Value', right: true, render: (r: any) => fmtMoney(Math.round(r.total * r.avg_cost)) }] : []),
            ]} />
          ) : <Empty icon={Boxes} title="Nothing to show">{data.rows.length ? 'No item matches this filter.' : 'Add items, then record a purchase or a production cost sheet to bring stock in.'}</Empty>}
        </Card>
      </div>

      <TransferModal open={modal === 'transfer'} onClose={() => setModal(null)} onDone={(s) => { setModal(null); setSlip(s); reload(); }} />
      <AdjustModal open={modal === 'adjust'} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />
      <History row={history} onClose={() => setHistory(null)} />
    </>
  );
}
