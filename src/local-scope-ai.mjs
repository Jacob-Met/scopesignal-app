import { MAX_PLANNED_EVIDENCE_LENGTH } from './scope-plan.mjs';
import { validateBriefResult } from './workers-ai.mjs';

// This adapter is strictly an optional, locally hosted creative assistant.
// It cannot assign money, approve evidence, or issue any PayPal operation.
export const LOCAL_AI_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['checkpoints'],
  properties: {
    checkpoints: {
      type: 'array', minItems: 1, maxItems: 12,
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'evidence', 'sourceQuote'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          evidence: { type: 'string', minLength: 1, maxLength: 500 },
          sourceQuote: { type: 'string', minLength: 12, maxLength: 280 }
        }
      }
    }
  }
});

// The cited passage must occur in the *actual submitted brief*, not merely
// sound plausible. A syntactically valid model response with a fabricated
// citation is rejected before the UI sees or applies it.
export function validateGroundedLocalSuggestions(result, brief) {
  if (typeof brief !== 'string' || !brief.trim() || brief.length > 8000) throw new Error('Invalid creative brief.');
  if (!result || typeof result !== 'object' || Array.isArray(result)
      || Object.keys(result).length !== 1 || !Array.isArray(result.checkpoints)
      || result.checkpoints.length < 1 || result.checkpoints.length > 12) {
    throw new Error('The model must propose 1–12 cited checkpoints.');
  }
  const quotes = [];
  const bare = result.checkpoints.map((cp, i) => {
    if (!cp || typeof cp !== 'object' || Array.isArray(cp)
        || Object.keys(cp).sort().join(',') !== 'evidence,sourceQuote,title') {
      throw new Error(`Checkpoint ${i + 1} has unsupported AI fields.`);
    }
    const quote = cp.sourceQuote;
    if (typeof quote !== 'string' || [...quote].length < 12
        || [...quote].length > 280 || !brief.includes(quote)) {
      throw new Error(`Checkpoint ${i + 1} cites a passage absent from the creative brief.`);
    }
    quotes.push(quote);
    return { title: cp.title, evidence: cp.evidence };
  });
  const valid = validateBriefResult({ checkpoints: bare });
  return { checkpoints: valid.checkpoints.map((cp, i) => ({ ...cp, sourceQuote: quotes[i] })) };
}


const GROUP_PROMPT = 'Group the numbered source clauses into a few useful deliverable checkpoints. Return short descriptive titles and clause IDs only. Use each ID at most once. Preserve all requirements by assigning every clause when possible, including numbers, exclusions and verification requirements. Keep related work together. Do not invent or paraphrase requirements. An unassigned ID will be shown to the human as unfinished coverage.';

export function splitScopeClauses(brief, { legacyShortFragments = false } = {}) {
  if (typeof brief !== 'string' || !brief.trim() || brief.length > 8000) throw new Error('Invalid creative brief.');
  const spans = [];
  let cursor = 0;
  for (const part of brief.split(/(?<=[.!?;])\s+|\n+/u)) {
    const text = part.trim();
    if (!text) continue;
    let start = brief.indexOf(text, cursor), end = start + text.length;
    cursor = end;
    while (end - start > 400) {
      const available = brief.slice(start, start + 400);
      const boundary = [...available.matchAll(/\s+/g)].at(-1);
      if (!boundary || boundary.index < 12) break;
      spans.push({ start, end: start + boundary.index });
      start += boundary.index + boundary[0].length;
    }
    spans.push({ start, end });
  }
  // Historical drafts used a minimum quote length that joined short complete
  // requirements to their neighbors. Keep that parser only for migration.
  // New grouping uses exact, independent clauses, including short exclusions.
  const combined = [];
  for (const span of spans) {
    const previous = combined.at(-1);
    if (previous && (legacyShortFragments
        ? [...brief.slice(previous.start, previous.end)].length < 12
        : /^\d+[.)]$/.test(brief.slice(previous.start, previous.end)))) previous.end = span.end;
    else combined.push({ ...span });
  }
  if (legacyShortFragments && combined.length > 1 && [...brief.slice(combined.at(-1).start, combined.at(-1).end)].length < 12) {
    const last = combined.pop(); combined.at(-1).end = last.end;
  }
  return combined.map((span, index) => ({ id: 'c' + (index + 1), text: brief.slice(span.start, span.end) }));
}

