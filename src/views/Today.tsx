import { useState, useRef } from 'react';
import { Hero } from './today/Hero';
import { WeekStrip } from './today/WeekStrip';
import { HabitsCard } from './today/HabitsCard';
import { StudyLogCard } from './today/StudyLogCard';
import { TasksCard } from './today/TasksCard';
import { GoalsCard } from './today/GoalsCard';
import { MiniCalendar } from './today/MiniCalendar';
import { QuickAdd } from './today/QuickAdd';
import type { QuickType } from './today/QuickAdd';

export function Today() {
  const quickRef = useRef<HTMLInputElement>(null);
  const [quickType, setQuickType] = useState<QuickType>('task');
  function focusQuick(t: QuickType) {
    setQuickType(t);
    quickRef.current?.focus();
  }

  return (
    <div className="pt-[26px]">
      {/* Hero + quick add */}
      <div className="today-hero grid gap-[28px] items-end mb-[20px]">
        <Hero />
        <QuickAdd type={quickType} onType={setQuickType} inputRef={quickRef} />
      </div>

      <WeekStrip />

      {/* Main grid */}
      <div className="today-main grid gap-[22px] items-start mt-[20px]">
        <div className="flex flex-col gap-[18px] min-w-0">
          <HabitsCard />
          <StudyLogCard />
          <TasksCard />
        </div>
        <div className="flex flex-col gap-[18px] min-w-0">
          <GoalsCard onAddGoal={() => focusQuick('goal')} />
          <MiniCalendar />
        </div>
      </div>

      {/* FooterStats mounts here in Task 12 */}
    </div>
  );
}
