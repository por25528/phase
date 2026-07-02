export function TodayCheckbox({
  checked,
  onToggle,
  ariaLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={`w-[22px] h-[22px] border-[1.5px] rounded-[7px] flex-shrink-0 grid place-items-center transition-colors duration-100 ${
        checked ? 'bg-accent border-accent' : 'bg-field border-line-2 hover:border-muted'
      }`}
    >
      <svg
        viewBox="0 0 12 12"
        className={`w-[12px] h-[12px] stroke-accent-contrast fill-none transition-opacity duration-100 ${
          checked ? 'opacity-100' : 'opacity-0'
        }`}
        strokeWidth={2.4}
      >
        <path d="M2 6.2 4.6 9 10 3" />
      </svg>
    </button>
  );
}
