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
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
 * An explicit hour cycle is load-bearing: `en-US` defaults to `h12`, so omitting
 * the hour option formats local midnight as hour "12" (minute 720). `h23`
 * additionally pins away from `h24`, which would format midnight as hour "24"
 * (minute 1440 of the wrong day). On Node 26 / ICU 78, `hour12: false` already
 * resolves to `h23`, so only omitting the option reproduces the failure locally.
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

function expandToLocalDays(event, timeZone, bounds) {
  const start = event.start || {};
  const end = event.end || {};
  const title = event.summary || DEFAULT_TITLE;

  if (start.date && end.date) {
    // Google's all-day end.date is EXCLUSIVE.
    if (!LOCAL_DATE_RE.test(start.date)) {
      throw new RangeError(`Invalid all-day start.date: ${start.date}`);
    }
    if (!LOCAL_DATE_RE.test(end.date)) {
      throw new RangeError(`Invalid all-day end.date: ${end.date}`);
    }
    if (end.date < start.date) {
      throw new RangeError(`All-day end.date precedes start.date: ${end.date}`);
    }
    const firstDate = bounds && bounds.rangeStart > start.date ? bounds.rangeStart : start.date;
    const endDate = bounds && bounds.rangeEnd < end.date ? bounds.rangeEnd : end.date;
    const out = [];
    for (let d = firstDate; d < endDate; d = addDays(d, 1)) {
      out.push({ date: d, startMin: 0, endMin: MINUTES_PER_DAY, title, allDay: true });
    }
    return out;
  }

  if (!start.dateTime || !end.dateTime) return [];

  const from = zonedParts(start.dateTime, timeZone);
  const to = zonedParts(end.dateTime, timeZone);
  const firstDate = bounds && bounds.rangeStart > from.date ? bounds.rangeStart : from.date;
  // Compare against the inclusive local end date before adding one day: an
  // event ending on 9999-12-31 would otherwise produce year 10000, which is
  // outside the fixed-width ISO date ordering used by the range bounds.
  const endDate = bounds
    ? (bounds.rangeEnd <= to.date ? bounds.rangeEnd : addDays(to.date, 1))
    : to.date;
  const out = [];
  for (let d = firstDate; bounds ? d < endDate : d <= endDate; d = addDays(d, 1)) {
    const startMin = d === from.date ? from.minute : 0;
    const endMin = d === to.date ? to.minute : MINUTES_PER_DAY;
    // An event ending exactly at midnight lands here with 0..0 on the day
    // after it really occupied. BusyBlock requires endMin > startMin, and a
    // zero-width block would confuse assignLanes' clustering.
    if (endMin > startMin) out.push({ date: d, startMin, endMin, title, allDay: false });
  }
  return out;
}

/**
 * Fold a date-and-allDay group into disjoint blocks.
 *
 * Strictly `<`, not `<=`: back-to-back meetings touch but do not overlap, and
 * fusing them would invent a single block the user never scheduled while
 * changing no capacity figure.
 */
function mergeGroup(blocks) {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out = [];
  for (const block of sorted) {
    const last = out[out.length - 1];
    if (last && block.startMin < last.endMin) {
      last.endMin = Math.max(last.endMin, block.endMin);
      last.title = `${last.title}, ${block.title}`;
    } else {
      out.push({ ...block });
    }
  }
  return out;
}

function normalizeEvents(events, options) {
  const { rangeStart, rangeEnd, timeZone } = options;
  const groups = new Map();

  for (const event of events) {
    if (shouldSkipEvent(event)) continue;
    // Expansion is already bounded to avoid allocating out-of-range days;
    // retain this cheap guard as a defense if that implementation ever drifts.
    for (const block of expandToLocalDays(event, timeZone, { rangeStart, rangeEnd })) {
      // ISO dates compare correctly as strings. rangeEnd is EXCLUSIVE.
      if (block.date < rangeStart || block.date >= rangeEnd) continue;
      const key = `${block.date}:${block.allDay}`;
      const list = groups.get(key);
      if (list) list.push(block);
      else groups.set(key, [block]);
    }
  }

  const out = [];
  for (const group of groups.values()) out.push(...mergeGroup(group));
  return out.sort(
    (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin),
  );
}

module.exports = { addDays, shouldSkipEvent, expandToLocalDays, normalizeEvents };
