import { useEffect, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DatabaseBackup, Download, Pencil, Plus, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { api, useData } from '../api.ts';
import { Badge, Button, Card, DataTable, ErrorNote, Field, Input, Modal, PageHeader, Segmented, Select, Spinner, Toggle, cx, fieldCls, inputCls, useApp } from '../ui.tsx';

const TABS = [['brand', 'Brand'], ['bills', 'Bills'], ['locations', 'Locations'], ['categories', 'Categories'], ['users', 'Users'], ['ai', 'AI'], ['backup', 'Backup']].map(([value, label]) => ({ value, label }));
const COLOURS = ['#4f46e5', '#0f766e', '#b45309', '#be123c', '#7c3aed', '#0369a1', '#15803d', '#1e293b'];
const PROVIDERS = [
  { id: 'groq', name: 'Groq (free tier, fast)', url: 'https://api.groq.com/openai/v1', key: 'console.groq.com → API Keys' },
  { id: 'openrouter', name: 'OpenRouter (many free models)', url: 'https://openrouter.ai/api/v1', key: 'openrouter.ai → Keys. Pick a model ending in ":free".' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1', key: 'platform.deepseek.com' },
  { id: 'xai', name: 'xAI Grok', url: 'https://api.x.ai/v1', key: 'console.x.ai' },
  { id: 'moonshot', name: 'Moonshot Kimi', url: 'https://api.moonshot.ai/v1', key: 'platform.moonshot.ai' },
  { id: 'zhipu', name: 'Zhipu GLM', url: 'https://api.z.ai/api/paas/v4', key: 'z.ai' },
  { id: 'qwen', name: 'Alibaba Qwen', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', key: 'Alibaba Cloud Model Studio' },
  { id: 'pollinations', name: 'Pollinations (free, no key needed)', url: 'https://text.pollinations.ai/openai', key: 'No key. Good for a first try; it is a public service, so use a keyed provider or Ollama for real business data.' },
  { id: 'ollama', name: 'Ollama on this PC (offline, private)', url: 'http://localhost:11434/v1', key: 'No key needed. Install Ollama on the office PC and pull a model.' },
  { id: 'custom', name: 'Other (OpenAI-compatible)', url: '', key: '' },
];

/** Wraps a save call with the busy flag, the error line and the success toast. */
function useSave() {
  const { toast, reload } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (fn: () => Promise<unknown>, done = 'Saved') => {
    setBusy(true); setError('');
    try { await fn(); await reload(); toast(done); return true; } catch (e: any) { setError(e.message); return false; } finally { setBusy(false); }
  };
  return { busy, error, save };
}
const Section = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
  <Card className="p-6"><h2 className="text-base font-semibold text-slate-900">{title}</h2>{hint && <p className="mt-1 max-w-2xl text-sm text-slate-500">{hint}</p>}<div className="mt-5">{children}</div></Card>
);

function Brand() {
  const { business } = useApp();
  const [f, setF] = useState(business);
  const { busy, error, save } = useSave();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  // Logos are shrunk in the browser so the bill stays light to load and print.
  function pickLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 256 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      setF((x) => ({ ...x, logo: c.toDataURL('image/png') }));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }
  return (
    <Section title="Brand" hint="This name, logo and colour appear on every bill, price tag, report and across the app.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Tagline"><Input value={f.tagline} onChange={set('tagline')} placeholder="e.g. Premium menswear since 2012" /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={set('address')} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><Input value={f.email} onChange={set('email')} /></Field>
        <Field label="State"><Input value={f.state} onChange={set('state')} placeholder="e.g. West Bengal" /></Field>
        <Field label="GSTIN" hint="Leave empty if not registered."><Input value={f.gstin} onChange={set('gstin')} maxLength={15} /></Field>
        <Field label="Logo">
          <div className="flex items-center gap-3">
            {f.logo ? <img src={f.logo} alt="Logo" className="size-14 rounded-xl border border-slate-200 object-contain" /> : <span className="grid size-14 place-items-center rounded-xl bg-slate-100 text-xs text-slate-400">None</span>}
            <label className={fieldCls('flex w-auto cursor-pointer items-center gap-2')}><Upload className="size-4" />Choose image<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pickLogo} /></label>
            {f.logo && <Button variant="ghost" onClick={() => setF({ ...f, logo: '' })}>Remove</Button>}
          </div>
        </Field>
        <Field label="Brand colour">
          <div className="flex flex-wrap items-center gap-2">
            {COLOURS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setF({ ...f, brandColor: c })} style={{ background: c }} className={cx('size-8 rounded-full ring-offset-2', f.brandColor === c && 'ring-2 ring-slate-900')} />)}
            <input type="color" value={f.brandColor} onChange={set('brandColor')} className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-white" aria-label="Custom colour" />
          </div>
        </Field>
      </div>
      <div className="mt-5 flex items-center gap-3"><Button variant="primary" busy={busy} onClick={() => save(() => api.put('/settings/business', f))}>Save brand</Button><ErrorNote>{error}</ErrorNote></div>
    </Section>
  );
}

