// Read-only navigation over draft and server milestones. Never authorizes work or payment.
const KEY = 'scopesignal:sandbox:selected-milestone:v1';
const reviewable = cp => ['unapproved', 'changes_requested'].includes(cp.status);
const labels = {
  unapproved: 'Unaccepted', changes_requested: 'Changes requested', approved: 'Accepted',
  awaiting_buyer: 'Awaiting buyer', order_unknown: 'Order outcome unknown',
  capture_unknown: 'Capture outcome unknown', captured: 'Captured'
};
const identity = state => JSON.stringify([state.project, state.checkpoints.map(
  cp => [cp.id, cp.title, cp.amount, cp.proposedEvidence])]);

const formatUsd = cents => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(Number(cents) / 100);

function updateGateElement(gate, {number, title, amount, state, current, label}) {
  gate.dataset.state = state;
  gate.setAttribute('aria-current', String(current));
  gate.setAttribute('aria-label', label);
  gate.querySelector('.gate-number').textContent = String(number).padStart(2, '0');
  gate.querySelector('.gate-title').textContent = title;
  gate.querySelector('.gate-amount').textContent = amount;
  return gate;
}

function createGateElement(details) {
  const gate = document.createElement('button');
  gate.type = 'button';
  gate.className = 'milestone-gate';
  for (const name of ['gate-number', 'gate-title', 'gate-amount']) {
    const span = document.createElement('span');
    span.className = name;
    gate.append(span);
  }
  return updateGateElement(gate, details);
}

function revealCurrentGate(gates) {
  const currentGate = gates.querySelector('[aria-current=true]');
  if (!currentGate || gates.hidden) return;
  const edge = gates.getBoundingClientRect(), current = currentGate.getBoundingClientRect();
  if (current.left < edge.left) gates.scrollLeft += current.left - edge.left;
  else if (current.right > edge.right) gates.scrollLeft += current.right - edge.right;
}

export function createMilestoneNavigation(list, { isBuyerApproved = () => false } = {}) {
  const region = document.createElement('details');
  region.className = 'milestone-navigation';
  region.setAttribute('aria-label', 'Milestone navigation');
  region.hidden = true;
  const navigationSummary = document.createElement('summary');
  navigationSummary.textContent = 'Milestone controls';
  const label = document.createElement('label');
  label.htmlFor = 'milestone-picker';
  label.textContent = 'Review milestone';
  const picker = document.createElement('select');
  picker.id = 'milestone-picker';
  const attention = document.createElement('p');
  attention.id = 'milestone-attention';
  attention.className = 'milestone-attention';
  attention.setAttribute('aria-live', 'polite');
  picker.setAttribute('aria-describedby', attention.id);
  const controls = document.createElement('div');
  controls.className = 'milestone-navigation-controls';
  const previous = document.createElement('button');
  const next = document.createElement('button');
  const all = document.createElement('button');
  for (const button of [previous, next, all]) { button.type = 'button'; button.className = 'secondary'; }
  previous.textContent = '← Previous';
  next.textContent = 'Next →';
  all.textContent = 'Show all milestones';
  all.setAttribute('aria-pressed', 'false');
  controls.append(previous, next, all);
  region.append(navigationSummary, label, picker, attention, controls);
  const gates = document.createElement('nav');
  gates.className = 'milestone-gates';
  gates.setAttribute('aria-label', 'Project milestone line');
  gates.hidden = true;
  list.before(gates, region);

  function revealSelectedGate() { revealCurrentGate(gates); }
  function measureRail() {
    document.documentElement.style.setProperty('--milestone-nav-height', gates.hidden ? '0px' : gates.offsetHeight + 'px');
    revealSelectedGate();
  }
  new ResizeObserver(measureRail).observe(gates);

  let state = null, scope = null, selected = null, showAll = false, verified = true;
  const cards = () => Array.from(list.children);
  const hasDraft = (cp, index) => reviewable(cp) &&
    Boolean(cards()[index]?.querySelector('[data-review-findings]')?.value.trim());
  function remember() {
    try { sessionStorage.setItem(KEY, JSON.stringify({scope, selected})); } catch {}
  }
  function describe(cp, index) {
    const status = verified ? (cp.status === 'awaiting_buyer' && isBuyerApproved(cp.id) ? 'Ready to capture' : labels[cp.status] || cp.status.replaceAll('_', ' ')) : 'State unverified';
    return (index + 1) + '. ' + cp.title + ' — ' + status + (hasDraft(cp, index) ? ' · Draft findings' : '');
  }
  function refreshLabels() {
    if (!state?.project) return;
    state.checkpoints.forEach((cp, index) => {
      if (picker.options[index]) picker.options[index].textContent = describe(cp, index);
    });
    gates.replaceChildren(...state.checkpoints.map((cp, index) => {
      const gate = createGateElement({
        number:index + 1, title:cp.title, amount:state.project.reviewOnly?'Review only':formatUsd(cp.amount),
        state:verified ? cp.status : 'unverified', current:cp.id === selected,
        label:describe(cp, index)
      });
      gate.addEventListener('click', () => { region.open = false; go(cp.id); });
      return gate;
    }));
    measureRail();
    const drafts = state.checkpoints.filter(hasDraft).length;
    const changes = state.checkpoints.filter(cp => cp.status === 'changes_requested').length;
    const unaccepted = state.checkpoints.filter(cp => cp.status === 'unapproved').length;
    attention.textContent = verified
      ? unaccepted + ' unaccepted · ' + changes + ' changes requested · ' + drafts + ' unfinished findings ' + (drafts === 1 ? 'draft' : 'drafts')
      : 'Milestone status is unverified. Refresh verified state before relying on it. ' + drafts + ' local findings ' + (drafts === 1 ? 'draft' : 'drafts') + ' retained.';
  }
  function display() {
    if (!state?.project) return;
    const index = state.checkpoints.findIndex(cp => cp.id === selected);
    cards().forEach((card, i) => { card.hidden = !showAll && i !== index; });
    list.dataset.showAll = String(showAll);
    picker.value = selected;
    previous.disabled = index <= 0;
    next.disabled = index < 0 || index === state.checkpoints.length - 1;
    all.textContent = showAll ? 'Show selected milestone' : 'Show all milestones';
    all.setAttribute('aria-pressed', String(showAll));
    refreshLabels();
  }
  function go(id, focus = true) {
    if (!state?.checkpoints.some(cp => cp.id === id)) return;
    selected = id;
    showAll = false;
    remember();
    display();
    if (focus) {
      const index = state.checkpoints.findIndex(cp => cp.id === id);
      const heading = cards()[index]?.querySelector('h3');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({preventScroll: true});
        heading.scrollIntoView({block: 'start'});
      }
    }
  }
  picker.addEventListener('change', () => go(picker.value));
  previous.addEventListener('click', () => {
    const i = state.checkpoints.findIndex(cp => cp.id === selected);
    if (i > 0) go(state.checkpoints[i - 1].id);
  });
  next.addEventListener('click', () => {
    const i = state.checkpoints.findIndex(cp => cp.id === selected);
    if (i < state.checkpoints.length - 1) go(state.checkpoints[i + 1].id);
  });
  all.addEventListener('click', () => { showAll = !showAll; display(); });
  list.addEventListener('input', refreshLabels);
  list.addEventListener('click', () => queueMicrotask(refreshLabels));
  list.addEventListener('focusin', event => {
    const index = cards().indexOf(event.target.closest('.milestone'));
    if (index < 0) return;
    selected = state.checkpoints[index].id;
    remember();
    // In the all-milestone view, moving between fields must not hide other work.
    display();
  });

  function update(nextState) {
    state = nextState;
    verified = true;
    const hasProject = Boolean(state?.project);
    gates.hidden = !hasProject || state.checkpoints.length <= 1;
    list.dataset.singleMilestone = String(hasProject && state.checkpoints.length === 1);
    region.hidden = !hasProject || state.checkpoints.length <= 1;
    if (!hasProject) { scope = null; selected = null; picker.replaceChildren(); measureRail(); return; }
    const nextScope = identity(state);
    if (scope !== nextScope) {
      scope = nextScope; selected = null; showAll = false;
      try {
        const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        if (saved?.scope === scope) selected = saved.selected;
      } catch {}
    }
    if (!state.checkpoints.some(cp => cp.id === selected)) {
      selected = state.checkpoints.find(hasDraft)?.id ||
        state.checkpoints.find(cp => cp.status === 'changes_requested')?.id ||
        state.checkpoints.find(reviewable)?.id || state.checkpoints[0]?.id;
    }
    picker.replaceChildren(...state.checkpoints.map((cp, index) => {
      const option = document.createElement('option');
      option.value = cp.id; option.textContent = describe(cp, index);
      return option;
    }));
    remember();
    display();
  }
  return {update, go, markUnverified() { verified = false; refreshLabels(); }};
}