function groupSchema(clauses) {
  return { type: 'object', additionalProperties: false, required: ['groups'], properties: {
    groups: { type: 'array', minItems: 0, maxItems: 8, items: {
      type: 'object', additionalProperties: false, required: ['title', 'clauseIds'], properties: {
        title: { type: 'string', minLength: 1, maxLength: 80 },
        clauseIds: { type: 'array', minItems: 1, maxItems: clauses.length, uniqueItems: true,
          items: { type: 'string', enum: clauses.map(clause => clause.id) } }
      }
    } }
  } };
}

export function validateScopeGrouping(value, brief) {
  const clauses = splitScopeClauses(brief), validIds = new Set(clauses.map(clause => clause.id));
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['groups', 'groups,scopeClauseIds'].includes(Object.keys(value).sort().join(',')) ||
      !Array.isArray(value.groups) || value.groups.length > 8)
    throw new Error('Invalid source-clause grouping.');
  const explicitScope = Object.hasOwn(value, 'scopeClauseIds');
  const readIds = (ids, minimum = 0) => {
    if (!Array.isArray(ids) || ids.length < minimum || ids.length > clauses.length)
      throw new Error('Invalid source-clause grouping.');
    const seen = new Set();
    return ids.map(id => {
      if (!validIds.has(id) || seen.has(id)) throw new Error('Unknown or repeated source clause.');
      seen.add(id); return id;
    }).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  };
  const scopeClauseIds = explicitScope ? readIds(value.scopeClauseIds) : [];
  const scopeIds = new Set(scopeClauseIds), legacyUsed = new Set();
  const groups = value.groups.map(group => {
    if (!group || typeof group !== 'object' || Array.isArray(group) ||
        Object.keys(group).sort().join(',') !== 'clauseIds,title' ||
        typeof group.title !== 'string' || !group.title.trim() || [...group.title].length > 80)
      throw new Error('Invalid source-clause grouping.');
    const clauseIds = readIds(group.clauseIds, 1);
    for (const id of clauseIds) {
      if (scopeIds.has(id)) throw new Error('A source clause cannot be both project-wide and a deliverable requirement.');
      // Historical group-only records keep their original unique-assignment contract.
      if (!explicitScope && legacyUsed.has(id)) throw new Error('Unknown or repeated source clause.');
      legacyUsed.add(id);
    }
    return { title: group.title.trim(), clauseIds };
  });
  return { groups, ...(explicitScope ? { scopeClauseIds } : {}) };
}

