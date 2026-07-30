// Commitment horizons, left → right (column 0 → 3). The order IS the model:
// a project's column is its horizon; height within a column is rank in-horizon.
export const HORIZON_LABELS = ['Now', 'Next', 'Later', 'Someday'] as const;
export const HORIZON_COUNT = HORIZON_LABELS.length;

// Shared field/button styling used by the goal-creation modals.
export const fieldCls =
  'rounded-field border border-line-2 px-[8px] py-[5px] text-ui text-ink bg-transparent outline-none focus-visible:border-accent';
export const labelCls = 'text-meta font-medium text-muted';
export const primaryBtn =
  'text-body font-semibold text-paper bg-ink px-[13px] py-[7px] rounded-field hover:bg-ink-hover disabled:opacity-40';
export const ghostBtn = 'text-body text-muted px-[10px] py-[7px] rounded-field hover:bg-hover';
