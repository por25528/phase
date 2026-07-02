import type { ReactNode } from 'react';

interface Props {
  label: string;
  meta?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CardSection({ label, meta, right, children, className }: Props) {
  return (
    <section className={`bg-panel border border-line rounded-card shadow-card px-[18px] py-[15px] ${className ?? ''}`}>
      <div className="flex items-center gap-[12px] mb-[6px]">
        <span className="font-mono text-[.72rem] tracking-[.12em] uppercase text-muted font-semibold">{label}</span>
        {meta}
        <div className="flex-1" />
        {right}
      </div>
      {children}
    </section>
  );
}
