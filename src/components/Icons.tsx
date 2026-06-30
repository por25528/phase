export function IconSun({ className = 'w-[15px] h-[15px]' }: { className?: string }) {
  return (
    <svg className={`${className} flex-shrink-0 opacity-85`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function IconTarget({ className = 'w-[15px] h-[15px]' }: { className?: string }) {
  return (
    <svg className={`${className} flex-shrink-0 opacity-85`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function IconBars({ className = 'w-[15px] h-[15px]' }: { className?: string }) {
  return (
    <svg className={`${className} flex-shrink-0 opacity-85`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="5" width="11" height="4" rx="1" />
      <rect x="8" y="14" width="13" height="4" rx="1" />
    </svg>
  );
}
