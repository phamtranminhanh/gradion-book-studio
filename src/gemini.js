import { promises as fs } from 'node:fs';

const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const FILES_UPLOAD_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

function outputText(interaction) {
  if (typeof interaction.output_text === 'string') return interaction.output_text;
  const steps = interaction.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type !== 'model_output') continue;
    const texts = (step.content ?? []).filter((item) => item.type === 'text').map((item) => item.text ?? '');
    if (texts.length) return texts.join('');
  }
  for (const output of [...(interaction.outputs ?? [])].reverse()) {
    if (output.type === 'text' && output.text) return output.text;
  }
  return '';
}

function outputImage(interaction) {
  if (interaction.output_image?.data) return interaction.output_image;
  const steps = interaction.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type !== 'model_output') continue;
    for (let j = (step.content ?? []).length - 1; j >= 0; j--) {
      const content = step.content[j];
      if (content.type === 'image' && content.data) return content;
    }
  }
  for (const output of [...(interaction.outputs ?? [])].reverse()) {
    if (output.type === 'image' && output.data) return output;
  }
  return null;
}

async function readError(response) {
  let body;
  try { body = await response.json(); }
  catch { body = { error: { message: await response.text().catch(() => '') } }; }
  const message = body?.error?.message || body?.message || `${response.status} ${response.statusText}`;
  const error = new Error(`Gemini API: ${message}`);
  error.status = response.status;
  error.body = body;
  return error;
}

export class GeminiRestClient {
  constructor({ apiKey, textModel = 'gemini-3.6-flash', imageModel = 'gemini-3.1-flash-image', timeoutMs = 180_000 }) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required for real Gemini calls.');
    this.apiKey = apiKey;
    this.textModel = textModel;
    this.imageModel = imageModel;
    this.timeoutMs = timeoutMs;
  }

  async #interaction(payload) {
    const response = await fetch(INTERACTIONS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw await readError(response);
    return response.json();
  }

  async uploadBook(filePath, displayName) {
    const bytes = await fs.readFile(filePath);
    const start = await fetch(FILES_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': this.apiKey,
        'content-type': 'application/json',
        'x-goog-upload-protocol': 'resumable',
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(bytes.length),
        'x-goog-upload-header-content-type': 'text/plain',
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!start.ok) throw await readError(start);
    const uploadUrl = start.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('Gemini Files API did not return a resumable upload URL.');

    const upload = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'content-length': String(bytes.length),
        'x-goog-upload-offset': '0',
        'x-goog-upload-command': 'upload, finalize',
      },
      body: bytes,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!upload.ok) throw await readError(upload);
    const result = await upload.json();
    const file = result.file ?? result;
    if (!file.uri) throw new Error('Gemini Files API upload succeeded without a file URI.');
    return { name: file.name ?? null, uri: file.uri, mimeType: file.mimeType ?? file.mime_type ?? 'text/plain' };
  }

  async createBookContext(fileUri, mimeType = 'text/plain') {
    return this.#interaction({
      model: this.textModel,
      input: [
        { type: 'text', text: "Here's a book to illustrate using Nano Banana. Don't say anything for now; instructions will follow." },
        { type: 'document', uri: fileUri, mime_type: mimeType },
      ],
    });
  }

  async defineStyle(previousId, customStyle = '') {
    const input = customStyle
      ? `The art style will be: "${customStyle}". Keep that in mind when generating future prompts. Keep quiet for now; instructions will follow.`
      : 'Define an art style that fits this story but has a distinctive twist. Return only the art-style prompt that should be added to future illustration prompts.';
    const interaction = await this.#interaction({ model: this.textModel, input, previous_interaction_id: previousId });
    return { interaction, style: customStyle || outputText(interaction).trim() };
  }

  async generateCharacters(previousId) {
    const schema = {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Adult character name' },
          prompt: { type: 'string', description: 'At least 50 words describing the adult character visually using details from the book' },
        },
        required: ['name', 'prompt'],
        additionalProperties: false,
      },
    };
    const interaction = await this.#interaction({
      model: this.textModel,
      input: 'Describe the main characters, adults only. Prepare a highly detailed image prompt for each using descriptions from the book. Each prompt must be at least 50 words. Return no more than 2 characters.',
      previous_interaction_id: previousId,
      response_format: { type: 'text', mime_type: 'application/json', schema },
    });
    const text = outputText(interaction);
    let characters;
    try { characters = JSON.parse(text); }
    catch { throw new Error(`Gemini returned invalid character JSON: ${text.slice(0, 300)}`); }
    if (!Array.isArray(characters)) throw new Error('Gemini character output was not an array.');
    return { interaction, characters: characters.slice(0, 2) };
  }

  async startImageContext(style) {
    return this.#interaction({
      model: this.imageModel,
      input: `You are going to generate portrait images for a book. Follow this style: ${style}. Rules: no text, no borders, no title, no cover layout, family-friendly, one full illustration only.`,
    });
  }

  async generatePortrait(previousId, character) {
    const interaction = await this.#interaction({
      model: this.imageModel,
      input: `Create a portrait illustration for ${character.name} following this description: ${character.prompt}`,
      previous_interaction_id: previousId,
      response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '9:16', image_size: '1K' },
    });
    const image = outputImage(interaction);
    if (!image) throw new Error(`Gemini returned no portrait image for ${character.name}.`);
    return { interaction, image };
  }

  async generateChapters(previousId) {
    const schema = {
      type: 'array',
      maxItems: 1,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Chapter name or concise chapter label' },
          prompt: { type: 'string', description: 'Single-scene illustration prompt that references named characters and their established descriptions' },
        },
        required: ['name', 'prompt'],
        additionalProperties: false,
      },
    };
    const interaction = await this.#interaction({
      model: this.textModel,
      input: 'For the book chapters, give a prompt to illustrate what happens. It must be a single image, not a multi-panel page. Be highly descriptive, name characters, and reuse their established character descriptions when they appear. Return no more than 1 chapter.',
      previous_interaction_id: previousId,
      response_format: { type: 'text', mime_type: 'application/json', schema },
    });
    const text = outputText(interaction);
    let chapters;
    try { chapters = JSON.parse(text); }
    catch { throw new Error(`Gemini returned invalid chapter JSON: ${text.slice(0, 300)}`); }
    if (!Array.isArray(chapters)) throw new Error('Gemini chapter output was not an array.');
    return { interaction, chapters: chapters.slice(0, 1) };
  }

  async startChapterImageContext(previousId) {
    return this.#interaction({
      model: this.imageModel,
      input: "Starting now, illustrate the book's chapters. Reuse the previously generated character appearances for consistency, while changing pose and composition as needed.",
      previous_interaction_id: previousId,
    });
  }

  async generateIllustration(previousId, chapter) {
    const interaction = await this.#interaction({
      model: this.imageModel,
      input: `Create a chapter illustration for ${chapter.name} using the previously generated characters and this description: ${chapter.prompt}`,
      previous_interaction_id: previousId,
      response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '16:9', image_size: '1K' },
    });
    const image = outputImage(interaction);
    if (!image) throw new Error(`Gemini returned no chapter illustration for ${chapter.name}.`);
    return { interaction, image };
  }
}

