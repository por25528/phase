interface Props {
  label: string;
}

/**
 * A project-context chip. It is secondary information, so it is capped and
 * truncated rather than allowed to size itself: an untruncated course name
 * ("6.5840 Distributed Systems — Lab 2: Raft") is wider than a phone, and a
 * `whitespace-nowrap` chip with no cap starves the row's actual title —
 * on a 375px viewport it left titles rendering as "E..".
 */
export function Tag({ label }: Props) {
  return (
    <span
      title={label}
      className="flex-none max-w-[38%] sm:max-w-[220px] truncate text-meta text-chip-ink bg-chip px-[9px] py-[2px] rounded-full font-medium"
    >
      {label}
    </span>
  );
}
