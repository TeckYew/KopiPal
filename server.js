import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';

const { PAYPAL_CLIENT_ID: CID, PAYPAL_CLIENT_SECRET: SECRET, ANTHROPIC_API_KEY: AKEY,
  DEMO_HOST_EMAIL = '', CURRENCY: CUR = 'USD', PORT = 3000 } = process.env;
const BASE = process.env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com';
const FEE = 0.2; // KopiPal keeps 20% of a forfeited deposit; 80% goes to the person who waited
if (!CID || !SECRET) console.warn('Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET - see .env.example');

const app = express();
app.use(express.json());
app.use(express.static('public'));
const h = fn => (req, res) => fn(req, res).catch(e => res.status(400).json({ error: e.message }));

// ---- PayPal REST helper: cached OAuth token, idempotent calls via PayPal-Request-Id
let tok = { v: '', exp: 0 };
async function pp(path, body, id) {
  if (Date.now() > tok.exp) {
    const r = await fetch(`${BASE}/v1/oauth2/token`, { method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${CID}:${SECRET}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials' });
    const j = await r.json();
    if (!r.ok) throw new Error('PayPal auth failed. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.');
    tok = { v: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  }
  const r = await fetch(BASE + path, { method: 'POST',
    headers: { Authorization: 'Bearer ' + tok.v, 'Content-Type': 'application/json', 'PayPal-Request-Id': id || crypto.randomUUID(), Prefer: 'return=representation' },
    body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.name || 'PayPal error');
  return j;
}

// ---- In-memory state (resets on restart; fine for a demo)
const money = n => Number(n).toFixed(2);
const inH = x => new Date(Date.now() + x * 36e5).toISOString();
const sessions = [
  { id: 's1', title: 'Kopi-O and kaya toast, no small talk required', cafe: 'Ya Kun Kaya Toast, Far East Square', when: inH(20), deposit: 3, host: 'Mei Ling', hostEmail: DEMO_HOST_EMAIL, vibe: 'quiet, first-timer friendly', max: 3, code: '4821', hostKey: 'seed', people: [], status: 'open' },
  { id: 's2', title: 'Kopi-C and startup gossip', cafe: 'Toast Box, Tiong Bahru Plaza', when: inH(30), deposit: 5, host: 'Arjun', hostEmail: DEMO_HOST_EMAIL, vibe: 'chatty, tech, careers', max: 4, code: '7305', hostKey: 'seed', people: [], status: 'open' },
];
const ledger = [];
const log = (kind, text, ref = '') => ledger.unshift({ t: new Date().toISOString(), kind, text, ref });
const pub = s => ({ id: s.id, title: s.title, cafe: s.cafe, when: s.when, deposit: s.deposit, host: s.host, vibe: s.vibe, max: s.max, status: s.status, currency: CUR,
  people: s.people.map(p => ({ name: p.name, checkedIn: p.checkedIn, outcome: p.outcome })) });
const get = req => { const s = sessions.find(x => x.id === req.params.id); if (!s) throw new Error('Session not found'); return s; };

app.get('/api/config', (_, res) => res.json({ clientId: CID, currency: CUR }));
app.get('/api/sessions', (_, res) => res.json(sessions.map(pub)));
app.get('/api/ledger', (_, res) => res.json(ledger.slice(0, 30)));

app.post('/api/sessions', h(async (req, res) => {
  const { title, cafe, when, deposit, host, hostEmail, vibe, max } = req.body;
  if (!title || !cafe || !when || !host || !/^\S+@\S+$/.test(hostEmail || ''))
    throw new Error('Fill in every field, including the PayPal email where you want to receive no-show deposits.');
  const s = { id: 's' + crypto.randomBytes(3).toString('hex'), title, cafe, when, host, hostEmail, vibe: vibe || '',
    deposit: Math.min(Math.max(+deposit || 3, 1), 20), max: Math.min(Math.max(+max || 3, 2), 6),
    code: String(crypto.randomInt(1000, 10000)), hostKey: crypto.randomUUID(), people: [], status: 'open' };
  sessions.unshift(s);
  res.json({ id: s.id, code: s.code, hostKey: s.hostKey });
}));

// 1) Create a PayPal order with intent AUTHORIZE: money is held, not taken
app.post('/api/sessions/:id/order', h(async (req, res) => {
  const s = get(req), { name } = req.body;
  if (!name) throw new Error('Enter your name first.');
  if (s.status !== 'open' || s.people.length >= s.max) throw new Error('This session is full or closed.');
  if (name === s.host || s.people.some(p => p.name === name)) throw new Error('You are already in this session.');
  const o = await pp('/v2/checkout/orders', { intent: 'AUTHORIZE', purchase_units: [{ reference_id: s.id,
    description: `KopiPal show-up deposit: ${s.title}`, amount: { currency_code: CUR, value: money(s.deposit) } }] });
  res.json({ orderId: o.id });
}));

// 2) Buyer approved in the PayPal popup: place the hold
app.post('/api/sessions/:id/join', h(async (req, res) => {
  const s = get(req), { name, orderId } = req.body;
  const a = await pp(`/v2/checkout/orders/${orderId}/authorize`);
  const auth = a.purchase_units[0].payments.authorizations[0];
  s.people.push({ name, authId: auth.id, checkedIn: false, outcome: null });
  log('hold', `${name} put a ${CUR} ${money(s.deposit)} hold on “${s.title}”`, auth.id);
  res.json({ ok: true });
}));

// 3) Show up at the cafe and enter the host's code
app.post('/api/sessions/:id/checkin', h(async (req, res) => {
  const s = get(req), p = s.people.find(x => x.name === req.body.name);
  if (!p) throw new Error('You have not joined this session.');
  if (String(req.body.code) !== s.code) throw new Error('Wrong code. Ask your host for the 4-digit code.');
  p.checkedIn = true;
  log('checkin', `${p.name} checked in at ${s.cafe}`);
  res.json({ ok: true });
}));

// 4) Settle: void holds for people who came, capture + pay out for no-shows
app.post('/api/sessions/:id/settle', h(async (req, res) => {
  const s = get(req);
  if (req.body.hostKey !== s.hostKey) throw new Error('Only the host can settle this session.');
  if (s.status === 'settled') throw new Error('Already settled.');
  let forfeited = 0;
  for (const p of s.people) {
    if (p.checkedIn) {
      await pp(`/v2/payments/authorizations/${p.authId}/void`, {}, `void-${p.authId}`);
      p.outcome = 'released';
      log('release', `${p.name} showed up. Hold released, ${CUR} 0.00 charged`, p.authId);
    } else {
      const c = await pp(`/v2/payments/authorizations/${p.authId}/capture`, { final_capture: true }, `cap-${p.authId}`);
      p.outcome = 'forfeited'; forfeited += s.deposit;
      log('capture', `${p.name} was a no-show. ${CUR} ${money(s.deposit)} captured`, c.id);
    }
  }
  if (forfeited && s.hostEmail) {
    const amt = money(forfeited * (1 - FEE));
    const b = await pp('/v1/payments/payouts', {
      sender_batch_header: { sender_batch_id: `kp-${s.id}-${Date.now()}`, email_subject: 'Your kopi is on us' },
      items: [{ recipient_type: 'EMAIL', receiver: s.hostEmail, amount: { value: amt, currency: CUR },
        note: `KopiPal: ${s.host}, someone left you waiting. Have a kopi on us.`, sender_item_id: `${s.id}-host` }] });
    log('payout', `${s.host} was left waiting. ${CUR} ${amt} paid out to their PayPal`, b.batch_header.payout_batch_id);
  }
  s.status = 'settled';
  res.json({ ok: true });
}));

// AI matchmaker (Claude): picks the best open session and writes an icebreaker
app.post('/api/match', h(async (req, res) => {
  const open = sessions.filter(s => s.status === 'open' && s.people.length < s.max)
    .map(s => ({ id: s.id, title: s.title, cafe: s.cafe, vibe: s.vibe, when: s.when, host: s.host, deposit: s.deposit }));
  if (!open.length) return res.json({ why: 'No open sessions yet. Host one and others will join you.' });
  if (!AKEY) return res.json({ pick: open[0].id, why: 'Add ANTHROPIC_API_KEY for AI matching. Showing the soonest session.', icebreaker: 'What is your go-to kopi order?' });
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'x-api-key': AKEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400,
      system: 'You are KopiPal, a warm Singaporean matchmaker helping lonely people find a kopi kaki. Given the person and the open sessions, reply with ONLY JSON: {"pick":"<session id>","why":"<one friendly sentence>","icebreaker":"<one easy opening line for them to say>"}.',
      messages: [{ role: 'user', content: JSON.stringify({ person: req.body, open }) }] }) });
  const j = await r.json();
  if (!r.ok) throw new Error('AI matcher is unavailable right now.');
  res.json(JSON.parse(j.content.find(c => c.type === 'text').text.replace(/```json|```/g, '').trim()));
}));

app.listen(PORT, () => console.log(`KopiPal running on http://localhost:${PORT}`));
