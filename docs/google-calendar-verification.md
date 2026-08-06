# Google Calendar producer — manual verification

The automated sweep covers everything it can. This checklist covers what it
cannot: the OAuth round-trip, the `safeStorage` persistence, and the IPC
boundary itself all need a real Electron process and a real Google account, and
no test in this repo can substitute for them.

**Prerequisite:** complete [google-calendar-setup.md](google-calendar-setup.md)
and have your client ID and client secret to hand.

There is no settings UI yet — that is plan 3. Until then the only way to drive
the producer is the devtools console, deliberately: a panel built here would be
built twice.

## Launch

```bash
npm run dev &
npm run app:dev
```

Then open devtools in the Electron window and work through the console.

## The checks

- [ ] **1. Not configured.**

  ```js
  await window.phaseCalendar.status()
  ```

  Expect `configured: false, connected: false, corrupt: false`.

- [ ] **2. Configure.**

  ```js
  await window.phaseCalendar.configure({ clientId: '...', clientSecret: '...' })
  await window.phaseCalendar.status()
  ```

  Expect `configured: true, connected: false`.

- [ ] **3. Connect.**

  ```js
  await window.phaseCalendar.connect()
  ```

  Your browser opens. Consent, clicking through the unverified-app screen via
  **Advanced → Go to Phase**. The browser should land on a page saying Phase is
  connected. Then `status()` → `connected: true`, and `accountId` is your Google
  address.

- [ ] **4. The socket closed.**

  ```bash
  lsof -iTCP -sTCP:LISTEN -P | grep -i electron
  ```

  No stray loopback port remains.

- [ ] **5. List calendars.**

  ```js
  await window.phaseCalendar.listCalendars()
  ```

  Your calendars, with `primary: true` on exactly one.

- [ ] **6. Fetch.**

  ```js
  await window.phaseCalendar.fetch({
    rangeStart: '<a Monday>', rangeEnd: '<+7d>', calendarIds: ['primary'],
  })
  ```

  `ok: true` with blocks whose dates and times match what you actually have that
  week. **Check one meeting against your real calendar** — right day, right
  start minute.

- [ ] **7. Overlapping meetings merge.**

  If that week has two overlapping meetings, confirm one block covers their
  union with both titles joined — not two blocks, and not a doubled duration.

- [ ] **8. Restart persistence.**

  Quit the app entirely, relaunch, `status()` → still `connected: true` with no
  re-consent. This is what proves the refresh token survived `safeStorage`, and
  that the publishing status is right. If it asks you to re-consent, your OAuth
  consent screen is still in **Testing** — see the setup guide's table.

- [ ] **9. Refresh works.** *(optional but valuable)*

  Leave the app open for over an hour, then `fetch()` again. It must succeed
  without re-consent. Nothing else exercises the refresh path.

- [ ] **10. Bad range refused.**

  ```js
  await window.phaseCalendar.fetch({
    rangeStart: '2026-8-3', rangeEnd: '2026-08-10', calendarIds: ['primary'],
  })
  ```

  Expect `{ ok: false, reason: 'invalid-range' }`. Note the unpadded month.

- [ ] **11. Disconnect.**

  ```js
  await window.phaseCalendar.disconnect()
  await window.phaseCalendar.status()
  ```

  Expect `connected: false, accountId: null`. Confirm the grant is gone from
  https://myaccount.google.com/permissions.

- [ ] **12. Browser still works.**

  `npm run dev` alone, in a browser: Phase behaves exactly as before, and
  `window.phaseCalendar` is `undefined`.
