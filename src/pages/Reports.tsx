import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChartColumn, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { qs, useData } from '../api.ts';
import { Button, Card, Empty, ErrorNote, PageHeader, RangePicker, Select, Spinner, StorePicker, cx, rangeOf, useApp } from '../ui.tsx';
import { CHANNELS, CHANNEL_LABEL, fmtDate, fmtMoney, fmtNum } from '../../shared/calc.ts';

interface Def { name: string; title: string; group: string; about: string; filters: string[] }
interface Col { key: string; label: string; type?: string }
const GROUPS = ['Sales', 'Stock', 'Money', 'Profit'];

function show(c: { type?: string }, v: any) {
  if (v == null || v === '') return <span className="text-slate-300">–</span>;
  if (typeof v !== 'number') return c.type === 'date' ? fmtDate(v) : v;
  if (c.type === 'money') return <span className={v < 0 ? 'text-rose-600' : undefined}>{fmtMoney(v)}</span>;
  if (c.type === 'pct') return `${fmtNum(v)}%`;
  return fmtNum(v);
}

export default function Reports() {
  const { business } = useApp();
  const name = useParams().name ?? 'daily_sales';
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const catalog = useData<Def[]>('/reports');
  const def = catalog.data?.find((r) => r.name === name) ?? (name === 'party_statement' ? { name, title: 'Party Statement', group: 'Money', about: '', filters: ['range'] } : undefined);

  const preset = rangeOf(sp.get('preset') ?? 'month');
  const f = { from: sp.get('from') ?? preset.from, to: sp.get('to') ?? preset.to, store: sp.get('store') ?? '', channel: sp.get('channel') ?? '', party: sp.get('party') ?? '' };
  const set = (patch: Record<string, string>) => setSp((old) => { const n = new URLSearchParams(old); n.delete('preset'); for (const [k, v] of Object.entries({ from: f.from, to: f.to, ...patch })) v ? n.set(k, v) : n.delete(k); return n; }, { replace: true });
  const query = qs(f);
  const { data: r, error, loading } = useData<any>(def ? `/reports/${name}${query}` : null);
  // Long reports draw 500 rows first so the page stays quick; totals always cover every row.
  const [shown, setShown] = useState(500);
  useEffect(() => setShown(500), [name, query]);
  const has = (x: string) => def?.filters.includes(x);
  const download = (format: string) => { window.location.href = `/api/reports/${name}${qs({ ...f, format })}`; };
  const numeric = (c: Col) => c.type === 'money' || c.type === 'num' || c.type === 'pct';

  return (
    <>
      {r && r.columns.length > 7 && <style>{'@media print { @page { size: A4 landscape; margin: 8mm; } }'}</style>}
      <PageHeader title="Reports" subtitle="Pick a report, set the period, then save it as Excel, Word or PDF." />
      <div className="print-grid grid gap-5 lg:grid-cols-[15rem_1fr]">
        <Card className="no-print hidden h-fit p-2 lg:block">
          {GROUPS.map((g) => (
            <div key={g} className="mb-1">
              <p className="px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{g}</p>
              {(catalog.data ?? []).filter((x) => x.group === g).map((x) => (
                <NavLink key={x.name} to={`/reports/${x.name}`} title={x.about} className={({ isActive }) => cx('block rounded-lg px-3 py-1.5 text-sm', isActive || (x.name === name) ? 'bg-brand/10 font-medium text-brand' : 'text-slate-700 hover:bg-slate-50')}>{x.title}</NavLink>
              ))}
            </div>
          ))}
        </Card>

        <div className="min-w-0">
          <Card className="no-print mb-4 flex flex-wrap items-center gap-3 p-4">
            <Select className="w-full lg:hidden" value={name} onChange={(e) => nav(`/reports/${e.target.value}`)} aria-label="Report">
              {(catalog.data ?? []).map((x) => <option key={x.name} value={x.name}>{x.group}: {x.title}</option>)}
            </Select>
            {has('range') && <RangePicker value={f} onChange={(range) => set({ ...range })} />}
            {has('store') && <StorePicker value={f.store} onChange={(store) => set({ store })} />}
            {has('channel') && <Select className="w-auto" value={f.channel} onChange={(e) => set({ channel: e.target.value })} aria-label="Channel"><option value="">All channels</option>{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</Select>}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button icon={FileSpreadsheet} disabled={!r} onClick={() => download('xlsx')}>Excel</Button>
              <Button icon={FileText} disabled={!r} onClick={() => download('docx')}>Word</Button>
              <Button icon={Printer} disabled={!r} onClick={() => window.print()}>PDF / Print</Button>
            </div>
          </Card>

          <ErrorNote>{error || catalog.error}</ErrorNote>
          {catalog.data && !def ? <Card><Empty icon={ChartColumn} title="This report is not available">It does not exist, or only the owner can open it. Pick another report from the list.</Empty></Card> : !r ? !error && <Spinner /> : (
            <Card className={cx('print-plain print-compact', loading && 'opacity-60')}>
              <div className="px-5 pt-5 pb-4">
                <p className="print-only text-lg font-bold text-slate-900">{business.name}</p>
                <h2 className="text-lg font-semibold text-slate-900">{r.title}</h2>
                <p className="text-sm text-slate-500">{r.subtitle}</p>
                {def?.about && <p className="no-print mt-1 max-w-3xl text-xs text-slate-400">{def.about}</p>}
                {r.summary?.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
                    {r.summary.map((s: any) => <div key={s.label}><p className="text-xs text-slate-500">{s.label}</p><p className="num text-xl font-semibold tracking-tight text-slate-900">{show(s, s.value)}</p></div>)}
                  </div>
                )}
              </div>
              {r.rows.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-y border-slate-200 bg-slate-50/70 text-xs text-slate-600">
                      {r.columns.map((c: Col) => <th key={c.key} className={cx('px-4 py-2.5 font-medium whitespace-nowrap', numeric(c) ? 'text-right' : 'text-left')}>{c.label}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {r.rows.slice(0, shown).map((row: any, i: number) => (
                        <tr key={i} className={cx(row._bold && 'bg-slate-50/70 font-semibold text-slate-900')}>
                          {r.columns.map((c: Col) => <td key={c.key} className={cx('px-4 py-2', numeric(c) && 'num text-right whitespace-nowrap')}>{show(c, row[c.key])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                    {r.totals && (
                      <tfoot><tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
                        {r.columns.map((c: Col) => <td key={c.key} className={cx('px-4 py-2.5', numeric(c) && 'num text-right whitespace-nowrap')}>{r.totals[c.key] == null ? '' : show(c, r.totals[c.key])}</td>)}
                      </tr></tfoot>
                    )}
                  </table>
                  {r.rows.length > shown && (
                    <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <span>Showing the first {fmtNum(shown)} of {fmtNum(r.rows.length)} rows. The totals cover every row. Excel has the full list.</span>
                      <span className="flex gap-2"><Button size="sm" onClick={() => setShown((n) => n + 2000)}>Show 2,000 more</Button><Button size="sm" onClick={() => setShown(r.rows.length)}>Show all (also for printing)</Button></span>
                    </div>
                  )}
                </div>
              ) : <Empty icon={ChartColumn} title="Nothing to show for this period">Try a wider date range or remove a filter.</Empty>}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
