// TODO(round-2): full Timeline UI — see prototype.html
import { useAppStore } from '../state/store';

export function Timeline() {
  const { goals: _goals } = useAppStore();

  return (
    <div>
      <h1 className="font-disp text-[1.74rem] font-semibold tracking-[-0.015em] mb-[3px]">Timeline</h1>
      <p className="text-muted text-[.86rem] mb-[30px]">
        Your year as production phases. Bar length is the time span; the fill is progress. Click a bar to open its plan.
      </p>
      <p className="text-muted text-[.76rem]">Timeline coming next.</p>
    </div>
  );
}
