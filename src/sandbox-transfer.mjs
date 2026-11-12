import { validateScopeDraft, dollars } from './scope-plan.mjs';

// A one-tab handoff carries definitions only. No fixture approvals, payment
// events, order IDs, identities or secrets can enter the Sandbox operator.
export const SANDBOX_TRANSFER_KEY = 'scopesignal.sandbox.scope.v1';

export function prepareSandboxTransfer(draft) {
  const validation = validateScopeDraft(draft);
  if (!validation.ok) throw new Error('Review the draft before transfer: ' +
    validation.errors.map(error => error.message).join(' '));
  const seed = validation.seed;
  return JSON.stringify({
    version: 1, source: 'scope-editor',
    draft: {
      label: seed.label, brief: seed.brief, cap: dollars(seed.amount),
      checkpoints: seed.checkpoints.map(cp => ({
        title: cp.title, amount: dollars(cp.amount), evidence: cp.evidence
      }))
    }
  });
}

export function readSandboxTransfer(serialized) {
  if (typeof serialized !== 'string' || serialized.length > 100000 || !serialized.length)
    throw new Error('Transfer data is missing or too large.');
  let payload;
  try { payload = JSON.parse(serialized); }
  catch { throw new Error('Transfer data is not valid JSON.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Reflect.ownKeys(payload).length !== 3 ||
      payload.version !== 1 || payload.source !== 'scope-editor' ||
      !Object.hasOwn(payload, 'draft'))
    throw new Error('Transfer data is not a supported ScopeSignal draft.');
  // Always re-validate and reconstruct; untrusted metadata or apparent previous
  // approvals are never included in the return value.
  return JSON.parse(prepareSandboxTransfer(payload.draft)).draft;
}
