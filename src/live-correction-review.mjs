// Saved human review context, separate from the new acceptance decision.
export function mountCorrectionReview(checkpoint) {
  const latest = checkpoint.reviewHistory?.at(-1);
  if (checkpoint.status !== 'changes_requested' || !latest) return null;
  const section = document.createElement('section');
  section.className = 'correction-context';
  section.setAttribute('aria-label', 'Corrections to review');
  const heading = document.createElement('h4');
  heading.textContent = 'Requested changes';
  const request = document.createElement('p');
  request.className = 'correction-request-text';
  request.textContent = latest.changes;
  const prior = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Earlier review';
  const evidence = document.createElement('p');
  evidence.textContent = latest.evidence;
  prior.append(summary, evidence);
  section.append(heading, request, prior);
  return section;
}
