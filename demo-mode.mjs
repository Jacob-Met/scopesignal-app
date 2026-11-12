// Simulated demo mode: `node scripts/sandbox-live.mjs --demo` (or `npm run demo`).
// Nothing here runs unless that flag is given. It replaces the two outbound
// calls (PayPal Sandbox and the local model) with in-process fakes, serves a
// tiny "Simulated PayPal approval" page, and adds a badge plus a sample brief.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const SAMPLE_BRIEF = 'Harbor Lane Bakery is reopening on December 5 and needs a new identity. We need a logo with a one-colour version for stamps, a printed menu for the counter, and a painted sign for the front window. The owner wants to see the logo before anything else is made. Everything has to be ready for print a week before opening.';
const CSP = "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' blob:; frame-src blob:; base-uri 'none'; frame-ancestors 'none'";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const demoApprovalPrefix = 'http://127.0.0.1:';

export function createDemo() {
  const orders = new Map();

  // Stands in for fetch() against api-m.sandbox.paypal.com.
  async function paypalFetch(url, init = {}) {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    if (pathname === '/v1/oauth2/token') {
      return json(200, { scope: 'https://uri.paypal.com/services/payments/payment', access_token: 'SIMULATED-' + randomBytes(12).toString('hex'), token_type: 'Bearer', app_id: 'SIMULATED-APP', expires_in: 32400, nonce: 'simulated' });
    }
    if (method === 'POST' && pathname === '/v2/checkout/orders') {
      const body = JSON.parse(init.body);
      const unit = body.purchase_units[0];
      const ctx = body.payment_source.paypal.experience_context;
      const id = 'SIM' + randomBytes(8).toString('hex').toUpperCase();
      const origin = new URL(ctx.return_url).origin;
      orders.set(id, { id, status: 'PAYER_ACTION_REQUIRED', unit, returnUrl: ctx.return_url, cancelUrl: ctx.cancel_url, captures: [] });
      return json(201, publicOrder(orders.get(id), origin));
    }
    const match = pathname.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
    const order = match && orders.get(decodeURIComponent(match[1]));
    if (!match || !order) return json(404, { name: 'RESOURCE_NOT_FOUND', message: 'Simulated PayPal does not know this order.' });
    if (method === 'GET' && !match[2]) return json(200, publicOrder(order, new URL(order.returnUrl).origin));
    if (method === 'POST' && match[2]) {
      if (order.status !== 'APPROVED') return json(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] });
      order.status = 'COMPLETED';
      order.captures = [{ id: 'SIMCAP' + randomBytes(7).toString('hex').toUpperCase(), status: 'COMPLETED', amount: { ...order.unit.amount }, final_capture: true, create_time: new Date().toISOString() }];
      return json(201, publicOrder(order, new URL(order.returnUrl).origin));
    }
    return json(404, { name: 'RESOURCE_NOT_FOUND', message: 'Not simulated.' });
  }
  function publicOrder(order, origin) {
    const unit = { ...order.unit, ...(order.captures.length ? { payments: { captures: order.captures } } : {}) };
    return {
      id: order.id, status: order.status, intent: 'CAPTURE', purchase_units: [unit],
      payment_source: { paypal: {} },
      links: [
        { href: origin + '/v2/checkout/orders/' + order.id, rel: 'self', method: 'GET' },
        ...(order.status === 'COMPLETED' ? [] : [{ href: origin + '/demo/paypal/approve?token=' + order.id, rel: 'payer-action', method: 'GET' }]),
      ],
    };
  }

  // Stands in for the local Ollama server: /api/tags and /api/generate.
  async function modelFetch(url, init = {}) {
    const { pathname } = new URL(url);
    if (pathname === '/api/tags') return json(200, { models: [{ name: 'demo-model' }] });
    if (pathname === '/api/generate') {
      await sleep(1200);
      const prompt = JSON.parse(init.body).prompt;
      const clauses = [...prompt.matchAll(/^(c\d+): (.*)$/gm)].map(m => ({ id: m[1], text: m[2] }));
      const pick = re => clauses.filter(c => re.test(c.text)).map(c => c.id);
      const groups = [
        { title: 'Logo design and approval', clauseIds: pick(/logo/i) },
        { title: 'Printed counter menu', clauseIds: pick(/menu/i) },
        { title: 'Painted window sign', clauseIds: pick(/\bsign\b/i) },
      ].filter(g => g.clauseIds.length);
      const used = new Set(groups.flatMap(g => g.clauseIds));
      const scopeClauseIds = pick(/reopening|ready for print/i).filter(id => !used.has(id));
      return json(200, { model: 'demo-model', done: true, response: JSON.stringify({ groups, scopeClauseIds }) });
    }
    return json(404, { error: 'not found' });
  }

  const css = `#sim-badge{position:fixed;top:8px;left:50%;transform:translateX(-50%);white-space:nowrap;z-index:2147483647;padding:6px 12px;border-radius:999px;background:#fff3bf;color:#5c4400;border:1px solid #d9a400;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:none}`;
  const script = `(function(){
var b=document.createElement('div');b.id='sim-badge';b.textContent='Simulated demo: no real PayPal call';document.body.appendChild(b);
var brief=${JSON.stringify(SAMPLE_BRIEF)};
function set(id,v){var e=document.getElementById(id);if(!e)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}
setTimeout(function(){var p=document.getElementById('project'),t=document.getElementById('brief'),c=document.getElementById('cap');
if(p&&t&&c&&!p.value.trim()&&!t.value.trim()&&!c.value.trim()){set('project','Harbor Lane Bakery rebrand');set('brief',brief);set('cap','2400');}},400);
})();`;

  // Returns true when the request was answered here.
  async function handle(req, res, url) {
    const send = (status, type, body, extra = {}) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', ...extra }); res.end(body); return true; };
    if (url.pathname === '/demo-badge.css' || url.pathname === '/demo-badge.light.css') return send(200, 'text/css; charset=utf-8', css + demoPageCss);
    if (url.pathname === '/demo-badge.js') return send(200, 'text/javascript; charset=utf-8', script);
    if (url.pathname !== '/demo/paypal/approve') return false;
    const token = url.searchParams.get('token');
    const order = orders.get(token);
    if (!order) return send(404, 'text/plain; charset=utf-8', 'Unknown simulated order.');
    if (req.method === 'POST') {
      for await (const chunk of req) void chunk;
      if (order.status === 'PAYER_ACTION_REQUIRED') order.status = 'APPROVED';
      const back = new URL(order.returnUrl);
      back.searchParams.set('token', order.id);
      back.searchParams.set('PayerID', 'SIMULATEDPAYER');
      return send(303, 'text/plain; charset=utf-8', '', { Location: back.href });
    }
    const amount = order.unit.amount;
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    return send(200, 'text/html; charset=utf-8', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated PayPal approval</title><link rel="stylesheet" href="/demo-badge.css"><script src="/demo-badge.js" defer></script></head><body class="sim-page"><main><h1>Simulated PayPal approval</h1><p>This page stands in for PayPal in the offline demo. No real payment, account or PayPal server is involved.</p><dl><dt>Order</dt><dd>' + esc(order.id) + '</dd><dt>Item</dt><dd>' + esc(order.unit.description ?? '') + '</dd><dt>Amount</dt><dd>' + esc(amount.value) + ' ' + esc(amount.currency_code) + '</dd><dt>Status</dt><dd>' + esc(order.status) + '</dd></dl><form method="post" action="/demo/paypal/approve?token=' + encodeURIComponent(order.id) + '"><button type="submit" id="sim-approve">Approve</button></form></main></body></html>');
  }

  // Adds the badge assets to HTML pages served by the app.
  function decorateHtml(bytes) {
    return Buffer.from(bytes.toString('utf8').replace('</head>', '<link rel="stylesheet" href="/demo-badge.css"><script src="/demo-badge.js" defer></script></head>'));
  }

  return { paypalFetch, modelFetch, handle, decorateHtml };
}

const demoPageCss = `.sim-page{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef1f6;color:#1a2233;font:16px/1.5 system-ui,sans-serif}.sim-page main{background:#fff;border-radius:12px;padding:28px 32px;max-width:460px;box-shadow:0 6px 24px rgba(0,0,0,.12)}.sim-page h1{margin:0 0 8px;font-size:22px}.sim-page dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px}.sim-page dt{color:#5b6475}.sim-page dd{margin:0;font-weight:600}.sim-page button{margin-top:18px;padding:10px 22px;border:0;border-radius:999px;background:#0070ba;color:#fff;font:600 16px system-ui,sans-serif;cursor:pointer}`;

// Options for createSandboxLiveServer().
export function demoOptions() {
  const demo = createDemo();
  return {
    demo,
    clientId: 'simulated', clientSecret: 'simulated',
    fetchImpl: demo.paypalFetch,
    localAiFetchImpl: demo.modelFetch,
    localAiModel: 'demo-model',
    storePath: join(mkdtempSync(join(tmpdir(), 'scopesignal-demo-')), 'workspace.json'),
  };
}
