/**
 * The plan view's one notice slot.
 *
 * These were two separately-rendered boxes wearing the same border, the same
 * padding and the same tone, and nothing stopped them stacking — which pushed
 * the calendar down by two rows and made the page's first impression a pile of
 * advice. At most one shows now.
 *
 * `needsHours` is KEPT and reworded rather than deleted, and the distinction
 * is the whole reason. Job 1 made this state unreachable by accident — every
 * install starts on `DEFAULT_AVAILABILITY` and no drop is ever refused for
 * being outside a window — but it stays reachable on purpose: a person can
 * switch every day off in Settings, and `parseAvailability` preserves an
 * explicitly empty list rather than falling back. What changed is what the
 * sentence can honestly claim. It used to say "nothing can be scheduled",
 * which is now false: you can drag onto any day, at any hour. What is actually
 * lost is the DENOMINATOR — every figure on this page is measured against
 * those windows, so with none set the header has nothing to measure. That is
 * the same distinction `todayPlan`'s `no-hours` and the shelf's `needs-hours`
 * keep, and CLAUDE.md is emphatic it is not a zero.
 *
 * It still outranks the hint, but not because it blocks the hint's
 * instruction — it does not any more. It outranks it because a page whose
 * numbers are all blank is a worse first impression than a page that has not
 * explained its drag gesture yet.
 *
 * Neither is dismissible, and neither needs to be: both retire themselves the
 * moment their condition is met.
 */
export function PlanNotice({ needsHours, showHint, onOpenSettings }: {
  needsHours: boolean;
  showHint: boolean;
  onOpenSettings: () => void;
}) {
  if (needsHours) {
    return (
      <div className="mb-[10px] px-[10px] py-[8px] rounded-field border border-line-2 bg-panel text-body text-ink-soft">
        No working hours set — every day is off, so Phase can’t say how much
        time you have. You can still put work on any day.{' '}
        <button
          type="button"
          onClick={onOpenSettings}
          className="font-semibold text-accent hover:text-accent-deep"
        >
          Set your working hours
        </button>
      </div>
    );
  }
  if (!showHint) return null;
  return (
    <div className="mb-[10px] px-[10px] py-[8px] rounded-field border border-line-2 bg-panel text-body text-ink-soft">
      Drag anything from <span className="font-semibold text-ink">To plan</span> onto a day
      to schedule it — or click a row and press{' '}
      <kbd className="font-mono text-kbd border border-line-2 rounded-[4px] px-[4px] py-[1px] text-muted">1</kbd>
      –
      <kbd className="font-mono text-kbd border border-line-2 rounded-[4px] px-[4px] py-[1px] text-muted">7</kbd>{' '}
      for Mon–Sun.
    </div>
  );
}
