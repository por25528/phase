import { todayStr } from '@app/lib/dates';
import { dayStamp } from '@app/lib/today';

/**
 * The scaffold's whole job for now: prove the `@app/*` alias reaches the
 * desktop app's pure library, so the companion spends the same derivations the
 * Mac does rather than a copy of them. `dayStamp` is the app's own date
 * vocabulary, and the phone's header is the same stamp at a smaller measure.
 */
export function App() {
  const stamp = dayStamp(todayStr());
  return (
    <div className="min-h-full flex flex-col items-start gap-[14px] px-[18px] pt-[22px]">
      <span className="inline-flex items-stretch rounded-[4px] border border-line-2 overflow-hidden">
        <span className="section-label px-[8px] py-[3px] bg-fill text-paper font-semibold">
          {stamp.dow}
        </span>
        <span className="section-label px-[8px] py-[3px] border-l border-line-2 text-muted">
          {stamp.span}
        </span>
      </span>
      <h1 className="text-page font-semibold tracking-[-0.028em] leading-[1.05]">Phase</h1>
    </div>
  );
}
