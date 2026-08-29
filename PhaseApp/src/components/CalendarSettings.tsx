import { useEffect, useState } from 'react';
import { useAppStore } from '../state/store';
import { calendarBridge, type CalendarSummary } from '../lib/calendarBridge';
import { fieldCls, labelCls, rowBtn, secondaryBtn } from './dialogStyles';

/**
 * "3 minutes ago" is prettier; an absolute local time is unambiguous, and this
 * line sits beside the button that acts on it.
 */
function fetchedLabel(iso: string | null): string {
  if (!iso) return 'never fetched';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'never fetched';
  return `fetched ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * Google Calendar: connect, choose calendars, refresh.
 *
 * It lives in Settings for the reason the dialog's own comment gives — this is
 * provider-style configuration, reached deliberately, not routine editing.
 *
 * The shape of this surface is one decision. When the build ships its own
 * OAuth client the FIRST thing here is a Connect button: a user should never
 * be sent to the Google Cloud Console to recreate something the app already
 * has, which is the setup burden that shelved this feature in the first place.
 * A user's own client is still reachable, as an advanced disclosure — and that
 * disclosure opens by default only when there is no shipped client, because a
 * build with no other way in would otherwise present a dead end.
 *
 * No secret is ever read back. `configure` accepts a client id and secret;
 * `status()` reports only whether one is saved, so the fields start empty
 * every time rather than pretending to show a value they cannot know.
 */
export function CalendarSettings() {
  const {
    calendarStatus, calendarIds, calendarFetchedAt, actions,
  } = useAppStore();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [revealSecret, setRevealSecret] = useState(false);
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const connected = !!calendarStatus?.connected;

  useEffect(() => {
    if (!connected) { setCalendars([]); return; }
    const bridge = calendarBridge();
    if (!bridge) return;
    let live = true;
    void bridge.listCalendars()
      .then((list) => { if (live) setCalendars(list); })
      // A picker that cannot be loaded shows nothing rather than a broken
      // list: the connection itself is still good, and the selection already
      // stored keeps working.
      .catch(() => { if (live) setCalendars([]); });
    return () => { live = false; };
  }, [connected]);

  if (!calendarStatus) {
    return (
      <p className="text-ui text-muted leading-[1.5]">
        Google Calendar is only available in the desktop app.
      </p>
    );
  }

  const { available, corrupt, configured, managed, custom } = calendarStatus;

  async function save() {
    // Both or neither: a half-filled pair cannot authenticate, and sending it
    // would overwrite a working configuration with a broken one.
    if (!clientId.trim() || !clientSecret.trim()) return;
    setBusy(true);
    const ok = await actions.configureCalendar(clientId.trim(), clientSecret.trim());
    setBusy(false);
    if (ok) { setClientId(''); setClientSecret(''); setRevealSecret(false); }
  }

  function toggleCalendar(id: string, on: boolean) {
    // No guard against emptying the selection here, deliberately:
    // `setCalendarIds` refuses one, and the rule — that fetching zero
    // calendars returns zero blocks, which renders a booked week as a free one
    // — belongs where every caller meets it rather than restated per surface.
    // What this surface owns is EXPLAINING it, which the disabled checkbox and
    // the line below the list do; a control that takes a click and then springs
    // back reads as a bug rather than as a rule.
    actions.setCalendarIds(on ? [...calendarIds, id] : calendarIds.filter((c) => c !== id));
  }

  /** The one calendar left cannot be unticked — see `toggleCalendar`. */
  const lockedId = calendarIds.length === 1 ? calendarIds[0] : null;

  return (
    <div className="flex flex-col gap-[10px]">
      {!available && (
        <p role="alert" className="text-meta text-warn">
          The system keychain is unavailable, so Phase cannot store a connection.
        </p>
      )}

      {corrupt && (
        <div className="flex items-center justify-between gap-[8px]">
          <p className="text-meta text-warn min-w-0">Saved credentials could not be read.</p>
          <button type="button" className={rowBtn} onClick={() => void actions.resetCalendar()}>
            Reset calendar setup
          </button>
        </div>
      )}

      {connected ? (
        <>
          <div className="flex items-center justify-between gap-[8px]">
            <span className="text-ui text-ink truncate min-w-0">{calendarStatus.accountId}</span>
            <button
              type="button"
              className={rowBtn}
              onClick={() => void actions.disconnectCalendar()}
            >
              Disconnect
            </button>
          </div>

          {calendars.length > 0 && (
            <div className="flex flex-col gap-[4px]">
              <ul className="flex flex-col gap-[2px]">
                {calendars.map((cal) => (
                  <li key={cal.id}>
                    <label className="flex items-center gap-[8px] text-ui min-w-0">
                      <input
                        type="checkbox"
                        className="flex-none accent-accent w-[16px] h-[16px] disabled:opacity-50"
                        checked={calendarIds.includes(cal.id)}
                        disabled={cal.id === lockedId}
                        onChange={(e) => toggleCalendar(cal.id, e.target.checked)}
                      />
                      <span className={`truncate min-w-0 ${cal.id === lockedId ? 'text-muted' : 'text-ink'}`}>
                        {cal.summary}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {lockedId !== null && calendars.some((cal) => cal.id === lockedId) && (
                <p className="text-meta text-muted leading-[1.5]">
                  Phase reads at least one calendar. Tick another before
                  unticking this one.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-[8px]">
            <span className="text-meta text-muted truncate min-w-0">
              {fetchedLabel(calendarFetchedAt)}
            </span>
            <button type="button" className={rowBtn} onClick={() => void actions.refreshCalendar()}>
              Refresh
            </button>
          </div>
        </>
      ) : configured ? (
        <button
          type="button"
          className={secondaryBtn}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await actions.connectCalendar();
            setBusy(false);
          }}
        >
          Connect Google Calendar
        </button>
      ) : (
        <p className="text-meta text-muted leading-[1.5]">
          This build of Phase ships no Google OAuth client, so connecting needs
          one of your own.
        </p>
      )}

      <CredentialsDisclosure
        // Remounted when the client situation changes, so `defaultOpen` is
        // re-applied: `open` on a `<details>` is uncontrolled otherwise.
        key={configured ? 'has-client' : 'no-client'}
        defaultOpen={!configured}
        offerBuiltIn={custom && managed}
        busy={busy}
        clientId={clientId}
        clientSecret={clientSecret}
        revealSecret={revealSecret}
        onClientId={setClientId}
        onClientSecret={setClientSecret}
        onToggleReveal={() => setRevealSecret((was) => !was)}
        onSave={() => void save()}
        onUseBuiltIn={() => void actions.resetCalendar()}
      />
    </div>
  );
}

/**
 * The advanced fallback: point Phase at your own Google Cloud project.
 *
 * `<details>` rather than a hand-rolled toggle — it is keyboard-reachable and
 * screen-reader-announced for free, and this is a section a reader is meant to
 * walk past. Its children are rendered only while it is open rather than left
 * in the DOM behind the browser's own hiding, so a closed disclosure holds no
 * focusable field and no label anything can reach.
 */
function CredentialsDisclosure({
  defaultOpen, offerBuiltIn, busy,
  clientId, clientSecret, revealSecret,
  onClientId, onClientSecret, onToggleReveal, onSave, onUseBuiltIn,
}: {
  defaultOpen: boolean;
  /** Only true when there is a shipped client to fall back TO. */
  offerBuiltIn: boolean;
  busy: boolean;
  clientId: string;
  clientSecret: string;
  revealSecret: boolean;
  onClientId: (value: string) => void;
  onClientSecret: (value: string) => void;
  onToggleReveal: () => void;
  onSave: () => void;
  onUseBuiltIn: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="text-meta text-muted cursor-pointer select-none">
        Use my own Google OAuth client
      </summary>

      {open && (
        <div className="flex flex-col gap-[8px] mt-[8px]">
          <p className="text-meta text-muted leading-[1.5]">
            Only needed to point Phase at your own Google Cloud project. Create
            a Desktop app OAuth client, then paste it here — the setup is
            written up in docs/google-calendar-setup.md.
          </p>

          <div className="flex flex-col gap-[4px]">
            <label className={labelCls} htmlFor="cal-client-id">Client ID</label>
            <input
              id="cal-client-id"
              className={fieldCls}
              value={clientId}
              autoComplete="off"
              onChange={(e) => onClientId(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-[4px]">
            <div className="flex items-center justify-between gap-[8px]">
              <label className={labelCls} htmlFor="cal-client-secret">Client secret</label>
              <button
                type="button"
                className="text-meta text-muted hover:text-ink"
                aria-label={revealSecret ? 'Hide secret' : 'Show secret'}
                onClick={onToggleReveal}
              >
                {revealSecret ? 'hide' : 'show'}
              </button>
            </div>
            <input
              id="cal-client-secret"
              className={fieldCls}
              type={revealSecret ? 'text' : 'password'}
              value={clientSecret}
              autoComplete="off"
              onChange={(e) => onClientSecret(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between gap-[8px]">
            {/*
              `resetCalendar` clears the local credential store, and what makes
              a custom client win is simply that it is stored — so forgetting
              it IS the way back. Offered only when there is something to go
              back to.
            */}
            {offerBuiltIn ? (
              <button
                type="button"
                className="text-meta text-muted hover:text-ink"
                onClick={onUseBuiltIn}
              >
                Use the built-in client instead
              </button>
            ) : <span />}
            <button type="button" className={rowBtn} disabled={busy} onClick={onSave}>
              Save
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
