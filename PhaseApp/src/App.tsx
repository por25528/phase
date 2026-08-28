import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, initStore, getState, subscribe, ownsSingleWriterLock, actions as storeActions, VIEW_LABELS } from './state/store';
import { Today } from './views/Today';
import { Goals } from './views/Goals';
import { Plan } from './views/Plan';
import { Project } from './views/Project';
import { QuickAdd } from './components/QuickAdd';
import { AssistantHost } from './components/assistant/AssistantHost';
import { ConfirmImportModal } from './components/ConfirmImportModal';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { SettingsModal } from './components/SettingsModal';
import { useLocalDate } from './hooks/useLocalDate';
import { addDays, todayStr } from './lib/dates';
import type { SearchEntry } from './lib/search';
import type { ObjectActionId } from './lib/commands';
import { CommandPalette } from './components/CommandPalette';
import { HeaderMenu, HeaderMenuItem } from './components/HeaderMenu';
import {
  IconArrowDown,
  IconArrowUp,
  IconBackspace,
  IconClock,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSun,
} from './components/Icons';
import {
  resolveAppKeyCommand,
  shouldConsumePaletteShortcut,
  shouldConsumeTaskCaptureShortcut,
  shouldCloseStepPanel,
  shouldLeaveProjectPage,
} from './lib/appKeyboard';
import { modalRegistry } from './lib/modalRegistry';
import { addActionFor } from './lib/addAction';
import {
  closeTaskCapture,
  requestTaskCaptureForCommand,
  type TaskCaptureHostState,
} from './lib/taskCapture';
import { shellBridge, type PhaseShellBridge } from './lib/shellBridge';
import { updateBridge } from './lib/updateBridge';
import { UpdateBanner } from './components/UpdateBanner';
import { createAgentBridge } from './lib/agentBridge';
import { validAgentRequest, errorResponse } from './lib/agentProtocol';
import { handleAgentRead } from './lib/agentReads';
import { handleAgentWrite } from './lib/agentWrites';
import { ingestJournal } from './state/syncIngest';
import { createSyncExporter } from './state/syncExport';
import { loadSyncMeta, saveSyncMeta } from './db/db';
import {
  type Theme,
  resolveTheme,
  readStoredTheme,
  systemPrefersDark,
  applyTheme,
} from './lib/theme';

// Header toggle cycles System → Light → Dark → System.
const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

// The nav, in the order the number keys select them (see lib/appKeyboard).
//
// Two destinations, not three. Timeline was a full global destination for a
// presentation of goal dates people opened weekly, sitting at the same weight
// as the surfaces they work in daily; it is a view mode inside Goals now.
const NAV_TABS = [
  ['today', VIEW_LABELS.today],
  ['plan', VIEW_LABELS.plan],
  ['goals', VIEW_LABELS.goals],
] as const;

/**
 * One resolver, two worlds: the desktop shell raises its own shelf window, the
 * plain browser mounts the in-app panel. Kept apart from the command handler so
 * the routing is a unit-testable fact instead of a branch inside App.
 */
export function openAssistantForEnvironment(
  bridge: PhaseShellBridge,
  openEmbedded: () => void,
): void {
  if (bridge.available) {
    // Fire-and-forget: the shelf raises its own window, so a refusal must never
    // fall through to the in-app panel. Catching here keeps the rejection quiet
    // — Task 9's handlers turn the returned boolean into the surface decision.
    void bridge.openAssistant().catch(() => {
      // The desktop owns the assistant surface; an unhandled rejection would
      // otherwise leak out of the command palette.
    });
    return;
  }
  openEmbedded();
}

/**
 * The preload's sync door (`electron/preload.cjs`). Absent in the plain
 * browser — Vite dev and the test suite both run without a preload — which is
 * what the `phaseSync !== undefined` gate below reads.
 */
interface PhaseSyncBridge {
  writeState(text: string): Promise<void>;
  requestJournal(): Promise<string | null>;
  onJournal(fn: (text: string) => void): () => void;
}

function syncBridge(): PhaseSyncBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { phaseSync?: PhaseSyncBridge }).phaseSync ?? null;
}

/**
 * What an ingest is allowed to say.
 *
 * A round that applied NOTHING states the failure alone — "0 changes applied,
 * 2 couldn't" leads with a zero and buries the sentence, and the design's own
 * wording for that case is "2 phone changes couldn't apply". A round that
 * applied something leads with that and appends the shortfall.
 */
