// Re-exported so the board's existing imports keep working; the definition
// lives in lib/horizons because the store names a horizon in its move toast.
export { HORIZON_LABELS, HORIZON_COUNT } from '../../lib/horizons';

// Shared field/button styling used by the goal-creation modals.
export const fieldCls =
  'rounded-field border border-line-2 px-[8px] py-[5px] text-ui text-ink bg-transparent outline-none focus-visible:border-accent';
export const labelCls = 'text-meta font-medium text-muted';
export const primaryBtn =
  'text-body font-semibold text-paper bg-ink px-[13px] py-[7px] rounded-field hover:bg-ink-hover disabled:opacity-40';
export const ghostBtn = 'text-body text-muted px-[10px] py-[7px] rounded-field hover:bg-hover';
