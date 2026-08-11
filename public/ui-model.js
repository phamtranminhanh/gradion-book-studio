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
  return `<div class="empty-state"><div class="empty-icon">✦</div><h3>No illustration projects yet</h3><p>Paste or upload a book to start turning it into a consistent visual story.</p><a class="btn btn-primary" href="#/projects/new">Create your first project <span aria-hidden="true">→</span></a></div>`;
}

export function renderStepPanel(project) {
  if (project.completedStep >= STEPS.length) {
    return `<div class="step-panel success-panel"><div class="status-line"><span class="success-mark">✓</span><strong>Illustration complete</strong></div><p class="help">All five steps are safely stored. You can leave and come back without losing the results.</p></div>`;
  }

  const current = STEPS[project.completedStep];
  const run = project.run ?? { state: 'IDLE' };

  if (run.state === 'RUNNING' && run.stale) {
    return `<div class="step-panel warning-panel"><div class="status-line"><span class="warning-mark">!</span><strong>${escapeHtml(stepLabel(run.step))} may have been interrupted</strong></div><p class="help">The server has not completed this call within the recovery window. Recover the step before retrying; completed results stay intact.</p><button class="btn btn-secondary" data-action="recover-step">Recover this step</button></div>`;
  }

  if (run.state === 'RUNNING') {
    return `<div class="step-panel"><div class="status-line"><span class="spinner" aria-hidden="true"></span><strong>Generating ${escapeHtml(stepLabel(run.step).toLowerCase())}…</strong></div><p class="help">Attempt ${Number(run.attempt || 1)} is running on the server. Refreshing or opening another tab will not start a duplicate call.</p></div>`;
  }

  if (run.state === 'FAILED') {
    return `<div class="step-panel error-panel"><div class="status-line"><span class="error-mark">!</span><strong>${escapeHtml(stepLabel(run.step))} failed</strong></div><p class="error-copy">${escapeHtml(run.error || 'The generation request failed.')}</p><p class="help">Completed steps were kept. Retry only this step when you are ready.</p><button class="btn btn-primary" data-action="run-step" data-step="${escapeHtml(run.step)}">Retry ${escapeHtml(stepLabel(run.step).toLowerCase())}</button></div>`;
  }

  const styleInput = current.key === 'STYLE'
    ? `<label class="field compact-field"><span>Optional art direction</span><input id="style-input" maxlength="240" placeholder="e.g. 1930s ink-and-watercolour storybook" autocomplete="off"></label>`
    : '';

  return `<div class="step-panel"><div class="status-line"><span class="current-dot"></span><strong>Ready for step ${project.completedStep + 1}: ${escapeHtml(current.label)}</strong></div>${styleInput}<button class="btn btn-primary" data-action="run-step" data-step="${current.key}">${escapeHtml(current.action)} <span aria-hidden="true">→</span></button><p class="help">Each step runs only when you ask. Gemini calls are never auto-retried.</p></div>`;
}
