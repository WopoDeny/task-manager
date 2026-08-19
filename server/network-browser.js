import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const DEFAULT_NETWORK_ROOT = String.raw`\\192.168.33.27`;
const serverShareCache = new Map();

function requestError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export function normalizeNetworkPath(value) {
  const raw = String(value || '').trim().replaceAll('/', '\\');
  if (!raw.startsWith('\\\\') || raw.includes('\0')) return null;

  const segments = raw.slice(2).split('\\').filter(Boolean);
  if (!segments.length) return null;
  if (segments.length === 1) return `\\\\${segments[0]}`;

  const normalized = path.win32.normalize(`\\\\${segments.join('\\')}`).replace(/\\+$/, '');
  return normalized.startsWith('\\\\') ? normalized : null;
}

export function parseNetworkRoots(value = '') {
  const configured = String(value || DEFAULT_NETWORK_ROOT)
    .split(';')
    .map(normalizeNetworkPath)
    .filter(Boolean);
  return [...new Map(configured.map(root => [root.toLowerCase(), root])).values()]
    .sort((left, right) => right.length - left.length);
}

function rootForPath(candidate, roots) {
  const lower = candidate.toLowerCase();
  return roots.find(root => lower === root.toLowerCase() || lower.startsWith(`${root.toLowerCase()}\\`)) || null;
}

function parentWithinRoot(candidate, root) {
  if (candidate.toLowerCase() === root.toLowerCase()) return null;
  const separator = candidate.lastIndexOf('\\');
  if (separator <= root.length) return root;
  const parent = candidate.slice(0, separator);
  return rootForPath(parent, [root]) ? parent : root;
}

function isServerNamespace(value) {
  return value.slice(2).split('\\').filter(Boolean).length === 1;
}

function folderName(value) {
  const segments = value.slice(2).split('\\').filter(Boolean);
  return segments.at(-1) || value;
}

function mapNetworkError(cause) {
  if (cause?.code === 'NETWORK_BROWSE_TIMEOUT') return cause;
  if (cause?.code === 'EACCES' || cause?.code === 'EPERM') {
    return requestError('NETWORK_ACCESS_DENIED', 'Access to this network folder was denied. Check the Windows account permissions.', 403);
  }
  if (cause?.code === 'ENOENT' || cause?.code === 'ENOTDIR') {
    return requestError('NETWORK_PATH_NOT_FOUND', 'The network folder does not exist or is not available yet.', 404);
  }
  return requestError('NETWORK_PATH_UNAVAILABLE', 'The network folder could not be opened. Check the server, share name, and connection.', 502);
}

async function withTimeout(promise, timeoutMs = 15_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(requestError(
          'NETWORK_BROWSE_TIMEOUT',
          'The network folder did not respond in time.',
          504
        )), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function listServerShares(serverPath) {
  if (process.platform !== 'win32') {
    throw requestError('NETWORK_BROWSER_UNAVAILABLE', 'Network share discovery is available on Windows hosts.', 501);
  }

  const script = [
    '$shell = New-Object -ComObject Shell.Application',
    '$folder = $shell.NameSpace($env:TASK_MANAGER_NETWORK_PATH)',
    "if (-not $folder) { throw 'Network location unavailable.' }",
    '$items = @($folder.Items() | Where-Object { $_.IsFolder } | ForEach-Object {',
    '  [PSCustomObject]@{ name = $_.Name; path = $_.Path }',
    '})',
    '$json = ConvertTo-Json -InputObject $items -Compress -Depth 3',
    '$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)',
    '[Console]::Out.Write([Convert]::ToBase64String($bytes))'
  ].join('\n');

  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, TASK_MANAGER_NETWORK_PATH: serverPath }
    });
    const decoded = stdout.trim()
      ? Buffer.from(stdout.trim(), 'base64').toString('utf8')
      : '[]';
    const items = JSON.parse(decoded);
    return (Array.isArray(items) ? items : [items])
      .map(item => ({ name: String(item?.name || ''), path: normalizeNetworkPath(item?.path) }))
      .filter(item => item.name && item.path);
  } catch (cause) {
    if (cause?.code === 'NETWORK_BROWSER_UNAVAILABLE') throw cause;
    throw mapNetworkError(cause);
  }
}

function listServerSharesCached(serverPath) {
  const key = serverPath.toLowerCase();
  const cached = serverShareCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = listServerShares(serverPath);
  const entry = { expiresAt: Date.now() + 30_000, promise };
  serverShareCache.set(key, entry);
  promise.catch(() => {
    if (serverShareCache.get(key) === entry) serverShareCache.delete(key);
  });
  return promise;
}

async function listFolders(currentPath) {
  if (isServerNamespace(currentPath)) return listServerSharesCached(currentPath);

  try {
    const entries = await withTimeout(fs.readdir(currentPath, { withFileTypes: true }));
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => ({ name: entry.name, path: path.win32.join(currentPath, entry.name) }));
  } catch (cause) {
    throw mapNetworkError(cause);
  }
}

export function createNetworkBrowser(configuredRoots = '') {
  const roots = parseNetworkRoots(configuredRoots);
  if (!roots.length) throw new Error('TASK_MANAGER_NETWORK_ROOTS must contain at least one UNC network path.');

  return {
    roots: [...roots],
    async browse(value) {
      const requested = String(value || '').trim();
      if (!requested) {
        return {
          path: null,
          parent: null,
          selectable: false,
          roots: [...roots],
          folders: roots.map(root => ({ name: folderName(root), path: root }))
        };
      }

      const currentPath = normalizeNetworkPath(requested);
      const root = currentPath && rootForPath(currentPath, roots);
      if (!currentPath || !root) {
        throw requestError(
          'NETWORK_PATH_NOT_ALLOWED',
          `Select a folder inside ${roots.join(' or ')}.`,
          403
        );
      }

      const folders = (await listFolders(currentPath))
        .filter(item => rootForPath(item.path, roots))
        .sort((left, right) => left.name.localeCompare(right.name, 'en', { numeric: true, sensitivity: 'base' }))
        .slice(0, 1_000);

      return {
        path: currentPath,
        parent: parentWithinRoot(currentPath, root),
        selectable: !isServerNamespace(currentPath),
        roots: [...roots],
        folders
      };
    }
  };
}
