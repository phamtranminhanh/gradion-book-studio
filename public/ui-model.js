export const STEPS = [
  { key: 'STYLE', label: 'Style', action: 'Generate style' },
  { key: 'CHARACTERS', label: 'Characters', action: 'Find characters' },
  { key: 'PORTRAITS', label: 'Portraits', action: 'Generate portraits' },
  { key: 'CHAPTERS', label: 'Chapters', action: 'Plan chapter' },
  { key: 'ILLUSTRATIONS', label: 'Illustrations', action: 'Generate illustration' },
];

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function validateIdentity(name, email) {
  if (!String(name).trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    return 'Enter your name and a valid email to continue.';
  }
  return '';
}

export function validateProject(title, bookText) {
  if (!String(title).trim() || !String(bookText).trim()) {
    return 'Give the project a title and provide the book text (paste or upload).';
  }
  return '';
}

export function statusLabel(status) {
  return ({ DRAFT: 'Draft', IN_PROGRESS: 'In progress', DONE: 'Done' })[status] ?? status;
}

export function stepLabel(key) {
  return STEPS.find((step) => step.key === key)?.label ?? key;
}

export function renderEmptyState() {
  return `<section class="empty-state">
    <div class="empty-visual" aria-hidden="true"><span>✦</span><i></i><b></b></div>
    <p class="kicker">Your studio is empty</p>
    <h2>No illustration projects yet</h2>
    <p>Bring in a plain-text book and build its visual world one deliberate AI step at a time.</p>
    <a class="btn btn-primary" href="#/projects/new">Create your first project <span aria-hidden="true">→</span></a>
  </section>`;
}

export function renderStepPanel(project) {
  if (project.completedStep >= STEPS.length) {
    return `<section class="step-panel success-panel">
      <div class="panel-icon success-mark">✓</div>
      <div class="panel-copy"><span class="panel-kicker">Pipeline complete</span><h3>Illustration complete</h3>
      <p class="help">All five steps are safely stored. You can leave and come back without losing the results.</p></div>
    </section>`;
  }

  const current = STEPS[project.completedStep];
  const run = project.run ?? { state: 'IDLE' };

  if (run.state === 'RUNNING' && run.stale) {
    return `<section class="step-panel warning-panel">
      <div class="panel-icon warning-mark">!</div>
      <div class="panel-copy"><span class="panel-kicker">Recovery needed</span><h3>${escapeHtml(stepLabel(run.step))} may have been interrupted</h3>
      <p class="help">The server has not completed this call within the recovery window. Recover the step before retrying; completed results stay intact.</p>
      <button class="btn btn-secondary" data-action="recover-step">Recover this step</button></div>
    </section>`;
  }

  if (run.state === 'RUNNING') {
    return `<section class="step-panel running-panel">
      <div class="panel-icon"><span class="spinner" aria-hidden="true"></span></div>
      <div class="panel-copy"><span class="panel-kicker">Gemini is working</span><h3>Generating ${escapeHtml(stepLabel(run.step).toLowerCase())}…</h3>
      <p class="help">Attempt ${Number(run.attempt || 1)} is running on the server. Refreshing or opening another tab will not start a duplicate call.</p></div>
    </section>`;
  }

  if (run.state === 'FAILED') {
    return `<section class="step-panel error-panel">
      <div class="panel-icon error-mark">!</div>
      <div class="panel-copy"><span class="panel-kicker">Generation failed</span><h3>${escapeHtml(stepLabel(run.step))} failed</h3>
      <p class="error-copy">${escapeHtml(run.error || 'The generation request failed.')}</p>
      <p class="help">Completed steps were kept. Retry only this step when you are ready.</p>
      <button class="btn btn-primary" data-action="run-step" data-step="${escapeHtml(run.step)}">Retry ${escapeHtml(stepLabel(run.step).toLowerCase())}</button></div>
    </section>`;
  }

  const styleInput = current.key === 'STYLE'
    ? `<label class="field compact-field"><span>Optional art direction</span><input id="style-input" maxlength="240" placeholder="e.g. cinematic gouache with soft paper texture" autocomplete="off"></label>`
    : '';

  return `<section class="step-panel ready-panel">
    <div class="step-counter"><span>${project.completedStep + 1}</span><small>/ 5</small></div>
    <div class="panel-copy"><span class="panel-kicker">Ready when you are</span><h3>${escapeHtml(current.label)}</h3>
    ${styleInput}
    <button class="btn btn-primary btn-panel" data-action="run-step" data-step="${current.key}">${escapeHtml(current.action)} <span aria-hidden="true">→</span></button>
    <p class="help">Each step runs only when you ask. Gemini calls are never auto-retried.</p></div>
  </section>`;
}
