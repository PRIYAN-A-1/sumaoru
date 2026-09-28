import { useEffect, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth } from '../lib/firebase';

type Payment = { id: string; amount: number; currency: string; status: string; method: string; created_at: number; amount_refunded: number };
type Snapshot = { mode: string; keyHint: string; syncedAt: string; lastWebhookAt: string | null; webhookConfigured: boolean; payments: Payment[]; hasMore: boolean };

export function RazorpayMerchantPanel() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => onAuthStateChanged(auth, value => { setUser(value); setData(null); setError(''); setPage(0); }), []);
  useEffect(() => {
    setData(null);
    if (!user) return;
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function sync() {
      if (!active || !user) return;
      setBusy(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch(`/api/razorpay/merchant/payments?skip=${page * 25}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Unable to connect.');
        if (active) { setData(body); setError(''); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Unable to sync.'); }
      finally { if (active) { setBusy(false); timer = setTimeout(sync, 15000); } }
    }
    void sync();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [user, page, refresh]);
  async function login() {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch { setError('Sign-in unavailable. Enable Google sign-in and this domain in Firebase Authentication.'); }
  }
  const money = (amount: number, currency: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount / 100);
  return <section className="rounded-2xl border border-emerald-700 bg-slate-900 p-5 space-y-4" aria-label="Razorpay merchant account">
    <div className="rounded-xl border border-slate-700 bg-slate-950 p-4 space-y-3">
      <h2 className="text-lg font-semibold text-white">Pay via Razorpay</h2>
      <p className="text-sm text-slate-300">Open @anandanpriyan’s Razorpay payment page to review the recipient and amount before paying.</p>
      <a href="https://razorpay.me/@anandanpriyan" target="_blank" rel="noopener noreferrer" aria-describedby="razorpay-page-note" className="inline-flex min-h-11 items-center rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-400">Pay via Razorpay <span className="sr-only">(opens in a new tab)</span></a>
      <p id="razorpay-page-note" className="text-xs text-slate-400">Opens in a new tab. Payment confirmation is shown by Razorpay. This link does not automatically unlock FinFam Premium.</p>
    </div>
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-bold text-white">Razorpay merchant account</h2><p className="text-sm text-slate-300">Your account’s actual payments • auto-refresh every 15 seconds</p></div>
      <span className="text-emerald-300">{data ? `${error ? 'Sync interrupted' : 'Connected'} · ${data.mode.toUpperCase()}` : 'Connection not verified'}</span></div>
    <p className="text-sm text-slate-300">Configure your Razorpay API keys securely on the server, then sign in as the merchant administrator to verify the connection. Never enter your Razorpay password here.</p>
    {!user ? <button className="rounded-lg bg-emerald-700 px-4 py-2 text-white" onClick={login}>Sign in to connect / verify</button> : <div className="flex flex-wrap gap-4 items-center"><span>{user.email}</span><button disabled={busy} onClick={() => setRefresh(v => v + 1)} className="underline disabled:opacity-50">{busy ? 'Checking…' : 'Verify / refresh'}</button><button className="underline" onClick={() => void signOut(auth).catch(() => setError('Unable to sign out. Try again.'))}>Sign out</button></div>}
    {error && <p role="alert" className="text-amber-300">{error}{data ? ' Previously fetched data may be stale.' : ''}</p>}
    {data && <><p className="text-xs text-slate-400">Key: {data.keyHint} · Updated {new Date(data.syncedAt).toLocaleString()}<br />{data.webhookConfigured ? `Webhook receiver configured · Last received: ${data.lastWebhookAt ? new Date(data.lastWebhookAt).toLocaleString() : 'No events received yet'}` : 'Webhook setup required. Provider polling remains active.'}</p>
    {data.mode === 'test' && <p className="text-amber-300">Test mode — these are sandbox payments, not real money.</p>}
    <p className="text-sm text-slate-400">Bank balance and payouts are not provided by this connection. Payment amounts are not available bank funds.</p>
    <div className="overflow-auto"><table className="w-full text-left text-sm"><caption className="text-left pb-2">Payment history · Page {page + 1}</caption><thead><tr>{['Payment', 'Amount', 'Status', 'Method', 'Date', 'Refunded'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{data.payments.map(p => <tr key={p.id} className="border-t border-slate-700"><td className="p-2 font-mono">{p.id}</td><td className="p-2 whitespace-nowrap">{money(p.amount, p.currency)}</td><td className="p-2">{p.status}</td><td className="p-2">{p.method}</td><td className="p-2 whitespace-nowrap">{new Date(p.created_at * 1000).toLocaleString()}</td><td className="p-2">{money(p.amount_refunded, p.currency)}</td></tr>)}</tbody></table></div>
    {!data.payments.length && <p>No payments on this page.</p>}
    <div className="flex gap-4"><button className="underline disabled:opacity-40" disabled={page === 0 || busy} onClick={() => setPage(p => p - 1)}>Previous</button><button className="underline disabled:opacity-40" disabled={!data.hasMore || busy} onClick={() => setPage(p => p + 1)}>Next</button></div></>}
  </section>;
}
