import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { assertSafeDestination, expandPath } from './validation.js';

export const MANIFEST_NAME = '.task-manager-manifest.json';

function abortIfNeeded(signal) {
  if (signal?.aborted) {
    const error = new Error('Execution cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function inspectSource(sourcePath, options, signal) {
  const root = expandPath(sourcePath);
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) {
    const error = new Error(`Source is not a folder: ${sourcePath}`);
    error.code = 'SOURCE_NOT_DIRECTORY';
    throw error;
  }

  const directories = [''];
  const files = [];
  const stack = [''];
  let totalBytes = 0;
  let skippedEntries = 0;
  const canonicalRoot = await fs.realpath(root);

  while (stack.length) {
    abortIfNeeded(signal);
    const relativeDirectory = stack.pop();
    const current = path.join(root, relativeDirectory);
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      abortIfNeeded(signal);
      if (!options.includeHidden && entry.name.startsWith('.')) continue;
      const relative = path.join(relativeDirectory, entry.name);
      const absolute = path.join(root, relative);
      if (entry.isSymbolicLink()) {
        skippedEntries += 1;
        continue;
      }
      if (entry.isDirectory()) {
        directories.push(relative);
        stack.push(relative);
      } else if (entry.isFile()) {
        const stat = await fs.stat(absolute);
        files.push({ relative, absolute, size: stat.size, mtime: stat.mtime, atime: stat.atime });
        totalBytes += stat.size;
      } else {
        skippedEntries += 1;
      }
    }
  }

  return { root, canonicalRoot, directories, files, totalBytes, skippedEntries };
}

async function mapPool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function readManifest(destination) {
  try {
    return JSON.parse(await fs.readFile(path.join(destination, MANIFEST_NAME), 'utf8'));
  } catch {
    return null;
  }
}

export async function readRunManifest(destination) {
  return readManifest(expandPath(destination));
}

