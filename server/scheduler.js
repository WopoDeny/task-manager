import { EventEmitter } from 'node:events';
import { cleanupRun, executeCopy, readRunManifest } from './file-ops.js';
import { nextOccurrence, retentionDueAt } from './schedule.js';

function publicError(error) {
  return {
    code: error.code || (error.name === 'AbortError' ? 'CANCELLED' : 'EXECUTION_FAILED'),
    message: error.message || 'Execution failed.'
  };
}

export class Scheduler extends EventEmitter {
  constructor(store, options = {}) {
    super();
    this.store = store;
    this.intervalMs = options.intervalMs || 10_000;
    this.active = new Map();
    this.timer = null;
    this.ticking = false;
  }

  async start() {
    await this.reconcile();
    this.timer = setInterval(() => this.tick().catch(error => this.emit('error', error)), this.intervalMs);
    this.timer.unref?.();
    await this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async reconcile() {
    const interrupted = this.store.data.runs.filter(run => run.status === 'running' || run.status === 'queued');
    const manifests = new Map();
    for (const run of interrupted) {
      if (!run.destination) continue;
      const manifest = await readRunManifest(run.destination).catch(() => null);
      if (manifest?.application === 'Task Manager' && manifest?.runId === run.id && manifest?.taskId === run.taskId) {
        manifests.set(run.id, manifest);
      }
    }

    await this.store.mutate(data => {
      const now = new Date();
      for (const cleanup of data.cleanups) {
        if (cleanup.status === 'removing') {
          cleanup.status = 'pending';
          cleanup.dueAt = now.toISOString();
          cleanup.lastError = 'Cleanup was interrupted by a service restart.';
        }
      }
      for (const run of data.runs) {
        if (run.status === 'running' || run.status === 'queued') {
          const task = data.tasks.find(item => item.id === run.taskId);
          const manifest = manifests.get(run.id);
          if (manifest?.state === 'complete') {
            const finishedAt = manifest.completedAt || now.toISOString();
            run.status = manifest.missingSources?.length || manifest.skippedEntries
              ? 'completed_with_warnings'
              : 'completed';
            run.finishedAt = finishedAt;
            run.error = null;
            run.result = {
              destination: run.destination,
              copiedFiles: manifest.copiedFiles || 0,
              copiedBytes: manifest.copiedBytes || 0,
              missingSources: manifest.missingSources || [],
              skippedEntries: manifest.skippedEntries || 0,
              completedAt: finishedAt
            };
            run.progress = { ...run.progress, copiedFiles: manifest.copiedFiles || 0, copiedBytes: manifest.copiedBytes || 0, percent: 100 };
            if (task) {
              task.lastRunAt = finishedAt;
              task.lastResult = { status: run.status, message: null };
              if (run.trigger === 'scheduled') {
                task.nextRunAt = nextOccurrence(task.schedule, now)?.toISOString() || null;
                if (task.schedule.type === 'once' && !task.nextRunAt) task.enabled = false;
              }
            }
            if (task?.retention?.enabled && !data.cleanups.some(item => item.runId === run.id)) {
              data.cleanups.push({
                id: crypto.randomUUID(), runId: run.id, taskId: run.taskId, taskName: run.taskName,
                path: run.destination, dueAt: retentionDueAt(task.retention, new Date(finishedAt)).toISOString(),
                status: 'pending', attempts: 0, lastError: null
              });
            }
          } else {
            run.status = 'interrupted';
            run.finishedAt = now.toISOString();
            run.error = { code: 'SERVICE_RESTARTED', message: 'Service restarted during execution.' };
            if (run.destination && manifest && !data.cleanups.some(item => item.runId === run.id)) {
              data.cleanups.push({
                id: crypto.randomUUID(), runId: run.id, taskId: run.taskId, taskName: run.taskName,
                path: run.destination, dueAt: now.toISOString(), status: 'pending', attempts: 0,
                lastError: 'Removing an incomplete output before retry.'
              });
            }
          }
        }
      }
      for (const task of data.tasks) {
        if (task.enabled && !task.nextRunAt) {
          task.nextRunAt = nextOccurrence(task.schedule, now)?.toISOString() || null;
        }
      }
    });
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.processCleanups();
      const now = Date.now();
      const limit = this.store.data.settings.maxConcurrentRuns || 2;
      const due = this.store.data.tasks
        .filter(task => task.enabled && task.nextRunAt && new Date(task.nextRunAt).getTime() <= now)
        .filter(task => !this.active.has(task.id))
        .sort((a, b) => new Date(a.nextRunAt) - new Date(b.nextRunAt));

      for (const task of due) {
        if (this.active.size >= limit) break;
        await this.startTask(task.id, 'scheduled');
      }
    } finally {
      this.ticking = false;
    }
  }

  async startTask(taskId, trigger = 'manual') {
    const storedTask = this.store.data.tasks.find(item => item.id === taskId);
    if (!storedTask) {
      const error = new Error('Task not found.');
      error.statusCode = 404;
      throw error;
    }

    const task = structuredClone(storedTask);
    if (this.active.has(taskId)) {
      const error = new Error('This task is already running.');
      error.statusCode = 409;
      throw error;
    }
    const limit = this.store.data.settings.maxConcurrentRuns || 2;
    if (this.active.size >= limit) {
      const error = new Error('Execution limit reached. Try again when a running task finishes.');
      error.statusCode = 409;
      throw error;
    }

    const controller = new AbortController();
    const run = {
      id: crypto.randomUUID(),
      taskId,
      taskName: task.name,
      trigger,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      destination: null,
      progress: { copiedFiles: 0, copiedBytes: 0, totalFiles: 0, totalBytes: 0, percent: 0 },
      result: null,
      error: null
    };
    this.active.set(taskId, { controller, runId: run.id });
    try {
      await this.store.mutate(data => {
        data.runs.unshift(run);
        const historyLimit = data.settings.historyLimit || 500;
        data.runs = data.runs.slice(0, historyLimit);
      });
    } catch (error) {
      this.active.delete(taskId);
      throw error;
    }
    this.perform(task, run, controller).catch(error => this.emit('error', error));
    return structuredClone(run);
  }

