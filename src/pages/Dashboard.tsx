import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownLeft, ArrowUpRight, Boxes, IndianRupee, Lightbulb, Plus, RefreshCw, Sparkles, TrendingUp, TriangleAlert, Wallet } from 'lucide-react';
import { qs, useData } from '../api.ts';
import { Badge, Button, Card, CardTitle, ErrorNote, Money, PageHeader, Spinner, Stat, StorePicker, useApp } from '../ui.tsx';
import { CHANNEL_LABEL, fmtDate, fmtMoney, fmtMoney0, fmtNum } from '../../shared/calc.ts';

const short = (paise: number) => { const r = paise / 100; return r >= 1e5 ? `₹${+(r / 1e5).toFixed(1)}L` : r >= 1e3 ? `₹${Math.round(r / 1e3)}k` : `₹${Math.round(r)}`; };

/** Horizontal bars with the name and value written on each row: no legend to decode. */
function Bars({ rows, empty }: { rows: { label: string; value: number; note?: string }[]; empty: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.some((r) => r.value > 0)) return <p className="px-5 pb-5 text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-3 px-5 pb-5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><span className="text-slate-700">{r.label}</span><span className="num ml-auto shrink-0 font-medium text-slate-900">{fmtMoney0(r.value)}{r.note && <span className="ml-1.5 text-xs font-normal text-slate-500">{r.note}</span>}</span></div>
          <div className="mt-1.5 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand" style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 1.5 : 0)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Insights({ store }: { store: string }) {
  const { aiReady } = useApp();
  const [refresh, setRefresh] = useState(0);
  const { data, error, loading } = useData<any>(aiReady ? `/ai/insights${qs({ store, refresh: refresh ? 1 : '', n: refresh || '' })}` : null);
  const list = (title: string, items: string[], icon: ReactNode) => items?.length > 0 && (
    <div><p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p><ul className="space-y-2">{items.map((t, i) => <li key={i} className="flex gap-2 text-sm text-slate-700">{icon}<span>{t}</span></li>)}</ul></div>
  );
  return (
    <Card className="lg:col-span-3">
      <CardTitle action={aiReady && <Button size="sm" variant="ghost" icon={RefreshCw} busy={loading} onClick={() => setRefresh((n) => n + 1)}>Refresh</Button>}>
        <span className="flex items-center gap-2"><Sparkles className="size-4 text-brand" />AI insights · last 30 days</span>
      </CardTitle>
      <div className="px-5 pb-5">
        {!aiReady ? (
          <p className="text-sm text-slate-600">Connect a free AI model (Groq, OpenRouter, DeepSeek, Qwen, Kimi and others) to get a daily summary of what is selling, what is stuck and what to do next. <Link to="/settings?tab=ai" className="font-medium text-brand hover:underline">Set it up in Settings</Link></p>
        ) : error ? <ErrorNote>{error}</ErrorNote> : !data ? <p className="text-sm text-slate-500">Reading your reports…</p> : data.text ? <p className="whitespace-pre-wrap text-sm text-slate-700">{data.text}</p> : (
          <div className="grid gap-6 md:grid-cols-2">
            {list('What the numbers say', data.findings, <TrendingUp className="mt-0.5 size-4 shrink-0 text-slate-400" />)}
            {list('Do this week', data.actions, <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" />)}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { owner, user } = useApp();
  const nav = useNavigate();
  const [store, setStore] = useState('');
  const { data: d, error } = useData<any>(`/dashboard${qs({ store })}`);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!d) return <Spinner />;
  const delta = d.yesterday.sales ? Math.round(((d.today.sales - d.yesterday.sales) / d.yesterday.sales) * 100) : null;

  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(' ')[0]}`} subtitle={fmtDate(d.trend.at(-1).date)}>
        <StorePicker value={store} onChange={setStore} all="All stores" />
        <Button icon={Plus} onClick={() => nav('/purchases/new')}>Purchase</Button>
        <Button variant="primary" icon={Plus} onClick={() => nav('/sales/new')}>New sale</Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Today's sales" value={fmtMoney0(d.today.sales)} icon={IndianRupee}
          sub={<>{d.today.bills} {d.today.bills === 1 ? 'bill' : 'bills'}{delta != null && <span className={delta >= 0 ? 'ml-2 text-emerald-700' : 'ml-2 text-rose-600'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs yesterday</span>}</>} />
        <Stat label="This month" value={fmtMoney0(d.month.sales)} sub={`${d.month.bills} bills`} icon={TrendingUp} />
        {owner ? <Stat label="Net profit this month" value={fmtMoney0(d.monthProfit)} sub={d.month.sales ? `${Math.round((d.monthProfit / d.month.sales) * 100)}% of sales` : 'After all costs'} icon={Wallet} tone={d.monthProfit >= 0 ? 'green' : 'red'} />
          : <Stat label="Pieces in stock" value={fmtNum(d.stockUnits)} sub="Clothes and shoes" icon={Boxes} />}
        <Stat label="You'll get" value={fmtMoney0(d.receivable)} sub={owner ? <>You'll give <Money value={d.payable} /></> : 'From customers'} icon={ArrowDownLeft} tone="amber" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle action={<Link to="/reports/daily_sales" className="text-xs font-medium text-brand hover:underline">Daily sales report</Link>}>Sales, last 14 days</CardTitle>
          <div className="h-64 px-2 pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.trend} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={(v) => String(Number(v.slice(8)))} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tickFormatter={short} tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip cursor={{ fill: 'rgb(15 23 42 / 0.05)' }} content={({ active, payload }) => active && payload?.length ? (
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"><p className="text-slate-500">{fmtDate(payload[0].payload.date)}</p><p className="num mt-0.5 text-sm font-semibold text-slate-900">{fmtMoney(payload[0].payload.sales)}</p></div>
                ) : null} />
                <Bar dataKey="sales" fill="var(--brand)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardTitle>Channels, last 30 days</CardTitle>
          <Bars rows={d.channels.map((c: any) => ({ label: c.label, value: c.sales }))} empty="No sales in the last 30 days." />
        </Card>

        {owner && <Insights store={store} />}

        <Card>
          <CardTitle action={<Link to="/reports/movers" className="text-xs font-medium text-brand hover:underline">All items</Link>}>Best sellers, last 30 days</CardTitle>
          <Bars rows={d.topItems.map((i: any) => ({ label: i.item, value: i.sales, note: `${fmtNum(i.units)} pcs` }))} empty="Nothing sold yet." />
        </Card>
        {d.stores.length > 0 && (
          <Card>
            <CardTitle action={<Link to="/reports/store_comparison" className="text-xs font-medium text-brand hover:underline">Compare stores</Link>}>Stores, last 30 days</CardTitle>
            <Bars rows={d.stores.map((s: any) => ({ label: s.name, value: s.sales }))} empty="No sales yet." />
          </Card>
        )}
        <Card>
          <CardTitle action={<Link to="/stock" className="text-xs font-medium text-brand hover:underline">Open stock</Link>}>
            <span className="flex items-center gap-2">Running low{d.lowStockCount > 0 && <Badge tone="amber">{d.lowStockCount}</Badge>}</span>
          </CardTitle>
          {d.lowStock.length ? (
            <ul className="divide-y divide-slate-100 px-5 pb-3">
              {d.lowStock.map((l: any) => <li key={l.sku} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="truncate text-slate-700">{[l.item, l.size, l.colour].filter(Boolean).join(' · ')}</span><span className="num flex shrink-0 items-center gap-1.5 font-medium text-amber-700"><TriangleAlert className="size-3.5" />{fmtNum(l.stock)} left</span></li>)}
            </ul>
          ) : <p className="px-5 pb-5 text-sm text-slate-500">Every item is above its alert level.</p>}
        </Card>
        <Card className={d.stores.length ? 'lg:col-span-3' : ''}>
          <CardTitle action={<Link to="/sales" className="text-xs font-medium text-brand hover:underline">All sales</Link>}>Latest bills</CardTitle>
          {d.recent.length ? (
            <ul className="divide-y divide-slate-100 px-5 pb-3">
              {d.recent.map((v: any) => (
                <li key={v.id}><Link to={`/vouchers/${v.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-brand">
                  <span className="min-w-0 truncate"><span className="font-medium text-slate-900">{v.number}</span><span className="ml-2 text-slate-500">{v.party} · {CHANNEL_LABEL[v.channel]} · {fmtDate(v.date)}</span></span>
                  <span className="num flex shrink-0 items-center gap-1 font-medium text-slate-900">{fmtMoney(v.total)}<ArrowUpRight className="size-3.5 text-slate-400" /></span>
                </Link></li>
              ))}
            </ul>
          ) : <p className="px-5 pb-5 text-sm text-slate-500">No bills yet. Press New sale to make the first one.</p>}
        </Card>
      </div>
    </>
  );
}
