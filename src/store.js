import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

export const STEP_KEYS = ['STYLE', 'CHARACTERS', 'PORTRAITS', 'CHAPTERS', 'ILLUSTRATIONS'];

export class KeyedMutex {
  constructor() {
    this.tails = new Map();
  }

  async run(key, fn) {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

export class Store {
  constructor(baseDir) {
    this.baseDir = path.resolve(baseDir);
    this.projectsDir = path.join(this.baseDir, 'projects');
    this.booksDir = path.join(this.baseDir, 'books');
    this.imagesDir = path.join(this.baseDir, 'images');
    this.usersFile = path.join(this.baseDir, 'users.json');
    this.sessionsFile = path.join(this.baseDir, 'sessions.json');
    this.mutex = new KeyedMutex();
  }

  async init() {
    await Promise.all([
      fs.mkdir(this.projectsDir, { recursive: true }),
      fs.mkdir(this.booksDir, { recursive: true }),
      fs.mkdir(this.imagesDir, { recursive: true }),
    ]);
    await this.#ensureJson(this.usersFile, []);
    await this.#ensureJson(this.sessionsFile, {});
  }

  async #ensureJson(file, initial) {
    try { await fs.access(file); }
    catch { await this.#writeJson(file, initial); }
  }

  async #readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return structuredClone(fallback);
      throw error;
    }
  }

  async #writeJson(file, value) {
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temp, file);
  }

  async upsertUser(name, email) {
    const normalizedEmail = email.trim().toLowerCase();
    return this.mutex.run('users', async () => {
      const users = await this.#readJson(this.usersFile, []);
      let user = users.find((candidate) => candidate.email === normalizedEmail);
      if (user) {
        user.name = name.trim();
        user.updatedAt = new Date().toISOString();
      } else {
        user = {
          id: randomUUID(),
          name: name.trim(),
          email: normalizedEmail,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        users.push(user);
      }
      await this.#writeJson(this.usersFile, users);
      return structuredClone(user);
    });
  }

  async getUser(userId) {
    const users = await this.#readJson(this.usersFile, []);
    const user = users.find((candidate) => candidate.id === userId);
    return user ? structuredClone(user) : null;
  }

  async createSession(userId) {
    return this.mutex.run('sessions', async () => {
      const sessions = await this.#readJson(this.sessionsFile, {});
      const token = randomBytes(32).toString('base64url');
      sessions[token] = { userId, createdAt: Date.now() };
      await this.#writeJson(this.sessionsFile, sessions);
      return token;
    });
  }

  async getSession(token) {
    if (!token) return null;
    const sessions = await this.#readJson(this.sessionsFile, {});
    return sessions[token] ?? null;
  }

  async destroySession(token) {
    if (!token) return;
    await this.mutex.run('sessions', async () => {
      const sessions = await this.#readJson(this.sessionsFile, {});
      delete sessions[token];
      await this.#writeJson(this.sessionsFile, sessions);
    });
  }

  projectPath(projectId) {
    return path.join(this.projectsDir, `${projectId}.json`);
  }

  bookPath(projectId) {
    return path.join(this.booksDir, `${projectId}.txt`);
  }

  imagePath(projectId, type, index, extension = 'png') {
    return path.join(this.imagesDir, projectId, type, `${index}.${extension}`);
  }

  async createProject(ownerId, title, bookText) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const project = {
      id,
      ownerId,
      title: title.trim(),
      createdAt: now,
      updatedAt: now,
      completedStep: 0,
      run: {
        state: 'IDLE',
        step: null,
        startedAt: null,
        attempt: 0,
        error: null,
      },
      style: null,
      characters: [],
      chapters: [],
      gemini: {
        fileName: null,
        fileUri: null,
        bookInteractionId: null,
        styleInteractionId: null,
        characterInteractionId: null,
        imageInteractionId: null,
        chapterInteractionId: null,
      },
    };

    await this.mutex.run(`project:${id}`, async () => {
      await fs.writeFile(this.bookPath(id), bookText, 'utf8');
      await this.#writeJson(this.projectPath(id), project);
    });
    return structuredClone(project);
  }

  async getProject(projectId) {
    const project = await this.#readJson(this.projectPath(projectId), null);
    return project ? structuredClone(project) : null;
  }

  async listProjects(ownerId) {
    let files = [];
    try { files = await fs.readdir(this.projectsDir); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const projects = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const project = await this.#readJson(path.join(this.projectsDir, file), null);
      if (project?.ownerId === ownerId) projects.push(project);
    }
    return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((project) => structuredClone(project));
  }

  async withProject(projectId, fn) {
    return this.mutex.run(`project:${projectId}`, async () => {
      const project = await this.#readJson(this.projectPath(projectId), null);
      if (!project) return null;
      const result = await fn(project);
      project.updatedAt = new Date().toISOString();
      await this.#writeJson(this.projectPath(projectId), project);
      return result === undefined ? structuredClone(project) : result;
    });
  }

  async readBook(projectId) {
    return fs.readFile(this.bookPath(projectId), 'utf8');
  }

  async writeImage(projectId, kind, index, bytes, mimeType = 'image/png') {
    const extension = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
    const file = this.imagePath(projectId, kind, index, extension);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    return `/generated/${encodeURIComponent(projectId)}/${encodeURIComponent(kind)}/${index}.${extension}`;
  }
}

export function deriveStatus(project) {
  if (project.completedStep >= 5) return 'DONE';
  if (project.completedStep === 0 && project.run.state === 'IDLE') return 'DRAFT';
  return 'IN_PROGRESS';
}

export function nextStep(project) {
  return STEP_KEYS[project.completedStep] ?? null;
}

export function isRunStale(project, staleMs, now = Date.now()) {
  if (project.run.state !== 'RUNNING' || !project.run.startedAt) return false;
  return now - Date.parse(project.run.startedAt) > staleMs;
}
