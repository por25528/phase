// Google events -> BusyBlock[]. Pure: no I/O, no clock, no network.
//
// This is a main-process module rather than a src/lib one because the seam
// says `src/` never sees Google JSON. It is nonetheless fully unit-tested
// offline; see busyBlocks.test.ts. Its contract lives in busyBlocks.d.cts.

/**
 * True when an event must not consume any time.
 *
 * All-day events are deliberately NOT skipped: they are always cached, and
 * the `allDayBlocks` preference is applied at read time in capacity.ts, so
 * toggling it never requires a refetch.
 */
function shouldSkipEvent(event) {
  if (event.status === 'cancelled') return true;
  if (event.transparency === 'transparent') return true;
  const attendees = event.attendees || [];
  // `self` matters: without it, a colleague declining would delete the
  // meeting from YOUR capacity.
  return attendees.some((a) => a.self === true && a.responseStatus === 'declined');
}

const MINUTES_PER_DAY = 1440;
const DEFAULT_TITLE = 'Busy';

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' + n days, without touching the machine timezone. */
function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

/**
 * An RFC3339 instant read as wall-clock in `timeZone`.
 *
 * `hourCycle: 'h23'` is load-bearing: without it V8 formats local midnight as
 * hour "24", which would place a midnight event at minute 1440 of the previous
 * day instead of minute 0 of the correct one.
 */
function zonedParts(iso, timeZone) {
  const at = new Date(iso);
  const parts = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (const p of fmt.formatToParts(at)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function expandToLocalDays(event, timeZone) {
  const start = event.start || {};
  const end = event.end || {};
  const title = event.summary || DEFAULT_TITLE;

  if (start.date && end.date) {
    // Google's all-day end.date is EXCLUSIVE.
    const out = [];
    for (let d = start.date; d < end.date; d = addDays(d, 1)) {
      out.push({ date: d, startMin: 0, endMin: MINUTES_PER_DAY, title, allDay: true });
    }
    return out;
  }

  if (!start.dateTime || !end.dateTime) return [];

  const from = zonedParts(start.dateTime, timeZone);
  const to = zonedParts(end.dateTime, timeZone);
  const out = [];
  for (let d = from.date; d <= to.date; d = addDays(d, 1)) {
    const startMin = d === from.date ? from.minute : 0;
    const endMin = d === to.date ? to.minute : MINUTES_PER_DAY;
    // An event ending exactly at midnight lands here with 0..0 on the day
    // after it really occupied. BusyBlock requires endMin > startMin, and a
    // zero-width block would confuse assignLanes' clustering.
    if (endMin > startMin) out.push({ date: d, startMin, endMin, title, allDay: false });
  }
  return out;
}

module.exports = { shouldSkipEvent, expandToLocalDays };
