// The small UI kit every screen is built from. One look, one place to change it.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ComponentType, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { LoaderCircle, Search, X } from 'lucide-react';
import { addDays, fmtMoney, toPaise, today } from '../shared/calc.ts';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
type Icon = ComponentType<{ className?: string }>;

// ---------- app-wide data ----------
export interface Loc { id: number; name: string; kind: 'godown' | 'store' | 'factory'; active: number }
export interface Cat { id: number; name: string; parent_id: number | null }
export interface AppUser { id: number; name: string; username: string; role: 'owner' | 'staff'; location_id: number | null }
export interface AppState {
  user: AppUser; owner: boolean;
  business: { name: string; tagline: string; address: string; phone: string; email: string; state: string; gstin: string; logo: string; brandColor: string };
  billing: { gstEnabled: boolean; pricesIncludeTax: boolean; allowNegativeStock: boolean; prefixes: Record<string, string>; terms: string; footer: string; upiId: string; bankDetails: string; expenseCategories: string[] };
  locations: Loc[]; categories: Cat[]; aiReady: boolean;
  reload: () => Promise<void>;
  toast: (message: string, kind?: 'ok' | 'error') => void;
}
export const AppContext = createContext<AppState>(null as any);
export const useApp = () => useContext(AppContext);
/** Locations that are switched on. */
export const useLocations = () => useApp().locations.filter((l) => l.active);

// ---------- buttons ----------
const BTN = {
  primary: 'bg-brand text-white shadow-sm hover:brightness-110 active:brightness-95',
  secondary: 'bg-white text-slate-700 border border-slate-200 shadow-sm hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50',
};
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: keyof typeof BTN; size?: 'sm' | 'md'; icon?: Icon; busy?: boolean }
export function Button({ variant = 'secondary', size = 'md', icon: I, busy, className, children, disabled, ...p }: BtnProps) {
  return (
    <button type="button" {...p} disabled={disabled || busy}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-10 px-4 text-sm', BTN[variant], className)}>
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : I && <I className="size-4 shrink-0" />}
      {children}
    </button>
  );
}

// ---------- form fields ----------
const FIELD = 'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-slate-50 disabled:text-slate-500';
/** The look of every input. Full width unless the caller passes its own width (w-24, w-auto …). */
export const fieldCls = (extra = '') => cx(FIELD, !/(^|\s)w-/.test(extra) && 'w-full', extra);
export const inputCls = fieldCls();
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={fieldCls(className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={fieldCls(cx('pr-8', className))} />;
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block min-w-0', className)}>
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
/** Rupee box. The value is whole paise. */
export function MoneyInput({ value, onChange, className, ...p }: { value: number; onChange: (paise: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [txt, setTxt] = useState(value ? String(value / 100) : '');
  useEffect(() => { if (toPaise(txt) !== value) setTxt(value ? String(value / 100) : ''); }, [value]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
      <input {...p} inputMode="decimal" value={txt} placeholder={p.placeholder ?? '0'} className={fieldCls(cx('num pl-7 text-right', className))}
        onFocus={(e) => e.target.select()}
        onChange={(e) => { const t = e.target.value.replace(/[^\d.]/g, ''); setTxt(t); onChange(toPaise(t)); }} />
    </div>
  );
}
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="mt-0.5 h-6 w-11 shrink-0 rounded-full bg-slate-200 p-0.5 transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 after:block after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
      <span><span className="block text-sm font-medium text-slate-800">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  );
}
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg bg-slate-100 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cx('h-8 rounded-md px-3 text-sm font-medium whitespace-nowrap transition', value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- layout pieces ----------
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="no-print mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cx('rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)]', className)}>{children}</div>
);
export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3"><h2 className="text-sm font-semibold text-slate-900">{children}</h2>{action}</div>;
}
const TONE = { slate: 'bg-slate-100 text-slate-600', green: 'bg-emerald-50 text-emerald-700', red: 'bg-rose-50 text-rose-700', amber: 'bg-amber-50 text-amber-700', brand: 'bg-brand/10 text-brand' };
export const Badge = ({ tone = 'slate', children }: { tone?: keyof typeof TONE; children: ReactNode }) => (
  <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONE[tone])}>{children}</span>
);
export const Money = ({ value, className }: { value: number | null | undefined; className?: string }) => <span className={cx('num', className)}>{fmtMoney(value)}</span>;
export function Stat({ label, value, sub, icon: I, tone = 'brand' }: { label: string; value: ReactNode; sub?: ReactNode; icon: Icon; tone?: keyof typeof TONE }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="num mt-2 truncate text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
          {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
        </div>
        <span className={cx('grid size-9 shrink-0 place-items-center rounded-xl', TONE[tone])}><I className="size-[18px]" /></span>
      </div>
    </Card>
  );
}
export const Spinner = () => <div className="grid place-items-center py-16 text-slate-400"><LoaderCircle className="size-6 animate-spin" /></div>;
export function Empty({ icon: I, title, children }: { icon: Icon; title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400"><I className="size-6" /></span>
      <p className="mt-3 text-sm font-medium text-slate-800">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-slate-500">{children}</div>}
    </div>
  );
}
export const ErrorNote = ({ children }: { children: ReactNode }) => (children ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{children}</p> : null);
export function SearchBox({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={fieldCls('pl-9')} />
    </div>
  );
}

