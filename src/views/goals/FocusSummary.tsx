import type { FocusSummary as FocusSummaryModel } from '../../lib/plan';

// The five board signals (spec §2.3). Each is a button that spotlights its match
// set and dims the rest; the parent owns the active filter and the dimming so no
// attention predicate is ever re-derived here. Built from app tokens → themes
// into dark automatically.

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

  return (
    <div className="mt-[16px] grid grid-cols-2 lg:grid-cols-4 items-stretch gap-[10px]">
      {signals.map((s) => {
        const isActive = active === s.key;
        const enabled = s.matchCount > 0;
        return (
          <button
            key={s.key}
            type="button"
            disabled={!enabled}
            aria-pressed={isActive}
            aria-label={`${s.label}: ${s.num} ${s.txt}${enabled ? `, ${isActive ? 'showing' : 'show'} these goals` : ''}`}
            onClick={() => enabled && onToggle(s.key)}
            className={[
              'flex flex-col gap-[3px] text-left px-[14px] py-[9px] rounded-[11px] border shadow-card min-w-0 transition-colors',
              s.warn
                ? isActive
                  ? 'bg-warn-tint border-warn'
                  : 'bg-warn-tint border-transparent hover:border-warn/40'
                : isActive
                  ? 'bg-accent-tint border-accent'
                  : 'bg-panel border-line hover:border-faint-2',
              enabled ? 'cursor-pointer' : 'opacity-55 cursor-default',
            ].join(' ')}
          >
            <span className="font-mono text-eyebrow tracking-[.11em] uppercase text-muted">{s.label}</span>
            <span className="flex items-baseline gap-[6px]">
              <span className={`font-disp text-h2 font-semibold tabular-nums leading-none ${s.warn ? 'text-warn' : ''}`}>
                {s.num}
              </span>
              <span className="text-ui text-ink-soft">{s.txt}</span>
            </span>
            {s.sub && <span className="text-badge text-warn">{s.sub}</span>}
          </button>
        );
      })}
      {active && (
        <button
          type="button"
          onClick={onClear}
          className="self-center text-compact text-muted px-[12px] py-[7px] rounded-field border border-dashed border-line-2 hover:bg-hover hover:text-ink"
        >
          Clear
        </button>
      )}
    </div>
  );
}
