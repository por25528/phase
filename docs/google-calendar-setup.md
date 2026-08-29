# Google Calendar setup

Phase reads your Google Calendar so it stops putting work on top of time you
have already committed. It is read-only and one-way — Phase never writes to
Google — and the events are cached on your own Mac, outside the backup.

**Most people do not need this page.** Open **Settings → Calendar** and click
**Connect Google Calendar**. If that button is there, the build you are running
ships its own OAuth client and there is nothing to set up.

This page is for the other case: a build with no OAuth client of its own, or a
deliberate decision to point Phase at your own Google Cloud project instead.

---

## Which client is Phase using?

Settings → Calendar tells you without jargon:

| What you see | What it means |
|---|---|
| **Connect Google Calendar** | The build ships a client. Nothing to set up. |
| *"This build of Phase ships no Google OAuth client…"* with the client fields open | You need your own — follow this page. |
| **Use my own Google OAuth client** (collapsed) | The advanced fallback, when you want your own project anyway. |

A saved client always wins over the shipped one. Once you have saved your own,
the disclosure offers **Use the built-in client instead**, which forgets yours
and reconnects against the shipped one.

---

## Creating your own OAuth client

### 1. Create a Google Cloud project

Open the [Google Cloud Console](https://console.cloud.google.com/) and create a
project, or select an existing one dedicated to your Phase installation.

### 2. Enable the Google Calendar API

**APIs & Services → Library**, search for **Google Calendar API**, open it and
click **Enable**. The API is free for this use and needs no billing account.

### 3. Configure the OAuth consent screen as External

**APIs & Services → OAuth consent screen**, choose **External**, and add the
two scopes Phase requests:

- `https://www.googleapis.com/auth/calendar.events.readonly` — the busy events.
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly` — the picker.

`calendar.events.readonly` by itself does not authorize the calendar picker, and
the broader `calendar.readonly` scope would grant more access than Phase needs.

#### Set Publishing status to "In production"

On the consent screen's **Audience** page, click **Publish app** and set
**Publishing status** to **In production**. The choice decides whether Google's
refresh token survives:

| Posture | Refresh token | Notes |
|---|---|---|
| Own client, **In production**, unverified | Persists | **Recommended.** One-time "Google hasn't verified this app" screen — *Advanced → Go to Phase*. |
| Own client, **Testing** | **Expires in 7 days** | Development only. Weekly re-consent. |
| Verified production app | Persists | Requires Google review; out of scope. |

### 4. Create the client

**APIs & Services → Credentials → Create credentials → OAuth client ID**, and
choose **Desktop app**. Copy the client ID and client secret.

Phase uses `http://127.0.0.1:<port>/callback` as its loopback redirect. A
Desktop app client needs no redirect configuration; Google auto-allows loopback.

A desktop OAuth client's "secret" is not confidential — a desktop app cannot
keep a shipped secret. PKCE is what actually protects the authorization-code
flow.

### 5. Paste it into Phase

**Settings → Calendar → Use my own Google OAuth client**, paste both fields,
**Save**, then **Connect Google Calendar**. Your browser opens for consent;
click through the unverified-app screen via **Advanced → Go to Phase**.

Phase stores the credentials and tokens in the operating system's encrypted
user-data store. They never cross the renderer bridge — `status()` reports only
*whether* a client is configured, never its value, which is why the fields are
always blank when you reopen them.

---

## Shipping a build with managed credentials

For whoever packages Phase, not for whoever runs it.

Nothing in this repository contains a credential, and nothing may. The client
the build ships is written into the bundle at build time:

```bash
PHASE_GOOGLE_CLIENT_ID=…apps.googleusercontent.com \
PHASE_GOOGLE_CLIENT_SECRET=… \
  npm run calendar:credentials

npm run build:mac
```

`npm run calendar:credentials` writes `electron/calendar-credentials.json`,
which is git-ignored and packaged by the existing `electron/**/*` rule. Skipping
it is a supported outcome: the build then ships no client, and Settings asks for
the user's own.

During `npm run app:dev` the two environment variables are read directly, so no
file is needed. The packaged file wins over the environment when both exist — a
released app must not have its OAuth client swapped by whatever happened to be
exported in the shell that launched it.

Both variables or neither. Half a pair cannot authenticate, and reporting it as
present would make Phase claim to be configured and then fail at consent.

## What is stored, and where

| Thing | Where | In a backup? |
|---|---|---|
| Client id and secret | OS encrypted store (`safeStorage`), in the app's user-data directory | No |
| Refresh and access tokens | Same | No |
| Fetched busy blocks | The `calendarCache` table in IndexedDB, on this device | **No** — it is a cache, not data |

The cache carries its own provenance: the account, the selected calendars and
the machine timezone the events were flattened against. If any of those changes,
the cached blocks stop being displayed rather than being shown as current fact.

[google-calendar-verification.md](google-calendar-verification.md) is the manual
checklist for the parts no test can reach — the OAuth round trip, `safeStorage`
persistence, and the IPC boundary itself.
