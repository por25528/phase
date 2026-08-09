interface Props {
  children: React.ReactNode;
  first?: boolean;
}

export function SectionLabel({ children, first }: Props) {
  return (
    <div
      className={`text-meta font-semibold text-muted mb-3 ${
        first ? 'mt-0' : 'mt-[34px]'
      }`}
    >
      {children}
    </div>
  );
}
