import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY_STORE = {
  version: 1,
  tasks: [],
  runs: [],
  cleanups: [],
  settings: {
    maxConcurrentRuns: 2,
    historyLimit: 500
  }
};

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = structuredClone(EMPTY_STORE);
    this.writeQueue = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = {
        ...structuredClone(EMPTY_STORE),
        ...parsed,
        settings: { ...EMPTY_STORE.settings, ...(parsed.settings || {}) },
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
        cleanups: Array.isArray(parsed.cleanups) ? parsed.cleanups : []
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        const damaged = `${this.filePath}.damaged-${Date.now()}`;
        await fs.rename(this.filePath, damaged).catch(() => {});
      }
      await this.save();
    }
    return this.data;
  }

  snapshot() {
    return structuredClone(this.data);
  }

  async mutate(mutator) {
    const result = await mutator(this.data);
    await this.save();
    return result;
  }

  async save() {
    this.writeQueue = this.writeQueue.then(async () => {
      const temp = `${this.filePath}.tmp`;
      const body = `${JSON.stringify(this.data, null, 2)}\n`;
      await fs.writeFile(temp, body, 'utf8');
      await fs.rename(temp, this.filePath);
    });
    return this.writeQueue;
  }
}
