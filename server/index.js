import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './store.js';
import { Scheduler } from './scheduler.js';
import { inspectPath } from './file-ops.js';
import { nextOccurrence } from './schedule.js';
import { normalizeTask } from './validation.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = process.env.TASK_MANAGER_DATA_DIR
  ? path.resolve(process.env.TASK_MANAGER_DATA_DIR)
  : path.join(projectRoot, 'data');
const port = Number(process.env.TASK_MANAGER_PORT) || 3707;
const host = process.env.TASK_MANAGER_HOST || '0.0.0.0';
const app = express();
const execFileAsync = promisify(execFile);
const store = new JsonStore(path.join(dataDirectory, 'store.json'));
await store.load();

async function ensureAccessKey() {
  const keyPath = path.join(dataDirectory, 'access-key.txt');
  try {
    return (await fs.readFile(keyPath, 'utf8')).trim();
  } catch {
    const key = randomBytes(9).toString('base64url').toUpperCase();
    await fs.mkdir(dataDirectory, { recursive: true });
    await fs.writeFile(keyPath, `${key}\n`, { encoding: 'utf8', mode: 0o600 });
    return key;
  }
}

const accessKey = await ensureAccessKey();
const scheduler = new Scheduler(store);
scheduler.on('error', error => console.error(`[scheduler] ${error.stack || error.message}`));

function isLoopback(req) {
  const address = req.socket.remoteAddress || '';
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

function isHostRequest(req) {
  if (isLoopback(req)) return true;
  const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return Object.values(os.networkInterfaces()).some(interfaces =>
    (interfaces || []).some(item => item.address === address)
  );
}

function requireAccess(req, res, next) {
  if (isLoopback(req) || req.get('x-task-manager-key') === accessKey) return next();
  return res.status(401).json({ error: { code: 'ACCESS_REQUIRED', message: 'Enter the server access key.' } });
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function networkAddresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(`http://${item.address}:${port}`);
    }
  }
  return addresses;
}

async function selectFolderOnHost() {
  if (process.platform !== 'win32') {
    const error = new Error('The native folder picker is available on Windows hosts.');
    error.code = 'FOLDER_PICKER_UNAVAILABLE';
    error.statusCode = 501;
    throw error;
  }

  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Select a folder for Task Manager'",
    '$dialog.ShowNewFolderButton = $true',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  $bytes = [System.Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath)',
    '  [Console]::Out.Write([Convert]::ToBase64String($bytes))',
    '}'
  ].join('\n');

  let stdout;
  try {
    ({ stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10 * 60 * 1_000,
      maxBuffer: 1024 * 1024
    }));
  } catch (cause) {
    const error = new Error(cause.killed ? 'Folder selection timed out.' : 'Could not open the native folder picker.');
    error.code = 'FOLDER_PICKER_FAILED';
    error.statusCode = 500;
    throw error;
  }
  const encodedPath = stdout.trim();
  return encodedPath ? Buffer.from(encodedPath, 'base64').toString('utf8') : null;
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/api/public/status', (req, res) => {
  res.json({
    name: 'Task Manager',
    authenticated: isLoopback(req) || req.get('x-task-manager-key') === accessKey
  });
});

app.post('/api/public/auth', (req, res) => {
  const valid = req.body?.key === accessKey;
  res.status(valid ? 200 : 401).json({ valid });
});

app.use('/api', requireAccess);

app.get('/api/dashboard', (req, res) => {
  const snapshot = store.snapshot();
  const schedulerStatus = scheduler.status();
  const enabled = snapshot.tasks.filter(task => task.enabled);
  const nextTask = enabled
    .filter(task => task.nextRunAt)
    .sort((a, b) => new Date(a.nextRunAt) - new Date(b.nextRunAt))[0] || null;
  res.json({
    stats: {
      totalTasks: snapshot.tasks.length,
      activeTasks: enabled.length,
      running: schedulerStatus.running,
      pendingCleanups: snapshot.cleanups.filter(item => item.status === 'pending').length,
      failures: snapshot.runs.slice(0, 20).filter(run => run.status === 'failed').length
    },
    nextTask,
    tasks: snapshot.tasks,
    recentRuns: snapshot.runs.slice(0, 8),
    runningTaskIds: schedulerStatus.activeTaskIds
  });
});

app.get('/api/tasks', (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  const tasks = store.snapshot().tasks
    .filter(task => !query || [task.name, task.destination.path, ...task.sources.map(source => source.path)]
      .some(value => String(value).toLowerCase().includes(query)));
  res.json({ tasks, runningTaskIds: scheduler.status().activeTaskIds });
});

app.post('/api/tasks', asyncRoute(async (req, res) => {
  const task = normalizeTask(req.body);
  await store.mutate(data => data.tasks.unshift(task));
  res.status(201).json({ task });
}));

