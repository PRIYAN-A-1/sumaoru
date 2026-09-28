const crypto = require('node:crypto');

function validSignature(raw, signature, secret) {
  if (!secret || !Buffer.isBuffer(raw) || !/^[a-f0-9]{64}$/i.test(signature || '')) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

// Single merchant, server-managed credentials. No credentials are accepted from clients.
function mountMerchant(app, { admin, db, env = process.env, request = fetch }) {
  const prefix = '/api/razorpay/merchant';
  const key = env.RAZORPAY_KEY_ID;
  const secret = env.RAZORPAY_KEY_SECRET;
  const mode = key?.startsWith('rzp_live_') ? 'live' : key?.startsWith('rzp_test_') ? 'test' : null;
  const configured = Boolean(mode && secret);
  const accountScope = crypto.createHash('sha256').update(key || 'unconfigured').digest('hex').slice(0, 24);
  const owners = new Set((env.RAZORPAY_ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean));

  async function owner(req, res, next) {
    res.set('Cache-Control', 'no-store');
    if (!admin.apps.length || !owners.size) return res.status(503).json({ error: 'Merchant access setup required: configure Firebase Admin and RAZORPAY_ADMIN_UIDS.' });
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    if (!token) return res.status(401).json({ error: 'Sign in to view your merchant account.' });
    try {
      const identity = await admin.auth().verifyIdToken(token, true);
      if (!owners.has(identity.uid)) return res.status(403).json({ error: 'This account is not a merchant administrator.' });
      next();
    } catch { res.status(401).json({ error: 'Session expired. Sign in again.' }); }
  }

  async function provider(path) {
    const response = await request(`https://api.razorpay.com/v1/${path}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      const error = new Error(response.status === 401 ? 'Razorpay credentials rejected.' : response.status === 429 ? 'Provider rate limit reached. Try again shortly.' : 'Razorpay is unavailable or this account lacks permission.');
      error.status = response.status === 401 ? 502 : 503;
      throw error;
    }
    return response.json();
  }

  app.get(`${prefix}/payments`, owner, async (req, res) => {
    if (!configured) return res.status(503).json({ error: 'Setup required: configure Razorpay API keys on the backend.', connection: 'not_configured' });
    const skip = Number(req.query.skip || 0);
    if (!Number.isSafeInteger(skip) || skip < 0 || skip > 100000) return res.status(400).json({ error: 'Invalid page.' });
    try {
      const result = await provider(`payments?count=25&skip=${skip}`);
      if (!Array.isArray(result.items)) throw new Error('Unexpected provider response.');
      // Whitelist fields: no customer email, card, phone, tokens, or notes.
      const payments = result.items.map(p => ({ id: p.id, amount: p.amount, currency: p.currency, status: p.status, method: p.method, created_at: p.created_at, amount_refunded: p.amount_refunded || 0 }));
      let lastWebhookAt = null;
      if (db) {
        const snapshot = await db.collection('razorpayMerchantSync').doc(accountScope).get();
        lastWebhookAt = snapshot.data()?.receivedAt || null;
      }
      res.json({ connection: 'connected', mode, keyHint: `${key.slice(0, 9)}…${key.slice(-4)}`, payments, skip, hasMore: payments.length === 25, syncedAt: new Date().toISOString(), lastWebhookAt, webhookConfigured: Boolean(db && env.RAZORPAY_WEBHOOK_SECRET), balance: null });
    } catch (error) { res.status(error.status || 503).json({ error: error.message === 'Unexpected provider response.' ? error.message : error.status ? error.message : 'Unable to sync. Please retry.' }); }
  });

  app.post(`${prefix}/webhook`, async (req, res) => {
    if (!configured || !db || !env.RAZORPAY_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook persistence and credentials must be configured.' });
    const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : req.body; // Firebase preserves rawBody.
    if (!validSignature(raw, req.headers['x-razorpay-signature'], env.RAZORPAY_WEBHOOK_SECRET)) return res.status(400).json({ error: 'Invalid webhook signature.' });
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid JSON.' }); }
    if (!event || typeof event.event !== 'string') return res.status(400).json({ error: 'Invalid event.' });
    const suppliedId = req.headers['x-razorpay-event-id'];
    const eventId = crypto.createHash('sha256').update(accountScope).update(suppliedId || raw).digest('hex');
    try {
      await db.runTransaction(async tx => {
        const receipt = db.collection('razorpayMerchantEvents').doc(eventId);
        if ((await tx.get(receipt)).exists) return;
        const receivedAt = new Date().toISOString();
        tx.set(receipt, { event: event.event, receivedAt, accountScope });
        tx.set(db.collection('razorpayMerchantSync').doc(accountScope), { receivedAt });
      });
      // Webhooks are durable notifications only. Dashboard always fetches canonical
      // provider state, so old/replayed events cannot regress payment status.
      res.json({ received: true });
    } catch { res.status(503).json({ error: 'Could not persist event; retry delivery.' }); }
  });
}
module.exports = { mountMerchant, validSignature };
