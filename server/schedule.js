const MINUTE_MS = 60_000;

function parseTime(value = '09:00') {
  const [hour, minute] = String(value).split(':').map(Number);
  return {
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 9,
    minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0
  };
}

function atLocalTime(date, time) {
  const { hour, minute } = parseTime(time);
  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return result;
}

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function nextOccurrence(schedule, after = new Date()) {
  if (!schedule?.type) return null;
  const cursor = new Date(after.getTime() + 1_000);

  if (schedule.type === 'once') {
    const candidate = validDate(`${schedule.date}T${schedule.time || '09:00'}:00`);
    return candidate && candidate > cursor ? candidate : null;
  }

  if (schedule.type === 'daily') {
    let candidate = atLocalTime(cursor, schedule.time);
    if (candidate <= cursor) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }

  if (schedule.type === 'weekly') {
    const days = [...new Set((schedule.weekdays || []).map(Number))]
      .filter(day => day >= 0 && day <= 6);
    if (!days.length) return null;
    for (let offset = 0; offset <= 7; offset += 1) {
      const probe = new Date(cursor);
      probe.setDate(cursor.getDate() + offset);
      const candidate = atLocalTime(probe, schedule.time);
      if (days.includes(candidate.getDay()) && candidate > cursor) return candidate;
    }
    return null;
  }

  if (schedule.type === 'monthly') {
    const wantedDay = Math.min(31, Math.max(1, Number(schedule.dayOfMonth) || 1));
    for (let offset = 0; offset < 36; offset += 1) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + offset;
      const candidate = new Date(year, month, wantedDay);
      if (candidate.getDate() !== wantedDay) continue;
      const timed = atLocalTime(candidate, schedule.time);
      if (timed > cursor) return timed;
    }
    return null;
  }

  if (schedule.type === 'interval') {
    const amount = Math.max(1, Number(schedule.intervalValue) || 1);
    const anchor = validDate(schedule.anchorAt) || cursor;
    if (anchor > cursor) return anchor;
    if (schedule.intervalUnit === 'hours') {
      const intervalMs = amount * 60 * MINUTE_MS;
      const steps = Math.floor((cursor.getTime() - anchor.getTime()) / intervalMs) + 1;
      return new Date(anchor.getTime() + steps * intervalMs);
    }

    const approximateSteps = Math.max(0, Math.floor((cursor.getTime() - anchor.getTime()) / (amount * 24 * 60 * MINUTE_MS)));
    const candidate = new Date(anchor);
    candidate.setDate(candidate.getDate() + approximateSteps * amount);
    while (candidate <= cursor) candidate.setDate(candidate.getDate() + amount);
    return candidate;
  }

  return null;
}

export function retentionDueAt(retention, completedAt = new Date()) {
  if (!retention?.enabled) return null;
  const value = Math.max(1, Number(retention.value) || 1);
  const multipliers = { hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 };
  return new Date(completedAt.getTime() + value * (multipliers[retention.unit] || multipliers.days));
}
