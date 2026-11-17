import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Shirt, Tag, Trash2, Wand2 } from 'lucide-react';
import { api, useData } from '../api.ts';
import { Badge, Button, Card, DataTable, Empty, ErrorNote, Field, Input, Modal, Money, MoneyInput, PageHeader, SearchBox, Segmented, Select, Spinner, cx, fieldCls, inputCls, useApp, useLocations } from '../ui.tsx';
import type { Cat } from '../ui.tsx';
import { fmtMoney, fmtNum } from '../../shared/calc.ts';

interface VRow { key: number; id?: number; sku: string; size: string; colour: string; retail_price: number; wholesale_price: number; low_stock: string; opening_qty: string; opening_cost: number; stock?: number }
const SIZE_SETS = [['S, M, L, XL, XXL', 'Shirts'], ['28, 30, 32, 34, 36, 38', 'Pants'], ['6, 7, 8, 9, 10', 'Shoes'], ['36, 38, 40, 42, 44', 'Blazers']];
let seq = 0;
const split = (s: string) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];

export function CategorySelect({ value, onChange, categories, any }: { value: string; onChange: (v: string) => void; categories: Cat[]; any?: string }) {
  const top = categories.filter((c) => !c.parent_id);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{any ?? 'No category'}</option>
      {top.map((t) => {
        const subs = categories.filter((c) => c.parent_id === t.id);
        return subs.length ? <optgroup key={t.id} label={t.name}>{subs.map((s) => <option key={s.id} value={s.id}>{t.name} › {s.name}</option>)}</optgroup> : <option key={t.id} value={t.id}>{t.name}</option>;
      })}
    </Select>
  );
}

