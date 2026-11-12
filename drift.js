import { SAMPLE_PROJECT, SAMPLE_THREAD } from './src/drift-sample.mjs';

const $ = id => document.getElementById(id);
const money = cents => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
let token = '', wsState = null, drift = { projects: {} }, current = null, scope = null, focusId = null, busy = false;
const billDrafts = new Map();

async function api(path, body, raw) {
  const init = body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': raw?.type || 'application/json', 'x-scopesignal-token': token }, body: raw ? raw.body : JSON.stringify(body) };
  const r = await fetch(path, init);
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(j?.error || 'That did not work.'), { status: r.status });
  return j;
}
async function loadWorkspace(projectId) {
  const q = projectId ? '?project=' + encodeURIComponent(projectId) : '';
  const j = await api('/api/state' + q);
  token = j.token; return j.state;
}
async function loadAll() {
  wsState = await loadWorkspace();
  drift = await api('/api/drift');
}
const statusOf = id => drift.projects[id]?.summary ?? { status: 'quiet', open: 0, changeOrders: 0, totalCents: 0 };
const billingIds = () => new Set(Object.values(drift.projects).flatMap(p => (p.billed ?? []).map(b => b.billingProjectId)));
function say(id, msg, bad) { const n = $(id); n.textContent = msg || ''; n.classList.toggle('bad', Boolean(bad)); }
function pill(node, s) {
  node.className = 'pill ' + ({ drifting: 'warn', on_scope: 'ok', quiet: 'idle' })[s.status];
  node.textContent = ({ drifting: 'Drifting', on_scope: 'On scope', quiet: 'No conversation yet' })[s.status];
}

/* ---------- home ---------- */
function renderHome() {
  const list = $('home-list'); list.replaceChildren();
  const hide = billingIds();
  const projects = (wsState?.projects ?? []).filter(p => !p.archivedAt && !hide.has(p.id) && !p.reviewOnly);
  $('home-empty').hidden = projects.length > 0;
  for (const p of projects.slice().reverse()) {
    const s = statusOf(p.id);
    const li = el('li'); const a = el('button', 'proj-row'); a.type = 'button'; a.dataset.projectId = p.id;
    const left = el('div', 'proj-main'); left.append(el('strong', '', p.label));
    const sub = s.status === 'quiet' ? 'Add the client conversation to check it' : s.status === 'on_scope' ? 'Every ask so far fits what was agreed' :
      [s.open ? s.open + (s.open === 1 ? ' ask to decide' : ' asks to decide') : '', s.changeOrders ? s.changeOrders + ' change order' + (s.changeOrders === 1 ? '' : 's') + ' · ' + money(s.totalCents) + ' to bill' : ''].filter(Boolean).join(' · ');
    left.append(el('span', 'muted', sub));
    const pl = el('span'); pill(pl, s);
    a.append(left, pl, el('span', 'chev', '›'));
    a.onclick = () => { location.hash = 'p=' + encodeURIComponent(p.id); };
    li.append(a); list.append(li);
  }
}

async function addSample() {
  if (busy) return; busy = true; $('load-sample').disabled = true; say('home-status', 'Adding the sample project…');
  try {
    const draftId = crypto.randomUUID();
    const r = await api('/api/setup', { draft: SAMPLE_PROJECT, draftId });
    await loadAll();
    say('home-status', '');
    location.hash = 'p=' + encodeURIComponent(r.state.projectId);
    window.dispatchEvent(new Event('hashchange'));
  } catch (e) { say('home-status', e.message, true); }
  finally { busy = false; $('load-sample').disabled = false; }
}

