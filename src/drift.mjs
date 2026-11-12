// Scope watch: read what the client actually said, find the moments that ask for
// something outside the agreed scope, and draft a priced change order for each.
// The model only drafts. A person decides every card; nothing here touches PayPal.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_MESSAGES = 240;
const MAX_TEXT = 60000;
const MY_NAMES = /^(me|myself|you|i|studio|us|we|freelancer|designer|developer|agency|contractor)$/i;
const REQUEST_CUE = /\b(can|could|would|will) (you|we|u)\b|\balso\b|one more thing|while you'?re at it|while you are at it|we'?d (like|love|need)|we would (like|love|need)|i'?d (like|love|need)|i would (like|love|need)|\bwhat about\b|\bhow about\b|\bneed(s)? (a|an|the|some|another)\b|\badd (a|an|the|some)\b|on top of|\bextra\b|\banother\b|by the way|\bbtw\b|\bas well\b|\bwant (a|an|the|some|to)\b|\bplease (add|make|include|do)\b|\bthrow in\b/i;
const NEW_WORK_CUE = /\balso\b|one more thing|while you'?re at it|while you are at it|on top of|\bextra\b|\banother\b|\bas well\b|\bthrow in\b|\bby the way\b|\bbtw\b|\badd (a|an|the|some)\b|\bnew\b/i;
const STOP = new Set('a an the and or of to for in on at by with from is are be can could would will you we i it its our your my me us that this these those there then than so as do does did have has had not no just please also need needs want make made get got let lets one more some any too very really bit little quick quickly maybe'.split(' '));
const BIG = /\b(website|web ?site|app|video|animation|packaging|campaign|series|brand book|brand guide|landing|store|shop|translation|rebuild|redesign|site)\b/i;
const SMALL = /\b(banner|sticker|stickers|card|cards|flyer|poster|social|post|resize|colou?r|tweak|icon|favicon|watermark|variant|version|file|format|export|template|sign off|signature|label|tag)\b/i;

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
};
const httpError = (status, message) => Object.assign(new Error(message), { status });
const assert = (c, status, message) => { if (!c) throw httpError(status, message); };
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const words = s => (String(s).toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).map(w => w.replace(/(ing|ed|es|s)$/, '')).filter(w => w.length > 2 && !STOP.has(w));
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
const roundPrice = cents => Math.max(5000, Math.round(cents / 500) * 500);

export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// A pasted chat or email thread becomes messages. "Name: text" starts a message,
// a "[12:04]" or "12:04" prefix is kept as the time, quoted email lines are ignored,
// and any other line continues the message above it.
export function parseThread(text) {
  const out = [];
  const head = /^\s*(?:\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]m)?)\]?\s*[-–]?\s*)?([A-Za-z][\w.'’ -]{0,30}?)\s*:\s+(.+)$/i;
  for (const raw of String(text ?? '').slice(0, MAX_TEXT).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('>') || /^(on .+ wrote:|from:|to:|cc:|subject:|sent:|date:)/i.test(line)) continue;
    const m = line.match(head);
    if (m && !/^https?$/i.test(m[2])) out.push({ who: clip(m[2], 30), at: m[1] ?? null, text: m[3].trim() });
    else if (out.length) out[out.length - 1].text += ' ' + line;
    else out.push({ who: 'Client', at: null, text: line });
  }
  return finishMessages(out);
}

export function messagesFromTranscript(lines) {
  const out = (Array.isArray(lines) ? lines : []).filter(l => l && typeof l.text === 'string' && l.text.trim())
    .map(l => ({ who: 'On the call', at: formatClock(l.start), text: l.text.trim() }));
  return finishMessages(out);
}

function finishMessages(list) {
  return list.slice(0, MAX_MESSAGES).map((m, i) => ({ id: 'm' + (i + 1), who: m.who, at: m.at, text: clip(m.text, 1200), mine: MY_NAMES.test(m.who) }));
}

