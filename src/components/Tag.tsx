interface Props {
  label: string;
}

export function Tag({ label }: Props) {
  return (
    <span className="text-[.7rem] text-accent bg-accent-tint px-[7px] py-[2px] rounded-[20px] font-medium whitespace-nowrap">
      {label}
    </span>
  );
}