/* ---------- project ---------- */
async function openProject(id) {
  current = id; focusId = null;
  $('home').hidden = true; $('project').hidden = false; $('bill-result').hidden = true; $('bill-result').dataset.shown = '';
  say('project-status', '');
  try {
    scope = await loadWorkspace(id);
    drift = await api('/api/drift');
  } catch (e) { say('project-status', e.message, true); return; }
  $('project-title').textContent = scope.project?.label ?? 'Project';
  const al = $('agreed-list'); al.replaceChildren();
  for (const cp of scope.checkpoints) { const li = el('li'); li.append(el('strong', '', cp.title + ' · ' + money(cp.amount)), el('span', 'muted', cp.proposedEvidence || cp.acceptedEvidence || '')); al.append(li); }
  renderProject();
}
function entry() { return drift.projects[current]; }
function renderProject() {
  const e = entry(), s = statusOf(current);
  pill($('project-pill'), s);
  $('intake').open = !e;
  $('timeline-wrap').hidden = !e; $('deck-wrap').hidden = !e;
  if (!e) { $('bill-bar').hidden = true; return; }
  $('reader-note').textContent = e.kind === 'recording' ? 'From your recording' : 'Pasted thread';
  renderTimeline(e); renderDeck(e); renderBill(e, s);
}

