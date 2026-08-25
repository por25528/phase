import type { ReactNode } from 'react';

/**
 * The app's `RuleHeader`, restated at phone width: the label in a tinted cell
 * at the LEFT END of the divider, the way a legend sits on a technical
 * drawing, with the section's one fact in a cell on the far end.
 *
 * `right` is a FACT and never a control — the same rule the desktop's header
 * holds. It is not imported from `@app/components` because that is a VIEW, and
 * the phone's door into the app opens on `lib` and the domain types alone.
 *
 * The fact sits OUTSIDE the `<h2>`. Inside it, the heading's accessible name
 * would be the label and the count run together — "Today 2" — which is a name
 * that changes every time somebody ticks something.
 */
export function SectionRule({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <div className="flex items-stretch border-b border-line">
      <h2 className="section-label px-[10px] py-[6px] bg-chip text-chip-ink border-r border-line">
        {label}
      </h2>
      <span className="flex-1" />
      {right !== undefined && (
        <span className="text-meta text-muted px-[10px] py-[6px] border-l border-line tabular-nums">
          {right}
        </span>
      )}
    </div>
  );
}
