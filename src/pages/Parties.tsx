import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, FileText, Pencil, Plus, Users } from 'lucide-react';
import { api, useData } from '../api.ts';
import { Badge, Button, Card, DataTable, Empty, ErrorNote, Field, Input, Modal, Money, MoneyInput, PageHeader, SearchBox, Segmented, Select, Spinner, Stat, useApp } from '../ui.tsx';
import { PAY_MODES, fmtMoney, today } from '../../shared/calc.ts';

export interface Party { id: number; name: string; kind: 'customer' | 'supplier' | 'jobworker'; phone: string; address: string; state: string; gstin: string; opening_balance: number; balance: number }
const KIND = { customer: 'Customer', supplier: 'Supplier', jobworker: 'Job worker' };
export const MODE_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank' };

export function PartyModal({ open, onClose, onSaved, party, kind = 'customer' }: { open: boolean; onClose: () => void; onSaved: (id: number) => void; party?: Party | null; kind?: Party['kind'] }) {
  const { billing, toast } = useApp();
  const blank = { name: '', kind, phone: '', address: '', state: '', gstin: '', opening: 0, owesMe: kind === 'customer' };
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setError('');
    setF(party ? { ...party, opening: Math.abs(party.opening_balance), owesMe: party.opening_balance >= 0 } : blank);
  }, [open, party, kind]);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true); setError('');
    try {
      const body = { ...f, opening_balance: f.owesMe ? f.opening : -f.opening };
      const r = party ? await api.put(`/parties/${party.id}`, body) : await api.post('/parties', body);
      toast(party ? 'Party updated' : 'Party added');
      onSaved(r.id);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={party ? 'Edit party' : 'New party'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Type"><Select value={f.kind} onChange={set('kind')}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={set('address')} /></Field>
        <Field label="State"><Input value={f.state} onChange={set('state')} placeholder="e.g. West Bengal" /></Field>
        {billing.gstEnabled && <Field label="GSTIN"><Input value={f.gstin} onChange={set('gstin')} maxLength={15} /></Field>}
        <Field label="Old balance (before using this app)"><MoneyInput value={f.opening} onChange={(v) => setF({ ...f, opening: v })} /></Field>
        <Field label="Who owes"><Select value={f.owesMe ? '1' : '0'} onChange={(e) => setF({ ...f, owesMe: e.target.value === '1' })}><option value="1">They owe me</option><option value="0">I owe them</option></Select></Field>
      </div>
      <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>
    </Modal>
  );
}

/** Money received from or paid to a party; optionally against one bill. */
export function PaymentModal({ open, onClose, onSaved, title, partyId, voucherId, direction, suggest = 0 }: {
  open: boolean; onClose: () => void; onSaved: () => void; title: string; partyId?: number; voucherId?: number; direction: 'in' | 'out'; suggest?: number;
}) {
  const { toast } = useApp();
  const [f, setF] = useState({ date: today(), amount: 0, mode: 'cash', note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ date: today(), amount: Math.max(suggest, 0), mode: 'cash', note: '' }); setError(''); } }, [open, suggest]);
  async function save() {
    setBusy(true); setError('');
    try {
      await api.post('/payments', { ...f, party_id: partyId, voucher_id: voucherId, direction });
      toast(`${fmtMoney(f.amount)} ${direction === 'in' ? 'received' : 'paid'}`);
      onSaved();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save payment</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount"><MoneyInput value={f.amount} onChange={(amount) => setF({ ...f, amount })} autoFocus /></Field>
        <Field label="Date"><Input type="date" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Paid by"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{PAY_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</Select></Field>
        <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Optional" /></Field>
      </div>
      <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>
    </Modal>
  );
}

export const Balance = ({ value }: { value: number }) =>
  value > 0 ? <span className="text-emerald-700"><Money value={value} /> <span className="text-xs">you'll get</span></span>
    : value < 0 ? <span className="text-rose-600"><Money value={-value} /> <span className="text-xs">you'll give</span></span>
      : <span className="text-slate-400">Settled</span>;

export default function Parties() {
  const { data, error, reload } = useData<Party[]>('/parties');
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Party | null | undefined>(undefined); // undefined = closed, null = new
  const [pay, setPay] = useState<{ party: Party; direction: 'in' | 'out' } | null>(null);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner />;
  const rows = data.filter((p) => (tab === 'all' || p.kind === tab) && `${p.name} ${p.phone}`.toLowerCase().includes(q.toLowerCase()));
  const get = data.reduce((t, p) => t + Math.max(p.balance, 0), 0);
  const give = data.reduce((t, p) => t + Math.max(-p.balance, 0), 0);

  return (
    <>
      <PageHeader title="Parties" subtitle="Customers, suppliers and job workers with their running balance.">
        <Button variant="primary" icon={Plus} onClick={() => setEdit(null)}>New party</Button>
      </PageHeader>
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <Stat label="You'll get" value={fmtMoney(get)} sub="Customers owe you" icon={ArrowDownLeft} tone="green" />
        <Stat label="You'll give" value={fmtMoney(give)} sub="You owe suppliers and job workers" icon={ArrowUpRight} tone="red" />
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <Segmented value={tab} onChange={setTab} options={[{ value: 'all', label: 'All' }, { value: 'customer', label: 'Customers' }, { value: 'supplier', label: 'Suppliers' }, { value: 'jobworker', label: 'Job workers' }]} />
          <SearchBox value={q} onChange={setQ} placeholder="Search name or phone" />
        </div>
        {rows.length ? (
          <DataTable rows={rows} columns={[
            { key: 'name', label: 'Party', render: (p) => <div><p className="font-medium text-slate-900">{p.name}</p><p className="text-xs text-slate-500">{p.phone || 'No phone'}</p></div> },
            { key: 'kind', label: 'Type', render: (p) => <Badge>{KIND[p.kind]}</Badge> },
            { key: 'balance', label: 'Balance', right: true, render: (p) => <Balance value={p.balance} /> },
            { key: 'act', label: '', right: true, render: (p) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" icon={ArrowDownLeft} onClick={() => setPay({ party: p, direction: 'in' })}>Receive</Button>
                <Button size="sm" icon={ArrowUpRight} onClick={() => setPay({ party: p, direction: 'out' })}>Pay</Button>
                <Link to={`/reports/party_statement?party=${p.id}&preset=year`} title="Statement" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><FileText className="size-4" /></Link>
                <button type="button" title="Edit" onClick={() => setEdit(p)} className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><Pencil className="size-4" /></button>
              </div>
            ) },
          ]} />
        ) : <Empty icon={Users} title="No parties here yet">Add a customer for credit bills, a supplier for purchases, or a job worker for stitching.</Empty>}
      </Card>
      <PartyModal open={edit !== undefined} party={edit} onClose={() => setEdit(undefined)} onSaved={() => { setEdit(undefined); reload(); }} />
      <PaymentModal open={!!pay} onClose={() => setPay(null)} onSaved={() => { setPay(null); reload(); }} partyId={pay?.party.id} direction={pay?.direction ?? 'in'}
        title={pay ? `${pay.direction === 'in' ? 'Receive from' : 'Pay to'} ${pay.party.name}` : ''}
        suggest={pay ? (pay.direction === 'in' ? pay.party.balance : -pay.party.balance) : 0} />
    </>
  );
}
