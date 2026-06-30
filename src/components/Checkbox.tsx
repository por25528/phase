interface Props {
  checked: boolean;
  onClick: () => void;
}

export function Checkbox({ checked, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className={`w-[17px] h-[17px] border-[1.5px] rounded-[5px] flex-shrink-0 grid place-items-center transition-all duration-100 cursor-pointer ${
        checked
          ? 'bg-fill border-fill'
          : 'border-line-2 hover:border-muted'
      }`}
    >
      <svg
        viewBox="0 0 12 12"
        className={`w-[11px] h-[11px] stroke-white fill-none transition-opacity duration-100 ${checked ? 'opacity-100' : 'opacity-0'}`}
        strokeWidth={2.4}
      >
        <path d="M2 6.2 4.6 9 10 3" />
      </svg>
    </div>
  );
}
