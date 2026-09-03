// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfidenceMark } from './StatusMark';

afterEach(cleanup);

describe('ConfidenceMark', () => {
  it('is a readout named by the rating, with three bars lit to it', () => {
    render(<ConfidenceMark confidence="okay" />);
    const mark = screen.getByRole('img', { name: 'Okay' });
    const bars = Array.from(mark.querySelectorAll('span'));
    expect(bars).toHaveLength(3);
    expect(bars.filter((b) => b.className.includes('bg-accent'))).toHaveLength(2);
  });
  it('reads Not rated with nothing lit when unrated, and lights shaky in warn', () => {
    render(<ConfidenceMark confidence={null} />);
    const none = screen.getByRole('img', { name: 'Not rated' });
    expect(Array.from(none.querySelectorAll('span')).some((b) => b.className.includes('bg-accent'))).toBe(false);
    cleanup();
    render(<ConfidenceMark confidence="shaky" />);
    const shaky = screen.getByRole('img', { name: 'Shaky' });
    expect(Array.from(shaky.querySelectorAll('span')).filter((b) => b.className.includes('bg-warn'))).toHaveLength(1);
  });
});