app.put('/api/tasks/:id', asyncRoute(async (req, res) => {
  const existing = store.data.tasks.find(task => task.id === req.params.id);
  if (!existing) return res.status(404).json({ error: { message: 'Task not found.' } });
  if (scheduler.status().activeTaskIds.includes(existing.id)) {
    return res.status(409).json({ error: { message: 'A running task cannot be edited.' } });
  }
  const updated = normalizeTask(req.body, existing);
  await store.mutate(data => {
    const index = data.tasks.findIndex(task => task.id === existing.id);
    data.tasks[index] = updated;
  });
  return res.json({ task: updated });
}));

app.delete('/api/tasks/:id', asyncRoute(async (req, res) => {
  if (scheduler.status().activeTaskIds.includes(req.params.id)) {
    return res.status(409).json({ error: { message: 'Stop the running task before deleting it.' } });
  }
  let removed = false;
  await store.mutate(data => {
    const before = data.tasks.length;
    data.tasks = data.tasks.filter(task => task.id !== req.params.id);
    removed = data.tasks.length !== before;
  });
  return removed ? res.status(204).end() : res.status(404).json({ error: { message: 'Task not found.' } });
}));

app.post('/api/tasks/:id/toggle', asyncRoute(async (req, res) => {
  const existing = store.data.tasks.find(item => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: { message: 'Task not found.' } });

  const enabling = !existing.enabled;
  const nextRun = enabling ? nextOccurrence(existing.schedule, new Date()) : null;
  if (enabling && !nextRun) {
    return res.status(400).json({
      error: { code: 'SCHEDULE_EXPIRED', message: 'This one-time schedule has expired. Edit the execution date before enabling it.' }
    });
  }

  let task = null;
  await store.mutate(data => {
    task = data.tasks.find(item => item.id === req.params.id);
    if (!task) return;
    task.enabled = enabling;
    task.updatedAt = new Date().toISOString();
    task.nextRunAt = nextRun?.toISOString() || null;
  });
  return res.json({ task });
}));

app.post('/api/tasks/:id/run', asyncRoute(async (req, res) => {
  const run = await scheduler.startTask(req.params.id, 'manual');
  res.status(202).json({ run });
}));

app.post('/api/tasks/:id/cancel', (req, res, next) => {
  try {
    scheduler.cancelTask(req.params.id);
    res.status(202).json({ cancelling: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/paths/inspect', asyncRoute(async (req, res) => {
  const paths = Array.isArray(req.body?.paths) ? req.body.paths.slice(0, 50) : [];
  const results = await Promise.all(paths.map(value => inspectPath(value)));
  res.json({ results });
}));

app.post('/api/paths/select-folder', asyncRoute(async (req, res) => {
  if (!isHostRequest(req)) {
    return res.status(409).json({
      error: { code: 'HOST_ONLY_PICKER', message: 'Open Task Manager on the server computer to use the native folder picker.' }
    });
  }
  const selectedPath = await selectFolderOnHost();
  return res.json({ path: selectedPath, cancelled: !selectedPath });
}));

app.get('/api/runs', (req, res) => {
  const taskId = String(req.query.taskId || '');
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const runs = store.snapshot().runs.filter(run => !taskId || run.taskId === taskId).slice(0, limit);
  res.json({ runs });
});

app.get('/api/cleanups', (req, res) => {
  res.json({ cleanups: store.snapshot().cleanups.slice().reverse() });
});

const distDirectory = path.join(projectRoot, 'dist');
app.use(express.static(distDirectory, { index: false, maxAge: '1h' }));
app.use(asyncRoute(async (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: { message: 'Endpoint not found.' } });
  res.sendFile(path.join(distDirectory, 'index.html'));
}));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.statusCode || 500;
  if (status >= 500) console.error(error.stack || error);
  return res.status(status).json({
    error: {
      code: error.code || 'REQUEST_FAILED',
      message: error.message || 'Request failed.',
      details: error.details || null
    }
  });
});

await fs.mkdir(dataDirectory, { recursive: true });
const pidPath = path.join(dataDirectory, 'server.pid');

async function removeOwnPid() {
  try {
    const recordedPid = Number((await fs.readFile(pidPath, 'utf8')).trim());
    if (recordedPid === process.pid) await fs.rm(pidPath, { force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`Could not remove the PID file: ${error.message}`);
  }
}

const server = app.listen(port, host, async () => {
  try {
    await fs.writeFile(pidPath, `${process.pid}\n`, 'utf8');
    console.log(`Task Manager is running at http://127.0.0.1:${port}`);
    for (const url of networkAddresses()) console.log(`Local network: ${url}`);
    console.log(`Access key: ${accessKey}`);
    await scheduler.start();
  } catch (error) {
    console.error(error.stack || error.message);
    await removeOwnPid();
    server.close(() => process.exit(1));
  }
});

server.on('error', error => {
  console.error(`Task Manager could not start: ${error.message}`);
  process.exit(1);
});

async function shutdown() {
  scheduler.stop();
  server.close();
  await store.save().catch(() => {});
  await removeOwnPid();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
