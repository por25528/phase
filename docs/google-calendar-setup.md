# Google Calendar setup

> **Shelved as of 2026-08-07.** The integration is unfinished and not reachable
> from the app. The Electron producer is built and tested but nothing in the
> renderer calls it, so following this guide will not give you calendar data in
> Phase. It was stopped because the setup burden below — a Google Cloud project,
> a consent screen, and pasting OAuth credentials — is too much to ask before
> someone can plan a week. The remaining work is written up in
> `docs/superpowers/plans/2026-08-07-google-calendar-3a-data-path.md` and `-3b-settings-ui.md`
> if it is ever picked back up.

Phase reads Google Calendar busy time locally so it can protect the time you
have already committed. Follow these steps once to create an OAuth client for
your own Phase installation.

## Create a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project, or select an existing project dedicated to your Phase
   installation.

## Enable the Google Calendar API

1. In the selected project, open **APIs & Services → Library**.
2. Search for **Google Calendar API**.
3. Open it and click **Enable**.

The API is free for this use and does not require a billing account.

## Configure the OAuth consent screen as External

1. Open **APIs & Services → OAuth consent screen**.
2. Choose **External** as the user type and create the app configuration.
3. Enter an app name and your support and developer contact details.
4. Add the two scopes Phase requests:
   - `https://www.googleapis.com/auth/calendar.events.readonly` for the busy
     event data.
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly` for the
     calendar picker.

`calendar.events.readonly` by itself does not authorize the calendar picker,
and the broader `calendar.readonly` scope would grant more access than Phase
needs. Phase never writes to Google Calendar.

### Set Publishing status to "In production"

In the OAuth consent screen's **Audience** page, click **Publish app**, then
set **Publishing status** to **In production**. The choice affects whether
Google's refresh token persists:

| Posture | Refresh token | Notes |
|---|---|---|
| Own client, **In production**, unverified | Persists | **Recommended.** One-time "Google hasn't verified this app" screen — click *Advanced → Go to Phase*. |
| Own client, **Testing** | **Expires in 7 days** | Development only. You will be forced to re-consent every week. |
| Verified production app | Persists | Requires Google review; out of scope. |

For a private client used only by you, an unverified app in production is the
recommended posture. Google may show the one-time unverified-app warning during
consent; use **Advanced → Go to Phase** to continue.

## Create an OAuth client

1. Open **APIs & Services → Credentials**.
2. Click **Create credentials → OAuth client ID**.
3. Choose **Desktop app** as the application type.
4. Create the client and copy its client ID and client secret.

Phase uses `http://127.0.0.1:<port>/callback` as its loopback redirect URI. A
**Desktop app** OAuth client needs no redirect URI configuration; Google
auto-allows loopback redirects.

A desktop OAuth client's "secret" is not confidential. Desktop applications
cannot keep a shipped secret, which is why Phase ships none. PKCE is what
actually protects the authorization-code flow.

## Paste the credentials into Phase

Phase has no Google Calendar settings panel yet. Until it does, the credentials
go in through the devtools console of the desktop app:

```bash
npm run dev &
npm run app:dev
```

```js
await window.phaseCalendar.configure({ clientId: '...', clientSecret: '...' })
await window.phaseCalendar.connect()
```

`connect()` opens your browser for Google's consent flow. Click through the
unverified-app screen via **Advanced → Go to Phase**; the browser then lands on
a page confirming Phase is connected.

Phase stores the credentials and tokens in the operating system's encrypted
user-data store; they do not cross the renderer bridge.

[google-calendar-verification.md](google-calendar-verification.md) walks the
rest of the connection — listing your calendars, fetching a week, and
confirming the connection survives a restart.
