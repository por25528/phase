/**
 * The plan view's one notice slot.
 *
 * There used to be two, wearing the same border, the same padding and the same
 * tone, and nothing stopped them stacking — which pushed the calendar down by
 * two rows and made the page's first impression a pile of advice. One of the
 * two was about working hours and went with them; what is left is the drag
 * gesture, taught once.
 *
 * Not dismissible, and it does not need to be: it retires itself the moment
 * anything is placed.
 */
export function PlanNotice({ showHint }: { showHint: boolean }) {
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
