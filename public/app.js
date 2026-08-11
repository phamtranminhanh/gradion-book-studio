import { STEPS, escapeHtml, renderEmptyState, renderStepPanel, statusLabel, stepLabel, validateIdentity, validateProject } from './ui-model.js';

const app = document.querySelector('#app');
const modal = document.querySelector('#book-modal');
const modalBody = document.querySelector('#book-modal-body');
let sessionUser = null;
let pollTimer = null;
let currentProject = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function initials(name = '') {
  return name.trim().split(/\s+/).filter(Boolean).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function nav() {
  if (!sessionUser) return '';
  return `<nav class="nav"><div class="nav-inner"><a class="wordmark" href="#/projects"><span class="wordmark-mark">G</span><span>Gradion <small>Book Studio</small></span></a><a class="nav-link" href="#/projects">Projects</a><div class="nav-user"><span class="avatar">${escapeHtml(initials(sessionUser.name))}</span><span class="name">${escapeHtml(sessionUser.name)}</span><button class="link-button" data-action="sign-out">Sign out</button></div></div></nav>`;
}

function footer() {
  return '<footer class="footer">Gradion · Scaling Business · local assessment build</footer>';
}

function formatDate(value) {
  try { return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)); }
  catch { return value; }
}

function renderAuth(error = '') {
  clearPolling();
  currentProject = null;
  app.innerHTML = `<main class="center-page"><section class="auth-card"><div class="wordmark"><span class="wordmark-mark">G</span><span>Gradion <small>Book Studio</small></span></div><h1>Illustrate a book</h1><p class="lede">Enter your name and email to open your projects. No password is required for this local assessment.</p><form id="identity-form" novalidate><label class="field"><span>Name</span><input id="identity-name" name="name" autocomplete="name" required placeholder="Your name"></label><label class="field"><span>Email</span><input id="identity-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><p id="identity-error" class="form-error" role="alert">${escapeHtml(error)}</p><button class="btn btn-primary btn-wide" type="submit">Continue <span aria-hidden="true">→</span></button></form></section></main>`;
  document.querySelector('#identity-form')?.addEventListener('submit', signIn);
}

async function signIn(event) {
  event.preventDefault();
  const name = document.querySelector('#identity-name').value.trim();
  const email = document.querySelector('#identity-email').value.trim();
  const validation = validateIdentity(name, email);
  if (validation) {
    document.querySelector('#identity-error').textContent = validation;
    return;
  }
  try {
    const result = await api('/api/session', { method: 'POST', body: JSON.stringify({ name, email }) });
    sessionUser = result.user;
    navigate('#/projects');
  } catch (error) {
    document.querySelector('#identity-error').textContent = error.message;
  }
}

async function signOut() {
  await api('/api/session', { method: 'DELETE' }).catch(() => {});
  sessionUser = null;
  navigate('#/');
}

async function renderProjectList() {
  clearPolling();
  currentProject = null;
  const { projects } = await api('/api/projects');
  const rows = projects.map((project) => {
    const segments = STEPS.map((_, index) => `<span class="${index < project.completedStep ? 'done' : ''}"></span>`).join('');
    return `<a class="project-row" href="#/projects/${encodeURIComponent(project.id)}"><div class="project-title"><h3>${escapeHtml(project.title)}</h3><span class="meta">Created ${escapeHtml(formatDate(project.createdAt))}</span></div><div class="progress-mini" aria-label="${project.completedStep} of 5 steps complete">${segments}</div><span class="pill ${escapeHtml(project.status)}">${escapeHtml(statusLabel(project.status))}</span></a>`;
  }).join('');

  app.innerHTML = `${nav()}<main class="shell"><header class="page-head"><div><p class="eyebrow">Workspace</p><h1>Your projects</h1><p>Each project resumes from its last persisted step.</p></div><a class="btn btn-primary" href="#/projects/new">New project <span aria-hidden="true">→</span></a></header>${projects.length ? `<div class="project-list">${rows}</div>` : renderEmptyState()}</main>${footer()}`;
  bindCommonActions();
}

function renderNewProject(error = '') {
  clearPolling();
  currentProject = null;
  app.innerHTML = `${nav()}<main class="shell narrow"><a class="back-link" href="#/projects">← Back to projects</a><header class="page-head"><div><p class="eyebrow">New project</p><h1>Add a book</h1><p>The source text is stored locally and uploaded to Gemini once when step 1 begins.</p></div></header><form id="project-form" class="card form-card" novalidate><label class="field" style="margin-top:0"><span>Project title</span><input id="project-title" maxlength="120" required placeholder="The Wind in the Willows"></label><label id="dropzone" class="dropzone" tabindex="0"><strong id="dropzone-title">Upload a .txt file</strong><span id="dropzone-hint">Click or press Enter to choose a plain-text book</span><input id="book-file" type="file" accept=".txt,text/plain" hidden></label><div class="or">or paste text</div><label class="field"><span>Book text</span><textarea id="book-text" required placeholder="Paste the book text here…"></textarea></label><p id="project-error" class="form-error" role="alert">${escapeHtml(error)}</p><button class="btn btn-primary btn-wide" type="submit">Create project <span aria-hidden="true">→</span></button></form></main>${footer()}`;
  bindCommonActions();
  const fileInput = document.querySelector('#book-file');
  const dropzone = document.querySelector('#dropzone');
  fileInput?.addEventListener('change', handleBookFile);
  dropzone?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
  });
  document.querySelector('#project-form')?.addEventListener('submit', createProject);
}