function renderTimeline(e) {
  const ol = $('timeline'); ol.replaceChildren();
  const byMsg = new Map(); for (const c of e.cards) byMsg.set(c.messageId, c);
  for (const m of e.messages) {
    const li = el('li', 'msg ' + (m.mine ? 'mine' : 'theirs')); li.dataset.messageId = m.id;
    const card = byMsg.get(m.id);
    const bubble = el('div', 'bubble' + (card ? ' flagged ' + card.verdict : ''));
    const meta = el('div', 'meta'); meta.append(el('span', '', m.who)); if (m.at) meta.append(el('span', 'muted', m.at));
    bubble.append(meta);
    const p = el('p');
    const i = card ? m.text.indexOf(card.quote) : -1;
    if (card && i >= 0) { p.append(document.createTextNode(m.text.slice(0, i)), Object.assign(el('mark', '', card.quote)), document.createTextNode(m.text.slice(i + card.quote.length))); }
    else p.textContent = m.text;
    bubble.append(p);
    if (card) {
      const chip = el('button', 'chip ' + card.verdict); chip.type = 'button'; chip.dataset.cardId = card.id;
      chip.textContent = card.verdict === 'pending' ? 'Outside scope? Decide' : card.verdict === 'change_order' ? 'Change order · ' + money(card.priceCents) : 'In scope';
      chip.onclick = () => { focusId = card.id; renderDeck(e); $('deck-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      bubble.append(chip);
    }
    li.append(bubble); ol.append(li);
  }
}

async function decide(card, verdict) {
  try {
    const r = await api('/api/drift/decide', { projectId: current, cardId: card.id, verdict });
    drift.projects[current] = r.entry; focusId = null; renderProject();
  } catch (err) { say('project-status', err.message, true); }
}

function renderDeck(e) {
  const deck = $('deck'); deck.replaceChildren();
  const pending = e.cards.filter(c => c.verdict === 'pending');
  const card = e.cards.find(c => c.id === focusId) ?? pending[0];
  $('deck-count').textContent = !e.cards.length ? '' : pending.length ? pending.length + ' left of ' + e.cards.length : 'All ' + e.cards.length + ' decided';
  if (e.note) { const n = el('p', 'muted note', e.note); deck.append(n); }
  if (!e.cards.length) deck.append(el('div', 'done', 'Nothing in this conversation asks for more than was agreed. This project is on scope.'));
  else if (!card) deck.append(el('div', 'done', 'Every ask is decided. Accepted change orders are ready to bill below.'));
  else deck.append(buildCard(e, card));
  const dl = $('decided'); dl.replaceChildren();
  for (const c of e.cards.filter(x => x.verdict !== 'pending')) {
    const li = el('li'); const b = el('button', 'decided-row'); b.type = 'button'; b.dataset.cardId = c.id;
    b.append(el('span', 'dot ' + c.verdict), el('span', 'grow', c.title), el('span', 'muted', c.verdict === 'change_order' ? (c.billedIn ? 'On PayPal request' : money(c.priceCents)) : 'In scope'));
    b.onclick = () => { focusId = c.id; renderDeck(e); };
    li.append(b); dl.append(li);
  }
}

function buildCard(e, c) {
  const wrap = el('article', 'ask-card'); wrap.dataset.cardId = c.id;
  const msg = e.messages.find(m => m.id === c.messageId);
  const face = el('div', 'face');
  const tintL = el('div', 'tint left', 'In scope'), tintR = el('div', 'tint right', 'Change order');
  face.append(tintL, tintR);
  const top = el('div', 'meta'); top.append(el('span', '', (msg?.who ?? 'Client') + (msg?.at ? ' · ' + msg.at : '')), el('span', 'tag ' + c.likely, c.likely === 'outside' ? 'Looks like new work' : 'Could be a tweak'));
  face.append(top, el('blockquote', '', '“' + c.quote + '”'));
  face.append(el('h3', '', c.title));
  const price = el('div', 'price', money(c.priceCents)); price.id = 'card-price';
  face.append(price);
  const rw = el('p', 'ready'); rw.id = 'card-ready'; rw.textContent = c.readyWhen; face.append(rw);
  face.append(el('p', 'src muted', c.source === 'model' ? 'Drafted by the local model' : c.source === 'edited' ? 'Edited by you' : 'Drafted by rules on this machine'));
  wrap.append(face);

  const fix = el('form', 'fix'); fix.autocomplete = 'off';
  const inp = el('input'); inp.id = 'fix-text'; inp.placeholder = 'Say or type a correction: “make it $350”'; inp.maxLength = 400; inp.setAttribute('aria-label', 'Correction');
  const apply = el('button', 'soft', 'Apply'); apply.type = 'submit'; apply.id = 'fix-apply';
  fix.append(inp);
  if (navigator.mediaDevices?.getUserMedia && window.MediaRecorder) fix.append(micButton(text => { inp.value = text; fix.requestSubmit(); }));
  fix.append(apply);
  fix.onsubmit = async ev => {
    ev.preventDefault(); const text = inp.value.trim(); if (!text) return;
    apply.disabled = true;
    try {
      const r = await api('/api/drift/revise', { projectId: current, cardId: c.id, instruction: text });
      drift.projects[current] = r.entry; renderProject();
      say('project-status', r.applied.length ? 'Updated ' + r.applied.join(' and ') + '.' : 'Nothing to change from that. Try “make it $350” or “ready when the PDF is print-ready”.', !r.applied.length);
    } catch (err) { say('project-status', err.message, true); apply.disabled = false; }
  };
  wrap.append(fix);

  const row = el('div', 'verdicts');
  const no = el('button', 'v-in' + (c.verdict === 'in_scope' ? ' on' : ''), 'In scope'); no.type = 'button'; no.id = 'verdict-in-scope';
  const yes = el('button', 'v-co' + (c.verdict === 'change_order' ? ' on' : ''), 'Change order'); yes.type = 'button'; yes.id = 'verdict-change-order';
  no.onclick = () => decide(c, 'in_scope'); yes.onclick = () => decide(c, 'change_order');
  row.append(no, yes); wrap.append(row);
  wrap.append(el('p', 'hint muted', 'Swipe the card left for in scope, right for change order.'));
  if (c.billedIn) { no.disabled = yes.disabled = true; }
  else swipe(face, wrap, tintL, tintR, v => decide(c, v));
  return wrap;
}

function swipe(face, wrap, tl, tr, onDecide) {
  let x0 = null, dx = 0;
  face.style.touchAction = 'pan-y';
  face.addEventListener('pointerdown', ev => { if (ev.target.closest('input,button')) return; x0 = ev.clientX; dx = 0; face.setPointerCapture(ev.pointerId); face.style.transition = 'none'; });
  face.addEventListener('pointermove', ev => {
    if (x0 === null) return; dx = ev.clientX - x0;
    face.style.transform = 'translateX(' + dx + 'px) rotate(' + dx / 28 + 'deg)';
    tl.style.opacity = Math.min(1, Math.max(0, -dx / 110)); tr.style.opacity = Math.min(1, Math.max(0, dx / 110));
  });
  const end = () => {
    if (x0 === null) return; x0 = null; face.style.transition = 'transform .22s ease, opacity .22s ease';
    if (Math.abs(dx) > 90) { face.style.transform = 'translateX(' + (dx > 0 ? 520 : -520) + 'px) rotate(' + (dx > 0 ? 14 : -14) + 'deg)'; face.style.opacity = '0'; setTimeout(() => onDecide(dx > 0 ? 'change_order' : 'in_scope'), 200); }
    else { face.style.transform = ''; tl.style.opacity = tr.style.opacity = 0; }
  };
  face.addEventListener('pointerup', end); face.addEventListener('pointercancel', end);
}

function micButton(onText) {
  const b = el('button', 'mic', '●'); b.type = 'button'; b.id = 'fix-mic'; b.title = 'Say a correction'; b.setAttribute('aria-label', 'Say a correction'); let rec = null, chunks = [];
  b.onclick = async () => {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream); chunks = [];
      rec.ondataavailable = ev => chunks.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop()); b.classList.remove('live'); b.textContent = '●';
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); rec = null;
        say('project-status', 'Listening on this machine…');
        try { const r = await api('/api/drift/transcribe', undefined || {}, { body: blob, type: blob.type }); const t = r.lines.map(l => l.text).join(' ').trim(); say('project-status', t ? 'Heard: “' + t + '”' : 'Heard nothing. Type the correction instead.', !t); if (t) onText(t); }
        catch (err) { say('project-status', err.message, true); }
      };
      rec.start(); b.classList.add('live'); b.textContent = '■'; say('project-status', 'Recording. Tap again to stop.');
    } catch { say('project-status', 'The microphone is not available. Type the correction instead.', true); }
  };
  return b;
}

