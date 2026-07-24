import { useMemo, useState, useRef } from 'react';
import { Hero } from './today/Hero';
import { WeekStrip } from './today/WeekStrip';
import { HabitsCard } from './today/HabitsCard';
import { TodayWorkCard } from './today/TodayWorkCard';
import { WorthConsideringCard } from './today/WorthConsideringCard';
import { GoalsCard } from './today/GoalsCard';
import { MiniCalendar } from './today/MiniCalendar';
import { QuickAdd } from './today/QuickAdd';
import type { QuickType } from './today/QuickAdd';
import { useAppStore } from '../state/store';
import { useLocalDate } from '../hooks/useLocalDate';
import { buildDailyWork } from '../lib/dailyWork';

export function Today() {
  const { goals, tasks } = useAppStore();
  const today = useLocalDate();
  const dailyWork = useMemo(
    () => buildDailyWork(goals, tasks, today),
    [goals, tasks, today],
  );
  const quickRef = useRef<HTMLInputElement>(null);
  // Default the quick box to Task — the thing captured most; the GoalsCard's
  // "add goal" affordance still flips it to Goal on demand.
  const [quickType, setQuickType] = useState<QuickType>('task');
  function focusQuick(t: QuickType) {
    setQuickType(t);
    quickRef.current?.focus();
  }

  return (
    <div className="pt-[18px]">
      {/* Hero + quick add */}
      <div className="today-hero grid gap-[24px] items-end mb-[13px]">
        <Hero />
        <QuickAdd type={quickType} onType={setQuickType} inputRef={quickRef} />
      </div>

      <WeekStrip />

      {/* Main grid */}
      <div className="today-main grid gap-[20px] items-start mt-[14px]">
        <div className="flex flex-col gap-[14px] min-w-0">
          <HabitsCard />
          <TodayWorkCard sections={dailyWork} today={today} />
          <WorthConsideringCard sections={dailyWork} today={today} />
        </div>
        <div className="flex flex-col gap-[14px] min-w-0">
          <GoalsCard onAddGoal={() => focusQuick('goal')} />
          <MiniCalendar />
        </div>
      </div>
    </div>
  );
}