function ItemModal({ id, kind, onClose, onSaved }: { id: number | null | undefined; kind: 'finished' | 'raw'; onClose: () => void; onSaved: () => void }) {
  const { categories, billing, owner, toast } = useApp();
  const locs = useLocations();
  const open = id !== undefined;
  const blank = { name: '', kind, category_id: '', unit: kind === 'raw' ? 'mtr' : 'pcs', hsn: '', gst_mode: kind === 'raw' ? 'fixed' : 'apparel', gst_rate: kind === 'raw' ? '5' : '0' };
  const [f, setF] = useState(blank);
  const [rows, setRows] = useState<VRow[]>([]);
  const [sizes, setSizes] = useState('');
  const [colours, setColours] = useState('');
  const [all, setAll] = useState({ retail: 0, wholesale: 0 });
  const [openLoc, setOpenLoc] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const row = (p: Partial<VRow> = {}): VRow => ({ key: ++seq, sku: '', size: '', colour: '', retail_price: all.retail, wholesale_price: all.wholesale, low_stock: '', opening_qty: '', opening_cost: 0, ...p });

  useEffect(() => {
    if (!open) return;
    setError(''); setSizes(''); setColours(''); setAll({ retail: 0, wholesale: 0 });
    setOpenLoc(String(locs.find((l) => l.kind === 'godown')?.id ?? locs[0]?.id ?? ''));
    if (id == null) { setF(blank); setRows(kind === 'raw' ? [row({ retail_price: 0, wholesale_price: 0 })] : []); return; }
    api.get(`/items/${id}`).then((it) => {
      setF({ name: it.name, kind: it.kind, category_id: String(it.category_id ?? ''), unit: it.unit, hsn: it.hsn, gst_mode: it.gst_mode, gst_rate: String(it.gst_rate) });
      setRows(it.variants.map((v: any) => ({ ...row(), ...v, low_stock: v.low_stock ? String(v.low_stock) : '' })));
    }, (e) => setError(e.message));
  }, [id, open]);

  const raw = f.kind === 'raw';
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const edit = (key: number, p: Partial<VRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  function build() {
    const ss = split(sizes), cs = split(colours);
    const combos = (ss.length ? ss : ['']).flatMap((size) => (cs.length ? cs : ['']).map((colour) => ({ size, colour })));
    setRows((rs) => [...rs, ...combos.filter((c) => (c.size || c.colour) && !rs.some((r) => r.size === c.size && r.colour === c.colour)).map((c) => row(c))]);
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const body = { ...f, category_id: f.category_id || null, gst_rate: Number(f.gst_rate) || 0,
        variants: rows.map((r) => ({ id: r.id, sku: r.sku, size: r.size, colour: r.colour, retail_price: r.retail_price, wholesale_price: r.wholesale_price,
          low_stock: Number(r.low_stock) || 0, opening_qty: Number(r.opening_qty) || 0, opening_cost: r.opening_cost, opening_location: openLoc })) };
      if (id) await api.put(`/items/${id}`, body); else await api.post('/items', body);
      toast(id ? 'Item updated' : 'Item added');
      onSaved();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Remove "${f.name}" from the item list? Old bills keep it.`)) return;
    try { await api.del(`/items/${id}`); toast('Item removed'); onSaved(); } catch (e: any) { setError(e.message); }
  }
  const hasOpening = rows.some((r) => !r.id && Number(r.opening_qty) > 0);
  const cell = fieldCls('h-9 px-2');

  return (
    <Modal open={open} onClose={onClose} size="xl" title={id ? 'Edit item' : raw ? 'New raw material' : 'New item'}
      footer={<>{id && owner && <Button variant="danger" icon={Trash2} onClick={remove} className="mr-auto">Remove</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save item</Button></>}>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label={raw ? 'Material name' : 'Item name'} className="sm:col-span-2"><Input value={f.name} onChange={set('name')} autoFocus placeholder={raw ? 'e.g. Cotton Shirting Fabric' : 'e.g. Premium Linen Shirt'} /></Field>
        <Field label="Category"><CategorySelect value={f.category_id} onChange={(v) => setF({ ...f, category_id: v })} categories={categories} /></Field>
        <Field label="Unit"><Select value={f.unit} onChange={set('unit')}>{['pcs', 'mtr', 'kg', 'set', 'pair', 'roll'].map((u) => <option key={u}>{u}</option>)}</Select></Field>
        {billing.gstEnabled && (
          <>
            <Field label="HSN code"><Input value={f.hsn} onChange={set('hsn')} /></Field>
            <Field label="GST" className="sm:col-span-2"><Select value={f.gst_mode} onChange={set('gst_mode')}><option value="apparel">Garment: 5% up to ₹2,500, 18% above</option><option value="fixed">Fixed rate</option><option value="none">No GST</option></Select></Field>
            {f.gst_mode === 'fixed' && <Field label="GST %"><Input type="number" value={f.gst_rate} onChange={set('gst_rate')} /></Field>}
          </>
        )}
      </div>

      {!raw && (
        <div className="mt-5 rounded-xl bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-800">Sizes and colours</p>
          <p className="text-xs text-slate-500">Type them with commas, then press Make list. Every size and colour pair gets its own stock and barcode.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="Sizes: S, M, L, XL" />
            <Input value={colours} onChange={(e) => setColours(e.target.value)} placeholder="Colours: White, Sky Blue" />
            <Button icon={Wand2} onClick={build}>Make list</Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">{SIZE_SETS.map(([s, label]) => <button key={s} type="button" onClick={() => setSizes(s)} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-brand hover:text-brand">{label}: {s}</button>)}</div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          {!raw && rows.length > 1 && (
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <Field label="Retail price for all"><MoneyInput value={all.retail} onChange={(retail) => setAll({ ...all, retail })} className="w-36" /></Field>
              <Field label="Wholesale price for all"><MoneyInput value={all.wholesale} onChange={(wholesale) => setAll({ ...all, wholesale })} className="w-36" /></Field>
              <Button onClick={() => setRows((rs) => rs.map((r) => ({ ...r, retail_price: all.retail || r.retail_price, wholesale_price: all.wholesale || r.wholesale_price })))}>Apply to all rows</Button>
            </div>
          )}
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-xs text-slate-500">
              {!raw && <><th className="pb-2 font-medium">Size</th><th className="pb-2 font-medium">Colour</th><th className="pb-2 font-medium">Retail price</th><th className="pb-2 font-medium">Wholesale price</th></>}
              {raw && <th className="pb-2 font-medium">Shade / type (optional)</th>}
              <th className="pb-2 font-medium">Alert when below</th><th className="pb-2 font-medium">Opening stock</th><th className="pb-2 font-medium">Cost per {f.unit}</th><th className="pb-2 font-medium">SKU / barcode</th><th />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  {!raw && <td className="py-1 pr-2"><input className={cell} value={r.size} onChange={(e) => edit(r.key, { size: e.target.value })} aria-label="Size" /></td>}
                  <td className="py-1 pr-2"><input className={cell} value={r.colour} onChange={(e) => edit(r.key, { colour: e.target.value })} aria-label="Colour" /></td>
                  {!raw && <><td className="w-32 py-1 pr-2"><MoneyInput className="h-9" value={r.retail_price} onChange={(v) => edit(r.key, { retail_price: v })} /></td>
                    <td className="w-32 py-1 pr-2"><MoneyInput className="h-9" value={r.wholesale_price} onChange={(v) => edit(r.key, { wholesale_price: v })} /></td></>}
                  <td className="w-24 py-1 pr-2"><input type="number" min="0" className={cx(cell, 'num text-right')} value={r.low_stock} placeholder="0" onChange={(e) => edit(r.key, { low_stock: e.target.value })} aria-label="Low stock level" /></td>
                  <td className="w-28 py-1 pr-2">{r.id ? <span className="num px-2 text-slate-600">{fmtNum(r.stock)} now</span> : <input type="number" min="0" className={cx(cell, 'num text-right')} value={r.opening_qty} placeholder="0" onChange={(e) => edit(r.key, { opening_qty: e.target.value })} aria-label="Opening stock" />}</td>
                  <td className="w-32 py-1 pr-2">{r.id ? <span className="px-2 text-slate-400">from purchases</span> : <MoneyInput className="h-9" value={r.opening_cost} onChange={(v) => edit(r.key, { opening_cost: v })} />}</td>
                  <td className="w-32 py-1 pr-2"><input className={cell} value={r.sku} placeholder="Automatic" onChange={(e) => edit(r.key, { sku: e.target.value })} aria-label="SKU" /></td>
                  <td className="py-1 text-right">{rows.length > 1 && <button type="button" aria-label="Remove row" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasOpening && <Field label="Opening stock is kept at" className="mt-3 max-w-xs"><Select value={openLoc} onChange={(e) => setOpenLoc(e.target.value)}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
        </div>
      )}
      {!raw && <Button size="sm" icon={Plus} className="mt-3" onClick={() => setRows((rs) => [...rs, row()])}>Add one row</Button>}
      <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>
    </Modal>
  );
}

export default function Items() {
  const { categories, owner } = useApp();
  const { data, error, reload } = useData<any[]>('/items');
  const [kind, setKind] = useState<'finished' | 'raw'>('finished');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<number | null | undefined>(undefined);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner />;
  const catIds = cat ? new Set([Number(cat), ...categories.filter((c) => c.parent_id === Number(cat)).map((c) => c.id)]) : null;
  const rows = data.filter((i) => i.kind === kind && (!catIds || catIds.has(i.category_id)) && i.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Items" subtitle="Your catalogue: category, sub-category, item, then every size and colour.">
        <Button variant="primary" icon={Plus} onClick={() => setEdit(null)}>{kind === 'raw' ? 'New raw material' : 'New item'}</Button>
      </PageHeader>
      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <Segmented value={kind} onChange={setKind} options={[{ value: 'finished', label: 'Clothes & shoes' }, { value: 'raw', label: 'Raw material' }]} />
          <div className="w-56"><CategorySelect value={cat} onChange={setCat} categories={categories} any="All categories" /></div>
          <div className="ml-auto"><SearchBox value={q} onChange={setQ} placeholder="Search item" /></div>
        </div>
        {rows.length ? (
          <DataTable rows={rows} onRow={(i) => setEdit(i.id)} columns={[
            { key: 'name', label: 'Item', render: (i) => <span className="font-medium text-slate-900">{i.name}</span> },
            { key: 'cat', label: 'Category', render: (i) => (i.cat ? <span className="text-slate-600">{i.cat}{i.subcat && <> › {i.subcat}</>}</span> : <span className="text-slate-400">None</span>) },
            ...(kind === 'finished' ? [{ key: 'n_variants', label: 'Sizes × colours', right: true }] : []),
            { key: 'stock', label: 'In stock', right: true, render: (i) => (i.stock > 0 ? `${fmtNum(i.stock)} ${i.unit}` : <Badge tone="red">Out of stock</Badge>) },
            ...(kind === 'finished' ? [{ key: 'price', label: 'Retail price', right: true, render: (i: any) => (i.min_price === i.max_price ? fmtMoney(i.min_price) : `${fmtMoney(i.min_price)} – ${fmtMoney(i.max_price)}`) }] : []),
            ...(owner ? [{ key: 'avg_cost', label: `Cost / ${kind === 'raw' ? 'unit' : 'pc'}`, right: true, render: (i: any) => <Money value={Math.round(i.avg_cost)} className="text-slate-600" /> }] : []),
            { key: 'act', label: '', right: true, render: (i) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {kind === 'finished' && <Link to={`/tags?item=${i.id}`} title="Print price tags" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><Tag className="size-4" /></Link>}
                <button type="button" title="Edit" onClick={() => setEdit(i.id)} className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><Pencil className="size-4" /></button>
              </div>
            ) },
          ]} />
        ) : <Empty icon={Shirt} title={kind === 'raw' ? 'No raw material yet' : 'No items yet'}>{kind === 'raw' ? 'Add fabric, buttons, labels and packing material to track what production uses.' : 'Add your first shirt, pant, hoodie, blazer or shoe with its sizes and colours.'}</Empty>}
      </Card>
      <ItemModal id={edit} kind={kind} onClose={() => setEdit(undefined)} onSaved={() => { setEdit(undefined); reload(); }} />
    </>
  );
}