function Bills() {
  const { billing } = useApp();
  const [f, setF] = useState(billing);
  const [heads, setHeads] = useState(billing.expenseCategories.join('\n'));
  const { busy, error, save } = useSave();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const PRE: [string, string][] = [['sale', 'Sale bill'], ['sale_return', 'Sale return'], ['purchase', 'Purchase'], ['purchase_return', 'Purchase return'], ['production', 'Cost sheet']];
  return (
    <Section title="Bill settings" hint="How bills are numbered, what is printed on them and how tax is handled.">
      <div className="grid gap-4 sm:grid-cols-5">
        {PRE.map(([k, label]) => <Field key={k} label={`${label} prefix`}><Input value={f.prefixes[k] ?? ''} onChange={(e) => setF({ ...f, prefixes: { ...f.prefixes, [k]: e.target.value } })} /></Field>)}
      </div>
      <p className="mt-1 text-xs text-slate-500">Numbers continue on their own: {f.prefixes.sale}0001, {f.prefixes.sale}0002 … Add the year if you like, e.g. INV/26-27/.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="UPI ID" hint="A scan-to-pay QR code is printed on unpaid sale bills."><Input value={f.upiId} onChange={set('upiId')} placeholder="yourshop@upi" /></Field>
        <Field label="Bank details (printed on bills)"><Input value={f.bankDetails} onChange={set('bankDetails')} placeholder="Bank, account name, account no., IFSC" /></Field>
        <Field label="Terms printed on bills"><textarea value={f.terms} onChange={set('terms')} rows={3} className={fieldCls('h-auto py-2')} /></Field>
        <Field label="Footer line"><textarea value={f.footer} onChange={set('footer')} rows={3} className={fieldCls('h-auto py-2')} /></Field>
      </div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <Toggle checked={f.gstEnabled} onChange={(gstEnabled) => setF({ ...f, gstEnabled })} label="The business is GST registered" hint="Bills become Tax Invoices with CGST / SGST / IGST. Garments use 5% up to ₹2,500 per piece and 18% above. Needs your GSTIN under Brand." />
        {f.gstEnabled && <Toggle checked={f.pricesIncludeTax} onChange={(pricesIncludeTax) => setF({ ...f, pricesIncludeTax })} label="My prices already include GST" hint="Usual for shops selling at MRP. Switch off if you add GST on top." />}
        <Toggle checked={f.allowNegativeStock} onChange={(allowNegativeStock) => setF({ ...f, allowNegativeStock })} label="Allow billing when stock is short" hint="Keep this off so that stock numbers stay true." />
      </div>
      <Field label="Expense heads (one per line)" className="mt-6 max-w-sm"><textarea value={heads} onChange={(e) => setHeads(e.target.value)} rows={7} className={fieldCls('h-auto py-2')} /></Field>
      <div className="mt-5 flex items-center gap-3">
        <Button variant="primary" busy={busy} onClick={() => save(() => api.put('/settings/billing', { ...f, expenseCategories: heads.split('\n').map((h) => h.trim()).filter(Boolean) }))}>Save bill settings</Button><ErrorNote>{error}</ErrorNote>
      </div>
    </Section>
  );
}

