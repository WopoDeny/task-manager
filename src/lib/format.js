export function formatDate(value, includeTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', includeTime
    ? { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: '2-digit' }).format(date);
}

export function formatRelative(value) {
  if (!value) return 'Not scheduled';
  const diff = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diff)) return 'Not scheduled';
  const abs = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60_000) return formatter.format(Math.round(diff / 1_000), 'second');
  if (abs < 3_600_000) return formatter.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return formatter.format(Math.round(diff / 3_600_000), 'hour');
  return formatter.format(Math.round(diff / 86_400_000), 'day');
}

export function formatBytes(value = 0) {
  const bytes = Number(value) || 0;
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const number = bytes / 1024 ** index;
  return `${number.toFixed(index > 1 && number < 10 ? 1 : 0)} ${units[index]}`;
}

export function scheduleText(schedule = {}) {
  const time = schedule.time || '09:00';
  if (schedule.type === 'once') return `${schedule.date} · ${time}`;
  if (schedule.type === 'daily') return `Daily · ${time}`;
  if (schedule.type === 'weekly') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${(schedule.weekdays || []).map(day => days[day]).join(', ')} · ${time}`;
  }
  if (schedule.type === 'monthly') return `Day ${schedule.dayOfMonth} · ${time}`;
  if (schedule.type === 'interval') return `Every ${schedule.intervalValue} ${schedule.intervalUnit}`;
  return 'Not scheduled';
}

export function statusLabel(status) {
  return ({
    active: 'Active',
    paused: 'Paused',
    idle: 'Idle',
    completed: 'Completed',
    completed_with_warnings: 'Completed with warnings',
    running: 'Running',
    queued: 'Queued',
    failed: 'Failed',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted',
    pending: 'Pending',
    removing: 'Removing'
  })[status] || status || 'Unknown';
}