async function handleBookFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.txt') && file.type !== 'text/plain') {
    document.querySelector('#project-error').textContent = 'Upload a plain .txt file.';
    return;
  }
  try {
    const text = await file.text();
    document.querySelector('#book-text').value = text;
    document.querySelector('#dropzone').classList.add('has-file');
    document.querySelector('#dropzone-title').textContent = `✓ ${file.name}`;
    document.querySelector('#dropzone-hint').textContent = `${Math.max(1, Math.round(file.size / 1024))} KB loaded — you can still edit the text below`;
    document.querySelector('#project-error').textContent = '';
  } catch {
    document.querySelector('#project-error').textContent = 'Could not read this text file.';
  }
}

async function createProject(event) {
  event.preventDefault();
  const title = document.querySelector('#project-title').value.trim();
  const bookText = document.querySelector('#book-text').value.trim();
  const validation = validateProject(title, bookText);
  if (validation) {
    document.querySelector('#project-error').textContent = validation;
    return;
  }
  try {
    const result = await api('/api/projects', { method: 'POST', body: JSON.stringify({ title, bookText }) });
    navigate(`#/projects/${encodeURIComponent(result.project.id)}`);
  } catch (error) {
    document.querySelector('#project-error').textContent = error.message;
  }
}

function renderStepper(project) {
  return `<div class="stepper" aria-label="Illustration pipeline">${STEPS.map((step, index) => {
    const state = index < project.completedStep ? 'done' : index === project.completedStep && project.completedStep < STEPS.length ? 'current' : 'pending';
    return `<div class="step ${state}"><div class="step-row"><span class="step-num">${index < project.completedStep ? '✓' : index + 1}</span><span class="step-label">${escapeHtml(step.label)}</span></div></div>`;
  }).join('')}</div>`;
}

function artPlaceholder(label, running = false) {
  return `<div class="placeholder">${running ? '<span class="spinner" aria-hidden="true"></span>' : '<span class="empty-icon">✦</span>'}<span>${escapeHtml(label)}</span></div>`;
}

function characterCards(project) {
  if (!project.characters.length) return '';
  const generating = project.run?.state === 'RUNNING' && project.run.step === 'PORTRAITS';
  return `<section><div class="section-title"><h2>Characters</h2><span class="meta">${project.characters.length} adult character${project.characters.length === 1 ? '' : 's'}</span></div><div class="entity-grid">${project.characters.map((character) => `<article class="entity-card"><div class="art">${character.portraitUrl ? `<img src="${escapeHtml(character.portraitUrl)}" alt="Portrait of ${escapeHtml(character.name)}">` : artPlaceholder(generating ? `Generating ${character.name}…` : 'Portrait pending', generating)}</div><div class="entity-body"><h3>${escapeHtml(character.name)}</h3><p title="${escapeHtml(character.prompt)}">${escapeHtml(character.prompt)}</p></div></article>`).join('')}</div></section>`;
}

function chapterCards(project) {
  if (!project.chapters.length) return '';
  const generating = project.run?.state === 'RUNNING' && project.run.step === 'ILLUSTRATIONS';
  return `<section><div class="section-title"><h2>Chapter</h2><span class="meta">1 chapter maximum</span></div><div class="entity-grid single">${project.chapters.map((chapter) => `<article class="entity-card"><div class="art chapter">${chapter.illustrationUrl ? `<img src="${escapeHtml(chapter.illustrationUrl)}" alt="Illustration for ${escapeHtml(chapter.name)}">` : artPlaceholder(generating ? `Generating ${chapter.name}…` : 'Illustration pending', generating)}</div><div class="entity-body"><h3>${escapeHtml(chapter.name)}</h3><p title="${escapeHtml(chapter.prompt)}">${escapeHtml(chapter.prompt)}</p></div></article>`).join('')}</div></section>`;
}

