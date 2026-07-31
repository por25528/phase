import { useEffect, useRef, useState } from 'react';

export function InlineEdit({
  value,
  className,
  onCommit,
  onCancel,
}: {
  value: string;
  className: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const escaped = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function commit() {
    const v = draft.trim();
    if (v) onCommit(v);
    else onCancel();
  }

  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      // The editing underline is the accent TOKEN, per theme. It was an inline
      // `1px solid #C8512F` — a near-accent matching neither the light
      // (#C04E2D) nor the dark (#E1613B) value, so the one affordance that says
      // "you are editing this" was subtly the wrong colour in both themes.
      className={`${className} bg-transparent outline-none p-0 w-full min-w-0 border-0 border-b border-accent`}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          escaped.current = false;
          commit();
        }
        if (e.key === 'Escape') {
          escaped.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!escaped.current) commit();
      }}
    />
  );
}
