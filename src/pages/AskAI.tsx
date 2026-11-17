import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Send, Sparkles } from 'lucide-react';
import { api } from '../api.ts';
import { Button, Card, Empty, PageHeader, cx, inputCls, useApp } from '../ui.tsx';

interface Msg { role: 'user' | 'assistant'; content: string; used?: { name: string; title: string; subtitle: string }[]; failed?: boolean }
const IDEAS = ['Aaj ka sale kitna hua?', 'Which store sold more this week?', 'Which items should I reorder?', 'Kaun sa maal nahi bik raha?', 'What is my net profit this month?', 'Which channel gives the best margin?', 'Who owes me the most money?'];

export default function AskAI() {
  const { aiReady, business } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and React treats anything returned here as a clean-up function.
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    const history = msgs.filter((m) => !m.failed).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setQ(''); setBusy(true);
    try {
      const r = await api.post('/ai/ask', { question, history });
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, used: r.used }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', content: e.message, failed: true }]);
    } finally { setBusy(false); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); ask(q); };

  if (!aiReady) {
    return (
      <>
        <PageHeader title="Ask AI" subtitle="Ask about your sales, stock and profit in plain words." />
        <Card><Empty icon={Sparkles} title="Connect an AI model first">
          It takes two minutes and can be free: make a key at Groq or OpenRouter, then paste it in Settings.
          <div className="mt-4"><Link to="/settings?tab=ai"><Button variant="primary">Open AI settings</Button></Link></div>
        </Empty></Card>
      </>
    );
  }
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col lg:h-[calc(100dvh-3rem)]">
      <PageHeader title="Ask AI" subtitle={`Answers come only from ${business.name}'s own reports. English, Hindi or Bengali all work.`} />
      <Card className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {!msgs.length && (
            <div className="grid h-full place-items-center">
              <div className="max-w-xl text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand/10 text-brand"><Sparkles className="size-6" /></span>
                <p className="mt-3 text-sm font-medium text-slate-900">What do you want to know?</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {IDEAS.map((i) => <button key={i} type="button" onClick={() => ask(i)} className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:border-brand hover:text-brand">{i}</button>)}
                </div>
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cx('max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-6', m.role === 'user' ? 'bg-brand text-white' : m.failed ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-800')}>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.used && m.used.length > 0 && (
                  <p className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-2 text-xs text-slate-500">Based on
                    {m.used.map((u) => <Link key={u.name} to={`/reports/${u.name}`} title={u.subtitle} className="rounded-full bg-white px-2 py-0.5 font-medium text-slate-700 hover:text-brand">{u.title}</Link>)}
                  </p>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="flex justify-start"><div className="rounded-2xl bg-slate-100 px-4 py-2.5 text-sm text-slate-500">Reading your reports…</div></div>}
          <div ref={end} />
        </div>
        <form onSubmit={submit} className="flex gap-2 border-t border-slate-100 p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type your question" maxLength={1000} className={inputCls} autoFocus aria-label="Question" />
          <Button type="submit" variant="primary" icon={Send} busy={busy} disabled={!q.trim()}>Ask</Button>
        </form>
      </Card>
      <p className="mt-2 text-center text-xs text-slate-400">AI can misread a question. Open the report named under an answer to check the numbers.</p>
    </div>
  );
}
