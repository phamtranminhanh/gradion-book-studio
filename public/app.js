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

function icon(name) {
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"/>',
    logout: '<path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M14 8l4 4-4 4M18 12H9"/>',
    arrow: '<path d="m9 18 6-6-6-6"/>',
    upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/>',
    text: '<path d="M5 6h14M5 10h14M5 14h10M5 18h8"/>',
    spark: '<path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9zM18.5 15l.6 2.1L21 18l-1.9.9-.6 2.1-.6-2.1L16 18l1.9-.9z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
}

function brand() {
  return `<span class="brand-mark" aria-hidden="true"><i></i><b></b></span><span class="brand-copy"><strong>StoryLab</strong><small>by Gradion</small></span>`;
}

function sidebar(active = 'projects') {
  if (!sessionUser) return '';
  return `<aside class="sidebar">
    <a class="brand" href="#/projects">${brand()}</a>
    <div class="sidebar-label">Workspace</div>
    <nav class="side-nav" aria-label="Primary">
      <a class="side-link ${active === 'projects' ? 'active' : ''}" href="#/projects">${icon('grid')}<span>Projects</span></a>
      <a class="side-link ${active === 'new' ? 'active' : ''}" href="#/projects/new">${icon('plus')}<span>New project</span></a>
    </nav>
    <div class="sidebar-spacer"></div>
    <div class="sidebar-tip"><span>${icon('spark')}</span><p><strong>Five deliberate steps.</strong><br>Every Gemini call is initiated by you.</p></div>
    <div class="user-card"><span class="avatar">${escapeHtml(initials(sessionUser.name))}</span><div><strong>${escapeHtml(sessionUser.name)}</strong><small>${escapeHtml(sessionUser.email)}</small></div><button class="icon-button" data-action="sign-out" title="Sign out" aria-label="Sign out">${icon('logout')}</button></div>
  </aside>`;
}

function mobileBar() {
  return `<header class="mobile-bar"><a class="brand" href="#/projects">${brand()}</a><button class="ghost-button" data-action="sign-out">Sign out</button></header>`;
}

function chrome(content, active = 'projects') {
  return `<div class="app-frame">${sidebar(active)}<div class="workspace">${mobileBar()}${content}<footer class="footer">Local assessment build · Gradion Scaling Business</footer></div></div>`;
}

function formatDate(value) {
  try { return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)); }
  catch { return value; }
}

function renderAuth(error = '') {
  clearPolling();
  currentProject = null;
  app.innerHTML = `<main class="auth-page">
    <section class="auth-showcase">
      <a class="brand auth-brand" href="#/">${brand()}</a>
      <div class="showcase-copy"><p class="kicker light">AI illustration workspace</p><h1>Turn a book into a<br><em>visual world.</em></h1><p>Build consistent characters and chapter art through a controlled five-step Gemini pipeline.</p></div>
      <div class="showcase-flow" aria-label="Five illustration steps">${STEPS.map((step, index) => `<div><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(step.label)}</strong></div>`).join('')}</div>
      <div class="showcase-art" aria-hidden="true"><div class="orb orb-a"></div><div class="orb orb-b"></div><div class="page-card page-one"><span>CHARACTER</span></div><div class="page-card page-two"><span>CHAPTER</span></div></div>
    </section>
    <section class="auth-form-pane"><div class="auth-card"><p class="kicker">Welcome to your studio</p><h2>Continue locally</h2><p class="lede">No password or account setup. Your name and email simply identify your local projects.</p><form id="identity-form" novalidate><label class="field"><span>Name</span><input id="identity-name" name="name" autocomplete="name" required placeholder="Nguyen Do Nguyen"></label><label class="field"><span>Email</span><input id="identity-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><p id="identity-error" class="form-error" role="alert">${escapeHtml(error)}</p><button class="btn btn-primary btn-wide" type="submit">Enter studio ${icon('arrow')}</button></form><p class="privacy-note">Runs on your machine · Gemini key stays server-side</p></div></section>
  </main>`;
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

function projectCard(project) {
  const pct = Math.round((project.completedStep / STEPS.length) * 100);
  const activeStep = project.completedStep >= STEPS.length ? 'Complete' : stepLabel(project.run?.state === 'RUNNING' ? project.run.step : STEPS[project.completedStep]?.key);
  const running = project.run?.state === 'RUNNING';
  return `<a class="project-card" href="#/projects/${encodeURIComponent(project.id)}">
    <div class="project-cover"><div class="cover-grid"></div><span class="cover-step">${project.completedStep}/5</span><div class="cover-symbol">${icon(project.completedStep >= 3 ? 'image' : 'book')}</div></div>
    <div class="project-card-body"><div class="project-card-top"><span class="status-chip ${escapeHtml(project.status)}">${running ? '<i class="live-dot"></i>' : ''}${escapeHtml(statusLabel(project.status))}</span><span class="meta">${escapeHtml(formatDate(project.createdAt))}</span></div><h3>${escapeHtml(project.title)}</h3><p>${running ? `${escapeHtml(activeStep)} is running on the server` : `${escapeHtml(activeStep)} · ${pct}% complete`}</p><div class="project-progress"><i style="width:${pct}%"></i></div><div class="card-link">Open workspace ${icon('arrow')}</div></div>
  </a>`;
}

