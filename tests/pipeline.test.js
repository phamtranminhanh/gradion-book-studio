import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, deriveStatus } from '../src/store.js';
import { PipelineState } from '../src/state-machine.js';
import { PipelineRunner } from '../src/pipeline.js';
import { MockGeminiClient } from '../src/gemini.js';

async function harness({ gemini = new MockGeminiClient({ delayMs: 0 }), staleMs = 1000 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gradion-test-'));
  const store = new Store(dir);
  await store.init();
  const user = await store.upsertUser('Test User', 'test@example.com');
  const project = await store.createProject(user.id, 'Wind in the Willows', 'A sufficiently long sample book text for the mocked pipeline.');
  const state = new PipelineState(store, { staleMs });
  const runner = new PipelineRunner({ store, state, gemini });
  return { dir, store, user, project, state, runner, gemini };
}

async function runStep(ctx, step, options = {}) {
  const started = await ctx.state.start(ctx.project.id, ctx.user.id, step);
  assert.equal(started.ok, true, `expected ${step} to start`);
  await ctx.runner.run(ctx.project.id, step, options);
  return ctx.store.getProject(ctx.project.id);
}

test('server-side state guard blocks duplicate and out-of-order execution', async (t) => {
  const ctx = await harness();
  t.after(() => fs.rm(ctx.dir, { recursive: true, force: true }));

  const first = await ctx.state.start(ctx.project.id, ctx.user.id, 'STYLE');
  assert.equal(first.ok, true);

  const duplicate = await ctx.state.start(ctx.project.id, ctx.user.id, 'STYLE');
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'ALREADY_RUNNING');

  await ctx.runner.run(ctx.project.id, 'STYLE', { style: 'Ink wash' });
  const afterStyle = await ctx.store.getProject(ctx.project.id);
  assert.equal(afterStyle.completedStep, 1);
  assert.equal(afterStyle.style, 'Ink wash');

  const skipped = await ctx.state.start(ctx.project.id, ctx.user.id, 'CHAPTERS');
  assert.equal(skipped.ok, false);
  assert.equal(skipped.code, 'OUT_OF_ORDER');
  assert.equal(skipped.expected, 'CHARACTERS');
});

test('happy path persists all five steps and enforces 2-character / 1-chapter caps', async (t) => {
  const ctx = await harness();
  t.after(() => fs.rm(ctx.dir, { recursive: true, force: true }));

  let project = await runStep(ctx, 'STYLE');
  assert.equal(project.completedStep, 1);
  assert.equal(ctx.gemini.calls.filter((call) => call === 'uploadBook').length, 1);
  assert.equal(ctx.gemini.calls.filter((call) => call === 'createBookContext').length, 1);

  project = await runStep(ctx, 'CHARACTERS');
  assert.equal(project.characters.length, 2, 'server trims mock output from 3 characters to 2');

  project = await runStep(ctx, 'PORTRAITS');
  assert.ok(project.characters.every((character) => character.portraitUrl));
  for (const [index] of project.characters.entries()) {
    await fs.access(ctx.store.imagePath(ctx.project.id, 'portraits', index, 'png'));
  }

  project = await runStep(ctx, 'CHAPTERS');
  assert.equal(project.chapters.length, 1, 'server trims mock output from 2 chapters to 1');

  project = await runStep(ctx, 'ILLUSTRATIONS');
  assert.equal(project.completedStep, 5);
  assert.equal(deriveStatus(project), 'DONE');
  assert.ok(project.chapters[0].illustrationUrl);
  await fs.access(ctx.store.imagePath(ctx.project.id, 'illustrations', 0, 'png'));
});

class FlakyPortraitGemini extends MockGeminiClient {
  constructor() {
    super({ delayMs: 0 });
    this.failRatOnce = true;
  }

  async generatePortrait(previousId, character) {
    if (character.name === 'Rat' && this.failRatOnce) {
      this.failRatOnce = false;
      this.calls.push('portrait:Rat:failed');
      throw new Error('simulated portrait outage');
    }
    return super.generatePortrait(previousId, character);
  }
}

test('failed image step is retryable and keeps already-generated portrait', async (t) => {
  const ctx = await harness({ gemini: new FlakyPortraitGemini() });
  t.after(() => fs.rm(ctx.dir, { recursive: true, force: true }));

  await runStep(ctx, 'STYLE');
  await runStep(ctx, 'CHARACTERS');

  let project = await runStep(ctx, 'PORTRAITS');
  assert.equal(project.completedStep, 2, 'failed portrait step must not advance completion');
  assert.equal(project.run.state, 'FAILED');
  assert.match(project.run.error, /simulated portrait outage/);
  assert.ok(project.characters[0].portraitUrl, 'first portrait is persisted immediately');
  assert.equal(project.characters[1].portraitUrl, null);

  project = await runStep(ctx, 'PORTRAITS');
  assert.equal(project.completedStep, 3);
  assert.ok(project.characters.every((character) => character.portraitUrl));
  assert.equal(ctx.gemini.calls.filter((call) => call === 'portrait:Mole').length, 1, 'retry skips the already-saved portrait');
});

test('retrying style after downstream failure does not re-upload the book context', async (t) => {
  class FailStyleOnce extends MockGeminiClient {
    constructor() { super({ delayMs: 0 }); this.first = true; }
    async defineStyle(previous, custom) {
      if (this.first) { this.first = false; this.calls.push('defineStyle:failed'); throw new Error('style failed'); }
      return super.defineStyle(previous, custom);
    }
  }
  const ctx = await harness({ gemini: new FailStyleOnce() });
  t.after(() => fs.rm(ctx.dir, { recursive: true, force: true }));

  let project = await runStep(ctx, 'STYLE');
  assert.equal(project.run.state, 'FAILED');
  assert.ok(project.gemini.fileUri);
  assert.ok(project.gemini.bookInteractionId);

  project = await runStep(ctx, 'STYLE');
  assert.equal(project.completedStep, 1);
  assert.equal(ctx.gemini.calls.filter((call) => call === 'uploadBook').length, 1);
  assert.equal(ctx.gemini.calls.filter((call) => call === 'createBookContext').length, 1);
});

test('a stale running step can be explicitly recovered without data surgery', async (t) => {
  const ctx = await harness({ staleMs: 10 });
  t.after(() => fs.rm(ctx.dir, { recursive: true, force: true }));

  await ctx.store.withProject(ctx.project.id, (project) => {
    project.run = {
      state: 'RUNNING',
      step: 'STYLE',
      startedAt: new Date(Date.now() - 5000).toISOString(),
      attempt: 1,
      error: null,
    };
  });

  const recovered = await ctx.state.recover(ctx.project.id, ctx.user.id);
  assert.equal(recovered.ok, true);
  const project = await ctx.store.getProject(ctx.project.id);
  assert.equal(project.run.state, 'IDLE');
  assert.equal(project.completedStep, 0);
});

test('project storage is isolated by owner', async (t) => {
  const ctx = await harness();
  t.after(() => fs.rm(ctx.dir, { recursive: true, force: true }));
  const other = await ctx.store.upsertUser('Other User', 'other@example.com');
  const visible = await ctx.store.listProjects(ctx.user.id);
  const hidden = await ctx.store.listProjects(other.id);
  assert.equal(visible.length, 1);
  assert.equal(hidden.length, 0);
  const forbiddenStart = await ctx.state.start(ctx.project.id, other.id, 'STYLE');
  assert.equal(forbiddenStart.code, 'NOT_FOUND');
});
