import type { ReactNode } from 'react';
import type { BoardInsights } from '../../lib/boardInsights';
import { fmtD } from '../../lib/dates';

// Compact, read-only management strip above the board: board shape, what's due
// soon, and what's behind pace. Informational only in v1. Built from existing
// tokens so it themes into dark automatically.
export function InsightBar({ insights }: { insights: BoardInsights }) {
  const { total, perColumn, dueSoonCount, nearestDeadline, behindPaceCount } = insights;

  return (
    <div className="mt-[16px] rounded-card border border-line bg-panel shadow-card px-[16px] py-[11px] flex flex-wrap items-center gap-x-[22px] gap-y-[10px]">
      <Segment label="Board">
        <span className="font-disp text-[.92rem] font-semibold tabular-nums">{total}</span>
        <span className="text-[.78rem] text-muted">goal{total === 1 ? '' : 's'}</span>
        <span className="font-mono text-[.66rem] tracking-[.04em] text-muted tabular-nums ml-[2px]">
          {perColumn.join(' / ')}
        </span>
      </Segment>

      <Divider />

      <Segment label="Due soon">
        {dueSoonCount > 0 ? (
          <>
            <span className="font-disp text-[.92rem] font-semibold tabular-nums">{dueSoonCount}</span>
            <span className="text-[.78rem] text-muted">due soon</span>
          </>
        ) : (
          <span className="text-[.82rem] text-ink-soft">Nothing due soon</span>
        )}
        {nearestDeadline && (
          <span className="font-mono text-[.62rem] tracking-[.04em] text-muted ml-[2px] whitespace-nowrap">
            next · {fmtD(nearestDeadline)}
          </span>
        )}
      </Segment>

      <Divider />

      <Segment label="Behind pace">
        {behindPaceCount > 0 ? (
          <span className="inline-flex items-baseline gap-[6px]">
            <span className="font-disp text-[.92rem] font-semibold tabular-nums text-warn">{behindPaceCount}</span>
            <span className="text-[.78rem] text-warn">behind pace</span>
          </span>
        ) : (
          <span className="text-[.82rem] text-ink-soft">On pace</span>
        )}
      </Segment>
    </div>
  );
}

function Segment({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="font-mono text-[.58rem] tracking-[.1em] uppercase text-muted">{label}</span>
      <span className="flex items-baseline gap-[6px] flex-wrap">{children}</span>
    </div>
  );
}

function Divider() {
  return <span className="hidden sm:block w-px h-[28px] bg-line" aria-hidden="true" />;
}
