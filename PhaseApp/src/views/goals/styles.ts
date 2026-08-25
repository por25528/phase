// Re-exported so the board's existing imports keep working; the definition
// lives in lib/horizons because the store names a horizon in its move toast.
export { HORIZON_LABELS, HORIZON_COUNT } from '../../lib/horizons';

// The field/button classes that used to live here now live in
// components/dialogStyles.ts. They were "the goal modals' styling" only by
// accident of where they were first needed, and three dialogs outside this
// folder had each grown a near-copy in the meantime.
