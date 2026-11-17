import { useEffect, useState } from 'react';
import { Ban, Check, Info, Plus, Scissors, Trash2 } from 'lucide-react';
import { api, useData } from '../api.ts';
import { Badge, Button, Card, Combo, DataTable, Empty, ErrorNote, Field, Input, Modal, Money, MoneyInput, PageHeader, Select, Spinner, cx, fieldCls, inputCls, useApp, useLocations } from '../ui.tsx';
import { variantLabel } from './VoucherForm.tsx';
import type { Variant } from './VoucherForm.tsx';
import { MODE_LABEL } from './Parties.tsx';
import type { Party } from './Parties.tsx';
import { PAY_MODES, fmtDate, fmtMoney, fmtNum, today } from '../../shared/calc.ts';

const STATUS: Record<string, [string, 'amber' | 'green' | 'red']> = { open: ['In production', 'amber'], done: ['Done', 'green'], cancelled: ['Cancelled', 'red'] };
type QLine = { v: Variant; qty: string };

/** The live "cost per piece" panel, shared by the new sheet and the completion step. */
function CostPanel({ material, labour, other, pieces }: { material: number; labour: number; other: number; pieces: number }) {
  const total = material + labour + other;
  const each = (x: number) => (pieces > 0 ? fmtMoney(Math.round(x / pieces)) : '–');
  const row = (label: string, v: number) => <div className="flex justify-between text-sm text-slate-600"><span>{label}</span><span className="num">{fmtMoney(v)} <span className="ml-2 inline-block w-20 text-right text-xs text-slate-400">{each(v)} / pc</span></span></div>;
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="space-y-1.5">{row('Raw material', material)}{row('Labour', labour)}{row('Factory other costs', other)}</div>
      <div className="mt-3 flex items-end justify-between border-t border-slate-200 pt-3">
        <div><p className="text-xs text-slate-500">Total {fmtMoney(total)} ÷ {fmtNum(pieces)} pieces</p><p className="text-sm font-medium text-slate-700">Cost per piece</p></div>
        <p className="num text-3xl font-semibold tracking-tight text-slate-900">{each(total)}</p>
      </div>
    </div>
  );
}

