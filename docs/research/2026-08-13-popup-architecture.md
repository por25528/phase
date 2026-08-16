# Phase top command shelf: long-term macOS architecture

**Date:** 2026-08-13  
**Decision recommendation:** Keep the assistant in Electron, but make its dedicated `BrowserWindow` a macOS `type: 'panel'` and treat it as a long-lived background surface. Do not build a separate Swift helper yet.

## Executive recommendation

Phase should use a **hybrid Electron panel architecture**:

- Keep the existing React assistant surface and validated IPC boundary.
- Keep one assistant `BrowserWindow` pre-created and hidden for instant display.
- On macOS, configure that window with `type: 'panel'`, plus the normal utility-window flags and a restrained always-on-top level.
- Position it at the top center of the display nearest the pointer, inside that display's work area.
- Show it with keyboard focus, then hide it on Escape, blur, a second shortcut press, or after the brief “Good luck!” transition.
- Keep Phase running after the dashboard closes. Hide the dashboard instead of destroying the renderer that owns application state.
- Add a menu-bar item as the discoverable fallback for Open Phase, Open assistant, Settings, and Quit.
- Put all native-window operations behind a small shelf-window controller so a true AppKit implementation remains possible later.

This is not merely a normal floating browser window. Electron documents that the macOS `panel` type adds `NSWindowStyleMaskNonactivatingPanel` and puts the window on every Space, including above fullscreen apps. That is the central behavior a summonable shelf needs, and it is available without adding another executable or state path. [Electron `BaseWindow` options](https://www.electronjs.org/docs/latest/api/base-window)

A separate native `NSPanel` should be considered only if an Electron-panel prototype fails measured acceptance tests for keyboard focus, fullscreen/Spaces, Stage Manager, animation, or multi-display placement.

## What Wispr Flow establishes—and what it does not

Wispr Flow's public documentation establishes an observable product pattern:

- Its desktop product has two distinct surfaces: a main Hub and a small floating Flow Bar used for routine work. [Wispr Flow desktop navigation](https://docs.wisprflow.ai/articles/5096240724-navigating-the-wispr-flow-app-desktop-ios-and-android)
- It runs from a macOS menu-bar item or Windows system tray, exposes a “Show in dock” preference on Mac, and offers launch-at-login. [Wispr Flow desktop navigation](https://docs.wisprflow.ai/articles/5096240724-navigating-the-wispr-flow-app-desktop-ios-and-android)
- Its global actions work in other apps and its shortcuts are configurable. Command Mode can be activated while text is selected in any app, while Scratchpad can be opened from anywhere. [Wispr Flow Command Mode](https://docs.wisprflow.ai/articles/4816967992-how-to-use-command-mode), [Wispr Flow Scratchpad](https://docs.wisprflow.ai/articles/9618237082-using-the-scratchpad-to-save-and-edit-notes)
- The Flow Bar is screen-edge-aware, remembers its position, supports Escape during interaction, and has received fixes for smooth transitions and correct anchoring around the macOS Dock. [Move and dock the Flow Bar](https://docs.wisprflow.ai/articles/1790396454-move-and-dock-the-flow-bar-on-desktop), [Flow Bar troubleshooting](https://docs.wisprflow.ai/articles/5002934560-why-is-the-wispr-bar-is-not-appearing-or-disappearing)

Wispr does **not** publicly document whether the Mac product uses `NSPanel`, Swift/AppKit, Electron, Tauri, a native helper, or some other window stack. We should copy the proven interaction model, not make an unsupported claim about its private implementation.

## Options compared

| Architecture | Popup from any app | Keyboard and focus behavior | Spaces, fullscreen, current display | Animation | Background and chrome | Cross-platform | Maintenance | Verdict |
|---|---|---|---|---|---|---|---|---|
| Electron `BrowserWindow`, upgraded to macOS `type: 'panel'` | Global shortcut plus a pre-warmed window gives instant summon | `show()` gives focus; panel style is intended for non-activating behavior; blur and Escape can hide | Panel type appears on all Spaces/fullscreen; Electron screen APIs provide display and work-area geometry | Animate the React surface, then hide the native window | Same process, renderer, IPC, package, and updater; Tray and app lifecycle are built in | Shared implementation, with platform-specific window adapters | Lowest incremental cost | **Recommended** |
| Separate Swift/AppKit `NSPanel` helper | Excellent | Finest control through `isFloatingPanel`, `becomesKeyOnlyIfNeeded`, key-window policy, and AppKit animation | Excellent macOS control | Finest native control | Requires another process/helper target and a bridge to Phase state | Mac-only; Windows/Linux still need separate implementations | Highest signing, packaging, IPC, release, crash, and testing surface | Reserve as fallback |
| Overlay inside the dashboard window | Only while the Phase dashboard is already frontmost | Straightforward | Cannot appear over another app or its fullscreen Space | Straightforward | No background behavior | Easy | Lowest | Reject: wrong product model |

Apple describes `NSPanel` as an auxiliary window and exposes panel-specific controls including `isFloatingPanel` and `becomesKeyOnlyIfNeeded`. A non-activating panel can decide when a view needs the panel to become key for keyboard input. [Apple `NSPanel`](https://developer.apple.com/documentation/appkit/nspanel), [Apple `becomesKeyOnlyIfNeeded`](https://developer.apple.com/documentation/appkit/nspanel/becomeskeyonlyifneeded), [Apple `isFloatingPanel`](https://developer.apple.com/documentation/appkit/nspanel/isfloatingpanel)

Those controls make a native helper the theoretical ceiling on macOS fidelity. They do not yet justify the operational cost, because Electron already exposes the non-activating panel style needed for Phase's shelf.

## Recommended behavior and implementation shape

### 1. One pre-warmed shelf window

Create the assistant window once and hide it instead of destroying it. Electron's `show()` displays and focuses a window, while `hide()` keeps it available for the next invocation; `showInactive()` is available for read-only surfaces but is wrong for Phase's command shelf because its text input should be ready immediately. [Electron `BrowserWindow`: show, showInactive, and hide](https://www.electronjs.org/docs/latest/api/browser-window)

Recommended macOS shape:

```js
new BrowserWindow({
  type: process.platform === 'darwin' ? 'panel' : undefined,
  frame: false,
  show: false,
  skipTaskbar: true,
  hiddenInMissionControl: true,
  alwaysOnTop: true,
  resizable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  // Existing isolated preload and renderer settings remain.
})
```

Use a normal `floating` always-on-top level. Electron notes that higher levels such as `pop-up-menu` can sit above the Dock, while `floating` through `status` remain below it. Phase should not compete with system menus or the Dock. [Electron `setAlwaysOnTop`](https://www.electronjs.org/docs/latest/api/browser-window)

### 2. Top-center on the display the user is working on

On every summon:

1. Read `screen.getCursorScreenPoint()`.
2. Select `screen.getDisplayNearestPoint(point)`.
3. Center the shelf horizontally inside that display's `workArea` and add a small top inset.
4. Set bounds before showing, so no repositioning flash is visible.

Electron returns display-aware device-independent geometry and exposes both the nearest-display lookup and display work areas. [Electron `screen`](https://www.electronjs.org/docs/latest/api/screen/)

Pointer-nearest is the best available definition of “current display” for a global shortcut. It should be a documented product rule and covered by multi-monitor tests. If usability testing shows keyboard-heavy users routinely keep the pointer on another display, a later adapter can prefer the frontmost app's display when Phase can determine it reliably.

### 3. Focus without turning Phase into a new dashboard window

When Command–Space is pressed, request a fresh snapshot, position the window, call `show()`, and focus the command field after the renderer reports it is ready. On a second press, hide it. Hide on window blur and on the renderer's Escape action.

Electron's macOS `panel` type uses the non-activating panel style; Apple documents that non-activating panels can control when keyboard focus is taken. This makes it the correct first implementation, but exact behavior with Chromium text fields, Stage Manager, and each supported macOS release must be proven with acceptance tests. [Electron `BaseWindow` panel type](https://www.electronjs.org/docs/latest/api/base-window), [Apple nonactivating panel style](https://developer.apple.com/documentation/appkit/nswindow/stylemask-swift.struct/nonactivatingpanel)

### 4. Smooth dismissal belongs primarily in the web surface

For **Start session**:

1. Transition the shelf content to “Good luck!” for roughly 600–800 ms.
2. Fade the surface and translate it upward by only a few pixels.
3. Notify the main process when the exit animation finishes; keep a short timeout fallback.
4. Hide the native window only after the surface is visually gone.
5. Under `prefers-reduced-motion: reduce`, use a short opacity-only transition or hide immediately.

This avoids continuously resizing or moving the native window, which is more likely to flicker. Electron can animate native bounds on macOS and set window opacity, but CSS/Web Animations give Phase tighter coordination with the content-state transition. [Electron `setBounds` and `setOpacity`](https://www.electronjs.org/docs/latest/api/browser-window), [Apple window animation behavior](https://developer.apple.com/documentation/appkit/nswindow/animationbehavior-swift.enum)

### 5. Closing the dashboard must not quit the assistant

The current feature implementation destroys the assistant when the main window closes and calls `app.quit()` from `window-all-closed`. That contradicts the approved behavior that Command–Space remains available after closing the dashboard.

The safest Phase-specific change is to intercept the dashboard's close action and **hide rather than destroy** the main window, except during an explicit Quit. This keeps the existing hidden renderer alive as the sole IndexedDB/state owner, preserves the assistant's validated snapshot/action IPC design, and avoids introducing a second database writer. A menu-bar Quit item and Command–Q should terminate normally.

Electron documents that applications can control whether `window-all-closed` terminates the process, and its tray guide uses that lifecycle to keep a tray application alive with no visible windows. [Electron application lifecycle](https://www.electronjs.org/docs/latest/api/app), [Electron tray guide](https://www.electronjs.org/docs/latest/tutorial/tray)

Longer term, a genuinely headless state owner could replace the hidden dashboard renderer, but that is an independent persistence-architecture project—not a prerequisite for a good shelf.

### 6. Menu bar and Dock policy

Add a macOS menu-bar item (Windows system tray equivalent) with **Open Phase**, **Open assistant**, **Settings**, and **Quit**. It makes the background lifecycle understandable and provides recovery if the shortcut conflicts. Electron provides the `Tray` API for this pattern. [Electron `Tray`](https://www.electronjs.org/docs/latest/api/tray/)

For the first release, keep Phase a regular Dock app by default because it still has a substantial planning dashboard. Offer **Show Phase in Dock** as an explicit setting after the lifecycle is stable. Accessory activation removes both the Dock icon and the application's menu bar, so changing this dynamically should be tested carefully rather than coupled to every window close. [Electron `app.setActivationPolicy`](https://www.electronjs.org/docs/latest/api/app#setactivationpolicypolicy), [Apple accessory activation policy](https://developer.apple.com/documentation/appkit/nsapplication/activationpolicy-swift.enum/accessory)

This matches the observable Wispr pattern—menu-bar presence plus a user-facing Dock preference—without assuming its internal implementation. [Wispr Flow desktop navigation](https://docs.wisprflow.ai/articles/5096240724-navigating-the-wispr-flow-app-desktop-ios-and-android)

### 7. Treat the shortcut as configurable, not guaranteed

Keep Command–Space as the chosen default, but preserve visible conflict handling and an editable setting. Electron's global-shortcut registration works outside app focus, returns `false` when registration fails, and may silently fail when the operating system or another app owns the chord. [Electron `globalShortcut`](https://www.electronjs.org/docs/latest/api/global-shortcut)

Wispr similarly exposes centralized shortcut configuration, rejects or warns about conflicts, and documents that macOS Secure Keyboard Entry can block shortcuts while another app owns secure input. [Wispr Flow shortcut guide](https://docs.wisprflow.ai/articles/2612050838-supported-unsupported-keyboard-hotkey-shortcuts), [Wispr Flow Secure Event Input troubleshooting](https://docs.wisprflow.ai/articles/8841649969-fix-flow-shortcuts-blocked-by-macos-secure-keyboard-entry-secure-event-input)

Phase should therefore:

- show registration failure immediately in Settings;
- never silently substitute another shortcut;
- keep a menu-bar Open assistant action as fallback;
- explain likely Spotlight/other-app conflicts in plain language;
- keep Command–Space user-editable.

### 8. Preserve a cross-platform seam

Electron is explicitly cross-platform, but the exact utility-window capabilities are not. The macOS `panel` type is macOS-only; Windows has different window types; and Electron documents that Wayland generally prevents programmatic positioning, focusing, and blurring. [Electron overview](https://www.electronjs.org/docs/latest/), [Electron `BrowserWindow` platform notices](https://www.electronjs.org/docs/latest/api/browser-window)

Use one behavioral interface—create, position, show-and-focus, hide, dispose—with per-platform adapters:

- **macOS:** `type: 'panel'`, all-Spaces/fullscreen behavior, top-center work-area placement.
- **Windows:** frameless always-on-top utility window, tray lifecycle, work-area placement.
- **Linux X11:** similar where supported.
- **Linux Wayland:** degrade explicitly, because precise global placement and programmatic focus cannot be promised.

Keep recommendation/session state and React UI shared. Platform adapters should own only OS-window behavior.

## Acceptance gate before considering native AppKit

Test the Electron panel on every supported macOS generation and on at least these configurations:

1. Shortcut from another app focuses the command field without opening or raising the Phase dashboard.
2. Escape, outside click/blur, and a second shortcut press hide the shelf exactly once.
3. The shelf appears in the correct work area with multiple displays, different Dock positions, menu-bar auto-hide, and mixed scale factors.
4. The shelf appears correctly over a fullscreen app and across Spaces/Stage Manager without becoming permanently sticky.
5. “Good luck!” transitions without a white flash, position jump, stale frame, or focus leak; Reduce Motion is respected.
6. Closing the dashboard leaves the shortcut and menu-bar item working; explicit Quit releases the global shortcut and exits.
7. Shortcut registration failure is visible and recoverable.
8. Sleep/wake, display connect/disconnect, and app relaunch do not strand or misplace the shelf.

If the Electron implementation fails a gate because the underlying panel style cannot supply the necessary focus or window-server behavior—and the failure cannot be fixed through documented Electron APIs—then introduce a native AppKit adapter behind the same interface. Until that evidence exists, a Swift helper would be premature architecture.

## Bottom line

The best long-term choice for Phase is **not** “ordinary Electron window forever” and **not** “rewrite the shelf natively now.” It is:

> Use Electron's native macOS panel capability now, isolate it behind a window-controller seam, and promote to a true `NSPanel` helper only if platform acceptance tests prove a concrete gap.

That delivers the desired Wispr-like product behavior with the smallest new failure surface, preserves Phase's single-writer state architecture, and keeps the option of deeper AppKit integration open.
