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
    <section className={`group ${className ?? ''}`}>
      <div className="flex items-center gap-[12px] pb-[7px] mb-[4px] border-b border-line">
        <span className="font-mono text-chip tracking-[.13em] uppercase text-muted">{label}</span>
        {meta}
        <div className="flex-1" />
        {right}
      </div>
      {children}
    </section>
  );
}