async function writeManifest(destination, manifest) {
  await fs.writeFile(path.join(destination, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export async function inspectPath(targetPath) {
  const input = String(targetPath || '').trim();
  const resolvedPath = expandPath(targetPath);
  try {
    const stat = await fs.stat(resolvedPath);
    const [readable, writable] = await Promise.all([
      fs.access(resolvedPath, constants.R_OK).then(() => true).catch(() => false),
      fs.access(resolvedPath, constants.W_OK).then(() => true).catch(() => false)
    ]);
    const type = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    const empty = type === 'directory' && readable
      ? await fs.readdir(resolvedPath).then(entries => entries.length === 0).catch(() => null)
      : null;
    return {
      input,
      path: resolvedPath,
      exists: true,
      type,
      readable,
      writable,
      empty
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { input, path: resolvedPath, exists: false, type: null, readable: null, writable: null, empty: null };
    return { input, path: resolvedPath, exists: null, type: null, readable: null, writable: null, empty: null, error: error.message };
  }
}

async function canonicalizeFuturePath(target) {
  let cursor = target;
  const missingSegments = [];
  while (true) {
    try {
      const existing = await fs.realpath(cursor);
      return path.resolve(existing, ...missingSegments);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return target;
      missingSegments.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function relativeKey(relative) {
  const normalized = relative.split(path.sep).join('/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function buildMergedPlan(sources, destination) {
  const entries = new Map();
  const directories = new Set();
  const files = [];

  const conflict = relative => {
    const error = new Error(`Source contents conflict at: ${relative}`);
    error.code = 'SOURCE_CONTENT_CONFLICT';
    error.relativePath = relative;
    throw error;
  };

  // The manifest is the ownership marker used by recovery and cleanup.
  // Source content must never be allowed to occupy its reserved path.
  entries.set(relativeKey(MANIFEST_NAME), 'reserved');

  for (const source of sources) {
    for (const relative of source.directories) {
      if (!relative) continue;
      const key = relativeKey(relative);
      if (entries.has(key) && entries.get(key) !== 'directory') conflict(relative);
      entries.set(key, 'directory');
      directories.add(relative);
    }
    for (const file of source.files) {
      const key = relativeKey(file.relative);
      if (entries.has(key)) conflict(file.relative);
      entries.set(key, 'file');
      files.push({ ...file, target: path.join(destination, file.relative) });
    }
  }

  return { directories: [...directories], files };
}

export async function analyzeTask(task, signal) {
  const destination = assertSafeDestination(task.destination.path, task.sources);
  const sources = [];
  const missing = [];
  for (const source of task.sources) {
    abortIfNeeded(signal);
    if (!(await exists(expandPath(source.path)))) {
      missing.push(source.path);
      continue;
    }
    sources.push(await inspectSource(source.path, task.options, signal));
  }
  return {
    destination,
    sources,
    missing,
    totalFiles: sources.reduce((sum, source) => sum + source.files.length, 0),
    totalBytes: sources.reduce((sum, source) => sum + source.totalBytes, 0),
    skippedEntries: sources.reduce((sum, source) => sum + source.skippedEntries, 0)
  };
}

export async function executeCopy(task, run, hooks = {}) {
  const { signal, onProgress = () => {}, onDestination = async () => {} } = hooks;
  const analysis = await analyzeTask(task, signal);

  if (analysis.missing.length && task.options.requireAllSources) {
    const error = new Error(`Required source folders are missing: ${analysis.missing.join(', ')}`);
    error.code = 'MISSING_SOURCES';
    error.missing = analysis.missing;
    throw error;
  }
  if (!analysis.sources.length) {
    const error = new Error('No source folders are available.');
    error.code = 'NO_AVAILABLE_SOURCES';
    throw error;
  }

  const destination = analysis.destination;
  assertSafeDestination(destination, task.sources);
  const canonicalDestination = await canonicalizeFuturePath(destination);
  assertSafeDestination(canonicalDestination, analysis.sources.map(source => source.canonicalRoot));
  const copyPlan = buildMergedPlan(analysis.sources, destination);
  const destinationExists = await exists(destination);
  if (destinationExists) {
    const manifest = await readManifest(destination);
    if (manifest) {
      const error = new Error('Destination is still owned by an earlier run. Wait for cleanup or choose another path.');
      error.code = 'DESTINATION_IN_USE';
      throw error;
    }
    const stat = await fs.stat(destination);
    if (!stat.isDirectory()) {
      const error = new Error('Destination exists and is not a folder.');
      error.code = 'DESTINATION_NOT_DIRECTORY';
      throw error;
    }
    if ((await fs.readdir(destination)).length) {
      const error = new Error('Destination folder must be empty before Task Manager can use it.');
      error.code = 'DESTINATION_NOT_EMPTY';
      throw error;
    }
  }

  const manifest = {
    schema: 1,
    application: 'Task Manager',
    taskId: task.id,
    taskName: task.name,
    runId: run.id,
    createdAt: new Date().toISOString(),
    state: 'copying',
    sources: task.sources.map(source => source.path)
  };

  let copiedFiles = 0;
  let copiedBytes = 0;
<<<<<<< HEAD
  let lastProgressAt = 0;
=======
>>>>>>> e220cd92a887785ca256ee9274737d0262f84aec
  let destinationCreated = false;
  let ownershipWritten = false;

  try {
    if (!destinationExists) {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.mkdir(destination);
      destinationCreated = true;
    }
    await writeManifest(destination, manifest);
    ownershipWritten = true;
    await onDestination(destination);
    for (const directory of copyPlan.directories) {
      abortIfNeeded(signal);
      await fs.mkdir(path.join(destination, directory), { recursive: true });
    }

    await mapPool(copyPlan.files, 4, async file => {
      abortIfNeeded(signal);
      await fs.copyFile(file.absolute, file.target, constants.COPYFILE_EXCL);
      if (task.options.preserveTimestamps) await fs.utimes(file.target, file.atime, file.mtime);
      if (task.options.verifyAfterCopy) {
        const targetStat = await fs.stat(file.target);
        if (targetStat.size !== file.size) {
          const error = new Error(`Copy verification failed: ${file.relative}`);
          error.code = 'VERIFY_FAILED';
          throw error;
        }
      }
      copiedFiles += 1;
      copiedBytes += file.size;
<<<<<<< HEAD
      const progressAt = Date.now();
      if (progressAt - lastProgressAt >= 100 || copiedFiles === analysis.totalFiles) {
        lastProgressAt = progressAt;
        onProgress({
          copiedFiles,
          copiedBytes,
          totalFiles: analysis.totalFiles,
          totalBytes: analysis.totalBytes,
          percent: analysis.totalBytes
            ? Math.min(100, Math.round((copiedBytes / analysis.totalBytes) * 100))
            : Math.min(100, Math.round((copiedFiles / Math.max(1, analysis.totalFiles)) * 100))
        });
      }
=======
      onProgress({
        copiedFiles,
        copiedBytes,
        totalFiles: analysis.totalFiles,
        totalBytes: analysis.totalBytes,
        percent: analysis.totalBytes
          ? Math.min(100, Math.round((copiedBytes / analysis.totalBytes) * 100))
          : Math.min(100, Math.round((copiedFiles / Math.max(1, analysis.totalFiles)) * 100))
      });
>>>>>>> e220cd92a887785ca256ee9274737d0262f84aec
    });

    const completedAt = new Date().toISOString();
    await writeManifest(destination, {
      ...manifest,
      state: 'complete',
      completedAt,
      copiedFiles,
      copiedBytes,
      missingSources: analysis.missing,
      skippedEntries: analysis.skippedEntries
    });
    return {
      destination,
      copiedFiles,
      copiedBytes,
      missingSources: analysis.missing,
      skippedEntries: analysis.skippedEntries,
      completedAt
    };
  } catch (error) {
    if (ownershipWritten) {
      await writeManifest(destination, {
        ...manifest,
        state: error.name === 'AbortError' ? 'cancelled' : 'failed',
        stoppedAt: new Date().toISOString(),
        copiedFiles,
        copiedBytes,
        error: error.message
      }).catch(() => {});
      error.createdDestination = destination;
      error.partial = { copiedFiles, copiedBytes };
    } else if (destinationCreated) {
      await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
    } else if (error.code === 'EEXIST') {
      const conflict = new Error('Destination was created by another process before execution could start.');
      conflict.code = 'DESTINATION_EXISTS';
      throw conflict;
    }
    throw error;
  }
}

export async function cleanupRun(cleanup) {
  const target = expandPath(cleanup.path);
  if (!(await exists(target))) return { removed: false, reason: 'already_missing' };
  assertSafeDestination(target, []);
  const manifest = await readManifest(target);
  if (!manifest || manifest.application !== 'Task Manager') {
    const error = new Error('Cleanup refused: ownership marker is missing.');
    error.code = 'CLEANUP_OWNERSHIP_MISMATCH';
    throw error;
  }
  if (manifest.runId !== cleanup.runId || manifest.taskId !== cleanup.taskId) {
    const error = new Error('Cleanup refused: ownership marker does not match this run.');
    error.code = 'CLEANUP_OWNERSHIP_MISMATCH';
    throw error;
  }
  await fs.rm(target, { recursive: true, force: false, maxRetries: 2, retryDelay: 250 });
  return { removed: true };
}