async function renderProjectList() {
  clearPolling();
  currentProject = null;
  const { projects } = await api('/api/projects');
  const done = projects.filter((p) => p.status === 'DONE').length;
  const active = projects.filter((p) => p.status === 'IN_PROGRESS').length;
  const content = `<main class="page dashboard-page">
    <header class="dashboard-head"><div><p class="kicker">Creative workspace</p><h1>Good to see you, ${escapeHtml((sessionUser.name || '').split(/\s+/)[0] || 'there')}.</h1><p>Continue an illustration or start a new visual story.</p></div><a class="btn btn-primary" href="#/projects/new">${icon('plus')} New project</a></header>
    <section class="stats-strip" aria-label="Project summary"><div><span>Projects</span><strong>${projects.length}</strong></div><div><span>In progress</span><strong>${active}</strong></div><div><span>Completed</span><strong>${done}</strong></div><div class="stats-note"><span>${icon('check')}</span><p>Progress is persisted after every successful step.</p></div></section>
    ${projects.length ? `<section><div class="section-head"><div><p class="kicker">Library</p><h2>Your projects</h2></div><span class="meta">${projects.length} total</span></div><div class="project-grid">${projects.map(projectCard).join('')}</div></section>` : renderEmptyState()}
  </main>`;
  app.innerHTML = chrome(content, 'projects');
  bindCommonActions();
}

function renderNewProject(error = '') {
  clearPolling();
  currentProject = null;
  const content = `<main class="page new-page">
    <a class="crumb" href="#/projects">← Projects</a>
    <header class="editorial-head"><p class="kicker">Start a visual story</p><h1>Bring in your book.</h1><p>Give the project a title, then upload a .txt file or paste the source. The source stays readable throughout the pipeline.</p></header>
    <form id="project-form" class="new-project-grid" novalidate>
      <section class="source-card"><div class="form-section-head"><span class="form-number">01</span><div><h2>Project details</h2><p>Name this illustration workspace.</p></div></div><label class="field"><span>Project title</span><input id="project-title" maxlength="120" required placeholder="The Wind in the Willows"></label></section>
      <section class="source-card source-input-card"><div class="form-section-head"><span class="form-number">02</span><div><h2>Source text</h2><p>Upload or paste. Both end up as editable text.</p></div></div><div class="source-choice"><label id="dropzone" class="dropzone" tabindex="0"><span class="drop-icon">${icon('upload')}</span><strong id="dropzone-title">Upload .txt</strong><span id="dropzone-hint">Choose a plain-text book</span><input id="book-file" type="file" accept=".txt,text/plain" hidden></label><div class="choice-divider"><span>OR</span></div><div class="paste-cue"><span class="drop-icon">${icon('text')}</span><strong>Paste text</strong><span>Use the editor below</span></div></div><label class="field text-field"><span>Book text</span><textarea id="book-text" required placeholder="Paste the full book text here…"></textarea></label></section>
      <aside class="create-rail"><div class="rail-card"><span class="rail-icon">${icon('spark')}</span><p class="kicker">What happens next</p><h3>Five user-driven steps</h3><ol>${STEPS.map((s, i) => `<li><span>${i + 1}</span>${escapeHtml(s.label)}</li>`).join('')}</ol><p class="rail-note">Step 1 uploads the book to Gemini once. Later text steps reuse the conversation context.</p></div><p id="project-error" class="form-error create-error" role="alert">${escapeHtml(error)}</p><button class="btn btn-primary btn-wide" type="submit">Create workspace ${icon('arrow')}</button></aside>
    </form>
  </main>`;
  app.innerHTML = chrome(content, 'new');
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
    document.querySelector('#dropzone-hint').textContent = `${Math.max(1, Math.round(file.size / 1024))} KB loaded`;
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
  return `<nav class="pipeline-rail" aria-label="Illustration pipeline">${STEPS.map((step, index) => {
    const state = index < project.completedStep ? 'done' : index === project.completedStep && project.completedStep < STEPS.length ? 'current' : 'pending';
    const running = project.run?.state === 'RUNNING' && project.run.step === step.key;
    return `<div class="pipeline-step ${state} ${running ? 'running' : ''}"><span class="pipe-num">${index < project.completedStep ? icon('check') : String(index + 1).padStart(2, '0')}</span><span class="pipe-copy"><strong>${escapeHtml(step.label)}</strong><small>${index < project.completedStep ? 'Complete' : running ? 'Running now' : state === 'current' ? 'Up next' : 'Pending'}</small></span></div>`;
  }).join('')}</nav>`;
}

