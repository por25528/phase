import { useEffect, useRef, useState } from 'react';
import { millisecondsUntilNextLocalMidnight, todayStr } from '../lib/dates';

/**
 * Current local calendar date, kept live across midnight while the view stays mounted.
 * The optional callback runs once after each observed day change.
 */
export function useLocalDate(onDayChange?: () => void): string {
  const [localDate, setLocalDate] = useState(todayStr);
  const localDateRef = useRef(localDate);
  const onDayChangeRef = useRef(onDayChange);
  onDayChangeRef.current = onDayChange;

  useEffect(() => {
    let timer: number | undefined;

    function scheduleNextMidnight(): void {
      const delay = millisecondsUntilNextLocalMidnight(new Date()) + 100;
      timer = window.setTimeout(() => {
        const nextDate = todayStr();
        if (nextDate !== localDateRef.current) {
          localDateRef.current = nextDate;
          setLocalDate(nextDate);
          onDayChangeRef.current?.();
        }
        scheduleNextMidnight();
      }, delay);
    }

    scheduleNextMidnight();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return localDate;
}
