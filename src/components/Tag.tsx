interface Props {
  label: string;
}

export function Tag({ label }: Props) {
  return (
    <span className="text-[.7rem] text-chip-ink bg-chip px-[9px] py-[2px] rounded-full font-medium whitespace-nowrap">
      {label}
    </span>
  );
}