export function createDraftMilestoneNavigation(container) {
  const gates = document.createElement('nav');
  gates.id = 'draft-milestone-gates';
  gates.className = 'milestone-gates draft-gates';
  gates.setAttribute('aria-label', 'Draft milestone line');
  gates.hidden = true;
  container.prepend(gates);
  const buttons = new Map();
  let entries = [], selected = null;
  new ResizeObserver(() => revealCurrentGate(gates)).observe(gates);

  function select(row, focus = false) {
    if (!entries.some(entry => entry.row === row)) return;
    selected = row;
    for (const [item, gate] of buttons) gate.setAttribute('aria-current', String(item === row));
    revealCurrentGate(gates);
    if (focus) {
      row.querySelector('input')?.focus({preventScroll:true});
      row.scrollIntoView({block:'start'});
    }
  }

  function update(next) {
    entries = next;
    const active = entries.find(entry => entry.row.contains(document.activeElement));
    if (active) selected = active.row;
    if (!entries.some(entry => entry.row === selected)) selected = entries[0]?.row || null;
    for (const [row, gate] of buttons) {
      if (!entries.some(entry => entry.row === row)) { gate.remove(); buttons.delete(row); }
    }
    entries.forEach((entry, position) => {
      const details = {
        number:entry.number, title:entry.title, amount:entry.amount,
        state:'draft', current:entry.row === selected,
        label:entry.number + '. ' + entry.title + ' — Draft, ' + entry.amount
      };
      let gate = buttons.get(entry.row);
      if (!gate) {
        gate = createGateElement(details);
        gate.addEventListener('click', () => select(entry.row, true));
        buttons.set(entry.row, gate);
      } else updateGateElement(gate, details);
      if (gates.children[position] !== gate) gates.insertBefore(gate, gates.children[position] || null);
    });
    gates.hidden = entries.length === 0;
    container.classList.toggle('has-draft-gates', entries.length > 0);
    revealCurrentGate(gates);
  }
  return {update, select};
}
