import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import { ArrowLeft, Printer, Tag } from 'lucide-react';
import { useData } from '../api.ts';
import { Button, Card, Combo, Empty, ErrorNote, Field, Select, Toggle, cx, fieldCls, inputCls, useApp } from '../ui.tsx';
import { fmtMoney0 } from '../../shared/calc.ts';

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    try { JsBarcode(ref.current!, value, { format: 'CODE128', height: 30, width: 1.3, fontSize: 10, margin: 0, textMargin: 1 }); } catch { /* a code the barcode cannot hold prints as text only */ }
  }, [value]);
  return <svg ref={ref} className="mx-auto max-w-full" />;
}

const SIZES: Record<string, { label: string; cols: string }> = {
  s: { label: 'Small · 5 across A4', cols: 'grid-cols-5' },
  m: { label: 'Medium · 4 across A4', cols: 'grid-cols-4' },
  l: { label: 'Large · 3 across A4', cols: 'grid-cols-3' },
};

export default function PriceTags() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const { business } = useApp();
  const itemId = sp.get('item');
  const items = useData<any[]>('/items');
  const item = useData<any>(itemId ? `/items/${itemId}` : null);
  const [count, setCount] = useState<Record<number, string>>({});
  const [size, setSize] = useState('m');
  const [price, setPrice] = useState(true);

  // Start with one tag for every piece in stock.
  useEffect(() => {
    if (item.data) setCount(Object.fromEntries(item.data.variants.map((v: any) => [v.id, String(Math.max(0, Math.round(v.stock)))])));
  }, [item.data]);

  const variants: any[] = item.data?.variants ?? [];
  const tags = variants.flatMap((v) => Array.from({ length: Math.min(Number(count[v.id]) || 0, 500) }, (_, i) => ({ ...v, n: i })));

  return (
    <>
      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => nav('/items')} aria-label="Back" className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-200/60"><ArrowLeft className="size-5" /></button>
        <h1 className="mr-auto text-2xl font-semibold tracking-tight text-slate-900">Price tags</h1>
        <Button variant="primary" icon={Printer} disabled={!tags.length} onClick={() => window.print()}>Print {tags.length || ''} tags</Button>
      </div>
      <ErrorNote>{items.error || item.error}</ErrorNote>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="no-print h-fit space-y-4 p-5">
          <Field label="Item">
            <Combo items={(items.data ?? []).filter((i) => i.kind === 'finished')} text={(i) => i.name} value={item.data?.name} onClear={() => setSp({})} onPick={(i) => setSp({ item: String(i.id) })} placeholder="Search item" />
          </Field>
          {variants.length > 0 && (
            <>
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium whitespace-nowrap text-slate-600">How many tags of each</span>
                  <span className="flex gap-1.5">
                    <Button size="sm" onClick={() => setCount(Object.fromEntries(variants.map((v) => [v.id, '1'])))}>1 each</Button>
                    <Button size="sm" onClick={() => setCount(Object.fromEntries(variants.map((v) => [v.id, String(Math.max(0, Math.round(v.stock)))])))}>As per stock</Button>
                  </span>
                </div>
                <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {variants.map((v) => (
                    <label key={v.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-slate-700">{[v.size, v.colour].filter(Boolean).join(' · ') || 'One size'}</span>
                      <input type="number" min="0" max="500" value={count[v.id] ?? ''} onChange={(e) => setCount({ ...count, [v.id]: e.target.value })} className={fieldCls('num h-8 w-20 text-right')} />
                    </label>
                  ))}
                </div>
              </div>
              <Field label="Tag size"><Select value={size} onChange={(e) => setSize(e.target.value)}>{Object.entries(SIZES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select></Field>
              <Toggle checked={price} onChange={setPrice} label="Print the price (MRP)" />
              <p className="text-xs text-slate-500">Print on A4 sticker sheets or plain card and cut. Scan a tag on the Sales screen to add the item to a bill.</p>
            </>
          )}
        </Card>

        <Card className="print-plain p-5 lg:col-span-2">
          {tags.length ? (
            <div className={cx('grid gap-2', SIZES[size].cols)}>
              {tags.map((t) => (
                <div key={`${t.id}-${t.n}`} className="break-inside-avoid rounded-lg border border-dashed border-slate-300 px-2 py-2.5 text-center">
                  <p className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-slate-900">{business.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-700">{item.data.name}</p>
                  <p className="truncate text-[11px] font-semibold text-slate-900">{[t.size && `Size ${t.size}`, t.colour].filter(Boolean).join(' · ')}</p>
                  {price && <p className="num mt-0.5 text-sm font-bold text-slate-900">MRP {fmtMoney0(t.retail_price)}</p>}
                  <div className="mt-1"><Barcode value={t.sku} /></div>
                </div>
              ))}
            </div>
          ) : <Empty icon={Tag} title="Pick an item to make its tags">Each tag carries your brand name, the item, size, colour, price and a barcode.</Empty>}
        </Card>
      </div>
    </>
  );
}
