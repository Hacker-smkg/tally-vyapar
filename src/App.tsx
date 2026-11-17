import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Boxes, ChartColumn, CircleAlert, CircleCheck, LayoutDashboard, LogOut, Menu, Receipt, Scissors, Settings as Cog, Shirt, ShoppingBag, Sparkles, Users, Wallet, X } from 'lucide-react';
import { api } from './api.ts';
import { AppContext, Spinner, cx } from './ui.tsx';
import type { AppState } from './ui.tsx';
import Login from './pages/Login.tsx';
import Dashboard from './pages/Dashboard.tsx';
import VoucherList from './pages/VoucherList.tsx';
import VoucherForm from './pages/VoucherForm.tsx';
import VoucherView from './pages/VoucherView.tsx';
import Parties from './pages/Parties.tsx';
import Items from './pages/Items.tsx';
import PriceTags from './pages/PriceTags.tsx';
import Stock from './pages/Stock.tsx';
import Production from './pages/Production.tsx';
import Expenses from './pages/Expenses.tsx';
import Reports from './pages/Reports.tsx';
import AskAI from './pages/AskAI.tsx';
import Settings from './pages/Settings.tsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/sales', label: 'Sales', icon: Receipt },
  { to: '/purchases', label: 'Purchases', icon: ShoppingBag },
  { to: '/production', label: 'Production', icon: Scissors },
  { to: '/stock', label: 'Stock', icon: Boxes },
  { to: '/items', label: 'Items', icon: Shirt },
  { to: '/parties', label: 'Parties', icon: Users },
  { to: '/expenses', label: 'Expenses', icon: Wallet },
  { to: '/reports', label: 'Reports', icon: ChartColumn },
  { to: '/ai', label: 'Ask AI', icon: Sparkles, owner: true },
  { to: '/settings', label: 'Settings', icon: Cog, owner: true },
];

type Toast = { id: number; message: string; kind: 'ok' | 'error' };

export default function App() {
  const [me, setMe] = useState<any>(null);
  const [boot, setBoot] = useState<any>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();

  const toast = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);

  const load = useCallback(async () => {
    const m = await api.get('/auth/me');
    setMe(m);
    setBoot(m.user ? await api.get('/bootstrap') : null);
  }, []);
  useEffect(() => { load().catch((e) => toast(e.message, 'error')); }, [load, toast]);
  useEffect(() => {
    const out = () => { setBoot(null); setMe((m: any) => (m ? { ...m, user: null } : m)); };
    window.addEventListener('app:logout', out);
    return () => window.removeEventListener('app:logout', out);
  }, []);
  useEffect(() => setMenu(false), [pathname]);

  const brand = boot?.business ?? me?.brand;
  useEffect(() => {
    if (!brand) return;
    document.documentElement.style.setProperty('--brand', brand.brandColor || '#4f46e5');
    document.title = brand.name || 'Vastra Books';
  }, [brand?.brandColor, brand?.name]);

  const ctx = useMemo<AppState | null>(() => (boot && me?.user ? { ...boot, user: me.user, owner: me.user.role === 'owner', reload: load, toast } : null), [boot, me, load, toast]);

  const toastStack = (
    <div className="no-print fixed bottom-4 right-4 z-50 flex w-[min(92vw,22rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={cx('flex items-start gap-2 rounded-xl px-4 py-3 text-sm text-white shadow-lg', t.kind === 'error' ? 'bg-rose-600' : 'bg-slate-900')}>
          {t.kind === 'error' ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />}
          {t.message}
        </div>
      ))}
    </div>
  );

  if (!me) return <Spinner />;
  if (!me.user) return <>{<Login needsSetup={me.needsSetup} brand={me.brand} demo={me.demo} onDone={load} />}{toastStack}</>;
  if (!ctx) return <Spinner />;

  const logout = () => api.post('/auth/logout').finally(() => window.dispatchEvent(new Event('app:logout')));
  const nav = NAV.filter((n) => !n.owner || ctx.owner);

  return (
    <AppContext.Provider value={ctx}>
      <div className="print-grid flex h-full">
        {menu && <div className="no-print fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMenu(false)} />}
        <aside className={cx('no-print fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-slate-950 text-slate-300 transition-transform lg:static lg:translate-x-0', menu ? 'translate-x-0' : '-translate-x-full')}>
          <div className="flex items-center gap-3 px-5 pt-5 pb-4">
            {ctx.business.logo ? <img src={ctx.business.logo} alt="" className="size-9 rounded-xl bg-white object-contain" /> : (
              <span className="grid size-9 place-items-center rounded-xl bg-brand text-sm font-bold text-white">{ctx.business.name.slice(0, 1).toUpperCase()}</span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{ctx.business.name}</p>
              <p className="truncate text-xs text-slate-500">{ctx.business.tagline || 'Vastra Books'}</p>
            </div>
            <button type="button" className="ml-auto text-slate-500 lg:hidden" onClick={() => setMenu(false)} aria-label="Close menu"><X className="size-5" /></button>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'}
                className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition', isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')}>
                {({ isActive }) => <><n.icon className={cx('size-[18px]', isActive && 'text-brand brightness-150')} />{n.label}</>}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 border-t border-white/10 px-4 py-3">
            <span className="grid size-8 place-items-center rounded-full bg-white/10 text-xs font-semibold text-white">{ctx.user.name.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-white">{ctx.user.name}</p>
              <p className="text-xs text-slate-500">{ctx.owner ? 'Owner' : ctx.locations.find((l) => l.id === ctx.user.location_id)?.name ?? 'Staff'}</p>
            </div>
            <button type="button" onClick={logout} title="Log out" aria-label="Log out" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"><LogOut className="size-4" /></button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
            <button type="button" onClick={() => setMenu(true)} aria-label="Open menu" className="grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"><Menu className="size-5" /></button>
            <p className="truncate text-sm font-semibold text-slate-900">{ctx.business.name}</p>
          </header>
          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/sales" element={<VoucherList key="sale" kind="sale" />} />
                <Route path="/sales/new" element={<VoucherForm key="sale" kind="sale" />} />
                <Route path="/purchases" element={<VoucherList key="purchase" kind="purchase" />} />
                <Route path="/purchases/new" element={<VoucherForm key="purchase" kind="purchase" />} />
                <Route path="/vouchers/:id" element={<VoucherView />} />
                <Route path="/production" element={<Production />} />
                <Route path="/stock" element={<Stock />} />
                <Route path="/items" element={<Items />} />
                <Route path="/tags" element={<PriceTags />} />
                <Route path="/parties" element={<Parties />} />
                <Route path="/expenses" element={<Expenses />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/reports/:name" element={<Reports />} />
                {ctx.owner && <Route path="/ai" element={<AskAI />} />}
                {ctx.owner && <Route path="/settings" element={<Settings />} />}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
      {toastStack}
    </AppContext.Provider>
  );
}
