import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The toast renders `label` next to a real Undo button (App.tsx), so a label
// that ends in "· Undo" prints the word twice. Guarding at the source keeps all
// ~14 call sites honest without exercising each action.
describe('undo toast labels', () => {
  const source = readFileSync(new URL('./store.ts', import.meta.url), 'utf8');

  // Comment lines are skipped. The rule is about the label a user reads, and
  // prose discussing the mechanism legitimately writes `pendingUndo` — which
  // ends in "Undo`" and tripped the check for a defect that wasn't there.
  const isComment = (line: string) => /^\s*(\/\/|\/?\*)/.test(line);

  it('never bakes the word Undo into a label', () => {
    const offenders = source
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => !isComment(line))
      .filter(([, line]) => /Undo`/.test(line) || /· Undo/.test(line));

    expect(offenders).toEqual([]);
  });
});
