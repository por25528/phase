import { describe, it, expect } from 'vitest';
import {
  createGoogleClient, CALENDAR_LIST_ENDPOINT, EVENTS_ENDPOINT, MAX_PAGES,
  type GoogleClientDeps,
} from './googleClient.cjs';

type Reply = { ok?: boolean; status?: number; json: Record<string, unknown> };

/** Replies are keyed by a substring of the URL, so a test says what it means. */
function client(replies: Array<[string, Reply]>, over: Partial<GoogleClientDeps> = {}) {
  const urls: string[] = [];
  const tokens: string[] = [];
  const deps: GoogleClientDeps = {
    getAccessToken: async () => 'ACCESS',
    httpGet: async (url, accessToken) => {
      urls.push(url);
      tokens.push(accessToken);
      const hit = replies.find(([needle]) => url.includes(needle));
      if (!hit) throw new Error(`no fake reply matches ${url}`);
      return { ok: hit[1].ok ?? true, status: hit[1].status ?? 200, json: hit[1].json };
    },
    ...over,
  };
  return { api: createGoogleClient(deps), urls, tokens };
}

const RANGE = { rangeStart: '2026-08-03', rangeEnd: '2026-08-10', calendarIds: ['primary'] };
const ev = (id: string) => ({ id, status: 'confirmed', summary: id });