  cancelTask(taskId) {
    const active = this.active.get(taskId);
    if (!active) {
      const error = new Error('Task is not currently running.');
      error.statusCode = 409;
      throw error;
    }
    active.controller.abort();
  }

  async perform(taskSnapshot, runSnapshot, controller) {
    let lastProgressSave = 0;
    let outcome;
    try {
      const result = await executeCopy(taskSnapshot, runSnapshot, {
        signal: controller.signal,
        onDestination: async destination => {
          await this.store.mutate(data => {
            const run = data.runs.find(item => item.id === runSnapshot.id);
            if (run) run.destination = destination;
          });
        },
        onProgress: progress => {
          const run = this.store.data.runs.find(item => item.id === runSnapshot.id);
          if (run) run.progress = progress;
          const now = Date.now();
          if (now - lastProgressSave > 2_000) {
            lastProgressSave = now;
            this.store.save().catch(error => this.emit('error', error));
          }
        }
      });
      outcome = {
        status: result.missingSources.length || result.skippedEntries ? 'completed_with_warnings' : 'completed',
        result
      };
    } catch (error) {
      outcome = {
        status: error.name === 'AbortError' ? 'cancelled' : 'failed',
        error: publicError(error),
        result: error.createdDestination
          ? { destination: error.createdDestination, ...(error.partial || {}), missingSources: error.missing || [] }
          : null
      };
    }

    const finishedAt = new Date();
    try {
      await this.store.mutate(data => {
        const run = data.runs.find(item => item.id === runSnapshot.id);
        if (run) {
          run.status = outcome.status;
          run.finishedAt = finishedAt.toISOString();
          run.result = outcome.result;
          run.error = outcome.error || null;
          run.destination = outcome.result?.destination || null;
          if (outcome.result) {
            run.progress = {
              ...run.progress,
              copiedFiles: outcome.result.copiedFiles ?? run.progress.copiedFiles,
              copiedBytes: outcome.result.copiedBytes ?? run.progress.copiedBytes,
              percent: outcome.status.startsWith('completed') ? 100 : run.progress.percent
            };
          }
        }

        const currentTask = data.tasks.find(item => item.id === taskSnapshot.id);
        if (currentTask) {
          currentTask.lastRunAt = finishedAt.toISOString();
          currentTask.lastResult = { status: outcome.status, message: outcome.error?.message || null };
          if (runSnapshot.trigger === 'scheduled' && currentTask.enabled) {
            currentTask.nextRunAt = nextOccurrence(currentTask.schedule, finishedAt)?.toISOString() || null;
            if (currentTask.schedule.type === 'once' && !currentTask.nextRunAt) currentTask.enabled = false;
          } else if (!currentTask.enabled) {
            currentTask.nextRunAt = null;
          }
        }

        const cleanupPath = outcome.result?.destination;
        const successful = outcome.status === 'completed' || outcome.status === 'completed_with_warnings';
        if (cleanupPath && (taskSnapshot.retention?.enabled || !successful)) {
          const dueAt = successful ? retentionDueAt(taskSnapshot.retention, finishedAt) : finishedAt;
          data.cleanups.push({
            id: crypto.randomUUID(),
            runId: runSnapshot.id,
            taskId: taskSnapshot.id,
            taskName: taskSnapshot.name,
            path: cleanupPath,
            dueAt: dueAt.toISOString(),
            status: 'pending',
            attempts: 0,
            lastError: null
          });
        }
      });
      this.emit('run-finished', { taskId: taskSnapshot.id, runId: runSnapshot.id, status: outcome.status });
    } finally {
      this.active.delete(taskSnapshot.id);
      setImmediate(() => this.tick().catch(error => this.emit('error', error)));
    }
  }

  async processCleanups() {
    const due = this.store.data.cleanups
      .filter(item => item.status === 'pending' && new Date(item.dueAt).getTime() <= Date.now())
      .slice(0, 3);
    for (const item of due) {
      item.status = 'removing';
      await this.store.save();
      try {
        await cleanupRun(item);
        await this.store.mutate(data => {
          const cleanup = data.cleanups.find(candidate => candidate.id === item.id);
          if (cleanup) {
            cleanup.status = 'completed';
            cleanup.completedAt = new Date().toISOString();
          }
        });
      } catch (error) {
        await this.store.mutate(data => {
          const cleanup = data.cleanups.find(candidate => candidate.id === item.id);
          if (!cleanup) return;
          cleanup.attempts += 1;
          cleanup.lastError = error.message;
          if (cleanup.attempts >= 5) {
            cleanup.status = 'failed';
          } else {
            cleanup.status = 'pending';
            cleanup.dueAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
          }
        });
      }
    }
  }

  status() {
    return {
      running: this.active.size,
      activeTaskIds: [...this.active.keys()]
    };
  }
}