// ---------- table ----------
export interface Column<T> { key: string; label: ReactNode; right?: boolean; className?: string; render?: (row: T) => ReactNode }
export function DataTable<T extends Record<string, any>>({ columns, rows, onRow, foot, rowKey }: { columns: Column<T>[]; rows: T[]; onRow?: (row: T) => void; foot?: ReactNode; rowKey?: (row: T, i: number) => string | number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500">
            {columns.map((c) => <th key={c.key} className={cx('px-4 py-2.5 font-medium whitespace-nowrap', c.right ? 'text-right' : 'text-left')}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : (r.id ?? i)} onClick={onRow && (() => onRow(r))} className={cx(onRow && 'cursor-pointer hover:bg-slate-50')}>
              {columns.map((c) => <td key={c.key} className={cx('px-4 py-3 align-middle', c.right && 'num text-right whitespace-nowrap', c.className)}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
        {foot}
      </table>
    </div>
  );
}

// ---------- modal (native <dialog>: focus trap and Esc come free) ----------
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onMouseDown={(e) => e.target === ref.current && onClose()}
      className={cx('m-auto max-h-[92vh] w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl bg-white p-0 text-slate-800 shadow-2xl', { md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size])}>
      {open && (
        <div className="flex max-h-[92vh] flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="size-4" /></button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---------- search-and-pick box (parties, items, barcode scan) ----------
export function Combo<T>({ items, text, render, onPick, placeholder, value, onClear, exact, autoFocus, limit = 30 }: {
  items: T[]; text: (item: T) => string; render?: (item: T) => ReactNode; onPick: (item: T) => void; placeholder?: string;
  /** Shown when something is picked (party select). Leave out for an "add to list" box. */
  value?: string; onClear?: () => void;
  /** A scanner types a code and presses Enter: return the item with exactly that code. */
  exact?: (query: string) => T | undefined;
  autoFocus?: boolean; limit?: number;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const found = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out: { it: T; score: number }[] = [];
    for (const it of items) {
      const hay = text(it).toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      // Whole-word hits rank first, so "L" finds size L before "bLue".
      const tokens = new Set(hay.split(/[^a-z0-9]+/));
      out.push({ it, score: words.filter((w) => tokens.has(w)).length });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.it);
  }, [q, items, limit]);
  const choose = (it: T | undefined) => {
    if (!it) return;
    onPick(it);
    setQ(''); setOpen(false); setAt(0);
    if (value === undefined) box.current?.focus();
  };
  if (value) {
    return (
      <div className={fieldCls('flex items-center justify-between gap-2')}>
        <span className="truncate font-medium">{value}</span>
        <button type="button" onClick={onClear} aria-label="Clear" className="text-slate-400 hover:text-slate-600"><X className="size-4" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <input ref={box} autoFocus={autoFocus} value={q} placeholder={placeholder} className={fieldCls('pl-9')} role="combobox" aria-expanded={open}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setAt(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setAt((i) => Math.min(i + 1, found.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (q.trim()) choose(exact?.(q.trim()) ?? found[at]); }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      {open && (q || found.length <= 12) && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {found.map((it, i) => (
            <li key={i} onMouseDown={(e) => { e.preventDefault(); choose(it); }} onMouseEnter={() => setAt(i)}
              className={cx('cursor-pointer rounded-lg px-3 py-2 text-sm', i === at ? 'bg-brand/10 text-slate-900' : 'text-slate-700')}>
              {render ? render(it) : text(it)}
            </li>
          ))}
          {!found.length && <li className="px-3 py-2 text-sm text-slate-500">Nothing found</li>}
        </ul>
      )}
    </div>
  );
}

// ---------- date range with presets ----------
export interface Range { from: string; to: string }
export function rangeOf(preset: string): Range {
  const t = today();
  const first = `${t.slice(0, 8)}01`;
  const [y, m] = [Number(t.slice(0, 4)), Number(t.slice(5, 7))];
  switch (preset) {
    case 'today': return { from: t, to: t };
    case 'yesterday': return { from: addDays(t, -1), to: addDays(t, -1) };
    case 'week': return { from: addDays(t, -6), to: t };
    case 'last_month': { const end = addDays(first, -1); return { from: `${end.slice(0, 8)}01`, to: end }; }
    case 'days30': return { from: addDays(t, -29), to: t };
    case 'year': return { from: `${m >= 4 ? y : y - 1}-04-01`, to: t }; // Indian financial year, April to March
    default: return { from: first, to: t };
  }
}
const PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['month', 'This month'], ['last_month', 'Last month'], ['days30', 'Last 30 days'], ['year', 'This financial year'], ['custom', 'Custom dates']];
export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const preset = PRESETS.find(([k]) => k !== 'custom' && rangeOf(k).from === value.from && rangeOf(k).to === value.to)?.[0] ?? 'custom';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={preset} onChange={(e) => e.target.value !== 'custom' && onChange(rangeOf(e.target.value))} className="w-auto" aria-label="Period">
        {PRESETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </Select>
      <Input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} className="w-auto" aria-label="From" />
      <span className="text-sm text-slate-400">to</span>
      <Input type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} className="w-auto" aria-label="To" />
    </div>
  );
}
/** Store filter. Staff tied to one store do not get a choice. */
export function StorePicker({ value, onChange, all = 'All locations' }: { value: string; onChange: (v: string) => void; all?: string }) {
  const { user } = useApp();
  const locs = useLocations();
  if (user.role === 'staff' && user.location_id) return null;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-auto" aria-label="Location">
      <option value="">{all}</option>
      {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
    </Select>
  );
}