describe('listCalendars', () => {
  it('returns id, summary and primary', async () => {
    const { api } = client([[CALENDAR_LIST_ENDPOINT, { json: { items: [
      { id: 'me@example.com', summary: 'Me', primary: true },
      { id: 'team@group.calendar.google.com', summary: 'Team' },
    ] } }]]);
    expect(await api.listCalendars()).toEqual([
      { id: 'me@example.com', summary: 'Me', primary: true },
      { id: 'team@group.calendar.google.com', summary: 'Team', primary: false },
    ]);
  });

  it('follows pagination', async () => {
    let call = 0;
    const { api } = client([[CALENDAR_LIST_ENDPOINT, { json: {} }]], {
      httpGet: async () => {
        call += 1;
        return call === 1
          ? { ok: true, status: 200, json: { items: [{ id: 'a', summary: 'A' }], nextPageToken: 'p2' } }
          : { ok: true, status: 200, json: { items: [{ id: 'b', summary: 'B' }] } };
      },
    });
    expect((await api.listCalendars()).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('sends the access token as a bearer header, never in the URL', async () => {
    const { api, urls, tokens } = client([[CALENDAR_LIST_ENDPOINT, { json: { items: [] } }]]);
    await api.listCalendars();
    expect(tokens[0]).toBe('ACCESS');
    expect(urls[0]).not.toContain('ACCESS');
  });

  it('throws on a failed response rather than returning an empty list', async () => {
    const { api } = client([[CALENDAR_LIST_ENDPOINT, { ok: false, status: 403, json: { error: { message: 'Forbidden' } } }]]);
    await expect(api.listCalendars()).rejects.toThrow(/Forbidden|403/);
  });
});

describe('fetchEvents', () => {
  it('expands recurrences server-side, so no RRULE parsing is ever needed here', async () => {
    const { api, urls } = client([['/events', { json: { items: [ev('a')] } }]]);
    await api.fetchEvents(RANGE);
    expect(new URL(urls[0]).searchParams.get('singleEvents')).toBe('true');
  });

  // The margin is what lets normalizeEvents clip by LOCAL date without this
  // layer doing any zone arithmetic. One day each side is provably enough:
  // the largest real UTC offset is ±14h.
  it('widens the query by one day on each side, at UTC midnight', async () => {
    const { api, urls } = client([['/events', { json: { items: [] } }]]);
    await api.fetchEvents(RANGE);
    const q = new URL(urls[0]).searchParams;
    expect(q.get('timeMin')).toBe('2026-08-02T00:00:00Z');
    expect(q.get('timeMax')).toBe('2026-08-11T00:00:00Z');
  });

  it('queries every selected calendar', async () => {
    const { api, urls } = client([['/events', { json: { items: [] } }]]);
    await api.fetchEvents({ ...RANGE, calendarIds: ['primary', 'team@group.calendar.google.com'] });
    expect(urls).toHaveLength(2);
    expect(urls.join(' ')).toContain('primary');
  });

  // Holiday calendar ids contain '#', which truncates a URL if not encoded.
  it('percent-encodes the calendar id', async () => {
    const { api, urls } = client([['/events', { json: { items: [] } }]]);
    await api.fetchEvents({ ...RANGE, calendarIds: ['en.usa#holiday@group.v.calendar.google.com'] });
    expect(urls[0]).toContain('en.usa%23holiday%40group.v.calendar.google.com');
    expect(urls[0]).not.toContain('#holiday');
  });

  it('follows pagination within one calendar', async () => {
    let call = 0;
    const { api } = client([['/events', { json: {} }]], {
      httpGet: async () => {
        call += 1;
        return call === 1
          ? { ok: true, status: 200, json: { items: [ev('a')], nextPageToken: 'p2' } }
          : { ok: true, status: 200, json: { items: [ev('b')] } };
      },
    });
    expect((await api.fetchEvents(RANGE)).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('concatenates events across calendars', async () => {
    let call = 0;
    const { api } = client([['/events', { json: {} }]], {
      httpGet: async () => {
        call += 1;
        return { ok: true, status: 200, json: { items: [ev(`cal${call}`)] } };
      },
    });
    const out = await api.fetchEvents({ ...RANGE, calendarIds: ['a', 'b'] });
    expect(out.map((e) => e.id)).toEqual(['cal1', 'cal2']);
  });

  // THE critical rule. A partial result renders the missing calendar's
  // meetings as free time — silently wrong in the direction that causes
  // over-commitment.
  it('discards everything when any calendar fails', async () => {
    let call = 0;
    const { api } = client([['/events', { json: {} }]], {
      httpGet: async () => {
        call += 1;
        return call === 1
          ? { ok: true, status: 200, json: { items: [ev('from-the-good-calendar')] } }
          : { ok: false, status: 500, json: { error: { message: 'Backend error' } } };
      },
    });
    await expect(api.fetchEvents({ ...RANGE, calendarIds: ['a', 'b'] })).rejects.toThrow(/Backend error|500/);
  });

  it('discards everything when a later page fails', async () => {
    let call = 0;
    const { api } = client([['/events', { json: {} }]], {
      httpGet: async () => {
        call += 1;
        return call === 1
          ? { ok: true, status: 200, json: { items: [ev('page1')], nextPageToken: 'p2' } }
          : { ok: false, status: 503, json: { error: { message: 'Unavailable' } } };
      },
    });
    await expect(api.fetchEvents(RANGE)).rejects.toThrow(/Unavailable|503/);
  });

  it('propagates a token failure without calling Google', async () => {
    const { api, urls } = client([['/events', { json: { items: [] } }]], {
      getAccessToken: async () => { throw new Error('NotConnected'); },
    });
    await expect(api.fetchEvents(RANGE)).rejects.toThrow(/NotConnected/);
    expect(urls).toHaveLength(0);
  });

  it('returns an empty array for no calendars, without calling Google', async () => {
    const { api, urls } = client([['/events', { json: { items: [] } }]]);
    expect(await api.fetchEvents({ ...RANGE, calendarIds: [] })).toEqual([]);
    expect(urls).toHaveLength(0);
  });

  // A server that keeps returning the same page token would otherwise loop
  // forever inside the main process.
  it('gives up rather than paging forever', async () => {
    const { api, urls } = client([['/events', { json: {} }]], {
      httpGet: async () => ({ ok: true, status: 200, json: { items: [ev('x')], nextPageToken: 'always-the-same' } }),
    });
    await expect(api.fetchEvents(RANGE)).rejects.toThrow(/too many pages/i);
    expect(urls.length).toBeLessThanOrEqual(MAX_PAGES);
  });

  it('targets the documented events endpoint', async () => {
    const { api, urls } = client([['/events', { json: { items: [] } }]]);
    await api.fetchEvents(RANGE);
    expect(urls[0].startsWith(EVENTS_ENDPOINT('primary'))).toBe(true);
  });
});
