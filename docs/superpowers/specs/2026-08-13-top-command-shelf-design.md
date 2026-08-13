# Phase top command shelf design

**Date:** 2026-08-13

**Status:** Approved on 2026-08-13; implementation governed by the macOS acceptance gate

**Scope:** Replace the assistant's normal-window feel with a Wispr Flow-style,
top-center command shelf while preserving Phase's single-writer data model.

## Goal

Command–Space should summon Phase above whatever the student is doing without
opening, tabbing to, or raising the Phase dashboard. The shelf gives one clear
answer, accepts a short command, and gets out of the way. Starting a focus
session ends with a brief “Good luck!” transition and an automatic dismissal.

The long-term product has two surfaces:

- **Phase Hub:** the existing planning window for Today, Plan, Goals, and
  Settings.
- **Phase Shelf:** a pre-warmed utility window for deciding and acting without
  leaving the current app.

A menu-bar item keeps the background lifecycle understandable and provides a
fallback when the shortcut is unavailable.

## Validated decisions

- The chosen layout is the **top command shelf**, not the bottom focus card or
  corner companion.
- Command–Space remains the preferred global shortcut and stays editable in
  Settings. This Mac currently has the macOS Spotlight binding disabled.
- The Phase Hub does not open when the global shortcut summons the shelf.
- Starting a session shows **“Good luck!”**, then hides the shelf automatically.
- Closing the Hub leaves Phase running quietly so the shelf remains available.
- The implementation uses Electron's macOS `panel` window type first. A Swift
  `NSPanel` helper is a tested fallback, not a prerequisite.
- The interface stays minimal, neutral, and consistent with the existing Phase
  design tokens. There are no gradients, glow effects, bright chrome, emojis,
  or new icon styles.

## Product model

The design follows the observable pattern documented by Wispr Flow: a full Hub
for management, a separate floating bar for routine use, and a menu-bar/system-
tray controller. Wispr Flow does not publish its implementation stack, so this
design copies the interaction model rather than assuming it uses Swift,
Electron, or `NSPanel`.

Electron 43 already exposes the macOS `type: 'panel'` behavior Phase needs. It
adds the non-activating-panel style and makes the window available across
Spaces and fullscreen apps. Phase keeps its existing React assistant surface,
isolated preload, validated IPC projection, and sole state-owning renderer.

## Shelf experience

### Geometry and placement

- Fixed content size: **620 × 200 device-independent pixels**.
- Fixed width and height; the user cannot resize, maximize, minimize, or enter
  fullscreen.
- Frameless with the existing uniform card radius, a one-pixel neutral border,
  and one restrained shadow.
- Positioned horizontally in the center of the display nearest the pointer,
  **18 px below that display's work-area top**.
- Bounds are calculated and applied before every show, so moving between
  displays never produces a visible jump.
- Long proposal/choice content scrolls inside the fixed shelf. The native
  window does not grow into a second application window.

Pointer-nearest is Phase's explicit definition of “current display.” It is
predictable, available through Electron's supported screen API, and testable.

### Normal state

The input is first and focused immediately:

> Ask Phase or add something…

Below it, the shelf has one focal point: the canonical recommendation already
shared with Today. It shows:

- one quiet reason label, such as “Up next” or “Due today”;
- a two-line maximum title;
- subdued goal and honest expected-time metadata;
- one neutral primary action: **Start session**.

Alternative recommendations do not compete with the default answer. When they
exist, a quiet **Other options** disclosure reveals at most two inside the same
scrollable shelf. The disclosure is secondary text, not another saturated
button or card row.

### Command and proposal states

The input keeps the existing bounded assistant vocabulary: ask what fits a time
window, capture a task, complete work, or schedule work. Mutating commands keep
their preview-and-confirm flow. Identical actions keep identical verbs:
**Start session**, **Confirm**, **Cancel**, **Complete session**, **Take break**,
and **Continue**.

One proposal or clarification replaces the recommendation area; it does not
stack another card above it. Lists remain keyboard-navigable and scroll within
the fixed 200 px window.

### Running-session state

Command–Space during a session reopens the same shelf with:

- **Focus session** as the quiet label;
- the current task and goal;
- elapsed active time and honest expected-time text;
- **Complete session** as the primary action;
- **Take break** or **Continue** as the secondary action.

There is no always-visible timer. The student returns to the work underneath
and summons the shelf only when they need it.

### Successful start and dismissal

The shelf dismisses only after the state owner confirms a session started:

1. **Start session** enters a local pending state and cannot be pressed twice.
2. The existing validated action travels to the main renderer and calls the
   existing `startFocus` store action.
