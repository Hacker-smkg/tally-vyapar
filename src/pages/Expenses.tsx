import { useEffect, useState } from 'react';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { api, qs, useData } from '../api.ts';
import { Button, Card, DataTable, Empty, ErrorNote, Field, Input, Modal, Money, MoneyInput, PageHeader, RangePicker, Select, Spinner, StorePicker, rangeOf, useApp, useLocations } from '../ui.tsx';
import { MODE_LABEL } from './Parties.tsx';
import { PAY_MODES, fmtDate, fmtMoney, today } from '../../shared/calc.ts';

function ExpenseModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { billing, user, toast } = useApp();
  const locs = useLocations();
  const blank = { date: today(), category: billing.expenseCategories[0] ?? '', amount: 0, mode: 'cash', location_id: String(user.location_id ?? ''), note: '' };
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(blank); setError(''); } }, [open]);
  async function save() {
    setBusy(true); setError('');
    try { await api.post('/expenses', { ...f, location_id: f.location_id || null }); toast(`${fmtMoney(f.amount)} expense saved`); onSaved(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New expense" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save expense</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Expense head"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{billing.expenseCategories.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Amount"><MoneyInput value={f.amount} onChange={(amount) => setF({ ...f, amount })} autoFocus /></Field>
        <Field label="Date"><Input type="date" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Paid by"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{PAY_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</Select></Field>
        <Field label="For which store" hint="Used in store-wise profit.">
          <Select value={f.location_id} disabled={!!user.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}><option value="">Common (whole business)</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
        </Field>
        <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Optional" /></Field>
      </div>
      <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>
    </Modal>
  );
}

export default function Expenses() {
  const { owner, toast } = useApp();
  const [range, setRange] = useState(rangeOf('month'));
  const [store, setStore] = useState('');
  const [adding, setAdding] = useState(false);
  const { data, error, reload } = useData<any[]>(`/expenses${qs({ ...range, store })}`);
  const total = (data ?? []).reduce((t, e) => t + e.amount, 0);
  const heads = Object.entries((data ?? []).reduce<Record<string, number>>((m, e) => ({ ...m, [e.category]: (m[e.category] ?? 0) + e.amount }), {})).sort((a, b) => b[1] - a[1]);
  async function remove(e: any) {
    if (!window.confirm(`Delete this ${e.category} expense of ${fmtMoney(e.amount)}?`)) return;
    try { await api.del(`/expenses/${e.id}`); toast('Expense deleted'); reload(); } catch (x: any) { toast(x.message, 'error'); }
  }
  return (
    <>
      <PageHeader title="Expenses" subtitle="Running costs of the business: rent, salary, electricity, packing, ads.">
        <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>New expense</Button>
      </PageHeader>
      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4"><RangePicker value={range} onChange={setRange} /><StorePicker value={store} onChange={setStore} /></div>
        {heads.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Total <Money value={total} className="ml-1" /></span>
            {heads.slice(0, 6).map(([head, amt]) => <span key={head} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700">{head} <Money value={amt} className="ml-1 font-medium" /></span>)}
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        {!data ? <Spinner /> : data.length ? (
          <DataTable rows={data} columns={[
            { key: 'date', label: 'Date', className: 'whitespace-nowrap text-slate-600', render: (e) => fmtDate(e.date) },
            { key: 'category', label: 'Head', render: (e) => <span className="font-medium text-slate-900">{e.category}</span> },
            { key: 'note', label: 'Note', className: 'text-slate-600' },
            { key: 'location', label: 'Store', render: (e) => e.location ?? <span className="text-slate-400">Common</span> },
            { key: 'mode', label: 'Paid by', render: (e) => MODE_LABEL[e.mode] },
            { key: 'amount', label: 'Amount', right: true, render: (e) => <Money value={e.amount} className="font-medium text-slate-900" /> },
            { key: 'user', label: 'By', className: 'text-slate-500' },
            ...(owner ? [{ key: 'del', label: '', right: true, render: (e: any) => <button type="button" aria-label="Delete" onClick={() => remove(e)} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></button> }] : []),
          ]} />
        ) : <Empty icon={Wallet} title="No expenses in this period">Add rent, salaries and other running costs so net profit is correct.</Empty>}
      </Card>
      <ExpenseModal open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />
    </>
  );
}
