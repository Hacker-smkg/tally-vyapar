import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Receipt, Undo2 } from 'lucide-react';
import { qs, useData } from '../api.ts';
import { Badge, Button, Card, DataTable, Empty, ErrorNote, Money, PageHeader, RangePicker, SearchBox, Segmented, Spinner, StorePicker, rangeOf } from '../ui.tsx';
import { CHANNEL_LABEL, fmtDate, fmtNum } from '../../shared/calc.ts';

export default function VoucherList({ kind }: { kind: 'sale' | 'purchase' }) {
  const nav = useNavigate();
  const sale = kind === 'sale';
  const [tab, setTab] = useState<'bills' | 'returns'>('bills');
  const [range, setRange] = useState(rangeOf('month'));
  const [store, setStore] = useState('');
  const [q, setQ] = useState('');
  const { data, error } = useData<any[]>(`/vouchers${qs({ type: tab === 'bills' ? kind : `${kind}_return`, ...range, store, q })}`);
  const live = (data ?? []).filter((v) => v.status === 'final');
  const total = live.reduce((t, v) => t + v.total, 0);
  const due = live.reduce((t, v) => t + (v.total - v.paid), 0);

  return (
    <>
      <PageHeader title={sale ? 'Sales' : 'Purchases'} subtitle={sale ? 'Bills from every store and channel.' : 'Fabric, trims and ready garments bought from suppliers.'}>
        <Button icon={Undo2} onClick={() => nav(`/${kind}s/new?type=return`)}>{sale ? 'Sale return' : 'Purchase return'}</Button>
        <Button variant="primary" icon={Plus} onClick={() => nav(`/${kind}s/new`)}>{sale ? 'New sale' : 'New purchase'}</Button>
      </PageHeader>
      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <Segmented value={tab} onChange={setTab} options={[{ value: 'bills', label: sale ? 'Sale bills' : 'Purchase bills' }, { value: 'returns', label: 'Returns' }]} />
          <RangePicker value={range} onChange={setRange} />
          <StorePicker value={store} onChange={setStore} />
          <div className="ml-auto"><SearchBox value={q} onChange={setQ} placeholder="Bill no. or party" /></div>
        </div>
        <ErrorNote>{error}</ErrorNote>
        {!data ? <Spinner /> : data.length ? (
          <DataTable rows={data} onRow={(v) => nav(`/vouchers/${v.id}`)} columns={[
            { key: 'date', label: 'Date', className: 'whitespace-nowrap text-slate-600', render: (v) => fmtDate(v.date) },
            { key: 'number', label: 'Bill no.', render: (v) => <span className="font-medium text-slate-900">{v.number}</span> },
            { key: 'party', label: sale ? 'Customer' : 'Supplier' },
            { key: 'location', label: 'Location', className: 'text-slate-600' },
            ...(sale ? [{ key: 'channel', label: 'Channel', render: (v: any) => <Badge tone={v.channel === 'retail' ? 'slate' : 'brand'}>{CHANNEL_LABEL[v.channel]}</Badge> }] : []),
            { key: 'units', label: 'Qty', right: true, render: (v) => fmtNum(v.units) },
            { key: 'total', label: 'Total', right: true, render: (v) => <Money value={v.total} className="font-medium text-slate-900" /> },
            { key: 'status', label: 'Status', render: (v) => v.status === 'cancelled' ? <Badge tone="red">Cancelled</Badge> : v.paid >= v.total ? <Badge tone="green">Paid</Badge> : <Badge tone="amber">Due <Money value={v.total - v.paid} className="ml-1" /></Badge> },
            { key: 'user', label: 'By', className: 'text-slate-500' },
          ]} foot={
            <tfoot><tr className="border-t border-slate-200 bg-slate-50/60 text-sm font-medium">
              <td className="px-4 py-3" colSpan={sale ? 6 : 5}>{live.length} {live.length === 1 ? 'bill' : 'bills'}{data.length >= 500 && ' (showing the latest 500)'}</td>
              <td className="num px-4 py-3 text-right"><Money value={total} /></td>
              <td className="px-4 py-3 text-slate-600" colSpan={2}>{due > 0 && <>Unpaid <Money value={due} /></>}</td>
            </tr></tfoot>
          } />
        ) : <Empty icon={Receipt} title="Nothing in this period">Change the dates above, or make a new {sale ? 'sale' : 'purchase'}.</Empty>}
      </Card>
    </>
  );
}
