import { STEP_KEYS, isRunStale, nextStep } from './store.js';

export class PipelineState {
  constructor(store, { staleMs = 300_000 } = {}) {
    this.store = store;
    this.staleMs = staleMs;
  }

  async start(projectId, ownerId, stepKey) {
    let outcome;
    await this.store.withProject(projectId, (project) => {
      if (project.ownerId !== ownerId) {
        outcome = { ok: false, code: 'NOT_FOUND' };
        return;
      }

      const expected = nextStep(project);
      if (!expected) {
        outcome = { ok: false, code: 'DONE', project: structuredClone(project) };
        return;
      }
      if (stepKey !== expected) {
        outcome = { ok: false, code: 'OUT_OF_ORDER', expected, project: structuredClone(project) };
        return;
      }
      if (project.run.state === 'RUNNING') {
        outcome = {
          ok: false,
          code: isRunStale(project, this.staleMs) ? 'STALE' : 'ALREADY_RUNNING',
          project: structuredClone(project),
        };
        return;
      }
      if (project.run.state === 'FAILED' && project.run.step !== stepKey) {
        outcome = { ok: false, code: 'FAILED_OTHER_STEP', project: structuredClone(project) };
        return;
      }

      project.run = {
        state: 'RUNNING',
        step: stepKey,
        startedAt: new Date().toISOString(),
        attempt: (project.run.attempt ?? 0) + 1,
        error: null,
      };
      outcome = { ok: true, project: structuredClone(project) };
    });
    return outcome ?? { ok: false, code: 'NOT_FOUND' };
  }

  async finish(projectId, stepKey) {
    return this.store.withProject(projectId, (project) => {
      const expectedIndex = STEP_KEYS.indexOf(stepKey) + 1;
      if (project.run.state !== 'RUNNING' || project.run.step !== stepKey) {
        throw new Error(`Cannot finish ${stepKey}: it is not the active running step`);
      }
      if (expectedIndex !== project.completedStep + 1) {
        throw new Error(`Cannot finish ${stepKey}: completion order changed`);
      }
      project.completedStep = expectedIndex;
      project.run = { state: 'IDLE', step: null, startedAt: null, attempt: project.run.attempt, error: null };
    });
  }

  async fail(projectId, stepKey, error) {
    return this.store.withProject(projectId, (project) => {
      if (project.run.state !== 'RUNNING' || project.run.step !== stepKey) return;
      project.run = {
        state: 'FAILED',
        step: stepKey,
        startedAt: null,
        attempt: project.run.attempt,
        error: String(error?.message ?? error).slice(0, 1200),
      };
    });
  }

  async recover(projectId, ownerId) {
    let outcome;
    await this.store.withProject(projectId, (project) => {
      if (project.ownerId !== ownerId) {
        outcome = { ok: false, code: 'NOT_FOUND' };
        return;
      }
      if (project.run.state !== 'RUNNING') {
        outcome = { ok: false, code: 'NOT_RUNNING', project: structuredClone(project) };
        return;
      }
      if (!isRunStale(project, this.staleMs)) {
        outcome = { ok: false, code: 'NOT_STALE', project: structuredClone(project) };
        return;
      }
      project.run = { state: 'IDLE', step: null, startedAt: null, attempt: project.run.attempt, error: null };
      outcome = { ok: true, project: structuredClone(project) };
    });
    return outcome ?? { ok: false, code: 'NOT_FOUND' };
  }
}
