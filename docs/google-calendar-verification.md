# Google Calendar — manual verification

The automated sweep covers everything it can: the full Vitest suite, `tsc -b`, a
production build, and the greps that confirm no secret crosses the bridge and no
module but `db/calendarCache.ts` touches the cache table.

This checklist covers what it cannot. The OAuth round trip, the `safeStorage`
persistence and the IPC boundary itself all need a real Electron process and a
real Google account, and no test in this repo can substitute for them.

**Prerequisite:** a build that either ships its own OAuth client or has one
saved — see [google-calendar-setup.md](google-calendar-setup.md).

## Launch

```bash
npm run dev &
npm run app:dev
```

Everything below is driven from **Settings → Calendar** unless a step says
otherwise. The devtools console is no longer the way in; `window.phaseCalendar`
is still there and is used below only where a UI control would be the wrong
instrument (checking that a socket closed, forcing a bad range).

## Setup and connection

- [ ] **1. Cold start.** With nothing connected, Settings → Calendar shows
      **Connect Google Calendar** on a build with managed credentials, or the
      client id and secret fields, already open, on a build without. The week
      header reads `calendar not connected` in the first case and
      `calendar not set up` in the second.

- [ ] **2. The advanced disclosure.** On a managed build, **Use my own Google
      OAuth client** is collapsed. Open it: the fields are empty. Save a client,
      reopen it — still empty. The secret is never read back.

- [ ] **3. The secret is masked.** It renders as dots; `show` reveals it; `hide`
      masks it again.

- [ ] **4. Half a pair is refused.** Fill only the client ID and press Save.
      Nothing happens, and nothing is thrown to the console.

- [ ] **5. Connect.** Click **Connect Google Calendar**. The browser opens for
      consent; on an unverified client click through **Advanced → Go to Phase**.
      On return: the account address shows, the picker lists your calendars, and
      **the grid already has your meetings on it** with no further action.

- [ ] **6. The socket closed.**

      ```bash
      lsof -iTCP -sTCP:LISTEN -P | grep -i electron
      ```

      No stray loopback port remains.

- [ ] **7. The caveat is gone.** With data covering the week, the header shows
      no calendar caveat at all.

## The data on the grid

- [ ] **8. Blocks reach the grid.** Open Plan on a week with real meetings. Each
      draws in its day column at the right time. **Cross-check one against your
      real calendar** — right day, right start minute.

- [ ] **9. The header agrees with the column.** A day with several meetings
      lists all of them in `blocked by:`, and every one is drawn. The two must
      never disagree.

- [ ] **10. Overlapping meetings merge.** If the week has two overlapping
      meetings, one block covers their union with both titles joined — not two
      blocks, and not a doubled duration.

- [ ] **11. `⌘N` avoids a meeting.** On a day whose morning is fully booked,
      create a step with an estimate. It lands after the meeting.

- [ ] **12. A full day refuses.** On a day covered end to end, `⌘N` refuses and
      the toast describes the real gaps — not gaps inside a meeting.

- [ ] **13. Today agrees with Plan.** Today's free-time offer proposes an hour
      that is actually free, and Replan proposes nothing inside a meeting.

- [ ] **14. The month grid agrees too.** Switch to Month: the same days carry
      the same meetings.

## Fetching

- [ ] **15. Navigation inside the window is quiet.** Page forward a few weeks
      inside the cached range with the Network tab open. No fetch fires.

- [ ] **16. Navigation past the window fetches once.** Page to a week beyond
      eight weeks out. Exactly one fetch, and the blocks appear.

- [ ] **17. Out of range says so.** Page to a week past the cached window but
      inside six months. The header reads `no calendar data for this week`, one
      fetch fires, and the caveat clears.

- [ ] **17b. Past the horizon says something different.** Page beyond six
      months. The header reads `calendar reaches six months out` — not "no data
      for this week", which would promise something that is never coming — and
      with the Network tab open, **no fetch fires** however many weeks you page
      through out there.

- [ ] **17c. The back edge says something else again.** Page back more than one
      week. The header reads `calendar only reaches one week back` — NOT the
      six-months sentence, which would be simply false about last month — and
      no fetch fires there either. One week back is still covered and still
      shows its meetings.

- [ ] **18. Focus refresh.** Leave the app unfocused for over fifteen minutes,
      then click back in. One fetch fires. Click away and back immediately — no
      second fetch.