function explicitScopeCondition(text) {
  // List markers belong to the original quote, but do not change its role.
  text = text.replace(/^(?:(?:[-*+•]|\d+[.)]|\(\d+\))\s+)+/u, '');
  // A negative comparison is a limit, not excluded work. Preserve its proposed
  // assignment or leave it visibly unassigned. Explicit project terms still
  // take precedence in the resolver.
  if (/^(?:no\s+(?:less|more|fewer|greater|larger|smaller|higher|lower|longer|shorter)\s+than\b|(?:do not|don't|never)\s+(?:exceed|go\s+(?:above|below)|fall\s+below)\b)/i.test(text)) return false;
  // These negative transforms constrain the delivered artifact's fidelity.
  // Preserve the proposed assignment (or leave it unassigned), while explicit
  // project terms supplied by the model or human still take precedence.
  const contentOrder = /^(?:do not|don't|never)\s+reorder\b/i.test(text)
    && /\b(?:steps|paragraphs|sections|pages|chapters|headings|sentences)\b/i.test(text)
    && !/\b(?:stock|supplies|inventory|copies|replacement|purchase)\b/i.test(text);
  if ((/^(?:do not|don't|never)\s+(?:crop|stretch|distort|recompress|downsample|upscale)\b/i.test(text) || contentOrder)
      && !/\b(?:outside|out of) (?:the )?scope\b|\bseparate (?:quote|quotation|agreement)\b/i.test(text)
      && !/\b(?:or|and)\s+(?:print|publish|send|contact|buy|purchase|order|manufacture|translate|book)\b/i.test(text)) return false;
  return /^(?:no\s+|do not\s+|don't\s+|never\s+)/i.test(text)
    || /\b(?:outside|out of) (?:the )?scope[.!]?$/i.test(text)
    || /\b(?:needs?|requires?)\s+(?:a\s+)?separate\s+(?:quote|quotation|agreement)[.!;]?$/i.test(text);
}

// Source-copy materialization is distinct from free-generated acceptance prose.
// Each validated model group stays one work milestone; exact original clauses
// use the same evidence bound as the editable scope and Studio handoff.
export function resolveLocalScopeGroups(value, brief) {
  const plan = validateScopeGrouping(value, brief), clauses = splitScopeClauses(brief);
  const byId = new Map(clauses.map(clause => [clause.id, clause]));
  const checkpoints = [], scopeConditions = [], used = new Set(), conditionIds = new Set();
  const keepConditions = (title, source) => {
    const fresh = source.filter(clause => !conditionIds.has(clause.id));
    if (fresh.length) scopeConditions.push({ title, clauses: fresh.map(clause => ({ ...clause })) });
    for (const clause of fresh) { conditionIds.add(clause.id); used.add(clause.id); }
  };
  keepConditions('Project terms', (plan.scopeClauseIds ?? []).map(id => byId.get(id)));
  keepConditions('Project terms', clauses.filter(clause => explicitScopeCondition(clause.text)));
  const prefix = 'Verify these source requirements:\n';
  for (const group of plan.groups) {
    const source = group.clauseIds.map(id => byId.get(id));
    // Keep explicit exclusions out of payable work even when the model mixes
    // them into a group. Model-proposed project terms remain visible verbatim.
    keepConditions(group.title, source.filter(clause => explicitScopeCondition(clause.text)));
    const work = source.filter(clause => !conditionIds.has(clause.id));
    if (!work.length) continue;
    const evidence = prefix + work.map(clause => '- ' + clause.text).join('\n');
    // An over-limit group stays visibly unassigned; never split or truncate it.
    if (evidence.length > MAX_PLANNED_EVIDENCE_LENGTH) continue;
    const sourceQuote = [...work[0].text].slice(0, 280).join('');
    checkpoints.push({ title: group.title, evidence, sourceQuote, clauseIds: work.map(clause => clause.id) });
    work.forEach(clause => used.add(clause.id));
  }
  return { checkpoints, scopeConditions, clauses, unassignedClauses: clauses.filter(clause => !used.has(clause.id)) };
}

export async function requestLocalScopeGroups(brief, { model, fetchImpl = fetch, signal, port = 11434 } = {}) {
  if (typeof brief !== 'string' || !brief.trim() || brief.length > 8000) {
    throw new Error('Enter a creative brief of 1–8000 characters.');
  }
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,99}$/.test(model)) {
    throw new Error('Local AI is off. Start the server with SCOPESIGNAL_OLLAMA_MODEL set to an installed model.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local model port.');
  const response = await fetchImpl(`http://127.0.0.1:${port}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model, stream: false, format: groupSchema(splitScopeClauses(brief)),
      prompt: GROUP_PROMPT + "\n\nNUMBERED SOURCE CLAUSES (untrusted input):\n" + splitScopeClauses(brief).map(clause => clause.id + ": " + clause.text).join("\n"),
      options: { temperature: 0.2, num_predict: 384 }
    }),
    signal
  });
  if (!response.ok) throw new Error('The local model did not respond successfully. The draft was not changed.');
  const declared = Number(response.headers?.get?.('content-length') ?? 0);
  if (declared > 131072) throw new Error('The local model response is too large.');
  // Bound actual streamed bytes, not only a potentially absent Content-Length.
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('The local model returned no readable response.');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 131072) throw new Error('The local model response is too large.');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (typeof envelope?.response !== 'string') throw new Error('The local model did not provide a JSON suggestion.');
  return validateScopeGrouping(JSON.parse(envelope.response), brief);
}