3. A new snapshot containing the matching active-focus reference confirms the
   write. A warning snapshot instead restores the normal state and stays open.
4. The content crossfades to **“Good luck!”** over 160 ms.
5. The send-off remains legible for 500 ms.
6. The shelf fades and moves upward 6 px over 180 ms.
7. The renderer asks the window controller to hide it after the animation end,
   with a 1-second timeout fallback so a missed event cannot strand the panel.

Total successful dismissal is roughly 840 ms. The native window is not resized
or moved during the transition, preventing flicker. With Reduce Motion enabled,
the shelf swaps to “Good luck!”, remains for 350 ms, then hides with no
translation.

Opening uses a 160 ms opacity/6 px downward settle. The window is positioned,
painted, and supplied with its cached snapshot before it becomes visible, so
the animation never begins from a white or empty frame.

## Desktop-window architecture

### Shelf window controller

Native window behavior lives behind a small controller owned by Electron's main
process:

```text
create → position → showAndFocus → hide → dispose
```

The controller owns the `BrowserWindow`, current-display positioning, visibility,
ready state, and recreation after a renderer crash. Application state, advice,
commands, and session transitions remain outside it.

On macOS the window uses:

- `type: 'panel'`;
- `frame: false`;
- `show: false`;
- `alwaysOnTop: true` at the normal `floating` level;
- `skipTaskbar: true`;
- `hiddenInMissionControl: true`;
- `resizable`, `minimizable`, `maximizable`, and `fullscreenable`: `false`;
- the existing context-isolated, node-disabled assistant preload.

The controller explicitly enables all-Spaces/fullscreen visibility using the
supported Electron API. It does not use system-menu or screen-saver window
levels and never competes with the macOS menu bar or Dock.

Other platforms implement the same controller interface with the closest
supported frameless utility window. Exact top-center positioning is not
promised on Wayland, where the compositor can forbid it.

### Single writer and hidden Hub

The main renderer remains Phase's only store owner and the only code allowed to
write IndexedDB. Closing the Hub therefore hides it instead of destroying it,
except during an explicit application quit. Its hidden renderer keeps the
store hydrated, publishes assistant snapshots, and executes validated actions.

An `isQuitting` main-process flag distinguishes these paths:

- Hub close button: prevent close and hide Hub.
- Dock activation or **Open Phase**: show and focus the existing Hub.
- Command–Q or menu-bar **Quit Phase**: set quitting state, release shortcuts,
  close windows, and terminate normally.

This intentionally postpones a headless state-owner process. Moving Dexie out
of the renderer would be an independent persistence project with no benefit to
the shelf's first release.

### Entry points

All desktop entry points converge on the shelf controller:

- Command–Space toggles the shelf.
- Menu bar → **Open assistant** opens it.
- The desktop command-palette verb **Open assistant** opens it rather than
  mounting an anchored panel inside the Hub.

The plain browser build keeps the existing in-app `AssistantHost` as its honest
fallback because it has no native window. One command resolver chooses the
desktop shelf when the bridge is available and the in-app panel otherwise.

### Menu bar and login

While Phase is running, a monochrome template menu-bar item exposes:

- **Open Phase**
- **Open assistant**
- **Settings**
- separator
- **Quit Phase**

The menu uses the existing Phase icon as a template image and does not add a
second visual brand. Settings adds **Launch Phase at login**, default off. When
enabled, login launch creates the hidden Hub/state owner and hidden pre-warmed
shelf without showing the dashboard.

Phase stays a regular Dock app by default because the Hub is a substantial
planning tool. A future **Show Phase in Dock** setting may be added only after
the background lifecycle is stable; dynamically switching the app activation
policy is not part of this slice.

## Data and IPC flow

The existing security boundary remains authoritative:

```text
hidden/visible Hub renderer (store owner)
        │ validated AssistantSnapshot
        ▼
Electron relay cache → shelf renderer (read-only projection)
        │ validated AssistantAction
        └──────────────────────────────► Hub renderer actions
```

Changes are deliberately narrow:

- `AssistantFocusView` gains the existing `WorkRef`, allowing the shelf to
  prove that the requested session became active before showing the send-off.
- The main preload gains an **open assistant** invocation for desktop palette
  routing.
- A narrow shell bridge carries **open settings** from the menu bar and reads
  or changes the operating-system login-item setting.
- The overlay preload keeps `ready`, `onSnapshot`, `act`, and `close`. It does
  not receive store access, arbitrary IPC, URLs, tokens, notes, assets, or
  calendar event titles.

Every new payload and sender is validated in the main process. No new renderer
writes IndexedDB and no assistant action bypasses an existing store action.