- [ ] **19. Refresh and the age label.** The `fetched …` line shows a plausible
      local time. Click **Refresh**; it updates.

- [ ] **19b. Refresh reaches the week you are on.** Page to a week beyond the
      cached window so the header caveats, then — without navigating away —
      open Settings and press **Refresh**. The caveat clears. The same must be
      true of **Connect**: disconnect, page out to an uncovered week, reconnect,
      and that week's meetings appear without any further navigation.

- [ ] **19c. A refresh that will not land eventually says so.** With the
      calendar connected and the week covered, turn off the network and leave
      the app for a quarter of an hour, then focus it. The header reads
      `calendar didn't refresh` — and the blocks already on screen are still
      there, because the last known good data is worth more than freshness.

- [ ] **20. Restart.** Quit and relaunch. The blocks are there before any fetch
      completes, from the cache, and no re-consent is asked. This is what proves
      the refresh token survived `safeStorage` and that the publishing status is
      right — if it asks you to re-consent, your consent screen is still in
      **Testing**. See the setup guide's table.

- [ ] **21. Refresh works.** *(optional but valuable)* Leave the app open for
      over an hour, then Refresh. It must succeed without re-consent. Nothing
      else exercises the token-refresh path.

- [ ] **22. Bad range refused.** In the devtools console:

      ```js
      await window.phaseCalendar.fetch({
        rangeStart: '2026-8-3', rangeEnd: '2026-08-10', calendarIds: ['primary'],
      })
      ```

      Expect `{ ok: false, reason: 'invalid-range' }`. Note the unpadded month.

## The picker and the preferences

- [ ] **23. Picker.** Tick a second calendar. Its events appear on the grid
      within a moment. Untick it; they go.

- [ ] **23b. The last calendar is disabled, not springy.** With one calendar
      ticked, its checkbox is greyed and cannot be clicked, and a line under
      the list says Phase reads at least one. Tick a second — the first becomes
      clickable again and the line goes.

- [ ] **24. Offline.** Turn off the network and Refresh. The blocks already on
      screen stay. A booked week must never be redrawn as a free one because a
      fetch failed.

## Leaving

- [ ] **25. Disconnect.** Click **Disconnect**. Blocks vanish, the header reads
      `calendar not connected`, and the grant is gone from
      https://myaccount.google.com/permissions.

- [ ] **26. Reconnect is not re-setup.** After disconnecting, the section shows
      **Connect** — not the credentials fields. A client survives a disconnect;
      only the account grant does not.

- [ ] **27. Account switch invalidates.** Disconnect, then connect a different
      Google account. The old account's blocks must not appear even for a frame.

- [ ] **28. Back to the built-in client.** On a managed build with a custom
      client saved, **Use the built-in client instead** revokes the grant your
      client held — confirm it is gone from
      https://myaccount.google.com/permissions — and leaves the section showing
      **Connect**, not the credentials fields. Press Connect: consent now goes
      to the shipped client's project.

- [ ] **28b. Saving a new client disconnects the old one.** With an account
      connected, save a DIFFERENT client id and secret. The blocks vanish
      immediately, the header reads `calendar not connected`, and the old grant
      is gone from the permissions page. Quit and relaunch: the blocks must not
      come back from the cache.

- [ ] **28c. A rotated client asks for a reconnect.** *(packagers only)*
      Connect on a build made with one `PHASE_GOOGLE_CLIENT_ID`, then relaunch
      `npm run app:dev` with a different one exported. The header reads
      `calendar needs reconnecting` — NOT a silent failure and not
      `calendar didn't refresh` — and Connect repairs it.

- [ ] **28d. A rotated SECRET asks for one too.** With your own client
      connected, reset the client secret in the Google Cloud console without
      touching Phase, then wait for the access token to expire (or quit and
      relaunch after an hour) and Refresh. Google refuses with
      `invalid_client`, and the header must read `calendar needs reconnecting`
      rather than `calendar didn't refresh`. Save the new secret and Connect to
      repair it. This is the path that also covers a token stored before Phase
      recorded which client issued it.

- [ ] **29. Browser is unaffected.** `npm run dev` alone, in a browser: Plan
      renders with no blocks and no console errors, Settings → Calendar reads
      "Google Calendar is only available in the desktop app", and the week
      header shows no calendar caveat.
