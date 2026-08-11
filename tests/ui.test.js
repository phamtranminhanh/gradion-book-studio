import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEmptyState, renderStepPanel, validateIdentity, validateProject } from '../public/ui-model.js';

function project(overrides = {}) {
  return {
    completedStep: 2,
    run: { state: 'IDLE', step: null, attempt: 0, error: null, stale: false },
    ...overrides,
  };
}

test('identity and project forms reject missing input', () => {
  assert.match(validateIdentity('', 'bad'), /valid email/);
  assert.equal(validateIdentity('Nguyen', 'nguyen@example.com'), '');
  assert.match(validateProject('', 'book'), /title/);
  assert.equal(validateProject('My book', 'Once upon a time'), '');
});

test('empty project state has a clear creation action', () => {
  const html = renderEmptyState();
  assert.match(html, /No illustration projects yet/);
  assert.match(html, /#\/projects\/new/);
});

test('running panel names the exact active step and duplicate-call behavior', () => {
  const html = renderStepPanel(project({ run: { state: 'RUNNING', step: 'PORTRAITS', attempt: 2, stale: false } }));
  assert.match(html, /Generating portraits/);
  assert.match(html, /Attempt 2/);
  assert.match(html, /will not start a duplicate call/);
});

test('failed panel exposes retry for only the failed step and escapes the error', () => {
  const html = renderStepPanel(project({ run: { state: 'FAILED', step: 'PORTRAITS', attempt: 1, stale: false, error: '<script>alert(1)</script>' } }));
  assert.match(html, /Retry portraits/);
  assert.match(html, /data-step="PORTRAITS"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('stale running panel exposes recovery instead of a duplicate retry', () => {
  const html = renderStepPanel(project({ run: { state: 'RUNNING', step: 'CHAPTERS', attempt: 1, stale: true } }));
  assert.match(html, /may have been interrupted/);
  assert.match(html, /Recover this step/);
  assert.doesNotMatch(html, /data-action="run-step"/);
});
