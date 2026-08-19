import path from 'node:path';
import { nextOccurrence } from './schedule.js';

function cleanString(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

export function normalizeTask(input, existing = null) {
  const now = new Date().toISOString();
  const task = {
    id: existing?.id || crypto.randomUUID(),
    name: cleanString(input.name, 100),
    enabled: input.enabled !== false,
    sources: Array.isArray(input.sources)
      ? input.sources.map(item => ({ path: cleanString(item?.path ?? item, 1_000) })).filter(item => item.path)
      : [],
    destination: {
      path: cleanString(input.destination?.path, 1_000)
    },
    schedule: normalizeSchedule(input.schedule),
    retention: {
      enabled: input.retention?.enabled !== false,
      value: Math.max(1, Math.min(365, Number(input.retention?.value) || 2)),
      unit: ['hours', 'days', 'weeks'].includes(input.retention?.unit) ? input.retention.unit : 'days'
    },
    options: {
      requireAllSources: input.options?.requireAllSources !== false,
      includeHidden: input.options?.includeHidden !== false,
      preserveTimestamps: input.options?.preserveTimestamps !== false,
      verifyAfterCopy: input.options?.verifyAfterCopy !== false
    },
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastRunAt: existing?.lastRunAt || null,
    lastResult: existing?.lastResult || null,
    nextRunAt: null
  };

  const sourceInputs = Array.isArray(input.sources) ? input.sources : [];
  const lengthErrors = [];
  if (String(input.name || '').trim().length > 100) lengthErrors.push('Task name cannot exceed 100 characters.');
  if (sourceInputs.some(item => String(item?.path ?? item ?? '').trim().length > 1_000)) {
    lengthErrors.push('Source paths cannot exceed 1,000 characters.');
  }
  if (String(input.destination?.path || '').trim().length > 1_000) {
    lengthErrors.push('Destination path cannot exceed 1,000 characters.');
  }

  const errors = [...lengthErrors, ...validateTask(task)];
  if (errors.length) {
    const error = new Error(errors.join(' '));
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  if (task.enabled) task.nextRunAt = nextOccurrence(task.schedule, new Date())?.toISOString() || null;
  return task;
}

function normalizeSchedule(schedule = {}) {
  const type = ['once', 'daily', 'weekly', 'monthly', 'interval'].includes(schedule.type)
    ? schedule.type
    : 'weekly';
  const result = {
    type,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time || '') ? schedule.time : '10:00'
  };
  if (type === 'once') result.date = cleanString(schedule.date, 10);
  if (type === 'weekly') {
    result.weekdays = [...new Set((schedule.weekdays || [1]).map(Number))]
      .filter(day => day >= 0 && day <= 6)
      .sort();
  }
  if (type === 'monthly') result.dayOfMonth = Math.max(1, Math.min(31, Number(schedule.dayOfMonth) || 1));
  if (type === 'interval') {
    result.intervalValue = Math.max(1, Math.min(365, Number(schedule.intervalValue) || 1));
    result.intervalUnit = schedule.intervalUnit === 'hours' ? 'hours' : 'days';
    result.anchorAt = schedule.anchorAt || new Date().toISOString();
  }
  return result;
}

export function validateTask(task) {
  const errors = [];
  if (!task.name) errors.push('Task name is required.');
  if (!task.sources.length) errors.push('Add at least one source folder.');
  if (task.sources.length > 50) errors.push('A task can contain up to 50 source folders.');
  if (!task.destination.path) errors.push('Destination path is required.');
  if (task.schedule.type === 'once') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(task.schedule.date || '');
    if (!match) {
      errors.push('Select a valid execution date.');
    } else {
      const [hour, minute] = task.schedule.time.split(':').map(Number);
      const candidate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, 0, 0);
      const exact = candidate.getFullYear() === Number(match[1])
        && candidate.getMonth() === Number(match[2]) - 1
        && candidate.getDate() === Number(match[3]);
      if (!exact) errors.push('Select a real calendar date.');
      else if (task.enabled && candidate.getTime() <= Date.now()) errors.push('A one-time execution must be scheduled in the future.');
    }
  }
  if (task.schedule.type === 'weekly' && !task.schedule.weekdays.length) errors.push('Select at least one weekday.');
  const unique = new Set(task.sources.map(source => normalizeComparable(source.path)));
  if (unique.size !== task.sources.length) errors.push('Source paths must be unique.');
  if (task.destination.path && task.sources.length) {
    try {
      assertSafeDestination(task.destination.path, task.sources);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors;
}

export function expandPath(value) {
  let result = String(value || '').trim();
  result = result.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
  result = result.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || '${' + name + '}');
  return path.resolve(result);
}

export function normalizeComparable(value) {
  const expanded = expandPath(value);
  return process.platform === 'win32' ? expanded.toLowerCase() : expanded;
}

export function pathsOverlap(first, second) {
  const a = normalizeComparable(first);
  const b = normalizeComparable(second);
  if (a === b) return true;
  const separator = path.sep;
  return a.startsWith(`${b}${separator}`) || b.startsWith(`${a}${separator}`);
}

export function assertSafeDestination(destination, sources = []) {
  const resolved = expandPath(destination);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    const error = new Error('Destination must be a folder below a drive or network-share root.');
    error.code = 'UNSAFE_DESTINATION';
    throw error;
  }
  for (const source of sources) {
    if (pathsOverlap(source.path ?? source, resolved)) {
      const error = new Error('Destination cannot overlap a source folder.');
      error.code = 'PATH_OVERLAP';
      throw error;
    }
  }
  return resolved;
}