function Locations() {
  const { locations } = useApp();
  const [f, setF] = useState({ name: '', kind: 'store' });
  const { busy, error, save } = useSave();
  const KIND: Record<string, string> = { store: 'Store', godown: 'Godown', factory: 'Factory' };
  return (
    <Section title="Locations" hint="Every store, godown and factory keeps its own stock. Bills and reports can be seen location by location.">
      <DataTable rows={locations} columns={[
        { key: 'name', label: 'Name', render: (l) => <span className="font-medium text-slate-900">{l.name}</span> },
        { key: 'kind', label: 'Type', render: (l) => <Badge tone={l.kind === 'store' ? 'brand' : 'slate'}>{KIND[l.kind]}</Badge> },
        { key: 'active', label: 'In use', render: (l) => <Toggle checked={!!l.active} label="" onChange={(active) => save(() => api.put(`/locations/${l.id}`, { ...l, active }), active ? 'Switched on' : 'Switched off')} /> },
        { key: 'act', label: '', right: true, render: (l) => <Button size="sm" icon={Pencil} onClick={() => { const name = window.prompt('New name', l.name); if (name?.trim()) save(() => api.put(`/locations/${l.id}`, { ...l, name })); }}>Rename</Button> },
      ]} />
      <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-5">
        <Field label="New location name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Store 2 – Park Street" className="w-64" /></Field>
        <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Button variant="primary" icon={Plus} busy={busy} disabled={!f.name.trim()} onClick={async () => { if (await save(() => api.post('/locations', f), 'Location added')) setF({ name: '', kind: 'store' }); }}>Add location</Button>
      </div>
      <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
    </Section>
  );
}

