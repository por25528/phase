import { describe, it, expect } from 'vitest';
import { resolvePlanKey } from './planKeyboard';

describe('resolvePlanKey', () => {
  it('maps 1 to Monday and 7 to Sunday', () => {
    expect(resolvePlanKey({ key: '1' })).toEqual({ kind: 'place', dow: 0 });
    expect(resolvePlanKey({ key: '7' })).toEqual({ kind: 'place', dow: 6 });
  });

  it('maps every weekday digit in between', () => {
    const got = ['2', '3', '4', '5', '6'].map((key) => resolvePlanKey({ key }));
    expect(got).toEqual([1, 2, 3, 4, 5].map((dow) => ({ kind: 'place', dow })));
  });

  it('ignores 0, 8 and 9', () => {
    for (const key of ['0', '8', '9']) expect(resolvePlanKey({ key })).toBeNull();
  });

  it('maps bracket keys to week navigation', () => {
    expect(resolvePlanKey({ key: '[' })).toEqual({ kind: 'week', delta: -1 });
    expect(resolvePlanKey({ key: ']' })).toEqual({ kind: 'week', delta: 1 });
  });

  it('maps t and T to today', () => {
    expect(resolvePlanKey({ key: 't' })).toEqual({ kind: 'today' });
    expect(resolvePlanKey({ key: 'T' })).toEqual({ kind: 'today' });
  });

  it('ignores every key while a text input is focused', () => {
    const target = { tagName: 'INPUT' };
    for (const key of ['1', '7', '[', ']', 't']) {
      expect(resolvePlanKey({ key, target })).toBeNull();
    }
  });

  it('ignores keys inside a contenteditable region', () => {
    expect(resolvePlanKey({ key: '3', target: { isContentEditable: true } })).toBeNull();
  });

  it('ignores modified keys so browser and app shortcuts still work', () => {
    expect(resolvePlanKey({ key: '1', metaKey: true })).toBeNull();
    expect(resolvePlanKey({ key: '1', ctrlKey: true })).toBeNull();
    expect(resolvePlanKey({ key: '1', altKey: true })).toBeNull();
  });

  it('returns null for an unrelated key', () => {
    expect(resolvePlanKey({ key: 'q' })).toBeNull();
  });
});
