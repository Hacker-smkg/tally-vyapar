import { useState } from 'react';
import type { FormEvent } from 'react';
import { ChartColumn, Boxes, Receipt, Sparkles } from 'lucide-react';
import { api } from '../api.ts';
import { Button, ErrorNote, Field, Input } from '../ui.tsx';

const POINTS = [
  [Receipt, 'Fast billing', 'Retail, wholesale and online orders from every store.'],
  [Boxes, 'Stock by location', 'Godown, stores and goods in production, size by size.'],
  [ChartColumn, 'Real profit', 'Cost per piece, unit economics and net profit.'],
  [Sparkles, 'Ask AI', 'Plain-language answers from your own sales data.'],
] as const;

export default function Login({ needsSetup, brand, demo, onDone }: { needsSetup: boolean; brand: { name: string; logo: string }; demo?: { username: string; password: string } | null; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ business: '', name: '', username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post(needsSetup ? '/auth/setup' : '/auth/login', f);
      await onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -top-40 -right-40 size-[32rem] rounded-full bg-brand/30 blur-3xl" />
        <p className="relative text-sm font-semibold tracking-wide text-slate-300">Vastra Books</p>
        <div className="relative">
          <h1 className="max-w-md text-4xl font-semibold leading-tight tracking-tight">Billing, stock and profit for your clothing business.</h1>
          <ul className="mt-10 grid max-w-lg gap-5 sm:grid-cols-2">
            {POINTS.map(([I, title, text]) => (
              <li key={title}>
                <I className="size-5 text-brand brightness-150" />
                <p className="mt-2 text-sm font-medium">{title}</p>
                <p className="mt-1 text-sm text-slate-400">{text}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">Your data stays on your own computer.</p>
      </div>

      <div className="grid place-items-center bg-white px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div className="mb-6">
            {brand.logo && <img src={brand.logo} alt="" className="mb-4 size-12 rounded-xl object-contain" />}
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{needsSetup ? 'Set up your business' : `Welcome to ${brand.name}`}</h2>
            <p className="mt-1 text-sm text-slate-500">{needsSetup ? 'Create the owner account. You can add staff later.' : 'Log in to continue.'}</p>
          </div>
          {needsSetup && (
            <>
              <Field label="Business name"><Input value={f.business} onChange={set('business')} required autoFocus placeholder="e.g. Royal Fashion" /></Field>
              <Field label="Your name"><Input value={f.name} onChange={set('name')} required /></Field>
            </>
          )}
          <Field label="Username"><Input value={f.username} onChange={set('username')} required autoFocus={!needsSetup} autoComplete="username" autoCapitalize="none" /></Field>
          <Field label="Password" hint={needsSetup ? 'At least 8 characters. Keep it safe; there is no reset by email.' : undefined}>
            <Input type="password" value={f.password} onChange={set('password')} required minLength={needsSetup ? 8 : 1} autoComplete={needsSetup ? 'new-password' : 'current-password'} />
          </Field>
          {demo && !needsSetup && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span>This is the demo copy with sample data.</span>
              <Button size="sm" onClick={() => setF({ ...f, ...demo })}>Use demo login</Button>
            </div>
          )}
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" variant="primary" busy={busy} className="w-full">{needsSetup ? 'Create account' : 'Log in'}</Button>
        </form>
      </div>
    </div>
  );
}
