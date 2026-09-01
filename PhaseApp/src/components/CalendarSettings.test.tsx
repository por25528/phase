// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarStatus } from '../lib/calendarBridge';

/**
 * The way in that is not the devtools console.
 *
 * Two things this pins beyond "the buttons call the actions". First, that a
 * build shipping its own OAuth client never asks for one: the first thing a
 * user meets is Connect, and the credentials form is an advanced disclosure
 * they have to open. Second, that no secret is ever read back — the producer
 * only accepts one, so a field pre-filled with anything would be a fiction.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async () => ({ goals: [], habits: [], tasks: [], sessions: [], lives: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
  loadPlanMode: vi.fn(async () => 'week' as const),
  savePlanMode: vi.fn(async () => {}),
  loadGoalsMode: vi.fn(async (): Promise<'board' | 'timeline'> => 'board'),
  saveGoalsMode: vi.fn(async () => {}),
  loadCalendarIds: vi.fn(async () => ['primary']),
  saveCalendarIds: vi.fn(async (_ids: string[]) => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
  isSlotMigrationDone: vi.fn(async () => true),
  saveSlotMigrationSnapshot: vi.fn(async () => {}),
  loadSlotMigrationSnapshot: vi.fn(async () => null),
  markSlotMigrationDone: vi.fn(async () => {}),
  isCheckpointMigrationDone: vi.fn(async () => true),
  saveCheckpointMigrationSnapshot: vi.fn(async () => {}),
  loadCheckpointMigrationSnapshot: vi.fn(async () => null),
  markCheckpointMigrationDone: vi.fn(async () => {}),
  loadActiveFocusSession: vi.fn(async () => null),
  saveActiveFocusSession: vi.fn(async () => {}),
  loadAssistantAccelerator: vi.fn(async () => 'Command+Space'),
  saveAssistantAccelerator: vi.fn(async () => {}),
  loadStoredTimeLevel: vi.fn(async () => null),
  saveStoredTimeLevel: vi.fn(async () => {}),
  loadStoredFocusLevel: vi.fn(async () => null),
  saveStoredFocusLevel: vi.fn(async () => {}),
  loadCycleConfig: vi.fn(async () => ({ workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4 })),
  saveCycleConfig: vi.fn(async () => {}),
}));
vi.mock('../db/db', () => dbMocks);

const calendarCacheMocks = vi.hoisted(() => ({
  loadCalendarCache: vi.fn(async () => undefined),
  saveCalendarCache: vi.fn(async () => {}),
  clearCalendarCache: vi.fn(async () => {}),
}));
vi.mock('../db/calendarCache', () => calendarCacheMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

const CALENDARS = [
  { id: 'primary', summary: 'Me', primary: true },
  { id: 'work@example.com', summary: 'Work', primary: false },
];

/** The shipped-credentials happy path: nothing pasted, an account consented. */
const CONNECTED: CalendarStatus = {
  configured: true, connected: true, available: true, corrupt: false,
  managed: true, custom: false,
  accountId: 'me@example.com', timeZone: 'America/New_York',
};
/** Credentials shipped, nobody has consented yet. */
const MANAGED_IDLE: CalendarStatus = {
  ...CONNECTED, connected: false, accountId: null,
};
/** A build with no OAuth client of its own, and nothing saved. */
const UNCONFIGURED: CalendarStatus = {
  configured: false, connected: false, available: true, corrupt: false,
  managed: false, custom: false, accountId: null, timeZone: 'UTC',
};

function installBridge(over: Record<string, unknown> = {}) {
  const base = {
    status: vi.fn(async (): Promise<CalendarStatus> => CONNECTED),
    configure: vi.fn(async (_input: { clientId: string; clientSecret: string }) => {}),
    connect: vi.fn(async () => ({ ok: true as const })),
    disconnect: vi.fn(async () => {}),
    listCalendars: vi.fn(async () => CALENDARS),
    reset: vi.fn(async () => {}),
    fetch: vi.fn(async () => ({
      ok: true as const, blocks: [], fetchedAt: '2026-08-05T12:00:00.000Z',
      accountId: 'me@example.com', timeZone: 'America/New_York',
    })),
    ...over,
  };
  const bridge = { ...base } as typeof base;
  (globalThis as Record<string, unknown>).phaseCalendar = bridge;
  return bridge;
}

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