export class MockGeminiClient {
  constructor({ delayMs = 20 } = {}) {
    this.delayMs = delayMs;
    this.counter = 0;
    this.calls = [];
  }
  async #tick(type) { this.calls.push(type); await new Promise((r) => setTimeout(r, this.delayMs)); this.counter += 1; }
  async uploadBook() { await this.#tick('uploadBook'); return { name: 'files/mock-book', uri: 'mock://book', mimeType: 'text/plain' }; }
  async createBookContext() { await this.#tick('createBookContext'); return { id: `book-${this.counter}` }; }
  async defineStyle(_previous, custom = '') { await this.#tick('defineStyle'); return { interaction: { id: `style-${this.counter}` }, style: custom || 'Warm hand-painted watercolor with expressive ink outlines and cinematic light.' }; }
  async generateCharacters() { await this.#tick('generateCharacters'); return { interaction: { id: `characters-${this.counter}` }, characters: [
    { name: 'Mole', prompt: 'An adult anthropomorphic mole with velvety dark fur, a rounded face, small bright eyes, practical country clothes, gentle posture, and a curious expression. The portrait should feel grounded in a classic riverside storybook world, with tactile fabric, natural proportions, and soft directional light that preserves the established watercolor character design.' },
    { name: 'Rat', prompt: 'An adult anthropomorphic water rat with warm brown-grey fur, alert eyes, neat whiskers, a relaxed but capable stance, and tidy river-going clothes. He should appear confident and kind, with subtle signs of an outdoors life near boats and reeds, rendered consistently in the selected storybook watercolor style with natural light and detailed textures.' },
    { name: 'EXTRA', prompt: 'This third character proves the server-side cap is enforced.' },
  ] }; }
  async startImageContext() { await this.#tick('startImageContext'); return { id: `imagectx-${this.counter}` }; }
  async generatePortrait(_previous, character) { await this.#tick(`portrait:${character.name}`); return { interaction: { id: `portrait-${this.counter}` }, image: { data: tinyPngBase64, mime_type: 'image/png' } }; }
  async generateChapters() { await this.#tick('generateChapters'); return { interaction: { id: `chapters-${this.counter}` }, chapters: [
    { name: 'Chapter One', prompt: 'Mole and Rat meet beside the river in a sunlit single scene, preserving both established character designs and the watercolor style.' },
    { name: 'EXTRA', prompt: 'This second chapter proves the server-side cap is enforced.' },
  ] }; }
  async startChapterImageContext() { await this.#tick('startChapterImageContext'); return { id: `chapterctx-${this.counter}` }; }
  async generateIllustration() { await this.#tick('generateIllustration'); return { interaction: { id: `illustration-${this.counter}` }, image: { data: tinyPngBase64, mime_type: 'image/png' } }; }
}

const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2K3sAAAAASUVORK5CYII=';

export function makeGeminiFromEnv(env = process.env) {
  if (String(env.GEMINI_MOCK).toLowerCase() === 'true') return new MockGeminiClient({ delayMs: 700 });
  return new GeminiRestClient({
    apiKey: env.GEMINI_API_KEY,
    textModel: env.GEMINI_TEXT_MODEL || 'gemini-3.6-flash',
    imageModel: env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
  });
}