## Visual and interaction rules

- Existing typography tokens define the complete scale. The recommendation
  title is the only strong heading; labels and metadata stay smaller, lighter,
  and lower contrast.
- Chrome is neutral. Color remains reserved for an existing warning or status.
- All borders are one pixel and use existing line tokens.
- Existing radius variables apply to the shelf, field, buttons, and disclosures.
- No emoji. Existing Phase SVG icons are used only where a text label would be
  less clear; row actions remain collapsed rather than producing button noise.
- Titles clamp to two lines; goal names and other metadata truncate with an
  ellipsis. Missing goal names consume no empty row.
- Loading uses the existing assistant skeleton, reshaped horizontally. There is
  no spinner or blank white frame.
- Escape, shelf blur, and a second Command–Space hide it. Only a successful
  **Start session** plays the motivational send-off.
- Focus begins in the command field. Tab order follows the visual order and the
  focus ring uses existing neutral/accent accessibility tokens.

## Error and recovery behavior

- A shortcut conflict stays visible in Settings. Phase never silently chooses
  another chord. The menu-bar **Open assistant** action remains available.
- If the Hub has not hydrated, the shelf shows a skeleton and accepts no
  mutation until a ready snapshot arrives.
- If starting a session is refused, the shelf remains open and shows the
  existing warning; “Good luck!” never appears.
- If the shelf renderer exits unexpectedly, the controller discards it and
  recreates it on the next invocation. The Hub and user data remain alive.
- If creating the menu-bar item fails, Phase logs the failure and the Dock plus
  global shortcut still work; the planner itself must continue to open.
- Sleep/wake and display changes trigger fresh placement on the next summon
  rather than preserving stale coordinates.

## Testing and acceptance

### Automated coverage

- Pure tests pin macOS and fallback window options.
- Pure geometry tests cover one display, negative-origin secondary displays,
  different work-area sizes, and pointer-nearest selection.
- Controller tests cover toggle, position-before-show, blur/Escape hide,
  renderer recreation, and explicit disposal.
- IPC tests pin sender validation and the added focus reference/open/settings
  channels.
- React tests with fake timers cover successful pending → send-off → close,
  refusal staying open, double-click prevention, normal and reduced-motion
  timing, truncation, the one-recommendation default, and the Other options
  disclosure.
- Lifecycle tests cover Hub close → hide, Dock/menu-bar reopen, login launch
  hidden, and explicit quit releasing the global shortcut.
- Existing assistant, store, persistence, and design-scale suites remain green.

### macOS acceptance gate

The Electron panel ships only after manual checks confirm:

1. Command–Space from another app focuses the shelf input without opening or
   raising the Hub.
2. The shelf appears on the pointer's display across multiple displays, mixed
   scale factors, Spaces, fullscreen apps, and Stage Manager.
3. Escape, blur, and the second shortcut hide exactly once and return the user
   to the underlying app.
4. “Good luck!” has no white flash, stale frame, position jump, or lingering
   invisible hitbox; Reduce Motion is respected.
5. Closing the Hub leaves the shortcut and menu bar working. Command–Q and
   **Quit Phase** fully exit and release Command–Space.
6. Shortcut conflicts are visible and recoverable through Settings and the
   menu bar.
7. Sleep/wake and monitor connect/disconnect do not strand the shelf offscreen.

If a failure is caused by an Electron limitation that documented APIs cannot
resolve, the shelf controller becomes a native macOS adapter backed by AppKit
`NSPanel`. The assistant protocol, React content, store actions, and product
behavior do not change merely to replace the window shell.

## Out of scope

- A Swift/AppKit helper before the Electron acceptance gate fails.
- Moving Phase's store into a headless or main-process database owner.
- A persistent on-screen timer or floating bubble.
- Voice dictation, microphone permissions, or copying Wispr Flow's recording
  feature set.
- Arbitrary natural-language automation beyond the assistant's current bounded
  command vocabulary.
- A new task/todo or homework data model; the shelf acts on Phase's existing
  goals, steps, tasks, schedules, and focus sessions.
- A Dock-visibility preference in this slice.

## References

- [Wispr Flow desktop navigation](https://docs.wisprflow.ai/articles/5096240724-navigating-the-wispr-flow-app-desktop-ios-and-android)
- [Electron BaseWindow panel behavior](https://www.electronjs.org/docs/latest/api/structures/base-window-options)
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron screen API](https://www.electronjs.org/docs/latest/api/screen/)
- [Electron Tray](https://www.electronjs.org/docs/latest/api/tray/)
- [Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [Apple NSPanel](https://developer.apple.com/documentation/appkit/nspanel)
