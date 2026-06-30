interface Props {
  children: React.ReactNode;
  first?: boolean;
}

export function SectionLabel({ children, first }: Props) {
  return (
    <div
      className={`text-[.7rem] tracking-[.13em] uppercase text-muted font-semibold mb-3 ${
        first ? 'mt-0' : 'mt-[34px]'
      }`}
    >
      {children}
    </div>
  );
}
