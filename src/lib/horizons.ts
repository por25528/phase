// Commitment horizons, left → right (column 0 → 3). The order IS the model:
// a project's column is its horizon; height within a column is rank in-horizon.
//
// These live in `lib`, not in `views/goals/styles`, because the store needs
// them too — it names the destination in the "Moved X to Later" toast. It used
// to keep its own `const HORIZON_COUNT = 4` instead, since a store importing
// from a view is the wrong direction; one definition here removes the
// duplication rather than adding a second one.
export const HORIZON_LABELS = ['Now', 'Next', 'Later', 'Someday'] as const;
export const HORIZON_COUNT = HORIZON_LABELS.length;