function renderProjectDetail(project) {
  currentProject = project;
  const runningLabel = project.run?.state === 'RUNNING' ? `${stepLabel(project.run.step)} running` : `${project.completedStep} of 5 complete`;
  app.innerHTML = `${nav()}<main class="shell"><a class="back-link" href="#/projects">← Back to projects</a><header class="detail-head"><div><p class="eyebrow">${escapeHtml(statusLabel(project.status))} · ${escapeHtml(runningLabel)}</p><h1>${escapeHtml(project.title)}</h1><span class="meta">Created ${escapeHtml(formatDate(project.createdAt))}</span></div><button class="btn btn-secondary" data-action="open-book">Read source text</button></header>${renderStepper(project)}<div class="detail-grid"><div class="main-column">${project.style ? `<section class="style-card"><p class="eyebrow">Art direction</p><p>${escapeHtml(project.style)}</p></section>` : ''}${characterCards(project)}${chapterCards(project)}${!project.style && !project.characters.length ? '<section class="side-note"><p class="eyebrow">Before you begin</p><p>Step 1 uploads the source once, establishes Gemini conversation context, and either uses your art direction or asks Gemini to choose one.</p></section>' : ''}</div><aside class="side-column">${renderStepPanel(project)}<section class="side-note"><p class="eyebrow">Pipeline rule</p><p>Steps stay in order. The server persists progress before and after external calls so refreshes and retries do not erase completed work.</p></section></aside></div></main>${footer()}`;
  bindCommonActions();
  if (project.run?.state === 'RUNNING') startPolling(project.id);
  else clearPolling();
}

async function loadProject(id, { quiet = false } = {}) {
  try {
    const { project } = await api(`/api/projects/${encodeURIComponent(id)}`);
    renderProjectDetail(project);
  } catch (error) {
    if (error.status === 404) return navigate('#/projects');
    if (!quiet) showToast(error.message);
  }
}

async function runStep(stepKey) {
  if (!currentProject) return;
  const style = stepKey === 'STYLE' ? (document.querySelector('#style-input')?.value || '').trim() : '';
  try {
    const result = await api(`/api/projects/${encodeURIComponent(currentProject.id)}/steps/${encodeURIComponent(stepKey)}`, { method: 'POST', body: JSON.stringify({ style }) });
    renderProjectDetail(result.project);
  } catch (error) {
    if (error.payload?.project) renderProjectDetail({ ...currentProject, ...error.payload.project });
    if (error.payload?.error === 'ALREADY_RUNNING') showToast('That step is already running. The existing call is still in progress.');
    else if (error.payload?.error === 'STALE') showToast('This run looks stranded. Recover it before retrying.');
    else showToast(error.message);
  }
}

async function recoverStep() {
  if (!currentProject) return;
  try {
    const result = await api(`/api/projects/${encodeURIComponent(currentProject.id)}/recover`, { method: 'POST', body: '{}' });
    renderProjectDetail(result.project);
  } catch (error) {
    showToast(error.payload?.error === 'NOT_STALE' ? 'The server still considers this call active.' : error.message);
    await loadProject(currentProject.id, { quiet: true });
  }
}

function openBook() {
  if (!currentProject) return;
  modalBody.textContent = currentProject.bookText || '';
  modal.hidden = false;
  modal.querySelector('[data-action="close-book"]')?.focus();
  document.body.style.overflow = 'hidden';
}

function closeBook() {
  modal.hidden = true;
  modalBody.textContent = '';
  document.body.style.overflow = '';
}

function bindCommonActions() {
  document.querySelector('[data-action="sign-out"]')?.addEventListener('click', signOut);
  document.querySelector('[data-action="open-book"]')?.addEventListener('click', openBook);
  document.querySelector('[data-action="recover-step"]')?.addEventListener('click', recoverStep);
  document.querySelectorAll('[data-action="run-step"]').forEach((button) => button.addEventListener('click', () => runStep(button.dataset.step)));
}

modal.addEventListener('click', (event) => { if (event.target === modal) closeBook(); });
modal.querySelector('[data-action="close-book"]')?.addEventListener('click', closeBook);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) closeBook(); });

function startPolling(projectId) {
  clearPolling();
  pollTimer = setInterval(async () => {
    const routeInfo = parseRoute();
    if (routeInfo.name !== 'detail' || routeInfo.id !== projectId) return clearPolling();
    await loadProject(projectId, { quiet: true });
  }, 1500);
}

function clearPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function showToast(message) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 4500);
}

function parseRoute() {
  const hash = location.hash || '#/';
  if (hash === '#/' || hash === '') return { name: 'auth' };
  if (hash === '#/projects') return { name: 'list' };
  if (hash === '#/projects/new') return { name: 'new' };
  const match = hash.match(/^#\/projects\/([^/]+)$/);
  if (match) return { name: 'detail', id: decodeURIComponent(match[1]) };
  return { name: 'list' };
}

async function route() {
  closeBook();
  const routeInfo = parseRoute();
  if (!sessionUser) {
    try { sessionUser = (await api('/api/session')).user; }
    catch { sessionUser = null; }
  }
  if (!sessionUser) {
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
    return renderAuth();
  }
  try {
    if (routeInfo.name === 'auth') return navigate('#/projects');
    if (routeInfo.name === 'list') return await renderProjectList();
    if (routeInfo.name === 'new') return renderNewProject();
    if (routeInfo.name === 'detail') return await loadProject(routeInfo.id);
  } catch (error) {
    if (error.status === 401) { sessionUser = null; return renderAuth('Your local session expired. Sign in again.'); }
    showToast(error.message);
  }
}

window.addEventListener('hashchange', route);
route();