function Categories() {
  const { categories } = useApp();
  const [name, setName] = useState('');
  const { busy, error, save } = useSave();
  const ask = (label: string, old = '') => window.prompt(label, old)?.trim();
  const chip = (c: { id: number; name: string }, sub: boolean) => (
    <span key={c.id} className={cx('group inline-flex items-center gap-1 rounded-full py-1 pl-3 pr-1 text-sm', sub ? 'bg-slate-100 text-slate-700' : 'bg-brand/10 font-medium text-brand')}>
      {c.name}
      <button type="button" aria-label={`Rename ${c.name}`} onClick={() => { const n = ask('New name', c.name); if (n) save(() => api.put(`/categories/${c.id}`, { name: n })); }} className="grid size-6 place-items-center rounded-full opacity-60 hover:bg-white hover:opacity-100"><Pencil className="size-3" /></button>
      <button type="button" aria-label={`Delete ${c.name}`} onClick={() => window.confirm(`Delete "${c.name}"?`) && save(() => api.del(`/categories/${c.id}`), 'Deleted')} className="grid size-6 place-items-center rounded-full opacity-60 hover:bg-white hover:text-rose-600 hover:opacity-100"><Trash2 className="size-3" /></button>
    </span>
  );
  return (
    <Section title="Categories" hint="Two levels: a category (Shirt, Pant) and its sub-categories (Premium, Offer, Jeans). Reports group sales this way.">
      <div className="space-y-4">
        {categories.filter((c) => !c.parent_id).map((top) => (
          <div key={top.id} className="flex flex-wrap items-center gap-2">
            {chip(top, false)}<span className="text-slate-300">›</span>
            {categories.filter((c) => c.parent_id === top.id).map((s) => chip(s, true))}
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => { const n = ask(`New sub-category under ${top.name}`); if (n) save(() => api.post('/categories', { name: n, parent_id: top.id }), 'Added'); }}>Sub-category</Button>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-5">
        <Field label="New category"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kurta" className="w-64" /></Field>
        <Button variant="primary" icon={Plus} busy={busy} disabled={!name.trim()} onClick={async () => { if (await save(() => api.post('/categories', { name }), 'Category added')) setName(''); }}>Add category</Button>
      </div>
      <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
    </Section>
  );
}

function Users() {
  const { locations, user: me } = useApp();
  const users = useData<any[]>('/users');
  const blank = { id: 0, name: '', username: '', password: '', role: 'staff', location_id: '', active: 1 };
  const [f, setF] = useState<any>(null);
  const { busy, error, save } = useSave();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async () => { if (await save(() => (f.id ? api.put(`/users/${f.id}`, f) : api.post('/users', f)), f.id ? 'User updated' : 'User added')) { setF(null); users.reload(); } };
  return (
    <Section title="Users" hint="Up to 10 people. Staff bill and manage stock for their own store; they cannot see profit, settings or AI.">
      {!users.data ? <Spinner /> : (
        <DataTable rows={users.data} onRow={(u) => setF({ ...u, password: '', location_id: String(u.location_id ?? '') })} columns={[
          { key: 'name', label: 'Name', render: (u) => <span className="font-medium text-slate-900">{u.name}{u.id === me.id && <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>}</span> },
          { key: 'username', label: 'Username' },
          { key: 'role', label: 'Role', render: (u) => <Badge tone={u.role === 'owner' ? 'brand' : 'slate'}>{u.role === 'owner' ? 'Owner' : 'Staff'}</Badge> },
          { key: 'location', label: 'Store', render: (u) => u.location ?? <span className="text-slate-400">All</span> },
          { key: 'active', label: 'Status', render: (u) => (u.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Switched off</Badge>) },
        ]} />
      )}
      <Button variant="primary" icon={Plus} className="mt-5" onClick={() => setF(blank)}>Add user</Button>
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? 'Edit user' : 'New user'} footer={<><Button onClick={() => setF(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={submit}>Save</Button></>}>
        {f && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={f.name} onChange={set('name')} autoFocus /></Field>
            <Field label="Username"><Input value={f.username} onChange={set('username')} disabled={!!f.id} autoCapitalize="none" autoComplete="off" /></Field>
            <Field label={f.id ? 'New password (leave empty to keep)' : 'Password'} hint="At least 8 characters."><Input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
            <Field label="Role"><Select value={f.role} onChange={set('role')}><option value="staff">Staff</option><option value="owner">Owner</option></Select></Field>
            <Field label="Works at" hint="Staff with a store can bill only from that store."><Select value={f.location_id} onChange={set('location_id')}><option value="">Any location</option>{locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            {!!f.id && <div className="self-end pb-2"><Toggle checked={!!f.active} onChange={(v) => setF({ ...f, active: v ? 1 : 0 })} label="Can log in" /></div>}
            <div className="sm:col-span-2"><ErrorNote>{error}</ErrorNote></div>
          </div>
        )}
      </Modal>
    </Section>
  );
}

function AI() {
  const { toast } = useApp();
  const cfg = useData<any>('/ai/config');
  const [f, setF] = useState({ provider: 'groq', baseUrl: PROVIDERS[0].url, model: '', apiKey: '' });
  const [models, setModels] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const { busy, error, save } = useSave();
  useEffect(() => { if (cfg.data) setF({ provider: cfg.data.provider, baseUrl: cfg.data.baseUrl, model: cfg.data.model, apiKey: '' }); }, [cfg.data]);
  const provider = PROVIDERS.find((p) => p.id === f.provider) ?? PROVIDERS.at(-1)!;
  const store = (done?: string) => save(() => api.put('/ai/config', f), done);
  async function load() { if (await store('Saved')) { try { const m = await api.get('/ai/models'); setModels(m); setNote(`${m.length} models found. Pick one below.`); } catch (e: any) { toast(e.message, 'error'); } cfg.reload(); } }
  async function test() { if (await store('Saved')) { setNote('Asking the model…'); try { const r = await api.post('/ai/test'); setNote(`It works. The model replied: "${r.reply}"`); } catch (e: any) { setNote(''); toast(e.message, 'error'); } cfg.reload(); } }
  return (
    <Section title="AI assistant" hint="Ask AI and the daily insights card use any model that speaks the OpenAI-compatible format. Start with a free one; switch any time.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider" hint={provider.key ? `Get a key at: ${provider.key}` : undefined}>
          <Select value={f.provider} onChange={(e) => { const p = PROVIDERS.find((x) => x.id === e.target.value)!; setF({ ...f, provider: p.id, baseUrl: p.url || f.baseUrl, model: '' }); setModels([]); setNote(''); }}>{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </Field>
        <Field label="Address (base URL)" hint="Filled in for you. Change it only if the provider says so."><Input value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} /></Field>
        <Field label="API key" hint={cfg.data?.hasKey ? 'A key is saved. Leave empty to keep it.' : 'Paste the key from the provider. It stays on this PC.'}>
          <Input type="password" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} placeholder={cfg.data?.hasKey ? '••••••••••••' : ''} autoComplete="off" />
        </Field>
        <Field label="Model" hint="Press Load models to see what this provider offers.">
          <Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} list="ai-models" placeholder="Type or pick a model" />
          <datalist id="ai-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button onClick={load} disabled={busy || !f.baseUrl}>Load models</Button>
        <Button onClick={test} disabled={busy || !f.model}>Test</Button>
        <Button variant="primary" busy={busy} onClick={async () => { if (await store('AI settings saved')) cfg.reload(); }}>Save</Button>
        {note && <span className="text-sm text-emerald-700">{note}</span>}
      </div>
      <div className="mt-3"><ErrorNote>{error || cfg.error}</ErrorNote></div>
      <div className="mt-6 flex gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-slate-400" />
        <div className="space-y-1">
          <p><span className="font-medium text-slate-800">What is sent:</span> the question, and report rows (item names, party names, amounts). Never phone numbers, addresses, passwords or the database.</p>
          <p><span className="font-medium text-slate-800">Good to know:</span> free cloud tiers may keep what they receive. Choose Ollama to keep everything on this PC. The AI can only read reports; it cannot change any data.</p>
        </div>
      </div>
    </Section>
  );
}

function Backup() {
  const { toast, reload } = useApp();
  const items = useData<any[]>('/items');
  const [busy, setBusy] = useState(false);
  async function demo() {
    if (!window.confirm('Load sample data? It adds sample items, parties and about 40 days of bills so you can explore every screen.')) return;
    setBusy(true);
    try { await api.post('/demo'); await reload(); items.reload(); toast('Sample data loaded'); } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-5">
      <Section title="Backup" hint="The app copies the whole database into the data/backups folder once a day and keeps the last 14 days. Download a copy now and then and keep it somewhere else, such as a pen drive or Google Drive.">
        <Button variant="primary" icon={Download} onClick={() => { window.location.href = '/api/backup'; }}>Download backup now</Button>
        <p className="mt-3 text-xs text-slate-500">To restore: stop the app, replace data/app.db with the backup file, start the app again.</p>
      </Section>
      {items.data?.length === 0 && (
        <Section title="Sample data" hint="The app is empty. Load a sample clothing business to see how every screen and report looks before entering your own data.">
          <Button icon={DatabaseBackup} busy={busy} onClick={demo}>Load sample data</Button>
        </Section>
      )}
    </div>
  );
}

export default function Settings() {
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some((t) => t.value === sp.get('tab')) ? sp.get('tab')! : 'brand';
  return (
    <>
      <PageHeader title="Settings" subtitle="Only the owner can open this page." />
      <div className="mb-5"><Segmented value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} options={TABS} /></div>
      {{ brand: <Brand />, bills: <Bills />, locations: <Locations />, categories: <Categories />, users: <Users />, ai: <AI />, backup: <Backup /> }[tab]}
    </>
  );
}