async function mount(over: Record<string, unknown> = {}) {
  vi.resetModules();
  const bridge = installBridge(over);
  const store = await import('../state/store');
  await store.initStore();
  const { CalendarSettings } = await import('./CalendarSettings');
  render(createElement(CalendarSettings));
  return { store, bridge, user: userEvent.setup() };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  delete (globalThis as Record<string, unknown>).phaseCalendar;
});

/** jsdom returns Element; the `checked` and `type` reads need the input type. */
function input(label: string | RegExp): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe('CalendarSettings', () => {
  it('says plainly that a browser cannot do this', async () => {
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).phaseCalendar;
    const store = await import('../state/store');
    await store.initStore();
    const { CalendarSettings } = await import('./CalendarSettings');
    render(createElement(CalendarSettings));

    expect(screen.getByText(/only.*desktop app/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /connect/i })).toBeNull();
  });

  // The whole reason this was worth reviving. A user of a build that ships its
  // own OAuth client must never be sent to the Google Cloud Console.
  it('offers Connect, and no credentials form, when the build ships a client', async () => {
    await mount({ status: vi.fn(async () => MANAGED_IDLE) });

    expect(screen.getByRole('button', { name: /connect google calendar/i })).toBeTruthy();
    expect(screen.queryByLabelText('Client ID')).toBeNull();
  });

  it('keeps the credentials form behind an advanced disclosure', async () => {
    const { user } = await mount({ status: vi.fn(async () => MANAGED_IDLE) });

    await user.click(screen.getByText(/use my own google oauth client/i));

    expect(screen.getByLabelText('Client ID')).toBeTruthy();
  });

  // A build with no client of its own has exactly one way in, so hiding it
  // behind a closed disclosure would be a dead end rather than restraint.
  it('opens the credentials form when there is no other way to connect', async () => {
    await mount({ status: vi.fn(async () => UNCONFIGURED) });

    expect(screen.getByLabelText('Client ID')).toBeTruthy();
    expect(screen.getByLabelText('Client secret')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /connect google calendar/i })).toBeNull();
  });

  // A desktop OAuth secret is not truly confidential, but it is still a
  // credential sitting on screen over someone's shoulder.
  it('masks the secret and offers to reveal it', async () => {
    const { user } = await mount({ status: vi.fn(async () => UNCONFIGURED) });

    expect(input('Client secret').type).toBe('password');
    await user.click(screen.getByRole('button', { name: /show secret/i }));
    expect(input('Client secret').type).toBe('text');
  });

  it('saves both credentials together', async () => {
    const { user, bridge } = await mount({ status: vi.fn(async () => UNCONFIGURED) });

    await user.type(screen.getByLabelText('Client ID'), 'id-123');
    await user.type(screen.getByLabelText('Client secret'), 'secret-456');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(bridge.configure).toHaveBeenCalledWith({ clientId: 'id-123', clientSecret: 'secret-456' });
  });

  // The discriminating test for the pair. Half a pair cannot authenticate, and
  // sending it would overwrite a working configuration with a broken one.
  it('will not save a half-filled pair', async () => {
    const { user, bridge } = await mount({ status: vi.fn(async () => UNCONFIGURED) });

    await user.type(screen.getByLabelText('Client ID'), 'id-123');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(bridge.configure).not.toHaveBeenCalled();
  });

  it('never reads a secret back into the field', async () => {
    const { user } = await mount({
      status: vi.fn(async () => ({ ...MANAGED_IDLE, custom: true })),
    });

    await user.click(screen.getByText(/use my own google oauth client/i));

    // Configured already, and the field is still empty: `status()` reports
    // that a client is saved and nothing more, so there is nothing to show.
    expect(input('Client ID').value).toBe('');
    expect(input('Client secret').value).toBe('');
  });

  it('offers a way back to the built-in client once a custom one is saved', async () => {
    const { user, bridge } = await mount({
      status: vi.fn(async () => ({ ...MANAGED_IDLE, custom: true })),
    });

    await user.click(screen.getByText(/use my own google oauth client/i));
    await user.click(screen.getByRole('button', { name: /use the built-in client/i }));

    expect(bridge.reset).toHaveBeenCalled();
  });

  it('offers no way back when the build has no client to go back to', async () => {
    const { user } = await mount({
      status: vi.fn(async () => ({ ...UNCONFIGURED, configured: true, custom: true })),
    });
    // The form is already open here; the disclosure summary is still present.
    await user.click(screen.getByText(/use my own google oauth client/i));

    expect(screen.queryByRole('button', { name: /use the built-in client/i })).toBeNull();
  });

  it('shows the connected account and offers to disconnect', async () => {
    await mount();

    expect(await screen.findByText('me@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('lists the calendars with the selected ones checked', async () => {
    await mount();

    await screen.findByLabelText('Work');
    expect(input('Me').checked).toBe(true);
    expect(input('Work').checked).toBe(false);
  });

  it('adds a calendar to the selection', async () => {
    const { user, store } = await mount();

    await user.click(await screen.findByLabelText('Work'));

    expect(store.getState().calendarIds).toEqual(['primary', 'work@example.com']);
  });

  /**
   * Unchecking the last calendar would fetch nothing, and nothing renders a
   * fully-booked week as a free one. The rule lives in `setCalendarIds` — but
   * a control that accepts a click and then springs back reads as a bug, so
   * the last one left is disabled and says why.
   */
  it('disables the last remaining calendar instead of letting it spring back', async () => {
    const { store } = await mount();

    const only = await screen.findByLabelText('Me');
    expect((only as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/at least one calendar/i)).toBeTruthy();
    expect(store.getState().calendarIds).toEqual(['primary']);
  });

  it('re-enables it as soon as a second calendar is chosen', async () => {
    const { user } = await mount();

    await user.click(await screen.findByLabelText('Work'));

    expect((screen.getByLabelText('Me') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText('Work') as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText(/at least one calendar/i)).toBeNull();
  });

  // The store's refusal is the rule; the disabled state is only how it is
  // explained. Both have to hold, or a keyboard route around the control
  // would empty the selection.
  it('still refuses an empty selection at the store', async () => {
    const { store } = await mount();
    await screen.findByLabelText('Work');

    store.actions.setCalendarIds([]);

    expect(store.getState().calendarIds).toEqual(['primary']);
  });

  it('refreshes on demand and says how old the data is', async () => {
    const { user, bridge } = await mount();
    await screen.findByLabelText('Work'); // let the picker settle first
    bridge.fetch.mockClear();

    expect(screen.getByText(/fetched|never fetched/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(bridge.fetch).toHaveBeenCalled();
  });

  it('offers a reset when the secret store cannot be decrypted', async () => {
    const { user, bridge } = await mount({
      status: vi.fn(async () => ({ ...UNCONFIGURED, corrupt: true, managed: true })),
    });

    await user.click(screen.getByRole('button', { name: /reset calendar setup/i }));

    expect(bridge.reset).toHaveBeenCalled();
  });

  it('warns when the OS keychain is unavailable', async () => {
    await mount({ status: vi.fn(async () => ({ ...MANAGED_IDLE, available: false })) });

    expect(screen.getByText(/keychain/i)).toBeTruthy();
  });

  it('says nothing about calendars it could not list', async () => {
    await mount({ listCalendars: vi.fn(async () => { throw new Error('offline'); }) });

    expect(await screen.findByText('me@example.com')).toBeTruthy();
    expect(screen.queryByLabelText('Work')).toBeNull();
  });
});
