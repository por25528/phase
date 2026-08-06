// The two Google Calendar endpoints this feature reads. No normalization
// happens here — busyBlocks.cjs owns every minute of arithmetic.

const { addDays } = require('./busyBlocks.cjs');

const CALENDAR_LIST_ENDPOINT = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars';

// Calendar ids contain '@' and, for holiday calendars, '#'. An unencoded '#'
// truncates the URL at the fragment and silently queries the wrong calendar.
function EVENTS_ENDPOINT(calendarId) {
  return `${EVENTS_BASE}/${encodeURIComponent(calendarId)}/events`;
}

const QUERY_MARGIN_DAYS = 1;
const MAX_PAGES = 20;
const PAGE_SIZE = 2500; // Google's maximum for events.list

function createGoogleClient(deps) {
  const { httpGet, getAccessToken } = deps;

  function fail(res) {
    const message = res.json?.error?.message || res.json?.error_description || `HTTP ${res.status}`;
    return new Error(`Google Calendar request failed: ${message}`);
  }

  /** Walk `nextPageToken` and concatenate `items`. Any failed page throws. */
  async function pages(buildUrl, accessToken) {
    const out = [];
    let pageToken;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await httpGet(buildUrl(pageToken), accessToken);
      if (!res.ok) throw fail(res);
      out.push(...(res.json.items || []));
      pageToken = res.json.nextPageToken;
      if (!pageToken) return out;
    }
    // A server repeating the same token would otherwise spin forever inside
    // the main process, which has no other thread to notice.
    throw new Error('Google Calendar returned too many pages; giving up');
  }

  async function listCalendars() {
    const accessToken = await getAccessToken();
    const items = await pages((pageToken) => {
      const q = new URLSearchParams({ maxResults: '250' });
      if (pageToken) q.set('pageToken', pageToken);
      return `${CALENDAR_LIST_ENDPOINT}?${q.toString()}`;
    }, accessToken);
    return items.map((c) => ({ id: c.id, summary: c.summary, primary: c.primary === true }));
  }

  async function fetchEvents({ rangeStart, rangeEnd, calendarIds }) {
    if (calendarIds.length === 0) return [];
    const accessToken = await getAccessToken();

    // A one-day margin at UTC midnight, so normalizeEvents can clip by LOCAL
    // date without any zone arithmetic reaching this layer. See the plan's
    // "one arithmetic decision".
    const timeMin = `${addDays(rangeStart, -QUERY_MARGIN_DAYS)}T00:00:00Z`;
    const timeMax = `${addDays(rangeEnd, QUERY_MARGIN_DAYS)}T00:00:00Z`;

    const out = [];
    for (const calendarId of calendarIds) {
      // Sequential rather than parallel: any failure must abort the whole
      // fetch anyway, and a burst of parallel requests only makes it likelier.
      const items = await pages((pageToken) => {
        const q = new URLSearchParams({
          timeMin,
          timeMax,
          // Google expands recurrences server-side, so no RRULE, EXDATE or
          // VTIMEZONE parsing ever enters this codebase.
          singleEvents: 'true',
          maxResults: String(PAGE_SIZE),
        });
        if (pageToken) q.set('pageToken', pageToken);
        return `${EVENTS_ENDPOINT(calendarId)}?${q.toString()}`;
      }, accessToken);
      out.push(...items);
    }
    return out;
  }

  return { listCalendars, fetchEvents };
}

module.exports = {
  CALENDAR_LIST_ENDPOINT, EVENTS_ENDPOINT, QUERY_MARGIN_DAYS, MAX_PAGES, createGoogleClient,
};
