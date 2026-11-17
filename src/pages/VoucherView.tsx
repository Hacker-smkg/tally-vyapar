import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { ArrowLeft, Ban, Copy, HandCoins, Printer, Undo2 } from 'lucide-react';
import { api, useData } from '../api.ts';
import { Badge, Button, Card, ErrorNote, Money, Spinner, cx, useApp } from '../ui.tsx';
import { PaymentModal, MODE_LABEL } from './Parties.tsx';
import { CHANNEL_LABEL, fmtDate, fmtMoney, fmtNum, rupeesInWords } from '../../shared/calc.ts';

export default function VoucherView() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { business: biz, billing, owner, user, toast } = useApp();
  const { data: v, error, reload } = useData<any>(`/vouchers/${id}`);
  const [qr, setQr] = useState('');
  const [pay, setPay] = useState(false);

  const due = v ? v.total - v.paid : 0;
  const isSale = v?.type === 'sale' || v?.type === 'sale_return';
  const kind = isSale ? 'sale' : 'purchase';
  const live = v?.status === 'final';
  const showQr = v?.type === 'sale' && live && due > 0 && !!billing.upiId;

  useEffect(() => {
    if (!showQr) return setQr('');
    // Standard UPI payment link: any UPI app that scans it opens with the amount filled in.
    const link = `upi://pay?pa=${encodeURIComponent(billing.upiId)}&pn=${encodeURIComponent(biz.name)}&am=${(due / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(v.number)}`;
    QRCode.toDataURL(link, { margin: 1, width: 220 }).then(setQr, () => setQr(''));
  }, [showQr, due, v?.number]);

  // "Save & print" lands here with ?print=1.
  useEffect(() => {
    if (!v || sp.get('print') !== '1' || (showQr && !qr)) return;
    const t = setTimeout(() => { window.print(); nav(`/vouchers/${id}`, { replace: true }); }, 300);
    return () => clearTimeout(t);
  }, [v, qr, showQr]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!v) return <Spinner />;

  const title = { sale: billing.gstEnabled ? 'TAX INVOICE' : 'INVOICE', purchase: 'PURCHASE BILL', sale_return: 'CREDIT NOTE', purchase_return: 'DEBIT NOTE' }[v.type as string];
  const tax = v.cgst + v.sgst + v.igst;
  const cost = v.lines.reduce((t: number, l: any) => t + l.qty * l.unit_cost, 0);
  const profit = v.taxable - cost - v.channel_fee - v.shipping_cost;
  const mayCancel = live && (owner || v.user_id === user.id);

  async function cancel() {
    if (!window.confirm(`Cancel ${v.number}? Stock and payments of this bill will be reversed. The bill number stays in the list as cancelled.`)) return;
    try { await api.post(`/vouchers/${v.id}/cancel`); toast(`${v.number} cancelled`); reload(); } catch (e: any) { toast(e.message, 'error'); }
  }
  const line = (label: string, value: number, strong = false) => (
    <div className={cx('flex justify-between gap-6', strong && 'border-t border-slate-300 pt-2 text-base font-semibold text-slate-900')}><span>{label}</span><Money value={value} /></div>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => nav(`/${kind}s`)} aria-label="Back" className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-200/60"><ArrowLeft className="size-5" /></button>
        <h1 className="mr-auto text-2xl font-semibold tracking-tight text-slate-900">{v.number}</h1>
        {live && due > 0 && v.party_id && <Button icon={HandCoins} onClick={() => setPay(true)}>{v.type === 'sale' || v.type === 'purchase_return' ? 'Receive payment' : 'Pay'}</Button>}
        {live && !v.type.endsWith('_return') && <Button icon={Undo2} onClick={() => nav(`/${kind}s/new?type=return&from=${v.id}`)}>Return</Button>}
        <Button icon={Copy} onClick={() => nav(`/${kind}s/new?from=${v.id}${v.type.endsWith('_return') ? '&type=return' : ''}`)}>Duplicate</Button>
        {mayCancel && <Button variant="danger" icon={Ban} onClick={cancel}>Cancel bill</Button>}
        <Button variant="primary" icon={Printer} onClick={() => window.print()}>Print / PDF</Button>
      </div>

      <Card className="print-plain relative overflow-hidden p-6 sm:p-10">
        {!live && <p className="pointer-events-none absolute inset-0 grid place-items-center text-7xl font-black tracking-widest text-rose-500/15 [rotate:-24deg]">CANCELLED</p>}
        <div className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-brand pb-6">
          <div className="flex items-start gap-4">
            {biz.logo && <img src={biz.logo} alt="" className="size-16 rounded-xl object-contain" />}
            <div>
              <p className="text-2xl font-bold tracking-tight text-slate-900">{biz.name}</p>
              {biz.tagline && <p className="text-sm text-slate-500">{biz.tagline}</p>}
              <p className="mt-1 max-w-xs text-xs leading-5 text-slate-600">{[biz.address, biz.phone && `Ph: ${biz.phone}`, biz.email].filter(Boolean).join(' · ')}</p>
              {billing.gstEnabled && biz.gstin && <p className="text-xs font-medium text-slate-700">GSTIN: {biz.gstin}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold tracking-wider text-brand">{title}</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{v.number}</p>
            <p className="text-sm text-slate-600">{fmtDate(v.date)}</p>
            <p className="text-xs text-slate-500">{v.location}</p>
          </div>
        </div>

        <div className="py-5 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{isSale ? 'Billed to' : 'Supplier'}</p>
          <p className="mt-1 font-semibold text-slate-900">{v.party ?? (v.party_name || 'Walk-in customer')}</p>
          {(v.party_phone || v.party_address) && <p className="text-slate-600">{[v.party_phone, v.party_address].filter(Boolean).join(' · ')}</p>}
          {billing.gstEnabled && v.party_gstin && <p className="text-slate-600">GSTIN: {v.party_gstin}</p>}
        </div>

        <table className="w-full text-sm">
          <thead><tr className="border-y border-slate-300 bg-slate-50 text-xs text-slate-600">
            <th className="px-2 py-2 text-left font-medium">#</th><th className="px-2 py-2 text-left font-medium">Item</th><th className="px-2 py-2 text-right font-medium">Qty</th>
            <th className="px-2 py-2 text-right font-medium">Rate</th><th className="px-2 py-2 text-right font-medium">Disc.</th>{billing.gstEnabled && <th className="px-2 py-2 text-right font-medium">GST</th>}
            <th className="px-2 py-2 text-right font-medium">Amount</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {v.lines.map((l: any, i: number) => (
              <tr key={l.id}>
                <td className="px-2 py-2.5 align-top text-slate-500">{i + 1}</td>
                <td className="px-2 py-2.5"><p className="font-medium text-slate-900">{l.item}</p><p className="text-xs text-slate-500">{[l.size, l.colour, l.sku, billing.gstEnabled && l.hsn && `HSN ${l.hsn}`].filter(Boolean).join(' · ')}</p></td>
                <td className="num px-2 py-2.5 text-right align-top">{fmtNum(l.qty)} {l.unit !== 'pcs' && l.unit}</td>
                <td className="num px-2 py-2.5 text-right align-top">{fmtMoney(l.rate)}</td>
                <td className="num px-2 py-2.5 text-right align-top">{l.discount ? fmtMoney(l.discount) : '–'}</td>
                {billing.gstEnabled && <td className="num px-2 py-2.5 text-right align-top">{l.gst_rate}%</td>}
                <td className="num px-2 py-2.5 text-right align-top font-medium text-slate-900">{fmtMoney(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 grid items-start gap-8 border-t border-slate-300 pt-5 sm:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="space-y-3 text-xs text-slate-600">
            <p><span className="font-medium text-slate-800">Amount in words:</span> {rupeesInWords(v.total)}</p>
            {qr && (
              <div className="flex items-center gap-3">
                <img src={qr} alt="UPI payment QR code" className="size-28" />
                <div><p className="text-sm font-semibold text-slate-900">Scan to pay {fmtMoney(due)}</p><p>Any UPI app · {billing.upiId}</p></div>
              </div>
            )}
            {isSale && billing.bankDetails && <p className="whitespace-pre-line"><span className="font-medium text-slate-800">Bank:</span> {billing.bankDetails}</p>}
            {isSale && billing.terms && <p className="whitespace-pre-line"><span className="font-medium text-slate-800">Terms:</span> {billing.terms}</p>}
            {v.notes && <p><span className="font-medium text-slate-800">Note:</span> {v.notes}</p>}
          </div>
          <div className="space-y-1.5 text-sm text-slate-700">
            {line('Subtotal', v.subtotal)}
            {v.discount > 0 && line('Discount', -v.discount)}
            {billing.gstEnabled && tax > 0 && <>{line('Taxable value', v.taxable)}{v.igst ? line('IGST', v.igst) : <>{line('CGST', v.cgst)}{line('SGST', v.sgst)}</>}</>}
            {v.extra_charge > 0 && line(isSale ? 'Courier / other charges' : 'Freight', v.extra_charge)}
            {v.round_off !== 0 && line('Round off', v.round_off)}
            {line('Total', v.total, true)}
            {live && <>{line(v.type === 'sale' || v.type === 'purchase_return' ? 'Received' : 'Paid', v.paid)}{due > 0 && <div className="font-medium text-slate-900">{line('Balance due', due)}</div>}</>}
          </div>
        </div>
        {isSale && <p className="mt-10 text-center text-sm text-slate-500">{billing.footer}</p>}
      </Card>

      {/* On screen only: what the customer does not see. */}
      <div className="no-print mt-5 grid gap-5 sm:grid-cols-2">
        <Card className="p-5 text-sm">
          <p className="mb-3 font-semibold text-slate-900">Payments</p>
          {v.payments.length ? v.payments.map((p: any) => (
            <div key={p.id} className="flex justify-between border-t border-slate-100 py-2 first:border-0"><span className="text-slate-600">{fmtDate(p.date)} · {MODE_LABEL[p.mode]}{p.note && ` · ${p.note}`}</span><Money value={p.amount} className="font-medium" /></div>
          )) : <p className="text-slate-500">{live ? 'No payment recorded on this bill.' : 'Cancelled bill.'}</p>}
          <p className="mt-3 text-xs text-slate-500">Made by {v.user ?? 'unknown'}</p>
        </Card>
        {isSale && (
          <Card className="p-5 text-sm">
            <div className="mb-3 flex items-center justify-between"><p className="font-semibold text-slate-900">Inside view</p><Badge tone="brand">{CHANNEL_LABEL[v.channel]}</Badge></div>
            {owner ? (
              <div className="space-y-1.5 text-slate-600">
                {line('Sale value', v.taxable)}{line('Cost of goods', -Math.round(cost))}
                {v.channel_fee > 0 && line('Marketplace fee', -v.channel_fee)}{v.shipping_cost > 0 && line('Courier cost', -v.shipping_cost)}
                <div className={cx('font-semibold', profit >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{line(v.type === 'sale' ? 'Profit on this bill' : 'Profit reversed', v.type === 'sale' ? Math.round(profit) : -Math.round(v.taxable - cost) - v.shipping_cost)}</div>
              </div>
            ) : <p className="text-slate-500">Sold through {CHANNEL_LABEL[v.channel].toLowerCase()}.</p>}
          </Card>
        )}
      </div>

      <PaymentModal open={pay} onClose={() => setPay(false)} onSaved={() => { setPay(false); reload(); }} voucherId={v.id} partyId={v.party_id} suggest={due}
        direction={v.type === 'sale' || v.type === 'purchase_return' ? 'in' : 'out'} title={`Payment for ${v.number}`} />
    </div>
  );
}
