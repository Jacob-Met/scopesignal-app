// Tab-local human findings only. Never restores an approval or payment state.
const KEY = 'scopesignal:sandbox:review-drafts:v1';
const reviewable = cp => ['unapproved','changes_requested'].includes(cp.status);
const identity = state => JSON.stringify([
  state.project.label, state.project.brief, state.project.cap,
  state.checkpoints.map(cp => [cp.id, cp.title, cp.amount, cp.proposedEvidence])
]);
export function createReviewDrafts(storage = () => sessionStorage) {
  let scope = null, key = KEY, entries = {}, unavailable = false;
  function write() {
    try {
      if (Object.keys(entries).length) storage().setItem(key, JSON.stringify({version:1,scope,entries}));
      else storage().removeItem(key);
      unavailable = false;
    } catch { unavailable = true; }
  }
  function sync(state) {
    if (!state?.project) { scope = null; entries = {}; key = KEY; return; }
    const next = identity(state), nextKey = state.projectId ? KEY + ":" + state.projectId : KEY;
    if (scope !== next || key !== nextKey) {
      scope = next; key = nextKey; entries = {};
      try {
        const current = storage().getItem(key);
        const saved = JSON.parse(current || (key !== KEY ? storage().getItem(KEY) : null) || 'null');
        if (saved?.version === 1 && saved.scope === scope && saved.entries && typeof saved.entries === 'object') {
          for (const cp of state.checkpoints) {
            const value = saved.entries[cp.id];
            if (reviewable(cp) && value?.revision === (cp.reviewHistory?.length || 0) && typeof value.text === 'string' && value.text.length <= 5000 && (value.changes === undefined || (typeof value.changes === 'string' && value.changes.length <= 5000)))
              entries[cp.id] = value;
          }
          if (!current && key !== KEY) {
            storage().setItem(key, JSON.stringify({version:1,scope,entries}));
            storage().removeItem(KEY);
          }
        }
      } catch { unavailable = true; }
    }
    const pending = new Map(state.checkpoints.filter(reviewable).map(cp => [cp.id,cp.reviewHistory?.length||0]));
    for (const id of Object.keys(entries)) if (!pending.has(id) || entries[id].revision !== pending.get(id)) delete entries[id];
    write();
  }
  function bind(input, cp, kind = 'text', codec = null) {
    const read=()=>codec?codec.read():input.value;
    const assign=value=>{if(codec)codec.write(value);else input.value=value;};
    const correction = kind === 'changes';
    const noun = correction ? 'correction draft' : 'review draft';
    const container = document.createElement('div');
    container.className = correction ? 'correction-draft-recovery' : 'review-draft-recovery';
    const note = document.createElement('p');
    note.className = 'note'; note.setAttribute('role','status');
    note.id = 'review-draft-' + cp.id + '-' + kind;
    input.setAttribute('aria-describedby',note.id);
    const clear = document.createElement('button');
    clear.type = 'button'; clear.className = 'quiet';
    clear.textContent = 'Discard ' + noun;
    if (!correction) input.dataset.reviewFindings = '';
    const recovered = Boolean(entries[cp.id]?.[kind]);
    if (recovered) assign(entries[cp.id][kind]);
    function message(restored = false) {
      note.textContent = unavailable
        ? 'Draft could not be saved. Keep a copy before reloading.'
        : read()
          ? (restored ? 'Recovered ' + noun : 'Draft saved in this tab')
          : '';
      clear.hidden = !read();
      container.hidden = !read() && !unavailable;
    }
    input.addEventListener('input', () => {
      const value = entries[cp.id] || {text:'',changes:'',revision:cp.reviewHistory?.length||0};
      value[kind] = read();
      if (value.text || value.changes) entries[cp.id] = value;
      else delete entries[cp.id];
      write(); message();
    });
    clear.addEventListener('click', () => {
      if (!window.confirm('Discard this ' + noun + '?')) return;
      assign(''); if (entries[cp.id]) { entries[cp.id][kind]=''; if (!entries[cp.id].text && !entries[cp.id].changes) delete entries[cp.id]; } write(); message(); input.focus();
    });
    container.append(note,clear);
    (codec?.element||input.closest('label')).after(container);
    if (correction && recovered) input.closest('details').open = true;
    message(recovered);
    return container;
  }
  return {sync,bind};
}