/* ---------- intake ---------- */
async function analyze(payload) {
  const btn = $('find-asks'); btn.disabled = true; say('intake-status', 'Reading the conversation beside what was agreed… the local model can take up to a minute.');
  try {
    const r = await api('/api/drift/analyze', { projectId: current, ...payload });
    drift.projects[current] = r.entry; focusId = null; say('intake-status', ''); renderProject();
    $('timeline-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { say('intake-status', e.message, true); }
  finally { btn.disabled = false; }
}

/* ---------- billing ---------- */
function renderBill(e, s) {
  const cos = e.cards.filter(c => c.verdict === 'change_order' && !c.billedIn);
  $('bill-bar').hidden = cos.length === 0;
  $('bill-total').textContent = money(cos.reduce((t, c) => t + c.priceCents, 0));
  $('bill-count').textContent = ' · ' + cos.length + ' change order' + (cos.length === 1 ? '' : 's');
  const billed = e.billed ?? [];
  const last = billed[billed.length - 1];
  if (last && $('bill-result').dataset.shown !== last.billingProjectId) showBilled(last);
}
let billSeq = 0;
async function showBilled(b, approvalUrl) {
  const my = ++billSeq;
  const box = $('bill-result'); box.hidden = false; box.dataset.shown = b.billingProjectId; box.replaceChildren();
  box.append(el('strong', '', 'PayPal request ready · ' + money(b.totalCents)));
  let url = approvalUrl;
  if (!url) { try { const s = await loadWorkspace(b.billingProjectId); url = s.checkpoints?.[0]?.approvalUrl; } catch {} }
  if (my !== billSeq) return;
  if (url) { const a = el('a', 'go linkbtn', 'Open PayPal approval'); a.id = 'open-paypal'; a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; box.append(a); }
  const w = el('a', 'soft-link', 'Track it in the workspace'); w.href = './live.html?project=' + encodeURIComponent(b.billingProjectId); box.append(w);
  box.append(el('p', 'muted', 'The client pays one PayPal order covering these change orders. After they approve, confirm and capture it in the workspace.'));
}
async function bill() {
  const e = entry(); const cos = e.cards.filter(c => c.verdict === 'change_order' && !c.billedIn);
  if (!cos.length || busy) return; busy = true; $('bill-go').disabled = true; say('project-status', 'Creating the PayPal request…');
  const total = cos.reduce((t, c) => t + c.priceCents, 0), amount = (total / 100).toFixed(2);
  const key = cos.map(c => c.id + c.priceCents).join('|');
  if (!billDrafts.has(key)) billDrafts.set(key, crypto.randomUUID());
  const name = scope.project.label;
  try {
    const setup = await api('/api/setup', { draftId: billDrafts.get(key), draft: {
      label: name + ' · change orders', brief: 'Change orders agreed with the client for ' + name + ': ' + cos.map(c => c.title).join('; ') + '.', cap: amount,
      checkpoints: [{ title: 'Change orders (' + cos.length + ')', amount, evidence: cos.map(c => c.title + ' (' + money(c.priceCents) + '): ' + c.readyWhen).join('\n') }] } });
    const pid = setup.state.projectId;
    try {
      await api('/api/approve', { projectId: pid, checkpointId: 'scope-1', reviewRevision: 0, evidence: 'You asked for each of these in the conversation and they are outside the original scope, so they are billed as change orders:\n' + cos.map(c => '- ' + c.title + ': “' + c.quote + '”').join('\n') });
    } catch (err) { if (err.status !== 409) throw err; }
    const order = await api('/api/order', { projectId: pid, checkpointId: 'scope-1' });
    const url = order.state.checkpoints[0]?.approvalUrl;
    const done = await api('/api/drift/billed', { projectId: current, cardIds: cos.map(c => c.id), billingProjectId: pid });
    drift.projects[current] = done.entry; billDrafts.delete(key);
    wsState = await loadWorkspace(); renderProject();
    await showBilled(done.entry.billed[done.entry.billed.length - 1], url);
    say('project-status', '');
    $('bill-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) { say('project-status', err.message, true); }
  finally { busy = false; $('bill-go').disabled = false; }
}

/* ---------- wiring ---------- */
function route() {
  const m = location.hash.match(/^#p=(.+)$/);
  if (m) return openProject(decodeURIComponent(m[1]));
  current = null; $('project').hidden = true; $('home').hidden = false;
  loadAll().then(renderHome).catch(e => say('home-status', e.message, true));
}
$('back').onclick = () => { location.hash = ''; route(); };
$('load-sample').onclick = addSample;
$('use-sample-thread').onclick = () => { $('thread-text').value = SAMPLE_THREAD; say('intake-status', 'Sample thread added. Choose Find the asks.'); };
$('find-asks').onclick = () => { const t = $('thread-text').value.trim(); if (!t) { say('intake-status', 'Paste the thread, add a recording, or use the sample.', true); return; } analyze({ thread: t }); };
$('bill-go').onclick = bill;
$('recording').onchange = async ev => {
  const f = ev.target.files[0]; if (!f) return;
  const b = $('find-asks'); b.disabled = true; say('intake-status', 'Transcribing ' + f.name + ' on this machine…');
  try { const r = await api('/api/drift/transcribe', undefined || {}, { body: f, type: f.type || 'application/octet-stream' }); if (!r.lines.length) throw Error('No speech was found in that recording.'); b.disabled = false; await analyze({ lines: r.lines }); }
  catch (e) { say('intake-status', e.message, true); b.disabled = false; }
  ev.target.value = '';
};
window.addEventListener('hashchange', route);
route();
document.body.dataset.ready = 'true';
