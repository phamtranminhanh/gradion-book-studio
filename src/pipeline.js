export class PipelineRunner {
  constructor({ store, state, gemini }) {
    this.store = store;
    this.state = state;
    this.gemini = gemini;
  }

  async run(projectId, stepKey, options = {}) {
    try {
      if (stepKey === 'STYLE') await this.#style(projectId, options.style ?? '');
      else if (stepKey === 'CHARACTERS') await this.#characters(projectId);
      else if (stepKey === 'PORTRAITS') await this.#portraits(projectId);
      else if (stepKey === 'CHAPTERS') await this.#chapters(projectId);
      else if (stepKey === 'ILLUSTRATIONS') await this.#illustrations(projectId);
      else throw new Error(`Unknown pipeline step ${stepKey}`);
      await this.state.finish(projectId, stepKey);
    } catch (error) {
      await this.state.fail(projectId, stepKey, error);
    }
  }

  async #style(projectId, customStyle) {
    let project = await this.store.getProject(projectId);
    if (!project.gemini.fileUri) {
      const uploaded = await this.gemini.uploadBook(this.store.bookPath(projectId), `${project.title}.txt`);
      await this.store.withProject(projectId, (draft) => {
        draft.gemini.fileName = uploaded.name;
        draft.gemini.fileUri = uploaded.uri;
      });
      project = await this.store.getProject(projectId);
    }

    if (!project.gemini.bookInteractionId) {
      const bookInteraction = await this.gemini.createBookContext(project.gemini.fileUri, 'text/plain');
      await this.store.withProject(projectId, (draft) => { draft.gemini.bookInteractionId = bookInteraction.id; });
      project = await this.store.getProject(projectId);
    }

    const { interaction, style } = await this.gemini.defineStyle(project.gemini.bookInteractionId, customStyle);
    if (!style) throw new Error('Style generation returned an empty style.');
    await this.store.withProject(projectId, (draft) => {
      draft.style = style;
      draft.gemini.styleInteractionId = interaction.id;
    });
  }

  async #characters(projectId) {
    const project = await this.store.getProject(projectId);
    if (!project.gemini.styleInteractionId) throw new Error('Missing style interaction context.');
    const { interaction, characters } = await this.gemini.generateCharacters(project.gemini.styleInteractionId);
    const capped = characters.slice(0, 2).map((character) => ({
      name: String(character.name ?? '').trim(),
      prompt: String(character.prompt ?? '').trim(),
      portraitUrl: null,
    })).filter((character) => character.name && character.prompt);
    if (!capped.length) throw new Error('Gemini returned no usable adult characters.');
    await this.store.withProject(projectId, (draft) => {
      draft.characters = capped;
      draft.gemini.characterInteractionId = interaction.id;
    });
  }

  async #portraits(projectId) {
    let project = await this.store.getProject(projectId);
    if (!project.characters.length) throw new Error('No characters are available for portrait generation.');

    if (!project.gemini.imageInteractionId) {
      const context = await this.gemini.startImageContext(project.style);
      await this.store.withProject(projectId, (draft) => { draft.gemini.imageInteractionId = context.id; });
      project = await this.store.getProject(projectId);
    }

    for (let index = 0; index < Math.min(project.characters.length, 2); index++) {
      project = await this.store.getProject(projectId);
      if (project.characters[index]?.portraitUrl) continue;
      const { interaction, image } = await this.gemini.generatePortrait(project.gemini.imageInteractionId, project.characters[index]);
      const bytes = Buffer.from(image.data, 'base64');
      const url = await this.store.writeImage(projectId, 'portraits', index, bytes, image.mime_type ?? image.mimeType ?? 'image/png');
      await this.store.withProject(projectId, (draft) => {
        draft.characters[index].portraitUrl = url;
        draft.gemini.imageInteractionId = interaction.id;
      });
    }
  }

  async #chapters(projectId) {
    const project = await this.store.getProject(projectId);
    if (!project.gemini.characterInteractionId) throw new Error('Missing character text interaction context.');
    const { interaction, chapters } = await this.gemini.generateChapters(project.gemini.characterInteractionId);
    const capped = chapters.slice(0, 1).map((chapter) => ({
      name: String(chapter.name ?? '').trim(),
      prompt: String(chapter.prompt ?? '').trim(),
      illustrationUrl: null,
    })).filter((chapter) => chapter.name && chapter.prompt);
    if (!capped.length) throw new Error('Gemini returned no usable chapter prompt.');
    await this.store.withProject(projectId, (draft) => {
      draft.chapters = capped;
      draft.gemini.chapterInteractionId = interaction.id;
    });
  }

  async #illustrations(projectId) {
    let project = await this.store.getProject(projectId);
    if (!project.chapters.length) throw new Error('No chapter prompt is available for illustration generation.');
    if (!project.gemini.imageInteractionId) throw new Error('Missing image interaction context from portrait generation.');

    if (!project.gemini.chapterImageContextStarted) {
      const context = await this.gemini.startChapterImageContext(project.gemini.imageInteractionId);
      await this.store.withProject(projectId, (draft) => {
        draft.gemini.imageInteractionId = context.id;
        draft.gemini.chapterImageContextStarted = true;
      });
      project = await this.store.getProject(projectId);
    }

    for (let index = 0; index < Math.min(project.chapters.length, 1); index++) {
      project = await this.store.getProject(projectId);
      if (project.chapters[index]?.illustrationUrl) continue;
      const { interaction, image } = await this.gemini.generateIllustration(project.gemini.imageInteractionId, project.chapters[index]);
      const bytes = Buffer.from(image.data, 'base64');
      const url = await this.store.writeImage(projectId, 'illustrations', index, bytes, image.mime_type ?? image.mimeType ?? 'image/png');
      await this.store.withProject(projectId, (draft) => {
        draft.chapters[index].illustrationUrl = url;
        draft.gemini.imageInteractionId = interaction.id;
      });
    }
  }
}