export function scopeOf(project) {
  const items = (project?.checkpoints ?? []).map(cp => ({ title: cp.title, ready: cp.acceptedEvidence || cp.proposedEvidence || '', amount: cp.amount ?? 0 }));
  const text = [project?.project?.brief ?? '', ...items.map(i => i.title + ' ' + i.ready)].join(' ');
  const amounts = items.map(i => i.amount).filter(n => n > 0).sort((a, b) => a - b);
  const median = amounts.length ? amounts[Math.floor(amounts.length / 2)] : 60000;
  return { label: project?.project?.label ?? '', brief: project?.project?.brief ?? '', items, words: new Set(words(text)), median };
}

function sentencesOf(text) {
  return (String(text).match(/[^.!?]+[.!?]*/g) ?? [text]).map(s => s.trim()).filter(Boolean);
}

function askTitle(sentence) {
  let s = sentence.replace(/^(and |also,? |oh,? |ok,? |okay,? |so,? |hey,? |one more thing[:,]? |by the way,? )+/i, '')
    .replace(/^(can|could|would|will) (you|we) (also |maybe |possibly |please )*/i, '')
    .replace(/^(we|i)('d| would) (also )?(like|love|need) (to have |to get )?/i, '')
    .replace(/^(what|how) about /i, '').replace(/^please /i, '').replace(/[?!.]+$/, '');
  const w = s.split(/\s+/).slice(0, 9).join(' ');
  return cap1(w || sentence);
}

export function priceFor(sentence, scope) {
  let factor = BIG.test(sentence) ? 0.85 : SMALL.test(sentence) ? 0.25 : 0.4;
  return roundPrice(scope.median * factor);
}

export function readyWhenFor(title) {
  return 'Ready when ' + title.charAt(0).toLowerCase() + title.slice(1) + ' is delivered in the agreed file format and you have approved it in writing.';
}

// Deterministic reading: a request cue, and either wording that adds new work or
// little overlap with the words of the agreed scope.
export function findMomentsByRules(messages, scope) {
  const moments = [];
  for (const m of messages) {
    if (m.mine) continue;
    for (const s of sentencesOf(m.text)) {
      if (!REQUEST_CUE.test(s) || s.length < 12) continue;
      const w = words(s);
      if (w.length < 2) continue;
      const shared = w.filter(x => scope.words.has(x)).length;
      const overlap = shared / w.length;
      const strong = NEW_WORK_CUE.test(s);
      if (!strong && overlap >= 0.34) continue;
      if (strong && overlap >= 0.8) continue;
      const title = askTitle(s);
      moments.push({ messageId: m.id, quote: s, title, likely: overlap < 0.2 ? 'outside' : 'unclear', priceCents: priceFor(s, scope), readyWhen: readyWhenFor(title), source: 'rules' });
      break;
    }
  }
  return moments;
}

function momentsPrompt(messages, scope) {
  return 'You help a freelancer notice scope creep. Below is the AGREED SCOPE and a numbered conversation. ' +
    'Find only the messages from the client that ask for work that is NOT already in the agreed scope. ' +
    'For each, give a short title of the extra work, a fair price in USD for it (relative to the agreed prices), and one sentence starting with "Ready when" that says how both sides will know it is finished. ' +
    'Answer with JSON only: {"moments":[{"id":"m3","title":"...","price_usd":250,"ready_when":"Ready when ..."}]}. Use [] if nothing is outside scope.\n\n' +
    'AGREED SCOPE: ' + clip(scope.brief, 900) + '\nDeliverables:\n' + scope.items.map(i => '- ' + i.title + ' ($' + Math.round(i.amount / 100) + '): ' + clip(i.ready, 220)).join('\n') +
    '\n\nCONVERSATION:\n' + messages.map(m => m.id + ' [' + m.who + ']: ' + m.text).join('\n');
}

async function askModel(prompt, { model, port, fetchImpl, timeoutMs }) {
  const r = await fetchImpl('http://127.0.0.1:' + port + '/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, format: 'json', options: { temperature: 0.2 } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error('model http ' + r.status);
  const body = await r.json();
  return JSON.parse(body.response);
}

export function validateModelMoments(result, messages, scope) {
  if (!result || !Array.isArray(result.moments)) return null;
  const byId = new Map(messages.map(m => [m.id, m]));
  const seen = new Set();
  const out = [];
  for (const x of result.moments.slice(0, 12)) {
    const m = byId.get(x?.id);
    if (!m || m.mine || seen.has(m.id)) continue;
    const title = clip(x.title, 90);
    const price = Number(x.price_usd);
    if (!title || !Number.isFinite(price) || price <= 0 || price > 100000) continue;
    seen.add(m.id);
    const sentence = sentencesOf(m.text).find(s => REQUEST_CUE.test(s)) ?? m.text;
    let ready = clip(x.ready_when, 260);
    if (!/^ready when/i.test(ready)) ready = ready ? 'Ready when ' + ready.charAt(0).toLowerCase() + ready.slice(1) : readyWhenFor(title);
    out.push({ messageId: m.id, quote: sentence, title, likely: 'outside', priceCents: Math.round(price * 100), readyWhen: ready, source: 'model' });
  }
  return out;
}

export async function findMoments(messages, scope, { model, port, fetchImpl, timeoutMs = 60000 } = {}) {
  let used = 'rules', note = '';
  if (model) {
    try {
      const result = await askModel(momentsPrompt(messages, scope), { model, port, fetchImpl, timeoutMs });
      const moments = validateModelMoments(result, messages, scope);
      if (moments?.length) return { moments, reader: 'local model', note };
      note = moments ? 'The local model found nothing outside scope, so the rules were used too.' : 'The local model answer was not usable, so the rules were used.';
    } catch { note = 'The local model did not answer in time, so the rules were used.'; }
  } else note = 'No local model is chosen, so the rules were used.';
  return { moments: findMomentsByRules(messages, scope), reader: used, note };
}

function dollarsFrom(text) {
  const m = text.match(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/) ?? text.match(/\b(\d[\d,]*(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)\b/i);
  return m ? Math.round(Number(m[1].replace(/,/g, '')) * 100) : null;
}

// Typed or spoken correction applied to one card. Rules first, the model only if the rules found nothing.
export function reviseByRules(card, instruction) {
  const t = clip(instruction, 400);
  const changes = {};
  const dollars = dollarsFrom(t);
  if (dollars && dollars > 0 && dollars <= 10000000) changes.priceCents = dollars;
  else if (/\b(double|twice)\b/i.test(t)) changes.priceCents = card.priceCents * 2;
  else if (/\bhalf\b/i.test(t)) changes.priceCents = Math.max(500, Math.round(card.priceCents / 2 / 500) * 500);
  else {
    const pct = t.match(/(\d{1,3})\s?%/);
    if (pct) { const f = Number(pct[1]) / 100; changes.priceCents = Math.max(500, Math.round(card.priceCents * (/(off|less|lower|cheaper|discount|down)/i.test(t) ? 1 - f : 1 + f) / 500) * 500); }
  }
  const rw = t.match(/ready when\s+(.+)$/i);
  if (rw) changes.readyWhen = 'Ready when ' + rw[1].replace(/[.\s]+$/, '') + '.';
  else {
    const extra = t.match(/\b(?:must|should|needs? to|has to|include|including|also needs?)\s+(.+)$/i);
    if (extra) changes.readyWhen = card.readyWhen.replace(/[.\s]+$/, '') + ', and it ' + (/^(include|including)/i.test(extra[0]) ? 'includes ' + extra[1] : extra[0].replace(/^(must|should|needs? to|has to)\s+/i, 'also ')).replace(/[.\s]+$/, '') + '.';
  }
  const title = t.match(/\b(?:call it|rename (?:it )?to|title)\s+["“]?(.+?)["”]?$/i);
  if (title) changes.title = clip(title[1], 90);
  if (/\b(free|no charge|included|in scope|never mind|ignore)\b/i.test(t) && !changes.priceCents) changes.verdict = 'in_scope';
  return changes;
}

export async function revise(card, instruction, scope, { model, port, fetchImpl, timeoutMs = 45000 } = {}) {
  let changes = reviseByRules(card, instruction);
  let reader = 'rules';
  if (!Object.keys(changes).length && model) {
    try {
      const prompt = 'A freelancer drafted this change order. Apply the correction and answer with JSON only: {"title":"...","price_usd":number,"ready_when":"Ready when ..."}. Keep fields the correction does not mention.\n' +
        JSON.stringify({ title: card.title, price_usd: card.priceCents / 100, ready_when: card.readyWhen }) + '\nCorrection: ' + clip(instruction, 400);
      const r = await askModel(prompt, { model, port, fetchImpl, timeoutMs });
      const price = Number(r.price_usd);
      if (Number.isFinite(price) && price > 0 && price <= 100000 && Math.round(price * 100) !== card.priceCents) changes.priceCents = Math.round(price * 100);
      if (typeof r.ready_when === 'string' && r.ready_when.trim() && clip(r.ready_when, 260) !== card.readyWhen) changes.readyWhen = clip(r.ready_when, 260);
      if (typeof r.title === 'string' && r.title.trim() && clip(r.title, 90) !== card.title) changes.title = clip(r.title, 90);
      if (Object.keys(changes).length) reader = 'local model';
    } catch { /* leave unchanged */ }
  }
  return { changes, reader };
}

export function summarize(entry) {
  const cards = entry?.cards ?? [];
  const open = cards.filter(c => c.verdict === 'pending').length;
  const unbilled = cards.filter(c => c.verdict === 'change_order' && !c.billedIn);
  const total = unbilled.reduce((s, c) => s + c.priceCents, 0);
  const status = !entry?.messages?.length ? 'quiet' : (open || unbilled.length) ? 'drifting' : 'on_scope';
  return { status, open, changeOrders: unbilled.length, totalCents: total };
}

export function createDrift({ storePath, getWorkspace, getModel, modelFetch = fetch, fetchImpl = fetch, listenUrl = process.env.SCOPESIGNAL_LISTEN_URL || 'http://127.0.0.1:5621/listen', getCsrf, getPort }) {
  const file = storePath + '.drift.json';
  let data = null, chain = Promise.resolve();
  async function load() {
    if (data) return data;
    try { data = JSON.parse(await readFile(file, 'utf8')); } catch { data = { projects: {} }; }
    if (!data.projects || typeof data.projects !== 'object') data = { projects: {} };
    return data;
  }
  async function save() {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = file + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(tmp, file);
  }
  const exclusive = fn => { const op = chain.then(fn); chain = op.catch(() => {}); return op; };
  const project = id => {
    const p = getWorkspace().projects.find(x => x.id === id);
    assert(p, 404, 'This project could not be found.');
    return p;
  };
  const view = async () => {
    await load();
    const projects = {};
    for (const [id, e] of Object.entries(data.projects)) projects[id] = { ...e, summary: summarize(e) };
    return { projects };
  };

  async function readJson(req, limit = 200000) {
    let n = 0; const chunks = [];
    for await (const c of req) { n += c.length; assert(n <= limit, 413, 'Request exceeds the permitted size.'); chunks.push(c); }
    try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); assert(v && typeof v === 'object' && !Array.isArray(v), 400, 'Expected a JSON object.'); return v; }
    catch (e) { throw e.status ? e : httpError(400, 'Invalid JSON.'); }
  }
  function guard(req) {
    assert(req.headers['x-scopesignal-token'] === getCsrf(), 403, 'Missing session protection token.');
    const o = req.headers.origin ?? '';
    assert(o === 'http://127.0.0.1:' + getPort() || o === 'http://localhost:' + getPort(), 403, 'Request origin is not this local ScopeSignal server.');
  }

  async function handle(req, res, url) {
    try {
      if (req.method === 'GET' && url.pathname === '/api/drift') return json(res, 200, await view());
      assert(req.method === 'POST', 405, 'Method not permitted.');
      guard(req);
      if (url.pathname === '/api/drift/transcribe') {
        let n = 0; const chunks = [];
        for await (const c of req) { n += c.length; assert(n <= 120 * 1024 * 1024, 413, 'The recording is too large.'); chunks.push(c); }
        assert(n > 0, 400, 'Choose a recording.');
        let r;
        try {
          r = await fetchImpl(listenUrl, { method: 'POST', headers: { 'content-type': req.headers['content-type'] || 'application/octet-stream' }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(300000) });
        } catch { throw httpError(503, 'The local speech-to-text service is not running. Paste the conversation instead.'); }
        assert(r.ok, 502, 'The local speech-to-text service could not read that recording.');
        const out = await r.json();
        return json(res, 200, { lines: (Array.isArray(out.lines) ? out.lines : []).map(l => ({ start: Number(l.start) || 0, end: Number(l.end) || 0, text: clip(l.text, 1200) })) });
      }
      const input = await readJson(req);
      await load();
      if (url.pathname === '/api/drift/analyze') {
        const p = project(input.projectId);
        const messages = Array.isArray(input.lines) ? messagesFromTranscript(input.lines) : parseThread(input.thread);
        assert(messages.length, 400, 'There is no conversation to read. Paste the thread or add a recording.');
        const scope = scopeOf(p);
        const sel = getModel();
        const found = await findMoments(messages, scope, { model: input.useModel === false ? '' : sel.model, port: sel.port, fetchImpl: modelFetch });
        return json(res, 200, await exclusive(async () => {
          const prev = data.projects[p.id];
          const keep = new Map((prev?.cards ?? []).filter(c => c.verdict !== 'pending').map(c => [c.messageId + '|' + c.quote, c]));
          const cards = found.moments.map((m, i) => keep.get(m.messageId + '|' + m.quote) ?? { id: 'c' + Date.now().toString(36) + i, verdict: 'pending', ...m });
          data.projects[p.id] = { updatedAt: new Date().toISOString(), kind: Array.isArray(input.lines) ? 'recording' : 'thread', reader: found.reader, note: found.note, messages, cards, billed: prev?.billed ?? [] };
          await save();
          return { entry: { ...data.projects[p.id], summary: summarize(data.projects[p.id]) } };
        }));
      }
      const entry = data.projects[input.projectId];
      assert(entry, 404, 'No conversation has been added for this project.');
      const card = entry.cards.find(c => c.id === input.cardId);
      if (url.pathname === '/api/drift/decide') {
        assert(card && ['in_scope', 'change_order', 'pending'].includes(input.verdict), 400, 'Unknown card or decision.');
        assert(!card.billedIn, 409, 'This change order is already on a PayPal request.');
        return json(res, 200, await exclusive(async () => { card.verdict = input.verdict; await save(); return { entry: { ...entry, summary: summarize(entry) } }; }));
      }
      if (url.pathname === '/api/drift/revise') {
        assert(card, 404, 'Unknown card.');
        assert(!card.billedIn, 409, 'This change order is already on a PayPal request.');
        const instruction = clip(input.instruction, 400);
        assert(instruction, 400, 'Say or type what to change.');
        const sel = getModel();
        const { changes, reader } = await revise(card, instruction, scopeOf(project(input.projectId)), { model: sel.model, port: sel.port, fetchImpl: modelFetch });
        return json(res, 200, await exclusive(async () => {
          const applied = [];
          if (changes.priceCents) { card.priceCents = changes.priceCents; applied.push('price'); }
          if (changes.readyWhen) { card.readyWhen = changes.readyWhen; applied.push('ready-when line'); }
          if (changes.title) { card.title = changes.title; applied.push('title'); }
          if (changes.verdict) { card.verdict = changes.verdict; applied.push('decision'); }
          if (applied.length) { card.source = 'edited'; await save(); }
          return { entry: { ...entry, summary: summarize(entry) }, applied, reader };
        }));
      }
      if (url.pathname === '/api/drift/billed') {
        const ids = Array.isArray(input.cardIds) ? input.cardIds : [];
        assert(typeof input.billingProjectId === 'string' && ids.length, 400, 'Nothing to record.');
        return json(res, 200, await exclusive(async () => {
          let total = 0;
          for (const c of entry.cards) if (ids.includes(c.id) && c.verdict === 'change_order' && !c.billedIn) { c.billedIn = input.billingProjectId; total += c.priceCents; }
          entry.billed.push({ billingProjectId: input.billingProjectId, cardIds: ids, totalCents: total, at: new Date().toISOString() });
          await save();
          return { entry: { ...entry, summary: summarize(entry) } };
        }));
      }
      throw httpError(404, 'Unknown action.');
    } catch (e) {
      json(res, e.status ?? 500, { error: e.status ? e.message : 'Internal operation failed.' });
    }
  }
  return { handle, view };
}