export function ingestToast(applied: number, skipped: number): string | null {
  if (applied === 0 && skipped === 0) return null;
  const plural = (n: number) => (n === 1 ? 'change' : 'changes');
  if (applied === 0) return `${skipped} phone ${plural(skipped)} couldn\u2019t apply`;
  const head = `Phone: ${applied} ${plural(applied)} applied`;
  return skipped === 0 ? head : `${head}, ${skipped} couldn\u2019t`;
}

export function App() {
  const { view, toast, pendingUndo, goals, tasks, habits, hydration, secondTab, persistFailed, theme, openStepId, openGoalId, openAreaId, settingsOpen, actions } = useAppStore();
  useLocalDate(hydration === 'ready' ? actions.ensureWeekRollover : undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sysDark, setSysDark] = useState(() => systemPrefersDark());
  const [taskCapture, setTaskCapture] = useState<TaskCaptureHostState>({
    open: false,
    focusRequest: 0,
  });
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // The in-app assistant panel. Opens from ⌘K in the browser build; the desktop
  // shell's global shortcut opens the floating overlay window instead —
  // Command+Space never reaches Chromium, so it is deliberately NOT bound here.
  // On desktop the ⌘K palette verb routes through `shell` below, so this flag
  // is only ever the browser fallback's.
  const [assistantOpen, setAssistantOpen] = useState(false);
  // The one shell bridge, created once: subscribing and re-subscribing on every
  // render would make the desktop shell fire duplicate settings opens.
  const shell = useMemo(() => shellBridge(), []);
  // Likewise created once: the banner asks on mount, and a new bridge object
  // every render would re-fire that effect on every render.
  const updates = useMemo(() => updateBridge(), []);
  // Held between "a file was picked" and "the user typed REPLACE". The File is
  // captured here, so the input can be reset immediately and stay re-pickable.
  const [pendingImport, setPendingImport] = useState<File | null>(null);

  // The menu bar's Settings item asks for this surface over the shell bridge.
  useEffect(() => shell.onOpenSettings(actions.openSettings), [shell]);

  const reclaimSpace = () => {
    void actions.reclaimSpace()
      .then((result) => {
        if ('deferred' in result) {
          actions.showToast('Reclaim deferred — try again after the Undo window expires');
          return;
        }
        const { count, bytes } = result;
        actions.showToast(`Reclaimed ${count} asset${count === 1 ? '' : 's'} (${bytes} bytes freed)`);
      })
      .catch(() => actions.showToast('Could not reclaim space.'));
  };

  const openTaskCapture = () => setTaskCapture((current) => requestTaskCaptureForCommand(
    current,
    hydration,
    modalRegistry.hasOpenModal(),
  ));

  /**
   * `+ Add`, and `⌘N`, resolved against the surface underneath.
   *
   * The two share one resolver deliberately: a shortcut that did something
   * other than the button advertising it would be worse than either alone.
   */
  const addAction = addActionFor(view, openGoalId !== null);
  const runAddAction = () => {
    if (addAction.intent === 'goal') { actions.setGoalModal('new'); return; }
    // Straight onto the tree, ready to type — an empty title arms `newNodeId`,
    // so the row mounts into its editor rather than as a node called "New task".
    if (addAction.intent === 'node' && openGoalId) { actions.addRootNode(openGoalId, ''); return; }
    openTaskCapture();
  };
  // The key handler is bound once and would otherwise close over the first
  // render's view. A ref keeps ⌘N and the button on the same resolver without
  // re-binding the listener on every navigation.
  const runAddActionRef = useRef(runAddAction);
  runAddActionRef.current = runAddAction;

  useEffect(() => {
    initStore();
  }, []);

  /**
   * The renderer's half of the agent bridge — the store owner answering a
   * question that arrived over the socket.
   *
   * The guard is HERE and nowhere earlier: `agentSocket.cjs` and
   * `agentIpc.cjs` import nothing from `src/` by design, so the renderer is
   * the first side of the seam that can spend `validAgentRequest`. A request
   * from another process is untrusted until it has.
   *
   * It reads `getState()` rather than this render's props: the effect
   * subscribes ONCE, so an answer shaped from the first render's snapshot
   * would go stale the moment anything was edited. `storeActions` is the
   * module singleton for the same reason — the destructured `actions` above is
   * the identical object, but taking it from the render would read as though
   * this depended on one.
   *
   * Reads answer first and writes are the FALL-THROUGH, which is why
   * `handleAgentRead` returns `null` rather than an error: the two halves never
   * list the fourteen verbs twice, so a verb cannot be a read here and a write
   * there.
   */
  useEffect(() => {
    const bridge = createAgentBridge();
    if (!bridge.available) return;
    return bridge.onRequest((id, request) => {
      if (!validAgentRequest(request)) {
        bridge.reply(id, errorResponse('Not a request Phase understands.'));
        return;
      }
      // An open editor's unsaved typing lands first, so a note read from a
      // terminal cannot be a second behind the screen, and a note WRITE
      // cannot be built on a stale document.
      storeActions.flushNote();
      const read = handleAgentRead(request, getState());
      bridge.reply(id, read ?? handleAgentWrite(request, {
        actions: storeActions,
        getState,
      }));
    });
  }, []);

  /**
   * The renderer's half of the PhasePhone bridge — ingest the journal, export
   * the canonical file.
   *
   * It lives HERE for the same reason the agent bridge does: this renderer is
   * the single writer, so it is the only side of the process seam that may
   * touch the store. `syncFiles.cjs` moves bytes and knows nothing about what
   * a line means; this effect maps every line onto the actions the UI calls
   * and lets undo, toasts and the persist latch happen exactly as they always
   * do.
   *
   * THREE gates, and each closes a different door. `hydration === 'ready'`,
   * because ingesting into a half-loaded store would write against goals that
   * are not there yet. `phaseSync !== undefined`, because a plain browser has
   * no preload. And `ownsSingleWriterLock()`, because ingest and export are
   * both WRITES — a second window doing either would rewrite the owner's
   * database and stamp its own generation over the owner's file, which is the
   * whole reason `ifOwner` exists.
   *
   * The high-water mark is mirrored in a local so `IngestDeps` can stay
   * synchronous, and written back to Dexie AFTER the round rather than per op:
   * `ingestJournal` already advances its own copy per op, so a crash mid-round
   * costs at most a replay of ticks that are idempotent anyway, and one
   * settings write per round beats one per tick.
   *
   * The export is scheduled off `subscribe` and compared by REFERENCE on the
   * five entity slices — the store notifies for every UI flicker (a hovered
   * row, an open popover), and a file the phone polls must not be rewritten
   * because a menu opened. The flush after an ingest is immediate, not
   * debounced: the phone is waiting to learn its ops landed.
   */
  useEffect(() => {
    if (hydration !== 'ready') return;
    const sync = syncBridge();
    if (!sync || !ownsSingleWriterLock()) return;

    let stopped = false;
    let mark: string | null = null;
    let advanced = false;

    const slices = () => {
      const s = getState();
      return { goals: s.goals, habits: s.habits, tasks: s.tasks, sessions: s.sessions, lives: s.lives };
    };

    const exporter = createSyncExporter({
      getSlices: slices,
      loadMeta: loadSyncMeta,
      saveMeta: saveSyncMeta,
      writeState: (text) => sync.writeState(text),
      now: () => new Date().toISOString(),
    });

    const ingest = async (text: string | null) => {
      if (stopped || text === null) return;
      advanced = false;
      const { applied, skipped } = ingestJournal(text, {
        actions: storeActions,
        getState,
        getIngestedThrough: () => mark,
        setIngestedThrough: (id) => {
          mark = id;
          advanced = true;
        },
      });
      if (!advanced) return;
      // Re-read rather than reuse the meta loaded at mount: the exporter has
      // been bumping `generation` in the same row all along.
      const meta = await loadSyncMeta();
      await saveSyncMeta({ ...meta, ingestedThroughOpId: mark });
      const notice = ingestToast(applied, skipped);
      if (notice) storeActions.showToast(notice);
      // Immediate, so the file the phone reads next carries the op id it is
      // waiting to see.
      await exporter.flush();
    };

    void (async () => {
      mark = (await loadSyncMeta()).ingestedThroughOpId;
      if (stopped) return;
      // Pull once: main starts watching before this page finished loading, so
      // its first push was dropped before anything was listening.
      await ingest(await sync.requestJournal().catch(() => null));
      if (stopped) return;
      // A container with no `state.json` leaves the phone with nothing to
      // render, so one export at launch rather than waiting for an edit.
      await exporter.flush();
    })();

    const unsubscribeJournal = sync.onJournal((text) => void ingest(text));

    let last = slices();
    const unsubscribeStore = subscribe(() => {
      const next = slices();
      if (
        next.goals === last.goals && next.habits === last.habits && next.tasks === last.tasks &&
        next.sessions === last.sessions && next.lives === last.lives
      ) return;
      last = next;
      exporter.schedule();
    });

    return () => {
      stopped = true;
      unsubscribeJournal();
      unsubscribeStore();
    };
  }, [hydration]);

  // Live-follow the OS theme: keep the effective-icon in sync, and when the
  // preference is `system` re-apply so the palette flips without a reload.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      setSysDark(e.matches);
      if (readStoredTheme() === 'system') applyTheme(resolveTheme('system', e.matches));
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const effectiveTheme = resolveTheme(theme, sysDark);
  const isNavItemActive = (key: (typeof NAV_TABS)[number][0]): boolean =>
    view === key || (view === 'project' && key === 'goals');

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      // Both chords are claimed by the browser (⌘N new window, Ctrl+K address
      // bar), so they need suppressing before anything else looks at them.
      if (shouldConsumeTaskCaptureShortcut(e) || shouldConsumePaletteShortcut(e)) {
        e.preventDefault();
      }
      const command = resolveAppKeyCommand(e);
      // While the cheat sheet is up it owns the keyboard: ? or Esc dismiss it,
      // everything else is swallowed so nothing fires behind the overlay.
      if (showShortcuts) {
        if (command === 'toggle-shortcuts' || command === 'close-drawer') {
          setShowShortcuts(false);
        }
        return;
      }
      if (command === 'toggle-shortcuts') {
        setShowShortcuts(true);
        return;
      }
      // Search is reachable from every surface, including over an open drawer —
      // that is the whole point of a palette.
      if (command === 'open-palette') {
        if (hydration === 'ready') setPaletteOpen((was) => !was);
        return;
      }
      if (command === 'undo') {
        actions.undoLastDelete();
        return;
      }
      if (command === 'capture-task') {
        runAddActionRef.current();
        return;
      }
      if (command === 'blur-target') {
        (e.target as HTMLElement).blur();
        return;
      }
      // Escape precedence: open modal -> step panel -> project page.
      if (shouldCloseStepPanel(command, view, modalRegistry.hasOpenModal(), openStepId !== null)) {
        actions.closeStep();
        return;
      }
      // Escape on the project page goes back to the board. `close-drawer` is
      // the command's historical name; the drawer it referred to is gone.
      //
      // A milestone workspace is one more layer between the two, so it peels
      // off first: Escape out of it lands on the goal that contains it, and a
      // second Escape leaves for the board. Skipping straight past the goal
      // would be the "dump users back at a generic screen" the whole
      // preserve-context rule exists to prevent.
      if (shouldLeaveProjectPage(command, view, modalRegistry.hasOpenModal(), openStepId !== null)) {
        if (openAreaId !== null) actions.closeArea();
        else actions.closeProject();
      }
      // View/navigation shortcuts must not fire underneath an open dialog — inside
      // a dialog, 1–7 mean "plan this step on that weekday", not "switch view".
      if (modalRegistry.hasOpenModal()) return;
      if (command === 'view-today') actions.setView('today');
      if (command === 'view-plan') actions.setView('plan');
      if (command === 'view-goals') actions.setView('goals');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, hydration, openAreaId, openStepId, showShortcuts, view]);


  /**
   * The palette's verbs, resolved against the app shell.
   *
   * They live here rather than in the palette because most of them are things
   * only App can do — open the file picker, raise the cheat sheet, cycle the
   * theme — and because the registry that names them (`lib/commands.ts`) has to
   * stay free of the store to be testable.
   */
  function runPaletteCommand(id: string): void {
    switch (id) {
      // The palette closes through its own completion flow; here we only choose
      // which surface deserves the assistant — the shelf on desktop, the
      // in-app panel in the browser. `setAssistantOpen` is never reached on
      // desktop, so the Hub cannot grow its own assistant panel alongside the
      // floating window.
      case 'assistant': openAssistantForEnvironment(shell, () => setAssistantOpen(true)); return;
      case 'add-task': openTaskCapture(); return;
      case 'new-goal': actions.setGoalModal('new'); return;
      case 'import-goal': actions.setGoalModal('import'); return;
      case 'nav-today': actions.setView('today'); return;
      case 'nav-plan': actions.setView('plan'); return;
      case 'nav-goals': actions.setGoalsMode('board'); actions.setView('goals'); return;
      case 'nav-timeline': actions.setGoalsMode('timeline'); actions.setView('goals'); return;
      case 'theme': actions.setTheme(NEXT_THEME[theme]); return;
      case 'shortcuts': setShowShortcuts(true); return;
      case 'export': void actions.exportBackup(); return;
      case 'import': fileInputRef.current?.click(); return;
      case 'reclaim': reclaimSpace(); return;
      case 'settings': actions.openSettings(); return;
    }
  }

  /**
   * A verb applied to something the palette found.
   *
   * Search used to be navigation-only: every result opened a location and left
   * the user to find the control. `aimMin: 0` on the two scheduling verbs means
   * "the earliest gap that fits", the same rule `replanNode` uses — the palette
   * is not the place to choose an hour, and the store refuses with a toast when
   * the day has no room.
   */
  function runObjectAction(entry: SearchEntry, action: ObjectActionId): void {
    const isNode = entry.kind === 'step' && entry.goalId !== null && entry.nodeId !== undefined;
    const day = action === 'schedule-tomorrow' ? addDays(todayStr(), 1) : todayStr();

    switch (action) {
      case 'open':
        if (entry.kind === 'project' && entry.goalId) actions.openProject(entry.goalId);
        else if (isNode) actions.openProject(entry.goalId!, entry.nodeId);
        else actions.revealInPlan(entry.kind === 'habit' ? 'habit' : 'task', entry.id);
        return;
      case 'complete':
      case 'reopen':
        if (isNode) actions.toggleLeaf(entry.nodeId!);
        else if (entry.kind === 'task') actions.toggleTask(entry.id);
        return;
      case 'schedule-today':
      case 'schedule-tomorrow':
        if (isNode) actions.scheduleNode(entry.goalId!, entry.nodeId!, day, 0);
        else if (entry.kind === 'task') actions.scheduleTask(entry.id, day, 0);
        return;
      case 'unschedule':
        if (isNode) actions.unscheduleNode(entry.goalId!, entry.nodeId!);
        else if (entry.kind === 'task') actions.unscheduleTask(entry.id);
        return;
      case 'plan-next':
        if (entry.goalId) actions.planNextStepFor(entry.goalId);
        return;
      case 'complete-goal':
        if (entry.goalId) actions.completeGoal(entry.goalId);
        return;
    }
  }

  return (
    <>
      {/* Top bar. Every flex child is min-w-0 so nothing can force the document
          wider than the viewport — that overflow is what broke mobile.

          `overflow-x-clip`, NOT `overflow-hidden`. The guard only ever needed
          the horizontal axis, but `overflow: hidden` cannot apply to one axis
          alone: per CSS, a non-`visible` value on one axis computes the other
          from `visible` to `auto`, making the header a scroll container
          vertically too. That clipped the ⋯ menu — which is absolutely
          positioned below the bar — to a ~7px sliver, and since the inline
          utility cluster is `hidden lg:flex` and neither has a shortcut, Export
          and Import backup had NO reachable entry point at all under 1024px.
          `clip` is the one overflow value that does not infect the other axis,
          so the horizontal protection stays and the menu escapes.

          The left padding is asymmetric on the desktop build, and MEASURED.
          `main.cjs` opens the window `titleBarStyle: 'hiddenInset'`, which puts
          web content under the title bar — window origin and content origin are
          the same point — while macOS keeps drawing the traffic lights on top
          of it. Probed against a live window, the three buttons span x=11→73pt
          and the wordmark's box ran x=36→97pt: the lights sat ON the first half
          of `Phase.` and nothing in the web layer could report the collision,
          because `capturePage()` photographs web contents and the buttons are
          not in it. 80px clears the zoom button by 7pt.

          Left and right are spelled separately rather than `px-…` plus a `pl-…`
          override: both set `padding-left`, so which one wins is decided by
          their order in the emitted stylesheet rather than by the order they
          appear here, and that is not a thing to make a header's left edge
          depend on.

          Known gap: entering macOS fullscreen hides the traffic lights, and the
          gutter stays. Closing it needs the shell to tell the renderer about
          enter/leave-full-screen — a new channel, which is more surface than a
          secondary state is worth until someone asks. */}
      <header
        className={`sticky top-0 z-30 bg-bg border-b border-line flex items-center gap-[12px] lg:gap-[30px] pr-[16px] sm:pr-[36px] py-[13px] overflow-x-clip ${
          shell.insetTitleBar ? 'pl-[80px]' : 'pl-[16px] sm:pl-[36px]'
        }`}
      >
        <div className="flex items-baseline gap-[10px] flex-none">
          <span className="font-disp text-wordmark font-[650] tracking-[-0.01em]">
            Phase<span className="text-accent">.</span>
          </span>
        </div>
        {/* Primary nav. Below md it moves to the bottom bar for thumb reach.

            A segmented track in the vocabulary `SegmentedControl.tsx` settled
            on — `bg-raised` over `bg-chip`, never a solid inverted segment.
            This bar was the last surviving instance of the treatment that file
            lists among the four it retired ("SOLID INVERTED segment"), and it
            never got converted because it is the one segmented control that is
            navigation rather than a value or a view state. Its cost here was
            specific: `bg-ink text-paper` put a SECOND filled black object in a
            bar that already has one, so `+ Add` — the only thing here that
            should carry fill, being the only thing that writes anything — had
            to share the eye with a tab that merely says where you are.

            `aria-current="page"`, not `aria-pressed`: these are destinations.
            That is the whole reason this cannot simply BE a `SegmentedSwitch`,
            and why the vocabulary is borrowed rather than the component.

            Every tab stays `font-medium`. Bolding the active one resized its
            text and shoved its neighbours sideways on every navigation — the
            desktop tabs are content-sized, so unlike the bottom bar's `flex-1`
            thirds there was nothing to absorb it. */}
        <nav
          aria-label="Views"
          className="hidden md:flex flex-none items-center gap-[2px] h-[28px] p-[2px] rounded-field bg-chip min-w-0"
        >
          {NAV_TABS.map(([key, label], i) => {
            const active = isNavItemActive(key);
            return (
              <button
                key={key}
                onClick={() => actions.setView(key)}
                aria-current={active ? 'page' : undefined}
                title={`${label} (${i + 1})`}
                /* `rounded-[6px]` inside the track's `rounded-field` (8px) is
                   concentric: nested radii step DOWN, they do not mix. */
                className={`px-[12px] py-[3px] leading-[18px] rounded-[6px] text-body font-medium whitespace-nowrap transition-colors duration-100 ${
                  active ? 'bg-raised text-ink shadow-card' : 'text-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            );
          })}
        </nav>
        <div className="flex-1 min-w-0" />

        {/* The utility cluster — ONE group, not three islands. The header's own
            `lg:gap-[30px]` used to fall between Search, Add and the `⋯`, so at
            desktop widths the three sat as far apart from each other as the
            wordmark sits from the nav, and read as three unrelated objects
            rather than the toolbar they are. The wide gap is for separating
            REGIONS; inside a region 8px is the whole relationship.

            Every control here is 28px, which is what the `⋯` already was — the
            bar is standardised UP to the shared component rather than the
            component down to the bar, so `ProjectHeader`, the other place
            `HeaderMenu` is spent, does not move. */}
        <div className="flex-none flex items-center gap-[8px]">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            disabled={hydration !== 'ready'}
            aria-label="Search (⌘K)"
            title="Search (⌘K)"
            className="flex items-center gap-[7px] h-[28px] rounded-field border border-line-2 text-muted text-ui px-[9px] sm:pl-[10px] sm:pr-[8px] hover:text-ink hover:border-muted disabled:opacity-40 disabled:pointer-events-none"
          >
            <IconSearch />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline font-mono text-kbd tracking-[.04em] border border-line-2 rounded-[4px] px-[4px] py-[1px]">⌘K</kbd>
          </button>

          {/* The one filled control in the header, and the only one that writes
              anything. Everything around it navigates, searches or configures. */}
          <button
            type="button"
            onClick={runAddAction}
            disabled={hydration !== 'ready'}
            aria-label={addAction.title}
            title={addAction.title}
            className="flex items-center gap-[7px] h-[28px] rounded-field bg-ink text-paper text-ui font-semibold px-[9px] sm:pl-[12px] sm:pr-[10px] hover:bg-ink-hover disabled:opacity-40 disabled:pointer-events-none"
          >
            <IconPlus />
            <span className="hidden sm:inline whitespace-nowrap">{addAction.label}</span>
            <kbd className="hidden sm:inline font-mono text-kbd tracking-[.04em] text-paper/70 border border-paper/25 rounded-[4px] px-[4px] py-[1px]">⌘N</kbd>
          </button>

          <HeaderMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <HeaderMenuItem onClick={() => actions.setTheme(NEXT_THEME[theme])}>
              {effectiveTheme === 'dark' ? <IconMoon /> : <IconSun />}
              Theme: {THEME_LABEL[theme]}
            </HeaderMenuItem>
            {/* `IconClock` is a leftover from when this row opened working
                hours; the dialog now holds Lives, the assistant shortcut and
                launch-at-login, none of which is a clock. Left as-is rather
                than swapped inside a removal — picking the right glyph is a
                design call, not a consequence of deleting a model. */}
            <HeaderMenuItem onClick={actions.openSettings}>
              <IconClock />
              Settings
            </HeaderMenuItem>
            <HeaderMenuItem onClick={() => setShowShortcuts(true)}>
              {/* Stays a character: `?` is ASCII, it is in the font, and it is the
                  literal key you press. The 14px box keeps it in the icon gutter. */}
              <span aria-hidden="true" className="w-[14px] text-center">?</span>
              Keyboard shortcuts
            </HeaderMenuItem>
            <HeaderMenuItem onClick={() => actions.exportBackup()} disabled={hydration !== 'ready'}>
              <IconArrowDown />
              Export backup
            </HeaderMenuItem>
            <HeaderMenuItem onClick={reclaimSpace} disabled={hydration !== 'ready'}>
              <IconBackspace />
              Reclaim space
            </HeaderMenuItem>
            <HeaderMenuItem onClick={() => fileInputRef.current?.click()} disabled={hydration !== 'ready'}>
              <IconArrowUp />
              Import backup
            </HeaderMenuItem>
          </HeaderMenu>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Reset unconditionally, and BEFORE the modal resolves: picking the
            // same file twice must fire `change` again, and the File object is
            // already captured in state by then.
            e.target.value = '';
            if (f) setPendingImport(f);
          }}
        />
      </header>

      {/* The banner has to state the consequence, not just the situation.
          Writes from this tab are now blocked (see setAndPersist) rather than
          allowed to rewrite the whole database from a stale snapshot, so what
          the user needs to know is that anything typed here is not being kept. */}
      {secondTab && (
        <div role="alert" className="bg-warn-tint text-warn text-ui px-[16px] sm:px-[36px] py-[7px] border-b border-line">
          Phase is open in another tab, which owns your data. <strong className="font-semibold">Changes made
          here are not saved</strong> — switch to the other tab, or close it and reload this one.
        </div>
      )}

      {/* A failed write is the one condition that can silently cost a whole
          session, so it latches here rather than passing through as a toast.
          Export is offered inline because that is the only recovery, and the
          toast that used to say so was gone in 1.9 seconds. */}
      {persistFailed && (
        <div
          role="alert"
          className="bg-warn-tint text-warn text-ui px-[16px] sm:px-[36px] py-[7px] border-b border-line flex flex-wrap items-center gap-x-[8px] gap-y-[2px]"
        >
          <span>
            Phase couldn’t save to this device. Your work is here but only in this tab — closing it loses
            everything since the last successful save.
          </span>
          <button
            type="button"
            onClick={() => actions.exportBackup()}
            disabled={hydration !== 'ready'}
            className="font-semibold underline hover:no-underline min-h-[24px] inline-flex items-center"
          >
            Export a backup
          </button>
        </div>
      )}

      {/* Main */}
      {/* Bottom padding clears the mobile tab bar; it is absent from md up. */}
      <main className="flex-1 min-w-0 pb-[60px] md:pb-0 flex flex-col">
        {hydration === 'error' ? (
          <div className="max-w-[520px] mx-auto mt-[80px] px-[24px] text-center">
            <div className="text-h1 font-semibold mb-[10px]">
              Phase can’t reach its local database
            </div>
            <p className="text-lead text-muted leading-[1.6] mb-[18px]">
              Your data lives in this browser’s storage (IndexedDB) and nothing has been
              deleted — but it can’t be opened right now. This usually means private
              browsing, blocked site data, or a full disk.
            </p>
            <button
              className="text-body font-semibold text-paper bg-ink px-[14px] py-[8px] rounded-field hover:bg-ink-hover"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        ) : hydration === 'loading' ? (
          // A slow IndexedDB open used to render a blank page under a populated
          // header, which reads as breakage rather than as waiting.
          <div role="status" className="max-w-[420px] mx-auto mt-[100px] px-[24px] text-center">
            <div className="text-lead text-muted">Opening your local database…</div>
          </div>
        ) : view === 'today' ? (
          /* Full-bleed, and the ONLY view that gets the region's leftover
             height. Today's frame draws its own margins — hatched gutters
             bounded by a hairline — so the page padding every other view wants
             would sit outside the frame as a band of nothing, and the hatched
             tail under the last row needs a height to grow into. */
          <div className="w-full flex-1 min-h-0 flex flex-col">
            <Today onCapture={openTaskCapture} />
          </div>
        ) : view === 'plan' ? (
          <div className="w-full px-[16px] sm:px-[36px] py-[18px]">
            <Plan />
          </div>
        ) : view === 'project' ? (
          <div className="w-full px-[16px] sm:px-[36px] py-[20px] pb-[90px]">
            <Project />
          </div>
        ) : (
          // Full-bleed on purpose: Goals owns its own measure, because the
          // timeline it now contains needs the whole viewport to scroll a
          // semester across, and the board does not.
          <div className="w-full px-[16px] sm:px-[36px] py-[28px] pb-[90px]">
            <Goals />
          </div>
        )}
      </main>

      {/* Bottom tab bar — the primary nav below md, where the header row could
          not fit without pushing the document wider than the viewport. */}
      <nav
        aria-label="Views"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-bg border-t border-line flex"
      >
        {NAV_TABS.map(([key, label]) => {
          const active = isNavItemActive(key);
          return (
            <button
              key={key}
              onClick={() => actions.setView(key)}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 min-w-0 py-[10px] text-compact truncate ${
                active ? 'text-ink font-semibold' : 'text-muted font-medium'
              }`}
            >
              {label}
              <span
                aria-hidden="true"
                className={`block mx-auto mt-[4px] h-[2px] w-[18px] rounded-full ${
                  active ? 'bg-accent' : 'bg-transparent'
                }`}
              />
            </button>
          );
        })}
      </nav>

      <QuickAdd
        open={taskCapture.open}
        focusRequest={taskCapture.focusRequest}
        enabled={hydration === 'ready'}
        onClose={() => setTaskCapture((current) => closeTaskCapture(current))}
      />
      <ConfirmImportModal
        open={pendingImport !== null}
        fileName={pendingImport?.name ?? ''}
        onCancel={() => setPendingImport(null)}
        onConfirm={() => {
          if (pendingImport) actions.importBackup(pendingImport);
          setPendingImport(null);
        }}
      />
      <UpdateBanner bridge={updates} />
      <SettingsModal open={settingsOpen} onClose={actions.closeSettings} />
      {/* `effectiveTheme` and not `theme`: the overlay is a second renderer
          with no `.dark` class of its own, and `'system'` means nothing to it.
          This is the one place that resolves the preference against the OS —
          re-resolving it over there is how two windows come to disagree. */}
      <AssistantHost
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        theme={effectiveTheme}
      />
      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        goals={goals}
        tasks={tasks}
        habits={habits}
        onCommand={runPaletteCommand}
        onObjectAction={runObjectAction}
      />

      {/* Undo toast */}
      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-[20px] left-1/2 -translate-x-1/2 bg-ink text-paper px-[16px] py-[9px] rounded-field text-body z-[60] transition-all duration-[200ms] flex items-center gap-[12px] whitespace-nowrap ${
          pendingUndo
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-[20px] pointer-events-none'
        }`}
      >
        <span>{pendingUndo?.label}</span>
        <button
          className="font-semibold underline hover:no-underline min-h-[24px] px-[4px] inline-flex items-center focus-visible:outline-paper focus-visible:outline-offset-2 focus-visible:rounded-[4px]"
          onClick={() => actions.undoLastDelete()}
          tabIndex={pendingUndo ? 0 : -1}
        >
          Undo
        </button>
      </div>

      {/* Toast.
          Sits above the undo toast whenever one is armed, instead of on top of
          it. Both are bottom-centred at the same z-index, so a refusal raised
          inside the 5s undo window (delete a task, then try to schedule
          something that doesn't fit) rendered the two messages superimposed and
          neither was legible. `bottom` is part of the existing `transition-all`,
          so it slides rather than jumps when the undo toast retires. */}
      <div
        role="status"
        aria-live="polite"
        className={`fixed left-1/2 -translate-x-1/2 bg-ink text-paper px-[16px] py-[9px] rounded-field text-body z-[60] transition-all duration-[200ms] ${
          pendingUndo ? 'bottom-[68px]' : 'bottom-[20px]'
        } ${
          toast
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-[20px] pointer-events-none'
        }`}
      >
        {toast}
      </div>
    </>
  );
}
