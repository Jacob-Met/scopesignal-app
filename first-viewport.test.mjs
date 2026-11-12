import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('./app.mjs', import.meta.url), 'utf8');
const first = html.split('<section class="casebar"')[1]?.split('</section>')[0] || '';

test('first viewport is a real pending-decision workspace, not marketing decoration', () => {
  assert.ok(first);
  assert.match(first, /NORTHSTAR \/ ACCEPTANCE WORKSPACE/);
  assert.match(first, /id="next-step-summary"/);
  assert.match(first, /href="#checkpoints-title">Review next evidence/);
  assert.match(css, /\.checkpoint:not\(\.accepted\):first-child/);
  assert.doesNotMatch(first, /hero-art|class="orbit"|signal-card|hero-proof/);
  assert.match(js, /const reviewOrder =/);
  assert.match(js, /reviewOrder\.map\(cp/);
});

test('original editable scope and local-only Studio guard are preserved', () => {
  assert.match(first, /id="author-scope-entry" href="\.\/scope\.html"/);
  assert.match(first, /id="studio-entry" href="\.\/live\.html"/);
  assert.match(first, /id="studio-help" hidden tabindex="-1"/);
  assert.match(first, /id="studio-context"/);
  assert.match(first, /npm run sandbox/);
  assert.match(html, /FICTIONAL CASE · NO LIVE PAYMENTS/);
});

test('fixture outcomes are never presented as live provider evidence', () => {
  assert.match(first, /No PayPal API or AI provider is called on this page/);
  assert.match(html, /id="capture-callout" data-capture-state="captured"/);
});