function QtyList({ lines, setLines, showCost }: { lines: QLine[]; setLines: (f: (ls: QLine[]) => QLine[]) => void; showCost?: boolean }) {
  return (
    <div className="mt-2 divide-y divide-slate-100">
      {lines.map((l, i) => (
        <div key={l.v.id} className="flex items-center gap-3 py-1.5 text-sm">
          <div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-900">{variantLabel(l.v)}</p>
            {showCost && <p className={cx('text-xs', Number(l.qty) > l.v.stock ? 'font-medium text-rose-600' : 'text-slate-500')}>{fmtNum(l.v.stock)} {l.v.unit} in stock · {fmtMoney(Math.round(l.v.avg_cost))} per {l.v.unit}</p>}</div>
          <input type="number" min="0" step="any" value={l.qty} onFocus={(e) => e.target.select()} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className={fieldCls('num h-9 w-24 text-right')} aria-label="Quantity" />
          <span className="w-8 text-xs text-slate-500">{l.v.unit}</span>
          {showCost && <span className="num w-24 text-right text-slate-700">{fmtMoney(Math.round((Number(l.qty) || 0) * l.v.avg_cost))}</span>}
          <button type="button" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}

function NewSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const locs = useLocations();
  const { toast } = useApp();
  const godown = String(locs.find((l) => l.kind === 'factory')?.id ?? locs.find((l) => l.kind === 'godown')?.id ?? locs[0]?.id ?? '');
  const [f, setF] = useState({ date: today(), from: godown, to: godown, party: '', labour: 0, other: 0, mode: 'cash', notes: '' });
  const [inputs, setInputs] = useState<QLine[]>([]);
  const [outputs, setOutputs] = useState<QLine[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { if (open) { setF({ date: today(), from: godown, to: godown, party: '', labour: 0, other: 0, mode: 'cash', notes: '' }); setInputs([]); setOutputs([]); setError(''); } }, [open]);
  const variants = useData<Variant[]>(open && f.from ? `/variants?location=${f.from}` : null);
  const parties = useData<Party[]>(open ? '/parties' : null);
  const add = (set: typeof setInputs) => (v: Variant) => set((ls) => (ls.some((l) => l.v.id === v.id) ? ls : [...ls, { v, qty: '' }]));
  const material = Math.round(inputs.reduce((t, l) => t + (Number(l.qty) || 0) * l.v.avg_cost, 0));
  const pieces = outputs.reduce((t, l) => t + (Number(l.qty) || 0), 0);

  async function save(complete: boolean) {
    setBusy(complete ? 'done' : 'open'); setError('');
    try {
      const r = await api.post('/productions', {
        date: f.date, from_location_id: Number(f.from), to_location_id: Number(f.to), party_id: f.party || null, labour_cost: f.labour, other_cost: f.other, pay_mode: f.mode, notes: f.notes, complete,
        inputs: inputs.filter((l) => Number(l.qty) > 0).map((l) => ({ variant_id: l.v.id, qty: Number(l.qty) })),
        outputs: outputs.filter((l) => Number(l.qty) > 0).map((l) => ({ variant_id: l.v.id, qty: Number(l.qty) })),
      });
      toast(complete ? `${r.number} done: ${fmtNum(pieces)} pieces added to stock` : `${r.number} saved as in production`);
      onDone();
    } catch (e: any) { setError(e.message); } finally { setBusy(''); }
  }
  const all = variants.data ?? [];
  const step = (n: number, title: string, hint: string) => <div className="mb-2"><p className="text-sm font-semibold text-slate-900"><span className="mr-2 inline-grid size-5 place-items-center rounded-full bg-brand text-xs text-white">{n}</span>{title}</p><p className="ml-7 text-xs text-slate-500">{hint}</p></div>;

  return (
    <Modal open={open} onClose={onClose} size="xl" title="New production cost sheet"
      footer={<><Button onClick={onClose}>Cancel</Button><Button busy={busy === 'open'} disabled={!!busy} onClick={() => save(false)}>Save as in production</Button><Button variant="primary" icon={Check} busy={busy === 'done'} disabled={!!busy} onClick={() => save(true)}>Complete and add to stock</Button></>}>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date"><Input type="date" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Stitched by"><Select value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })}><option value="">Own factory (in-house)</option>{(parties.data ?? []).filter((p) => p.kind === 'jobworker').map((p) => <option key={p.id} value={p.id}>{p.name} (job worker)</option>)}</Select></Field>
            <Field label="Raw material taken from"><Select value={f.from} onChange={(e) => { setF({ ...f, from: e.target.value }); setInputs([]); }}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label="Finished pieces go to"><Select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          </div>
          <div>
            {step(1, 'Raw material used', 'Fabric, buttons, labels. Valued at your average purchase cost.')}
            <Combo items={all.filter((v) => v.kind === 'raw' && !inputs.some((l) => l.v.id === v.id))} text={(v) => `${v.item} ${v.colour} ${v.sku}`} onPick={add(setInputs)} placeholder="Search raw material"
              render={(v) => <div className="flex justify-between gap-3"><span className="font-medium">{variantLabel(v)}</span><span className="text-xs text-slate-500">{fmtNum(v.stock)} {v.unit} in stock</span></div>} />
            <QtyList lines={inputs} setLines={setInputs} showCost />
          </div>
          <div>
            {step(2, 'Labour and factory other costs', f.party ? 'Labour is added to what you owe the job worker. Pay it later from Parties.' : 'Stitching wages and anything else spent on this lot.')}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Labour (total)"><MoneyInput value={f.labour} onChange={(labour) => setF({ ...f, labour })} /></Field>
              <Field label="Factory other costs"><MoneyInput value={f.other} onChange={(other) => setF({ ...f, other })} /></Field>
              <Field label="Paid by"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{PAY_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</Select></Field>
            </div>
          </div>
          <div>
            {step(3, 'Pieces made', 'The clothes this lot produced, by size and colour.')}
            <Combo items={all.filter((v) => v.kind === 'finished' && !outputs.some((l) => l.v.id === v.id))} text={(v) => `${v.item} ${v.size} ${v.colour} ${v.sku}`} onPick={add(setOutputs)} placeholder="Search item made" />
            <QtyList lines={outputs} setLines={setOutputs} />
          </div>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <CostPanel material={material} labour={f.labour} other={f.other} pieces={pieces} />
          <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800"><Info className="mt-0.5 size-4 shrink-0" />Costs entered here become part of the stock value and reach profit when the pieces sell. Do not enter the same labour or factory cost again under Expenses.</p>
          <Field label="Note"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Optional, e.g. lot number" /></Field>
          <ErrorNote>{error || variants.error}</ErrorNote>
        </div>
      </div>
    </Modal>
  );
}

function Sheet({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const { owner, toast } = useApp();
  const { data: p, error } = useData<any>(id ? `/productions/${id}` : null);
  const [out, setOut] = useState<Record<number, string>>({});
  const [cost, setCost] = useState({ labour: 0, other: 0, date: today() });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (p) { setOut(Object.fromEntries(p.outputs.map((o: any) => [o.variant_id, String(o.qty)]))); setCost({ labour: p.labour_cost, other: p.other_cost, date: today() }); setErr(''); } }, [p]);
  const isOpen = p?.status === 'open';
  const pieces = p ? (isOpen ? p.outputs.reduce((t: number, o: any) => t + (Number(out[o.variant_id]) || 0), 0) : p.outputs.reduce((t: number, o: any) => t + o.qty, 0)) : 0;
  async function act(fn: () => Promise<any>, message: string) {
    setBusy(true); setErr('');
    try { await fn(); toast(message); onChanged(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const complete = () => act(() => api.post(`/productions/${id}/complete`, { labour_cost: cost.labour, other_cost: cost.other, done_date: cost.date, outputs: p.outputs.map((o: any) => ({ variant_id: o.variant_id, qty: Number(out[o.variant_id]) || 0 })).filter((o: any) => o.qty > 0) }), 'Pieces added to stock');
  const cancel = () => window.confirm(`Cancel ${p.number}? Raw material goes back to stock${p.status === 'done' ? ' and the finished pieces are removed' : ''}.`) && act(() => api.post(`/productions/${id}/cancel`), 'Cost sheet cancelled');

  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={p ? `${p.number} · ${STATUS[p.status][0]}` : 'Cost sheet'}
      footer={p && p.status !== 'cancelled' ? <>{owner && <Button variant="danger" icon={Ban} disabled={busy} onClick={cancel} className="mr-auto">Cancel sheet</Button>}<Button onClick={onClose}>Close</Button>{isOpen && <Button variant="primary" icon={Check} busy={busy} onClick={complete}>Pieces received: add to stock</Button>}</> : undefined}>
      <ErrorNote>{error}</ErrorNote>
      {!p ? <Spinner /> : (
        <div className="space-y-5">
          <p className="text-sm text-slate-600">{fmtDate(p.date)} · {p.party ?? 'Own factory'} · material from {p.from_location}, pieces to {p.to_location}{p.notes && ` · ${p.notes}`}</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-500">Raw material used</p>
              {p.inputs.length ? p.inputs.map((l: any) => <div key={l.variant_id} className="flex justify-between border-t border-slate-100 py-1.5 text-sm first:border-0"><span>{variantLabel(l)}</span><span className="num text-slate-600">{fmtNum(l.qty)} {l.unit} × {fmtMoney(Math.round(l.unit_cost))}</span></div>) : <p className="text-sm text-slate-500">None</p>}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-500">{isOpen ? 'Pieces received (change if the count differs)' : 'Pieces made'}</p>
              {p.outputs.map((l: any) => (
                <div key={l.variant_id} className="flex items-center justify-between gap-3 border-t border-slate-100 py-1.5 text-sm first:border-0"><span>{variantLabel(l)}</span>
                  {isOpen ? <input type="number" min="0" value={out[l.variant_id] ?? ''} onChange={(e) => setOut({ ...out, [l.variant_id]: e.target.value })} className={fieldCls('num h-8 w-20 text-right')} aria-label="Pieces" /> : <span className="num text-slate-600">{fmtNum(l.qty)} pcs</span>}
                </div>
              ))}
            </div>
          </div>
          {isOpen && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Labour (final)"><MoneyInput value={cost.labour} onChange={(labour) => setCost({ ...cost, labour })} /></Field>
              <Field label="Factory other costs (final)"><MoneyInput value={cost.other} onChange={(other) => setCost({ ...cost, other })} /></Field>
              <Field label="Received on"><Input type="date" value={cost.date} min={p.date} max={today()} onChange={(e) => setCost({ ...cost, date: e.target.value })} /></Field>
            </div>
          )}
          <CostPanel material={p.material_cost} labour={isOpen ? cost.labour : p.labour_cost} other={isOpen ? cost.other : p.other_cost} pieces={pieces} />
          <ErrorNote>{err}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}

export default function Production() {
  const { data, error, reload } = useData<any[]>('/productions');
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<number | null>(null);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner />;
  return (
    <>
      <PageHeader title="Production" subtitle="Cost sheets: raw material + labour + factory other costs, divided by pieces made, gives the cost per piece.">
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New cost sheet</Button>
      </PageHeader>
      <Card>
        {data.length ? (
          <DataTable rows={data} onRow={(p) => setView(p.id)} columns={[
            { key: 'number', label: 'Sheet', className: 'whitespace-nowrap', render: (p) => <div><p className="font-medium text-slate-900">{p.number}</p><p className="text-xs text-slate-500">{fmtDate(p.date)}</p></div> },
            { key: 'items', label: 'Made', className: 'min-w-52', render: (p) => <div><p>{p.items ?? '–'}</p><p className="text-xs text-slate-500">{p.party ?? 'Own factory'} · to {p.to_location}</p></div> },
            { key: 'pieces', label: 'Pieces', right: true, render: (p) => fmtNum(p.pieces) },
            { key: 'material_cost', label: 'Raw material', right: true, render: (p) => <Money value={p.material_cost} /> },
            { key: 'labour_cost', label: 'Labour', right: true, render: (p) => <Money value={p.labour_cost} /> },
            { key: 'other_cost', label: 'Other', right: true, render: (p) => <Money value={p.other_cost} /> },
            { key: 'each', label: 'Cost / piece', right: true, render: (p) => <span className="font-semibold text-slate-900">{p.pieces ? fmtMoney(Math.round(p.total_cost / p.pieces)) : '–'}</span> },
            { key: 'status', label: 'Status', className: 'whitespace-nowrap', render: (p) => <Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge> },
          ]} />
        ) : <Empty icon={Scissors} title="No cost sheets yet">When a lot is stitched, enter the fabric used, the labour and other factory costs, and the pieces made. The app works out the cost of each piece.</Empty>}
      </Card>
      <NewSheet open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />
      <Sheet id={view} onClose={() => setView(null)} onChanged={() => { setView(null); reload(); }} />
    </>
  );
}
