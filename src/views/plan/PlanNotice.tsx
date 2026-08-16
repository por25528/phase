/**
 * The plan view's one notice slot.
 *
 * These were two separately-rendered boxes wearing the same border, the same
 * padding and the same tone, and nothing stopped them stacking — which pushed
 * the calendar down by two rows and made the page's first impression a pile of
 * advice. At most one shows now, and availability outranks the hint because it
 * describes a state in which the hint's instruction cannot be carried out: you
 * cannot drag anything onto a day when every day is off.
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
        No working hours set — every day is off, so nothing can be scheduled.{' '}
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
