import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, deriveStatus, isRunStale, nextStep } from './store.js';
import { PipelineState } from './state-machine.js';
import { PipelineRunner } from './pipeline.js';
import { makeGeminiFromEnv } from './gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const port = Number(process.env.PORT || 3000);
const staleMs = Number(process.env.STALE_STEP_MS || 300_000);

const store = new Store(dataDir);
await store.init();
const state = new PipelineState(store, { staleMs });
const runner = new PipelineRunner({ store, state, gemini: makeGeminiFromEnv(process.env) });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const i = part.indexOf('='); return [decodeURIComponent(part.slice(0, i)), decodeURIComponent(part.slice(i + 1))];
  }));
}

async function currentUser(req) {
  const token = cookies(req).gradion_session;
  const session = await store.getSession(token);
  if (!session) return { token, user: null };
  return { token, user: await store.getUser(session.userId) };
}

function send(res, status, body, headers = {}) {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(payload);
}

async function jsonBody(req, maxBytes = 12 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function projectView(project, bookText = undefined) {
  const view = {
    id: project.id, title: project.title, createdAt: project.createdAt, updatedAt: project.updatedAt,
    completedStep: project.completedStep, status: deriveStatus(project), nextStep: nextStep(project),
    run: { ...project.run, stale: isRunStale(project, staleMs) },
    style: project.style, characters: project.characters, chapters: project.chapters,
  };
  if (bookText !== undefined) view.bookText = bookText;
  return view;
}

async function serveFile(res, file) {
  try {
    const bytes = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': file.includes('/generated/') ? 'private, max-age=3600' : 'no-cache' });
    res.end(bytes);
  } catch (error) { if (error.code === 'ENOENT') send(res, 404, { error: 'Not found' }); else throw error; }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/generated/')) {
      const rel = pathname.slice('/generated/'.length);
      const file = path.resolve(store.imagesDir, rel);
      if (!file.startsWith(store.imagesDir + path.sep)) return send(res, 403, { error: 'Forbidden' });
      return serveFile(res, file);
    }

    if (pathname === '/api/session' && req.method === 'POST') {
      const body = await jsonBody(req);
      const name = String(body.name || '').trim(); const email = String(body.email || '').trim().toLowerCase();
      if (!name || !validEmail(email)) return send(res, 400, { error: 'Enter your name and a valid email.' });
      const user = await store.upsertUser(name, email); const token = await store.createSession(user.id);
      return send(res, 200, { user }, { 'set-cookie': `gradion_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=259200` });
    }
    if (pathname === '/api/session' && req.method === 'GET') {
      const { user } = await currentUser(req); return send(res, 200, { user });
    }
    if (pathname === '/api/session' && req.method === 'DELETE') {
      const { token } = await currentUser(req); await store.destroySession(token);
      return send(res, 200, { ok: true }, { 'set-cookie': 'gradion_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }

    if (pathname.startsWith('/api/')) {
      const { user } = await currentUser(req);
      if (!user) return send(res, 401, { error: 'Sign in required.' });

      if (pathname === '/api/projects' && req.method === 'GET') {
        const projects = await store.listProjects(user.id); return send(res, 200, { projects: projects.map((p) => projectView(p)) });
      }
      if (pathname === '/api/projects' && req.method === 'POST') {
        const body = await jsonBody(req); const title = String(body.title || '').trim(); const bookText = String(body.bookText || '').trim();
        if (!title || !bookText) return send(res, 400, { error: 'Project title and book text are required.' });
        const project = await store.createProject(user.id, title, bookText); return send(res, 201, { project: projectView(project, bookText) });
      }

      const detail = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (detail && req.method === 'GET') {
        const project = await store.getProject(detail[1]);
        if (!project || project.ownerId !== user.id) return send(res, 404, { error: 'Project not found.' });
        return send(res, 200, { project: projectView(project, await store.readBook(project.id)) });
      }

      const runMatch = pathname.match(/^\/api\/projects\/([^/]+)\/steps\/([A-Z]+)$/);
      if (runMatch && req.method === 'POST') {
        const [, projectId, stepKey] = runMatch; const body = await jsonBody(req);
        const result = await state.start(projectId, user.id, stepKey);
        if (!result.ok) {
          const status = result.code === 'NOT_FOUND' ? 404 : 409;
          return send(res, status, { error: result.code, expected: result.expected, project: result.project ? projectView(result.project) : undefined });
        }
        setImmediate(() => runner.run(projectId, stepKey, { style: String(body.style || '').trim() }));
        return send(res, 202, { project: projectView(result.project) });
      }

      const recover = pathname.match(/^\/api\/projects\/([^/]+)\/recover$/);
      if (recover && req.method === 'POST') {
        const result = await state.recover(recover[1], user.id);
        if (!result.ok) return send(res, result.code === 'NOT_FOUND' ? 404 : 409, { error: result.code, project: result.project ? projectView(result.project) : undefined });
        return send(res, 200, { project: projectView(result.project) });
      }
      return send(res, 404, { error: 'API route not found.' });
    }

    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(publicDir, requested);
    if (!file.startsWith(publicDir + path.sep) && file !== path.join(publicDir, 'index.html')) return send(res, 403, { error: 'Forbidden' });
    try { return await serveFile(res, file); }
    catch { return serveFile(res, path.join(publicDir, 'index.html')); }
  } catch (error) {
    console.error(error);
    send(res, error.status || 500, { error: error.message || 'Internal server error' });
  }
});

server.listen(port, () => console.log(`Book Illustration Studio running at http://localhost:${port}`));
