const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mountMerchant, validSignature } = require('../razorpayMerchant');
function harness(overrides = {}) {
  const routes = {};
  const docs = new Map();
  let calls = 0;
  const env = { RAZORPAY_KEY_ID: 'rzp_test_example', RAZORPAY_KEY_SECRET: 'test-only', RAZORPAY_WEBHOOK_SECRET: 'webhook-test', RAZORPAY_ADMIN_UIDS: 'owner' };
  const admin = { apps: [{}], auth: () => ({ verifyIdToken: async token => { if (token === 'invalid') throw Error(); return { uid: token }; } }) };
  const db = { collection: name => ({ doc: id => ({ key: `${name}/${id}`, get: async () => ({ data: () => docs.get(`${name}/${id}`) }) }) }), runTransaction: async fn => fn({ get: async ref => ({ exists: docs.has(ref.key) }), set: (ref, value) => docs.set(ref.key, value) }) };
  mountMerchant({ get: (p, ...h) => routes[p] = h, post: (p, ...h) => routes[p] = h }, { env, admin, db, request: async () => { calls++; return { ok: true, json: async () => ({ items: [{ id: 'pay_1', amount: 100, currency: 'INR', status: 'captured', email: 'private@example.com' }] }) }; }, ...overrides });
  async function run(path, req = {}) {
    const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    const handlers = routes[`/api/razorpay/merchant/${path}`];
    const input = { headers: { authorization: 'Bearer owner' }, query: {}, ...req };
    for (const handler of handlers) { let next = false; await handler(input, res, () => next = true); if (!next) break; }
    return res;
  }
  return { run, docs, get calls() { return calls; } };
}
test('missing/foreign/revoked identities cannot query the provider', async () => {
  const h = harness();
  for (const [token, code] of [['', 401], ['Bearer stranger', 403], ['Bearer invalid', 401]]) assert.equal((await h.run('payments', { headers: { authorization: token } })).code, code);
  assert.equal(h.calls, 0);
});
test('no keys never becomes connected', async () => { const h = harness({ env: { RAZORPAY_ADMIN_UIDS: 'owner' } }); assert.equal((await h.run('payments')).body.connection, 'not_configured'); assert.equal(h.calls, 0); });
test('real provider response is whitelisted and labelled test', async () => { const r = await harness().run('payments'); assert.equal(r.body.mode, 'test'); assert.equal(r.body.payments[0].email, undefined); assert.equal(r.body.balance, null); });
test('invalid pagination is rejected before API access', async () => { const h = harness(); assert.equal((await h.run('payments', { query: { skip: '-1' } })).code, 400); assert.equal(h.calls, 0); });
test('upstream failure cannot return a connected response', async () => { const h = harness({ request: async () => ({ ok: false, status: 401 }) }); const r = await h.run('payments'); assert.equal(r.code, 502); assert.equal(r.body.connection, undefined); });
test('raw body tampering and malformed signatures are rejected', () => { const raw = Buffer.from('{"event":"payment.captured"}'); const sig = crypto.createHmac('sha256', 'secret').update(raw).digest('hex'); assert.equal(validSignature(raw, sig, 'secret'), true); assert.equal(validSignature(Buffer.concat([raw, Buffer.from(' ')]), sig, 'secret'), false); assert.equal(validSignature(raw, 'bad', 'secret'), false); assert.equal(validSignature(raw, sig, ''), false); });
test('signed duplicate delivery is persisted once without mutating payment state', async () => { const h = harness(); const body = Buffer.from('{"event":"payment.captured"}'); const signature = crypto.createHmac('sha256', 'webhook-test').update(body).digest('hex'); const req = { body, headers: { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'event-1' } }; assert.equal((await h.run('webhook', req)).code, 200); assert.equal((await h.run('webhook', req)).code, 200); assert.equal(h.docs.size, 2); assert.equal((await h.run('webhook', { ...req, body: Buffer.from('{}') })).code, 400); });
test('webhook cannot acknowledge without durable storage', async () => { assert.equal((await harness({ db: null }).run('webhook')).code, 503); });
