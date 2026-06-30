interface Props {
  pct: number; // 0–100
}

export function ProgressBar({ pct }: Props) {
  return (
    <div className="h-[6px] bg-track rounded-[6px] overflow-hidden flex-1">
      <i
        className="block h-full bg-fill rounded-[6px] transition-[width] duration-[250ms] ease-in-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
