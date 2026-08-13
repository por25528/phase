import { useRef } from 'react';

/**
 * The underline tablist — one primary axis across a page.
 *
 * Extracted from `views/project/AreaPage.tsx`, which grew it first and is
 * welcome to adopt this. It is NOT `SegmentedControl`: that is a compact pill
 * for a view toggle sitting in a toolbar, and this is the axis a page is
 * organised by. Two shapes, two altitudes — but only one of each, which is the
 * lesson `SegmentedControl`'s own header records.
 *
 * Roving `tabIndex` per the ARIA tabs pattern: one tab stop for the strip,
 * arrows to move within it.
 */

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

export function Tabs<T extends string>({
  label,
  value,
  items,
  onChange,
  idPrefix,
  controls,
}: {
  /** Names the strip for assistive tech. */
  label: string;
  value: T;
  items: readonly TabItem<T>[];
  onChange: (next: T) => void;
  /** Prefix for each tab's DOM id, so `aria-labelledby` can point at one. */
  idPrefix: string;
  /** The id of the panel this strip drives. */
  controls: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const index = items.findIndex((t) => t.value === value);

  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex items-center gap-[2px] border-b border-line"
      onKeyDown={(e) => {
        let next: number | null = null;
        if (e.key === 'ArrowRight') next = (index + 1) % items.length;
        if (e.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = items.length - 1;
        if (next === null || items.length === 0) return;
        e.preventDefault();
        const target = items[next];
        onChange(target.value);
        refs.current[target.value]?.focus();
      }}
    >
      {items.map((t) => (
        <button
          key={t.value}
          type="button"
          id={`${idPrefix}-${t.value}`}
          role="tab"
          aria-selected={t.value === value}
          aria-controls={controls}
          tabIndex={t.value === value ? 0 : -1}
          ref={(el) => { refs.current[t.value] = el; }}
          onClick={() => onChange(t.value)}
          className={`text-ui px-[12px] py-[6px] -mb-px border-b-2 max-w-[180px] truncate ${
            t.value === value
              ? 'text-ink font-semibold border-accent'
              : 'text-muted font-medium border-transparent hover:text-ink'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
