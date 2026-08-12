import type { FocusSummary as FocusSummaryModel } from '../../lib/plan';

/**
 * The board's attention signals, as one row of filters.
 *
 * They were five bordered, shadowed tiles with 24px numerals, in a grid above
 * the goals — a dashboard band standing between the reader and the object they
 * came for, on every visit, whether or not any of it applied. On a common
 * laptop height it pushed the first card below the fold. And because they are
 * also FILTERS, the band was teaching a card-shaped thing to be clicked.
 *
 * A chip row says the same five things in one line and reads as what it is: a
 * filter. A signal matching nothing is dropped entirely rather than shown
 * greyed — an always-present row of mostly-zero counters is the same "learn to
 * skip this region" failure the tiles had, just shorter.
 *
 * Each button spotlights its match set and dims the rest; the parent owns the
 * active filter and the dimming, so no attention predicate is re-derived here.
 */

export type FocusFilter = 'slots' | 'needs-step' | 'behind' | 'planned' | 'blocked';

interface Signal {
  key: FocusFilter;
  label: string;
  num: string;
  txt: string;
  matchCount: number; // clickable only when > 0
  warn?: boolean;
  sub?: string;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function FocusSummary({
  summary,
  active,
  onToggle,
  onClear,
}: {
  summary: FocusSummaryModel;
  active: FocusFilter | null;
  onToggle: (f: FocusFilter) => void;
  onClear: () => void;
}) {
  const { slots, needsFirstStep, behind, plannedRemaining, blocked } = summary;
  const over = slots.used > slots.limit;

  const signals: Signal[] = [
    {
      key: 'slots',
      label: 'Focus',
      num: `${slots.used} of ${slots.limit}`,
      txt: 'focus slots used',
      matchCount: slots.goalIds.length,
      warn: over,
      sub: over ? `Focus is spread across ${slots.used} goals` : undefined,
    },
    {
      key: 'needs-step',
      label: 'Next task',
      num: String(needsFirstStep.count),
      txt: `Now ${plural(needsFirstStep.count, 'goal needs', 'goals need')} a first task`,
      matchCount: needsFirstStep.count,
    },
    {
      key: 'behind',
      label: 'Schedule',
      num: String(behind.count),
      txt: `${plural(behind.count, 'goal', 'goals')} behind schedule`,
      matchCount: behind.count,
    },
    {
      key: 'planned',
      label: 'This week',
      num: String(plannedRemaining.count),
      txt: `planned ${plural(plannedRemaining.count, 'action', 'actions')} left`,
      matchCount: plannedRemaining.count,
    },
    {
      // "Blocked" alone reads as the same quantity the board card's "N
      // blocked" chip counts — but that chip counts STEPS, and this signal
      // counts whole PROJECTS with nothing left workable. Clicking "Blocked"
      // then dims a card that visibly says "2 blocked", which looks like a
      // contradiction unless the label itself says which noun it means.
      key: 'blocked',
      label: 'Blocked goals',
      num: String(blocked.count),
      txt: `${plural(blocked.count, 'goal has', 'goals have')} every task stuck`,
      matchCount: blocked.count,
    },
  ];

  // A signal with nothing behind it is dropped, not greyed. A permanent row of
  // zeroes is a region people learn to skip, which is the failure the tiles had.
  const live = signals.filter((s) => s.matchCount > 0);
  if (live.length === 0) return null;

  return (
    <div role="group" aria-label="Filter goals" className="mt-[14px] flex flex-wrap items-center gap-[6px]">
      {live.map((s) => {
        const isActive = active === s.key;
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={isActive}
            aria-label={`${s.label}: ${s.num} ${s.txt}. ${isActive ? 'Showing' : 'Show'} these goals`}
            title={s.sub ?? s.txt}
            onClick={() => onToggle(s.key)}
            className={[
              'flex items-baseline gap-[5px] text-meta px-[9px] py-[4px] rounded-field border transition-colors',
              isActive
                ? 'bg-accent-tint border-accent text-ink'
                : s.warn
                  ? 'bg-warn-tint border-transparent text-warn hover:border-warn/40'
                  : 'border-line-2 text-ink-soft hover:bg-hover',
            ].join(' ')}
          >
            <span className="font-semibold tabular-nums">{s.num}</span>
            <span className={isActive ? 'text-ink-soft' : 'text-muted'}>{s.txt}</span>
          </button>
        );
      })}
      {active && (
        <button
          type="button"
          onClick={onClear}
          className="text-meta text-muted px-[8px] py-[4px] rounded-field hover:bg-hover hover:text-ink"
        >
          Clear filter
        </button>
      )}
    </div>
  );
}