function artPlaceholder(label, running = false) {
  return `<div class="art-placeholder">${running ? '<span class="spinner" aria-hidden="true"></span>' : `<span class="placeholder-icon">${icon('image')}</span>`}<strong>${escapeHtml(label)}</strong><span>${running ? 'This card will update as soon as the image is saved.' : 'Waiting for its generation step.'}</span></div>`;
}

function characterCards(project) {
  if (!project.characters.length) return '';
  const generating = project.run?.state === 'RUNNING' && project.run.step === 'PORTRAITS';
  return `<section class="studio-section"><div class="section-head"><div><p class="kicker">Cast</p><h2>Characters</h2></div><span class="meta">${project.characters.length} adult character${project.characters.length === 1 ? '' : 's'} · max 2</span></div><div class="character-grid">${project.characters.map((character, index) => `<article class="entity-card character-card"><div class="art portrait-art">${character.portraitUrl ? `<img src="${escapeHtml(character.portraitUrl)}" alt="Portrait of ${escapeHtml(character.name)}">` : artPlaceholder(generating ? `Generating ${character.name}…` : 'Portrait pending', generating)}</div><div class="entity-body"><span class="entity-index">CHARACTER ${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(character.name)}</h3><p>${escapeHtml(character.prompt)}</p></div></article>`).join('')}</div></section>`;
}

function chapterCards(project) {
  if (!project.chapters.length) return '';
  const generating = project.run?.state === 'RUNNING' && project.run.step === 'ILLUSTRATIONS';
  return `<section class="studio-section"><div class="section-head"><div><p class="kicker">Scene</p><h2>Chapter illustration</h2></div><span class="meta">1 chapter maximum</span></div><div class="chapter-grid">${project.chapters.map((chapter, index) => `<article class="entity-card chapter-card"><div class="art chapter-art">${chapter.illustrationUrl ? `<img src="${escapeHtml(chapter.illustrationUrl)}" alt="Illustration for ${escapeHtml(chapter.name)}">` : artPlaceholder(generating ? `Generating ${chapter.name}…` : 'Illustration pending', generating)}</div><div class="entity-body"><span class="entity-index">CHAPTER ${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(chapter.name)}</h3><p>${escapeHtml(chapter.prompt)}</p></div></article>`).join('')}</div></section>`;
}

function renderProjectDetail(project) {
  currentProject = project;
  const runningLabel = project.run?.state === 'RUNNING' ? `${stepLabel(project.run.step)} running` : `${project.completedStep} of 5 complete`;
  const pct = Math.round((project.completedStep / STEPS.length) * 100);
  const content = `<main class="page studio-page">
    <a class="crumb" href="#/projects">← Projects</a>
    <header class="studio-head"><div><div class="status-row"><span class="status-chip ${escapeHtml(project.status)}">${escapeHtml(statusLabel(project.status))}</span><span>${escapeHtml(runningLabel)}</span></div><h1>${escapeHtml(project.title)}</h1><p>Created ${escapeHtml(formatDate(project.createdAt))} · ${pct}% of pipeline complete</p></div><button class="btn btn-secondary" data-action="open-book">${icon('book')} Read source</button></header>
    ${renderStepper(project)}
    <div class="studio-layout"><div class="studio-canvas">
      ${project.style ? `<section class="creative-brief"><div class="brief-label"><span>${icon('spark')}</span><p class="kicker">Creative brief</p></div><blockquote>${escapeHtml(project.style)}</blockquote></section>` : ''}
      ${characterCards(project)}${chapterCards(project)}
      ${!project.style && !project.characters.length ? `<section class="canvas-welcome"><div class="welcome-symbol">${icon('spark')}</div><p class="kicker">Blank canvas</p><h2>Your visual world starts with style.</h2><p>Step 1 sends the source to Gemini once, establishes the text context, and creates the art direction used throughout the rest of the pipeline.</p></section>` : ''}
    </div><aside class="control-dock"><div class="dock-sticky"><p class="kicker dock-kicker">Next action</p>${renderStepPanel(project)}<div class="integrity-card"><span>${icon('check')}</span><div><strong>Resumable by design</strong><p>Completed work persists across refresh, logout, failure, and server restart.</p></div></div></div></aside></div>
  </main>`;
  app.innerHTML = chrome(content, 'projects');
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
  document.querySelectorAll('[data-action="sign-out"]').forEach((button) => button.addEventListener('click', signOut));
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
